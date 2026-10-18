// ─── Google Translate client (free endpoint, same-origin proxy) ──────
// The browser half of machine translation. It never blocks a screen: the
// hand-written dictionary paints first, and this module upgrades the strings
// the dictionary missed a beat later.
//
//   queueTranslations(texts, lang)  →  debounced batch POST /api/translate
//                                    →  results land in a two-tier cache
//                                    →  `restora:translate-update` fires
//                                    →  useDomTranslator re-sweeps once
//
// Two-tier cache: an in-memory LRU (instant, synchronous — that is what
// `translateText()` reads) persisted to localStorage, so a terminal that has
// seen a screen once renders it fully translated with no network at all. The
// server keeps its own shared cache on top, so a fresh device usually gets
// answers without Google being asked twice.
//
// Nothing here throws and nothing here is required: no server, no network, or
// a rate-limited Google all leave the app running on the dictionary alone.
// Three consecutive failures open a circuit breaker for a minute, because a
// dining-room tablet that retries a dead endpoint every second is worse than
// one that quietly waits.

import { useCallback, useSyncExternalStore } from 'react'
import {
  TRANSLATE_LANGS,
  createTranslationCache,
  isTranslatable,
  isTranslateTarget,
  sanitizeForTranslation,
} from './translate-engine.js'

/** Same-origin proxy: server/translate.js in production, vite.config.js in dev. */
export const TRANSLATE_API = '/api/translate'
export const TRANSLATE_CACHE_KEY = 'restora-translate-cache-v1'
export const TRANSLATE_PREFS_KEY = 'restora-translate-prefs-v1'
export const TRANSLATE_UPDATE_EVENT = 'restora:translate-update'

/** Strings per HTTP request; the server chunks further for Google. */
const BATCH_SIZE = 80
/** Wait this long after the last queue() so one React commit sends one batch. */
const FLUSH_DELAY_MS = 220
const REQUEST_TIMEOUT_MS = 12000
const MAX_FAILURES = 3
const COOLDOWN_MS = 60000
const PERSIST_DELAY_MS = 2000
/** localStorage entries — keeps the blob near 300KB, well inside any quota. */
const PERSIST_MAX_ENTRIES = 2500

const hasWindow = () => typeof globalThis.window !== 'undefined'
const hasFetch = () => typeof globalThis.fetch === 'function'

const cache = createTranslationCache({ max: 4000 })
/** Strings already asked for this session, per target — the anti-loop guard. */
const asked = new Map()
/** Strings waiting for the next batch, per target. */
const pending = new Map()
const statusListeners = new Set()

let hydrated = false
let flushTimer = null
let persistTimer = null
let failures = 0
let cooldownUntil = 0
let status = Object.freeze({
  state: 'idle', // idle | loading | ready | error | off
  pending: 0,
  translated: 0,
  cachedEntries: 0,
  enabled: true,
  provider: 'google-translate-free',
  error: '',
  updatedAt: 0,
})

function askedSet(target) {
  if (!asked.has(target)) asked.set(target, new Set())
  return asked.get(target)
}

function pendingSet(target) {
  if (!pending.has(target)) pending.set(target, new Set())
  return pending.get(target)
}

