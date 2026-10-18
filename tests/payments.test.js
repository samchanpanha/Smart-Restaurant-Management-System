// ─── Guest payments + delivery details ─────────────────────────────
// The guest surface offers QR and cash only. A QR tap is a claim, not a
// settlement: the reducer keeps it until staff confirms with PAY_ORDER.
// The same suite pins the customer map fields and the address edit window.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeed, reducer } from '../src/lib/reducer.js'
import { googleMapsUrl, validCoordinate } from '../src/lib/geo.js'
import { defaultSettings, sanitizeSettings } from '../src/lib/settings.js'

const TOKEN = 'sess_guest_1'

function fresh() {
  return buildSeed()
}

function deliveryOrder(overrides = {}) {
  return {
    type: 'GUEST_SEND',
    orderType: 'delivery',
    orderId: 'o_guest_pay_1',
    guestToken: TOKEN,
    customer: {
      name: 'Sokha',
      phone: '012345678',
      address: '12 Riverside',
      unit: 'Unit 3',
      landmark: 'Next to the night market',
      lat: 11.5564,
      lng: 104.9282,
      accuracy: 12,
    },
    deliveryAddress: '12 Riverside',
    deliveryFee: 3,
    paymentPreference: 'qr',
    items: [{ menuItemId: 'm_burger', qty: 2 }],
    ...overrides,
  }
}

function placed(overrides = {}) {
  const shop = reducer(fresh(), deliveryOrder(overrides))
  return {
    shop,
    order: shop.orders.find((entry) => entry.id === 'o_guest_pay_1'),
  }
}

test('the seed carries QR + cash payment defaults', () => {
  const settings = fresh().settings
  assert.deepEqual(settings.payments, {
    qrEnabled: true,
    cashEnabled: true,
    qrImageUrl: '',
    qrLabel: '',
    qrNote: 'Scan with your banking app, enter the exact amount, then tap “I have paid”.',
    requireQrConfirmation: true,
  })
  assert.deepEqual(defaultSettings('Test').payments, settings.payments)
})

test('payment settings reject unsafe QR sources and always leave a method', () => {
  const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
  const clean = sanitizeSettings({
    payments: {
      qrEnabled: true,
      cashEnabled: true,
      qrImageUrl: qr,
      qrLabel: 'ABA · Downtown',
      qrNote: 'Scan, transfer the exact total, then confirm.',
      requireQrConfirmation: false,
    },
  }, 'Downtown')

  assert.equal(clean.payments.qrImageUrl, qr)
  assert.equal(clean.payments.qrLabel, 'ABA · Downtown')
  assert.equal(clean.payments.requireQrConfirmation, false)

  const unsafe = sanitizeSettings({
    payments: { qrImageUrl: 'javascript:alert(1)', qrEnabled: false, cashEnabled: false },
  }, 'Downtown')
  assert.equal(unsafe.payments.qrImageUrl, '')
  assert.equal(unsafe.payments.cashEnabled, true, 'cash is restored when both methods are off')
  assert.equal(unsafe.payments.qrNote, defaultSettings('Downtown').payments.qrNote)
})

test('GUEST_SEND keeps the map pin, unit, landmark, and payment preference', () => {
  const { order } = placed()

  assert.equal(order.status, 'sent')
  assert.notEqual(order.status, 'paid', 'placing an order never settles it')
  assert.equal(order.paymentPreference, 'qr')
  assert.equal(order.customer.address, '12 Riverside')
  assert.equal(order.customer.unit, 'Unit 3')
  assert.equal(order.customer.landmark, 'Next to the night market')
  assert.equal(order.customer.lat, 11.5564)
  assert.equal(order.customer.lng, 104.9282)
  assert.equal(order.customer.accuracy, 12)
  assert.equal(order.deliveryAddress, '12 Riverside')
})

test('a QR claim needs the guest token, waits for staff, and pays once', () => {
  const { shop, order } = placed()
  const wrong = reducer(shop, { type: 'CLAIM_QR_PAYMENT', orderId: order.id, guestToken: 'wrong' })
  assert.equal(wrong.orders.find((entry) => entry.id === order.id).paymentClaim, undefined)

  const claimed = reducer(shop, { type: 'CLAIM_QR_PAYMENT', orderId: order.id, guestToken: TOKEN, tip: 1.5 })
  const claimOrder = claimed.orders.find((entry) => entry.id === order.id)
  assert.ok(claimOrder.paymentClaim, 'the claim is recorded')
  assert.equal(claimOrder.paymentClaim.tip, 1.5)
  assert.ok(claimOrder.paymentClaim.amount > claimOrder.paymentClaim.total)
  assert.match(claimOrder.paymentClaim.reference, /^[A-Z0-9]{6}$/)
  assert.equal(claimOrder.status, order.status, 'a claim does not close the check')

  const paid = reducer(claimed, {
    type: 'PAY_ORDER',
    orderId: order.id,
    method: 'qr',
    tip: claimOrder.paymentClaim.tip,
  })
  const paidOrder = paid.orders.find((entry) => entry.id === order.id)
  assert.equal(paidOrder.status, 'paid')
  assert.equal(paidOrder.paymentClaim, null)
  assert.equal(paidOrder.payMethod, 'qr')
})

