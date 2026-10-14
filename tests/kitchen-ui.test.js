// ─── Kitchen display: photos and languages, in a real DOM ───────────
// Boots the real provider + shell + router in jsdom as the kitchen kiosk
// (/?role=kitchen&screen=kitchen, no server → local demo) and uses the
// screen the way a line cook would: read a ticket in Khmer, tap a photo,
// page through the dish, switch the screen to English or Chinese, bump.

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
// No server in this test: the provider must fall back to the local demo.
globalThis.fetch = async () => { throw new Error('offline') }
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { default: AppShell } = await server.ssrLoadModule('/src/components/AppShell.jsx')
const { Router } = await server.ssrLoadModule('/src/App.jsx')
const { KITCHEN_STRINGS } = await server.ssrLoadModule('/src/lib/kitchen-strings.js')
const { buildEmpire } = await server.ssrLoadModule('/src/lib/reducer.js')
const { NameTranslationsField, PhotoGalleryField } = await server.ssrLoadModule('/src/components/ItemPhotoField.jsx')
const KM = KITCHEN_STRINGS.km

const settled = async () => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 30)) })
}
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)]
const kds = () => document.querySelector('.kds')
const heading = () => kds().querySelector('h1').textContent
const lines = () => $$('.kds li[data-line]')
const lineFor = (text) => lines().find((li) => li.textContent.includes(text))
const thumbOf = (li) => li.querySelector('button[aria-label]')
const dialog = () => document.querySelector('[role="dialog"]')
const radio = (label) => $$('.kds [role="radiogroup"] [role="radio"]').find((el) => el.textContent === label)
const buttonWith = (text, scope = document) => $$('button', scope).find((el) => el.textContent.includes(text))

let root = null
let container = null

async function mount({ clear = true } = {}) {
  if (root) {
    act(() => root.unmount())
    container.remove()
  }
  if (clear) {
    dom.window.localStorage.clear()
    dom.window.sessionStorage.clear()
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(React.createElement(RestoraProvider, null, React.createElement(AppShell, null, React.createElement(Router))))
  })
  await settled()
}

function click(el) {
  assert.ok(el, 'the control exists')
  act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, button: 0 })) })
}

function key(target, name) {
  act(() => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  })
}

before(async () => { await mount() })

after(async () => {
  act(() => root.unmount())
  container.remove()
  await server.close()
})

test('the kitchen display opens in Khmer with a photo on every ticket line', () => {
  assert.equal(kds().getAttribute('lang'), 'km')
  assert.equal(heading(), KM.title)
  assert.equal(radio('ខ្មែរ').getAttribute('aria-checked'), 'true')
  assert.equal(radio('English').getAttribute('aria-checked'), 'false')
  assert.equal(radio('中文').getAttribute('aria-checked'), 'false')

  assert.ok(lines().length >= 3, 'the demo has fired tickets on the board')
  for (const li of lines()) {
    const img = li.querySelector('button[aria-label] img')
    assert.ok(img, 'every line carries a thumbnail')
    assert.match(img.getAttribute('src'), /^\/photos\/[a-z-]+\.svg$/)
  }
  const burger = lineFor('ប៊ឺហ្គឺ Restora')
  assert.ok(burger, 'dish names come out in Khmer')
  assert.match(burger.textContent, /\+2/, 'the badge says there are two more photos')
  assert.match(thumbOf(burger).getAttribute('aria-label'), /3/)
  assert.ok(buttonWith('រួចរាល់ · ប៊ឺហ្គឺ Restora', burger), 'the bump button speaks Khmer')
  assert.match(kds().textContent, /តុ 3/)
  assert.match(kds().textContent, /ឆ្អិនល្មម/, 'modifiers are translated too')
})

