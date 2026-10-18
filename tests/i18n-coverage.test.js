// ─── i18n coverage net ────────────────────────────────────────────────
// The net under the language completion pass. Three layers:
//
//   1. Phrase-table parity — PHRASES_KM and PHRASES_ZH must hold the same
//      English source keys. `translateText()` falls through to the original
//      English when a key is missing, so parity is the cheapest possible
//      untranslated-string detector.
//   2. Kitchen dictionary hygiene — km/en/zh at key parity, and no value in
//      the wrong script (Khmer in en/zh, Latin-only copy in km).
//   3. DOM walks — the real app (owner workspace, guest menu, mini app) is
//      rendered in km and zh and every visibly untranslated node is
//      collected: Latin-only nodes (`pure`) and script nodes that still
//      carry a Latin word outside the deliberate loanword/gloss vocabulary
//      (`mixed`). Anything outside the pinned sets fails. PINNED_* is
//      intentional English (seeded data, brand and endonyms, doc codes);
//      ALLOW_* is known copy debt and its only destination is empty.
//
// To shrink the allowlists, dump the raw findings instead of asserting:
//
//   I18N_SCAN=/tmp/i18n-scan.json node --test tests/i18n-coverage.test.js
//
// The walkers mirror tests/screens-ui.test.js: Vite middleware mode with
// `hmr: false` so parallel UI test files never collide on the HMR port, and
// `setAppLang()` after the JSDOM exists so the saved language is respected.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const SCAN_PATH = process.env.I18N_SCAN || ''

// ── pinned findings ──────────────────────────────────────────────────
// PINNED_*: English that belongs on screen in every language — seeded
// content (dish, supplier and people names), brand words, language
// endonyms, and machine codes. These are data, not copy.
const PINNED_KM = new Set([
  'English',
  'Khmer',
  'Chinese',
  'Restora',
])

// ALLOW_*: real untranslated copy we have not filled yet. Target: empty.
const ALLOW_KM = new Set([])
const ALLOW_MIXED_KM = new Set([])

const PINNED_ZH = new Set([
  'English',
  'Khmer',
  'Chinese',
  'Restora',
])

const ALLOW_ZH = new Set([])
const ALLOW_MIXED_ZH = new Set([])

// ── the DOM harness (same shape as tests/screens-ui.test.js) ─────────

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/?role=owner',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'location', 'history']) {
  globalThis[key] = dom.window[key]
}
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.sessionStorage = dom.window.sessionStorage
globalThis.requestAnimationFrame = (cb) => dom.window.setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = globalThis.ResizeObserver
dom.window.HTMLElement.prototype.scrollTo = function scrollTo() {}
dom.window.HTMLElement.prototype.setPointerCapture = function setPointerCapture() {}
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.matchMedia = dom.window.matchMedia
globalThis.fetch = async () => { throw new Error('offline') }
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
dom.window.print = () => {}
dom.window.open = () => null
for (const name of ['alert', 'confirm', 'prompt']) dom.window[name] = () => false
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')
const { default: GuestScreen } = await server.ssrLoadModule('/src/screens/GuestScreen.jsx')
const { default: MiniAppScreen } = await server.ssrLoadModule('/src/screens/MiniAppScreen.jsx')
const { NAV_SECTIONS, ROLE_NAV } = await server.ssrLoadModule('/src/lib/constants.js')
const { PHRASES_KM, PHRASES_ZH } = await server.ssrLoadModule('/src/lib/i18n-phrases.js')
const { getKitchenDict } = await server.ssrLoadModule('/src/lib/kitchen-i18n.js')
const { setAppLang, translateScreenLabel } = await server.ssrLoadModule('/src/lib/i18n.js')

const KHMER_RE = /[\u1780-\u17ff\u19e0-\u19ff]/
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/

// ── collection ───────────────────────────────────────────────────────
// Two kinds of leftover copy, per language:
//
//   pure  — a node with Latin words but no Khmer/Chinese script. Either
//           untranslated UI copy or seeded data (a supplier name, an
//           address); the pinned set separates the two.
//   mixed — a node written in script that still carries a Latin word
//           outside the deliberate vocabulary below: a partial translation
//           (`dine_in · 3 មុខ`, `-85% ធៀប 7-day daily avg`).
//
// Text inside parentheses is skipped before the Latin words are read: the
// product deliberately glosses technical terms (`ស្តុក (SKU)`,
// `មុខម្ហូបខ្សោយ (Dogs)`) and those glosses are not gaps.
//
// Every bucket is Map<surface, Set<string>> so a failure names the screen.

