// ─── Mini app journey in a real DOM ─────────────────────────────────
// The welcome card, the one picker, and the seated 1-tap services are
// the guest's whole path: land, choose, sit, call. These tests drive the
// same App the bot links to, with English selected so the assertions read
// the product copy rather than the Khmer default.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/?tg=1',
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
globalThis.fetch = async () => { throw new Error('offline') }
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

// hmr: false — UI test files run in parallel and must not fight over the
// middleware-mode HMR port.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { default: App } = await server.ssrLoadModule('/src/App.jsx')
const { buildEmpire } = await server.ssrLoadModule('/src/lib/reducer.js')

// 1×1 transparent PNG — enough for the <img> and the sanitizer.
const QR_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
function qrSeed() {
  const empire = buildEmpire()
  const shop = empire.locations.downtown
  shop.settings.payments = {
    ...shop.settings.payments,
    qrEnabled: true,
    cashEnabled: true,
    qrImageUrl: QR_PIXEL,
    qrLabel: 'ABA · Demo',
    qrNote: 'Scan, enter the exact amount, then tap I have paid.',
    requireQrConfirmation: true,
  }
  return empire
}

const settle = async (ms = 40) => {
  await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, ms)) })
}
const $$ = (selector) => [...document.querySelectorAll(selector)]
const byText = (selector, text) => $$(selector).find((el) => (el.textContent || '').includes(text))
const click = (el) => act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
const submit = (form) => act(() => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
// React tracks the last value it rendered; go through the native setter.
const type = (el, value) => act(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
  descriptor.set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})

let root = null
let container = null

async function fresh(url, seed = null) {
  if (root) {
    act(() => root.unmount())
    container.remove()
  }
  dom.window.localStorage.clear()
  dom.window.sessionStorage.clear()
  if (seed) dom.window.localStorage.setItem('restora-v1', JSON.stringify(seed))
  dom.reconfigure({ url })
  root = null
  container = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(React.createElement(App)) })
  await settle(100)
  // The guest app defaults to Khmer; these tests read the English copy.
  const en = document.querySelector('[data-testid="miniapp-lang-en"]')
  if (en) {
    click(en)
    await settle(60)
  }
}

async function openPicker() {
  const sitNow = byText('button', 'Sit now')
  assert.ok(sitNow, 'the welcome card offers Sit now')
  click(sitNow)
  await settle(60)
  const picker = document.querySelector('[data-testid="table-picker"]')
  assert.ok(picker, 'the one picker opens')
  return picker
}

before(async () => { await settle(30) })

after(async () => {
  if (root) act(() => root.unmount())
  container?.remove()
  await server.close()
})

test('the mini app header keeps the table and language one tap away', async () => {
  await fresh('http://localhost:5173/?tg=1&guest=t14')

  const header = document.querySelector('header')
  assert.ok(header, 'the mini app chrome is present')
  assert.match(header.textContent, /Restora/)
  assert.match(header.textContent, /Table 14/)

  const tableButton = header.querySelector('button[aria-label^="Change table"]')
  assert.ok(tableButton, 'the table line is itself the table switcher')
  click(tableButton)
  await settle(60)
  assert.ok(document.querySelector('[data-testid="table-picker"]'), 'tapping the table opens the one picker')
  click(tableButton)
  await settle(60)
  assert.ok(!document.querySelector('[data-testid="table-picker"]'), 'tapping it again closes the picker')

  const language = document.querySelector('[data-testid="miniapp-lang-switcher"] summary')
  assert.ok(language, 'the header has one compact language trigger')
  assert.match(language.textContent, /English|ខ្មែរ|中文/)
})

test('the welcome card seats the party size the guest chose in one tap', async () => {
  await fresh('http://localhost:5173/?tg=1&guest=t12')

  const welcome = document.querySelector('section[aria-labelledby="miniapp-welcome-title"]')
  assert.ok(welcome, 'the welcome card is the first thing an unseated guest sees')
  const intro = welcome.textContent
  assert.match(intro, /Where are you eating\?/)
  assert.match(intro, /Sit now/)
  assert.match(intro, /pickup/i)
  assert.match(intro, /delivery/i)
  assert.match(intro, /Have a booking\? Reschedule/)
  assert.match(intro, /tables free/)

  const picker = await openPicker()
  assert.match(picker.textContent, /Party size/)
  assert.match(picker.textContent, /tables free/)

  // Party of four, then the first free table — the claim is the seat.
  const four = $$('[data-testid="table-picker"] button').find(
    (button) => button.textContent.trim() === '4' && button.getAttribute('aria-pressed') !== null,
  )
  assert.ok(four, 'the party-size pills are in the picker')
  click(four)
  await settle(30)
  assert.equal(four.getAttribute('aria-pressed'), 'true')

  const free = $$('button').find((button) => (button.getAttribute('aria-label') || '').startsWith('Sit at'))
  assert.ok(free, 'a free table is one tap away')
  const label = free.getAttribute('aria-label')
  click(free)
  await settle(80)

  const body = document.body.textContent
  assert.ok(!document.querySelector('[data-testid="table-picker"]'), 'the picker closes on the seat')
  assert.match(body, new RegExp(label.replace('Sit at ', '')))
  assert.match(body, /4 guests/, 'the bar shows the party the guest picked')
  assert.match(body, /Seated/)
  assert.match(body, /Restora Burger/)
})