test('a tap on the thumbnail opens every photo of the dish, large', () => {
  const thumb = thumbOf(lineFor('ប៊ឺហ្គឺ Restora'))
  click(thumb)
  const box = dialog()
  assert.ok(box, 'the dish dialog opened')
  assert.equal(box.getAttribute('lang'), 'km')
  assert.match(box.querySelector('h2').textContent, /2× ប៊ឺហ្គឺ Restora/)
  assert.match(box.textContent, /Restora Burger/, 'the English name rides along for the expo')
  const big = () => $$('img', box).find((img) => img.getAttribute('alt'))
  assert.equal(big().getAttribute('src'), '/photos/burger.svg')
  assert.match(box.textContent, /1 \/ 3/)

  click(box.querySelector(`button[aria-label="${KM.nextPhoto}"]`))
  assert.equal(big().getAttribute('src'), '/photos/burger-top.svg')
  assert.match(box.textContent, /2 \/ 3/)

  key(dom.window, 'ArrowLeft')
  assert.match(box.textContent, /1 \/ 3/, '← steps back')
  key(dom.window, 'ArrowLeft')
  assert.match(box.textContent, /3 \/ 3/, 'and wraps around')

  const strip = $$('button[aria-current], button[aria-label^="បង្ហាញ"]', box)
  assert.equal(strip.length, 3, 'one strip thumbnail per photo')
  click(strip[1])
  assert.equal(big().getAttribute('src'), '/photos/burger-top.svg')

  assert.match(box.textContent, /គ្លុយតែន/, 'allergens are listed in Khmer')
  assert.match(box.textContent, /Smash, rest 2 min/, 'prep notes stay exactly as the owner wrote them')

  key(dom.window, 'Escape')
  assert.equal(dialog(), null, 'Escape closes it')
  // (Compare identities as booleans: printing two jsdom nodes in a failure would walk the whole window.)
  assert.ok(document.activeElement === thumbOf(lineFor('ប៊ឺហ្គឺ Restora')), 'focus returns to the thumbnail')
})

test('English and Chinese relabel the whole screen, and the choice sticks to the terminal', async () => {
  click(radio('English'))
  assert.equal(kds().getAttribute('lang'), 'en')
  assert.equal(heading(), 'Kitchen')
  assert.match(kds().textContent, /Live kitchen display/)
  assert.match(kds().textContent, /Table 3/)
  assert.ok(buttonWith('Bump Restora Burger'))
  assert.equal(radio('English').getAttribute('aria-checked'), 'true')
  assert.equal(localStorage.getItem('restora-lang'), 'en')

  click(radio('中文'))
  assert.equal(kds().getAttribute('lang'), 'zh-Hans')
  assert.equal(heading(), '厨房')
  assert.match(kds().textContent, /3号桌/)
  assert.match(kds().textContent, /烧烤/, 'station columns are translated')
  assert.match(kds().textContent, /五分熟/, 'doneness uses the Chinese steak scale')
  assert.ok(buttonWith('出餐 · Restora 汉堡'))
  assert.equal(localStorage.getItem('restora-lang'), 'zh')

  await mount({ clear: false })
  assert.equal(heading(), '厨房', 'a reload keeps the terminal in Chinese')

  // Arrow keys move the choice like any radio group (and wrap).
  key(radio('中文'), 'ArrowRight')
  assert.equal(heading(), KM.title)
  assert.ok(document.activeElement === radio('ខ្មែរ'), 'focus follows the choice')
  assert.equal(localStorage.getItem('restora-lang'), 'km')
})

test('bumping from the photo dialog bumps that line and closes the dialog', async () => {
  await mount()
  click(radio('English'))
  const pastaLines = () => lines().filter((li) => li.textContent.includes('Chicken Pasta'))
  assert.ok(pastaLines().length > 0)
  click(thumbOf(pastaLines()[0]))
  click(buttonWith('Bump Chicken Pasta', dialog()))
  assert.equal(dialog(), null)
  assert.equal(pastaLines().length, 0, 'the line left every column')
  assert.ok(buttonWith('1× Chicken Pasta'), 'and waits on the recall strip')
})