function publish(patch) {
  status = Object.freeze({ ...status, ...patch, updatedAt: Date.now() })
  for (const listener of [...statusListeners]) {
    try {
      listener(status)
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}

// ─── preference ───────────────────────────────────────────────────────

/**
 * Machine translation is on by default; a terminal can opt out. Memoised
 * because `translateText()` asks on every string of every sweep — reading
 * localStorage that often would cost more than the translation itself.
 */
let enabledMemo = null

export function isMachineTranslationEnabled() {
  if (enabledMemo !== null) return enabledMemo
  try {
    const raw = globalThis.localStorage?.getItem(TRANSLATE_PREFS_KEY)
    enabledMemo = raw ? JSON.parse(raw)?.machine !== false : true
  } catch {
    enabledMemo = true
  }
  return enabledMemo
}

export function setMachineTranslationEnabled(enabled) {
  const next = Boolean(enabled)
  enabledMemo = next
  try {
    const raw = globalThis.localStorage?.getItem(TRANSLATE_PREFS_KEY)
    const parsed = raw ? (JSON.parse(raw) || {}) : {}
    globalThis.localStorage?.setItem(TRANSLATE_PREFS_KEY, JSON.stringify({ ...parsed, machine: next }))
  } catch {
    /* private mode / quota — the preference just will not survive a reload */
  }
  publish({ enabled: next, state: next ? 'idle' : 'off', pending: 0 })
  if (!next) {
    for (const set of pending.values()) set.clear()
  }
  return next
}

// ─── cache persistence ────────────────────────────────────────────────

function hydrate() {
  if (hydrated) return
  hydrated = true
  try {
    const raw = globalThis.localStorage?.getItem(TRANSLATE_CACHE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') cache.load(parsed)
  } catch {
    /* a corrupt blob is simply an empty cache */
  }
  publish({ cachedEntries: cache.size, enabled: isMachineTranslationEnabled() })
}

function schedulePersist() {
  if (!hasWindow()) return
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const entries = Object.entries(cache.dump())
      const trimmed = entries.length > PERSIST_MAX_ENTRIES
        ? Object.fromEntries(entries.slice(entries.length - PERSIST_MAX_ENTRIES))
        : Object.fromEntries(entries)
      globalThis.localStorage?.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(trimmed))
    } catch {
      /* quota — the memory cache still works for this session */
    }
  }, PERSIST_DELAY_MS)
  persistTimer.unref?.()
}

/** Synchronous cache read — what `translateText()` uses to paint instantly. */
export function getCachedTranslation(text, target) {
  if (!text || !isTranslateTarget(target)) return ''
  hydrate()
  return cache.get(target, sanitizeForTranslation(text)) || ''
}

export function hasCachedTranslation(text, target) {
  return Boolean(getCachedTranslation(text, target))
}

export function translationCacheStats() {
  hydrate()
  return {
    entries: cache.size,
    max: 4000,
    asked: [...asked.values()].reduce((total, set) => total + set.size, 0),
    pending: [...pending.values()].reduce((total, set) => total + set.size, 0),
    persisted: typeof globalThis.localStorage?.getItem === 'function'
      ? Boolean(globalThis.localStorage.getItem(TRANSLATE_CACHE_KEY))
      : false,
  }
}

export function clearTranslationCache() {
  cache.clear()
  asked.clear()
  for (const set of pending.values()) set.clear()
  failures = 0
  cooldownUntil = 0
  try {
    globalThis.localStorage?.removeItem(TRANSLATE_CACHE_KEY)
  } catch {
    /* ignore */
  }
  publish({ cachedEntries: 0, pending: 0, state: 'idle', error: '' })
  return true
}

/** Test hook: drop every in-memory trace without touching localStorage. */
export function resetTranslationClient() {
  cache.clear()
  asked.clear()
  for (const set of pending.values()) set.clear()
  failures = 0
  cooldownUntil = 0
  hydrated = true
  enabledMemo = null
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  publish({ state: 'idle', pending: 0, translated: 0, cachedEntries: 0, error: '' })
}

// ─── status subscription ──────────────────────────────────────────────

export function getTranslateStatus() {
  return status
}

export function subscribeTranslateStatus(listener) {
  if (typeof listener !== 'function') return () => {}
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** Reactive status for the switcher and Settings → Language. */
export function useTranslateStatus() {
  const subscribe = useCallback((onChange) => subscribeTranslateStatus(onChange), [])
  const snapshot = useCallback(() => getTranslateStatus(), [])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

// ─── queue + batch ────────────────────────────────────────────────────

function canSend() {
  if (!hasWindow() || !hasFetch()) return false
  if (!isMachineTranslationEnabled()) return false
  if (globalThis.navigator?.onLine === false) return false
  return Date.now() >= cooldownUntil
}

/**
 * Ask for the strings the dictionary could not handle. Safe to call on every
 * DOM sweep: duplicates, cached strings, numbers, codes and already-asked
 * strings are dropped before anything is queued, and the send is debounced so
 * one React commit produces one request.
 */
export function queueTranslations(texts, target) {
  if (!Array.isArray(texts) || !texts.length) return 0
  if (!isTranslateTarget(target)) return 0
  hydrate()

  const wanted = pendingSet(target)
  const seen = askedSet(target)
  let queued = 0

  for (const raw of texts) {
    const text = sanitizeForTranslation(raw)
    if (!text || !isTranslatable(text)) continue
    if (seen.has(text) || wanted.has(text)) continue
    if (cache.get(target, text)) continue
    wanted.add(text)
    queued += 1
  }

  if (!queued) return 0
  publish({ pending: countPending() })
  if (!canSend()) return queued

  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushTranslations(target)
  }, FLUSH_DELAY_MS)
  flushTimer.unref?.()
  return queued
}

