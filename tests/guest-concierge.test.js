// ─── Guest menu concierge, in a real DOM ────────────────────────────
// The QR guest page and the Telegram mini app share GuestScreen, so this
// covers both: a seated guest can ask about the menu, the question goes out
// with scope:'menu', and a dead AI endpoint degrades to a friendly note
// instead of breaking the menu.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/?guest=t08',
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
dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
dom.window.matchMedia = globalThis.matchMedia
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const chatRequests = []
let chatMode = 'ok'
globalThis.fetch = async (url, opts) => {
  const href = String(url)
  if (href.includes('/api/ai/status')) {
    return json({ configured: true, provider: 'openai', model: 'gpt-4o-mini', scopes: ['ops', 'menu'] })
  }
  if (href.includes('/api/ai/chat')) {
    chatRequests.push(JSON.parse(opts?.body || '{}'))
    if (chatMode === 'fail') return json({ ok: false, error: 'no AI_API_KEY configured' }, 503)
    if (chatMode === 'busy') return json({ ok: false, kind: 'busy', error: 'This model is currently experiencing high demand. Please try again later.' }, 502)
    return json({ ok: true, reply: 'The garden bowl is vegan and the wings can be made mild.' })
  }
  throw new Error('offline')
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: GuestScreen } = await server.ssrLoadModule('/src/screens/GuestScreen.jsx')
const { setAppLang } = await server.ssrLoadModule('/src/lib/i18n.js')

setAppLang('en')

const settle = async (ms = 20) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const text = () => document.body.textContent || ''
const buttons = () => [...document.querySelectorAll('button')]
function clickText(label) {
  const button = buttons().find((entry) => (entry.textContent || '').includes(label))
  assert.ok(button, `button "${label}" exists — saw: ${buttons().map((b) => b.textContent).join(' | ')}`)
  act(() => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
}

let root = null
let container = null

before(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(RestoraProvider, { waitForServer: false }, React.createElement(GuestScreen, { tableId: 't08' })),
    )
  })
  await settle(40)
})

after(() => {
  act(() => { root?.unmount() })
  container?.remove()
  server.close()
})

test('the guest menu offers the AI concierge', () => {
  assert.ok(text().includes('Menu help'), 'the menu-help trigger renders')
  assert.ok(text().includes('Mains'), 'the menu itself still renders')
})

test('asking a menu question posts with scope menu', async () => {
  clickText('Menu help')
  await settle(20)
  assert.ok(text().includes('Ask about the menu'), 'the concierge sheet opens')
  clickText('Gluten-free options?')
  await settle(40)
  assert.ok(text().includes('garden bowl'), 'the reply renders')
  assert.equal(chatRequests.at(-1).scope, 'menu', 'guest questions are always menu-scoped')
  assert.equal(chatRequests.at(-1).lang, 'en', 'the question carries the guest language')
})

test('a dead AI endpoint degrades to a note, not a broken menu', async () => {
  chatMode = 'fail'
  clickText('What’s spicy?')
  await settle(40)
  assert.ok(text().includes('The menu assistant is offline right now'), 'the unavailable note shows')
  assert.ok(text().includes('Mains'), 'the menu is still on screen')
})

test('a provider demand spike reads as busy, not offline, and hides the raw error', async () => {
  chatMode = 'busy'
  clickText('Desserts?')
  // aiChat retries a transient failure once; settle past the retry delay.
  await settle(700)
  assert.ok(text().includes('The menu assistant is busy right now'), 'the busy note shows')
  assert.ok(!text().includes('experiencing high demand'), 'the raw provider text never reaches a guest')
  chatMode = 'ok'
})
