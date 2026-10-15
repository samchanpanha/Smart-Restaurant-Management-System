import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

// ─── Session transport ───────────────────────────────────────────────
// The front half of the "sign in required" bug: a terminal that looked
// signed in but whose cookie was never sent back. src/lib/api.js keeps the
// session token handed out at sign-in and puts it on every /api request, and
// turns a 401 into one event the app can act on instead of leaving each
// screen to fail alone. No server here — just the module and a double.

// A tiny window/localStorage double, then the module under test.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
const events = []
const listeners = new Map()
globalThis.window = {
  location: { origin: 'https://restora.test' },
  dispatchEvent: (event) => {
    events.push(event)
    for (const fn of listeners.get(event.type) || []) fn(event)
    return true
  },
  addEventListener: (name, fn) => { listeners.set(name, [...(listeners.get(name) || []), fn]) },
  removeEventListener: (name, fn) => { listeners.set(name, (listeners.get(name) || []).filter((f) => f !== fn)) },
}
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
globalThis.location = globalThis.window.location
globalThis.Headers = Headers

const api = await import('../src/lib/api.js')

test('the token is remembered across calls and cleared on sign out', () => {
  assert.equal(api.getSessionToken(), null)
  api.setSessionToken('tok-1')
  assert.equal(api.getSessionToken(), 'tok-1')
  assert.equal(localStorage.getItem(api.SESSION_TOKEN_KEY), 'tok-1')
  api.clearSessionToken()
  assert.equal(api.getSessionToken(), null)
  assert.equal(localStorage.getItem(api.SESSION_TOKEN_KEY), null)

  // A token saved by an earlier page load is picked up again.
  api.setSessionToken('tok-2')
})

test('api calls carry the bearer token, other requests are left alone', () => {
  assert.equal(api.isApiUrl('/api/users'), true)
  assert.equal(api.isApiUrl('https://restora.test/api/users'), true)
  assert.equal(api.isApiUrl('https://cdn.test/photo.png'), false)
  assert.equal(api.isApiUrl('https://other.test/api/users'), false)
  assert.equal(api.isApiUrl('/fonts/inter-latin-wght-normal.woff2'), false)

  const headers = api.sessionHeaders({ 'Content-Type': 'application/json' })
  assert.equal(headers.get('Authorization'), 'Bearer tok-2')
  assert.equal(headers.get('Content-Type'), 'application/json')
  // A caller that sets its own Authorization wins.
  assert.equal(api.sessionHeaders({ Authorization: 'Bearer mine' }).get('Authorization'), 'Bearer mine')
})

test('EventSource urls get the token appended only when one is held', () => {
  assert.equal(api.withSessionToken('/api/events?since=3'), '/api/events?since=3&token=tok-2')
  assert.equal(api.withSessionToken('/api/events'), '/api/events?token=tok-2')
  // Idempotent.
  assert.equal(api.withSessionToken('/api/events?token=tok-2'), '/api/events?token=tok-2')
  api.clearSessionToken()
  assert.equal(api.withSessionToken('/api/events'), '/api/events')
  api.setSessionToken('tok-2')
})

test('the installed transport upgrades every same-origin /api request', async () => {
  const seen = []
  const realFetch = async (input, init = {}) => {
    seen.push({ input, auth: new Headers(init.headers || {}).get('Authorization'), credentials: init.credentials })
    return { status: input === '/api/users' ? 200 : 200 }
  }
  globalThis.window.fetch = realFetch
  globalThis.fetch = realFetch
  assert.equal(api.installApiTransport(globalThis.window), true)
  assert.equal(api.installApiTransport(globalThis.window), false, 'installing twice is a no-op')

  await window.fetch('/api/users')
  await window.fetch('https://cdn.test/x.png')
  assert.equal(seen[0].auth, 'Bearer tok-2')
  assert.equal(seen[0].credentials, 'same-origin')
  assert.equal(seen[1].auth, null, 'a third-party URL is untouched')
})

test('a 401 tells the app to re-check the session', async () => {
  let handled = 0
  const off = api.onUnauthorized(() => { handled += 1 })
  const deny = async () => ({ status: 401 })
  window.fetch = deny
  globalThis.fetch = deny
  await api.apiFetch('/api/users')
  assert.equal(handled, 1, 'the unauthorized event fired')
  assert.ok(events.some((event) => event.type === api.UNAUTHORIZED))
  off()
})

test('no screen calls the API without the session transport', () => {
  // A raw `fetch('/api/...')` would skip the bearer fallback and bring the
  // original bug back, so the only allowed callers are the transport itself
  // and the AI client (whose default is apiFetch).
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (/\.(js|jsx)$/.test(rel) && !rel.endsWith('src/lib/api.js')) {
        const source = fs.readFileSync(path.join(root, rel), 'utf8')
        for (const line of source.split('\n')) {
          if (/\bfetch\(/.test(line) && !/apiFetch\(/.test(line) && !/fetchImpl/.test(line) && !/^\s*\*|^\s*\/\//.test(line)) {
            offenders.push(`${rel}: ${line.trim()}`)
          }
        }
      }
    }
  }
  walk('src')
  assert.deepEqual(offenders, [], 'every /api call goes through apiFetch (or the installed transport)')
})
