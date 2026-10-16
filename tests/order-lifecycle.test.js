// ─── Order lifecycle: the journey from a guest's order to a settled check ──
//
// The ticket is the system of record. These tests walk the whole path a
// check takes — a guest orders by QR, the kitchen fires and bumps it, a
// server serves it, the cashier takes the money — and check that the order
// record and the sales record agree at the end.
//
// They also pin the two rules that keep a busy room honest: a ticket may
// only move along the state machine, and a check may only be settled once.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'
import { TICKET_STATUSES, TICKET_TRANSITIONS } from '../src/lib/constants.js'
import { orderCharges } from '../src/lib/models.js'
import { buildShiftReport } from '../src/lib/documents.js'
import { rangeBounds, salesSummary } from '../src/lib/reports.js'

const act = (empire, action, locId = 'downtown') => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]
const orderOf = (empire, orderId) => shopOf(empire).orders.find((o) => o.id === orderId)
const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance

// ─── The whole journey ─────────────────────────────────────────────

test('a guest order travels from the QR menu to a settled check', () => {
  let empire = buildEmpire()
  const menu = shopOf(empire).menu
  const burger = menu.find((m) => m.id === 'm_burger')
  const soda = menu.find((m) => m.id === 'm_soda')

  // 1. The guest orders from the table tent card.
  empire = act(empire, {
    type: 'GUEST_SEND',
    tableId: 't08',
    items: [{ menuItemId: burger.id, qty: 2 }, { menuItemId: soda.id, qty: 2 }],
  })
  const order = shopOf(empire).orders.find((o) => o.tableId === 't08' && !['paid', 'void'].includes(o.status))
  assert.ok(order, 'the guest check exists')
  assert.equal(order.status, 'sent', 'the kitchen has the ticket')
  assert.equal(order.items.length, 2)
  assert.ok(order.items.every((item) => item.status === 'fired'), 'guest lines are fired straight away')

  // 2. The kitchen bumps the lines. The ticket follows the food.
  for (const item of order.items) {
    empire = act(empire, { type: 'BUMP_ITEM', orderId: order.id, itemId: item.id })
  }
  assert.equal(orderOf(empire, order.id).status, 'ready', 'the last bump makes the ticket ready')

  // 3. A server hands the plates over.
  empire = act(empire, { type: 'SERVE_ORDER', orderId: order.id })
  assert.equal(orderOf(empire, order.id).status, 'served')

  // 4. The cashier closes the check.
  const menuById = Object.fromEntries(shopOf(empire).menu.map((m) => [m.id, m]))
  const expected = orderCharges(orderOf(empire, order.id), menuById, shopOf(empire).settings, { tip: 5 })
  empire = act(empire, {
    type: 'PAY_ORDER',
    orderId: order.id,
    method: 'card',
    tip: 5,
    tenderDetails: { method: 'card', tip: 5 },
  })

  const paid = orderOf(empire, order.id)
  assert.equal(paid.status, 'paid')
  assert.equal(paid.paidAt != null, true, 'the settlement is dated')
  assert.equal(paid.tip, 5)

  // 5. The order record and the sales record agree.
  assert.equal(paid.total, expected.total, 'the check value is the charge sheet total')
  assert.equal(paid.charges.grandTotal, expected.grandTotal, 'the record carries what was collected')
  assert.equal(paid.payments[0].amount, expected.grandTotal, 'the tender matches the money taken')
  assert.equal(shopOf(empire).tables.find((t) => t.id === 't08').status, 'billed', 'the table is billed')

  const sales = salesSummary(shopOf(empire), rangeBounds('tonight'))
  assert.equal(sales.checks, 9, 'the settled check joined tonight’s sales')
  assert.ok(sales.takings >= paid.charges.grandTotal, 'the takings include what was collected')
})

