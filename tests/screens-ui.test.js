// ─── Every owner screen renders, in a real DOM ──────────────────────
// The tab tests prove the workspace shell; this proves the contents.
// It boots the real provider + shell + router in jsdom with no server
// (local demo mode), walks the sidebar, and checks each screen paints
// its own heading instead of throwing.

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

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')
const { NAV_SECTIONS, ROLE_NAV } = await server.ssrLoadModule('/src/lib/constants.js')

// One marker per screen: something that only that screen prints.
const MARKERS = {
  dashboard: "Today's sales overview",
  floor: 'Restaurant floor',
  tickets: 'Orders',
  kitchen: 'Kitchen',
  menu: 'Menu & Recipes',
  catalog: 'Catalog',
  inventory: 'Inventory',
  movements: 'Stock movements',
  purchases: 'Reorder suggestions',
  suppliers: 'Suppliers',
  reports: 'Reports & Analytics',
  costing: 'Food Cost & Profit',
  settings: 'Settings & Documents',
  telegram: 'Telegram',
  settings: 'Settings',
  telegram: 'Telegram & Mini App',
  system: 'System & Model',
  users: 'Who can sign in to this restaurant',
  roles: 'Each role is a set of screens',
  owners: 'Every restaurant on the platform',
}

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const text = () => document.body.textContent || ''
const $$ = (selector) => [...document.querySelectorAll(selector)]
const panel = () => document.querySelector('[data-testid="screen-panel"]') || document.querySelector('main') || document.body

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

// Nav clicks open a tab per screen now, so each test starts from a clean
// single-tab workspace instead of piling tabs up to the limit.
async function freshApp() {
  act(() => { root?.unmount() })
  container?.remove()
  dom.window.localStorage.clear()
  dom.window.sessionStorage.clear()
  mount()
  await settle(60)
}

