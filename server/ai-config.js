// ─── AI provider config routes ───────────────────────────────────────
// Lets an owner (or super admin) set the tenant's AI provider/key from the
// UI instead of the process environment. Stored per-tenant in SQLite kv
// (server/db.js), never in the reducer state — /api/state is also served to
// guests, so an API key must never appear there.
//
// Access is owner + super admin only. The raw key is write-only: responses
// report `hasKey` / `keySource`, never the key itself. Provider config is
// resolved dynamically by server/ai.js (mergeAiConfig), so a save takes
// effect on the next request without a restart.
//
//   GET  /api/ai/config       → current config (no key) + provider catalogue
//   PUT  /api/ai/config       → save provider/model/baseUrl/apiKey (key optional)
//   POST /api/ai/config/test  → live connectivity check (may use an unsaved key)

import express from 'express'
import { listProviders, normalizeProvider } from '../src/lib/ai-providers.js'
import { mergeAiConfig } from './ai.js'

const MAX_KEY = 500
const MAX_MODEL = 120
const MAX_BASE_URL = 300

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || '').trim())
}

// Shape sent to the browser — deliberately omits the key.
function present(stored, env) {
  const cfg = mergeAiConfig(stored, env)
  const storedKey = String(stored?.apiKey || '').trim()
  return {
    configured: Boolean(cfg.apiKey),
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    hasKey: Boolean(storedKey),
    keySource: storedKey ? 'tenant' : (cfg.apiKey ? 'environment' : 'none'),
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
    const next = { ...(getConfig(req.tenantId) || {}) }

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

    const result = await probe(req.tenantId, Object.keys(override).length ? override : null)
    res.status(result.ok ? 200 : 502).json(result)
  })

  return { router }
}
