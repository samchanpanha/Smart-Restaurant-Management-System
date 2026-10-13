// ─── Workspace tabs, driven in a real DOM ───────────────────────────
// The tab strip is the piece operators touch all shift, so these tests
// mount the real AppShell + Router in jsdom and click it the way a
// manager would: nav → tab, second screen → second tab, close, cycle,
// role switch, reload persistence.
//
// Components are loaded through Vite's SSR pipeline (they are .jsx);
// React itself comes from Node so jsdom's globals apply to one instance.

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
// The provider persists state through these globals, exactly as in a browser.
globalThis.localStorage = dom.window.localStorage
globalThis.sessionStorage = dom.window.sessionStorage
globalThis.requestAnimationFrame = (cb) => dom.window.setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = globalThis.ResizeObserver
dom.window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
  if (options && typeof options === 'object') this.scrollLeft = options.left ?? this.scrollLeft
}
dom.window.HTMLElement.prototype.setPointerCapture = function setPointerCapture() {}
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.matchMedia = dom.window.matchMedia
// No server in this test: the provider must fall back to the local demo.
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
const { NAV_SECTIONS, SCREEN_ICONS } = await server.ssrLoadModule('/src/lib/constants.js')

const flush = async () => { await act(async () => { await Promise.resolve() }) }
// The provider boots asynchronously: /api/state fails here, which must land
// the terminal in local-demo mode before any screen renders.
const settled = async () => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 30)) })
}
const $$ = (selector) => [...document.querySelectorAll(selector)]
// Screens have their own inner tabs — scope to the workspace strip.
const tabButtons = () => $$('.tab-list [role="tab"]')
const selectedIndex = () => tabButtons().findIndex((tab) => tab.getAttribute('aria-selected') === 'true')

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

function click(el) {
  act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, button: 0 })) })
}

function keydown(key, { alt = false, ctrl = false, meta = false, shift = false } = {}) {
  act(() => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key, altKey: alt, ctrlKey: ctrl, metaKey: meta, shiftKey: shift, bubbles: true, cancelable: true,
    }))
  })
}

// Scope nav lookups to the sidebar: dashboard cards reuse these words.
const navButton = (label) => [...document.querySelectorAll('.app-sidebar button, nav[aria-label="Main navigation"] button')]
  .find((b) => b.textContent.includes(label))

// The role switcher lives inside the profile menu — open it, then pick.
async function setRole(nextRole) {
  if (!document.querySelector('#role')) {
    const profile = [...document.querySelectorAll('.global-actions button')]
      .find((button) => button.getAttribute('aria-expanded') !== null && !button.getAttribute('aria-label'))
    assert.ok(profile, 'the profile menu button exists')
    click(profile)
    await flush()
  }
  const select = document.querySelector('#role')
  assert.ok(select, 'the demo role switcher exists')
  act(() => {
    select.value = nextRole
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await flush()
}

/** Clean workspace, fresh mount — tests must not lean on each other. */
async function freshApp() {
  if (root) {
    act(() => root.unmount())
    container.remove()
  }
  dom.window.sessionStorage.clear()
  dom.window.localStorage.clear()
  mount()
  await settled()
}

before(async () => {
  mount()
  await settled()
})

after(async () => {
  act(() => root.unmount())
  container.remove()
  await server.close()
})

test('the app boots with one tab showing the role home screen', () => {
  assert.equal(tabButtons().length, 1)
  assert.match(tabButtons()[0].textContent, /Floor/)
  assert.match(container.textContent, /Manage table status/)
})

test('clicking a sidebar entry edits the active tab instead of piling up tabs', async () => {
  await freshApp()
  const inventoryNav = navButton('Inventory')
  assert.ok(inventoryNav, 'inventory nav item exists')
  click(inventoryNav)
  await flush()
  assert.equal(tabButtons().length, 1)
  assert.match(tabButtons()[0].textContent, /Inventory/)
  assert.match(container.textContent, /Stock control/)
})

test('a new tab can hold another screen while the first keeps its own', async () => {
  await freshApp()
  click(navButton('Inventory'))
  await flush()
  const newTab = $$('button').find((b) => b.getAttribute('aria-label') === 'Open a new tab')
  assert.ok(newTab, 'the + button exists')
  click(newTab)
  await flush()
  assert.equal(tabButtons().length, 2)

  click(navButton('Reports'))
  await flush()
  assert.match(container.textContent, /Reports & Analytics/)

  click(tabButtons()[0])
  await flush()
  assert.match(container.textContent, /Stock control/)
})

test('Alt+1…9 and Ctrl+PageUp/PageDown move between tabs and wrap around', async () => {
  await freshApp()
  click(navButton('Inventory'))
  await flush()
  // Second tab: Reports · third tab: the role home screen.
  click($$('button').find((b) => b.getAttribute('aria-label') === 'Open a new tab'))
  await flush()
  click(navButton('Reports'))
  await flush()
  click($$('button').find((b) => b.getAttribute('aria-label') === 'Open a new tab'))
  await flush()
  assert.equal(tabButtons().length, 3)

  keydown('1', { alt: true })
  await flush()
  assert.equal(selectedIndex(), 0)
  assert.match(container.textContent, /Stock control/)

  keydown('3', { alt: true })
  await flush()
  assert.equal(selectedIndex(), 2)

  keydown('PageUp', { ctrl: true })
  await flush()
  assert.equal(selectedIndex(), 1)
  assert.match(container.textContent, /Reports & Analytics/)

  keydown('PageDown', { ctrl: true })
  await flush()
  assert.equal(selectedIndex(), 2)

  // Cycling wraps instead of stopping at the edge.
  keydown('PageDown', { ctrl: true })
  await flush()
  assert.equal(selectedIndex(), 0)
  assert.match(container.textContent, /Stock control/)

  // Out-of-range digits are ignored, never crash.
  keydown('9', { alt: true })
  await flush()
  assert.equal(tabButtons().length, 3)
})

test('every sidebar screen has its own tab icon — no dashboard fallback', () => {
  const screens = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.id))
  for (const id of screens) {
    assert.ok(SCREEN_ICONS[id], `${id} has an icon`)
  }
  for (const id of ['catalog', 'suppliers', 'settings', 'system', 'purchases', 'reports', 'menu']) {
    assert.notEqual(SCREEN_ICONS[id], SCREEN_ICONS.dashboard)
  }
})

