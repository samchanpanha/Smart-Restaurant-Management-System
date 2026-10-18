// ─── Dev translation API (the Vite middleware fallback) ────────────────
// `npm run dev` answers /api/translate itself when the Express backend is not
// listening, so the browser client has one contract in both hosts. This drives
// the real Vite middleware with mock req/res objects — no port, no jsdom — and
// pins the parts that are easy to break silently: `target` arrives in the POST
// *body* (reading only the query string 400s every real request), unsupported
// targets are rejected, and an unreachable upstream degrades to `ok:false`
// with the strings listed as missing instead of throwing.
//
// Run just this file with: node --test tests/translate-dev-api.test.js

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { Readable } from 'node:stream'
import { createServer } from 'vite'

let server = null

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  })
})

after(async () => {
  await server?.close()
})

/** Push a request through Vite's middleware stack and capture the response. */
function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const req = new Readable({ read() {} })
    req.method = method
    req.url = url
    req.headers = { 'content-type': 'application/json' }

    const timeout = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 20000)
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value },
      getHeader(name) { return this.headers[name.toLowerCase()] },
      write() {},
      end(payload) {
        clearTimeout(timeout)
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: payload ? String(payload) : '',
          json() { return JSON.parse(this.body || '{}') },
        })
      },
    }

    server.middlewares(req, res, () => {
      clearTimeout(timeout)
      reject(new Error(`no middleware handled ${method} ${url}`))
    })

    if (body !== undefined) req.push(typeof body === 'string' ? body : JSON.stringify(body))
    req.push(null)
  })
}

test('status reports the free Google provider and the two machine targets', async () => {
  const res = await call('GET', '/api/translate/status')
  assert.equal(res.status, 200)
  const payload = res.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.provider, 'google-translate-free')
  assert.equal(payload.source, 'en')
  const codes = payload.targets.map((entry) => entry.code)
  assert.deepEqual(codes.sort(), ['km', 'zh-CN'])
})

test('POST reads the target from the body, the way the browser client sends it', async () => {
  // Regression: the dev handler used to read `target` only from the query
  // string, so every client request came back
  // "unsupported target language: (none)" and dev was silently dictionary-only.
  const res = await call('POST', '/api/translate', { texts: ['Mark served', 'Bump the app'], target: 'km' })
  assert.equal(res.status, 200)
  const payload = res.json()
  assert.equal(payload.target, 'km')
  assert.ok(Array.isArray(payload.translations ? Object.keys(payload.translations) : []))
  assert.ok('missing' in payload, 'the batch shape must report which strings are still missing')
  assert.equal(payload.requests >= 0, true)
})

test('GET still accepts ?text=&target= for one-string lookups', async () => {
  const res = await call('GET', '/api/translate?text=Save%20changes&target=zh')
  assert.equal(res.status, 200)
  const payload = res.json()
  assert.equal(payload.target, 'zh')
  assert.equal(payload.text, 'Save changes')
})

test('an unsupported target is rejected with 400', async () => {
  const res = await call('POST', '/api/translate', { texts: ['Save changes'], target: 'fr' })
  assert.equal(res.status, 400)
  assert.equal(res.json().ok, false)
})

test('a missing target is rejected with 400, not treated as English', async () => {
  const res = await call('POST', '/api/translate', { texts: ['Save changes'] })
  assert.equal(res.status, 400)
  assert.match(res.json().error, /unsupported target language/)
})

test('a malformed body is rejected with 400', async () => {
  const res = await call('POST', '/api/translate?target=km', '{not json')
  assert.equal(res.status, 400)
  assert.equal(res.json().ok, false)
})

test('an unreachable upstream degrades to ok:false and lists the misses', async () => {
  // No sandbox here can reach translate.googleapis.com; the point is that the
  // client gets a usable answer (200 + missing[]) rather than a thrown 500, so
  // the dictionary layer keeps working and the cooldown kicks in once.
  const res = await call('POST', '/api/translate', { texts: ['Comp the mezze platter'], target: 'km' })
  assert.equal(res.status, 200)
  const payload = res.json()
  if (payload.ok) return // a real backend with network access answered
  assert.equal(payload.ok, false)
  assert.ok(payload.error, 'a failed batch must say why')
  assert.deepEqual(payload.missing, ['Comp the mezze platter'])
})

test('empty and non-string payloads short-circuit without an upstream call', async () => {
  const res = await call('POST', '/api/translate', { texts: [], target: 'km' })
  assert.equal(res.status, 200)
  const payload = res.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.requests, 0)

  const junk = await call('POST', '/api/translate', { texts: [42, null, ''], target: 'km' })
  assert.equal(junk.status, 200)
  assert.equal(junk.json().requests, 0)
})
