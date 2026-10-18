// ─── Google Translate (free endpoint) engine ──────────────────────────
// The one place that knows how to talk to Google's free `translate_a/single`
// endpoint: URL building, response parsing, batching, alignment repair and
// caching. It is deliberately pure and dependency-free so the *same* code
// runs in three hosts:
//
//   • the browser         — src/lib/google-translate.js (through /api/translate)
//   • the Express server  — server/translate.js (the proxy guests + staff hit)
//   • the Vite dev server — vite.config.js middleware (`npm run dev`, no backend)
//
// No browser globals at module top level (the server imports this), nothing
// throws: every entry point returns `{ ok, … }` so a blocked or rate-limited
// Google can never take a screen down. The app's own dictionary
// (src/lib/i18n-phrases.js) always wins; this engine only fills the gaps.
//
// Why a proxy at all: the free endpoint answers without CORS headers, so a
// browser fetch from the app origin is rejected. Same-origin `/api/translate`
// keeps the key-less endpoint server-side, adds one shared cache for every
// terminal, and lets us rate-limit per guest IP.

/** Free, key-less Google Translate endpoint (the one translate.google.com uses). */
export const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'

/** App language code → Google `tl` code. Google wants `zh-CN`, not `zh`. */
export const TRANSLATE_TARGET_CODES = {
  km: 'km',
  en: 'en',
  zh: 'zh-CN',
}

/** Source language of the app's copy. Everything in the DOM starts as English. */
export const TRANSLATE_SOURCE_LANG = 'en'

/** Languages the machine layer can serve. `en` is the source, never a target. */
export const TRANSLATE_LANGS = ['km', 'zh']

// Batching limits. The request is a GET, so the encoded URL has to stay well
// under the ~2048 characters proxies and CDNs tolerate; 900 source characters
// per request leaves room for the fixed params and percent-encoding.
export const TRANSLATE_MAX_ITEMS = 24
export const TRANSLATE_MAX_CHARS = 900
/** Longest single string we will send (a paragraph, not a page). */
export const TRANSLATE_MAX_TEXT_LENGTH = 400

// Words that must survive translation untouched: brand, machine codes, POS
// jargon and units. A string made only of these (+ digits/punctuation) is
// data, not copy, and is never sent to Google.
const DO_NOT_TRANSLATE = new Set([
  'restora', 'restora·', 'telegram', 'whatsapp', 'wifi', 'qr', 'ai', 'api', 'sku',
  'sla', 'kpi', 'kds', 'pos', 'pdf', 'csv', 'json', 'sqlite', 'vite', 'react',
  'usd', 'khr', 'eur', 'cny', 'thb', 'vat', 'ein', 'gst', 'id', 'no', 'ok',
  'acct', 'apt', 'ste', 'tel', 'ext', 'ref', 'qty', 'lot', 'po', 'inv',
  'am', 'pm', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
])

