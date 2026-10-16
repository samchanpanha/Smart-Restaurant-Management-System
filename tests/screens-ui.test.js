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

// hmr: false — several UI test files boot Vite at once and every
// middleware-mode server would otherwise try to bind the same HMR port.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
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
  assistant: 'Ops Copilot',
  settings: 'Settings & Documents',
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
// Lazy screens resolve through a Suspense fallback ("Opening…"). Poll until it
// clears so a slow chunk (e.g. Reports, which lazy-loads its charts) can't flake.
const flush = async () => {
  for (let i = 0; i < 100 && text().includes('Opening…'); i++) {
    await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)) })
  }
}
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
      await flush()
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

test('the dashboard renders the spec §9.1 widgets', async () => {
  await freshApp()
  clickNav('Dashboard')
  await settle()
  await flush()
  for (const id of [
    'dashboard-kpis',
    'dashboard-sales',
    'dashboard-sales-spark',
    'dashboard-alerts',
    'dashboard-menu-engineering',
    'dashboard-kitchen-sla',
    'dashboard-floor-snapshot',
  ]) {
    assert.ok(document.querySelector(`[data-testid="${id}"]`), `dashboard renders ${id}`)
  }
  assert.equal(panel().textContent.includes('Something went wrong'), false)
})

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
  await flush()
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

  act(() => { reportTab('Delivery').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(text().includes('Delivery performance'), 'delivery analytics tab opens')
  assert.ok(text().includes('On-time delivery'), 'delivery SLA breakdown renders')
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

test('a delivery check opens selected and appears in the delivery queue', async () => {
  await freshApp()
  clickNav('Tickets')
  await settle()

  act(() => { document.querySelector('[aria-label="New check"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  const deliveryType = document.querySelector('[data-testid="order-type-delivery"]')
  assert.ok(deliveryType, 'the delivery order type is available')
  act(() => { deliveryType.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const nameInput = $$('input').find((input) => input.getAttribute('aria-label') === 'Customer name')
  setValue(nameInput, 'Ava Chen')
  act(() => { document.querySelector('[aria-label="Start check"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(document.querySelector('[data-testid="delivery-fulfillment"]'), 'the new delivery opens in its workspace')
  assert.equal(document.querySelector('[data-testid="delivery-fulfillment"]').dataset.deliveryStatus, 'queued')

  const typeFilter = document.querySelector('[aria-label="Filter by order type"]')
  assert.ok(typeFilter, 'the order-type filter is available')
  typeFilter.value = 'delivery'
  act(() => { typeFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await settle()
  assert.ok($$('ul button').some((button) => button.textContent.includes('Ava Chen')), 'the delivery remains listed when filtered')
})

test('the composer quick-add and keyboard fire commit a ticket', async () => {
  await freshApp()
  clickNav('Tickets')
  await settle()

  // Open the first active ticket — its composer is where add/fire happens.
  const row = document.querySelector('ul button[aria-current]')
  assert.ok(row, 'an active ticket is listed')
  act(() => { row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  // Quick-add chip derived from order history.
  assert.ok(document.querySelector('[data-testid="quick-add"]'), 'the quick-add strip renders in the composer')
  const chip = document.querySelector('[data-testid="quick-add-chip"]')
  assert.ok(chip, 'a quick-add chip is offered')
  act(() => { chip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(text().includes('Held · not yet sent'), 'the quick-added line is held')

  // F fires the held lines to the kitchen without touching the mouse.
  act(() => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'f', bubbles: true })) })
  await settle()
  assert.ok(text().includes('In kitchen / served'), 'F fired the held line to the kitchen')
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

test('settings saves one section without publishing edits made in another', async () => {
  await freshApp()
  clickNav('Settings')
  await settle()

  const sectionPanel = document.querySelector('[aria-label="Settings sections"]')?.parentElement
  const nameInput = sectionPanel?.querySelector('input:not([type="checkbox"])')
  assert.ok(nameInput, 'the business identity form is on screen')

  setValue(nameInput, 'Test Kitchen')
  await settle()

  assert.ok(document.querySelector('[data-testid="section-dirty-business"]'), 'the business section is marked dirty')
  assert.ok(document.querySelector('[data-testid="section-dirty-money"]') === null, 'an untouched section stays clean')
  assert.ok(/unsaved edits/i.test(document.querySelector('[data-testid="section-save-status"]').textContent), 'the section footer warns about unsaved edits')

  const saveBusiness = document.querySelector('[data-testid="save-section-business"]')
  assert.ok(saveBusiness, 'the section save button exists')
  assert.equal(saveBusiness.disabled, false, 'the section save button is enabled while dirty')
  act(() => { saveBusiness.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.equal(document.querySelector('[data-testid="section-dirty-business"]'), null, 'saving clears the section marker')
  assert.ok(panel().textContent.includes('Test Kitchen'), 'the saved name is published to the store')
})

test('the AI section configures a provider instead of using the draft save bar', async () => {
  await freshApp()
  clickNav('Settings')
  await settle()

  const aiTab = [...document.querySelectorAll('[aria-label="Settings sections"] button')]
    .find((entry) => (entry.textContent || '').includes('Provider, model, API key'))
  assert.ok(aiTab, 'Settings lists an AI assistant section')
  act(() => { aiTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(document.querySelector('[data-testid="ai-config-provider"]'), 'the provider picker renders')
  assert.ok(document.querySelector('[data-testid="ai-config-key"]'), 'the key field renders')
  assert.ok(document.querySelector('[data-testid="ai-config-save"]'), 'the section has its own save button')
  assert.equal(document.querySelector('[data-testid="section-save-status"]'), null, 'the draft save bar is hidden for AI')
})

test('the setup wizard steps through sections and publishes on finish', async () => {
  await freshApp()
  clickNav('Settings')
  await settle()

  const open = document.querySelector('[data-testid="open-setup-wizard"]')
  assert.ok(open, 'the wizard entry point is offered')
  act(() => { open.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const wizard = document.querySelector('[data-testid="setup-wizard"]')
  assert.ok(wizard, 'the wizard opens')

  const steps = [...wizard.querySelectorAll('ol button')]
  assert.ok(steps.length >= 4, 'the wizard lists its steps')
  assert.equal(steps[0].getAttribute('aria-current'), 'true', 'it starts on the first step')

  const last = steps[steps.length - 1]
  act(() => { last.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const finish = [...wizard.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Finish setup')
  assert.ok(finish, 'the last step offers Finish setup')
  act(() => { finish.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.equal(document.querySelector('[data-testid="setup-wizard"]'), null, 'finishing closes the wizard')
  assert.equal(panel().textContent.includes('Something went wrong'), false)
})

test('reports wrap in a shared shell and saved views capture and restore the range', async () => {
  await freshApp()
  dom.window.localStorage.removeItem('restora.reports.views.v1')
  clickNav('Reports')
  await settle()
  await flush()

  // The default (Sales) report renders through the shared ReportShell header.
  assert.ok(panel().textContent.includes('Paid checks for the selected range'), 'the sales report shows its shell header')

  const rangeTab = (label) => $$('[aria-label="Date range"] [role="tab"]').find((tab) => (tab.textContent || '').includes(label))

  act(() => { rangeTab('7 days').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const saveBtn = document.querySelector('[data-testid="save-view"]')
  assert.ok(saveBtn, 'the save-view control is offered')
  act(() => { saveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const nameInput = document.querySelector('[aria-label="View name"]')
  assert.ok(nameInput, 'naming the view')
  setValue(nameInput, 'Week close')
  act(() => { document.querySelector('[data-testid="save-view-confirm"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const picker = document.querySelector('select[aria-label="Saved views"]')
  assert.ok(picker, 'the saved-views picker exists')
  assert.ok([...picker.options].some((option) => option.value === 'Week close'), 'the view is listed')

  // Move away from the saved state, then re-apply the view.
  act(() => { rangeTab('Tonight').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
  setter.call(picker, 'Week close')
  act(() => { picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await settle()

  assert.equal(rangeTab('7 days').getAttribute('aria-selected'), 'true', 'applying the view restores the range')

  act(() => { document.querySelector('[data-testid="delete-view"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok([...document.querySelector('select[aria-label="Saved views"]').options].every((option) => option.value !== 'Week close'), 'the view is deleted')
})

test('global quick search opens with Ctrl+K and navigates to an allowed screen', async () => {
  await freshApp()
  const input = document.querySelector('.global-search input')
  assert.ok(input, 'the global search input exists')

  act(() => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  })
  assert.equal(document.activeElement, input, 'Ctrl+K focuses the global search')
  assert.equal(input.getAttribute('aria-expanded'), 'true', 'the suggestion list opens')

  setValue(input, 'Reports')
  await settle(60)
  const listbox = document.querySelector('[role="listbox"]')
  assert.ok(listbox, 'search results render as an accessible listbox')
  const reportsOption = listbox.querySelector('#search-result-screen-reports')
  assert.ok(reportsOption, 'an allowed Reports screen is searchable even when its label is translated')

  act(() => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await settle(60)
  await flush()
  assert.ok(panel().textContent.includes('Reports & Analytics'), 'Enter opens the selected screen')
})

