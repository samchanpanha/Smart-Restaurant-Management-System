// ─── Kitchen screen: multi-photo items & Khmer/English/Chinese switcher ──

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/?role=kitchen&screen=kitchen',
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
dom.window.HTMLElement.prototype.setPointerCapture = function setPointerCapture() {}
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.matchMedia = dom.window.matchMedia
globalThis.fetch = async () => { throw new Error('offline') }
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

// hmr: false — several UI test files boot Vite at once and every
// middleware-mode server would otherwise try to bind the same HMR port.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')
const { DEFAULT_KITCHEN_LANG, KITCHEN_LANGUAGES, getItemImages } = await server.ssrLoadModule('/src/lib/kitchen-i18n.js')
const { buildEmpire } = await server.ssrLoadModule('/src/lib/reducer.js')

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const click = (el) => act(() => {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
})

let root = null
let container = null

function mount() {
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

async function freshKitchen() {
  if (root) {
    act(() => root.unmount())
    container.remove()
  }
  dom.window.localStorage.clear()
  dom.window.sessionStorage.clear()
  mount()
  await settle(60)
}

before(async () => {
  await freshKitchen()
})

after(async () => {
  act(() => { root?.unmount() })
  container?.remove()
  await server.close()
})

test('every seeded menu item carries multiple images in state', () => {
  const shop = buildEmpire().locations.downtown
  assert.equal(shop.menu.length, 13)
  for (const item of shop.menu) {
    assert.ok(item.imageUrl.startsWith('/photos/'), `${item.id} has primary photo`)
    const imgs = getItemImages(item)
    assert.ok(imgs.length >= 3, `${item.id} has at least 3 reference images, got ${imgs.length}`)
  }
})

test('Kitchen screen defaults to Khmer (km) and switches between Khmer, English, and Chinese', async () => {
  await freshKitchen()
  assert.equal(DEFAULT_KITCHEN_LANG, 'km')
  assert.deepEqual(KITCHEN_LANGUAGES.map((l) => l.id), ['km', 'en', 'zh'])

  const kmBtn = document.querySelector('[data-testid="kitchen-lang-km"]')
  const enBtn = document.querySelector('[data-testid="kitchen-lang-en"]')
  const zhBtn = document.querySelector('[data-testid="kitchen-lang-zh"]')
  assert.ok(kmBtn && enBtn && zhBtn, 'all three language buttons render')
  assert.equal(kmBtn.getAttribute('aria-pressed'), 'true', 'Khmer is active by default')
  assert.match(container.textContent, /ផ្ទះបាយ/, 'Khmer heading is shown by default')
  assert.match(container.textContent, /បឺហ្គឺរ រ៉េស្តូរ៉ា/, 'Khmer dish name is shown')

  // Switch to English
  click(enBtn)
  await settle()
  assert.equal(enBtn.getAttribute('aria-pressed'), 'true')
  assert.equal(dom.window.localStorage.getItem('restora-kitchen-lang'), 'en')
  assert.match(container.textContent, /Prioritize fired tickets/)
  assert.match(container.textContent, /Fired now/)

  // Switch to Chinese
  click(zhBtn)
  await settle()
  assert.equal(zhBtn.getAttribute('aria-pressed'), 'true')
  assert.equal(dom.window.localStorage.getItem('restora-kitchen-lang'), 'zh')
  assert.match(container.textContent, /厨房看板/)
  assert.match(container.textContent, /当前制作中/)
  assert.match(container.textContent, /招牌牛肉汉堡/)

  // Switch back to Khmer
  click(kmBtn)
  await settle()
  assert.equal(kmBtn.getAttribute('aria-pressed'), 'true')
  assert.equal(dom.window.localStorage.getItem('restora-kitchen-lang'), 'km')
  assert.match(container.textContent, /ផ្ទះបាយ/)
})

test('Kitchen screen displays multiple images per item on tickets and in the dish gallery', async () => {
  await freshKitchen()
  const burgerStrip = document.querySelector('[data-testid="item-photos-m_burger"]')
  assert.ok(burgerStrip, 'fired burger ticket line renders its multi-photo strip')
  const stripImages = burgerStrip.querySelectorAll('img')
  assert.ok(stripImages.length >= 4, `burger strip renders main image + 3 thumbnails (found ${stripImages.length})`)

  // The photo gallery is collapsed by default so the board stays fast.
  assert.equal(document.querySelector('[data-testid="kitchen-dish-gallery"]'), null, 'gallery is closed on first paint')
  const galleryToggle = document.querySelector('[data-testid="kitchen-gallery-toggle"]')
  assert.ok(galleryToggle, 'gallery toggle renders')
  click(galleryToggle)
  await settle()

  const gallery = document.querySelector('[data-testid="kitchen-dish-gallery"]')
  assert.ok(gallery, 'dish gallery section is rendered once opened')
  const galleryImgs = gallery.querySelectorAll('img')
  assert.ok(galleryImgs.length >= 39, `gallery renders 3 photos for each of the 13 dishes (found ${galleryImgs.length})`)

  // Clicking a photo opens the DishPhotoModal
  const firstPhotoBtn = burgerStrip.querySelector('button')
  click(firstPhotoBtn)
  await settle()
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'clicking an item photo opens the dish photo modal')
})

