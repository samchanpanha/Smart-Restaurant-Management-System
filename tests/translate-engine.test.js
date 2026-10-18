// ─── Google Translate engine (pure) ───────────────────────────────────
// The free endpoint cannot be reached from CI (and must never be reached by
// accident in a test), so every case here injects `fetchImpl`. What is under
// test is the part that is easy to get wrong and expensive when it is wrong:
// which strings we bother to send, how a batch is chunked, how either Google
// response shape is parsed, and — above all — that a misaligned batch is
// repaired by bisection instead of labelling one string with another's
// translation.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alignTranslations,
  buildTranslateUrl,
  chunkTexts,
  createTranslationCache,
  isTranslatable,
  parseTranslatePayload,
  sanitizeForTranslation,
  translateBatch,
  translateTargetCode,
} from '../src/lib/translate-engine.js'

/**
 * A stub Google answering the `dj=1` shape. Three real-world behaviours:
 *   default   — one sentence per line, separator kept (the common case);
 *   dropLines — separator lost, but each segment still carries its `orig`;
 *   misalign  — everything collapsed into one segment with no usable `orig`,
 *               i.e. the shape that must trigger bisection.
 */
function googleStub(map, { failStatus = 0, misalign = false, dropLines = false } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    const query = parsed.searchParams.get('q') || ''
    calls.push(query)
    if (failStatus) return { ok: false, status: failStatus, json: async () => ({}) }
    const lines = query.split('\n')
    let sentences
    if (misalign) {
      sentences = [{ trans: lines.map((line) => map[line] || line).join(' '), orig: '' }]
    } else if (dropLines) {
      sentences = lines.map((line) => ({ trans: map[line] || line, orig: line }))
    } else {
      sentences = lines.map((line, index) => ({
        trans: (map[line] || line) + (index < lines.length - 1 ? '\n' : ''),
        orig: line + (index < lines.length - 1 ? '\n' : ''),
      }))
    }
    return { ok: true, status: 200, json: async () => ({ sentences }) }
  }
  return { fetchImpl, calls }
}

const KM = {
  'Save changes': 'រក្សាទុកការផ្លាស់ប្តូរ',
  'Move items': 'ផ្លាស់ទីមុខទំនិញ',
  'Select all': 'ជ្រើសរើសទាំងអស់',
  'Payment & Tender Mix': 'ការបង់ប្រាក់ និងវិធីបង់ប្រាក់',
  'Primary reason': 'មូលហេតុចម្បង',
  'Branch transfer': 'ការផ្លាស់ប្តូរសាខា',
}

test('isTranslatable sends copy and skips data', () => {
  // Real UI copy.
  for (const text of ['Save changes', 'Select all', 'Payment & Tender Mix', 'Most recent log', 'Needs attention']) {
    assert.equal(isTranslatable(text), true, `should translate: ${text}`)
  }
  // Numbers, money, dates, codes, commands, identifiers, acronyms.
  for (const text of [
    '', ' ', '8', '$16.86', '4.10%', '10 × 4', 'Oct 18', 'Oct 18, 06:07 AM',
    'SKU-1024', '/help', 'true', 'TUE THU SAT', 'EIN 91-2201843',
    'Telegram.WebApp.ready()', 'primemeats.example', '· acct PM-4471', 'QR', 'AI',
    '—', '→', '12–24',
  ]) {
    assert.equal(isTranslatable(text), false, `should skip: ${JSON.stringify(text)}`)
  }
  // Copy already written in a target script never goes back through Google.
  assert.equal(isTranslatable('រក្សាទុក'), false)
  assert.equal(isTranslatable('保存更改'), false)
  // Over-long blobs are refused rather than truncated.
  assert.equal(isTranslatable('word '.repeat(200)), false)
  assert.equal(isTranslatable(null), false)
  assert.equal(isTranslatable(42), false)
})

test('sanitizeForTranslation keeps the newline separator unambiguous', () => {
  assert.equal(sanitizeForTranslation('Save\r\nchanges'), 'Save changes')
  assert.equal(sanitizeForTranslation('  Save   changes  '), 'Save changes')
  assert.equal(sanitizeForTranslation('Tab\there'), 'Tab here')
})