test('a tab draws the icon of the screen it holds', async () => {
  await freshApp()
  const dashboardIcon = tabButtons()[0].querySelector('svg')?.innerHTML
  click(navButton('Catalog'))
  await flush()
  assert.match(tabButtons()[0].textContent, /Catalog/)
  const catalogIcon = tabButtons()[0].querySelector('svg')?.innerHTML
  assert.notEqual(catalogIcon, dashboardIcon)
  click(navButton('Dashboard'))
  await flush()
})

test('Ctrl+W closes the active tab and focuses its neighbour', async () => {
  await freshApp()
  click(navButton('Inventory'))
  await flush()
  click($$('button').find((b) => b.getAttribute('aria-label') === 'Open a new tab'))
  await flush()
  click(navButton('Kitchen'))
  await flush()
  keydown('1', { alt: true })
  await flush()
  assert.equal(selectedIndex(), 0)
  assert.match(container.textContent, /Stock control/)

  keydown('w', { ctrl: true })
  await flush()
  assert.equal(tabButtons().length, 1)
  assert.equal(selectedIndex(), 0)
  assert.doesNotMatch(container.textContent, /Stock control/)
  assert.equal(tabButtons().some((tab) => tab.textContent.includes('Inventory')), false)
  assert.match(container.textContent, /Kitchen/)
})

test('closing every tab leaves one fresh tab on a screen the role can use', async () => {
  await freshApp()
  while (tabButtons().length > 1) {
    const closeButton = tabButtons()[0].parentElement.querySelector('button[aria-label^="Close"]')
    click(closeButton)
    await flush()
  }
  assert.equal(tabButtons().length, 1)

  click(tabButtons()[0].parentElement.querySelector('button[aria-label^="Close"]'))
  await flush()
  assert.equal(tabButtons().length, 1)
  assert.match(container.textContent, /Floor|Tables|Orders|Dashboard/)
})

test('switching role keeps the workspace, locks what the role cannot open', async () => {
  await freshApp()
  click(navButton('Inventory'))
  await flush()
  click($$('button').find((b) => b.getAttribute('aria-label') === 'Open a new tab'))
  await flush()
  click(navButton('Kitchen'))
  await flush()
  const labelsBefore = tabButtons().map((tab) => tab.textContent)
  assert.equal(labelsBefore.length, 2)

  await setRole('server')

  // Tabs stay on the strip — nothing is hidden, nothing is destroyed …
  assert.deepEqual(tabButtons().map((tab) => tab.textContent), labelsBefore)
  // … the screen the role cannot open is refused, with an explanation …
  assert.match(container.textContent, /not part of the server workspace/)
  assert.doesNotMatch(container.textContent, /Live kitchen display/)
  // … the nav offers only what the role may open …
  assert.equal(navButton('Settings'), undefined)
  assert.equal(navButton('Kitchen'), undefined)
  assert.ok(navButton('Tickets'))
  // … and switching back restores the very same tab untouched.
  await setRole('owner')
  assert.match(container.textContent, /Live kitchen display/)
  assert.ok(navButton('Settings'), 'owner gets the settings nav back')
})

test('a second tab the role can open stays live while another is restricted', async () => {
  await freshApp()
  click(navButton('Inventory'))
  await flush()
  click($$('button').find((b) => b.getAttribute('aria-label') === 'Open a new tab'))
  await flush()
  click(navButton('Kitchen'))
  await flush()
  await setRole('server')
  // Jump to the Inventory tab — the server role owns Tickets/Floor, so the
  // Inventory tab is restricted too; the Tickets tab renders fine.
  click(navButton('Tickets'))
  await flush()
  assert.match(container.textContent, /Track and manage every order/)
  keydown('1', { alt: true })
  await flush()
  assert.match(container.textContent, /not part of the server workspace/)
})

test('the workspace survives a reload on the same terminal', async () => {
  await freshApp()
  click(navButton('Inventory'))
  await flush()
  click($$('button').find((b) => b.getAttribute('aria-label') === 'Open a new tab'))
  await flush()
  click(navButton('Kitchen'))
  await flush()
  const before = tabButtons().map((tab) => tab.textContent)
  assert.equal(before.length, 2)
  assert.ok(dom.window.sessionStorage.getItem('restora-workspace-v1'), 'workspace is persisted')

  act(() => root.unmount())
  container.remove()
  mount() // no storage clear — this is the reload
  await settled()
  assert.deepEqual(tabButtons().map((tab) => tab.textContent), before)
  assert.equal(selectedIndex(), 1)
})
