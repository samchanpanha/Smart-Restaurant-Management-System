// ─── Deployment brand in the browser ────────────────────────────────
// The public /api/branding fetch paints the browser chrome (title,
// favicon, home-screen manifest) and the sign-in screen from one cached
// module: custom strings survive without a provider, a save re-renders
// every mounted surface, and clearing the fields restores the built-in
// Restora defaults.

import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM(`<!doctype html><html><head>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
</head><body><div id="root"></div></body></html>`, {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'CustomEvent', 'location', 'history']) {
  globalThis[key] = dom.window[key]
}
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.requestAnimationFrame = (cb) => dom.window.setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = globalThis.ResizeObserver
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
dom.window.matchMedia = globalThis.matchMedia
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
const LOGO = 'data:image/png;base64,AAAA'
const KHMER_TAGLINE = 'គ្រប់គ្រង · បម្រើ · រីកចម្រើន'

let stored = { name: 'Restora', tagline: KHMER_TAGLINE, logoUrl: '', iconUrl: ICON }
const puts = []

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
globalThis.fetch = async (url, opts = {}) => {
  const href = String(url)
  if (href.includes('/api/branding')) {
    if ((opts.method || 'GET') === 'PUT') {
      const body = JSON.parse(opts.body || '{}')
      puts.push(body)
      stored = { ...stored, ...body }
      return json({ branding: stored })
    }
    return json({ branding: stored })
  }
  throw new Error(`offline: ${href}`)
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const branding = await server.ssrLoadModule('/src/lib/branding.js')
const { default: AuthScreen } = await server.ssrLoadModule('/src/screens/AuthScreen.jsx')

after(async () => {
  await server.close()
})

test('the public brand paints the browser chrome, and clearing restores defaults', async () => {
  await branding.loadBrand()
  assert.equal(branding.getBrand().name, 'Restora')
  assert.equal(branding.getBrand().iconUrl, ICON)
  assert.equal(document.title, `Restora — ${KHMER_TAGLINE}`)

  const icon = document.head.querySelector('link[rel="icon"]')
  assert.equal(icon.getAttribute('href'), ICON)
  assert.equal(icon.getAttribute('type'), 'image/svg+xml')
  assert.equal(document.head.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'), ICON)
  const manifest = document.head.querySelector('link[rel="manifest"]')
  assert.ok(manifest.getAttribute('href').startsWith('data:application/manifest+json,'))
  assert.ok(manifest.getAttribute('href').includes('Restora'))

  branding.applyBrand({ name: '', tagline: '', logoUrl: '', iconUrl: '' })
  assert.equal(document.title, 'Restora — Smart Restaurant Management')
  assert.equal(document.head.querySelector('link[rel="icon"]').getAttribute('href'), '/favicon.svg')
  assert.equal(document.head.querySelector('link[rel="icon"]').getAttribute('type'), 'image/svg+xml')
  assert.equal(document.head.querySelector('link[rel="apple-touch-icon"]'), null)
  assert.equal(document.head.querySelector('link[rel="manifest"]').getAttribute('href'), '/manifest.webmanifest')
})

test('the sign-in screen follows a save live', async () => {
  branding.applyBrand({ name: '', tagline: '', logoUrl: '', iconUrl: '' })
  const container = document.getElementById('root')
  const root = createRoot(container)
  try {
    await act(async () => { root.render(React.createElement(AuthScreen)) })
    assert.ok(container.textContent.includes('Restora'), 'the built-in name shows by default')
    assert.ok(container.textContent.includes(KHMER_TAGLINE), 'the localized tagline shows by default')

    await act(async () => {
      const result = await branding.saveBrandingConfig({
        name: 'Bistro Hub',
        tagline: 'Fresh · Fast · Friendly',
        logoUrl: LOGO,
        iconUrl: ICON,
      })
      assert.equal(result.ok, true)
    })

    assert.equal(puts.at(-1).name, 'Bistro Hub')
    assert.ok(container.textContent.includes('Bistro Hub'), 'the name follows the save')
    assert.ok(container.textContent.includes('Fresh · Fast · Friendly'), 'the custom tagline replaces the localized default')
    assert.ok(container.querySelector(`img[src="${ICON}"]`), 'the square icon shows in the badge')
    assert.ok(container.querySelector(`img[src="${LOGO}"]`), 'the wide logo shows where there is room')
  } finally {
    await act(async () => { root.unmount() })
  }
})
