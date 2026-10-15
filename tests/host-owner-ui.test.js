// ─── A registered host owner manages Users and Roles ────────────────
// The reported failure, driven the way it was reported: register from the
// sign-in screen, then open **Users** and **Roles** and actually add a person
// and a role. The real auth router runs against a scratch SQLite file, so the
// write path is exercised for real — it used to answer
// 400 "an owner is required" for the host owner that registration creates,
// because a super admin without `?ownerId=` had no restaurant to write to.
//
// Reads alone would not have caught it: the roster loaded (200) and only the
// buttons failed, so this test goes all the way to a staff member and a role.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

// A fresh install: no accounts, no SUPERADMIN_* env — so the first account to
// register is the host owner (super admin) *and* owns the restaurant.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-host-owner-'))
process.env.RESTORA_DATA = dataDir
delete process.env.SUPERADMIN_EMAIL
delete process.env.SUPERADMIN_PASSWORD
delete process.env.SUPERADMIN_NAME

const express = (await import('express')).default
const { createAuthRouter, seedAuth } = await import('../server/auth.js')

const OWNER = { ownerName: 'Harbor Bistro', name: 'Hana Host', email: 'hana@harbor.test', password: 'hana-pass-123' }
const STAFF = { name: 'Sam Server', email: 'sam@harbor.test', password: 'sam-pass-1234', role: 'Server' }

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
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
dom.window.localStorage.clear()

// Relative /api calls go to the scratch server; the app's own transport (the
// code that carries the session) adds the bearer token.
const nodeFetch = globalThis.fetch
const calls = []
const forward = async (input, init) => {
  const raw = typeof input === 'string' ? input : input?.url
  const res = await nodeFetch(raw?.startsWith('/') ? base + raw : raw, init)
  calls.push({ method: init?.method || 'GET', url: raw, status: res.status })
  return res
}
globalThis.fetch = forward
dom.window.fetch = forward

let server = null
let base = ''

before(async () => {
  const app = express()
  app.use(express.json())
  seedAuth()
  app.use(createAuthRouter())
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  // The app's own requests come from undici, which keeps sockets alive; close
  // them too or the hook waits forever for connections that never end.
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.() })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { installApiTransport } = await vite.ssrLoadModule('/src/lib/api.js')
const { AuthProvider, useAuth } = await vite.ssrLoadModule('/src/lib/auth.jsx')
const { RestoraProvider } = await vite.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await vite.ssrLoadModule('/src/components/AppShell.jsx')
const { default: AuthScreen } = await vite.ssrLoadModule('/src/screens/AuthScreen.jsx')
const { Router } = await vite.ssrLoadModule('/src/App.jsx')
const { setAppLang } = await vite.ssrLoadModule('/src/lib/i18n.js')
installApiTransport()
setAppLang('en')
after(async () => { await vite.close() })

/** Sign in first, then the workspace — the same hand-off App.jsx does. */
function Harness() {
  const { user } = useAuth()
  if (!user) return React.createElement(AuthScreen)
  return React.createElement(RestoraProvider, { waitForServer: false },
    React.createElement(AppShell, null, React.createElement(Router)))
}

const settle = async (ms = 120) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const panel = () => document.querySelector('main')?.textContent || document.body.textContent || ''
const settled = () => !panel().includes('Opening…') && !panel().includes('Loading…')
const until = async (predicate, ms = 8000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await settle()
  }
  return predicate()
}
const byPlaceholder = (text) => [...document.querySelectorAll('input')].find((el) => el.placeholder === text)
const navButton = (label) => [...document.querySelectorAll('nav button')].find((b) => (b.textContent || '').trim().startsWith(label))
const click = (el) => act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
const type = (el, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const choose = (el, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
})

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
act(() => {
  root.render(React.createElement(AuthProvider, null, React.createElement(Harness)))
})

