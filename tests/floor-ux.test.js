// ─── Floor UX, in a real DOM ────────────────────────────────────────
// The service-time behaviour of the plan: the map never steals page scroll,
// a filter dims tables instead of unmounting them, one tap opens the action
// sheet (and never seats on its own), over-capacity seating has to be
// confirmed, and a dirty table can be turned over by hand. Geometry is not
// measurable in jsdom, so gestures are covered at the reducer level in
// floor-layout.test.js — this file proves the wiring and the copy the host
// actually reads.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/?role=owner',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'WheelEvent', 'CustomEvent', 'location', 'history']) {
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: React } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')
const { setAppLang: setLang } = await server.ssrLoadModule('/src/lib/i18n.js')
const { buildEmpire } = await server.ssrLoadModule('/src/lib/reducer.js')

setLang('en')

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const text = () => document.body.textContent || ''
const flush = async (budgetMs = 4000) => {
  const deadline = Date.now() + budgetMs
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)) })
  while (text().includes('Opening…') && Date.now() < deadline) {
    await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 10)) })
  }
}
const $$ = (selector) => [...document.querySelectorAll(selector)]
const buttonWith = (needle) => $$('button').find((entry) => (entry.textContent || '').includes(needle))
function click(node) {
  assert.ok(node, 'clicked node exists')
  act(() => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
}

// Every table tile — the map's only buttons whose label leads with the name.
const tiles = () => $$('button[aria-label^="Table "]')
const tileNamed = (name) => tiles().find((tile) => (tile.getAttribute('aria-label') || '').startsWith(`${name},`))
const labelOf = (tile) => tile?.getAttribute('aria-label') || ''
const dimmed = () => tiles().filter((tile) => tile.closest('[class*="opacity-25"]'))

let root = null
let container = null
let booted = false

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(RestoraProvider, null,
        React.createElement(AppShell, null, React.createElement(Router))),
    )
  })
}

async function openFloor({ preserveStorage = false } = {}) {
  if (!preserveStorage) {
    dom.window.localStorage.clear()
    dom.window.sessionStorage.clear()
  }
  // Clearing storage also wipes the language choice (i18n defaults to Khmer).
  setLang('en')
  if (root) act(() => { root.unmount() })
  container?.remove()
  mount()
  booted = true
  await settle(60)
  const nav = $$('button').find((entry) => (entry.textContent || '').trim() === 'Floor')
    || $$('button').find((entry) => (entry.textContent || '').includes('Floor'))
  assert.ok(nav, 'sidebar has a Floor entry')
  click(nav)
  await flush()
  await settle()
}

before(async () => {
  await openFloor()
})

after(() => {
  // The provider keeps recovery intervals alive otherwise.
  if (booted) {
    act(() => { root.unmount() })
    booted = false
  }
  container?.remove()
  server.close()
  dom.window.close()
})

test('the map never traps page scroll: plain wheel is ignored, ctrl+wheel zooms', async () => {
  const viewport = document.querySelector('[aria-label="Floor plan"]')
  assert.ok(viewport, 'the plan is a labelled region')
  const readout = () => document.querySelector('[aria-label="Reset view"]').textContent
  const before = readout()

  act(() => {
    viewport.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }))
  })
  await settle(10)
  assert.equal(readout(), before, 'plain wheel scrolls the page, never the map')

  act(() => {
    viewport.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await settle(10)
  assert.notEqual(readout(), before, 'ctrl+wheel zooms the plan')

  click(document.querySelector('[aria-label="Reset view"]'))
  await settle(10)
  assert.equal(readout(), before, 'Reset view returns to 100%')
})

