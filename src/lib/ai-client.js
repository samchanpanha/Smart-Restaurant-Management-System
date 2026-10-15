// ─── AI client ───────────────────────────────────────────────────────
// Browser-side calls to /api/ai/*. Public guest surfaces carry ?owner=<slug>
// (same rule the store uses), so every helper appends it when present.
//
// Insights/briefings are cached client-side by (kind, lang, loc, owner) for
// a short window — the same context produces the same answer, and model
// calls cost money. Chat is never cached.

const INSIGHT_TTL_MS = 60_000
const insightCache = new Map()

function ownerParam() {
  try {
    return new URLSearchParams(window.location.search).get('owner') || ''
  } catch {
    return ''
  }
}

function withOwner(path, params = {}) {
  const search = new URLSearchParams(params)
  const owner = ownerParam()
  if (owner) search.set('owner', owner)
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

async function post(path, body, fetchImpl) {
  const f = fetchImpl || globalThis.fetch
  if (typeof f !== 'function') return { ok: false, error: 'fetch unavailable' }
  try {
    const res = await f(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error || `HTTP ${res.status}`, status: res.status }
    return json
  } catch (err) {
    return { ok: false, error: err?.message || 'request failed' }
  }
}

/** Is AI configured on this server? Never throws. */
export async function aiStatus(fetchImpl) {
  const f = fetchImpl || globalThis.fetch
  if (typeof f !== 'function') return { configured: false }
  try {
    const res = await f(withOwner('/api/ai/status'))
    if (!res.ok) return { configured: false }
    return await res.json()
  } catch {
    return { configured: false }
  }
}

/** Ask a question. `history` is prior { role, content } turns (optional). */
export function aiChat({ question, history = [], lang = 'en', scope = 'ops', locId = null, fetchImpl } = {}) {
  return post(withOwner('/api/ai/chat'), { question, messages: history, lang, scope, locId }, fetchImpl)
}

/** A cached insight: kind is one of alert | menu | reorder | forecast. */
export async function aiInsight({ kind = 'alert', lang = 'en', scope = 'ops', locId = null, fetchImpl } = {}) {
  const key = `${scope}:${kind}:${lang}:${locId || ''}:${ownerParam()}`
  const hit = insightCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < INSIGHT_TTL_MS) return { ...hit.value, cached: true }
  const value = await post(withOwner('/api/ai/insight'), { kind, lang, scope, locId }, fetchImpl)
  if (value?.ok) insightCache.set(key, { value, at: now })
  return value
}

/** Shift briefing. `deliver` pushes it through the server's Telegram hook. */
export function aiBriefing({ phase = 'open', lang = 'en', locId = null, deliver = false, fetchImpl } = {}) {
  return post(withOwner('/api/ai/briefing'), { phase, lang, locId, deliver }, fetchImpl)
}

// ─── Provider config (owner/admin only) ──────────────────────────────
// The key is write-only: GET never returns it, only `hasKey`/`keySource`.

async function request(path, { method = 'GET', body, fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch
  if (typeof f !== 'function') return { ok: false, error: 'fetch unavailable' }
  try {
    const res = await f(withOwner(path), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ...json, ok: false, status: res.status }
    return { ...json, ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'request failed' }
  }
}

/** Read the tenant's AI provider config (never includes the key). */
export function aiGetConfig(fetchImpl) {
  return request('/api/ai/config', { fetchImpl })
}

/** Save provider/model/baseUrl and (optionally) a new apiKey. */
export function aiSaveConfig(payload, fetchImpl) {
  return request('/api/ai/config', { method: 'PUT', body: payload, fetchImpl })
}

/** Try a provider config without saving it first. */
export function aiTestConfig(payload, fetchImpl) {
  return request('/api/ai/config/test', { method: 'POST', body: payload || {}, fetchImpl })
}
