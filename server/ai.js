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
import {
  listProviders,
  normalizeProvider,
  providerDefaults,
  providerModelsRequest,
  providerModelsResult,
  providerNeedsKey,
  providerRequest,
  providerResult,
} from '../src/lib/ai-providers.js'

const DEFAULT_TIMEOUT_MS = 20000
// A key that just failed steps aside for this long instead of being retried on
// every request. Short enough that a transient 500 costs one request.
const DEFAULT_COOLDOWN_MS = 60000
const MAX_POOL = 12

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

/**
 * Sanitize a stored key pool. Every entry keeps its own provider/model/endpoint,
 * so one restaurant can hold "3 DeepSeek keys" *and* "2 Qwen keys" *and* a local
 * Ollama box, and the router will try them in order. Entries without a key are
 * dropped, except for local providers (Ollama, LM Studio) which need none.
 */
export function normalizeKeyPool(entries, fallbackProvider = 'openai') {
  const list = Array.isArray(entries) ? entries.slice(0, MAX_POOL) : []
  const pool = []
  list.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    const provider = normalizeProvider(entry.provider || fallbackProvider)
    const apiKey = text(entry.apiKey, 500)
    if (!apiKey && providerNeedsKey(provider)) return
    const model = text(entry.model, 120)
    pool.push({
      id: text(entry.id, 60) || `key-${index + 1}`,
      label: text(entry.label, 60),
      provider,
      model: model || (entry.provider ? providerDefaults(provider).model : ''),
      baseUrl: text(entry.baseUrl, 300),
      apiKey,
      enabled: entry.enabled !== false,
    })
  })
  return pool
}

/** `AI_KEYS="sk-a,sk-b"` (same vendor) or a JSON array for mixed vendors. */
export function parseEnvKeys(raw, provider = 'openai') {
  const value = text(raw, 4000)
  if (!value) return []
  const asJson = value.startsWith('[')
  if (asJson) {
    try {
      const parsed = JSON.parse(value)
      return normalizeKeyPool(parsed, provider).map((entry, index) => ({ ...entry, id: `env-${index + 1}`, source: 'environment' }))
    } catch {
      return []
    }
  }
  return value
    .split(/[,\s]+/)
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, MAX_POOL)
    .map((apiKey, index) => ({
      id: `env-${index + 1}`,
      label: '',
      provider: normalizeProvider(provider),
      model: '',
      baseUrl: '',
      apiKey,
      enabled: true,
      source: 'environment',
    }))
}

/**
 * Ordered attempt list: the tenant's primary config first, then its backup keys,
 * then the deployment's environment keys. De-duplicated by (provider, key) so a
 * key that appears twice is only tried once.
 */