test('the shift report and the sales report quote the same night', () => {
  const shop = shopOf(buildEmpire())
  const sales = salesSummary(shop, rangeBounds('tonight'))
  const shift = buildShiftReport(shop, { range: 'tonight' })
  const dashboardSales = shift.kpis.find((kpi) => kpi.label === 'Net sales')

  // One money, three readers: the sales report, the shift report and the
  // dashboard KPI must never report two different services.
  assert.ok(dashboardSales, 'the shift report carries a sales KPI')
  assert.ok(near(dashboardSales.value, sales.takings), 'the shift report and the sales report agree')
  assert.ok(near(sales.takings, sales.revenue), 'takings are the money collected')
  assert.ok(sales.netSales < sales.takings, 'tax and tips are not sales')
  assert.ok(near(sales.avgCheck, sales.takings / sales.checks), 'the average check is money over checks')
})

// ─── The status machine ───────────────────────────────────────────

test('a ticket only moves along the state machine', () => {
  const machine = TICKET_TRANSITIONS
  assert.deepEqual(Object.keys(machine).sort(), [...TICKET_STATUSES].sort(), 'every status has a row')

  let empire = buildEmpire()
  const sent = shopOf(empire).orders.find((o) => o.status === 'sent')

  // A ticket the kitchen has not started cannot be served.
  empire = act(empire, { type: 'SERVE_ORDER', orderId: sent.id })
  assert.notEqual(orderOf(empire, sent.id).status, 'served', 'a ticket that is not ready is not served')

  // A guest who is leaving settles early — legal, and written down.
  assert.ok(machine.sent.includes('paid'), 'a ticket the kitchen has not finished can still be settled')
  empire = act(empire, { type: 'PAY_ORDER', orderId: sent.id, method: 'card' })
  assert.equal(orderOf(empire, sent.id).status, 'paid', 'the early settlement went through')

  // A ticket that was never sent cannot be settled at all.
  const open = { id: 'o_open', tableId: 't08', type: 'dine_in', serverId: 'server', status: 'open', createdAt: new Date().toISOString(), items: [] }
  empire = act(empire, { type: 'CREATE_ORDER', id: open.id, tableId: open.tableId })
  empire = act(empire, { type: 'PAY_ORDER', orderId: open.id, method: 'card' })
  assert.notEqual(orderOf(empire, open.id)?.status, 'paid', 'a check the kitchen never saw is not settled')

  // A ticket that is ready may be served, and a served one may be paid.
  assert.ok(machine.ready.includes('served'))
  assert.ok(machine.served.includes('paid'))
  assert.deepEqual(machine.paid, [], 'a settled check is closed for good')
  assert.deepEqual(machine.void, [], 'a voided check is closed for good')
})

test('a ticket cannot be served while food is still cooking', () => {
  let empire = buildEmpire()
  // Table 3 is mid-prep: one line is still in the pan.
  const order = shopOf(empire).orders.find((o) => o.id === 'o_seed_3')
  assert.equal(order.status, 'in_prep')
  assert.ok(order.items.some((item) => item.status === 'fired'))

  empire = act(empire, { type: 'SERVE_ORDER', orderId: order.id })
  assert.equal(orderOf(empire, order.id).status, 'in_prep', 'the plates are not handed over yet')
})

test('a new course fired onto a finished ticket puts it back in the kitchen', () => {
  let empire = buildEmpire()
  const order = shopOf(empire).orders.find((o) => o.id === 'o_seed_9')
  assert.equal(order.status, 'served')

  // A dessert ordered after the main course was handed over.
  empire = act(empire, { type: 'ADD_ITEM', orderId: order.id, menuItemId: 'm_cake', qty: 1, course: 'dessert' })
  empire = act(empire, { type: 'SEND_ORDER', orderId: order.id })

  const cooking = orderOf(empire, order.id)
  assert.equal(cooking.status, 'in_prep', 'the ticket follows the food, not the clock')
  assert.ok(cooking.items.some((item) => item.status === 'fired'), 'the dessert is in the pan')

  // And it comes back around the loop: bumped to ready, then served again.
  for (const item of cooking.items.filter((entry) => entry.status === 'fired')) {
    empire = act(empire, { type: 'BUMP_ITEM', orderId: order.id, itemId: item.id })
  }
  assert.equal(orderOf(empire, order.id).status, 'ready')
  empire = act(empire, { type: 'SERVE_ORDER', orderId: order.id })
  assert.equal(orderOf(empire, order.id).status, 'served')
})

