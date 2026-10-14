// ─── Multi-tab workspace behaviour in a real DOM ────────────────────
// Drives the strip the way an operator does: click tabs, press the
// "+ New tab" button, Ctrl/⌘-click and middle-click the sidebar, drag a
// tab across the strip. Chrome decides some chords before the page sees
// them, so the expectations here are the ones Chrome can deliver.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
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
// Records pointer captures: grabbing the pointer is what used to swallow
// the click that opens/activates a tab.
const captures = []
dom.window.HTMLElement.prototype.setPointerCapture = function setPointerCapture(id) { captures.push(id) }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.matchMedia = dom.window.matchMedia
globalThis.fetch = async () => { throw new Error('offline') }
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const $$ = (selector) => [...document.querySelectorAll(selector)]
const tabs = () => $$('.tab-list [role="tab"]')
const labelOf = (tab) => (tab.textContent || '').replace(/×/g, '').trim()
const tabLabels = () => tabs().map(labelOf)
const activeLabel = () => labelOf(tabs().find((tab) => tab.getAttribute('aria-selected') === 'true') || {})
const optionTo = (text) => $$('[data-testid="new-tab-picker"] button').find((entry) => (entry.textContent || '').includes(text))
const navButton = (label) => $$('nav[aria-label="Main navigation"] button').find((entry) => (entry.textContent || '').includes(label))
const plusButton = () => $$('button').find((entry) => entry.getAttribute('aria-label') === 'Open a new tab')
const dishButton = (name) => $$('#workspace-panel button[aria-current]').find((entry) => (entry.textContent || '').includes(name))
const currentDish = () => {
  const active = $$('#workspace-panel button[aria-current="true"]')[0]
  return (active?.textContent || '').trim()
}

const click = (el, options = {}) => act(() => {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
})
const middle = (el) => act(() => {
  el.dispatchEvent(new dom.window.MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
})
const context = (el) => act(() => {
  el.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
})
const pointer = (type, target, options = {}) => act(() => {
  target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...options }))
})

let root = null
let container = null

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

async function freshApp() {
  if (root) {
    act(() => root.unmount())
    container.remove()
  }
  dom.window.localStorage.clear()
  dom.window.sessionStorage.clear()
  mount()
  await settle(60)
}

before(async () => { await freshApp() })

after(async () => {
  act(() => { root.unmount() })
  container.remove()
  await server.close()
})

test('the workspace starts on a single tab', () => {
  assert.equal(tabs().length, 1)
  assert.equal(activeLabel(), 'Floor')
})

test('clicking a tab activates it without grabbing the pointer', async () => {
  await freshApp()
  click(plusButton())
  await settle()
  assert.equal(tabs().length, 2, 'the + button opened a second tab')
  const [first] = tabs()
  const second = tabs()[1]
  assert.equal(labelOf(second), 'New tab', 'a new tab asks for its screen')

  // Press and release on the first tab exactly like a mouse click.
  pointer('pointerdown', first, { clientX: 20 })
  pointer('pointerup', dom.window, { clientX: 20 })
  click(first)
  await settle()
  assert.equal(activeLabel(), 'Floor', 'the clicked tab came to the front')
  assert.deepEqual(captures, [], 'no pointer capture was taken on a click')
})

test('the new tab offers the screens the role can open and honours the pick', async () => {
  await freshApp()
  click(plusButton())
  await settle()
  assert.ok(document.querySelector('[data-testid="new-tab-picker"]'), 'the picker is on screen')
  click(optionTo('Reports'))
  await settle()
  assert.equal(activeLabel(), 'Reports')
  assert.match(container.textContent, /Reports & Analytics/)
})

test('Ctrl/⌘-clicking a sidebar item opens that screen in its own tab', async () => {
  await freshApp()
  const kitchen = navButton('Kitchen')
  click(kitchen, { ctrlKey: true })
  await settle()
  assert.equal(tabs().length, 2)
  assert.ok(activeLabel().startsWith('Kitchen'), `expected the Kitchen tab in front, saw ${activeLabel()}`)
  // A second Ctrl-click jumps back to that tab instead of stacking twins.
  click(navButton('Dashboard'), { ctrlKey: true })
  await settle()
  assert.ok(activeLabel().startsWith('Dashboard'))
  const count = tabs().length
  click(navButton('Kitchen'), { ctrlKey: true })
  await settle()
  assert.equal(tabs().length, count, 'no duplicate tab for a screen that is already open')
  assert.ok(activeLabel().startsWith('Kitchen'))
})

