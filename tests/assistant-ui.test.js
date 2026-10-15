// ─── Ops Copilot screen, in a real DOM ───────────────────────────────
// Boots the real provider + the AssistantScreen with a stubbed AI API so we
// can prove the whole path offline-safe: status → status card, prompt → chat
// reply, and an advisor button → insight reply. No server needed.

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
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
dom.window.matchMedia = globalThis.matchMedia
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A stubbed AI API: /api/ai/* answers, everything else (the store boot) is
// offline so the provider falls back to the seeded local demo.
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
globalThis.fetch = async (url) => {
  const href = String(url)
  if (href.includes('/api/ai/status')) return json({ configured: true, provider: 'openai', model: 'gpt-4o-mini' })
  if (href.includes('/api/ai/chat')) return json({ ok: true, reply: 'Two tickets are running late.', provider: 'openai', model: 'gpt-4o-mini' })
  if (href.includes('/api/ai/insight')) return json({ ok: true, kind: 'alert', reply: 'Cap the grill — two tickets trail the SLA.' })
  if (href.includes('/api/ai/briefing')) return json({ ok: true, reply: 'Focus on the grill through the rush.', delivered: true })
  throw new Error('offline')
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AssistantScreen } = await server.ssrLoadModule('/src/screens/Assistant/index.jsx')
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
      React.createElement(RestoraProvider, { waitForServer: false }, React.createElement(AssistantScreen)),
    )
  })
  await settle(40)
})

after(() => {
  act(() => { root?.unmount() })
  container?.remove()
  server.close()
})

test('the copilot paints its heading and advisors', () => {
  assert.ok(text().includes('Ops Copilot'), 'heading renders')
  assert.ok(text().includes('Advisors'), 'advisor rail renders')
  assert.ok(text().includes('Shift briefing'), 'briefing card renders')
})

test('a suggested prompt produces a chat reply', async () => {
  clickText('What needs my attention right now?')
  await settle(40)
  assert.ok(text().includes('Two tickets are running late.'), 'the assistant reply lands in the transcript')
})

test('an advisor button produces an insight reply', async () => {
  clickText('Explain tonight’s alerts')
  await settle(40)
  assert.ok(text().includes('Cap the grill'), 'the insight answer renders')
  assert.ok(text().includes('Grounded in your live shift data'), 'the source line is shown')
})

test('the shift briefing can be generated and pushed', async () => {
  clickText('Generate briefing')
  await settle(40)
  assert.ok(text().includes('Focus on the grill through the rush.'), 'the briefing text renders')
  assert.ok(text().includes('sent to Telegram'), 'delivery is confirmed')
})