test('chunkTexts respects both the item and the character budget', () => {
  const items = Array.from({ length: 10 }, (_, index) => `Item number ${index}`)
  assert.equal(chunkTexts(items, { maxItems: 4, maxChars: 100000 }).length, 3)
  assert.equal(chunkTexts(items, { maxItems: 100, maxChars: 40 }).length, 5)
  // A single over-budget string still travels alone instead of being dropped.
  const long = ['x'.repeat(200)]
  assert.deepEqual(chunkTexts(long, { maxItems: 24, maxChars: 50 }), [long])
  assert.deepEqual(chunkTexts([]), [])
  assert.deepEqual(chunkTexts(['', '   ']), [])
})

test('buildTranslateUrl targets the free endpoint with Google language codes', () => {
  const url = new URL(buildTranslateUrl({ texts: ['Save changes', 'Select all'], target: 'zh' }))
  assert.equal(url.origin + url.pathname, 'https://translate.googleapis.com/translate_a/single')
  assert.equal(url.searchParams.get('client'), 'gtx')
  assert.equal(url.searchParams.get('sl'), 'en')
  assert.equal(url.searchParams.get('tl'), 'zh-CN')
  assert.equal(url.searchParams.get('dt'), 't')
  assert.equal(url.searchParams.get('q'), 'Save changes\nSelect all')
  assert.equal(translateTargetCode('km'), 'km')
  assert.equal(translateTargetCode('zh'), 'zh-CN')
  assert.equal(translateTargetCode('en'), 'en')
})

test('parseTranslatePayload reads both Google response shapes', () => {
  // dj=1 → { sentences: [{ trans }] }
  assert.equal(parseTranslatePayload({ sentences: [{ trans: 'abc' }, { trans: '\ndef' }] }), 'abc\ndef')
  // classic → [[[trans, orig, null, null, 10]], null, 'en']
  assert.equal(
    parseTranslatePayload([[['abc', 'abc', null, null, 10], ['\ndef', 'def', null, null, 10]], null, 'en']),
    'abc\ndef',
  )
  assert.equal(parseTranslatePayload(null), '')
  assert.equal(parseTranslatePayload({}), '')
})

test('alignTranslations refuses a pairing it cannot trust', () => {
  assert.deepEqual(alignTranslations(['a', 'b'], 'A\nB'), ['A', 'B'])
  // A trailing newline from Google is trimmed, not counted as an item.
  assert.deepEqual(alignTranslations(['a', 'b'], 'A\nB\n'), ['A', 'B'])
  // Two lines merged into one: null, so the caller bisects instead of
  // labelling "Delete" with "Save".
  assert.equal(alignTranslations(['a', 'b'], 'A B'), null)
  // An echo-back segment means "no translation" for that item.
  assert.deepEqual(alignTranslations(['a', 'b'], 'A\nb'), ['A', ''])
  assert.equal(alignTranslations(['a'], ''), null)
})

test('translateBatch answers from cache without touching the network', async () => {
  const cache = createTranslationCache({ max: 10 })
  cache.set('km', 'Select all', KM['Select all'])
  const { fetchImpl, calls } = googleStub(KM)

  const result = await translateBatch({ texts: ['Select all'], target: 'km', fetchImpl, cache })
  assert.equal(result.ok, true)
  assert.equal(result.requests, 0)
  assert.deepEqual(calls, [])
  assert.equal(result.translations['Select all'], KM['Select all'])
})

test('translateBatch batches, caches and reports what Google could not answer', async () => {
  const cache = createTranslationCache({ max: 100 })
  const { fetchImpl, calls } = googleStub(KM)

  const result = await translateBatch({
    texts: ['Save changes', 'Move items', 'Save changes', 'SKU-1024', ''],
    target: 'km',
    fetchImpl,
    cache,
  })

  assert.equal(result.ok, true)
  assert.equal(calls.length, 1, 'one request for the whole batch')
  assert.equal(calls[0], 'Save changes\nMove items')
  assert.equal(result.translations['Save changes'], KM['Save changes'])
  assert.equal(result.translations['Move items'], KM['Move items'])
  // Duplicates collapse; machine tokens are skipped, never sent.
  assert.deepEqual(result.skipped, ['SKU-1024'])
  // Both answers are now cached for the next sweep / next terminal reload.
  assert.equal(cache.get('km', 'Save changes'), KM['Save changes'])
  assert.equal(result.requests, 1)

  const second = await translateBatch({ texts: ['Save changes'], target: 'km', fetchImpl, cache })
  assert.equal(second.requests, 0)
  assert.equal(calls.length, 1, 'a cached string never reaches Google again')
})

