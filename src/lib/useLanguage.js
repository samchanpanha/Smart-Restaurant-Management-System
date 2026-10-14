// ─── Display language, remembered per terminal ──────────────────────
// A station screen keeps its language across reloads (localStorage), and
// a kiosk link can pin one: /?role=kitchen&screen=kitchen&lang=zh. The
// URL is applied once at boot and then behaves like a tap, so a cook can
// still switch. Other tabs on the same device follow along (storage event).
// When storage is blocked (private mode) the choice lives in memory.

import { useSyncExternalStore } from 'react'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, normalizeLanguage } from './i18n.js'

const CHANGE_EVENT = 'restora:language'
let memoryLanguage = null
let urlApplied = false

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** '?lang=zh-CN' → 'zh'; null when the query names no language. */
export function languageFromQuery(search) {
  try {
    const requested = new URLSearchParams(search || '').get('lang')
    return requested ? normalizeLanguage(requested, null) : null
  } catch {
    return null
  }
}

function applyUrlOnce() {
  if (urlApplied) return
  urlApplied = true
  if (typeof window === 'undefined') return
  const requested = languageFromQuery(window.location?.search)
  if (requested) persist(requested)
}

function persist(lang) {
  try {
    const store = storage()
    if (!store) throw new Error('no storage')
    store.setItem(LANGUAGE_STORAGE_KEY, lang)
  } catch {
    memoryLanguage = lang
  }
}

export function readLanguage() {
  applyUrlOnce()
  const store = storage()
  if (store) {
    try {
      return normalizeLanguage(store.getItem(LANGUAGE_STORAGE_KEY))
    } catch {
      // Storage refused the read; the in-memory choice is all we have.
    }
  }
  return normalizeLanguage(memoryLanguage)
}

export function setLanguage(next) {
  persist(normalizeLanguage(next))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event) => {
    if (event.key === null || event.key === LANGUAGE_STORAGE_KEY) onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** [lang, setLanguage] — 'km' until someone picks otherwise. */
export function useLanguage() {
  const lang = useSyncExternalStore(subscribe, readLanguage, () => DEFAULT_LANGUAGE)
  return [lang, setLanguage]
}