test('a voided line does not hold a ticket out of ready forever', () => {
  let empire = buildEmpire()
  const order = shopOf(empire).orders.find((o) => o.id === 'o_seed_3')
  const fired = order.items.find((item) => item.status === 'fired')
  assert.ok(fired, 'the ticket has a line in the pan')

  // The manager sends the line back: it leaves production, so it must not
  // keep the ticket from ever being ready.
  empire = act(empire, { type: 'VOID_ITEM', orderId: order.id, itemId: fired.id, reason: 'sent back' })
  for (const item of orderOf(empire, order.id).items.filter((entry) => entry.status === 'fired')) {
    empire = act(empire, { type: 'BUMP_ITEM', orderId: order.id, itemId: item.id })
  }
  assert.equal(orderOf(empire, order.id).status, 'ready', 'the last live line bumped makes the ticket ready')
})

// ─── Money ────────────────────────────────────────────────────────

test('a check is settled once — a second payment moves nothing', () => {
  let empire = buildEmpire()
  const order = shopOf(empire).orders.find((o) => o.id === 'o_seed_3')
  empire = act(empire, { type: 'PAY_ORDER', orderId: order.id, method: 'card', tip: 4 })
  const settled = orderOf(empire, order.id)
  assert.equal(settled.status, 'paid')

  // A double tap at the till, a replayed action, or a second terminal.
  empire = act(empire, { type: 'PAY_ORDER', orderId: order.id, method: 'card', tip: 40 })
  const after = orderOf(empire, order.id)
  assert.equal(after.total, settled.total, 'the check value did not move')
  assert.equal(after.tip, settled.tip, 'the tip did not move')
  assert.deepEqual(after.payments, settled.payments, 'no second tender was recorded')
  assert.equal(after.paidAt, settled.paidAt, 'the settlement is still the first one')
})

test('a settled check records the money it was actually paid', () => {
  let empire = buildEmpire()
  const order = shopOf(empire).orders.find((o) => o.id === 'o_seed_3')
  empire = act(empire, { type: 'PAY_ORDER', orderId: order.id, method: 'card', tip: 4 })
  const paid = orderOf(empire, order.id)
  const menuById = Object.fromEntries(shopOf(empire).menu.map((m) => [m.id, m]))
  const charges = orderCharges(paid, menuById, shopOf(empire).settings, { tip: 4 })

  assert.equal(paid.total, charges.total, 'the check value is goods plus tax and service')
  assert.ok(paid.total > charges.subtotal, 'the check value is more than the food subtotal')
  assert.equal(paid.charges.tax, charges.tax)
  assert.equal(paid.charges.grandTotal, charges.grandTotal)
  assert.equal(paid.payments[0].amount, charges.grandTotal, 'the tender is the money taken')
})

test('the reports and the ticket read one number for the same service', () => {
  let empire = buildEmpire()
  const order = shopOf(empire).orders.find((o) => o.id === 'o_seed_3')
  empire = act(empire, { type: 'PAY_ORDER', orderId: order.id, method: 'card', tip: 4 })
  const shop = shopOf(empire)
  const paid = shop.orders.find((o) => o.id === order.id)

  const sales = salesSummary(shop, rangeBounds('tonight'))
  const menuById = Object.fromEntries(shop.menu.map((m) => [m.id, m]))
  const charges = orderCharges(paid, menuById, shop.settings)

  // The takings include the tip; the check value does not.
  assert.ok(sales.takings >= charges.grandTotal, 'the takings include what was collected')
  assert.ok(charges.grandTotal > charges.total, 'the tip rides on top of the check value')
  const shift = buildShiftReport(shop, { range: 'tonight' })
  const kpi = shift.kpis.find((entry) => entry.label === 'Net sales')
  assert.ok(near(kpi.value, sales.takings), 'the shift report agrees with the sales report')
})
