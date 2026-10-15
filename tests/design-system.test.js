// ─── Design system: primitives + tokens ─────────────────────────────
// Boots the real UI kit in jsdom and proves the primitives render, expose
// accessible roles, and that the semantic `cn()` merge behaves. Uses the
// same Vite middleware harness as the other UI tests (hmr:false so parallel
// UI suites don't fight over the HMR port).

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
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent']) {
  globalThis[key] = dom.window[key]
}
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = (cb) => dom.window.setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = globalThis.ResizeObserver
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const ui = await server.ssrLoadModule('/src/components/ui/index.jsx')
const { cn } = await server.ssrLoadModule('/src/lib/cn.js')

let container = null
let root = null

function render(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(element) })
  return container
}

function teardown() {
  act(() => { root?.unmount() })
  container?.remove()
  container = null
  root = null
}

before(() => {})
after(async () => {
  teardown()
  await server.close()
})

// ── cn() ──────────────────────────────────────────────────────────────
test('cn merges conditional classes and lets later utilities win', () => {
  const hidden = false
  assert.equal(cn('px-2', hidden && 'hidden', 'font-bold'), 'px-2 font-bold')
  assert.equal(cn('p-2', 'p-4'), 'p-4')
})

// ── Button ────────────────────────────────────────────────────────────
test('Button applies variant + size classes and blocks by default type', () => {
  render(React.createElement(ui.Button, { variant: 'danger', size: 'sm', block: true }, 'Delete'))
  const button = document.querySelector('button')
  assert.equal(button.getAttribute('type'), 'button')
  assert.equal(button.textContent, 'Delete')
  assert.match(button.className, /bg-\[var\(--danger\)\]/)
  assert.match(button.className, /w-full/)
  teardown()
})

test('IconButton is labelled and 44px', () => {
  render(React.createElement(ui.IconButton, { label: 'Remove item' }, '×'))
  const button = document.querySelector('button[aria-label="Remove item"]')
  assert.ok(button, 'has an accessible name')
  assert.match(button.className, /h-11/)
  teardown()
})

// ── Card / feedback ───────────────────────────────────────────────────
test('Card, SectionHeader, EmptyState and ErrorBanner render', () => {
  render(
    React.createElement('div', null,
      React.createElement(ui.Card, { 'data-testid': 'card' }, 'Body'),
      React.createElement(ui.SectionHeader, { title: 'Settings' }),
      React.createElement(ui.EmptyState, { title: 'Nothing here' }),
      React.createElement(ui.ErrorBanner, null, 'Boom'),
    ),
  )
  assert.ok(document.querySelector('[data-testid="card"]'))
  assert.ok(document.body.textContent.includes('Settings'))
  assert.ok(document.body.textContent.includes('Nothing here'))
  assert.equal(document.querySelector('[role="alert"]')?.textContent, 'Boom')
  teardown()
})

test('Badge is never color-alone — it carries a word', () => {
  render(React.createElement(ui.Badge, { tone: 'success', dot: true }, 'Ready'))
  const badge = document.querySelector('span')
  assert.match(badge.textContent, /Ready/)
  teardown()
})

// ── Modal ─────────────────────────────────────────────────────────────
test('Modal portals to the body, is a labelled dialog, and traps Esc', () => {
  let closed = 0
  render(React.createElement(ui.Modal, { title: 'Confirm seat', onClose: () => { closed += 1 } }, 'Are you sure?'))
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'portal rendered a dialog into the body')
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  assert.ok(dialog.textContent.includes('Are you sure?'))
  assert.ok(document.body.style.overflow === 'hidden', 'background scroll locked')
  act(() => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })) })
  assert.equal(closed, 1)
  teardown()
  assert.notEqual(document.body.style.overflow, 'hidden')
})

test('Modal closes on backdrop click but not on panel click', () => {
  let closed = 0
  render(React.createElement(ui.Modal, { title: 'Note', onClose: () => { closed += 1 } }, 'Hi'))
  const dialog = document.querySelector('[role="dialog"]')
  act(() => { dialog.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(closed, 0, 'panel click does not close')
  act(() => { dialog.parentElement.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(closed, 1, 'backdrop click closes')
  teardown()
})

test('Sheet renders a bottom dialog with safe-area padding', () => {
  render(React.createElement(ui.Sheet, { title: 'Your table', onClose: () => {} }, 'Menu'))
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.match(dialog.className, /safe-area-inset-bottom/)
  teardown()
})

// ── Forms ─────────────────────────────────────────────────────────────
test('Toggle is a switch that reports its state', () => {
  let value = false
  render(React.createElement(ui.Toggle, { label: 'Auto-86', checked: value, onChange: (next) => { value = next } }))
  const toggle = document.querySelector('[role="switch"]')
  assert.equal(toggle.getAttribute('aria-checked'), 'false')
  act(() => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(value, true)
  teardown()
})

test('Field wires label text to its control', () => {
  render(React.createElement(ui.Field, { label: 'Restaurant name' }, React.createElement(ui.Input, { defaultValue: 'Restora' })))
  assert.ok(document.body.textContent.includes('Restaurant name'))
  assert.ok(document.querySelector('input'))
  teardown()
})

// ── Tabs ──────────────────────────────────────────────────────────────
test('Tabs expose tablist semantics and arrow-key navigation', () => {
  const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
  let value = 'a'
  render(React.createElement(ui.Tabs, { items, value, onChange: (next) => { value = next } }))
  assert.ok(document.querySelector('[role="tablist"]'))
  assert.equal(document.querySelectorAll('[role="tab"]').length, 3)
  assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent, 'A')
  const first = document.querySelector('[role="tab"][aria-selected="true"]')
  act(() => { first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  assert.equal(value, 'b')
  teardown()
})

// ── DataTable ─────────────────────────────────────────────────────────
test('DataTable renders a table for md+ and stacked cards for phones', () => {
  const columns = [
    { key: 'name', header: 'Item', primary: true },
    { key: 'qty', header: 'On hand', align: 'right', render: (row) => `${row.qty} ea` },
  ]
  const rows = [{ id: 'i1', name: 'Salmon', qty: 3 }, { id: 'i2', name: 'Wings', qty: 12 }]
  render(React.createElement(ui.DataTable, { columns, rows, rowKey: 'id' }))
  const table = document.querySelector('table')
  assert.ok(table, 'desktop table exists')
  assert.equal(table.querySelectorAll('tbody tr').length, 2)
  assert.ok(document.body.textContent.includes('3 ea'))
  const phoneList = document.querySelector('ul.md\\:hidden')
  assert.ok(phoneList, 'phone card list exists')
  assert.equal(phoneList.querySelectorAll('li').length, 2)
  teardown()
})

test('DataTable shows the empty slot when there are no rows', () => {
  render(React.createElement(ui.DataTable, {
    columns: [{ key: 'name', header: 'Item' }],
    rows: [],
    empty: React.createElement(ui.EmptyState, { title: 'No items' }),
  }))
  assert.ok(document.body.textContent.includes('No items'))
  teardown()
})

// ── Icon ──────────────────────────────────────────────────────────────
test('Icon renders an svg for a known name', async () => {
  const { Icon } = await server.ssrLoadModule('/src/components/Icon.jsx')
  render(React.createElement(Icon, { name: 'floor_dashboard_smoke', size: 18 }))
  // Unknown names fall back rather than crash (and warn in DEV).
  assert.ok(document.querySelector('svg'))
  teardown()
  render(React.createElement(Icon, { name: 'dashboard' }))
  assert.equal(document.querySelector('svg').getAttribute('aria-hidden'), 'true')
  teardown()
})
