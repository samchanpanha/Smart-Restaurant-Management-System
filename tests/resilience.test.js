// ─── Wave 2: resilience + shared plumbing ───────────────────────────
// The shared clock, the screen error boundary and the single role-gate
// helper. Same Vite middlewareMode + jsdom harness as the other UI suites.

import assert from 'node:assert/strict'
import test, { after } from 'node:test'
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { ClockProvider, useNow } = await server.ssrLoadModule('/src/lib/clock.jsx')
const { ErrorBoundary } = await server.ssrLoadModule('/src/components/ErrorBoundary.jsx')
const { ROLE_NAV, allowedScreens } = await server.ssrLoadModule('/src/lib/constants.js')

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

const sleep = (ms) => new Promise((resolve) => dom.window.setTimeout(resolve, ms))

after(async () => {
  teardown()
  await server.close()
})

// ── allowedScreens: one gate for the whole app ─────────────────────────
test('allowedScreens prefers an explicit custom-role list', () => {
  assert.deepEqual(allowedScreens('owner', ['floor', 'menu']), ['floor', 'menu'])
})

test('allowedScreens falls back to the role map, and to owner by default', () => {
  assert.deepEqual(allowedScreens('server', null), ROLE_NAV.server)
  assert.deepEqual(allowedScreens('server', []), ROLE_NAV.server)
  assert.deepEqual(allowedScreens('nobody', null), ROLE_NAV.owner)
})

// ── shared clock ───────────────────────────────────────────────────────
test('useNow subscribers tick on the shared clock', async () => {
  function Probe() {
    const now = useNow(10)
    return React.createElement('span', { 'data-now': String(now) }, String(now))
  }
  const el = render(React.createElement(ClockProvider, null, React.createElement(Probe)))
  const first = el.querySelector('span').getAttribute('data-now')
  await act(async () => { await sleep(320) })
  const second = el.querySelector('span').getAttribute('data-now')
  assert.notEqual(second, first, 'the clock advanced and re-rendered the subscriber')
  teardown()
})

// ── error boundary ─────────────────────────────────────────────────────
test('a throwing screen is caught and offers a recovery card', () => {
  const originalError = console.error
  console.error = () => {}
  try {
    function Bomb() { throw new Error('kaboom') }
    const el = render(React.createElement(ErrorBoundary, null, React.createElement(Bomb)))
    assert.match(el.textContent, /Something went wrong/)
    assert.match(el.textContent, /kaboom/)
  } finally {
    console.error = originalError
  }
  teardown()
})

test('the boundary resets when the tab (resetKey) changes', () => {
  const originalError = console.error
  console.error = () => {}
  try {
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('kaboom')
      return React.createElement('div', { id: 'ok' }, 'safe')
    }
    const el = render(React.createElement(ErrorBoundary, { resetKey: 'a' }, React.createElement(Flaky)))
    assert.match(el.textContent, /Something went wrong/)
    shouldThrow = false
    act(() => { root.render(React.createElement(ErrorBoundary, { resetKey: 'b' }, React.createElement(Flaky))) })
    assert.ok(el.querySelector('#ok'), 'the recovered child rendered')
  } finally {
    console.error = originalError
  }
  teardown()
})

test('the "Try again" button clears a recovered error', () => {
  const originalError = console.error
  console.error = () => {}
  try {
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('kaboom')
      return React.createElement('div', { id: 'ok' }, 'safe')
    }
    const el = render(React.createElement(ErrorBoundary, null, React.createElement(Flaky)))
    assert.match(el.textContent, /Something went wrong/)
    shouldThrow = false
    const button = [...el.querySelectorAll('button')].find((b) => /try again/i.test(b.textContent))
    assert.ok(button, 'recovery button exists')
    act(() => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.ok(el.querySelector('#ok'), 'the child rendered after retry')
  } finally {
    console.error = originalError
  }
  teardown()
})
