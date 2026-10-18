// ─── Translation routes (free Google Translate proxy) ────────────────
// The browser cannot call Google's free `translate_a/single` endpoint itself:
// it answers without CORS headers, so a cross-origin fetch is rejected. This
// router is the same-origin door — and because every terminal shares it, one
// cache serves the whole restaurant (the sign-in screen, the ops workspace,
// the guest QR menu and the Telegram mini app all ask for the same few
// hundred strings).
//
// Design rules (mirrors server/ai.js and server/telegram.js):
//   • The heavy lifting lives in a pure module — src/lib/translate-engine.js —
//     which the Vite dev server also uses, so `npm run dev` translates too.
//   • Never throw: a blocked, slow or rate-limited Google answers
//     `{ ok: false, error }` and the app simply keeps the dictionary copy.
//   • Global fetch, injectable for tests (`fetchImpl`), AbortController timeout.
//   • Public but throttled: guests need it for the QR menu, so the limiter
//     gives staff one bucket per tenant and guests one bucket per IP.
//   • Read-only: it never touches reducer state and never stores guest data.
//
// Environment:
//   TRANSLATE_ENABLED          false disables every route       (true)
//   TRANSLATE_ENDPOINT         override the Google endpoint
//   TRANSLATE_SOURCE_LANG      source language of app copy       (en)
//   TRANSLATE_TIMEOUT_MS       outbound timeout                  (8000)
//   TRANSLATE_RATE_LIMIT       requests / window for staff       (60)
//   TRANSLATE_GUEST_RATE_LIMIT requests / window for guests      (20)
//   TRANSLATE_RATE_WINDOW_MS   rate window                       (60000)
//   TRANSLATE_CACHE_TTL_MS     server cache TTL, 0 = keep forever (0)
//   TRANSLATE_MAX_TEXTS        strings per request               (120)
//   TRANSLATE_CONCURRENCY      parallel upstream chunks           (3)

import express from 'express'
import {
  GOOGLE_TRANSLATE_ENDPOINT,
  TRANSLATE_LANGS,
  TRANSLATE_SOURCE_LANG,
  createTranslationCache,
  isTranslatable,
  sanitizeForTranslation,
  translateBatch,
  translateTargetCode,
} from '../src/lib/translate-engine.js'

const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_MAX_TEXTS = 120
const DEFAULT_CACHE_MAX = 4000
/** How many entries of the in-memory cache get written back to SQLite. */
const PERSIST_MAX_ENTRIES = 2000