test('the seated bar calls service in one tap and confirms it', async () => {
  await fresh('http://localhost:5173/?tg=1')

  const water = byText('button', 'Water')
  assert.ok(water, 'the 1-tap service chips are on the bar')
  click(water)
  await settle(60)

  const toast = byText('[role="status"]', 'Staff notified')
  assert.ok(toast, 'the guest hears the request was taken')
})

test('a seated guest can request a table move and sees it pending', async () => {
  await fresh('http://localhost:5173/?tg=1')

  const move = byText('button', 'Move Table')
  assert.ok(move, 'the bar offers a table move')
  click(move)
  await settle(60)

  const sheet = document.querySelector('[role="dialog"]')
  assert.ok(sheet, 'the move sheet opens')
  assert.match(sheet.textContent, /Select a new table/)
  assert.match(sheet.textContent, /Choose an open table to request a move\./)

  const free = $$('[role="dialog"] button').find((button) => !button.disabled)
  assert.ok(free, 'a free table can be picked')
  click(free)
  await settle(40)

  assert.match(document.querySelector('[role="dialog"]').textContent, /Confirm table transfer/)
  const form = document.querySelector('[role="dialog"] form')
  assert.ok(form, 'the confirm form shows before anything is dispatched')
  submit(form)
  await settle(80)

  assert.ok(!document.querySelector('[role="dialog"]'), 'the sheet closes on submit')
  assert.ok(byText('button', 'Cancel'), 'the pending move shows with a cancel action')
  assert.ok(byText('[role="status"]', 'Move requested to'), 'the guest hears the move is waiting for staff')
})

test('a guest with a booking can open the reschedule sheet before sitting', async () => {
  await fresh('http://localhost:5173/?tg=1&guest=t12')

  const reschedule = byText('button', 'Have a booking? Reschedule')
  assert.ok(reschedule, 'the welcome card links to the booking')
  click(reschedule)
  await settle(60)

  const sheet = document.querySelector('[role="dialog"]')
  assert.ok(sheet, 'the reschedule sheet opens')
  assert.match(sheet.textContent, /Reschedule reservation/)
  assert.match(sheet.textContent, /Active booking:/)
  assert.match(sheet.textContent, /Available tables for slot/)

  const close = $$('[role="dialog"] button').find((button) => /Close/.test(button.textContent))
  assert.ok(close, 'the sheet can be dismissed')
  click(close)
  await settle(30)
  assert.ok(!document.querySelector('[role="dialog"]'))
})