test('translateBatch re-pairs by segment origin when Google drops the newlines', async () => {
  const { fetchImpl, calls } = googleStub(KM, { dropLines: true })
  const result = await translateBatch({
    texts: ['Save changes', 'Select all', 'Primary reason'],
    target: 'km',
    fetchImpl,
  })
  assert.equal(calls.length, 1, 're-pairing must not cost extra requests')
  assert.equal(result.ok, true)
  assert.equal(result.translations['Save changes'], KM['Save changes'])
  assert.equal(result.translations['Select all'], KM['Select all'])
  assert.equal(result.translations['Primary reason'], KM['Primary reason'])
})

test('translateBatch splits a misaligned batch instead of mislabelling strings', async () => {
  const { fetchImpl, calls } = googleStub(KM, { misalign: true })
  const result = await translateBatch({
    texts: ['Save changes', 'Select all', 'Move items', 'Primary reason'],
    target: 'km',
    fetchImpl,
  })

  // Bisection walks down to single strings, where alignment is unambiguous.
  assert.ok(calls.length > 1, `expected bisection, got ${calls.length} request(s)`)
  assert.equal(result.translations['Save changes'], KM['Save changes'])
  assert.equal(result.translations['Select all'], KM['Select all'])
  assert.equal(result.translations['Primary reason'], KM['Primary reason'])
  // Nothing was ever paired with another string's translation.
  for (const [source, value] of Object.entries(result.translations)) {
    assert.equal(value, KM[source], `${source} must translate to its own value`)
  }
})

test('translateBatch keeps working when Google refuses', async () => {
  const { fetchImpl } = googleStub(KM, { failStatus: 429 })
  const result = await translateBatch({ texts: ['Save changes'], target: 'km', fetchImpl })
  assert.equal(result.ok, false)
  assert.match(result.error, /429/)
  assert.deepEqual(result.translations, {})
  assert.deepEqual(result.missing, ['Save changes'])
})

test('translateBatch survives a throwing fetch (no server, no network)', async () => {
  const result = await translateBatch({
    texts: ['Save changes'],
    target: 'km',
    fetchImpl: async () => { throw new TypeError('Failed to fetch') },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /Failed to fetch/)
  assert.deepEqual(result.missing, ['Save changes'])
})

test('translateBatch refuses an unsupported target and a missing fetch', async () => {
  const refused = await translateBatch({ texts: ['Save changes'], target: 'fr' })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /unsupported target/)

  const noFetch = await translateBatch({ texts: ['Save changes'], target: 'km', fetchImpl: null })
  assert.equal(noFetch.ok, false)
  assert.match(noFetch.error, /no fetch/)
})

test('translateBatch honours an outer abort (language switch mid-flight)', async () => {
  const controller = new AbortController()
  const result = await translateBatch({
    texts: ['Save changes'],
    target: 'km',
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      controller.abort()
      options.signal.throwIfAborted()
      return { ok: true, json: async () => ({ sentences: [] }) }
    },
  })
  assert.equal(result.ok, false)
})

test('the cache is an LRU that can be persisted and rehydrated', () => {
  let clock = 1000
  const cache = createTranslationCache({ max: 2, ttlMs: 500, now: () => clock })
  cache.set('km', 'a', 'A')
  cache.set('km', 'b', 'B')
  // Touching 'a' makes 'b' the eviction candidate.
  assert.equal(cache.get('km', 'a'), 'A')
  cache.set('km', 'c', 'C')
  assert.equal(cache.get('km', 'b'), undefined)
  assert.equal(cache.get('km', 'a'), 'A')
  assert.equal(cache.get('km', 'c'), 'C')

  // TTL: an entry older than the window is gone.
  clock += 600
  assert.equal(cache.get('km', 'a'), undefined)

  const dump = cache.dump()
  const revived = createTranslationCache({ max: 10 })
  assert.ok(revived.load(dump) >= 1)
  assert.equal(revived.get('km', 'c'), 'C')
  // A blank value is never stored: an empty string would shadow the source.
  assert.equal(revived.set('km', 'x', ''), false)
  assert.equal(revived.get('km', 'x'), undefined)
})