function clickNav(label) {
  const button = $$('.app-sidebar button, nav[aria-label="Main navigation"] button')
    .find((entry) => (entry.textContent || '').includes(label))
  assert.ok(button, `sidebar has a ${label} entry`)
  act(() => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
}

before(async () => {
  mount()
  await settle(60)
})

after(() => {
  act(() => { root?.unmount() })
  container?.remove()
  server.close()
})

test('boots into a screen instead of the connecting splash', () => {
  assert.ok(text().length > 400, 'the app painted real content')
  assert.equal(text().includes('Connecting to service'), false)
})

for (const section of NAV_SECTIONS) {
  for (const item of section.items) {
    // The super-admin console is not part of the demo owner workspace.
    if (!ROLE_NAV.owner.includes(item.id)) continue
    test(`${item.label} screen renders`, async () => {
      await freshApp()
      clickNav(item.label)
      await settle()
      const marker = MARKERS[item.id]
      if (marker) {
        assert.ok(
          panel().textContent.includes(marker),
          `${item.id} shows "${marker}" — saw: ${(panel().textContent || '').slice(0, 160)}`,
        )
      }
      assert.equal(panel().textContent.includes('Something went wrong'), false)
    })
  }
}

test('the purchases screen shows supplier totals and the seeded orders', async () => {
  await freshApp()
  clickNav('Purchases')
  await settle()
  const copy = panel().textContent
  assert.ok(copy.includes('On order'), 'open-order value card')
  assert.ok(copy.includes('Bought · 30 days'), 'spend card')
  assert.ok(copy.includes('PO-'), 'seeded PO numbers are listed')
  assert.ok(copy.includes('Harbor Fish') || copy.includes('Prime Meats') || copy.includes('Fresh Farms'), 'vendor names')
})

test('the movements screen reconciles opening + in − out', async () => {
  await freshApp()
  clickNav('Stock movements')
  await settle()
  const copy = panel().textContent
  assert.ok(copy.includes('Stock in') && copy.includes('Stock out'), 'in/out cards')
  assert.ok(copy.includes('Opened with'), 'baseline card')
  assert.ok(copy.includes('Opening stock') || copy.includes('Receipt') || copy.includes('baseline'), 'reason pills')

  // Flip to the by-item view: opening, in, out and on-hand for one SKU.
  const byItem = $$('button').find((entry) => entry.textContent.trim() === 'By item')
  assert.ok(byItem, 'By item view exists')
  act(() => { byItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(panel().textContent.includes('On hand'), 'by-item table shows on hand')
})

test('the report tabs read the ledger: sell/buy, P&L, top & bottom', async () => {
  await freshApp()
  clickNav('Reports')
  await settle()
  const reportTab = (label) => $$('[aria-label="Reports"] [role="tab"]').find((tab) => (tab.textContent || '').includes(label))
  const rangeTab = (label) => $$('[aria-label="Date range"] [role="tab"]').find((tab) => (tab.textContent || '').includes(label))

  // The seeded receipts landed two days ago, so the buying side is empty
  // tonight and populated on the 7-day range — prove the range is real.
  act(() => { rangeTab('7 days').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  act(() => { reportTab('Sell & buy in/out').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  let copy = text()
  assert.ok(copy.includes('Stock in / out'), 'in/out card')
  assert.ok(copy.includes('Spend by supplier'), 'buy side by supplier')
  assert.ok(copy.includes('Opening baseline'), 'the baseline leg is labelled')

  act(() => { reportTab('Profit & loss').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  copy = text()
  assert.ok(copy.includes('Cost of goods sold'), 'COGS line')
  assert.ok(copy.includes('Gross profit') && copy.includes('Operating result'), 'the ladder')
  assert.ok(copy.includes('Cash movement'), 'cash in/out')
  assert.ok(copy.includes('food cost'), 'food cost against the cap')

  act(() => { reportTab('Top & bottom').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  copy = text()
  assert.ok(copy.includes('Top sellers · revenue'), 'selling side rankings')
  const buySide = $$('button').find((entry) => entry.textContent.trim() === 'Buying side')
  act(() => { buySide.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(text().includes('Biggest buys · spend'), 'buying side rankings')

  // Back to tonight: no receipts in this window, so the buy cards say so
  // instead of inventing spend.
  act(() => { rangeTab('Tonight').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  act(() => { reportTab('Sell & buy in/out').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(text().includes('Nothing was received in this window'), 'tonight has no receipts')
  assert.ok(text().includes('Stock in / out'), 'the ledger legs still render')
})

test('the movements screen can open the count sheet', async () => {
  await freshApp()
  clickNav('Stock movements')
  await settle(60)
  const count = $$('button').find((entry) => entry.textContent.trim() === 'Count stock')
  assert.ok(count, 'count stock action exists')
  act(() => { count.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(text().includes('Count the store room'), 'count modal opened')
  const cancel = $$('button').find((entry) => entry.textContent.trim() === 'Cancel')
  act(() => { cancel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
})

// ─── Tickets & floor interactions ───────────────────────────────────

// React tracks the input's value itself; assigning `.value` directly is
// invisible to it. Go through the native setter so onChange fires.
function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  act(() => { input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}

test('filing a receipt from a paid ticket prints it and stamps a number', async () => {
  await freshApp()
  clickNav('Tickets')
  await settle()

  const paidTab = document.querySelector('[aria-label="Paid"]')
  assert.ok(paidTab, 'a Paid tab exists')
  act(() => { paidTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const row = $$('ul button[aria-current]')[0]
  assert.ok(row, 'a paid ticket is listed')
  act(() => { row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const fileBtn = $$('button').find((b) => (b.textContent || '').includes('Print & file receipt'))
  assert.ok(fileBtn, 'the Print & file receipt button is on the paid ticket')
  act(() => { fileBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(/sent to the printer/.test(text()), `a print confirmation flashed — saw: ${text().slice(0, 160)}`)
  assert.ok(/filed as RCT-/.test(text()), `the receipt number is filed — saw: ${text().slice(0, 200)}`)
  assert.ok($$('iframe').length >= 1, 'the print iframe was created')
})

test('a takeout order starts without a table and shows its customer', async () => {
  await freshApp()
  clickNav('Tickets')
  await settle()

  const newBtn = document.querySelector('[aria-label="New check"]')
  assert.ok(newBtn, 'the New check button exists')
  act(() => { newBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const takeout = $$('button').find((b) => b.textContent.trim() === 'Takeout')
  assert.ok(takeout, 'the Takeout order type is offered')
  act(() => { takeout.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const nameInput = $$('input').find((i) => i.getAttribute('aria-label') === 'Customer name')
  assert.ok(nameInput, 'the customer name field appears for takeout')
  setValue(nameInput, 'Nita Sok')
  await settle()

  const startBtn = document.querySelector('[aria-label="Start check"]')
  assert.ok(startBtn, 'the start-check button exists')
  act(() => { startBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(text().includes('Takeout · Nita Sok'), `the ticket names the takeout customer — saw: ${text().slice(0, 240)}`)
})

test('the floor manage mode adds a table', async () => {
  await freshApp()
  clickNav('Floor')
  await settle()

  const manage = document.querySelector('[aria-label="Manage tables"]')
  assert.ok(manage, 'the Manage tables control exists')
  act(() => { manage.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const addBtn = document.querySelector('[aria-label="Add table"]')
  assert.ok(addBtn, 'the add-table control appears in manage mode')
  act(() => { addBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const nameInput = document.querySelector('[aria-label="Table name"]')
  assert.ok(nameInput, 'the table editor opened')
  setValue(nameInput, 'Table 99')
  await settle()

  const saveBtn = document.querySelector('[aria-label="Save table"]')
  assert.ok(saveBtn, 'the Add table submit exists')
  act(() => { saveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(text().includes('Table 99'), 'the new table is listed on the floor')
})