test('registering a host owner leads into Users and Roles they can write', async (t) => {
  // Unmount even when an assertion fails: the mounted workspace ticks (clock,
  // live link), and a test that leaves it mounted never lets node exit.
  t.after(() => {
    try { act(() => { root.unmount() }) } catch { /* already gone */ }
    container.remove()
  })

  // ── Register from the sign-in screen ────────────────────────────
  assert.ok(await until(() => byPlaceholder('you@restaurant.com')), 'the sign-in screen rendered')
  const registerTab = [...document.querySelectorAll('button')].find((b) => /create account|register|sign up/i.test(b.textContent || ''))
  if (registerTab && !byPlaceholder('Harbor Bistro')) click(registerTab)
  assert.ok(await until(() => byPlaceholder('Harbor Bistro')), 'register mode asks for the restaurant name')

  type(byPlaceholder('Harbor Bistro'), OWNER.ownerName)
  type(byPlaceholder('Nora Owner'), OWNER.name)
  type(byPlaceholder('you@restaurant.com'), OWNER.email)
  type(byPlaceholder('At least 8 characters'), OWNER.password)
  click(document.querySelector('form button[type="submit"]'))

  // ── In the workspace, with the owner's screens ──────────────────
  assert.ok(await until(() => Boolean(navButton('Users'))), 'registration lands in the workspace')
  const nav = [...document.querySelectorAll('nav button')].map((b) => (b.textContent || '').trim())
  assert.ok(nav.includes('Users') && nav.includes('Roles'), 'Users and Roles are in the sidebar')
  assert.ok(nav.includes('Host owners'), 'the first account is the host owner')

  // ── Users: the roster is this restaurant, and it accepts a write ─
  click(navButton('Users'))
  assert.ok(await until(() => settled() && /person|people/.test(panel())), 'the roster loaded')
  assert.ok(panel().includes(OWNER.email), 'the host owner is in their own roster')
  assert.ok(!/restricted|is not part of/i.test(panel()), 'Users is not a restricted screen')

  const [nameInput, emailInput, passwordInput] = [...document.querySelectorAll('form input')]
  const roleSelect = document.querySelector('form select')
  const staffRole = [...roleSelect.options].find((option) => option.textContent.trim() === STAFF.role)
  assert.ok(staffRole, 'the standard roles are offered')
  type(nameInput, STAFF.name)
  type(emailInput, STAFF.email)
  type(passwordInput, STAFF.password)
  choose(roleSelect, staffRole.value)
  click(document.querySelector('form button[type="submit"]'))
  assert.ok(await until(() => settled() && panel().includes(STAFF.email)), 'the staff member was added')
  const createUser = calls.find((call) => call.method === 'POST' && call.url.startsWith('/api/users'))
  assert.equal(createUser.status, 201, 'POST /api/users answered 201 for the host owner')

  // ── Roles: system roles plus one of their own ────────────────────
  click(navButton('Roles'))
  assert.ok(await until(() => settled() && /Each role is a set of screens/i.test(panel())), 'the role list loaded')
  const [labelInput, keyInput] = [...document.querySelectorAll('form input')]
  type(labelInput, 'Shift lead')
  if (keyInput) type(keyInput, 'shift_lead')
  const firstBox = document.querySelector('form input[type="checkbox"]')
  if (firstBox) click(firstBox)
  click(document.querySelector('form button[type="submit"]'))
  assert.ok(await until(() => settled() && /Shift lead/.test(panel())), 'the new role was created')
  const createRole = calls.find((call) => call.method === 'POST' && call.url.startsWith('/api/roles'))
  assert.equal(createRole.status, 201, 'POST /api/roles answered 201 for the host owner')

  // Every per-restaurant request named the restaurant, and nothing failed.
  const scoped = calls.filter((call) => /^\/api\/(users|roles)/.test(call.url))
  assert.ok(scoped.length >= 5, `the screens read and wrote through the API: ${JSON.stringify(calls)}`)
  assert.ok(scoped.every((call) => call.url.includes('ownerId=')), `per-restaurant calls name the restaurant: ${JSON.stringify(scoped)}`)
  // /api/state belongs to the state server, which this scratch app does not
  // mount — every route it does serve has to have answered.
  const failed = calls.filter((call) => call.status >= 400 && !call.url.startsWith('/api/state') && !call.url.startsWith('/api/events'))
  assert.ok(!failed.length, `no failed request: ${JSON.stringify(failed)}`)

  // The workspace itself never touched another tenant.
  const myRestaurant = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${dom.window.localStorage.getItem('restora-session-token')}` } }).then((res) => res.json())
  assert.equal(myRestaurant.user.owner.name, OWNER.ownerName)

})