export function buildAttempts({ primary, pool = [], environment = [], extra = [] } = {}) {
  const candidates = [primary, ...pool, ...extra, ...environment].filter(Boolean)
  const seen = new Set()
  const attempts = []
  for (const candidate of candidates) {
    const provider = normalizeProvider(candidate.provider)
    const apiKey = text(candidate.apiKey, 500)
    const usable = Boolean(apiKey) || !providerNeedsKey(provider)
    if (!usable) continue
    const signature = `${provider}::${apiKey}::${candidate.baseUrl || ''}`
    if (seen.has(signature)) continue
    seen.add(signature)
    attempts.push({
      id: candidate.id || `attempt-${attempts.length + 1}`,
      label: candidate.label || '',
      provider,
      model: candidate.model || providerDefaults(provider).model,
      baseUrl: candidate.baseUrl || '',
      apiKey,
      source: candidate.source || 'tenant',
      local: !providerNeedsKey(provider),
    })
  }
  return attempts
}

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
  const storedModel = text(stored?.model, 120)
  const storedBase = text(stored?.baseUrl, 300)
  const storedKey = text(stored?.apiKey, 500)
  const envModel = text(env.model, 120)
  const envBase = text(env.baseUrl, 300)
  const envKey = text(env.apiKey, 500)
  // A tenant that names a provider but no model gets that provider's default,
  // not the env model (which belongs to a different provider).
  const model = storedModel
    || (stored?.provider
      ? providerDefaults(provider).model
      : (envModel || providerDefaults(provider).model))
  const baseUrl = storedBase || envBase || ''
  const apiKey = storedKey || envKey
  const source = storedKey ? 'tenant' : (envKey ? 'environment' : 'none')

  const pool = normalizeKeyPool(stored?.keys, provider).filter((entry) => entry.enabled)
  const environment = []
  // The deployment's own key is a fallback only when it is not already the
  // primary (otherwise it would be tried twice).
  if (envKey && envKey !== apiKey) {
    environment.push({
      id: 'env-primary',
      label: 'Server environment',
      provider: envProvider,
      model: envModel || providerDefaults(envProvider).model,
      baseUrl: envBase,
      apiKey: envKey,
      source: 'environment',
    })
  }
  environment.push(...parseEnvKeys(env.keys, envProvider))

  const attempts = buildAttempts({
    primary: {
      id: 'primary',
      label: source === 'tenant' ? 'Primary key' : (source === 'environment' ? 'Server environment' : 'Local model'),
      provider,
      model,
      baseUrl,
      apiKey,
      source,
    },
    pool: pool.map((entry) => ({ ...entry, label: entry.label || 'Backup key', source: 'tenant' })),
    environment,
  })

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    source,
    // Extra keys owned by the tenant (raw, server-side only).
    keys: pool,
    // Ordered failover chain used by callModel.
    attempts,
    // Spread requests across every key instead of "primary first".
    rotate: Boolean(stored?.rotate),
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
  cooldownMs = Number(process.env.AI_FAILOVER_COOLDOWN_MS || DEFAULT_COOLDOWN_MS),
  now = () => Date.now(),
  onBriefing = null,
} = {}) {
  if (typeof getState !== 'function') throw new Error('createAiRouter requires getState')
  const router = express.Router()
  // Deployment-wide defaults (env). A tenant's stored config overrides these.
  // AI_KEYS adds extra deployment keys (comma-separated, or a JSON array for
  // mixed vendors) that the failover chain falls back to.
  const envConfig = { provider, model, baseUrl, apiKey, keys: process.env.AI_KEYS || '' }
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

  // ─── Key health + rotation ─────────────────────────────────────────────
  // Every attempt (primary key, each backup key, each env key) has a health
  // record. A failure parks that attempt for `cooldownMs` so a dead key or an
  // exhausted quota does not slow every request; if everything is parked we
  // still try (least-recently-failed first) rather than refusing to answer.
  const health = new Map()
  const rotation = new Map()

  function healthOf(id) {
    let entry = health.get(id)
    if (!entry) {
      entry = { failures: 0, wins: 0, lastError: null, lastErrorAt: null, lastOkAt: null, until: 0 }
      health.set(id, entry)
    }
    return entry
  }

  function markFailure(id, error) {
    const entry = healthOf(id)
    entry.failures += 1
    entry.lastError = error || 'request failed'
    entry.lastErrorAt = now()
    entry.until = now() + cooldownMs
    stats.errors += 1
    stats.lastError = entry.lastError
    return entry
  }

  function markSuccess(id) {
    const entry = healthOf(id)
    entry.failures = 0
    entry.wins += 1
    entry.lastOkAt = now()
    entry.until = 0
    return entry
  }

  function parked(attempt) {
    const entry = health.get(attempt.id)
    return Boolean(entry && entry.until > now())
  }

  /** Order the attempts for one call: healthy first, then rotation order. */
  function orderAttempts(attempts, tenantId, rotate) {
    let list = attempts.slice()
    if (rotate && list.length > 1) {
      const offset = (rotation.get(tenantId) || 0) % list.length
      rotation.set(tenantId, offset + 1)
      list = [...list.slice(offset), ...list.slice(0, offset)]
    }
    const ready = list.filter((attempt) => !parked(attempt))
    if (ready.length) return ready
    // Everything is cooling down: try the ones that have been waiting longest.
    return list
      .slice()
      .sort((a, b) => (health.get(a.id)?.until || 0) - (health.get(b.id)?.until || 0))
  }

  async function callOne(attempt, { system, messages }) {
    const req = providerRequest({
      provider: attempt.provider,
      model: attempt.model,
      baseUrl: attempt.baseUrl,
      apiKey: attempt.apiKey,
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
      const { text, error } = providerResult({ provider: attempt.provider, json })
      if (!res.ok || error) return { ok: false, error: error || `HTTP ${res.status}`, status: res.status }
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (err?.message || 'request failed') }
    }
  }

  /**
   * One logical completion, walked down the attempt chain. Returns the winning
   * attempt so callers can report which key answered (and whether it failed
   * over) without ever exposing the key itself.
   */
  async function callModel({ system, messages, config, tenantId = 'default' }) {
    const cfg = config || mergeAiConfig(null, envConfig)
    const attempts = cfg.attempts?.length ? cfg.attempts : []
    if (!attempts.length) return { skipped: true, reason: 'no AI_API_KEY configured' }
    if (typeof fetchImpl !== 'function') return { skipped: true, reason: 'no fetch available' }

    const order = orderAttempts(attempts, tenantId, cfg.rotate)
    const tried = []
    let lastError = null
    for (const attempt of order) {
      const result = await callOne(attempt, { system, messages })
      if (result.ok) {
        markSuccess(attempt.id)
        stats.replies += 1
        return {
          ok: true,
          text: result.text,
          via: attempt.id,
          viaLabel: attempt.label,
          provider: attempt.provider,
          model: attempt.model,
          attempts: tried.length + 1,
          failover: tried.length > 0,
          tried,
        }
      }
      markFailure(attempt.id, result.error)
      tried.push({ id: attempt.id, label: attempt.label, provider: attempt.provider, error: result.error })
      lastError = result.error
      stats.lastError = lastError
    }
    return { ok: false, error: lastError || 'all attempts failed', tried, attempts: tried.length }
  }

  /**
   * Ask the provider which models this key can actually reach. Model ids are
   * the one thing that changes under a deployment's feet, so the Settings
   * screen offers a live list instead of a hard-coded guess.
   */
  async function listModels(tenantId, override = null) {
    const cfg = configFor(tenantId, override)
    const only = override?.keyId ? cfg.attempts.filter((attempt) => attempt.id === override.keyId) : null
    const attempt = (only && only.length ? only : cfg.attempts)[0]
    if (!attempt) return { ok: false, configured: false, error: 'No API key set.' }
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch unavailable' }
    const req = providerModelsRequest({ provider: attempt.provider, baseUrl: attempt.baseUrl, apiKey: attempt.apiKey })
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetchImpl(req.url, { method: 'GET', headers: req.headers, signal: controller.signal })
      clearTimeout(timer)
      const json = await res.json().catch(() => ({}))
      const { models, error } = providerModelsResult({ provider: attempt.provider, json })
      if (!res.ok || error) return { ok: false, provider: attempt.provider, error: error || `HTTP ${res.status}` }
      return { ok: true, provider: attempt.provider, via: attempt.id, models }
    } catch (err) {
      return { ok: false, provider: attempt.provider, error: err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (err?.message || 'request failed') }
    }
  }

  /** Kernel-safe view of the key pool for the settings screen (never a key). */
  function poolStatus(tenantId) {
    const cfg = configFor(tenantId)
    return cfg.attempts.map((attempt) => {
      const entry = health.get(attempt.id)
      const parkedNow = Boolean(entry && entry.until > now())
      return {
        id: attempt.id,
        label: attempt.label,
        provider: attempt.provider,
        model: attempt.model,
        source: attempt.source,
        local: attempt.local,
        hasKey: Boolean(attempt.apiKey),
        status: parkedNow ? 'cooldown' : entry?.lastOkAt ? 'ok' : entry?.failures ? 'error' : 'idle',
        failures: entry?.failures || 0,
        wins: entry?.wins || 0,
        lastError: entry?.lastError || null,
        cooldownUntil: parkedNow ? entry.until : null,
        lastOkAt: entry?.lastOkAt ? new Date(entry.lastOkAt).toISOString() : null,
      }
    })
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
    // Operational stats and the key-pool health are staff-only: they describe
    // the deployment's keys (counts and failures), never the key values.
    if (authed) {
      res.json({ ...payload, rateLimit, guestRateLimit, stats, rotate: cfg.rotate, keyCount: cfg.attempts.length, pool: poolStatus(req.tenantId) })
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

    const result = await callModel({ system, messages, config: cfg, tenantId: req.tenantId })
    if (result.skipped) {
      stats.skipped += 1
      return res.status(503).json({ ok: false, configured: false, error: result.reason })
    }
    if (!result.ok) return res.status(502).json({ ok: false, error: result.error, tried: result.tried })
    cacheSet(cacheKey, { text: result.text })
    res.json({
      ok: true,
      reply: result.text,
      scope,
      provider: result.provider,
      model: result.model,
      via: result.via,
      viaLabel: result.viaLabel,
      failover: result.failover,
      attempts: result.attempts,
      cached: false,
    })
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

    const result = await callModel({ system, messages, config: cfg, tenantId: req.tenantId })
    if (result.skipped) {
      stats.skipped += 1
      return res.status(503).json({ ok: false, configured: false, error: result.reason })
    }
    if (!result.ok) return res.status(502).json({ ok: false, error: result.error, tried: result.tried })
    cacheSet(cacheKey, { text: result.text })
    res.json({
      ok: true,
      kind,
      reply: result.text,
      scope,
      provider: result.provider,
      model: result.model,
      via: result.via,
      failover: result.failover,
      attempts: result.attempts,
      cached: false,
    })
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
      const result = await callModel({ system, messages, config: cfg, tenantId: req.tenantId })
      if (result.skipped) {
        stats.skipped += 1
        return res.status(503).json({ ok: false, configured: false, error: result.reason })
      }
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error, tried: result.tried })
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
    if (!cfg.attempts.length) return { ok: false, configured: false, error: 'No API key set.' }
    // `keyId` targets one stored key from the pool ("Test" on a backup key), so
    // the check reports on that key instead of walking the whole chain.
    const only = override?.keyId ? cfg.attempts.filter((attempt) => attempt.id === override.keyId) : null
    const scoped = only && only.length ? { ...cfg, attempts: only, rotate: false } : { ...cfg, attempts: cfg.attempts.slice(0, 1), rotate: false }
    const result = await callModel({
      system: 'You are a connectivity check. Reply with the single word: OK.',
      messages: [{ role: 'user', content: 'Reply with the single word: OK.' }],
      config: scoped,
      tenantId,
    })
    if (result.skipped) return { ok: false, configured: false, error: result.reason }
    if (!result.ok) return { ok: false, error: result.error, tried: result.tried }
    return {
      ok: true,
      reply: result.text,
      provider: result.provider,
      model: result.model,
      via: result.via,
      viaLabel: result.viaLabel,
    }
  }

  return { router, stats, probe, configFor, poolStatus, listModels }
}