function countPending() {
  return [...pending.values()].reduce((total, set) => total + set.size, 0)
}

/**
 * Send what is queued. Exported for tests and for the "translate now" button
 * in Settings; the debounce calls it too.
 */
export async function flushTranslations(preferredTarget) {
  if (!canSend()) return { ok: false, sent: 0, error: 'disabled' }

  const targets = preferredTarget
    ? [preferredTarget, ...TRANSLATE_LANGS.filter((lang) => lang !== preferredTarget)]
    : TRANSLATE_LANGS
  let sent = 0
  let okAll = true
  let lastError = ''

  for (const target of targets) {
    const wanted = pendingSet(target)
    if (!wanted.size) continue
    const batch = [...wanted].slice(0, BATCH_SIZE)
    // Mark them asked *before* the request: a failure must not turn into an
    // ask-every-sweep loop.
    for (const text of batch) {
      wanted.delete(text)
      askedSet(target).add(text)
    }
    if (!wanted.size) pending.delete(target)

    sent += batch.length
    publish({ state: 'loading', pending: countPending() })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT_MS)
    let result = null
    try {
      const response = await fetch(TRANSLATE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: batch, target }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`translate ${response.status}`)
      }
      result = await response.json()
    } catch (error) {
      result = { ok: false, error: error?.message || 'translate failed' }
    } finally {
      clearTimeout(timeout)
    }

    if (!result?.ok) {
      okAll = false
      lastError = result?.error || 'translate failed'
      failures += 1
      if (failures >= MAX_FAILURES) {
        cooldownUntil = Date.now() + COOLDOWN_MS
        failures = 0
      }
      publish({ state: 'error', error: lastError, pending: countPending() })
      continue
    }

    failures = 0
    const translations = result.translations || {}
    let added = 0
    for (const [text, value] of Object.entries(translations)) {
      if (typeof value !== 'string' || !value) continue
      if (cache.set(target, sanitizeForTranslation(text), value)) added += 1
    }
    if (added) {
      schedulePersist()
      publish({
        state: 'ready',
        error: '',
        cachedEntries: cache.size,
        translated: status.translated + added,
        pending: countPending(),
      })
      notifyUpdate(target, added)
    } else {
      publish({ state: countPending() ? 'loading' : 'ready', pending: countPending() })
    }
  }

  if (!sent) publish({ state: 'idle', pending: 0 })
  return { ok: okAll, sent, error: lastError || undefined }
}

/** Tell every mounted translator that new strings are ready to paint. */
function notifyUpdate(target, count) {
  if (!hasWindow() || typeof globalThis.CustomEvent !== 'function') return
  try {
    globalThis.window.dispatchEvent(
      new globalThis.CustomEvent(TRANSLATE_UPDATE_EVENT, { detail: { target, count } }),
    )
  } catch {
    /* a window that will not take events just re-sweeps on its next commit */
  }
}

/**
 * Ask the server what it is configured with (provider, cache size, whether an
 * operator switched translation off). Resolves `null` when there is no server
 * — the demo runs fine without one.
 */
export async function fetchTranslateStatus({ signal = null } = {}) {
  if (!hasFetch()) return null
  try {
    const response = await fetch(`${TRANSLATE_API}/status`, { signal })
    if (!response.ok) return null
    const payload = await response.json()
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}