const LOANWORDS = new Set([
  // Acronyms and product nouns the team writes in Latin on purpose.
  'AI', 'API', 'SLA', 'SKU', 'SKUs', 'KDS', 'POS', 'QR', 'KPI', 'COD', 'VAT', 'URL', 'ID',
  'Telegram', 'BotFather', 'Webhook', 'Bot', 'Chat', 'Token', 'Logo', 'Waste', 'Mini', 'App',
  'Ops', 'Copilot', 'SQLite', 'SQL', 'CSV', 'PDF', 'Excel', 'WhatsApp', 'Viber',
  'PNG', 'SVG', 'JPG', 'KB', 'MB', 'GB', 'Par', 'Restora',
  // Language endonyms ride in every locale by design.
  'Khmer', 'English', 'Chinese',
])

const findings = {
  km: { pure: new Map(), mixed: new Map() },
  zh: { pure: new Map(), mixed: new Map() },
  khmerStale: new Map(), // Khmer text still on screen while the UI is zh/en
  cjkStale: new Map(), // Chinese text still on screen while the UI is en
}

// Data, not copy: URLs, emails, ISO dates, doc codes — never translate.
const AUTO_SKIP = [
  /:\/\//,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /^\s*data:image/,
  /^\d{4}-\d{2}-\d{2}/,
  /^[A-Za-z]{1,5}[-_/][\w.-]+$/,
]

function textNodes() {
  const walker = document.createTreeWalker(document.body, dom.window.NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  return nodes
}

// Mirrors SKIP_SELECTOR in src/lib/i18n.js (plus attribute-hidden nodes):
// code blocks, inputs and deliberate English mirrors are never translated,
// so the walker must not read them either.
const SKIP_SELECTOR = [
  '.sr-only', 'script', 'style', 'code', 'pre', 'textarea',
  '[contenteditable="true"]', '[data-no-i18n]',
  '[data-testid="telegram-transcript"]', '.tab-i18n-label',
  '[hidden]', '[aria-hidden="true"]',
].join(', ')

function visibleText(node) {
  const parent = node.parentElement
  if (!parent) return ''
  if (parent.closest(SKIP_SELECTOR)) return ''
  return (node.nodeValue || '').replace(/\s+/g, ' ').trim()
}

function collect(bucket, surface) {
  const pure = bucket.pure.get(surface) || new Set()
  const mixed = bucket.mixed.get(surface) || new Set()
  for (const node of textNodes()) {
    const raw = visibleText(node)
    if (!raw || !/[A-Za-z]{3}/.test(raw)) continue
    if (AUTO_SKIP.some((re) => re.test(raw))) continue
    const inScript = KHMER_RE.test(raw) || CJK_RE.test(raw)
    if (!inScript) {
      pure.add(raw)
      continue
    }
    // Glosses in parentheses are intentional; only the rest is checked.
    const prose = raw.replace(/\([^)]*\)/g, '')
    const foreign = (prose.match(/[A-Za-z]{3,}/g) || []).filter((word) => !LOANWORDS.has(word))
    if (foreign.length) mixed.add(raw)
  }
  bucket.pure.set(surface, pure)
  bucket.mixed.set(surface, mixed)
}

function collectScript(map, surface, re, allowed = []) {
  const set = map.get(surface) || new Set()
  for (const node of textNodes()) {
    const raw = visibleText(node)
    if (!raw || !re.test(raw)) continue
    if (allowed.includes(raw)) continue
    set.add(raw)
  }
  map.set(surface, set)
}

function unexpected(map, pinned, allow) {
  const ok = new Set([...pinned, ...allow])
  const gaps = []
  for (const [surface, set] of map) {
    for (const value of set) if (!ok.has(value)) gaps.push(`${surface}: ${value}`)
  }
  return gaps.sort()
}

function assertTranslated(map, pinned, allow, label) {
  const gaps = unexpected(map, pinned, allow)
  assert.deepEqual(gaps, [], `${label} — ${gaps.length} untranslated string(s):\n${gaps.join('\n')}`)
}

function assertScriptClean(map, surface, label) {
  const set = [...(map.get(surface) || [])].sort()
  assert.deepEqual(set, [], `${label}:\n${set.join('\n')}`)
}

// ── mounts ───────────────────────────────────────────────────────────

let root = null
let container = null

function mount(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(element) })
}

function unmount() {
  if (root) act(() => { root.unmount() })
  container?.remove()
  root = null
  container = null
}

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}

