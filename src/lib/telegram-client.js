// ─── Telegram client ─────────────────────────────────────────────────
// Browser-side calls to /api/telegram/config (Settings → Telegram bot &
// mini app). The token is write-only: GET never returns it, only
// `hasToken` / `tokenSource` — same contract as the AI provider config.
// The tenant comes from the signed-in session, so no owner query param.

async function request(path, { method = 'GET', body, fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch
  if (typeof f !== 'function') return { ok: false, error: 'fetch unavailable' }
  try {
    const res = await f(path, {
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

/** Read the tenant's bot config (never includes the token). */
export function tgGetConfig(fetchImpl) {
  return request('/api/telegram/config', { fetchImpl })
}

/** Save the bot token; an empty string removes it. */
export function tgSaveConfig(token, fetchImpl) {
  return request('/api/telegram/config', { method: 'PUT', body: { token: String(token ?? '') }, fetchImpl })
}
