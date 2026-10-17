// ─── Settings → Telegram bot & mini app, in a real DOM ──────────────
// Two fields, one save: the token (write-only, an untouched field must never
// erase it) and the Base URL guest links are built from (shown back, so the
// operator can see what is stored and what is actually in force).

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
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A tiny stand-in for /api/telegram/config: same shapes, same validation the
// server does, plus a record of what the screen actually sent.
const serverConfig = { token: '111:AAHtenanttoken', publicUrl: 'https://restora.onrender.com' }
const puts = []
const ENV_URL = 'https://from-render.onrender.com'

function view() {
  const saved = serverConfig.publicUrl || ''
  const effective = saved || ENV_URL
  return {
    ok: true,
    configured: Boolean(serverConfig.token),
    hasToken: Boolean(serverConfig.token),
    tokenSource: serverConfig.token ? 'tenant' : 'none',
    publicUrl: saved,
    publicUrlEffective: effective,
    publicUrlSource: saved ? 'tenant' : 'environment',
    webhookPath: '/api/telegram/webhook',
  }
}

globalThis.fetch = async (url, options = {}) => {
  if (!String(url).includes('/api/telegram/config')) throw new Error(`unexpected fetch ${url}`)
  if (options.method === 'PUT') {
    const body = JSON.parse(options.body || '{}')
    puts.push(body)
    if ('publicUrl' in body && body.publicUrl && !/^https?:\/\//i.test(body.publicUrl)) {
      return { ok: false, status: 400, json: async () => ({ ok: false, error: 'Base URL must start with http:// or https://' }) }
    }
    if ('token' in body) {
      if (body.token) serverConfig.token = body.token
      else delete serverConfig.token
    }
    if ('publicUrl' in body) {
      if (body.publicUrl) serverConfig.publicUrl = String(body.publicUrl).replace(/\/+$/, '')
      else delete serverConfig.publicUrl
    }
  }
  return { ok: true, json: async () => view() }
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { TelegramSection } = await server.ssrLoadModule('/src/screens/Settings/sections/Telegram.jsx')

let root = null
const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`)
const click = (el) => act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
// React tracks the last value it rendered, so go through the native setter.
const type = (el, value) => act(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
  descriptor.set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})

before(async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(TelegramSection)) })
  await settle()
})

after(async () => {
  await act(async () => { root?.unmount() })
  await server.close()
})

test('the field shows the saved address and what is actually in force', async () => {
  assert.equal(byTestId('telegram-config-status').textContent.trim(), 'On')
  assert.equal(byTestId('telegram-config-token').value, '', 'the token never comes back to the browser')
  assert.equal(byTestId('telegram-config-url').value, 'https://restora.onrender.com')
  const effective = byTestId('telegram-config-url-effective').textContent
  assert.match(effective, /https:\/\/restora\.onrender\.com/)
  assert.match(effective, /Saved here/)
})

test('saving the Base URL alone leaves the token untouched', async () => {
  puts.length = 0
  type(byTestId('telegram-config-url'), 'https://smart-restaurant-z8rs.onrender.com/')
  click(byTestId('telegram-config-save'))
  await settle()

  assert.deepEqual(puts, [{ publicUrl: 'https://smart-restaurant-z8rs.onrender.com/' }], 'only the changed field travels')
  assert.equal(serverConfig.token, '111:AAHtenanttoken', 'the stored token survives')
  assert.equal(byTestId('telegram-config-url').value, 'https://smart-restaurant-z8rs.onrender.com', 'trailing slash trimmed by the server')
  assert.match(byTestId('telegram-config-url-effective').textContent, /smart-restaurant-z8rs\.onrender\.com/)
})

test('a bad address is refused with the server’s reason', async () => {
  type(byTestId('telegram-config-url'), 'restora.example.com')
  click(byTestId('telegram-config-save'))
  await settle()
  assert.match(byTestId('telegram-config-error').textContent, /http:\/\/ or https:\/\//)
  assert.equal(byTestId('telegram-config-url').value, 'restora.example.com', 'the field keeps what was typed')
})

test('a new token saves together with the address', async () => {
  puts.length = 0
  type(byTestId('telegram-config-url'), '')
  type(byTestId('telegram-config-token'), '123456789:AAF-abc_DEF0123456789xyz')
  click(byTestId('telegram-config-save'))
  await settle()

  assert.deepEqual(puts, [{ token: '123456789:AAF-abc_DEF0123456789xyz', publicUrl: '' }], 'both fields travel once')
  assert.equal(serverConfig.publicUrl, undefined, 'cleared — the deployment address is used again')
  assert.equal(byTestId('telegram-config-token').value, '', 'the token field resets after saving')
  assert.match(byTestId('telegram-config-url-effective').textContent, /from-render\.onrender\.com/)
  assert.match(byTestId('telegram-config-url-effective').textContent, /This deployment/)
  assert.equal(byTestId('telegram-config-status').textContent.trim(), 'On')
})