const KHMER_RE = /[\u1780-\u17FF]/
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
const LATIN_WORD_RE = /[A-Za-z]{2,}/g
/** Identifiers, commands, file names, URLs, codes — no spaces, no sentence. */
const TOKENISH_RE = /^[\w./\\:@#$%&*+=<>|()[\]{}'"~,;!?^-]+$/

/**
 * True when a string is worth sending to Google. Filters out numbers, money,
 * dates, SKU/code tokens, brand and acronym-only strings, copy already written
 * in a target script, and anything over-long. That is most of what a DOM walk
 * picks up on a dense screen, and skipping it is what keeps the request count
 * (and the bill, and the latency) near zero.
 */
export function isTranslatable(raw) {
  if (typeof raw !== 'string') return false
  const text = raw.trim()
  if (text.length < 2 || text.length > TRANSLATE_MAX_TEXT_LENGTH) return false
  // Already in a target script — nothing to do. Re-running Khmer through an
  // English source is how seeded copy gets garbled.
  if (KHMER_RE.test(text) || CJK_RE.test(text)) return false
  // `/help`, `SKU-1024`, `true`, `Telegram.WebApp.ready()` — machine tokens.
  if (TOKENISH_RE.test(text)) return false
  const words = text.match(LATIN_WORD_RE)
  if (!words) return false
  // Needs at least one real word: a date ("Oct 18"), a money figure ("$8.50")
  // and an acronym row ("TUE THU SAT") carry none.
  return words.some((word) => {
    const lower = word.toLowerCase()
    return lower.length >= 3 && !DO_NOT_TRANSLATE.has(lower)
  })
}

/** Google's `tl` code for one of our language ids. */
export function translateTargetCode(lang) {
  const code = String(lang || '').trim().toLowerCase()
  return TRANSLATE_TARGET_CODES[code] || ''
}

/** True when we can machine-translate into this language at all. */
export function isTranslateTarget(lang) {
  return TRANSLATE_LANGS.includes(String(lang || '').trim().toLowerCase())
}

/**
 * Strip the characters that would break batch alignment: the newline is our
 * item separator, so an input carrying one would come back as two "items".
 */
export function sanitizeForTranslation(text) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** Split a list of strings into request-sized chunks (items *and* characters). */
export function chunkTexts(texts, { maxItems = TRANSLATE_MAX_ITEMS, maxChars = TRANSLATE_MAX_CHARS } = {}) {
  const chunks = []
  let current = []
  let chars = 0
  for (const text of texts) {
    const clean = sanitizeForTranslation(text)
    if (!clean) continue
    const length = clean.length + 1 // the separator
    if (current.length && (current.length >= maxItems || chars + length > maxChars)) {
      chunks.push(current)
      current = []
      chars = 0
    }
    // A single string longer than the budget still travels alone.
    current.push(clean)
    chars += length
  }
  if (current.length) chunks.push(current)
  return chunks
}

/** Build the free-endpoint URL for one chunk. `dj=1` asks for readable JSON. */
export function buildTranslateUrl({
  texts,
  target,
  source = TRANSLATE_SOURCE_LANG,
  endpoint = GOOGLE_TRANSLATE_ENDPOINT,
}) {
  const url = new URL(endpoint)
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('sl', source || 'auto')
  url.searchParams.set('tl', translateTargetCode(target) || target)
  url.searchParams.set('dt', 't')
  url.searchParams.set('dj', '1')
  url.searchParams.set('q', texts.join('\n'))
  return url.toString()
}

/**
 * Normalise either response shape into `[{ trans, orig }]` segments:
 *   `dj=1`   → { sentences: [{ trans, orig }, …] }
 *   classic  → [[[trans, orig, null, null, 10], …], null, "en", …]
 * `orig` matters as much as `trans`: when Google drops the newline separators
 * on the way back, the source side is what lets us re-pair the lines.
 */
export function parseTranslateSegments(payload) {
  if (!payload) return []
  if (typeof payload === 'string') return payload ? [{ trans: payload, orig: '' }] : []
  if (Array.isArray(payload.sentences)) {
    return payload.sentences
      .filter((sentence) => sentence && typeof sentence === 'object')
      .map((sentence) => ({ trans: String(sentence.trans ?? ''), orig: String(sentence.orig ?? '') }))
  }
  if (Array.isArray(payload) && Array.isArray(payload[0])) {
    return payload[0]
      .filter((segment) => Array.isArray(segment))
      .map((segment) => ({ trans: String(segment[0] ?? ''), orig: String(segment[1] ?? '') }))
  }
  return []
}

/** Flatten a response into one translated string (newline separators kept). */
export function parseTranslatePayload(payload) {
  const segments = parseTranslateSegments(payload)
  if (segments.length) return segments.map((segment) => segment.trans).join('')
  if (typeof payload === 'string') return payload
  return ''
}

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

/**
 * Map a translation back onto the items that produced it. Returns null when
 * the pairing cannot be trusted — Google occasionally merges or drops a
 * newline, and a wrong pairing is worse than no pairing (it would label a
 * "Delete" button "Save"). The caller then bisects the chunk.
 *
 * Accepts the joined string or the raw segments. Two strategies, in order:
 *   1. split the joined translation on the separator we sent;
 *   2. re-pair by each segment's `orig` (survives a dropped newline).
 */
export function alignTranslations(texts, translated) {
  const segments = Array.isArray(translated)
    ? translated
    : parseTranslateSegments(translated ? { sentences: [{ trans: String(translated), orig: '' }] } : null)
  const joined = Array.isArray(translated)
    ? translated.map((segment) => (typeof segment === 'string' ? segment : segment?.trans ?? '')).join('')
    : String(translated ?? '')
  if (!joined.trim()) return null

  // 1. The separator survived: the line count is the pairing.
  const parts = joined.split('\n')
  while (parts.length > texts.length && !parts[parts.length - 1].trim()) parts.pop()
  if (parts.length === texts.length) {
    return parts.map((part, index) => {
      const value = part.trim()
      // An empty or echo-back segment means "no translation" for that item.
      if (!value || value === texts[index]) return ''
      return value
    })
  }

  // 2. Newlines lost on the way back: pair by each segment's own source text.
  //    Trusted only when the segments line up one-to-one with what we sent —
  //    anything looser returns null so the caller bisects instead of guessing.
  if (segments.length === texts.length) {
    const paired = segments.every((segment, index) => normalize(segment.orig) === normalize(texts[index]))
    if (paired) {
      return segments.map((segment, index) => {
        const value = segment.trans.trim()
        if (!value || value === texts[index]) return ''
        return value
      })
    }
  }
  return null
}

/** Small LRU with an optional TTL — used by both the server and the browser. */
export function createTranslationCache({ max = 4000, ttlMs = 0, now = () => Date.now() } = {}) {
  const store = new Map()

  function key(target, text) {
    return `${target}\u0000${text}`
  }

  function prune() {
    while (store.size > max) {
      const oldest = store.keys().next()
      if (oldest.done) break
      store.delete(oldest.value)
    }
  }

  return {
    get max() {
      return max
    },
    get size() {
      return store.size
    },
    get(target, text) {
      const entry = store.get(key(target, text))
      if (!entry) return undefined
      if (ttlMs && now() - entry.at > ttlMs) {
        store.delete(key(target, text))
        return undefined
      }
      // Refresh recency: Map keeps insertion order, so re-insert on hit.
      store.delete(key(target, text))
      store.set(key(target, text), entry)
      return entry.value
    },
    set(target, text, value) {
      if (!value) return false
      const k = key(target, text)
      if (store.has(k)) store.delete(k)
      store.set(k, { value, at: now() })
      prune()
      return true
    },
    has(target, text) {
      return this.get(target, text) !== undefined
    },
    delete(target, text) {
      return store.delete(key(target, text))
    },
    clear() {
      store.clear()
    },
    /** Plain object form — what the browser persists to localStorage. */
    dump() {
      const out = {}
      for (const [k, entry] of store) out[k] = entry.value
      return out
    },
    load(object) {
      if (!object || typeof object !== 'object') return 0
      let count = 0
      for (const [k, value] of Object.entries(object)) {
        if (typeof value !== 'string' || !value) continue
        store.set(k, { value, at: now() })
        count += 1
      }
      prune()
      return count
    },
  }
}

/**
 * Fetch one chunk, repairing misalignment by bisection. Returns a Map of
 * sanitized source → translation (empty string = "Google had nothing").
 */
async function translateChunk(chunk, options, depth = 0) {
  const {
    target,
    source,
    endpoint,
    fetchImpl,
    timeoutMs,
    signal,
  } = options
  const out = new Map()
  if (!chunk.length) return { ok: true, results: out, requests: 0 }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  // A caller-level abort (page navigation, language switch) wins too.
  const onOuterAbort = () => controller.abort(new Error('aborted'))
  if (signal) {
    if (signal.aborted) controller.abort(new Error('aborted'))
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }

  let requests = 1
  try {
    const url = buildTranslateUrl({ texts: chunk, target, source, endpoint })
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      return { ok: false, results: out, requests, error: `translate ${response.status}`, status: response.status }
    }
    const payload = await response.json()
    // Segments (not the joined string) so a response that dropped our
    // newlines can still be paired by each segment's own source text.
    const aligned = alignTranslations(chunk, parseTranslateSegments(payload))
    if (aligned) {
      chunk.forEach((text, index) => out.set(text, aligned[index] || ''))
      return { ok: true, results: out, requests }
    }
  } catch (error) {
    return { ok: false, results: out, requests, error: error?.message || 'translate failed' }
  } finally {
    clearTimeout(timeout)
    if (signal) signal.removeEventListener('abort', onOuterAbort)
  }

  // Misaligned: split and retry so one merged line cannot poison the batch.
  if (depth >= 4 || chunk.length === 1) {
    return { ok: true, results: out, requests, partial: true }
  }
  const mid = Math.ceil(chunk.length / 2)
  const halves = [chunk.slice(0, mid), chunk.slice(mid)]
  let ok = true
  let partial = false
  for (const half of halves) {
    const result = await translateChunk(half, options, depth + 1)
    requests += result.requests
    ok = ok && result.ok
    partial = partial || Boolean(result.partial)
    for (const [text, value] of result.results) out.set(text, value)
  }
  return { ok, results: out, requests, partial }
}

