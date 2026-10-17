// ─── Online-only terminal, end to end in a real DOM ─────────────────
// Restora keeps no offline lane: a change is applied only in the moment
// the server accepts it. While the link is down every dispatch is refused
// outright — nothing applied locally, nothing queued, no conflict records
// — so a terminal can never drift away from server truth. The one lane
// that still edits in place is the pure localStorage demo (`npm run dev`),
// which has no server to sync to.

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
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.matchMedia = dom.window.matchMedia
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Boot-time outage: every fetch fails until a test flips the stub.
globalThis.fetch = async () => { throw new Error('offline') }

// This terminal HAS met a server before — it is a production terminal in
// an outage, not the pure localStorage demo.
dom.window.localStorage.setItem('restora-server-seen', '1')

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider, useRestora } = await server.ssrLoadModule('/src/lib/store.jsx')

// The probe hands the test the live store context.
const outlet = { current: null }
function Probe() {
  outlet.current = useRestora()
  return null
}

// What the fake server answers /api/state with: the truth the terminal is
// allowed to hold.
const serverTruth = { current: null }
const commits = []

let root = null

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}

before(async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(RestoraProvider, {}, React.createElement(Probe)))
  })
})

after(async () => {
  // Unmount clears the provider's reconnect timers; without it the test
  // process has no empty event loop to exit on.
  await act(async () => { root?.unmount() })
  await server.close()
})

test('a production terminal boots offline, not into the demo', async () => {
  await settle()
  const rs = outlet.current
  assert.equal(rs.link.mode, 'local')
  assert.equal(rs.link.status, 'local')
  assert.ok(rs.state.menu.length > 0, 'the cached snapshot still paints')
})

test('while the link is down every change is refused — never applied, never queued', async () => {
  const rs = outlet.current
  const ordersBefore = rs.state.orders.length
  const menuBefore = rs.state.menu.length

  await act(async () => {
    // A sale: the action that used to be queued for later.
    rs.dispatch({ type: 'CREATE_ORDER', id: 'o-offline-1', orderType: 'takeout', customer: { name: 'Ava Chen', phone: '012' } })
  })
  await settle()
  assert.equal(outlet.current.state.orders.length, ordersBefore, 'no optimistic order')
  assert.ok((outlet.current.notice || '').includes('not saved'), 'the operator is told why')

  await act(async () => {
    // A catalog edit, and an empire-level reseed for good measure.
    rs.dispatch({ type: 'ADD_MENU_ITEM', item: { name: 'Half-saved dish', price: 999 } })
    rs.dispatch({ type: 'RESET_ALL' })
  })
  await settle()
  assert.equal(outlet.current.state.menu.length, menuBefore, 'menu untouched')
  assert.equal(outlet.current.state.orders.length, ordersBefore, 'reseed refused too')

  // There is no back channel: the old outbox/conflict keys are never written.
  assert.equal(dom.window.localStorage.getItem('restora-outbox-v1'), null, 'no outbox queue')
  assert.equal(dom.window.localStorage.getItem('restora-conflicts-v1'), null, 'no conflict records')
})

test('when the server answers the terminal goes live and commits with a _lid', async () => {
  serverTruth.current = outlet.current.empire
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    if (href.includes('/api/actions')) {
      const body = JSON.parse(options.body || '{}')
      commits.push({
        type: body.action?.action?.type,
        id: body.action?.action?.id || null,
        lid: body.action?.action?._lid ?? body.action?._lid,
      })
      return { ok: true, json: async () => ({ seq: 10 + commits.length }) }
    }
    if (href.includes('/api/state')) {
      return { ok: true, json: async () => ({ state: serverTruth.current, seq: 10 }) }
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  let ok = false
  await act(async () => { ok = await outlet.current.resync() })
  assert.equal(ok, true, 'resync reached the server')
  assert.equal(outlet.current.link.status, 'live', 'link is live again')

  await act(async () => {
    outlet.current.dispatch({ type: 'CREATE_ORDER', id: 'o-online-1', orderType: 'takeout', customer: { name: 'Ava Chen', phone: '012' } })
  })
  await settle()
  assert.ok(outlet.current.state.orders.find((o) => o.id === 'o-online-1'), 'order applied')
  assert.deepEqual(commits.map((c) => c.type), ['CREATE_ORDER'], 'exactly one commit, no replay')
  assert.ok(commits[0].lid, 'the commit carries its `_lid` for server-side dedup')
})

test('a POST that dies mid-flight is not retried — server truth wins on the next resync', async () => {
  const truth = outlet.current.empire // accepted by the server a moment ago
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('/api/actions')) throw new Error('network died mid-flight')
    if (href.includes('/api/state')) {
      return { ok: true, json: async () => ({ state: truth, seq: 20 }) }
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  await act(async () => {
    outlet.current.dispatch({ type: 'CREATE_ORDER', id: 'o-lost-1', orderType: 'takeout', customer: { name: 'Ava Chen', phone: '012' } })
  })
  await settle(80)

  const rs = outlet.current
  assert.ok((rs.notice || '').includes('nothing was saved'), 'the loss is announced, not hidden')
  assert.equal(rs.state.orders.find((o) => o.id === 'o-lost-1'), undefined, 'the uncommitted edit is dropped')
  assert.ok(rs.state.orders.find((o) => o.id === 'o-online-1'), 'committed work is untouched')
  assert.equal(rs.link.status, 'live', 'the terminal is back in sync with the server')
  assert.equal(dom.window.localStorage.getItem('restora-outbox-v1'), null, 'nothing was parked for later')
})
