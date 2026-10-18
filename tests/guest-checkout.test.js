// ─── Guest checkout contracts ─────────────────────────────────────
// The guest UI creates a client id before dispatching GUEST_SEND so the
// confirmation, tracking tab, and bill can find the order the reducer
// created. These tests pin that contract plus the off-table totals.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeed, reducer } from '../src/lib/reducer.js'
import { orderTotals } from '../src/lib/models.js'
import { sanitizeSettings } from '../src/lib/settings.js'

function fresh() {
  return buildSeed()
}

function deliveryOrder(overrides = {}) {
  return {
    type: 'GUEST_SEND',
    orderType: 'delivery',
    orderId: 'o_guest_client_1',
    guestToken: 'sess_guest_1',
    customer: { name: 'Sokha', phone: '012345678', address: '12 Riverside' },
    deliveryAddress: '12 Riverside',
    deliveryFee: 3,
    items: [{ menuItemId: 'm_burger', qty: 2 }],
    ...overrides,
  }
}

test('GUEST_SEND keeps the client order id, guest token, and customer phone', () => {
  const shop = fresh()
  const next = reducer(shop, deliveryOrder())
  const order = next.orders.find((o) => o.id === 'o_guest_client_1')

  assert.ok(order, 'the reducer should use the client-generated id')
  assert.equal(order.type, 'delivery')
  assert.equal(order.guestToken, 'sess_guest_1')
  assert.equal(order.deliveryFee, 3)
  assert.equal(order.deliveryStatus, 'queued')
  assert.equal(order.customer.name, 'Sokha')
  assert.equal(order.customer.phone, '012345678')
  assert.equal(order.items.length, 1)
  assert.equal(order.items[0].menuItemId, 'm_burger')
  assert.equal(order.items[0].qty, 2)
})

test('GUEST_SEND never reuses an id already in the book', () => {
  const shop = fresh()
  const existing = shop.orders[0]
  const next = reducer(shop, deliveryOrder({
    orderId: existing.id,
    customer: { name: 'Collision Guest' },
    items: [{ menuItemId: 'm_burger', qty: 1 }],
  }))

  const created = next.orders.find((o) => o.customer?.name === 'Collision Guest')
  assert.ok(created, 'the order should still be created')
  assert.notEqual(created.id, existing.id, 'a colliding client id must not merge tickets')
  assert.equal(next.orders.find((o) => o.id === existing.id).customer?.name, existing.customer?.name)
})

test('delivery totals include the delivery fee', () => {
  const shop = fresh()
  const next = reducer(shop, deliveryOrder())
  const order = next.orders.find((o) => o.id === 'o_guest_client_1')
  const menuById = Object.fromEntries(next.menu.map((m) => [m.id, m]))
  const totals = orderTotals(order, menuById, next.settings.taxPct)

  assert.equal(totals.delivery, 3)
  assert.ok(totals.subtotal > 0)
  assert.ok(totals.total >= totals.subtotal + totals.tax + 3)
})

test('GUEST_SEND refuses an order with nothing orderable', () => {
  const shop = fresh()
  const next = reducer(shop, deliveryOrder({
    orderId: 'o_guest_empty',
    items: [{ menuItemId: 'not_on_the_menu', qty: 1 }],
  }))

  assert.equal(next, shop, 'nothing fired means the state must not change')
})

test('pay-now settles the order in the same action as the send', () => {
  const next = reducer(fresh(), deliveryOrder({ payNow: true, paymentMethod: 'card' }))
  const order = next.orders.find((o) => o.id === 'o_guest_client_1')
  const menuById = Object.fromEntries(next.menu.map((m) => [m.id, m]))
  const totals = orderTotals(order, menuById, next.settings.taxPct)

  assert.equal(order.status, 'paid')
  assert.ok(order.paidAt, 'the settlement timestamp is stamped')
  assert.equal(order.payMethod, 'card')
  assert.equal(order.total, totals.total, 'the stored check value matches the shared charge sheet')
  assert.equal(order.payments.length, 1)
  assert.equal(order.payments[0].method, 'card')
  assert.equal(order.payments[0].amount, totals.total)
})

test('pay-at-door leaves the order open for the rider to settle', () => {
  const next = reducer(fresh(), deliveryOrder({ payNow: false }))
  const order = next.orders.find((o) => o.id === 'o_guest_client_1')

  assert.notEqual(order.status, 'paid')
  assert.equal(order.paidAt, null)
  assert.equal(order.payments, undefined)
})

test('pickup and delivery quotes sanitize into safe service settings', () => {
  const settings = sanitizeSettings({
    pos: {
      deliveryFee: -4,
      minDeliveryOrder: 12.345,
      pickupEtaMinutes: 999,
      deliveryEtaMinutes: 0,
      payAtDoor: false,
      deliveryEnabled: false,
    },
  })

  assert.equal(settings.pos.deliveryFee, 0)
  assert.equal(settings.pos.minDeliveryOrder, 12.35)
  assert.equal(settings.pos.pickupEtaMinutes, 180)
  assert.equal(settings.pos.deliveryEtaMinutes, 5)
  assert.equal(settings.pos.payAtDoor, false)
  assert.equal(settings.pos.deliveryEnabled, false)
  assert.equal(settings.pos.payAtPickup, true, 'unset booleans keep the guest-friendly default')
})
