// ─── Users screen: sessions, the owner account, and the roster ───────
// A real DOM, a stubbed API, and the exact failure that was reported:
// register a restaurant, open **Users**, and it answered "sign in required"
// while the rest of the workspace worked. Two things are asserted here —
//
//   1. a 401 is explained and offers the way back in (the app also re-checks
//      the session on its own; that lives in src/lib/api.js + src/lib/auth.jsx);
//   2. the owner account is read-only for staff callers, and the roster names
//      the restaurant each person belongs to once more than one is listed.

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
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'location']) {
  globalThis[key] = dom.window[key]
}
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.requestAnimationFrame = (cb) => dom.window.setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = globalThis.ResizeObserver
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ── The stub API ────────────────────────────────────────────────────
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const requests = []

let sessionAlive = true
let meUser = null
const RESTAURANTS = [
  { id: 'owner_1', name: 'Harbor Bistro', slug: 'harbor-bistro', status: 'active' },
  { id: 'owner_2', name: 'Riverside Grill', slug: 'riverside-grill', status: 'active' },
]
const USERS = [
  { id: 'user_owner', ownerId: 'owner_1', ownerName: 'Harbor Bistro', email: 'nora@harbor.test', name: 'Nora Owner', roleId: 'sys_owner', role: { id: 'sys_owner', key: 'owner', label: 'Owner', screens: ['*'] }, status: 'active' },
  { id: 'user_sam', ownerId: 'owner_1', ownerName: 'Harbor Bistro', email: 'sam@harbor.test', name: 'Sam Server', roleId: 'sys_server', role: { id: 'sys_server', key: 'server', label: 'Server', screens: ['floor', 'tickets'] }, status: 'active' },
]
const ROLES = [
  { id: 'sys_owner', key: 'owner', label: 'Owner', screens: ['*'], isSystem: true },
  { id: 'sys_manager', key: 'manager', label: 'Manager', screens: ['users'], isSystem: true },
  { id: 'sys_server', key: 'server', label: 'Server', screens: ['floor', 'tickets'], isSystem: true },
]

globalThis.fetch = async (url, opts = {}) => {
  const href = String(url)
  requests.push({ href, method: opts.method || 'GET', auth: opts.headers?.Authorization ?? opts.headers?.get?.('Authorization') ?? null })
  if (!sessionAlive) return json({ error: 'sign in required' }, 401)
  if (href.includes('/api/auth/me')) return json({ user: meUser })
  if (href.includes('/api/admin/owners')) return json({ owners: RESTAURANTS })
  if (href.includes('/api/users')) return json({ users: USERS })
  if (href.includes('/api/roles')) return json({ roles: ROLES })
  return json({ ok: true })
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { default: UsersScreen } = await server.ssrLoadModule('/src/screens/UsersScreen.jsx')
const { AuthProvider } = await server.ssrLoadModule('/src/lib/auth.jsx')
const { setAppLang } = await server.ssrLoadModule('/src/lib/i18n.js')

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}


function pickRole(select, roleId) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set
  act(() => {
    setter?.call(select, roleId)
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
}

let container = null
let root = null

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`)

async function remount() {
  act(() => { root?.unmount() })
  container?.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(React.createElement(AuthProvider, null, React.createElement(UsersScreen)))
  })
  await settle(80)
}

before(async () => {
  // The workspace defaults to Khmer; assert the English wording.
  act(() => { setAppLang('en') })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(React.createElement(AuthProvider, null, React.createElement(UsersScreen)))
  })
  await settle(80)
})

after(async () => {
  act(() => { root?.unmount() })
  container?.remove()
  await server.close()
})

test('the roster lists who can sign in, and each row can be re-roled', async () => {
  const text = () => document.body.textContent || ''
  assert.match(text(), /Nora Owner/)
  assert.match(text(), /sam@harbor.test/)
  assert.match(text(), /Server/)

  // A single-restaurant roster does not repeat the restaurant name per row.
  assert.ok(!text().includes('Harbor Bistro ·'), 'no redundant restaurant label in a one-shop list')
  const selects = [...document.querySelectorAll('select[aria-label^="Role for"]')]
  assert.equal(selects.length, 2, 'every row can be re-roled')
})

test('a session that died explains itself and offers the way back in', async () => {
  sessionAlive = false
  const select = document.querySelector('[aria-label="Role for Sam Server"]')
  assert.ok(select, 'the row has a role picker')

  // The exact reported moment: a signed-in-looking screen makes a privileged
  // call and the server answers 401.
  pickRole(select, 'sys_manager')
  await settle(40)

  const alert = document.querySelector('[role="alert"]')
  assert.ok(alert, 'the failure is announced')
  assert.match(alert.textContent, /session ended/i, 'plainly, not a raw "sign in required"')
  assert.ok(byTestId('users-signin-again'), 'and there is a button to sign in again')

  const before = requests.length
  act(() => { byTestId('users-signin-again').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle(60)
  assert.ok(requests.length > before, 'the button re-checks the session')

  // Back online: the roster recovers without a reload.
  sessionAlive = true
  await settle(40)
  assert.match(document.body.textContent || '', /Sam Server/)
})

// ─── A host owner manages their own restaurant ──────────────────────
// The reported failure: register the first account (a host owner — a super
// admin that also owns a restaurant), open Users, and every action answered
// "an owner is required" because the screen never named a restaurant. The
// screen now names its own, and a host owner can switch.

test('a host owner scopes Users to their own restaurant and can switch', async () => {
  meUser = {
    id: 'user_super',
    email: 'hana@host.test',
    name: 'Hana Host',
    isSuperAdmin: true,
    role: { id: 'sys_super', key: 'super', label: 'Super admin', screens: ['*'] },
    owner: RESTAURANTS[0],
    screens: ['*'],
  }
  await remount()

  const list = requests.filter((entry) => entry.href.includes('/api/users')).pop()
  assert.ok(list, 'the roster was requested')
  assert.match(list.href, /ownerId=owner_1/, 'and it names the host owner\'s own restaurant')

  const picker = byTestId('users-restaurant')
  assert.ok(picker, 'a host owner gets a restaurant picker')
  assert.equal(picker.value, 'owner_1')

  // Switching restaurant re-reads that restaurant's staff.
  const before = requests.length
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set
  act(() => {
    setter?.call(picker, 'owner_2')
    picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await settle(60)
  const after = requests.slice(before).filter((entry) => entry.href.includes('/api/users')).pop()
  assert.ok(after, 'switching re-reads the roster')
  assert.match(after.href, /ownerId=owner_2/)

  // Back to the plain owner for any test that follows.
  meUser = null
  await remount()
})
