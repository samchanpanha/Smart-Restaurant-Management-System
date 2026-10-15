// ─── Settings → AI assistant, in a real DOM ──────────────────────────
// The owner-facing half of the multi-key work: the provider picker knows the
// new vendors, the failover pool can be added to and saved without ever
// re-sending a stored key, a stored key can be tested by id, and the language
// switch writes <html lang> (which is what drives the Khmer type scale).
//
// Same Vite middleware harness as the other UI suites (hmr:false so parallel
// suites do not fight over the HMR port).

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
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent']) {
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

// A stubbed /api/ai/config: one DeepSeek primary plus one Qwen backup, exactly
// the shape server/ai-config.js returns (metadata only, never a key).
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const requests = []
let storedPool = [
  { id: 'key-2', label: 'Kitchen tablet', provider: 'qwen', model: '', baseUrl: '', hasKey: true, enabled: true },
]
const PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', tier: 'cheap', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], baseUrl: 'https://api.deepseek.com/v1', note: 'OpenAI-compatible and very cheap.', keysUrl: 'https://platform.deepseek.com/api_keys', alternates: [] },
  { id: 'qwen', label: 'Qwen (Alibaba DashScope, international)', tier: 'free', defaultModel: 'qwen-plus', models: ['qwen-plus', 'qwen-turbo'], baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', note: 'Free trial quota.', keysUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1', alternates: [{ label: 'Mainland China (dashscope.aliyuncs.com)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }] },
  { id: 'ollama', label: 'Ollama (local)', tier: 'local', defaultModel: 'llama3.1', models: ['llama3.1'], baseUrl: 'http://localhost:11434', note: 'No key needed.', keysUrl: '', alternates: [] },
]

globalThis.fetch = async (url, opts = {}) => {
  const href = String(url)
  requests.push({ href, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
  if (href.includes('/api/ai/status')) {
    return json({
      configured: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      keyCount: 2,
      rotate: false,
      pool: [
        { id: 'primary', label: 'Primary key', provider: 'deepseek', model: 'deepseek-chat', source: 'tenant', local: false, hasKey: true, status: 'cooldown', failures: 2, wins: 0, lastError: 'rate limited', lastOkAt: null },
        { id: 'key-2', label: 'Kitchen tablet', provider: 'qwen', model: 'qwen-plus', source: 'tenant', local: false, hasKey: true, status: 'ok', failures: 0, wins: 4, lastError: null, lastOkAt: '2026-10-15T12:00:00.000Z' },
      ],
    })
  }
  if (href.includes('/api/ai/config/test')) {
    return json({ ok: true, reply: 'OK', provider: 'qwen', model: 'qwen-plus', via: 'key-2' })
  }
  if (href.includes('/api/ai/config/models')) {
    return json({ ok: true, provider: 'deepseek', via: 'primary', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'] })
  }
  if (href.includes('/api/ai/config')) {
    if (opts.method === 'PUT') {
      const body = JSON.parse(opts.body || '{}')
      if (Array.isArray(body.keys)) {
        storedPool = body.keys.map((entry) => ({
          ...entry,
          hasKey: Boolean(entry.apiKey) || Boolean(storedPool.find((row) => row.id === entry.id)?.hasKey),
        }))
      }
      return json({ ok: true, provider: 'deepseek', model: 'deepseek-chat', baseUrl: '', hasKey: true, keySource: 'tenant', configured: true, keyCount: 1 + storedPool.length, poolCount: storedPool.length, rotate: Boolean(body.rotate), keys: storedPool, providers: PROVIDERS })
    }
    return json({
      ok: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: '',
      hasKey: true,
      keySource: 'tenant',
      configured: true,
      keyCount: 2,
      poolCount: 1,
      rotate: false,
      keys: storedPool,
      providers: PROVIDERS,
    })
  }
  throw new Error('offline')
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { AiSection } = await server.ssrLoadModule('/src/screens/Settings/sections/Ai.jsx')
const { setAppLang } = await server.ssrLoadModule('/src/lib/i18n.js')

const settle = async (ms = 25) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}

let container = null
let root = null

function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

function click(element) {
  act(() => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
}

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`)
const allRows = () => [...document.querySelectorAll('[data-testid="ai-config-key-row"]')]

before(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(React.createElement(AiSection)) })
  await settle(60)
})

after(async () => {
  act(() => { root?.unmount() })
  container?.remove()
  await server.close()
})

test('the provider picker offers the new vendors', () => {
  const select = byTestId('ai-config-provider')
  assert.ok(select, 'the provider picker renders')
  const options = [...select.querySelectorAll('option')].map((option) => option.value)
  assert.ok(options.includes('deepseek'), 'DeepSeek is selectable')
  assert.ok(options.includes('qwen'), 'Qwen is selectable')
  assert.ok(options.includes('ollama'), 'the local option is selectable')
  assert.match(select.textContent, /DeepSeek/)
  assert.match(select.textContent, /free tier/, 'the free tier is called out in the picker')
})

test('the free and local options are surfaced with a shortcut', () => {
  const text = document.body.textContent || ''
  assert.match(text, /Free and local options/)
  assert.match(text, /No key needed/)
  const useQwen = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Use this'))
  assert.ok(useQwen, 'a provider can be adopted in one click')
})

test('the stored backup key is listed without its secret', () => {
  const rows = allRows()
  assert.equal(rows.length, 1)
  const labelInput = rows[0].querySelector('input:not([type="password"]):not([type="checkbox"])')
  assert.equal(labelInput.value, 'Kitchen tablet', 'the saved label is shown')
  const keyInput = rows[0].querySelector('input[type="password"]')
  assert.equal(keyInput.value, '', 'the browser never receives a stored key')
  assert.match(keyInput.placeholder, /saved/)
})

test('adding a key marks the pool dirty and saves the new entry', async () => {
  click(byTestId('ai-config-key-add'))
  await settle()

  assert.equal(allRows().length, 2, 'a new empty row appears')
  assert.ok(byTestId('ai-config-key-dirty'), 'the unsaved marker shows')

  const row = allRows()[1]
  const inputs = [...row.querySelectorAll('input')]
  setValue(inputs.find((input) => input.type === 'password'), 'sk-brand-new')
  const labelInput = inputs.find((input) => input.type !== 'password' && input.type !== 'checkbox')
  setValue(labelInput, 'Second DeepSeek key')
  await settle()

  click(byTestId('ai-config-key-save'))
  await settle(60)

  const put = requests.filter((entry) => entry.method === 'PUT' && Array.isArray(entry.body?.keys)).pop()
  assert.ok(put, 'saving the pool sends a PUT')
  assert.equal(put.body.keys.length, 2)
  assert.equal(put.body.keys[1].apiKey, 'sk-brand-new')
  assert.equal(put.body.keys[1].label, 'Second DeepSeek key')
  assert.equal(put.body.keys[0].apiKey, undefined, 'the untouched stored key is not re-sent')
  assert.equal(byTestId('ai-config-key-dirty'), null, 'the dirty marker clears after saving')
})

test('the rotate toggle is saved with the pool', async () => {
  const toggle = byTestId('ai-config-rotate')
  assert.ok(toggle, 'the rotation toggle renders')
  click(toggle)
  await settle()
  const count = allRows().length
  click(byTestId('ai-config-key-save'))
  await settle(60)
  const put = requests.filter((entry) => entry.method === 'PUT' && entry.body?.rotate).pop()
  assert.ok(put, 'the rotate flag reached the server')
  assert.equal(allRows().length, count)
})

test('testing a stored key targets it by id', async () => {
  const row = allRows()[0]
  const testButton = [...row.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Test')
  click(testButton)
  await settle(60)

  const probe = requests.filter((entry) => entry.href.includes('/api/ai/config/test')).pop()
  assert.ok(probe, 'the test request went out')
  assert.equal(probe.body.keyId, 'key-2', 'a stored key is probed by id, never by value')
  assert.match(document.body.textContent, /Key OK/)
})

test('live key health is shown so a failing key is obvious', async () => {
  const text = document.body.textContent || ''
  assert.match(text, /Primary: Cooling down/, 'a key in cooldown is called out')
  assert.match(text, /2 failed attempt/, 'the failure count is shown')
  const row = allRows()[0]
  assert.match(row.textContent, /Working/, 'a healthy backup key reads as working')
})

test('the language switch writes <html lang> for the type scale', async () => {
  act(() => { setAppLang('en') })
  await settle()
  assert.equal(document.documentElement.lang, 'en-US')
  assert.equal(document.documentElement.dataset.lang, 'en')

  act(() => { setAppLang('km') })
  await settle()
  assert.equal(document.documentElement.lang, 'km-KH', 'Khmer gets its own tag so html[lang] styles apply')

  act(() => { setAppLang('en') })
  await settle()
})

test('the model field can pull the provider\'s live model list', async () => {
  const modelBefore = requests.filter((entry) => entry.href.includes('/api/ai/config/models')).length
  const button = document.querySelector('[data-testid="ai-config-load-models"]')
  assert.ok(button, 'the load button is rendered next to the model field')

  click(button)
  await settle(80)

  const calls = requests.filter((entry) => entry.href.includes('/api/ai/config/models'))
  assert.equal(calls.length, modelBefore + 1, 'one discovery request goes out')
  assert.equal(calls.at(-1).method, 'POST')
  assert.equal(calls.at(-1).body.provider, 'deepseek', 'the currently selected provider is asked')

  assert.match(document.body.textContent, /3 models available from deepseek/)
  const options = [...document.querySelectorAll('#ai-model-suggestions option')].map((node) => node.value)
  assert.ok(options.includes('deepseek-reasoner'), 'the live list feeds the datalist')
})
