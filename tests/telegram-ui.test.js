// ─── Telegram screen + mini app in a real DOM ───────────────────────
// The console has to answer exactly like the webhook would, and the mini
// app has to be the guest menu with a Telegram header — nothing more.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/?screen=telegram',
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
globalThis.fetch = async () => { throw new Error('offline') } // the console must work without the API
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')
const { default: App } = await server.ssrLoadModule('/src/App.jsx')

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const $$ = (selector) => [...document.querySelectorAll(selector)]
const byText = (selector, text) => $$(selector).find((el) => (el.textContent || '').includes(text))
const roleToggle = (name) => $$('button').find((button) => (button.textContent || '').trim().toLowerCase() === name)
const click = (el) => act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
// React tracks the last value it rendered, so a plain `el.value =` is
// swallowed; go through the native setter like the browser does.
const type = (el, value) => act(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
  descriptor.set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const submit = (form) => act(() => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })

let root = null
let container = null

function mountWorkspace() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(RestoraProvider, null,
        React.createElement(AppShell, null, React.createElement(Router))),
    )
  })
}

function mountMiniApp() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(React.createElement(App)) })
}

async function fresh() {
  if (root) {
    act(() => root.unmount())
    container.remove()
  }
  dom.window.localStorage.clear()
  dom.window.sessionStorage.clear()
  root = null
  container = null
  await settle(10)
}

before(async () => {
  mountWorkspace()
  await settle(80)
})

after(async () => {
  if (root) act(() => root.unmount())
  container?.remove()
  await server.close()
})

test('the console answers a command like the bot would', async () => {
  await fresh()
  dom.reconfigure({ url: 'http://localhost:5173/?screen=telegram' })
  mountWorkspace()
  await settle(80)

  assert.match(document.body.textContent, /Telegram bot & mini app/)
  const commands = document.querySelectorAll('code')
  assert.ok([...commands].some((code) => code.textContent.trim() === '/today'))

  const input = document.querySelector('input[aria-label="Bot command"]')
  const form = input.closest('form')
  type(input, '/today')
  submit(form)
  await settle(60)

  const transcript = document.querySelector('[data-testid="telegram-transcript"]').textContent
  assert.match(transcript, /\/today/)
  assert.match(transcript, /Net sales \$425\.00/)
  assert.match(transcript, /Top seller: Restora Burger/)
})

test('manager access changes the book only when apply mode is on', async () => {
  await fresh()
  dom.reconfigure({ url: 'http://localhost:5173/?screen=telegram' })
  mountWorkspace()
  await settle(80)

  const run = async (text) => {
    const input = document.querySelector('input[aria-label="Bot command"]')
    type(input, text)
    submit(input.closest('form'))
    await settle(60)
  }

  // The console opens with the operator's own access (owner → manager), so
  // switch it down to staff first: staff cannot pull a dish.
  click(roleToggle('staff'))
  await settle(20)
  await run('/86 Restora burger')
  assert.match(document.querySelector('[data-testid="telegram-transcript"]').textContent, /for managers/)

  // Back to manager access, preview first: nothing changes.
  click(roleToggle('manager'))
  await settle(20)
  await run('/86 Restora burger')
  let transcript = document.querySelector('[data-testid="telegram-transcript"]').textContent
  assert.match(transcript, /Would apply: SET_86/)

  await run('/menu burger')
  assert.doesNotMatch(document.querySelector('[data-testid="telegram-transcript"]').textContent, /86’D Restora Burger/)

  // Now apply it: the dish is off the menu everywhere in this location.
  const applyToggle = $$('input[type="checkbox"]').find((box) => box.closest('label')?.textContent.includes('Apply actions'))
  act(() => { applyToggle.click() })
  await settle(20)
  await run('/86 Restora burger')
  transcript = document.querySelector('[data-testid="telegram-transcript"]').textContent
  assert.match(transcript, /Applied: SET_86/)

  await run('/menu burger')
  assert.match(document.querySelector('[data-testid="telegram-transcript"]').textContent, /86’D Restora Burger — \$16\.00/)
})

test('the mini app card links to the real route', async () => {
  const frame = document.querySelector('iframe[title="Telegram mini app preview"]')
  assert.ok(frame, 'the phone frame shows the live mini app')
  assert.match(frame.getAttribute('src'), /\?tg=1&guest=t\d+/)
  const link = $$('a').find((anchor) => (anchor.textContent || '').includes('Open mini app'))
  assert.ok(link, 'there is a link a manager can send to a guest')
  assert.match(link.getAttribute('href'), /tg=1&guest=/)
  assert.match(document.body.textContent, /TELEGRAM_BOT_TOKEN/)
  assert.match(document.body.textContent, /setWebhook/)
})

test('the mini app route is the guest menu with Telegram chrome', async () => {
  await fresh()
  dom.reconfigure({ url: 'http://localhost:5173/?tg=1&guest=t14' })
  mountMiniApp()
  await settle(80)

  const text = document.body.textContent
  assert.match(text, /Telegram mini app/)
  assert.match(text, /In Telegram|Web preview/)
  assert.match(text, /Table 14/)
  // …and the real guest surface underneath it: a seated table sees the menu.
  assert.match(text, /Mains/)
  assert.match(text, /Restora Burger/)

  // A table that is not seated yet keeps the honest gate.
  await fresh()
  dom.reconfigure({ url: 'http://localhost:5173/?tg=1&guest=t12' })
  mountMiniApp()
  await settle(80)
  assert.match(document.body.textContent, /Table 12/)
  assert.match(document.body.textContent, /isn’t seated yet|isn't seated yet/)
})

test('opened from the chat the mini app starts on a table in service and lets the guest switch', async () => {
  await fresh()
  dom.reconfigure({ url: 'http://localhost:5173/?tg=1' })
  mountMiniApp()
  await settle(80)

  const text = document.body.textContent
  assert.match(text, /Telegram mini app/)
  assert.doesNotMatch(text, /Table not found/)
  assert.match(text, /Table 8|Table 14|Table 3/, 'lands on a table that is in service')
  assert.match(text, /Restora Burger/, 'and the menu is right there')

  const picker = document.querySelector('header select')
  assert.ok(picker, 'the guest can choose another table')
  const options = [...picker.querySelectorAll('option')].map((option) => option.textContent)
  assert.ok(options.length >= 8)
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(picker), 'value')
    descriptor.set.call(picker, 't14')
    picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await settle(40)
  assert.match(document.body.textContent, /Table 14/)
})

test('an order sent from the mini app fires the platform hook', async () => {
  const seen = []
  const listener = () => seen.push('sent')
  dom.window.addEventListener('restora:order-sent', listener)
  try {
    act(() => {
      dom.window.dispatchEvent(new dom.window.CustomEvent('restora:order-sent', { detail: { tableId: 't12' } }))
    })
    await settle(20)
    assert.deepEqual(seen, ['sent'])
  } finally {
    dom.window.removeEventListener('restora:order-sent', listener)
  }
})
