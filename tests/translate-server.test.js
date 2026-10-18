// ─── Translation proxy (server/translate.js) ──────────────────────────
// The route the browser is allowed to call: Google's free endpoint has no
// CORS headers, so this same-origin door is the only way in — and because
// guests hit it from the QR menu, it has to be public, throttled, cached and
// incapable of throwing. `fetchImpl` is injected, so Google is never reached.
//
// No SQLite here on purpose: the durable cache is an injected hook, which
// keeps this suite independent of the native better-sqlite3 build.

import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createTranslateRouter } from '../server/translate.js'

const KM = {
  'Save changes': 'រក្សាទុកការផ្លាស់ប្តូរ',
  'Select all': 'ជ្រើសរើសទាំងអស់',
  'Primary reason': 'មូលហេតុចម្បង',
}
const ZH = {
  'Save changes': '保存更改',
  'Select all': '全选',
  'Primary reason': '主要原因',
}

/** A stub Google that answers either target and counts what it was asked. */
function googleStub() {
  const calls = []
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    const target = parsed.searchParams.get('tl')
    const lines = (parsed.searchParams.get('q') || '').split('\n')
    calls.push({ target, lines })
    const dict = target === 'zh-CN' ? ZH : KM
    const sentences = lines.map((line, index) => ({
      trans: (dict[line] || line) + (index < lines.length - 1 ? '\n' : ''),
      orig: line + (index < lines.length - 1 ? '\n' : ''),
    }))
    return { ok: true, status: 200, json: async () => ({ sentences }) }
  }
  return { fetchImpl, calls }
}

const booted = []

async function boot(options = {}) {
  const google = options.google || googleStub()
  const service = createTranslateRouter({ fetchImpl: google.fetchImpl, persistDelayMs: 5, ...options })
  const app = express()
  app.use(express.json())
  app.use(service.router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const instance = {
    service,
    google,
    base,
    post: (path, body) => fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (response) => ({ status: response.status, headers: response.headers, body: await response.json() })),
    get: (path) => fetch(base + path).then(async (response) => ({
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    })),
    close: async () => {
      await service.close()
      await new Promise((resolve) => server.close(resolve))
    },
  }
  booted.push(instance)
  return instance
}

after(async () => {
  while (booted.length) {
    const instance = booted.pop()
    await instance.close()
  }
})

test('status reports the provider without leaking upstream counters to guests', async () => {
  const api = await boot()
  const { status, body } = await api.get('/api/translate/status')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.enabled, true)
  assert.equal(body.provider, 'google-translate-free')
  assert.equal(body.source, 'en')
  assert.deepEqual(body.targets.map((entry) => entry.lang), ['km', 'zh'])
  assert.deepEqual(body.targets.map((entry) => entry.code), ['km', 'zh-CN'])
  // No session on this request ⇒ the guest view: throttles yes, stats no.
  assert.equal(body.guestRateLimit, 20)
  assert.equal(body.stats, undefined)
  assert.equal(body.rateLimit, undefined)
})

test('POST translates a batch in one upstream request and caches it', async () => {
  const api = await boot()
  const first = await api.post('/api/translate', { texts: ['Save changes', 'Select all'], target: 'km' })
  assert.equal(first.status, 200)
  assert.equal(first.body.ok, true)
  assert.equal(first.body.translations['Save changes'], KM['Save changes'])
  assert.equal(first.body.translations['Select all'], KM['Select all'])
  assert.equal(api.google.calls.length, 1)
  assert.deepEqual(api.google.calls[0].lines, ['Save changes', 'Select all'])

  // The second terminal asking for the same copy never reaches Google.
  const second = await api.post('/api/translate', { texts: ['Save changes', 'Select all'], target: 'km' })
  assert.equal(second.body.translations['Save changes'], KM['Save changes'])
  assert.equal(api.google.calls.length, 1, 'cache hit must not call upstream again')

  // A different target language is a different cache namespace.
  const chinese = await api.post('/api/translate', { texts: ['Save changes'], target: 'zh' })
  assert.equal(chinese.body.translations['Save changes'], ZH['Save changes'])
  assert.equal(api.google.calls.length, 2)
  assert.equal(api.google.calls[1].target, 'zh-CN')
})

test('POST skips machine tokens and refuses an unknown target', async () => {
  const api = await boot()
  const skipped = await api.post('/api/translate', { texts: ['SKU-1024', '/help', 'Oct 18', ''], target: 'km' })
  assert.equal(skipped.status, 200)
  assert.deepEqual(skipped.body.translations, {})
  assert.equal(api.google.calls.length, 0, 'nothing worth translating, nothing sent')

  const badTarget = await api.post('/api/translate', { texts: ['Save changes'], target: 'fr' })
  assert.equal(badTarget.status, 400)
  assert.match(badTarget.body.error, /unsupported target/)

  const noTexts = await api.post('/api/translate', { target: 'km' })
  assert.equal(noTexts.status, 200)
  assert.deepEqual(noTexts.body.translations, {})
})

