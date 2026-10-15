// ─── AI provider config routes ───────────────────────────────────────
// Lets an owner (or super admin) set the tenant's AI provider/key from the
// UI instead of the process environment. Stored per-tenant in SQLite kv
// (server/db.js), never in the reducer state — /api/state is also served to
// guests, so an API key must never appear there.
//
// Access is owner + super admin only. The raw key is write-only: responses
// report `hasKey` / `keySource` and the key *pool* as metadata, never a key
// value. Provider config is resolved dynamically by server/ai.js
// (mergeAiConfig), so a save takes effect on the next request without a
// restart.
//
// Shape stored per tenant:
//   { provider, model, baseUrl, apiKey, rotate,
//     keys: [{ id, label, provider, model, baseUrl, apiKey, enabled }] }
//
// The `keys` array is the failover pool: extra keys — possibly for other
// vendors — that server/ai.js walks when the primary key errors or is rate
// limited. `apiKey` inside a pool entry is write-only, same as the primary.
//
//   GET  /api/ai/config       → current config (no keys) + provider catalogue
//   PUT  /api/ai/config       → save provider/model/baseUrl/apiKey/keys/rotate
//   POST /api/ai/config/test  → live connectivity check (may use an unsaved key)

import express from 'express'
import { listProviders, normalizeProvider } from '../src/lib/ai-providers.js'
import { mergeAiConfig, normalizeKeyPool } from './ai.js'

const MAX_KEY = 500
const MAX_MODEL = 120
const MAX_BASE_URL = 300
const MAX_LABEL = 60
const MAX_POOL_KEYS = 12

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || '').trim())
}

// Replace the pool: entries keep their stored secret when the payload omits
// `apiKey` (that is how the UI edits a label or disables a key without asking
// the owner to paste the key again). Entries that would end up with no key —
// and are not a local provider — are dropped.
function mergePool(payload, stored) {
  const previous = new Map(
    (Array.isArray(stored?.keys) ? stored.keys : [])
      .filter((entry) => entry && entry.id)
      .map((entry) => [String(entry.id), entry]),
  )
  const incoming = Array.isArray(payload) ? payload.slice(0, MAX_POOL_KEYS) : []
  const merged = incoming.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null
    const id = String(entry.id || `key-${index + 1}`).trim().slice(0, 60)
    const before = previous.get(id) || {}
    const apiKey = 'apiKey' in entry
      ? String(entry.apiKey ?? '').trim().slice(0, MAX_KEY)
      : String(before.apiKey || '').trim().slice(0, MAX_KEY)
    return {
      id,
      label: String(entry.label ?? before.label ?? '').trim().slice(0, MAX_LABEL),
      provider: normalizeProvider(entry.provider || before.provider || stored?.provider),
      model: String(entry.model ?? before.model ?? '').trim().slice(0, MAX_MODEL),
      baseUrl: String(entry.baseUrl ?? before.baseUrl ?? '').trim().slice(0, MAX_BASE_URL),
      apiKey,
      enabled: entry.enabled !== false,
    }
  }).filter(Boolean)
  // normalizeKeyPool is the same sanitizer the router uses, so what is stored
  // is exactly what will be tried (and it drops keyless non-local entries).
  return normalizeKeyPool(merged, stored?.provider || 'openai')
}

// Shape sent to the browser — deliberately omits every key.
function present(stored, env) {
  const cfg = mergeAiConfig(stored, env)
  const storedKey = String(stored?.apiKey || '').trim()
  const pool = (Array.isArray(stored?.keys) ? stored.keys : []).map((entry, index) => ({
    id: String(entry?.id || `key-${index + 1}`),
    label: String(entry?.label || ''),
    provider: normalizeProvider(entry?.provider || stored?.provider),
    model: String(entry?.model || ''),
    baseUrl: String(entry?.baseUrl || ''),
    // A stored entry only survives normalization when it has a key (or is a
    // local provider), so `hasKey` is what the UI shows as "configured".
    hasKey: Boolean(String(entry?.apiKey || '').trim()),
    enabled: entry?.enabled !== false,
  }))
  return {
    configured: cfg.attempts.length > 0,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    hasKey: Boolean(storedKey),
    keySource: storedKey ? 'tenant' : (cfg.apiKey ? 'environment' : 'none'),
    keyCount: cfg.attempts.length,
    poolCount: pool.length,
    rotate: Boolean(stored?.rotate),
    keys: pool,
    providers: listProviders(),
  }
}

export function createAiConfigRouter({
  resolveTenant = null,
  requireAdmin,
  getConfig,
  setConfig,
  probe = null,
  env = {},
} = {}) {
  if (typeof getConfig !== 'function' || typeof setConfig !== 'function') {
    throw new Error('createAiConfigRouter requires getConfig and setConfig')
  }
  if (typeof requireAdmin !== 'function') {
    throw new Error('createAiConfigRouter requires requireAdmin')
  }
  const router = express.Router()
  const tenantMw = typeof resolveTenant === 'function'
    ? resolveTenant
    : (req, _res, next) => { req.tenantId = 'default'; next() }

  router.get('/api/ai/config', tenantMw, requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(present(getConfig(req.tenantId), env))
  })

  router.put('/api/ai/config', tenantMw, requireAdmin, (req, res) => {
    const body = req.body || {}
    const stored = getConfig(req.tenantId)
    const next = { ...(stored || {}) }

    if ('provider' in body) next.provider = normalizeProvider(body.provider)

    if ('model' in body) {
      const model = String(body.model ?? '').trim().slice(0, MAX_MODEL)
      if (model) next.model = model
      else delete next.model
    }

    if ('baseUrl' in body) {
      const baseUrl = String(body.baseUrl ?? '').trim().slice(0, MAX_BASE_URL)
      if (baseUrl) {
        if (!isHttpUrl(baseUrl)) return res.status(400).json({ error: 'Base URL must start with http:// or https://' })
        next.baseUrl = baseUrl
      } else {
        delete next.baseUrl
      }
    }

    if ('apiKey' in body) {
      const apiKey = String(body.apiKey ?? '').trim().slice(0, MAX_KEY)
      if (apiKey) next.apiKey = apiKey
      else delete next.apiKey
    }

    if ('rotate' in body) {
      if (body.rotate) next.rotate = true
      else delete next.rotate
    }

    if ('keys' in body) {
      const keys = mergePool(body.keys, stored)
      if (keys.length) next.keys = keys
      else delete next.keys
    }

    const removedKey = body.removeKey === true
    if (removedKey) {
      delete next.apiKey
      delete next.keys
    }

    setConfig(req.tenantId, next)
    res.json({ ok: true, ...present(getConfig(req.tenantId), env) })
  })

  router.post('/api/ai/config/test', tenantMw, requireAdmin, async (req, res) => {
    if (typeof probe !== 'function') return res.status(501).json({ ok: false, error: 'Connection testing is unavailable.' })
    const body = req.body || {}
    const override = {}
    if (body.provider) override.provider = normalizeProvider(body.provider)
    if (typeof body.model === 'string' && body.model.trim()) override.model = body.model.trim().slice(0, MAX_MODEL)
    if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) override.baseUrl = body.baseUrl.trim().slice(0, MAX_BASE_URL)
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) override.apiKey = body.apiKey.trim().slice(0, MAX_KEY)
    // Test one stored backup key instead of the primary.
    if (typeof body.keyId === 'string' && body.keyId.trim()) override.keyId = body.keyId.trim().slice(0, 60)

    const result = await probe(req.tenantId, Object.keys(override).length ? override : null)
    res.status(result.ok ? 200 : 502).json(result)
  })

  return { router }
}