test('a KPI card filters by dimming — no table is ever unmounted', async () => {
  const total = tiles().length
  assert.ok(total >= 14, `the seeded floor paints its tables — saw ${total}`)

  const cleaning = $$('button').find((entry) => (entry.textContent || '').includes('Needs cleaning'))
  assert.ok(cleaning, 'the dirty KPI card is a button')
  click(cleaning)
  await settle()
  assert.equal(cleaning.getAttribute('aria-pressed'), 'true', 'the card reads as active')
  assert.equal(tiles().length, total, 'filtering hides nothing')
  assert.equal(dimmed().length, total - 2, 'the two dirty tables stay lit, the rest dim')

  click(cleaning)
  await settle()
  assert.equal(dimmed().length, 0, 'tapping the active card clears the filter')

  // The zone row drives the same filter.
  const patio = $$('button[aria-pressed]').find((entry) => (entry.textContent || '').trim().startsWith('Patio'))
  assert.ok(patio, 'the toolbar lists the Patio zone')
  const patioCount = Number((patio.textContent.match(/(\d+)\s*$/) || [])[1])
  click(patio)
  await settle()
  assert.equal(dimmed().length, total - patioCount, 'only the chosen zone stays lit')
  click(buttonWith('All tables'))
  await settle()
  assert.equal(dimmed().length, 0, 'All tables brings the whole room back')
})

test('one tap opens the action sheet — and seats nobody until asked', async () => {
  const free = tiles().find((tile) => labelOf(tile).includes('Free'))
  assert.ok(free, 'the seeded floor has a free table')
  const name = labelOf(free).split(',')[0]

  click(free)
  await settle()
  assert.ok(text().includes('Seat party'), 'the sheet offers to seat the party')
  assert.ok(text().includes('Hold as reserved'), 'and to hold the table instead')
  assert.ok(labelOf(tileNamed(name)).includes('Free'), 'the tap alone seated nobody')

  click(buttonWith('Seat party'))
  await settle()
  assert.ok(labelOf(tileNamed(name)).includes('Seated'), `${name} seated on request`)
  assert.equal(text().includes('Seat party'), false, 'the sheet closed after seating')
})

test('over-capacity seating needs an explicit confirm', async () => {
  const small = tiles().find((tile) => labelOf(tile).includes('Free') && labelOf(tile).includes(', 2 seats'))
  assert.ok(small, 'a two-top is free')
  const name = labelOf(small).split(',')[0]

  click(small)
  await settle()
  click($$('button[aria-label="Increase"]')[0])
  await settle()
  assert.ok(text().includes('Over capacity'), 'the sheet warns before the squeeze')
  const seat = buttonWith('Seat party')
  assert.equal(seat.disabled, true, 'the CTA is blocked until the host owns it')

  const box = $$('input[type="checkbox"]').pop()
  assert.ok(box, 'the responsibility checkbox is there')
  act(() => { box.click() })
  await settle()
  assert.equal(buttonWith('Seat party').disabled, false, 'confirming the squeeze unlocks the CTA')
  click(buttonWith('Seat party'))
  await settle()
  assert.ok(labelOf(tileNamed(name)).includes('Seated'), `${name} seated after the confirm`)
})

test('a dirty table is turned over by hand in two taps', async () => {
  const dirty = tiles().find((tile) => labelOf(tile).includes('Dirty'))
  assert.ok(dirty, 'the seeded floor has a table waiting on bussing')
  const name = labelOf(dirty).split(',')[0]

  click(dirty)
  await settle()
  click(buttonWith('Mark clean & available'))
  await settle()
  const after = labelOf(tileNamed(name))
  assert.equal(after.includes('Dirty'), false, `${name} left the dirty list`)
  assert.ok(after.includes('Available'), `${name} is back in service — saw "${after}"`)
})

test('an empty floor explains itself and opens the table editor', async () => {
  // Boot on a snapshot whose tables were all removed — the state a brand new
  // branch starts from.
  act(() => { root.unmount() })
  container?.remove()
  const empire = buildEmpire()
  for (const shop of Object.values(empire.locations)) shop.tables = []
  dom.window.localStorage.setItem('restora-v1', JSON.stringify(empire))
  await openFloor({ preserveStorage: true })

  assert.ok(text().includes('No tables yet'), 'the empty plan says why it is empty')
  const add = buttonWith('Add table')
  assert.ok(add, 'and offers the first table')
  click(add)
  await settle()
  assert.ok($$('input[aria-label="Table name"]').length > 0, 'the table editor opened')
  assert.equal(text().includes('Something went wrong'), false, 'nothing threw')
})
