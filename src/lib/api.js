// ─── API transport ──────────────────────────────────────────────────
// One place that knows how this app talks to its own API:
//
//   1. the session is a cookie *and* a bearer token. The cookie is the normal
//      path (HttpOnly, so JS never sees it). The token is the fallback for
//      every context where a cookie is not sent back — the workspace embedded
//      in an iframe, a browser with third-party cookies blocked, or a
//      deployment that forces Secure cookies over http. Without it those
//      terminals looked signed in while every owner-only screen answered
//      "sign in required";
//   2. a 401 from any /api route means the session is gone, so the app is told
//      once (an event) and it can show the sign-in screen instead of leaving
//      each screen to fail on its own.
//
// `installApiTransport()` wraps the global fetch once, so the ~40 call sites
// across the app keep working untouched. It only rewrites same-origin /api
// requests; anything else (a CDN, a photo, a test double) passes straight
// through.

const TOKEN_KEY = 'restora-session-token'
const UNAUTHORIZED_EVENT = 'restora:unauthorized'
// A second home for the token, in a cookie the page can read. Where storage is
// unavailable or isolated — a workspace embedded in a cross-site frame, private
// mode, a sandboxed iframe — localStorage silently keeps nothing, and the next
// page load has no session at all while the cookie still rides along. The
// server's own cookie stays the primary path; this is the belt to the bearer
// token's braces, and it is what the SSE stream needs in that context.
const TOKEN_COOKIE = 'restora_client_token'
const TOKEN_MAX_AGE = 60 * 60 * 24 * 7

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Safari in private mode throws on access.
    return null
  }
}

function storedToken() {
  const store = storage()
  if (!store) return null
  try {
    return store.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

function cookieToken() {
  try {
    if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null
    const hit = document.cookie.split('; ').find((entry) => entry.startsWith(`${TOKEN_COOKIE}=`))
    if (!hit) return null
    const raw = hit.slice(TOKEN_COOKIE.length + 1)
    return decodeURIComponent(raw) || null
  } catch {
    return null
  }
}

function writeCookieToken(value) {
  try {
    if (typeof document === 'undefined' || typeof document.cookie !== 'string') return
    const https = typeof location !== 'undefined' && location.protocol === 'https:'
    // Same rules as the server's own cookie: over https a frame is a third
    // party, so `SameSite=None; Secure` (partitioned, like the server's) is the
    // only shape a browser in an embedded workspace will keep.
    const sameSite = https ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'
    const age = value ? `Max-Age=${TOKEN_MAX_AGE}` : 'Max-Age=0'
    document.cookie = `${TOKEN_COOKIE}=${value ? encodeURIComponent(value) : ''}; Path=/; ${sameSite}; ${age}`
  } catch {
    /* a document that refuses cookies (sandboxed frame) keeps the token in memory */
  }
}

let token = null
let loaded = false

function load() {
  if (loaded) return token
  loaded = true
  token = storedToken() || cookieToken()
  return token
}

/** The stored bearer token, or null when the session lives only in a cookie. */
export function getSessionToken() {
  return load()
}

/** Remember the token handed out by /api/auth/login or /api/auth/register. */
export function setSessionToken(next) {
  token = next ? String(next) : null
  loaded = true
  const store = storage()
  try {
    if (store) {
      if (token) store.setItem(TOKEN_KEY, token)
      else store.removeItem(TOKEN_KEY)
    }
  } catch {
    /* private mode: the token still works for this page's lifetime */
  }
  writeCookieToken(token)
  return token
}

export function clearSessionToken() {
  return setSessionToken(null)
}

/** True for a request this app should carry the session on. */
export function isApiUrl(input) {
  let raw = ''
  if (typeof input === 'string') raw = input
  else if (input && typeof input.url === 'string') raw = input.url
  else return false
  if (raw.startsWith('/api/')) return true
  try {
    const base = typeof location === 'undefined' ? 'http://localhost' : location.origin
    const url = new URL(raw, base)
    return url.origin === new URL(base).origin && url.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/**
 * The sign-in routes. A 401 from one of these is an answer, not a dead
 * session: /api/auth/me is how the app *detects* that the session ended, so
 * announcing "unauthorized" for it would re-trigger the very check that is
 * running — an endless loop. Only other /api routes raise the event.
 */
function isAuthRoute(input) {
  if (!isApiUrl(input)) return false
  const raw = typeof input === 'string' ? input : input.url
  try {
    const base = typeof location === 'undefined' ? 'http://localhost' : location.origin
    return new URL(raw, base).pathname.startsWith('/api/auth/')
  } catch {
    return raw.includes('/api/auth/')
  }
}

/** Headers for an API call: the caller's own, plus the bearer token. */
export function sessionHeaders(headers) {
  const next = new Headers(headers || undefined)
  const current = load()
  if (current && !next.has('Authorization')) next.set('Authorization', `Bearer ${current}`)
  return next
}

/** Same-origin `/api` URL with the token appended, for EventSource. */
export function withSessionToken(url) {
  const current = load()
  if (!current) return url
  try {
    const base = typeof location === 'undefined' ? 'http://localhost' : location.origin
    const parsed = new URL(url, base)
    if (parsed.searchParams.has('token')) return url
    parsed.searchParams.set('token', current)
    // Keep a relative URL relative so a dev proxy keeps working.
    return url.startsWith('/') ? `${parsed.pathname}${parsed.search}` : parsed.toString()
  } catch {
    return url
  }
}

/**
 * fetch that always carries the session. Use this in new code; existing call
 * sites are covered by installApiTransport().
 */
export async function apiFetch(input, init = {}) {
  const options = { credentials: 'same-origin', ...init }
  if (isApiUrl(input)) options.headers = sessionHeaders(options.headers)
  const res = await fetch(input, options)
  if (res.status === 401 && !isAuthRoute(input)) notifyUnauthorized()
  return res
}

function notifyUnauthorized() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  if (typeof CustomEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { at: Date.now() } }))
}

/** Subscribe to "the session is gone". Returns an unsubscribe function. */
export function onUnauthorized(handler) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  const wrapped = () => handler()
  window.addEventListener(UNAUTHORIZED_EVENT, wrapped)
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, wrapped)
}

let installed = false

/**
 * Route every same-origin /api request through apiFetch exactly once. Safe to
 * call from any entry point, and a no-op where there is no window (tests,
 * SSR) — those use apiFetch or their own fetch double directly.
 */
export function installApiTransport(target = typeof window === 'undefined' ? null : window) {
  if (installed || !target || typeof target.fetch !== 'function') return false
  const original = target.fetch.bind(target)
  target.fetch = (input, init) => {
    if (!isApiUrl(input)) return original(input, init)
    const options = { credentials: 'same-origin', ...(init || {}) }
    options.headers = sessionHeaders(options.headers)
    return original(input, options).then((res) => {
      if (res && res.status === 401 && !isAuthRoute(input)) notifyUnauthorized()
      return res
    })
  }
  installed = true
  return true
}

export const SESSION_TOKEN_KEY = TOKEN_KEY
export const UNAUTHORIZED = UNAUTHORIZED_EVENT
