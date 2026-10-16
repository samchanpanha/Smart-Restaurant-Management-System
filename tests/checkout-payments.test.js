// ─── Rapid Bill Splitter & Multi-Tender Checkout Tests ───────────────
// Verifies Module 1 & Module 2:
// - Single tender and mixed tender payments (Cash + Card)
// - Tip calculation and tender details retention
// - Even and itemized bill split recording
// - Guest QR mobile payment with receipt generation

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'
import { buildReceiptDocument } from '../src/lib/documents.js'
import { orderCharges } from '../src/lib/models.js'

const act = (empire, locId, action) => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]

test('single tender card payment records tip and closes check', () => {
  let empire = buildEmpire()
  const table = shopOf(empire).tables.find((t) => t.status === 'ordered')
  const order = shopOf(empire).orders.find((o) => o.tableId === table.id && !['paid', 'void'].includes(o.status))
  assert.ok(order, 'found active ordered check')

  const tip = 6.50
  empire = act(empire, 'downtown', {
    type: 'PAY_ORDER',
    orderId: order.id,
    method: 'card',
    tip,
    tenderDetails: { method: 'card', cardType: 'visa', tip },
  })

  const paidOrder = shopOf(empire).orders.find((o) => o.id === order.id)
  assert.equal(paidOrder.status, 'paid')
  assert.equal(paidOrder.payMethod, 'card')
  assert.equal(paidOrder.tip, 6.50)
  assert.equal(paidOrder.tenderDetails.cardType, 'visa')
  assert.equal(paidOrder.payments.length, 1)
  assert.equal(paidOrder.payments[0].method, 'card')
  assert.equal(paidOrder.payments[0].amount, paidOrder.total + tip)
})

test('cash tender payment calculates and saves change details', () => {
  let empire = buildEmpire()
  const table = shopOf(empire).tables.find((t) => t.status === 'ordered')
  const order = shopOf(empire).orders.find((o) => o.tableId === table.id && !['paid', 'void'].includes(o.status))

  const menuById = Object.fromEntries(shopOf(empire).menu.map((m) => [m.id, m]))
  const charges = orderCharges(order, menuById, shopOf(empire).settings)
  const tip = 2.00
  const grandTotal = Math.round((charges.total + tip) * 100) / 100
  const cashTendered = Math.ceil(grandTotal / 10) * 10 + 10 // extra cash bill
  const changeDue = Math.round((cashTendered - grandTotal) * 100) / 100

  empire = act(empire, 'downtown', {
    type: 'PAY_ORDER',
    orderId: order.id,
    method: 'cash',
    tip,
    tenderDetails: {
      method: 'cash',
      cashTendered,
      changeDue,
      tip,
      total: grandTotal,
    },
    payments: [{ method: 'cash', amount: grandTotal, at: new Date().toISOString() }],
  })

  const paidOrder = shopOf(empire).orders.find((o) => o.id === order.id)
  assert.equal(paidOrder.status, 'paid')
  assert.equal(paidOrder.payMethod, 'cash')
  assert.equal(paidOrder.tenderDetails.cashTendered, cashTendered)
  assert.equal(paidOrder.tenderDetails.changeDue, changeDue)
  assert.equal(paidOrder.payments[0].amount, grandTotal)
})

test('mixed tender payment splits across cash and card', () => {
  let empire = buildEmpire()
  const table = shopOf(empire).tables.find((t) => t.status === 'ordered')
  const order = shopOf(empire).orders.find((o) => o.tableId === table.id && !['paid', 'void'].includes(o.status))

  const menuById = Object.fromEntries(shopOf(empire).menu.map((m) => [m.id, m]))
  const charges = orderCharges(order, menuById, shopOf(empire).settings)
  const tip = 4.00
  const grandTotal = Math.round((charges.total + tip) * 100) / 100

  const cashPart = 20.00
  const cardPart = Math.round((grandTotal - cashPart) * 100) / 100

  empire = act(empire, 'downtown', {
    type: 'PAY_ORDER',
    orderId: order.id,
    method: 'split',
    tip,
    tenderDetails: {
      method: 'mixed',
      mixedDetails: { cash: cashPart, card: cardPart },
      tip,
      total: grandTotal,
    },
    payments: [
      { method: 'cash', amount: cashPart, at: new Date().toISOString() },
      { method: 'card', amount: cardPart, at: new Date().toISOString() },
    ],
  })

  const paidOrder = shopOf(empire).orders.find((o) => o.id === order.id)
  assert.equal(paidOrder.status, 'paid')
  assert.equal(paidOrder.payMethod, 'split')
  assert.equal(paidOrder.payments.length, 2)
  assert.equal(paidOrder.payments[0].method, 'cash')
  assert.equal(paidOrder.payments[0].amount, cashPart)
  assert.equal(paidOrder.payments[1].method, 'card')
  assert.equal(paidOrder.payments[1].amount, cardPart)

  // Verify orderCharges computes 0 balance when payments are recorded
  const finalCharges = orderCharges(paidOrder, menuById, shopOf(empire).settings, { tip })
  assert.equal(finalCharges.paid, grandTotal)
  assert.equal(finalCharges.balance, 0)
})

test('even split check divides totals among diners', () => {
  let empire = buildEmpire()
  const table = shopOf(empire).tables.find((t) => t.status === 'ordered')
  const order = shopOf(empire).orders.find((o) => o.tableId === table.id && !['paid', 'void'].includes(o.status))

  const menuById = Object.fromEntries(shopOf(empire).menu.map((m) => [m.id, m]))
  const charges = orderCharges(order, menuById, shopOf(empire).settings)
  const ways = 3
  const eachPays = Math.round((charges.total / ways) * 100) / 100

  empire = act(empire, 'downtown', {
    type: 'PAY_ORDER',
    orderId: order.id,
    method: 'card',
    split: { kind: 'even', ways, each: eachPays },
  })

  const paidOrder = shopOf(empire).orders.find((o) => o.id === order.id)
  assert.equal(paidOrder.split.kind, 'even')
  assert.equal(paidOrder.split.ways, 3)
  assert.equal(paidOrder.split.each, eachPays)
})

test('guest QR checkout closes check and receipt document builds cleanly', () => {
  let empire = buildEmpire()
  const table = shopOf(empire).tables.find((t) => t.status === 'ordered')
  const order = shopOf(empire).orders.find((o) => o.tableId === table.id && !['paid', 'void'].includes(o.status))

  empire = act(empire, 'downtown', {
    type: 'PAY_ORDER',
    orderId: order.id,
    method: 'apple_pay',
    tip: 5.00,
    split: { kind: 'full', by: 'guest' },
    freeTable: false,
    tenderDetails: { method: 'apple_pay', tip: 5.00 },
  })

  const shop = shopOf(empire)
  const paidOrder = shop.orders.find((o) => o.id === order.id)
  assert.equal(paidOrder.status, 'paid')
  assert.equal(paidOrder.tip, 5.00)

  // Build a receipt document for this check
  const receipt = buildReceiptDocument({ shop, order: paidOrder, settings: shop.settings })
  assert.equal(receipt.kind, 'receipt')
  assert.ok(receipt.totals.total > 0)
  assert.equal(receipt.totals.tip, 5.00)
})
