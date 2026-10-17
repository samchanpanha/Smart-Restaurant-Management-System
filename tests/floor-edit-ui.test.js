// ─── Floor arrangement UI, in a real DOM ────────────────────────────
// Arrange mode paints the room-size controls, the draggable zone
// rectangles, and a resize grip on every tile. Renaming a zone through
// the chip → editor modal round-trips into the store. Pointer geometry
// is not measurable in jsdom (zero rect sizes), so drags are covered at
// the reducer level in floor-layout.test.js — this file proves the
// controls exist and wire the right actions.

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
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: React } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')
const { setAppLang: setLang } = await server.ssrLoadModule('/src/lib/i18n.js')

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
const byLabel = (label) => $$(`[aria-label="${label}"]`)[0]
function click(node) {
  assert.ok(node, 'clicked node exists')
  act(() => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
}
function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  act(() => { input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}

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

async function openFloor() {
  dom.window.localStorage.clear()
  dom.window.sessionStorage.clear()
  // The clear above also wipes the language choice (i18n default is Khmer).
  setLang('en')
  if (root) act(() => { root.unmount() })
  container?.remove()
  mount()
  await settle(60)
  const nav = $$('button').find((entry) => (entry.textContent || '').trim() === 'Floor')
    || $$('button').find((entry) => (entry.textContent || '').includes('Floor'))
  assert.ok(nav, 'sidebar has a Floor entry')
  click(nav)
  await flush()
  await settle()
}

let unmounted = false

before(async () => {
  await openFloor()
})

after(() => {
  // The provider keeps recovery intervals alive otherwise.
  if (!unmounted) {
    act(() => { root.unmount() })
    unmounted = true
  }
  container?.remove()
  server.close()
  dom.window.close()
})

test('the floor map paints the seeded zone ribbons and tables', () => {
  const panel = document.querySelector('main') || document.body
  assert.ok(panel.textContent.includes('Restaurant floor'), 'map opened')
  for (const zone of ['Bar', 'Main', 'Patio']) {
    assert.ok(panel.textContent.includes(zone), `zone ribbon for ${zone}`)
  }
})

test('arrange mode reveals room controls, zone rename chips, and tile grips', async () => {
  const arrange = $$('button').find((entry) => (entry.textContent || '').includes('Arrange layout'))
  assert.ok(arrange, 'Arrange layout button exists')
  click(arrange)
  await settle()

  assert.ok(byLabel('Room width larger'), 'room width stepper up')
  assert.ok(byLabel('Room width smaller'), 'room width stepper down')
  assert.ok(byLabel('Room height larger'), 'room height stepper up')
  assert.ok(byLabel('Room height smaller'), 'room height stepper down')
  assert.ok(byLabel('Resize room'), 'room corner grip')
  assert.ok(text().includes('✎'), 'zone rename chips carry the ✎ marker')
  const grips = $$('[aria-label^="Resize Table"]')
  assert.ok(grips.length >= 3, `tiles expose resize grips — saw ${grips.length}`)

  const widthUp = byLabel('Room width larger')
  click(widthUp)
  await settle()
  // jsdom has no layout, so the stepper starts from the 960px fallback
  // and lands on the 50px snap grid.
  assert.ok(text().includes('W 1000'), 'the room width stepper applied 960 → 1000')
})

test('the zone chip opens the editor and renames the zone', async () => {
  // Arrange mode is still on from the previous test run of this file.
  const chip = $$('button').find((entry) => (entry.textContent || '').includes('✎'))
  assert.ok(chip, 'a rename chip exists in arrange mode')
  click(chip)
  await settle()
  assert.ok(text().includes('Edit zone'), 'ZoneEditorModal opened')
  assert.equal(text().includes('Something went wrong'), false)

  const input = $$('input[aria-label="Zone name"]')[0]
  assert.ok(input, 'zone name field exists')
  setValue(input, 'Rooftop')
  click($$('button').find((entry) => (entry.textContent || '').trim() === 'Save zone'))
  await settle()
  assert.ok(text().includes('Rooftop'), 'renamed zone renders on the map')
  assert.equal(text().includes('Edit zone'), false, 'modal closed after save')
})

test('the table editor picks a zone from the real records or creates one', async () => {
  // Leave arrange mode the way the user left it.
  const done = $$('button').find((entry) => (entry.textContent || '').includes('Done arranging'))
  if (done) click(done)
  await settle()
  const manage = byLabel('Manage tables')
  assert.ok(manage, 'Manage tables button exists')
  click(manage)
  await settle()
  click($$('button').find((entry) => (entry.textContent || '').includes('Add table')))
  await settle()
  assert.ok(text().includes('Add table'), 'TableEditorModal opened')

  const zoneSelect = $$('select[aria-label="Zone"]')[0]
  assert.ok(zoneSelect, 'zone field is a picker of real zone records')
  const options = [...zoneSelect.options].map((option) => option.value)
  assert.ok(options.includes('Rooftop'), 'renamed zone listed — saw: ' + options.join(', '))
  assert.ok(options.includes('__new'), 'picker offers to create a new zone')

  const nameInput = $$('input[aria-label="Table name"]')[0]
  setValue(nameInput, 'Pool Test')
  click($$('button').find((entry) => (entry.textContent || '').trim() === 'Add table'))
  await settle()
  assert.equal(text().includes('Something went wrong'), false, 'save stayed clean')
})