const bodyText = () => document.body.textContent || ''
// Lazy screens resolve through a Suspense fallback ("Opening…") — same real
// time budget as screens-ui so a cold chunk can't flake the walk.
const flush = async (budgetMs = 4000) => {
  const deadline = Date.now() + budgetMs
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)) })
  while (bodyText().includes('Opening…') && Date.now() < deadline) {
    await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 10)) })
  }
}

function navButton(label) {
  return [...document.querySelectorAll('.app-sidebar button, nav[aria-label="Main navigation"] button')]
    .find((entry) => (entry.textContent || '').includes(label))
}

async function walkOwner(bucket, lang) {
  collect(bucket, 'shell')
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!ROLE_NAV.owner.includes(item.id)) continue
      const label = translateScreenLabel(item.id, item.label, lang)
      const button = navButton(label)
      if (!button) {
        // A sidebar that cannot find its own translated label is itself a gap.
        bucket.pure.set(`nav:${item.id}`, new Set([label]))
        continue
      }
      act(() => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      await settle()
      await flush()
      collect(bucket, item.id)
    }
  }
}

// ── 1. phrase-table parity ───────────────────────────────────────────

test('PHRASES_KM and PHRASES_ZH hold the same keys', () => {
  const missingZh = Object.keys(PHRASES_KM).filter((key) => !(key in PHRASES_ZH))
  const missingKm = Object.keys(PHRASES_ZH).filter((key) => !(key in PHRASES_KM))
  assert.deepEqual(missingZh, [], `keys missing from PHRASES_ZH:\n${missingZh.join('\n')}`)
  assert.deepEqual(missingKm, [], `keys missing from PHRASES_KM:\n${missingKm.join('\n')}`)
})