/**
 * Translate a list of strings into one target language.
 *
 * `{ texts, target }` are required; everything else is injectable for tests:
 * `fetchImpl`, `timeoutMs`, `endpoint`, `cache`, `concurrency`, `signal`.
 * Never throws — resolves `{ ok, translations, missing, cached, requests, error }`
 * where `translations` maps the *sanitized* source string to its translation
 * and `missing` lists what Google could not answer.
 */
export async function translateBatch({
  texts,
  target,
  source = TRANSLATE_SOURCE_LANG,
  endpoint = GOOGLE_TRANSLATE_ENDPOINT,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  cache = null,
  concurrency = 3,
  signal = null,
}) {
  const translations = {}
  const wanted = []
  const skipped = []

  for (const raw of Array.isArray(texts) ? texts : []) {
    const clean = sanitizeForTranslation(raw)
    if (!clean) continue
    if (!isTranslatable(clean)) {
      skipped.push(clean)
      continue
    }
    const cached = cache ? cache.get(target, clean) : undefined
    if (cached) {
      translations[clean] = cached
      continue
    }
    if (!wanted.includes(clean)) wanted.push(clean)
  }

  if (!isTranslateTarget(target)) {
    return { ok: false, translations, missing: wanted, skipped, cached: Object.keys(translations).length, requests: 0, error: 'unsupported target' }
  }
  if (!wanted.length) {
    return { ok: true, translations, missing: [], skipped, cached: Object.keys(translations).length, requests: 0 }
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, translations, missing: wanted, skipped, cached: Object.keys(translations).length, requests: 0, error: 'no fetch' }
  }

  const chunks = chunkTexts(wanted)
  const missing = []
  let requests = 0
  let failures = 0
  let firstError = ''

  // Bounded concurrency: one screen can surface a few hundred strings and a
  // burst of parallel requests is how a free endpoint starts refusing us.
  for (let index = 0; index < chunks.length; index += concurrency) {
    const wave = chunks.slice(index, index + concurrency)
    const settled = await Promise.all(
      wave.map((chunk) => translateChunk(chunk, { target, source, endpoint, fetchImpl, timeoutMs, signal })),
    )
    for (const result of settled) {
      requests += result.requests
      if (!result.ok) {
        failures += 1
        firstError = firstError || result.error || 'translate failed'
      }
      for (const [text, value] of result.results) {
        if (value) {
          translations[text] = value
          cache?.set(target, text, value)
        } else {
          missing.push(text)
        }
      }
    }
  }

  // Anything a failed chunk never answered is missing, not silently dropped.
  for (const text of wanted) {
    if (!(text in translations) && !missing.includes(text)) missing.push(text)
  }

  return {
    ok: failures === 0,
    translations,
    missing,
    skipped,
    cached: Object.keys(translations).length,
    requests,
    error: firstError || undefined,
  }
}