test('the Book tab turns a live slot into a real reservation', async () => {
  await fresh('http://localhost:5173/?tg=1')

  const book = byText('button', 'Book')
  assert.ok(book, 'the guest nav has a Book tab')
  click(book)
  await settle(60)

  const panel = document.querySelector('[data-testid="guest-booking"]')
  assert.ok(panel, 'the booking panel renders')
  assert.match(panel.textContent, /Book a table/)
  assert.match(panel.textContent, /Availability is live/)

  // Two days out keeps the booking outside the self-service cutoff, so
  // the confirmation can exercise reschedule and cancel.
  const days = $$('[data-testid="booking-day"]')
  assert.ok(days.length >= 3, 'the next seven days are on screen')
  click(days[2])
  await settle(40)

  const slot = $$('[data-testid="booking-slot"]').find((button) => !button.disabled)
  assert.ok(slot, 'at least one live slot is bookable')
  click(slot)
  await settle(30)
  assert.equal(slot.getAttribute('aria-pressed'), 'true')

  const inputs = $$('[data-testid="guest-booking"] input')
  assert.equal(inputs.length, 3, 'name, phone, and optional notes')
  type(inputs[0], 'Sokha Chan')
  type(inputs[1], '012345678')
  await settle(20)
  submit(document.querySelector('[data-testid="guest-booking"] form'))
  await settle(80)

  const confirmed = document.querySelector('[data-testid="guest-booking-confirmed"]')
  assert.ok(confirmed, 'the confirmation replaces the form')
  assert.match(confirmed.textContent, /Your table is booked/)
  assert.match(confirmed.textContent, /2 guests/)
  assert.match(confirmed.textContent, /Reference/)

  const saved = JSON.parse(dom.window.localStorage.getItem('restora_guest_booking_v1'))
  assert.ok(saved?.id, 'the booking id is kept for later management')
  assert.ok(saved?.token, 'scoped to this guest session')

  const reschedule = byText('button', 'Reschedule booking')
  assert.ok(reschedule, 'the confirmation can manage the booking')
  click(reschedule)
  await settle(60)
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'the reschedule sheet opens')
  assert.match(dialog.textContent, /Save new time/)
  const moveSlot = $$('[data-testid="manage-slot"]').find((button) => !button.disabled)
  assert.ok(moveSlot, 'another live slot is offered')
  click(moveSlot)
  await settle(20)
  click(byText('button', 'Save new time'))
  await settle(80)
  assert.ok(!document.querySelector('[role="dialog"]'), 'the sheet closes after the change')
  assert.match(document.querySelector('[data-testid="guest-booking-confirmed"]').textContent, /Your table is booked/)

  click(byText('button', 'Cancel booking'))
  await settle(20)
  assert.match(document.body.textContent, /Cancel this booking\?/)
  click(byText('button', 'Yes, cancel'))
  await settle(50)
  assert.match(document.body.textContent, /Booking cancelled/)
  assert.equal(dom.window.localStorage.getItem('restora_guest_booking_v1'), null)

  click(byText('button', 'Book another table'))
  await settle(50)
  assert.ok(document.querySelector('[data-testid="guest-booking"]'), 'the form returns after a cancel')
})

