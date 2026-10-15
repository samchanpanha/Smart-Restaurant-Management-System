// ─── AI routes ───────────────────────────────────────────────────────
// A thin, provider-agnostic shell around an LLM. The heavy lifting lives
// in pure modules so it can be tested offline:
//   src/lib/ai-providers.js  — request/response shape per provider
//   src/lib/ai.js            — redacted context digest + prompts
//
// Design rules (mirrors server/telegram.js):
//   • No API key ⇒ every route is a no-op; the restaurant runs unchanged.
//   • Never throw — return { ok, error }; a flaky model must not break ops.
//   • Global fetch, injectable for tests, AbortController timeout.
//   • Tenant-scoped: reads state through the caller's getState(tenantId).
//   • Read-only: the assistant never dispatches reducer actions.
//
// Environment:
//   AI_API_KEY            provider key — absent disables AI
//   AI_PROVIDER           openai | anthropic | gemini | ollama   (openai)
//   AI_MODEL              model id                               (provider default)
//   AI_BASE_URL           override endpoint (self-host / proxy)
//   AI_TIMEOUT_MS         outbound timeout                        (20000)
//   AI_RATE_LIMIT         requests / window for staff             (30)
//   AI_GUEST_RATE_LIMIT   requests / window for guests            (6)
//   AI_RATE_WINDOW_MS     rate window                             (60000)
//   AI_CACHE_TTL_MS       insight cache TTL                       (300000)

import express from 'express'
import { AI_INSIGHT_KINDS, AI_SCOPES, buildAiContext, buildMessages, hashContext } from '../src/lib/ai.js'
import { listProviders, normalizeProvider, providerDefaults, providerRequest, providerResult } from '../src/lib/ai-providers.js'

const DEFAULT_TIMEOUT_MS = 20000

// `generatedAt` changes every call, so it must never enter a cache key or the
// same question would always miss. Everything else in the digest is derived
// from state and is stable until the state actually changes.
function stableHash(context) {
  const copy = { ...context }
  delete copy.generatedAt
  return hashContext(copy)
}

// Fold a tenant's stored config over the deployment's environment defaults.
// A tenant may override any field; anything it leaves unset falls back to the
// env (so an operator who set AI_API_KEY keeps working, and a tenant that
// supplies its own key takes precedence). Pure — safe to unit-test.
export function mergeAiConfig(stored, env = {}) {
  const envProvider = normalizeProvider(env.provider)
  const provider = normalizeProvider(stored?.provider || envProvider)
  const storedModel = String(stored?.model || '').trim()
  const storedBase = String(stored?.baseUrl || '').trim()
  const storedKey = String(stored?.apiKey || '').trim()
  const envModel = String(env.model || '').trim()
  const envBase = String(env.baseUrl || '').trim()
  const envKey = String(env.apiKey || '').trim()
  // A tenant that names a provider but no model gets that provider's default,
  // not the env model (which belongs to a different provider).
  const model = storedModel
    || (stored?.provider
      ? providerDefaults(provider).model
      : (envModel || providerDefaults(provider).model))
  return {
    provider,
    model,
    baseUrl: storedBase || envBase || '',
    apiKey: storedKey || envKey,
    source: storedKey ? 'tenant' : (envKey ? 'environment' : 'none'),
  }
}

