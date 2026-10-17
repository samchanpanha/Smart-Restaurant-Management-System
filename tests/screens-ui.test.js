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

// The app answers with its own dialogs now. A native alert/confirm/prompt
// anywhere in the screen walk is a regression: they freeze a tablet and
// cannot be styled.
const nativeDialogs = []
for (const name of ['alert', 'confirm', 'prompt']) {
  dom.window[name] = () => {
    nativeDialogs.push(name)
    return false
  }
}

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
  schedule: 'Weekly shift schedule',
  waste: 'Waste tracking',
}

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const text = () => document.body.textContent || ''
// Lazy screens resolve through a Suspense fallback ("Opening…"). Poll until it
// clears so a slow chunk (e.g. Reports, which lazy-loads its charts) can't flake.
// Real-time budget, not a fixed tick count: under a parallel test suite a cold
// chunk once outlasted 100 ticks.
const flush = async (budgetMs = 4000) => {
  const deadline = Date.now() + budgetMs
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)) })
  while (text().includes('Opening…') && Date.now() < deadline) {
    await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 10)) })
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
      assert.deepEqual(nativeDialogs, [], `${item.id} used a native browser dialog`)
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

test('a not-counted ingredient drops off count sheets and the flag sticks', async () => {
  await freshApp()

  const openCountSheet = () => {
    const button = $$('button').find((entry) => (entry.textContent || '').includes('Count stock'))
    act(() => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  }
  const closeDialog = () => {
    const close = $$('button').find((entry) => entry.getAttribute('aria-label') === 'Close dialog')
      || $$('button').find((entry) => entry.textContent.trim() === 'Cancel')
    act(() => { close.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  }

  // Control: the bun is on the count sheet before any flag.
  clickNav('Stock movements')
  await settle(60)
  await flush()
  openCountSheet()
  await settle()
  let dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog.textContent.includes('SKU-1001'), 'the bun starts on the count sheet')
  closeDialog()
  await settle()

  // Flag it through the catalog editor.
  clickNav('Catalog')
  await settle(60)
  await flush()
  const ingredientsTab = $$('[role="tab"]').find((entry) => (entry.textContent || '').includes('Ingredients'))
  act(() => { ingredientsTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  const bunRow = () => [...panel().querySelectorAll('tr')].find((tr) => (tr.textContent || '').includes('SKU-1001'))
  act(() => { bunRow().querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  dialog = document.querySelector('[role="dialog"]')
  const checkbox = dialog.querySelector('input[type="checkbox"]')
  assert.equal(checkbox.checked, true, 'items start counted')
  act(() => { checkbox.click() })
  act(() => { dialog.querySelector('[data-testid="save-ingredient"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  // Reopening the editor proves the flag round-trips through save.
  act(() => { bunRow().querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  dialog = document.querySelector('[role="dialog"]')
  assert.equal(dialog.querySelector('input[type="checkbox"]').checked, false, 'the flag persisted')
  closeDialog()
  await settle()

  // The count sheet hides it and explains why.
  clickNav('Stock movements')
  await settle(60)
  openCountSheet()
  await settle()
  dialog = document.querySelector('[role="dialog"]')
  assert.equal(dialog.textContent.includes('SKU-1001'), false, 'the bun is hidden from the count sheet')
  assert.ok(text().includes('Not-counted items are hidden from this sheet.'), 'the sheet says why rows are missing')
  closeDialog()
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
  // A dish with required modifiers opens the picker before the line lands.
  const picker = document.querySelector('[role="dialog"]')
  if (picker) {
    for (const option of picker.querySelectorAll('[data-testid="modifier-option"]')) {
      act(() => { option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    }
    await settle()
    const add = document.querySelector('[data-testid="modifier-add"]')
    assert.ok(add, 'the modifier picker can confirm the line')
    act(() => { add.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await settle()
  }
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

test('a host owner adds a branch from Settings and opens it', async () => {
  await freshApp()
  clickNav('Settings')
  await settle()
  await flush()

  const branchesTab = [...document.querySelectorAll('[aria-label="Settings sections"] button')]
    .find((entry) => (entry.textContent || '').includes('Manage multiple locations/branches'))
  assert.ok(branchesTab, 'Settings lists a Branches section')
  act(() => { branchesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(document.querySelector('[data-testid="branch-downtown"]'), 'the seeded Downtown branch is listed')
  assert.ok(document.querySelector('[data-testid="branch-riverside"]'), 'the seeded Riverside branch is listed')
  assert.equal(document.querySelector('[data-testid="section-save-status"]'), null, 'branches has no draft save bar')

  setValue(document.querySelector('[data-testid="branch-name"]'), 'Airport')
  await settle()
  assert.equal(document.querySelector('[data-testid="branch-id"]').value, 'airport', 'the id follows the name')
  act(() => { document.querySelector('[data-testid="create-branch"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(document.querySelector('[data-testid="branch-airport"]'), 'the new branch is listed')
  assert.equal(
    document.querySelector('[data-testid="branch-airport"]').getAttribute('aria-current'),
    'true',
    'the terminal switches to the new branch',
  )
  assert.ok(text().includes('Open here'), 'the current branch keeps its English badge (mirrored when translated)')
})

test('a host owner removes a branch with an inline confirm and the workspace follows', async () => {
  await freshApp()
  clickNav('Settings')
  await settle()
  await flush()

  const branchesTab = [...document.querySelectorAll('[aria-label="Settings sections"] button')]
    .find((entry) => (entry.textContent || '').includes('Manage multiple locations/branches'))
  assert.ok(branchesTab, 'Settings lists a Branches section')
  act(() => { branchesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  // Two-step confirm: the first click arms, Keep disarms.
  assert.ok(document.querySelector('[data-testid="branch-riverside"]'), 'Riverside exists before removal')
  act(() => { document.querySelector('[data-testid="remove-branch-riverside"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(document.querySelector('[data-testid="confirm-remove-riverside"]'), 'the confirm step appears')
  act(() => { document.querySelector('[data-testid="keep-branch-riverside"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.equal(document.querySelector('[data-testid="confirm-remove-riverside"]'), null, 'Keep disarms the confirm')
  assert.ok(document.querySelector('[data-testid="branch-riverside"]'), 'Riverside survived Keep')

  // Remove for real: only that branch drops, and the last one can never go.
  act(() => { document.querySelector('[data-testid="remove-branch-riverside"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  act(() => { document.querySelector('[data-testid="confirm-remove-riverside"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.equal(document.querySelector('[data-testid="branch-riverside"]'), null, 'Riverside is gone')
  assert.ok(document.querySelector('[data-testid="branch-downtown"]'), 'Downtown stays')
  assert.equal(
    document.querySelector('[data-testid="remove-branch-downtown"]').disabled,
    true,
    'the last branch cannot be removed',
  )

  // Removing the branch the terminal stands on moves it to the first survivor.
  setValue(document.querySelector('[data-testid="branch-name"]'), 'Airport')
  await settle()
  act(() => { document.querySelector('[data-testid="create-branch"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.equal(document.querySelector('[data-testid="branch-airport"]').getAttribute('aria-current'), 'true', 'the terminal is on the new branch')
  act(() => { document.querySelector('[data-testid="remove-branch-airport"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  act(() => { document.querySelector('[data-testid="confirm-remove-airport"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.equal(document.querySelector('[data-testid="branch-airport"]'), null, 'Airport is gone')
  assert.equal(
    document.querySelector('[data-testid="branch-downtown"]').getAttribute('aria-current'),
    'true',
    'the terminal landed on the first remaining branch',
  )
})

test("the owner pushes one branch's menu to the others from Settings", async () => {
  await freshApp()

  // Downtown gets a dish the other branch has never seen.
  clickNav('Menu & Recipes')
  await settle()
  await flush()
  act(() => { document.querySelector('[data-testid="add-menu-item"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  setValue(document.querySelector('[data-testid="new-item-name"]'), 'Airport Exclusive')
  setValue(document.querySelector('[data-testid="new-item-category"]'), 'Mains')
  setValue(document.querySelector('[data-testid="new-item-price"]'), '9')
  await settle()
  act(() => { document.querySelector('[data-testid="create-menu-item"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  setValue(document.querySelector('[aria-label="Search dishes"]'), 'Airport Exclusive')
  await settle()
  assert.ok(text().includes('Airport Exclusive'), 'the new dish is on the Downtown menu')

  // Settings → Branches: the push is a two-step confirm like every other
  // destructive action, then reports how many branches took the menu.
  clickNav('Settings')
  await settle()
  await flush()
  const branchesTab = [...document.querySelectorAll('[aria-label="Settings sections"] button')]
    .find((entry) => (entry.textContent || '').includes('Manage multiple locations/branches'))
  act(() => { branchesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  assert.ok(document.querySelector('[data-testid="push-menu"]'), 'the push card is offered while another branch exists')
  act(() => { document.querySelector('[data-testid="push-menu"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(document.querySelector('[data-testid="confirm-push-menu"]'), 'the push asks before replacing other menus')
  act(() => { document.querySelector('[data-testid="confirm-push-menu"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.ok(text().includes('Menu pushed to 1 branch.'), 'the status reports the push (English mirror while translated)')

  // The receiver now carries the pushed dish: switch to Riverside and look.
  const riversideRow = document.querySelector('[data-testid="branch-riverside"]')
  act(() => { riversideRow.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.equal(document.querySelector('[data-testid="branch-riverside"]').getAttribute('aria-current'), 'true', 'the terminal switched to Riverside')

  clickNav('Menu & Recipes')
  await settle()
  await flush()
  setValue(document.querySelector('[aria-label="Search dishes"]'), 'Airport Exclusive')
  await settle()
  assert.ok(text().includes('Airport Exclusive'), 'the pushed dish landed on the Riverside menu')
})

test('the all-branches report compares locations and switches between them', async () => {
  await freshApp()
  clickNav('Reports')
  await settle()
  await flush()
  const reportTab = (label) => $$('[aria-label="Reports"] [role="tab"]').find((tab) => (tab.textContent || '').includes(label))

  const allBranches = reportTab('All branches')
  assert.ok(allBranches, 'the All branches tab is listed while the empire has more than one branch')
  act(() => { allBranches.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()

  const rows = $$('[data-testid^="branch-report-"]')
  assert.equal(rows.length, 2, 'one row per branch')
  const copy = text()
  assert.ok(copy.includes('Branch comparison'), 'the comparison card renders')
  assert.ok(copy.includes('Combined'), 'the combined totals row renders')
  for (const label of ['Net sales', 'Checks', 'Avg check', 'Covers', 'Top seller']) {
    assert.ok(copy.includes(label), `the table keeps its ${label} column (English mirror while translated)`)
  }

  // The row for the open branch is marked — Downtown, on a fresh boot.
  const openRow = rows.find((row) => row.getAttribute('aria-current') === 'true')
  assert.ok(openRow, 'the open branch is marked')
  assert.equal(openRow.getAttribute('data-testid'), 'branch-report-downtown')

  // Picking another branch moves the whole terminal there.
  const otherRow = rows.find((row) => row !== openRow)
  const otherId = otherRow.getAttribute('data-testid')
  act(() => { otherRow.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
  assert.equal(
    document.querySelector(`[data-testid="${otherId}"]`).getAttribute('aria-current'),
    'true',
    'the picked branch becomes the open one',
  )
})

test('the Help center hands a question to the Ops Copilot', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('/api/ai/status')) {
      return { ok: true, json: async () => ({ configured: true, provider: 'openai', model: 'gpt-4o-mini' }) }
    }
    if (target.includes('/api/ai/')) {
      return { ok: true, json: async () => ({ ok: true, reply: 'Open the floor and tap a free table.' }) }
    }
    // Anything else (state, actions) fails — the app stays in local demo mode.
    return { ok: false, status: 404, json: async () => ({}) }
  }
  try {
    await freshApp()
    clickNav('Settings')
    await settle()

    const aiTab = [...document.querySelectorAll('[aria-label="Settings sections"] button')]
      .find((entry) => (entry.textContent || '').includes('Provider, model, API key'))
    act(() => { aiTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await settle()

    const guidesTab = [...document.querySelectorAll('button')]
      .find((entry) => (entry.textContent || '').includes('Guides & How-to'))
    assert.ok(guidesTab, 'the AI section offers a Guides tab')
    act(() => { guidesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await settle()

    const prompt = [...document.querySelectorAll('button')]
      .find((entry) => (entry.textContent || '').includes('What needs attention right now?'))
    assert.ok(prompt, 'the help center lists a quick prompt')
    act(() => { prompt.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await settle(80)
    await flush()

    assert.ok(text().includes('What needs attention right now?'), 'the question reached the copilot')
    assert.ok(calls.some((target) => target.includes('/api/ai/chat')), 'the copilot asked the AI')
  } finally {
    globalThis.fetch = originalFetch
  }
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