test('middle-clicking a sidebar item opens it in the background', async () => {
  await freshApp()
  const before = tabLabels()
  middle(navButton('Inventory'))
  await settle()
  assert.equal(tabs().length, before.length + 1)
  assert.ok(tabLabels().some((label) => label.startsWith('Inventory')))
  assert.equal(activeLabel(), 'Floor', 'a background tab never steals focus')
})

test('dragging a tab reorders it, focuses it, and never activates its neighbour', async () => {
  await freshApp()
  click(navButton('Inventory'))
  await settle()
  // Close the initial tab so the drag pair is exactly Inventory · Reports.
  click(tabs()[0].parentElement.querySelector('button[aria-label^="Close"]'))
  await settle()
  assert.equal(tabs().length, 1)
  click(navButton('Reports'))
  await settle()
  const order = tabLabels()
  assert.equal(order.length, 2)
  assert.ok(order[0].startsWith('Inventory') && order[1].startsWith('Reports'))

  const firstTab = tabs()[0]
  pointer('pointerdown', firstTab, { clientX: 10 })
  pointer('pointermove', dom.window, { clientX: 80 })
  await settle(10)
  assert.ok(document.querySelector('.restora-tab-dragging'), 'the tab follows the pointer')
  pointer('pointerup', dom.window, { clientX: 80 })
  await settle()
  const after = tabLabels()
  assert.deepEqual(after.slice().sort(), order.slice().sort(), 'no tab was lost')
  assert.ok(after[1].startsWith('Inventory'), 'the dragged tab moved to the right of the other')
  assert.ok(activeLabel().startsWith('Inventory'), 'the dragged tab holds focus')
})

test('closing tabs keeps one alive and hands focus to a neighbour', async () => {
  await freshApp()
  click(plusButton())
  await settle()
  click(optionTo('Purchases'))
  await settle()
  assert.equal(tabs().length, 2)
  click(tabs()[1].parentElement.querySelector('button[aria-label^="Close"]'))
  await settle()
  assert.equal(tabs().length, 1)
  assert.ok(activeLabel().startsWith('Floor'), 'focus fell back to the surviving tab')

  click(tabs()[0].parentElement.querySelector('button[aria-label^="Close"]'))
  await settle()
  assert.equal(tabs().length, 1, 'closing the last tab opens a fresh one')
})

test('two tabs holding the same screen keep their own drawer', async () => {
  await freshApp()
  click(navButton('Menu'))
  await settle()
  // Drop the initial tab so the workspace holds a single Menu tab.
  click(tabs()[0].parentElement.querySelector('button[aria-label^="Close"]'))
  await settle()
  assert.equal(tabs().length, 1)
  // That tab opens a dish (its own per-tab drawer).
  click(dishButton('Ribeye Plate'))
  await settle()
  assert.match(currentDish(), /Ribeye Plate/)

  // Duplicate the tab, then open a different dish in the copy.
  context(tabs()[0])
  await settle()
  click($$('[role="menuitem"]').find((entry) => (entry.textContent || '').includes('Duplicate')))
  await settle()
  assert.equal(tabs().length, 2, 'the tab was duplicated')
  click(dishButton('House Salad'))
  await settle()
  assert.match(currentDish(), /House Salad/)

  // Switching back must restore the first tab's own drawer, not the copy's.
  click(tabs()[0])
  await settle()
  assert.match(currentDish(), /Ribeye Plate/, 'the first tab still shows the dish it had open')
})

test('the workspace survives a reload on the same terminal', async () => {
  await freshApp()
  click(plusButton())
  await settle()
  click(optionTo('Settings'))
  await settle()
  const before = tabLabels()
  assert.equal(before.length, 2)

  act(() => root.unmount())
  container.remove()
  mount() // no storage clear — this is the reload
  await settle(80)
  assert.deepEqual(tabLabels(), before, 'the same tabs came back')
  assert.ok(activeLabel().startsWith('Settings'))
})
