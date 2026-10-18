// ─── Guest checkout contracts ─────────────────────────────────────
// The guest UI creates a client id before dispatching GUEST_SEND so the
// confirmation, tracking tab, and bill can find the order the reducer
// created. These tests pin that contract plus the off-table totals.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeed, reducer } from '../src/lib/reducer.js'
import { orderTotals } from '../src/lib/models.js'

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