export function createAiRouter({
  getState,
  resolveTenant = null,
  // (tenantId) => { provider, model, baseUrl, apiKey } | null — the tenant's
  // saved config, if any. Folded over the env defaults by mergeAiConfig.
  resolveConfig = null,
  apiKey = process.env.AI_API_KEY || '',
  provider = process.env.AI_PROVIDER || 'openai',
  model = process.env.AI_MODEL || '',
  baseUrl = process.env.AI_BASE_URL || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  rateLimit = Number(process.env.AI_RATE_LIMIT || 30),
  guestRateLimit = Number(process.env.AI_GUEST_RATE_LIMIT || 6),
  rateWindowMs = Number(process.env.AI_RATE_WINDOW_MS || 60000),
  cacheTtlMs = Number(process.env.AI_CACHE_TTL_MS || 300000),
  now = () => Date.now(),
  onBriefing = null,
} = {}) {
  if (typeof getState !== 'function') throw new Error('createAiRouter requires getState')
  const router = express.Router()
  // Deployment-wide defaults (env). A tenant's stored config overrides these.
  const envConfig = { provider, model, baseUrl, apiKey }
  const tenantMw = typeof resolveTenant === 'function'
    ? resolveTenant
    : (req, _res, next) => { req.tenantId = 'default'; next() }

  // Resolve the effective provider config for one tenant (optionally with a
  // one-off override, used by "test connection" before anything is saved).
  function configFor(tenantId, override = null) {
    const stored = typeof resolveConfig === 'function' ? resolveConfig(tenantId) : null
    const merged = override ? { ...(stored || {}), ...override } : stored
    return mergeAiConfig(merged, envConfig)
  }

  const stats = { requests: 0, replies: 0, skipped: 0, errors: 0, cached: 0, limited: 0, lastAt: null, lastError: null }

  // Sliding-window limiter, one bucket list per key. No dependency.
  const hits = new Map()
  function checkLimit(key, limit) {
    const t = now()
    const arr = (hits.get(key) || []).filter((ts) => t - ts < rateWindowMs)
    if (arr.length >= limit) {
      hits.set(key, arr)
      return { ok: false, retryAfterMs: Math.max(0, rateWindowMs - (t - arr[0])) }
    }
    arr.push(t)
    hits.set(key, arr)
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((ts) => t - ts < rateWindowMs)) hits.delete(k)
    return { ok: true, remaining: limit - arr.length }
  }

  const cache = new Map()
  function cacheGet(key) {
    const hit = cache.get(key)
    if (!hit) return null
    if (now() - hit.at > cacheTtlMs) { cache.delete(key); return null }
    return hit
  }
  function cacheSet(key, value) {
    cache.set(key, { ...value, at: now() })
    if (cache.size > 500) cache.delete(cache.keys().next().value)
  }

  async function callModel({ system, messages, config }) {
    const cfg = config || envConfig
    if (!cfg.apiKey) return { skipped: true, reason: 'no AI_API_KEY configured' }
    if (typeof fetchImpl !== 'function') return { skipped: true, reason: 'no fetch available' }
    const req = providerRequest({
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      system,
      messages,
    })
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetchImpl(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const json = await res.json().catch(() => ({}))
      const { text, error } = providerResult({ provider: cfg.provider, json })
      if (!res.ok || error) return { ok: false, error: error || `HTTP ${res.status}` }
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: err?.message || 'request failed' }
    }
  }

  function shopFor(tenantId, locId) {
    const empire = getState(tenantId) || {}
    const locations = empire.locations || {}
    const shop = locations[locId] || locations.downtown || Object.values(locations)[0]
    const resolvedLoc = locations[locId] ? locId : (locations.downtown ? 'downtown' : Object.keys(locations)[0] || 'downtown')
    return { shop, locId: resolvedLoc }
  }

  // Guests (no session) may only ever see the menu.
  function resolveScope(req, requested) {
    const authed = Boolean(req.auth && req.auth.user)
    if (!authed) return 'menu'
    const asked = AI_SCOPES.includes(requested) ? requested : 'ops'
    return asked
  }

  // One limiter bucket per caller. Staff share a bucket per tenant; guests get
  // their own bucket per client IP so one busy table cannot throttle the room.
  function actorKey(req) {
    if (req.auth && req.auth.user) return `${req.tenantId || 'default'}:ops`
    const ip = req.ip || req.socket?.remoteAddress || req.headers?.['x-forwarded-for'] || 'unknown'
    return `${req.tenantId || 'default'}:guest:${String(ip).split(',')[0].trim()}`
  }

  function limited(res, key, limit) {
    const verdict = checkLimit(key, limit)
    if (verdict.ok) return false
    stats.limited += 1
    res.setHeader('Retry-After', Math.ceil(verdict.retryAfterMs / 1000))
    res.status(429).json({ ok: false, error: 'Too many AI requests — slow down.', retryAfterMs: verdict.retryAfterMs })
    return true
  }

  router.get('/api/ai/status', tenantMw, (req, res) => {
    const cfg = configFor(req.tenantId)
    const authed = Boolean(req.auth && req.auth.user)
    res.setHeader('Cache-Control', 'no-store')
    const payload = {
      configured: Boolean(cfg.apiKey),
      provider: cfg.provider,
      model: cfg.model,
      source: cfg.source,
      providers: listProviders(),
      scopes: AI_SCOPES,
      kinds: AI_INSIGHT_KINDS,
    }
    // Operational stats (request counts, last provider error) are staff-only.
    if (authed) {
      res.json({ ...payload, rateLimit, guestRateLimit, stats })
      return
    }
    res.json({ ...payload, guestRateLimit })
  })

  router.post('/api/ai/chat', tenantMw, async (req, res) => {
    const body = req.body || {}
    const scope = resolveScope(req, body.scope)
    if (limited(res, actorKey(req), scope === 'menu' ? guestRateLimit : rateLimit)) return
    stats.requests += 1
    stats.lastAt = new Date(now()).toISOString()

    const { shop, locId } = shopFor(req.tenantId, typeof body.locId === 'string' ? body.locId : '')
    const context = buildAiContext(shop, { scope, locId, now: now(), lang: body.lang })
    const { system, messages } = buildMessages({
      kind: 'chat',
      question: typeof body.question === 'string' ? body.question : '',
      history: body.messages,
      context,
      lang: body.lang,
    })

    const cfg = configFor(req.tenantId)
    const cacheKey = `chat:${req.tenantId}:${cfg.provider}:${scope}:${body.lang || 'en'}:${stableHash(context)}:${hashContext(messages)}`
    const cached = cacheGet(cacheKey)
    if (cached) {
      stats.cached += 1
      return res.json({ ok: true, reply: cached.text, scope, provider: cfg.provider, model: cfg.model, cached: true })
    }

    const result = await callModel({ system, messages, config: cfg })
    if (result.skipped) {
      stats.skipped += 1
      return res.status(503).json({ ok: false, configured: false, error: result.reason })
    }
    if (!result.ok) {
      stats.errors += 1
      stats.lastError = result.error
      return res.status(502).json({ ok: false, error: result.error })
    }
    stats.replies += 1
    cacheSet(cacheKey, { text: result.text })
    res.json({ ok: true, reply: result.text, scope, provider: cfg.provider, model: cfg.model, cached: false })
  })

  router.post('/api/ai/insight', tenantMw, async (req, res) => {
    const body = req.body || {}
    const kind = AI_INSIGHT_KINDS.includes(body.kind) && body.kind !== 'briefing' ? body.kind : 'alert'
    const scope = resolveScope(req, body.scope)
    if (limited(res, actorKey(req), scope === 'menu' ? guestRateLimit : rateLimit)) return
    stats.requests += 1
    stats.lastAt = new Date(now()).toISOString()

    const { shop, locId } = shopFor(req.tenantId, typeof body.locId === 'string' ? body.locId : '')
    const context = buildAiContext(shop, { scope, locId, now: now(), lang: body.lang })
    const { system, messages } = buildMessages({ kind, context, lang: body.lang })

    const cfg = configFor(req.tenantId)
    const cacheKey = `insight:${kind}:${req.tenantId}:${cfg.provider}:${scope}:${body.lang || 'en'}:${stableHash(context)}`
    const cached = cacheGet(cacheKey)
    if (cached) {
      stats.cached += 1
      return res.json({ ok: true, kind, reply: cached.text, scope, provider: cfg.provider, model: cfg.model, cached: true })
    }

    const result = await callModel({ system, messages, config: cfg })
    if (result.skipped) {
      stats.skipped += 1
      return res.status(503).json({ ok: false, configured: false, error: result.reason })
    }
    if (!result.ok) {
      stats.errors += 1
      stats.lastError = result.error
      return res.status(502).json({ ok: false, error: result.error })
    }
    stats.replies += 1
    cacheSet(cacheKey, { text: result.text })
    res.json({ ok: true, kind, reply: result.text, scope, provider: cfg.provider, model: cfg.model, cached: false })
  })

  // Shift briefing. `deliver:true` hands the text to onBriefing (Telegram push).
  router.post('/api/ai/briefing', tenantMw, async (req, res) => {
    const body = req.body || {}
    const phase = body.phase === 'close' ? 'close' : 'open'
    const scope = resolveScope(req, body.scope)
    if (limited(res, actorKey(req), scope === 'menu' ? guestRateLimit : rateLimit)) return
    stats.requests += 1
    stats.lastAt = new Date(now()).toISOString()

    const { shop, locId } = shopFor(req.tenantId, typeof body.locId === 'string' ? body.locId : '')
    const context = { ...buildAiContext(shop, { scope, locId, now: now(), lang: body.lang }), briefingPhase: phase }
    const { system, messages } = buildMessages({ kind: 'briefing', context, lang: body.lang })

    const cfg = configFor(req.tenantId)
    const cacheKey = `briefing:${phase}:${req.tenantId}:${cfg.provider}:${scope}:${body.lang || 'en'}:${stableHash(context)}`
    const cached = cacheGet(cacheKey)
    let text = cached?.text
    if (cached) stats.cached += 1
    else {
      const result = await callModel({ system, messages, config: cfg })
      if (result.skipped) {
        stats.skipped += 1
        return res.status(503).json({ ok: false, configured: false, error: result.reason })
      }
      if (!result.ok) {
        stats.errors += 1
        stats.lastError = result.error
        return res.status(502).json({ ok: false, error: result.error })
      }
      stats.replies += 1
      text = result.text
      cacheSet(cacheKey, { text })
    }

    let delivered = false
    if (body.deliver && typeof onBriefing === 'function') {
      try {
        delivered = await onBriefing(text, { tenantId: req.tenantId, locId, phase, lang: body.lang, config: cfg })
      } catch {
        delivered = false
      }
    }
    res.json({ ok: true, phase, reply: text, scope, provider: cfg.provider, model: cfg.model, cached: Boolean(cached), delivered })
  })

  // One-off connectivity check used by the settings screen's "Test" button.
  // Accepts an override so an unsaved key can be tried before it is stored.
  async function probe(tenantId, override = null) {
    const cfg = configFor(tenantId, override)
    if (!cfg.apiKey) return { ok: false, configured: false, error: 'No API key set.' }
    const result = await callModel({
      system: 'You are a connectivity check. Reply with the single word: OK.',
      messages: [{ role: 'user', content: 'Reply with the single word: OK.' }],
      config: cfg,
    })
    if (result.skipped) return { ok: false, configured: false, error: result.reason }
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, reply: result.text, provider: cfg.provider, model: cfg.model }
  }

  return { router, stats, probe, configFor }
}
