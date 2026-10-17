// ─── Offline terminal, end to end in a real DOM ─────────────────────
// A production terminal boots while the server is down (hasSeenServer
// set by a previous session), keeps selling, and queues what it did.
// The first-release gates hold: catalog edits refused, card payments
// refused, voids limited to locally-created orders. When the network
// returns, recover() replays the queue first and the authoritative
// snapshot lands on top — nothing is wiped and nothing double-applies.

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

// Boot-time outage: everything fetches fail until the test flips the stub.
globalThis.fetch = async () => { throw new Error('offline') }

// This terminal HAS seen a server before — it is a production terminal
// offline, not the pure localStorage demo.
dom.window.localStorage.setItem('restora-server-seen', '1')

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider, useRestora } = await server.ssrLoadModule('/src/lib/store.jsx')
const { clearOutbox, readOutbox, readConflicts, clearConflicts } = await server.ssrLoadModule('/src/lib/outbox.js')

// The probe hands the test the live store context.
const outlet = { current: null }
function Probe() {
  outlet.current = useRestora()
  return null
}

// The authoritative snapshot mirrors what the provider holds, so the
// fake server's /api/state always answers with the latest local truth
// (as the real one would after a flush).
const empireOut = { current: null }

let root = null

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}

before(async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(RestoraProvider, { }, React.createElement(Probe)))
  })
})

after(async () => {
  // Unmount clears the provider's recovery timers; without it the test
  // process has no empty event loop to exit on.
  await act(async () => { root?.unmount() })
  await server.close()
})

clearConflicts()
clearOutbox()

test('a production terminal boots offline, not into the demo', async () => {
  await settle()
  const rs = outlet.current
  assert.equal(rs.link.mode, 'local')
  assert.equal(rs.link.status, 'local')
  assert.ok(rs.state.menu.length > 0, 'cached menu paints from the localStorage snapshot')
})

test('catalog edits are refused offline and never queued', async () => {
  const rs = outlet.current
  const menuBefore = rs.state.menu.length
  await act(async () => {
    rs.dispatch({ type: 'ADD_MENU_ITEM', item: { name: 'Offline hacking', price: 999 } })
  })
  await settle()
  assert.equal(outlet.current.state.menu.length, menuBefore, 'menu untouched')
  assert.ok((outlet.current.notice || '').includes('needs the server'), 'operator sees why')
  assert.equal(outlet.current.queued, 0, 'nothing queued')
})

test('sales keep flowing: order lands locally and queues', async () => {
  const rs = outlet.current
  await act(async () => {
    rs.dispatch({ type: 'CREATE_ORDER', id: 'o-ui-1', orderType: 'takeout', customer: { name: 'Ava Chen', phone: '012' } })
  })
  await settle()
  const order = outlet.current.state.orders.find((o) => o.id === 'o-ui-1')
  assert.ok(order, 'optimistic order exists')
  assert.equal(outlet.current.queued, 1)
  const [entry] = readOutbox()
  assert.equal(entry.action.type, 'CREATE_ORDER')
  assert.equal(entry.action.id, 'o-ui-1')
  assert.equal(entry.financial, true)
})

test('offline voids: locally-created orders only', async () => {
  const rs = outlet.current
  await act(async () => {
    rs.dispatch({ type: 'VOID_ORDER', orderId: 'o-ui-1', reason: 'walk-in left' })
  })
  await settle()
  assert.equal(outlet.current.queued, 2, 'void of the offline order queued')
  await act(async () => {
    rs.dispatch({ type: 'VOID_ORDER', orderId: 'o-from-another-terminal', reason: 'must not pass' })
  })
  await settle()
  assert.equal(outlet.current.queued, 2, 'server order void refused')
  assert.ok((outlet.current.notice || '').includes('created on this terminal'), 'operator sees why')
  clearOutbox()
  await settle()
})

test('offline payments: cash only', async () => {
  const rs = outlet.current
  await act(async () => {
    rs.dispatch({ type: 'CREATE_ORDER', id: 'o-ui-2', orderType: 'takeout', customer: { name: 'Ava Chen', phone: '012' } })
    rs.dispatch({ type: 'ADD_ITEM', orderId: 'o-ui-2', menuItemId: outlet.current.state.menu[0].id, qty: 1 })
  })
  await settle()
  await act(async () => {
    // The ticket machine routes open → sent → paid: fire, then settle.
    rs.dispatch({ type: 'SEND_ORDER', orderId: 'o-ui-2' })
  })
  await settle()
  // Card refused.
  await act(async () => {
    rs.dispatch({ type: 'PAY_ORDER', orderId: 'o-ui-2', method: 'card' })
  })
  await settle()
  assert.ok((outlet.current.notice || '').includes('cash'), 'operator sees the cash-only rule')
  assert.notEqual(outlet.current.state.orders.find((o) => o.id === 'o-ui-2')?.status, 'paid')
  const before = outlet.current.queued
  // Cash accepted and queued.
  await act(async () => {
    rs.dispatch({ type: 'PAY_ORDER', orderId: 'o-ui-2', method: 'cash' })
  })
  await settle()
  assert.equal(outlet.current.state.orders.find((o) => o.id === 'o-ui-2')?.status, 'paid')
  assert.equal(outlet.current.queued, before + 1, 'the payment queues behind its order')
})

test('recover(): queue replays first, snapshot lands after — nothing wipes', async () => {
  clearConflicts()
  // The server is back: POSTs commit and answer with a seq; /api/state
  // serves the snapshot the terminal itself just had.
  const commits = []
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('/api/actions') || String(url).includes('/api/actions')) {
      const body = JSON.parse(options.body || '{}')
      const inner = body.action?.action || body.action || {}
      commits.push({
        type: inner.type,
        id: inner.id || null,
        lid: body.action?.action?._lid ?? body.action?._lid,
      })
      return { ok: true, json: async () => ({ seq: 100 + commits.length }) }
    }
    if (String(url).includes('/api/state')) {
      return { ok: true, json: async () => ({ state: empireOut.current, seq: 100 + commits.length }) }
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  outlet.current.empire && (empireOut.current = outlet.current.empire)
  let ok = false
  await act(async () => {
    ok = await outlet.current.recover()
  })
  assert.equal(ok, true, 'flush + resync both succeeded')
  assert.equal(outlet.current.queued, 0, 'queue drained')

  // FIFO replay of exactly what was queued when the network came back,
  // with the queue-local `_lid` travelling for server-side dedup.
  assert.deepEqual(
    commits.map((c) => c.type),
    ['CREATE_ORDER', 'ADD_ITEM', 'SEND_ORDER', 'PAY_ORDER'],
  )
  assert.ok(commits[0].lid, 'the queued `_lid` replays for server dedup')

  // The terminal came back as a server terminal and the offline work
  // survived the resync instead of being overwritten by it.
  await settle()
  const rs = outlet.current
  assert.equal(rs.link.status, 'live', 'link returned to live')
  assert.ok(rs.state.orders.find((o) => o.id === 'o-ui-1'), 'the offline order survived the resync')
  assert.equal(rs.state.orders.find((o) => o.id === 'o-ui-2')?.status, 'paid', 'the offline payment survived')
  assert.equal(rs.conflicts.length, 0)
})
