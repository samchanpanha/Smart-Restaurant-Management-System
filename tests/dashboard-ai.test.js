// ─── Dashboard AI widgets, in a real DOM ─────────────────────────────
// Phase 3 proof: when the server reports a configured key, the dashboard
// shows the AI alert explainer and the shift-briefing banner, both of which
// round-trip through /api/ai/* without a real server. When AI is off, both
// render nothing and the plain alerts rail is all that shows.

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

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
globalThis.fetch = async (url, opts) => {
  const href = String(url)
  if (href.includes('/api/ai/status')) return json({ configured: true, provider: 'openai', model: 'gpt-4o-mini' })
  if (href.includes('/api/ai/insight')) {
    const kind = JSON.parse(opts?.body || '{}').kind
    const replies = {
      alert: 'Cap the grill — two tickets trail the SLA.',
      menu: 'Reprice the duck — it trails on contribution.',
      forecast: 'Prep more greens before the 7pm rush.',
    }
    return json({ ok: true, kind, reply: replies[kind] || 'ok' })
  }
  if (href.includes('/api/ai/briefing')) return json({ ok: true, reply: 'Focus on the grill through the rush.', delivered: true })
  throw new Error('offline')
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: DashboardScreen } = await server.ssrLoadModule('/src/screens/Dashboard/index.jsx')
const { default: AiInsight } = await server.ssrLoadModule('/src/screens/Dashboard/sections/AiInsight.jsx')
const { default: ShiftBriefing } = await server.ssrLoadModule('/src/screens/Dashboard/sections/ShiftBriefing.jsx')
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
      React.createElement(RestoraProvider, { waitForServer: false }, React.createElement(DashboardScreen)),
    )
  })
  await settle(60)
})

after(() => {
  act(() => { root?.unmount() })
  container?.remove()
  server.close()
})

test('the dashboard renders the AI explainer and shift briefing when configured', () => {
  assert.ok(text().includes('AI explainer'), 'AI explainer card renders')
  assert.ok(text().includes('Menu advisor'), 'menu advisor card renders')
  assert.ok(text().includes('Prep forecast'), 'prep forecast card renders')
  assert.ok(text().includes('Shift briefing'), 'shift briefing card renders')
  assert.ok(text().includes('Insight for you'), 'the plain alerts rail still renders alongside it')
})

test('the alert explainer produces an insight reply', async () => {
  clickText('Explain alerts')
  await settle(40)
  assert.ok(text().includes('Cap the grill'), 'the insight line renders')
})

test('the menu and forecast advisors return their own replies', async () => {
  clickText('Advise on the menu')
  await settle(40)
  assert.ok(text().includes('Reprice the duck'), 'the menu advisor line renders')
  clickText('Forecast prep')
  await settle(40)
  assert.ok(text().includes('Prep more greens'), 'the forecast line renders')
})

test('the shift briefing generates and pushes to Telegram', async () => {
  clickText('Generate briefing')
  await settle(40)
  assert.ok(text().includes('Focus on the grill through the rush.'), 'the briefing text renders')
  clickText('Push to Telegram')
  await settle(40)
  assert.ok(text().includes('Sent to Telegram'), 'delivery is confirmed')
})

test('the AI widgets render nothing when AI is not configured', async () => {
  const off = document.createElement('div')
  document.body.appendChild(off)
  const offRoot = createRoot(off)
  const props = { copy: {}, configured: false, lang: 'en', locId: 'downtown' }
  act(() => {
    offRoot.render(
      React.createElement('div', null,
        React.createElement(AiInsight, { ...props, kind: 'alert' }),
        React.createElement(AiInsight, { ...props, kind: 'menu', title: 'Menu advisor' }),
        React.createElement(AiInsight, { ...props, kind: 'forecast', title: 'Prep forecast' }),
        React.createElement(ShiftBriefing, { ...props, title: 'Shift briefing' }),
      ),
    )
  })
  await settle(20)
  assert.equal(off.textContent, '', 'no AI markup when unconfigured')
  act(() => { offRoot.unmount() })
  off.remove()
})