test('photos can be switched off for the kitchen in Settings → Food & menu', async () => {
  const empire = buildEmpire()
  for (const shop of Object.values(empire.locations)) {
    shop.settings = { ...shop.settings, food: { ...shop.settings.food, imagesOnKitchen: false } }
  }
  dom.window.localStorage.clear()
  dom.window.localStorage.setItem('restora-v1', JSON.stringify(empire))
  await mount({ clear: false })
  assert.ok(lines().length >= 3)
  assert.equal($$('.kds li[data-line] button[aria-label]').length, 0, 'no thumbnails')
  assert.ok(lineFor('ប៊ឺហ្គឺ Restora'), 'names still read in Khmer')
})

// ─── The owner's side: editing a dish's photos and names ────────────

// A controlled field driven straight from the test: the test owns the
// value, onChange stores it and re-renders, exactly like a parent's state.
function renderControlled(component, initial, extraProps = {}, toProps = (value) => ({ value })) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const alone = createRoot(host)
  const latest = { value: initial }
  const draw = () => alone.render(React.createElement(component, { ...extraProps, ...toProps(latest.value), onChange: record }))
  function record(next) {
    latest.value = next
    draw()
  }
  act(draw)
  return { host, latest, unmount: () => { act(() => alone.unmount()); host.remove() } }
}

function type(input, text) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

test('the gallery editor reorders photos, promotes a new cover, and refuses bad links', () => {
  const { host, latest, unmount } = renderControlled(
    PhotoGalleryField,
    { imageUrl: '/photos/a.svg', images: ['/photos/b.svg', '/photos/c.svg'] },
    {},
    (photos) => ({ cover: photos.imageUrl, images: photos.images }),
  )
  const control = (label) => host.querySelector(`button[aria-label="${label}"]`)
  assert.match(host.textContent, /Photos · 3 of 6/)

  click(control('Make photo 3 the cover'))
  assert.deepEqual(latest.value, { imageUrl: '/photos/c.svg', images: ['/photos/a.svg', '/photos/b.svg'] })

  click(control('Remove photo 1'))
  assert.deepEqual(latest.value, { imageUrl: '/photos/a.svg', images: ['/photos/b.svg'] }, 'the next photo becomes the cover')

  click(control('Move photo 2 earlier'))
  assert.deepEqual(latest.value, { imageUrl: '/photos/b.svg', images: ['/photos/a.svg'] })
  assert.ok(control('Move photo 1 earlier').disabled, 'the cover cannot move further forward')

  const link = host.querySelector('input[aria-label="Photo link"]')
  type(link, 'javascript:alert(1)')
  click(buttonWith('Add link', host))
  assert.match(host.textContent, /Use an https:\/\/ link/)
  assert.deepEqual(latest.value.images, ['/photos/a.svg'], 'nothing unsafe gets in')

  type(link, 'https://cdn.example/plate.jpg')
  key(link, 'Enter')
  assert.deepEqual(latest.value.images, ['/photos/a.svg', 'https://cdn.example/plate.jpg'])
  assert.equal(link.value, '', 'the box clears for the next link')

  for (const n of [1, 2, 3]) {
    type(host.querySelector('input[aria-label="Photo link"]'), `/photos/extra-${n}.svg`)
    click(buttonWith('Add link', host))
  }
  assert.match(host.textContent, /Photos · 6 of 6/)
  assert.equal(host.querySelector('input[aria-label="Photo link"]'), null, 'a full gallery stops offering more')
  assert.equal(host.querySelector('input[type="file"]'), null)
  unmount()
})

test('the name fields edit Khmer and Chinese, with the English name as the hint', () => {
  const { host, latest, unmount } = renderControlled(NameTranslationsField, { km: '', zh: '' }, { englishName: 'Coffee' })
  const km = host.querySelector('input[lang="km"]')
  const zh = host.querySelector('input[lang="zh-Hans"]')
  assert.equal(km.getAttribute('placeholder'), 'Coffee')
  type(km, 'កាហ្វេ')
  type(zh, '咖啡')
  assert.deepEqual(latest.value, { km: 'កាហ្វេ', zh: '咖啡' })
  unmount()
})