export function createTranslateRouter({
  fetchImpl = globalThis.fetch,
  endpoint = process.env.TRANSLATE_ENDPOINT || GOOGLE_TRANSLATE_ENDPOINT,
  source = process.env.TRANSLATE_SOURCE_LANG || TRANSLATE_SOURCE_LANG,
  enabled = String(process.env.TRANSLATE_ENABLED ?? 'true').toLowerCase() !== 'false',
  timeoutMs = Number(process.env.TRANSLATE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  rateLimit = Number(process.env.TRANSLATE_RATE_LIMIT || 60),
  guestRateLimit = Number(process.env.TRANSLATE_GUEST_RATE_LIMIT || 20),
  rateWindowMs = Number(process.env.TRANSLATE_RATE_WINDOW_MS || 60000),
  cacheTtlMs = Number(process.env.TRANSLATE_CACHE_TTL_MS || 0),
  maxTexts = Number(process.env.TRANSLATE_MAX_TEXTS || DEFAULT_MAX_TEXTS),
  concurrency = Number(process.env.TRANSLATE_CONCURRENCY || 3),
  resolveTenant = null,
  // Optional durable cache: load once at boot, save (debounced) on change.
  loadCache = null,
  saveCache = null,
  persistDelayMs = 5000,
  now = () => Date.now(),
} = {}) {
  const router = express.Router()
  const tenantMw = typeof resolveTenant === 'function'
    ? resolveTenant
    : (req, _res, next) => { req.tenantId = 'default'; next() }

  const cache = createTranslationCache({ max: DEFAULT_CACHE_MAX, ttlMs: cacheTtlMs, now })
  const stats = { requests: 0, strings: 0, cached: 0, fetched: 0, upstream: 0, errors: 0, limited: 0, lastAt: null, lastError: null }

  // Rehydrate from SQLite so a restart does not re-ask Google for the whole UI.
  if (typeof loadCache === 'function') {
    try {
      const stored = loadCache()
      if (stored && typeof stored === 'object') cache.load(stored)
    } catch (error) {
      stats.lastError = `cache load: ${error?.message || error}`
    }
  }

  let persistTimer = null
  function persist() {
    if (typeof saveCache !== 'function') return
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      try {
        const dump = cache.dump()
        const entries = Object.entries(dump)
        // Keep the stored blob bounded: newest entries are at the end.
        const trimmed = entries.length > PERSIST_MAX_ENTRIES
          ? Object.fromEntries(entries.slice(entries.length - PERSIST_MAX_ENTRIES))
          : dump
        saveCache(trimmed)
      } catch (error) {
        stats.lastError = `cache save: ${error?.message || error}`
      }
    }, persistDelayMs)
    persistTimer.unref?.()
  }

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
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((ts) => t - ts < rateWindowMs)) hits.delete(k)
    }
    return { ok: true, remaining: limit - arr.length }
  }

  // Staff share a bucket per tenant; guests get one per client IP so a single
  // busy table cannot throttle the whole dining room.
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
    res.status(429).json({ ok: false, error: 'Too many translation requests — slow down.', retryAfterMs: verdict.retryAfterMs })
    return true
  }

  function publicStatus(req) {
    const authed = Boolean(req?.auth && req?.auth?.user)
    const payload = {
      ok: true,
      enabled,
      provider: 'google-translate-free',
      endpoint: enabled ? endpoint : '',
      source,
      targets: TRANSLATE_LANGS.map((lang) => ({ lang, code: translateTargetCode(lang) })),
      guestRateLimit,
      cache: { entries: cache.size, max: DEFAULT_CACHE_MAX },
    }
    // Upstream counters are staff-only, like the AI router's stats.
    if (authed) Object.assign(payload, { rateLimit, timeoutMs, stats })
    return payload
  }

  router.get('/api/translate/status', tenantMw, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(publicStatus(req))
  })

  /**
   * POST /api/translate — { texts: string[], target: 'km' | 'zh' }
   * → { ok, translations: { source: translated }, missing, cached, fetched, requests }
   * Cached strings never reach Google; the answer is the union of both.
   */
  router.post('/api/translate', tenantMw, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!enabled) {
      return res.status(503).json({ ok: false, error: 'translation disabled on this server' })
    }
    const body = req.body || {}
    const target = String(body.target || '').trim().toLowerCase()
    if (!TRANSLATE_LANGS.includes(target)) {
      return res.status(400).json({ ok: false, error: `unsupported target language: ${target || '(none)'}` })
    }
    const rawTexts = Array.isArray(body.texts) ? body.texts : (typeof body.text === 'string' ? [body.text] : [])
    const texts = rawTexts
      .filter((text) => typeof text === 'string')
      .map(sanitizeForTranslation)
      .filter(Boolean)
      .slice(0, maxTexts)
    if (!texts.length) {
      return res.json({ ok: true, translations: {}, missing: [], skipped: [], cached: 0, fetched: 0, requests: 0 })
    }
    if (limited(res, actorKey(req), req.auth?.user ? rateLimit : guestRateLimit)) return undefined

    stats.requests += 1
    stats.strings += texts.length
    stats.lastAt = new Date(now()).toISOString()

    const result = await translateBatch({
      texts,
      target,
      source,
      endpoint,
      fetchImpl,
      timeoutMs,
      cache,
      concurrency,
    })

    const translatedCount = Object.keys(result.translations).length
    // Everything we could not answer, and that was worth asking about.
    const missing = result.missing.filter(isTranslatable)
    stats.cached += Math.max(0, translatedCount - result.requests)
    stats.fetched += Math.min(translatedCount, Math.max(result.requests, 0))
    stats.upstream += result.requests
    if (!result.ok) {
      stats.errors += 1
      stats.lastError = result.error || 'translate failed'
    }
    if (result.requests) persist()

    return res.json({
      ok: result.ok,
      target,
      translations: result.translations,
      missing,
      skipped: result.skipped,
      requests: result.requests,
      error: result.error,
      stats: req.auth?.user ? stats : undefined,
    })
  })

  /** GET /api/translate?text=Save%20changes&target=km — the one-string door. */
  router.get('/api/translate', tenantMw, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!enabled) {
      return res.status(503).json({ ok: false, error: 'translation disabled on this server' })
    }
    const target = String(req.query.target || '').trim().toLowerCase()
    const text = sanitizeForTranslation(req.query.text)
    if (!TRANSLATE_LANGS.includes(target)) {
      return res.status(400).json({ ok: false, error: `unsupported target language: ${target || '(none)'}` })
    }
    if (!text) return res.json({ ok: true, text: '', translation: '', cached: false })
    if (limited(res, actorKey(req), req.auth?.user ? rateLimit : guestRateLimit)) return undefined

    stats.requests += 1
    stats.strings += 1
    stats.lastAt = new Date(now()).toISOString()

    const result = await translateBatch({ texts: [text], target, source, endpoint, fetchImpl, timeoutMs, cache, concurrency: 1 })
    const translation = result.translations[text] || ''
    if (result.requests) {
      stats.upstream += result.requests
      persist()
    }
    if (!result.ok) {
      stats.errors += 1
      stats.lastError = result.error || 'translate failed'
    }
    return res.json({
      ok: result.ok,
      text,
      target,
      translation,
      cached: result.requests === 0,
      error: result.error,
    })
  })

  return {
    router,
    stats,
    /** Test/ops hook: what the shared cache currently holds. */
    cacheSize: () => cache.size,
    clearCache: () => {
      cache.clear()
      persist()
    },
    publicStatus,
    /** Flush any pending cache write and drop the timer (shutdown + tests). */
    async close() {
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
        if (typeof saveCache === 'function') {
          try {
            const entries = Object.entries(cache.dump())
            saveCache(entries.length > PERSIST_MAX_ENTRIES
              ? Object.fromEntries(entries.slice(entries.length - PERSIST_MAX_ENTRIES))
              : Object.fromEntries(entries))
          } catch {
            /* a failing write on shutdown must not stop the exit */
          }
        }
      }
    },
  }
}