test('phrase tables keep their source key in English and their value in script', () => {
  const notEnglish = Object.keys(PHRASES_KM).filter((key) => !/[A-Za-z]{2}/.test(key))
  assert.deepEqual(notEnglish, [], `phrase keys must be English source strings:\n${notEnglish.join('\n')}`)

  const latinKm = Object.entries(PHRASES_KM)
    .filter(([, value]) => !KHMER_RE.test(value) && !/\{/.test(value))
    .map(([key]) => key)
  assert.deepEqual(latinKm, [], `Khmer values must be written in Khmer:\n${latinKm.join('\n')}`)

  const khmerZh = Object.entries(PHRASES_ZH)
    .filter(([, value]) => KHMER_RE.test(value))
    .map(([key]) => key)
  assert.deepEqual(khmerZh, [], `Chinese values must not contain Khmer:\n${khmerZh.join('\n')}`)
})

// ── 2. kitchen dictionary hygiene ────────────────────────────────────

function deepStrings(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (node && typeof node === 'object') for (const value of Object.values(node)) deepStrings(value, out)
  return out
}

test('kitchen dictionaries stay at parity and in script', () => {
  const dicts = { km: getKitchenDict('km'), en: getKitchenDict('en'), zh: getKitchenDict('zh') }
  const keys = Object.fromEntries(Object.entries(dicts).map(([lang, dict]) => [lang, Object.keys(dict)]))
  for (const lang of ['en', 'zh']) {
    const missing = keys.km.filter((key) => !keys[lang].includes(key))
    assert.deepEqual(missing, [], `kitchen ${lang} is missing: ${missing.join(', ')}`)
  }
  for (const lang of ['en', 'zh']) {
    const leaked = deepStrings(dicts[lang]).filter((value) => KHMER_RE.test(value))
    assert.deepEqual(leaked, [], `kitchen ${lang} contains Khmer text: ${JSON.stringify(leaked)}`)
  }
  const latinKm = deepStrings(dicts.km).filter((value) => /[A-Za-z]{3}/.test(value) && !KHMER_RE.test(value))
  assert.deepEqual(latinKm, [], `kitchen km values are not translated: ${JSON.stringify(latinKm)}`)
})

// ── 3. DOM walks ─────────────────────────────────────────────────────

before(async () => {
  setAppLang('km')
  mount(React.createElement(RestoraProvider, null,
    React.createElement(AppShell, null, React.createElement(Router))))
  await settle(80)
})

test('owner workspace: Khmer walk leaves no untranslated copy', async () => {
  await walkOwner(findings.km, 'km')
  if (SCAN_PATH) return
  assertTranslated(findings.km.pure, PINNED_KM, ALLOW_KM, 'owner/km')
  assertTranslated(findings.km.mixed, PINNED_KM, ALLOW_MIXED_KM, 'owner/km (partial)')
})

test('owner workspace: Chinese walk leaves no Latin copy and no stale Khmer', async () => {
  setAppLang('zh')
  await settle(120)
  await walkOwner(findings.zh, 'zh')
  collectScript(findings.khmerStale, 'owner', KHMER_RE, ['ខ្មែរ'])
  if (SCAN_PATH) return
  assertTranslated(findings.zh.pure, PINNED_ZH, ALLOW_ZH, 'owner/zh')
  assertTranslated(findings.zh.mixed, PINNED_ZH, ALLOW_MIXED_ZH, 'owner/zh (partial)')
  assertScriptClean(findings.khmerStale, 'owner', 'owner/zh keeps Khmer text on screen')
})

test('kitchen in English leaks neither Khmer nor Chinese', async () => {
  setAppLang('en')
  await settle(120)
  const button = navButton(translateScreenLabel('kitchen', 'Kitchen', 'en'))
  assert.ok(button, 'the English sidebar has a Kitchen entry')
  act(() => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  await flush()
  collectScript(findings.khmerStale, 'kitchen-en', KHMER_RE, ['ខ្មែរ'])
  collectScript(findings.cjkStale, 'kitchen-en', CJK_RE, ['中文'])
  if (SCAN_PATH) return
  assertScriptClean(findings.khmerStale, 'kitchen-en', 'kitchen in English shows Khmer')
  assertScriptClean(findings.cjkStale, 'kitchen-en', 'kitchen in English shows Chinese')
})

test('guest menu renders fully in Khmer and Chinese', async () => {
  unmount()
  dom.reconfigure({ url: 'http://localhost:5173/?guest=t08' })
  setAppLang('km')
  mount(React.createElement(RestoraProvider, { waitForServer: false },
    React.createElement(GuestScreen, { tableId: 't08' })))
  await settle(120)
  await flush()
  collect(findings.km, 'guest')
  setAppLang('zh')
  await settle(120)
  collect(findings.zh, 'guest')
  collectScript(findings.khmerStale, 'guest', KHMER_RE, ['ខ្មែរ'])
  if (SCAN_PATH) return
  assertTranslated(findings.km.pure, PINNED_KM, ALLOW_KM, 'guest/km')
  assertTranslated(findings.km.mixed, PINNED_KM, ALLOW_MIXED_KM, 'guest/km (partial)')
  assertTranslated(findings.zh.pure, PINNED_ZH, ALLOW_ZH, 'guest/zh')
  assertTranslated(findings.zh.mixed, PINNED_ZH, ALLOW_MIXED_ZH, 'guest/zh (partial)')
  assertScriptClean(findings.khmerStale, 'guest', 'guest menu keeps Khmer text in Chinese')
})

test('mini app menu renders fully in Khmer and Chinese', async () => {
  unmount()
  setAppLang('km')
  mount(React.createElement(RestoraProvider, { waitForServer: false },
    React.createElement(MiniAppScreen, { tableId: 't08' })))
  await settle(120)
  await flush()
  collect(findings.km, 'miniapp')
  setAppLang('zh')
  await settle(120)
  collect(findings.zh, 'miniapp')
  collectScript(findings.khmerStale, 'miniapp', KHMER_RE, ['ខ្មែរ'])
  if (SCAN_PATH) return
  assertTranslated(findings.km.pure, PINNED_KM, ALLOW_KM, 'miniapp/km')
  assertTranslated(findings.km.mixed, PINNED_KM, ALLOW_MIXED_KM, 'miniapp/km (partial)')
  assertTranslated(findings.zh.pure, PINNED_ZH, ALLOW_ZH, 'miniapp/zh')
  assertTranslated(findings.zh.mixed, PINNED_ZH, ALLOW_MIXED_ZH, 'miniapp/zh (partial)')
  assertScriptClean(findings.khmerStale, 'miniapp', 'mini app keeps Khmer text in Chinese')
})

after(() => {
  if (SCAN_PATH) {
    const dump = {}
    const flatten = (map) => Object.fromEntries([...map].map(([surface, set]) => [surface, [...set].sort()]))
    for (const lang of ['km', 'zh']) {
      dump[`${lang}-pure`] = flatten(findings[lang].pure)
      dump[`${lang}-mixed`] = flatten(findings[lang].mixed)
    }
    dump['khmerStale'] = flatten(findings.khmerStale)
    dump['cjkStale'] = flatten(findings.cjkStale)
    writeFileSync(SCAN_PATH, JSON.stringify(dump, null, 2))
  }
  unmount()
  server.close()
})