test('a guest can join and leave the waitlist when the day is full', async () => {
  await fresh('http://localhost:5173/?tg=1')

  click(byText('button', 'Book'))
  await settle(60)

  const inputs = $$('[data-testid="guest-booking"] input')
  type(inputs[0], 'Sokha Chan')
  type(inputs[1], '012345678')
  await settle(20)

  click(document.querySelector('[data-testid="booking-waitlist"]'))
  await settle(60)

  const confirmed = document.querySelector('[data-testid="guest-waitlist-confirmed"]')
  assert.ok(confirmed, 'the waitlist confirms in place of the form')
  assert.match(confirmed.textContent, /You're on the waitlist/)
  assert.match(confirmed.textContent, /2 guests/)
  assert.match(confirmed.textContent, /Reference/)

  const saved = JSON.parse(dom.window.localStorage.getItem('restora_guest_waitlist_v1'))
  assert.ok(saved?.id, 'the waitlist entry is kept for the visit')

  click(byText('button', 'Leave waitlist'))
  await settle(60)
  assert.ok(document.querySelector('[data-testid="guest-booking"]'), 'leaving returns to booking')
  assert.equal(dom.window.localStorage.getItem('restora_guest_waitlist_v1'), null)
})

test('pickup checkout places the order unpaid, takes cash, and opens tracking', async () => {
  await fresh('http://localhost:5173/?tg=1&guest=t12')

  const pickup = byText('button', 'Order for pickup')
  assert.ok(pickup, 'the gate offers pickup')
  click(pickup)
  await settle(60)

  const add = $$('button').find((button) => button.getAttribute('aria-label') === 'Add Soup of the Day')
  assert.ok(add, 'a modifier-free dish can be added in one tap')
  click(add)
  await settle(40)

  const review = $$('button').find((button) => /Review/.test(button.textContent))
  assert.ok(review, 'the cart bar opens checkout')
  click(review)
  await settle(40)

  assert.ok(document.querySelector('[data-testid="checkout-review"]'), 'step 1 is the review')
  const cont = byText('button', 'Continue')
  assert.ok(cont, 'review continues to details')
  click(cont)
  await settle(40)

  type(document.querySelector('input[aria-label="Your name"]'), 'Sokha Chan')
  type(document.querySelector('input[aria-label="Phone number"]'), '012345678')
  await settle(20)
  const toPayment = byText('button', 'Continue to payment')
  assert.ok(toPayment, 'details continue to payment')
  click(toPayment)
  await settle(40)

  const cash = document.querySelector('[data-testid="checkout-payment-cash"]')
  assert.ok(cash, 'cash is offered without a merchant QR')
  assert.equal(cash.checked, true, 'cash is the default when no QR is uploaded')
  assert.ok(!document.querySelector('[data-testid="checkout-payment-qr"]'), 'QR is hidden until the owner uploads one')

  const place = $$('button').find((button) => /Place order/.test(button.textContent))
  assert.ok(place, 'payment keeps the total on the CTA')
  assert.match(place.textContent, /\$\d/)
  click(place)
  await settle(80)

  const done = document.querySelector('[data-testid="guest-checkout-done"]')
  assert.ok(done, 'the confirmation replaces the form')
  assert.match(done.textContent, /Order placed/)
  assert.match(done.textContent, /Pay at pickup/)
  assert.doesNotMatch(done.textContent, /Payment received|Paid by card/)

  const saved = JSON.parse(dom.window.localStorage.getItem('restora_guest_order_v1'))
  assert.ok(saved?.orderId, 'the order id survives a reload')
  assert.equal(saved?.type, 'takeout')

  click(byText('button', 'Track order'))
  await settle(60)
  assert.ok(document.querySelector('[data-testid="guest-orders"]'), 'tracking lands on Orders')
  assert.match(document.body.textContent, /Pickup order/)
  assert.match(document.body.textContent, /In kitchen|Ready/)
  assert.match(document.body.textContent, /Cash at pickup/)

  const pay = $$('button').find((button) => /^Pay \$/.test(button.textContent.trim()))
  assert.ok(pay, 'the unpaid pickup can choose payment from Orders')
  click(pay)
  await settle(60)

  const paySheet = document.querySelector('[role="dialog"]')
  assert.ok(paySheet, 'the payment sheet opens from the ticket')
  assert.match(paySheet.textContent, /Settle your check/)
  const cashPay = $$('[role="dialog"] button').find((button) => /^Pay \$.*in cash/.test(button.textContent.trim()))
  assert.ok(cashPay, 'the cash option is the only method without a QR')
  click(cashPay)
  await settle(60)

  const confirmed = document.querySelector('[data-testid="guest-cash-confirmed"]')
  assert.ok(confirmed, 'cash confirms in place with collection instructions')
  assert.match(confirmed.textContent, /Pay in cash/)
  assert.match(confirmed.textContent, /counter/)
  click(byText('[role="dialog"] button', 'Done'))
  await settle(60)
  assert.ok(!document.querySelector('[role="dialog"]'), 'the sheet closes after choosing cash')
  assert.match(document.body.textContent, /Cash at pickup/)
})

test('delivery checkout validates the address, saves the unit, and pays cash at the door', async () => {
  await fresh('http://localhost:5173/?tg=1&guest=t12')

  click(byText('button', 'Order for delivery'))
  await settle(60)

  const add = $$('button').find((button) => button.getAttribute('aria-label') === 'Add Soup of the Day')
  assert.ok(add, 'delivery can add the same modifier-free dish')
  click(add)
  await settle(40)

  click($$('button').find((button) => /Review/.test(button.textContent)))
  await settle(40)
  click(byText('button', 'Continue'))
  await settle(40)

  type(document.querySelector('input[aria-label="Your name"]'), 'Sokha Chan')
  type(document.querySelector('input[aria-label="Phone number"]'), '012345678')
  await settle(20)
  click(byText('button', 'Continue to payment'))
  await settle(40)
  assert.match(document.body.textContent, /Add a street address so the rider can find you/, 'the address is required')

  type(document.querySelector('input[aria-label="Delivery address"]'), '12 Riverside')
  type(document.querySelector('input[aria-label="Building or unit"]'), 'Unit 3')
  type(document.querySelector('input[aria-label="Landmark for the rider"]'), 'Next to the night market')
  await settle(20)
  click(byText('button', 'Continue to payment'))
  await settle(40)

  const cash = document.querySelector('[data-testid="checkout-payment-cash"]')
  assert.ok(cash, 'delivery offers cash at the door')
  assert.equal(cash.checked, true, 'cash is the default when no QR is uploaded')

  click($$('button').find((button) => /Place order/.test(button.textContent)))
  await settle(80)

  const done = document.querySelector('[data-testid="guest-checkout-done"]')
  assert.ok(done, 'delivery has a confirmation step')
  assert.match(done.textContent, /Order placed/)
  assert.match(done.textContent, /Pay at the door/)
  assert.doesNotMatch(done.textContent, /Payment received/)

  click(byText('button', 'Track order'))
  await settle(60)
  assert.match(document.body.textContent, /Delivery order/)
  assert.match(document.body.textContent, /Delivering to/)
  assert.match(document.body.textContent, /12 Riverside/)
  assert.match(document.body.textContent, /Unit 3/)
  assert.match(document.body.textContent, /Next to the night market/)
  assert.match(document.body.textContent, /Delivery fee/)
  assert.match(document.body.textContent, /\$3\.50/)
  assert.match(document.body.textContent, /Open location in Google Maps/)

  click(byText('button', 'Edit details'))
  await settle(60)
  const editor = document.querySelector('[role="dialog"]')
  assert.ok(editor, 'the guest can edit the delivery details from Orders')
  type(document.querySelector('input[aria-label="Order name"]'), 'Sokha C.')
  click(document.querySelector('[data-testid="guest-order-details-save"]'))
  await settle(60)
  assert.match(document.body.textContent, /Sokha C\./)
  assert.match(document.body.textContent, /12 Riverside/)

  const pay = $$('button').find((button) => /^Pay \$/.test(button.textContent.trim()))
  assert.ok(pay, 'an unpaid delivery can choose payment from Orders')
  click(pay)
  await settle(60)
  const paySheet = document.querySelector('[role="dialog"]')
  assert.ok(paySheet, 'the pay sheet opens from the ticket')
  assert.match(paySheet.textContent, /Settle your check/)
  const cashPay = $$('[role="dialog"] button').find((button) => /^Pay \$.*in cash/.test(button.textContent.trim()))
  assert.ok(cashPay, 'the guest can choose cash at the door')
  click(cashPay)
  await settle(60)
  assert.ok(document.querySelector('[data-testid="guest-cash-confirmed"]'), 'cash confirms collection instructions')
})

test('QR checkout records a claim and waits for staff confirmation', async () => {
  await fresh('http://localhost:5173/?tg=1&guest=t12', qrSeed())

  click(byText('button', 'Order for pickup'))
  await settle(60)
  const add = $$('button').find((button) => button.getAttribute('aria-label') === 'Add Soup of the Day')
  assert.ok(add, 'a dish can be added')
  click(add)
  await settle(40)

  click($$('button').find((button) => /Review/.test(button.textContent)))
  await settle(40)
  click(byText('button', 'Continue'))
  await settle(40)
  type(document.querySelector('input[aria-label="Your name"]'), 'Dara Kim')
  type(document.querySelector('input[aria-label="Phone number"]'), '098765432')
  await settle(20)
  click(byText('button', 'Continue to payment'))
  await settle(40)

  const qr = document.querySelector('[data-testid="checkout-payment-qr"]')
  assert.ok(qr, 'an uploaded QR adds the transfer method')
  assert.equal(qr.checked, true, 'QR is the default when configured')
  assert.match(document.body.textContent, /ABA · Demo/)

  click($$('button').find((button) => /Place order/.test(button.textContent)))
  await settle(80)

  const done = document.querySelector('[data-testid="guest-checkout-done"]')
  assert.ok(done, 'the order is placed before payment')
  assert.match(done.textContent, /QR transfer/)
  const panel = document.querySelector('[data-testid="qr-payment-panel"]')
  assert.ok(panel, 'the merchant QR is shown on the confirmation')
  assert.match(panel.textContent, /Scan to pay/)
  assert.match(panel.textContent, /Ref /)

  click(document.querySelector('[data-testid="qr-payment-check"]'))
  await settle(20)
  click(document.querySelector('[data-testid="qr-payment-confirm"]'))
  await settle(80)
  assert.ok(document.querySelector('[data-testid="qr-claim-pending"]'), 'the claim waits for staff')
  assert.match(document.body.textContent, /waiting for staff/)

  click(byText('button', 'Track order'))
  await settle(60)
  const claim = document.querySelector('[data-testid="guest-qr-claim"]')
  assert.ok(claim, 'Orders keeps the pending claim visible')
  assert.match(claim.textContent, /Payment sent · waiting for staff/)
  assert.ok(!$$('button').some((button) => /^Pay \$/.test(button.textContent.trim())), 'a pending claim hides the pay button')

  click(byText('button', 'I did not send it — cancel claim'))
  await settle(60)
  assert.ok(!document.querySelector('[data-testid="guest-qr-claim"]'), 'the guest can withdraw a mistaken claim')
  assert.ok($$('button').some((button) => /^Pay \$/.test(button.textContent.trim())), 'the pay button returns after cancelling')
})
