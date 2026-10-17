// ─── Telegram client ─────────────────────────────────────────────────
// Browser-side calls to /api/telegram/config (Settings → Telegram bot &
// mini app). Two fields: the token is write-only — GET never returns it,
// only `hasToken` / `tokenSource` — while the Base URL comes back so the
// field can show what is stored (GET also reports the effective URL and
// whether it came from the tenant or the server environment). Same contract
// as the AI provider config. The tenant comes from the signed-in session,
// so no owner query param.

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

/** Read the tenant's bot config (never includes the token; includes the Base URL). */
export function tgGetConfig(fetchImpl) {
  return request('/api/telegram/config', { fetchImpl })
}

/**
 * Save the bot config. Takes a patch — `{ token }`, `{ publicUrl }`, or both
 * — and omits whatever was not passed, so saving the Base URL alone never
 * touches the stored token. An empty string clears that field (the token
 * falls back to the environment, the URL to the deployment's own address).
 * A bare string is accepted as `{ token }` for older callers.
 */
export function tgSaveConfig(patch, fetchImpl) {
  const body = typeof patch === 'string' ? { token: patch } : { ...(patch || {}) }
  return request('/api/telegram/config', { method: 'PUT', body, fetchImpl })
}
