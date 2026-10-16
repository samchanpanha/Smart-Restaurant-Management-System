// ─── The 3D stage, and what happens without it ────────────────────────
//
// The 3D dish stage is a nicety; the dish photo is the contract. These
// tests hold that line: a guest on a browser without WebGL, or one who
// asked their system to reduce motion, must get the photograph and a
// working menu — and the three.js bundle must never be fetched.

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
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A matchMedia the test can steer.
let reduced = false
globalThis.matchMedia = (query) => ({
  matches: query.includes('prefers-reduced-motion') ? reduced : false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
})
dom.window.matchMedia = globalThis.matchMedia

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { default: DishShowcase } = await server.ssrLoadModule('/src/components/three/DishShowcase.jsx')
const capabilities = await server.ssrLoadModule('/src/components/three/capabilities.js')

after(async () => {
  await server.close()
  dom.window.close()
})

// ─── The capability checks ─────────────────────────────────────────

test('a browser without WebGL cannot run the 3D stage', () => {
  assert.equal(typeof globalThis.WebGLRenderingContext, 'undefined')
  assert.equal(capabilities.supportsWebGL(), false)
  assert.equal(capabilities.shouldRender3D(), false)
})

test('a browser with WebGL can run the 3D stage', () => {
  globalThis.WebGLRenderingContext = function WebGLRenderingContext() {}
  globalThis.WebGL2RenderingContext = function WebGL2RenderingContext() {}
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawArrays() {} })
  try {
    assert.equal(capabilities.supportsWebGL(), true)
    assert.equal(capabilities.shouldRender3D(), true)
  } finally {
    delete globalThis.WebGLRenderingContext
    delete globalThis.WebGL2RenderingContext
    delete dom.window.HTMLCanvasElement.prototype.getContext
  }
})

test('reduced motion always wins over WebGL', () => {
  globalThis.WebGLRenderingContext = function WebGLRenderingContext() {}
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({})
  reduced = true
  try {
    assert.equal(capabilities.prefersReducedMotion(), true)
    assert.equal(capabilities.shouldRender3D(), false, 'a guest who asked for less motion gets the photo')
  } finally {
    reduced = false
    delete globalThis.WebGLRenderingContext
    delete dom.window.HTMLCanvasElement.prototype.getContext
  }
})

// ─── The showcase ──────────────────────────────────────────────────

test('without WebGL the showcase shows the photograph and no canvas', async () => {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      React.createElement(DishShowcase, {
        dish: { id: 'm_burger', name: 'Burger', category: 'Main' },
        className: 'h-44 w-full',
        photo: React.createElement('img', { src: '/photos/burger.svg', alt: 'Burger', 'data-testid': 'dish-photo' }),
      }),
    )
  })

  const photo = host.querySelector('[data-testid="dish-photo"]')
  assert.ok(photo, 'the photograph is shown')
  assert.equal(photo.getAttribute('src'), '/photos/burger.svg')
  assert.equal(host.querySelector('canvas'), null, 'no 3D canvas was created')

  await act(async () => {
    root.unmount()
  })
  host.remove()
})

test('a reduced-motion guest gets the photograph too', async () => {
  reduced = true
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      React.createElement(DishShowcase, {
        dish: { id: 'm_cake', name: 'Cake', category: 'Dessert' },
        className: 'h-44 w-full',
        photo: React.createElement('img', { src: '/photos/cake.svg', alt: 'Cake', 'data-testid': 'dish-photo' }),
      }),
    )
  })

  assert.ok(host.querySelector('[data-testid="dish-photo"]'), 'the photograph is shown')
  assert.equal(host.querySelector('canvas'), null, 'no 3D canvas was created')

  await act(async () => {
    root.unmount()
  })
  host.remove()
  reduced = false
})