test('POST caps the batch at maxTexts instead of forwarding everything', async () => {
  const api = await boot({ maxTexts: 3 })
  const texts = ['Save changes', 'Select all', 'Primary reason', 'Branch transfer to another building']
  const response = await api.post('/api/translate', { texts, target: 'km' })
  assert.equal(response.status, 200)
  const asked = api.google.calls.flatMap((call) => call.lines)
  assert.equal(asked.length, 3)
  assert.deepEqual(asked, texts.slice(0, 3))
})

test('GET translates one string and reports whether it came from cache', async () => {
  const api = await boot()
  const first = await api.get('/api/translate?text=Primary%20reason&target=km')
  assert.equal(first.status, 200)
  assert.equal(first.body.ok, true)
  assert.equal(first.body.translation, KM['Primary reason'])
  assert.equal(first.body.cached, false)

  const second = await api.get('/api/translate?text=Primary%20reason&target=km')
  assert.equal(second.body.translation, KM['Primary reason'])
  assert.equal(second.body.cached, true)

  const missing = await api.get('/api/translate?text=Save%20changes')
  assert.equal(missing.status, 400, 'no target means no guess')
})

test('guests are throttled per IP and told how long to wait', async () => {
  const api = await boot({ guestRateLimit: 2, rateWindowMs: 60000 })
  const one = await api.post('/api/translate', { texts: ['Save changes'], target: 'km' })
  const two = await api.post('/api/translate', { texts: ['Select all'], target: 'km' })
  const three = await api.post('/api/translate', { texts: ['Primary reason'], target: 'km' })
  assert.equal(one.status, 200)
  assert.equal(two.status, 200)
  assert.equal(three.status, 429)
  assert.match(three.body.error, /slow down/i)
  assert.ok(Number(three.headers.get('retry-after')) >= 1)
  assert.equal(api.service.stats.limited, 1)
})

test('an upstream refusal answers 200 with ok:false — never a 500', async () => {
  const api = await boot({
    google: { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }), calls: [] },
  })
  const response = await api.post('/api/translate', { texts: ['Save changes'], target: 'km' })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, false)
  assert.match(response.body.error, /429/)
  assert.deepEqual(response.body.missing, ['Save changes'])
  assert.equal(api.service.stats.errors, 1)
})

test('a throwing fetch (no route to Google) is answered, not crashed', async () => {
  const api = await boot({
    google: { fetchImpl: async () => { throw new TypeError('Failed to fetch') }, calls: [] },
  })
  const response = await api.post('/api/translate', { texts: ['Save changes'], target: 'km' })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, false)
  assert.match(response.body.error, /Failed to fetch/)
  assert.deepEqual(response.body.translations, {})
})

test('TRANSLATE_ENABLED=false turns every route into a 503 no-op', async () => {
  const api = await boot({ enabled: false })
  const posted = await api.post('/api/translate', { texts: ['Save changes'], target: 'km' })
  assert.equal(posted.status, 503)
  assert.match(posted.body.error, /disabled/)
  const got = await api.get('/api/translate?text=Save%20changes&target=km')
  assert.equal(got.status, 503)
  assert.equal(api.google.calls.length, 0)
  // Status still answers, so the UI can say "off on this server" instead of
  // silently never translating.
  const status = await api.get('/api/translate/status')
  assert.equal(status.body.enabled, false)
})

test('the durable cache rehydrates at boot and is written back on change', async () => {
  const stored = { 'km\u0000Select all': KM['Select all'] }
  let saved = null
  const api = await boot({
    loadCache: () => stored,
    saveCache: (entries) => { saved = entries },
    persistDelayMs: 5,
  })

  // Seeded at boot ⇒ a hit that never touches Google.
  const seeded = await api.post('/api/translate', { texts: ['Select all'], target: 'km' })
  assert.equal(seeded.body.translations['Select all'], KM['Select all'])
  assert.equal(api.google.calls.length, 0)

  // A new answer schedules the write-back.
  await api.post('/api/translate', { texts: ['Save changes'], target: 'km' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(saved, 'saveCache should have been called')
  assert.equal(saved['km\u0000Save changes'], KM['Save changes'])
  assert.equal(saved['km\u0000Select all'], KM['Select all'])
})

test('a corrupt stored cache is ignored, not fatal', async () => {
  const api = await boot({ loadCache: () => 'not-an-object' })
  const status = await api.get('/api/translate/status')
  assert.equal(status.status, 200)
  assert.equal(status.body.cache.entries, 0)
})