test('a guest can withdraw a claim but not settle or rewrite another guest order', () => {
  const { shop, order } = placed()
  const claimed = reducer(shop, { type: 'CLAIM_QR_PAYMENT', orderId: order.id, guestToken: TOKEN })
  const refused = reducer(claimed, { type: 'CLEAR_PAYMENT_CLAIM', orderId: order.id, guestToken: 'wrong' })
  assert.ok(refused.orders.find((entry) => entry.id === order.id).paymentClaim, 'wrong token keeps the claim')

  const cleared = reducer(claimed, { type: 'CLEAR_PAYMENT_CLAIM', orderId: order.id, guestToken: TOKEN })
  assert.equal(cleared.orders.find((entry) => entry.id === order.id).paymentClaim, null)

  const staffCleared = reducer(claimed, { type: 'CLEAR_PAYMENT_CLAIM', orderId: order.id, by: 'staff' })
  assert.equal(staffCleared.orders.find((entry) => entry.id === order.id).paymentClaim, null)

  const edited = reducer(shop, {
    type: 'UPDATE_GUEST_ORDER',
    orderId: order.id,
    guestToken: TOKEN,
    customer: { name: 'Sokha C.', phone: '099999999', address: '14 Riverside', lat: 11.56, lng: 104.93 },
    deliveryAddress: '14 Riverside',
  })
  const next = edited.orders.find((entry) => entry.id === order.id)
  assert.equal(next.customer.name, 'Sokha C.')
  assert.equal(next.deliveryAddress, '14 Riverside')
  assert.equal(next.customer.lat, 11.56)

  const refusedEdit = reducer(shop, {
    type: 'UPDATE_GUEST_ORDER',
    orderId: order.id,
    guestToken: 'wrong',
    customer: { name: 'Mallory', phone: '000' },
  })
  assert.equal(refusedEdit.orders.find((entry) => entry.id === order.id).customer.name, 'Sokha')

  const locked = {
    ...shop,
    orders: shop.orders.map((entry) => (entry.id === order.id
      ? { ...entry, deliveryStatus: 'out_for_delivery' }
      : entry)),
  }
  const tooLate = reducer(locked, {
    type: 'UPDATE_GUEST_ORDER',
    orderId: order.id,
    guestToken: TOKEN,
    customer: { name: 'Too Late', phone: '123' },
  })
  assert.equal(tooLate.orders.find((entry) => entry.id === order.id).customer.name, 'Sokha')
})

test('payment preference and staff edits stay inside the order contract', () => {
  const { shop, order } = placed()
  const cash = reducer(shop, {
    type: 'SET_PAYMENT_PREFERENCE',
    orderId: order.id,
    preference: 'cash',
    guestToken: TOKEN,
  })
  assert.equal(cash.orders.find((entry) => entry.id === order.id).paymentPreference, 'cash')

  const wrongToken = reducer(shop, {
    type: 'SET_PAYMENT_PREFERENCE',
    orderId: order.id,
    preference: 'cash',
    guestToken: 'nope',
  })
  assert.equal(wrongToken.orders.find((entry) => entry.id === order.id).paymentPreference, 'qr')

  const edited = reducer(shop, {
    type: 'SET_ORDER_DETAILS',
    orderId: order.id,
    customer: { name: 'Counter Edit', phone: '010101', address: '99 Market St', lat: 11.57, lng: 104.94 },
    deliveryAddress: '99 Market St',
    deliveryFee: 4.5,
  })
  const next = edited.orders.find((entry) => entry.id === order.id)
  assert.equal(next.customer.name, 'Counter Edit')
  assert.equal(next.customer.lat, 11.57)
  assert.equal(next.deliveryAddress, '99 Market St')
  assert.equal(next.deliveryFee, 4.5)
})

test('CREATE_ORDER accepts a delivery address and pin', () => {
  const shop = reducer(fresh(), {
    type: 'CREATE_ORDER',
    id: 'o_counter_delivery',
    orderType: 'delivery',
    customer: {
      name: 'Nita',
      phone: '012000111',
      address: '5 Market Street',
      unit: 'Floor 2',
      lat: 11.55,
      lng: 104.91,
    },
    deliveryAddress: '5 Market Street',
    deliveryFee: 2,
  })
  const order = shop.orders.find((entry) => entry.id === 'o_counter_delivery')
  assert.ok(order, 'the delivery check is created')
  assert.equal(order.type, 'delivery')
  assert.equal(order.customer.unit, 'Floor 2')
  assert.equal(order.customer.lat, 11.55)
  assert.equal(order.deliveryAddress, '5 Market Street')
})

test('map links prefer a pin and fall back to a typed address', () => {
  assert.equal(validCoordinate(11.5, 104.9), true)
  assert.equal(validCoordinate(181, 104.9), false)
  assert.equal(
    googleMapsUrl({ lat: 11.5564, lng: 104.9282, address: 'ignored' }),
    'https://www.google.com/maps/search/?api=1&query=11.5564,104.9282',
  )
  assert.equal(
    googleMapsUrl({ address: '12 Riverside' }),
    'https://www.google.com/maps/search/?api=1&query=12%20Riverside',
  )
  assert.equal(googleMapsUrl({}), '')
})