test('Global language switcher defaults to Khmer and translates menus, tabs, and pages across Khmer, English, and Chinese', async () => {
  dom.window.history.replaceState({}, '', '/?role=owner&screen=dashboard')
  await freshKitchen()

  const appKm = document.querySelector('[data-testid="app-lang-km"]')
  const appEn = document.querySelector('[data-testid="app-lang-en"]')
  const appZh = document.querySelector('[data-testid="app-lang-zh"]')
  assert.ok(appKm && appEn && appZh, 'global topbar language switcher buttons render')
  assert.equal(appKm.getAttribute('aria-pressed'), 'true', 'Khmer is active by default across the app')

  // Sidebar menu items and Dashboard are in Khmer by default
  const navTextKm = document.querySelector('nav[aria-label="Main navigation"]').textContent
  assert.match(navTextKm, /ផ្ទាំងគ្រប់គ្រង/, 'Sidebar Dashboard label is in Khmer')
  assert.match(navTextKm, /តុ និងប្លង់/, 'Sidebar Floor label is in Khmer')
  assert.match(navTextKm, /មុខម្ហូប និងរូបមន្ត/, 'Sidebar Menu label is in Khmer')
  assert.match(container.textContent, /ទិដ្ឋភាពការលក់ថ្ងៃនេះ/, 'Dashboard sales overview is in Khmer')

  // Tab strip carries Khmer data-i18n-tab attribute
  const activeTabLabel = document.querySelector('.tab-list [role="tab"] .tab-i18n-label')
  assert.equal(activeTabLabel?.getAttribute('data-i18n-tab'), 'ផ្ទាំងគ្រប់គ្រង')

  // Switch global language to Chinese
  click(appZh)
  await settle()
  assert.equal(appZh.getAttribute('aria-pressed'), 'true')
  const navTextZh = document.querySelector('nav[aria-label="Main navigation"]').textContent
  assert.match(navTextZh, /仪表盘/, 'Sidebar Dashboard label is in Chinese')
  assert.match(navTextZh, /餐桌平面图/, 'Sidebar Floor label is in Chinese')
  assert.match(container.textContent, /今日销售概览/, 'Dashboard sales overview is in Chinese')
  assert.equal(activeTabLabel?.getAttribute('data-i18n-tab'), '仪表盘')

  // Navigate to Menu & Recipes screen and verify Chinese translation. The
  // screen is a lazy route, so give the chunk a longer beat than the default
  // settle when the suite is running every other file in parallel.
  const menuNavBtn = [...document.querySelectorAll('nav[aria-label="Main navigation"] button')]
    .find((b) => b.textContent.includes('Menu & Recipes'))
  click(menuNavBtn)
  await settle(120)
  assert.match(container.textContent, /菜单与配方/, 'Menu screen title is in Chinese')
  assert.match(container.textContent, /招牌牛肉汉堡/, 'Dish names on Menu screen are in Chinese')

  // Switch global language to English
  click(appEn)
  await settle()
  assert.equal(appEn.getAttribute('aria-pressed'), 'true')
  assert.match(container.textContent, /Menu & Recipes/, 'Menu screen title is in English')
  assert.match(container.textContent, /Restora Burger/, 'Dish names on Menu screen are in English')

  // Switch back to Khmer default
  click(appKm)
  await settle()
  assert.equal(appKm.getAttribute('aria-pressed'), 'true')
  assert.match(container.textContent, /មុខម្ហូប និងរូបមន្ត/, 'Menu screen title is back in Khmer')
})


test('phrase translator covers labels, settings, reports, telegram, and dynamic counts in km/zh', async () => {
  const { translateText } = await server.ssrLoadModule('/src/lib/i18n-phrases.js')
  const cases = [
    ['Count stock', 'រាប់ស្តុក', '盘点库存'],
    ['Base currency', 'រូបិយប័ណ្ណគោល', '本位币'],
    ['Tax, service & rounding', 'ពន្ធ សេវាកម្ម និងការបង្គត់', '税费、服务费与舍入'],
    ['Sell & buy in/out', 'លក់ និងទិញ ចេញ/ចូល', '进销存汇总'],
    ['What the bot tells you', 'ការជូនដំណឹងស្វ័យប្រវត្តិពី Bot', '机器人主动推送事件'],
    ['Guest QR ordering', 'ការកម្មង់ QR របស់ភ្ញៀវ', '扫码点餐'],
    ['Table 8', 'តុលេខ 8', '8号桌'],
    ['3 items', '3 មុខ', '3 项'],
    ['2 sold', 'លក់បាន 2', '售出 2'],
    ['Toss to order', 'លាយភ្លាមៗពេលមានកម្មង់', '下单后现拌'],
  ]
  for (const [en, km, zh] of cases) {
    assert.equal(translateText(en, 'km'), km, `km: ${en}`)
    assert.equal(translateText(en, 'zh'), zh, `zh: ${en}`)
    assert.equal(translateText(en, 'en'), en, `en unchanged: ${en}`)
  }
})
