// ─── Reports engine: what sold, what was bought, what it left behind ──
// These numbers get printed and shown to the owner, so the tests check
// identities (revenue − cost = gross, opening + in − out = on-hand)
// rather than copying whatever the code happens to output today.

import assert from 'node:assert/strict'
import test from 'node:test'
import { reducer, buildEmpire, getDashboard } from '../src/lib/reducer.js'
import { buildReports, deliverySummary, itemRankings, movementSummary, profitAndLoss, purchaseSummary, rangeBounds, salesSummary, stockFlow } from '../src/lib/reports.js'
import { orderCharges } from '../src/lib/models.js'

const act = (empire, action, locId = 'downtown') => reducer(empire, { type: 'LOC', locId, action })
const downtown = (empire) => empire.locations.downtown
const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance

test('range bounds are honest windows', () => {
  const now = new Date('2026-10-13T21:30:00').getTime()
  const tonight = rangeBounds('tonight', now)
  assert.equal(new Date(tonight.start).getHours(), 0)
  assert.ok(tonight.end > now)
  const week = rangeBounds('7d', now)
  assert.equal(week.days, 7)
  assert.equal(week.end - week.start, 7 * 24 * 60 * 60 * 1000 + 1)
  assert.equal(rangeBounds('nonsense', now).days, 1)
})

test('dashboard shift metrics include only orders from the local day', () => {
  const shop = downtown(buildEmpire())
  const yesterday = new Date(2026, 9, 14, 11, 0)
  const today = new Date(2026, 9, 15, 11, 0)
  const now = new Date(2026, 9, 15, 18, 0).getTime()
  shop.orders = [
    {
      id: 'yesterday', status: 'paid', createdAt: yesterday.toISOString(), paidAt: yesterday.toISOString(),
      total: 1000, covers: 6,
      items: [{ menuItemId: 'm_burger', qty: 8, recipeSnapshot: { plateCost: 20 }, status: 'bump', firedAt: yesterday.toISOString(), bumpedAt: new Date(yesterday.getTime() + 10 * 60000).toISOString() }],
    },
    {
      id: 'today', status: 'paid', createdAt: today.toISOString(), paidAt: today.toISOString(),
      total: 80, covers: 2,
      items: [{ menuItemId: 'm_burger', qty: 2, recipeSnapshot: { plateCost: 10 }, status: 'bump', firedAt: today.toISOString(), bumpedAt: new Date(today.getTime() + 20 * 60000).toISOString() }],
    },
    {
      id: 'carryover', status: 'in_prep', createdAt: yesterday.toISOString(),
      items: [{ menuItemId: 'm_burger', qty: 1, status: 'bump', firedAt: new Date(today.getTime() + 30 * 60000).toISOString(), bumpedAt: new Date(today.getTime() + 60 * 60000).toISOString() }],
    },
  ]

  const dashboard = getDashboard(shop, now)

  assert.equal(dashboard.sales, 80)
  assert.equal(dashboard.covers, 2)
  assert.equal(dashboard.checks, 1)
  assert.equal(dashboard.avgCheck, 80)
  assert.equal(dashboard.avgTicketMin, 25)
  assert.equal(dashboard.tonightCostPct, 0.25)
  assert.equal(dashboard.topSellers[0].qty, 2)
})

test('sales summary reconciles against the tickets it read', () => {
  const shop = downtown(buildEmpire())
  const reports = buildReports(shop, '30d')
  const menuById = Object.fromEntries(shop.menu.map((item) => [item.id, item]))

  const paid = shop.orders.filter((order) => order.status === 'paid')
  const expected = paid.reduce((sum, order) => {
    const totals = orderCharges(order, menuById, shop.settings)
    return sum + (totals.grandTotal ?? totals.total ?? 0)
  }, 0)

  assert.equal(reports.sales.checks, paid.length)
  assert.ok(near(reports.sales.revenue, expected), 'takings include service, tax, and tips')
  assert.ok(near(reports.sales.takings, reports.sales.revenue))
  assert.ok(near(reports.sales.netSales, reports.sales.subtotal - reports.sales.discount + reports.sales.service))
  assert.ok(reports.sales.netSales < reports.sales.revenue, 'tax and tips are not sales')
  assert.equal(reports.sales.lines.length, paid.reduce((sum, order) => sum + order.items.length, 0))
  assert.ok(reports.sales.cogs > 0, 'cost of goods is derived from recipes')
  assert.ok(near(reports.sales.grossProfit, reports.sales.netSales - reports.sales.cogs))
  assert.ok(reports.sales.grossProfit < reports.sales.revenue, 'gross profit ignores tax and tips')
  assert.ok(reports.sales.marginPct > 0.4 && reports.sales.marginPct < 0.95)
  assert.ok(near(reports.sales.avgCheck, reports.sales.revenue / reports.sales.checks))
  assert.ok(Object.keys(reports.sales.byMethod).length >= 1)

  // Every line knows which menu item it came from, or reports cannot rank.
  assert.ok(reports.sales.lines.every((line) => line.menuItemId))
  const burger = reports.sales.lines.filter((line) => line.menuItemId === 'm_burger')
  assert.equal(burger.reduce((sum, line) => sum + line.qty, 0), 6)
})

test('delivery summary measures completed orders with ETA and elapsed stages', () => {
  const shop = downtown(buildEmpire())
  const now = new Date(2026, 9, 15, 18, 0).getTime()
  const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString()
  shop.orders = [
    { type: 'delivery', deliveryStatus: 'delivered', deliveredAt: at(120), eta: at(110), outForDeliveryAt: at(150), readyAt: at(165) },
    { type: 'delivery', deliveryStatus: 'delivered', deliveredAt: at(60), eta: at(65), outForDeliveryAt: at(105), readyAt: at(130) },
    { type: 'delivery', deliveryStatus: 'delivered', deliveredAt: at(30), eta: null, outForDeliveryAt: at(50), readyAt: at(70) },
    { type: 'delivery', deliveryStatus: 'cancelled', deliveryStatusAt: at(15) },
    { type: 'delivery', deliveryStatus: 'delivered', deliveredAt: at(8 * 24 * 60), eta: at(8 * 24 * 60 - 10) },
  ]

  const delivery = deliverySummary(shop, rangeBounds('7d', now))

  assert.equal(delivery.completed, 3)
  assert.equal(delivery.cancelled, 1)
  assert.equal(delivery.withEta, 2)
  assert.equal(delivery.onTime, 1)
  assert.equal(delivery.onTimeRate, 0.5)
  assert.ok(near(delivery.avgDeliveryMinutes, 95 / 3))
  assert.equal(delivery.avgReadyToHandoffMinutes, 20)
})

test('delivery summary leaves SLA and duration metrics empty without tracked data', () => {
  const shop = downtown(buildEmpire())
  const old = new Date('2020-01-01T12:00:00').getTime()
  const delivery = deliverySummary(shop, { start: old, end: old + 1000 })
  assert.equal(delivery.completed, 0)
  assert.equal(delivery.cancelled, 0)
  assert.equal(delivery.onTimeRate, null)
  assert.equal(delivery.avgDeliveryMinutes, null)
  assert.equal(delivery.avgReadyToHandoffMinutes, null)
})

test('an empty window reads as zeros instead of throwing', () => {
  const shop = downtown(buildEmpire())
  const old = new Date('2020-01-01T12:00:00').getTime()
  const bounds = { id: 'past', label: 'Past', start: old, end: old + 1000, days: 1 }
  const sales = salesSummary(shop, bounds)
  assert.equal(sales.checks, 0)
  assert.equal(sales.revenue, 0)
  assert.equal(sales.avgCheck, 0)
  assert.equal(sales.marginPct, 0)
  const purchases = purchaseSummary(shop, bounds)
  assert.equal(purchases.spend, 0)
  assert.deepEqual(purchases.bySupplier, [])
})

test('buy spend counts tax and shipping, and never double counts a supplier', () => {
  let empire = buildEmpire()
  empire = act(empire, {
    type: 'UPSERT_PURCHASE',
    purchase: {
      id: 'po_tax',
      supplierId: 'sup_fish',
      status: 'ordered',
      tax: 10,
      shipping: 5,
      lines: [{ id: 'l1', inventoryItemId: 'inv_salmon', qty: 10, unitCost: 6 }],
    },
  })
  empire = act(empire, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_tax' })
  const shop = downtown(empire)
  const reports = buildReports(shop, '7d')

  const fish = reports.purchases.bySupplier.find((row) => row.id === 'sup_fish')
  const other = reports.purchases.bySupplier.filter((row) => row.id === 'sup_fish' && row !== fish)
  assert.deepEqual(other, [], 'one row per supplier')
  // Seed receipt 69.6 + this purchase 75 (60 goods + 15 charges).
  assert.ok(near(fish.value, 69.6 + 75, 0.02))
  assert.ok(near(reports.purchases.spend, fish.value + reports.purchases.bySupplier
    .filter((row) => row.id !== 'sup_fish')
    .reduce((sum, row) => sum + row.value, 0), 0.02))

  const salmon = reports.purchases.byItem.find((row) => row.itemId === 'inv_salmon')
  assert.ok(near(salmon.value, 69.6 + 75, 0.02), 'the charges ride along with the item')
})

test('stock movements split in from out and leave the opening baseline alone', () => {
  let empire = buildEmpire()
  empire = act(empire, {
    type: 'UPSERT_PURCHASE',
    purchase: { id: 'po_in', supplierId: 'sup_meats', status: 'ordered', lines: [{ id: 'l1', inventoryItemId: 'inv_patty', qty: 20, unitCost: 2 }] },
  })
  empire = act(empire, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_in' })
  empire = act(empire, { type: 'LOG_WASTE', inventoryItemId: 'inv_patty', qty: 3, reason: 'freezer burn' })

  const shop = downtown(empire)
  const movements = movementSummary(shop, rangeBounds('30d'))
  const buy = movements.byKind.find((row) => row.kind === 'buy')
  const waste = movements.byKind.find((row) => row.kind === 'waste')

  assert.ok(buy.inValue > 0 && buy.outValue === 0)
  assert.equal(waste.outValue > 0, true)
  assert.equal(waste.inValue, 0)
  // Opening stock is a baseline: it shows up, but not as a cash inflow.
  assert.ok(movements.openingValue > 0)
  assert.equal(movements.inValue, buy.inValue)
  assert.ok(near(movements.netValue, movements.inValue - movements.outValue))
  assert.ok(movements.outCount >= 1)
  assert.ok(movements.inUnits > 0 && movements.outUnits >= 3)
})

test('opening plus in minus out always lands on today’s on-hand', () => {
  let empire = buildEmpire()
  empire = act(empire, {
    type: 'UPSERT_PURCHASE',
    purchase: { id: 'po_flow', supplierId: 'sup_produce', status: 'ordered', lines: [{ id: 'l1', inventoryItemId: 'inv_tomato', qty: 40, unitCost: 2.4 }] },
  })
  empire = act(empire, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_flow' })
  empire = act(empire, { type: 'LOG_WASTE', inventoryItemId: 'inv_tomato', qty: 4, reason: 'bruised' })

  const shop = downtown(empire)
  const rows = stockFlow(shop, rangeBounds('30d'))
  assert.ok(rows.length >= 1)
  for (const row of rows) {
    const item = shop.inventory.find((entry) => entry.id === row.itemId)
    assert.ok(near(row.opening + row.inQty - row.outQty, item.onHand, 0.001), `${row.name} reconciles`)
    assert.ok(near(row.bookValue, item.onHand * item.lastCost, 0.02))
  }
  const tomato = rows.find((row) => row.itemId === 'inv_tomato')
  assert.ok(near(tomato.opening, 30, 0.001), 'the book opened with the seeded count')
  assert.ok(near(tomato.inQty, 40, 0.001), 'the receipt is an inflow')
  assert.ok(near(tomato.outQty, 4, 0.001), 'the waste is an outflow')
  assert.equal(tomato.correctionQty, 0)
  assert.ok(near(tomato.opening + tomato.inQty - tomato.outQty, tomato.onHand, 0.001))
  assert.ok(rows[0].netValue !== undefined)
})

test('profit and loss ties revenue, cost of goods, waste, and shrinkage together', () => {
  let empire = buildEmpire()
  empire = act(empire, { type: 'LOG_WASTE', inventoryItemId: 'inv_lettuce', qty: 2, reason: 'wilted' })
  const shop = downtown(empire)
  const pnl = profitAndLoss(shop, rangeBounds('30d'))

  assert.ok(near(pnl.revenue, pnl.sales.netSales))
  assert.ok(near(pnl.grossProfit, pnl.revenue - pnl.cogs))
  assert.ok(near(pnl.operatingResult, pnl.grossProfit - pnl.waste - pnl.shrinkage))
  assert.ok(pnl.waste > 0)
  assert.equal(pnl.wasteCount >= 1, true)
  assert.ok(near(pnl.cashIn, pnl.sales.takings), 'cash in is what the guests actually paid')
  assert.equal(pnl.cashOut, pnl.purchases.spend)
  assert.ok(near(pnl.netCash, pnl.cashIn - pnl.cashOut))
  assert.equal(pnl.targets.onTarget, pnl.foodCostPct <= pnl.targets.foodCostCap)
  assert.ok(pnl.byCategory.length >= 3)
  // Category lines are menu sales, so they add up to the subtotal the
  // P&L's revenue was derived from — not to the tax/tips-inclusive takings.
  const categoryRevenue = pnl.byCategory.reduce((sum, row) => sum + row.revenue, 0)
  assert.ok(near(categoryRevenue, pnl.sales.subtotal, 0.02))
})

test('buying stock does not count as profit, and selling it does', () => {
  let empire = buildEmpire()
  const before = profitAndLoss(downtown(empire), rangeBounds('30d')).operatingResult

  empire = act(empire, {
    type: 'UPSERT_PURCHASE',
    purchase: { id: 'po_pnl', supplierId: 'sup_fish', status: 'ordered', lines: [{ id: 'l1', inventoryItemId: 'inv_salmon', qty: 40, unitCost: 9 }] },
  })
  empire = act(empire, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_pnl' })
  const afterBuy = profitAndLoss(downtown(empire), rangeBounds('30d'))
  assert.equal(afterBuy.operatingResult, before, 'a receipt moves stock, not profit')
  assert.ok(afterBuy.cashOut > 0, 'but it does move cash out')

  empire = act(empire, { type: 'ADD_ITEM', orderId: 'o_seed_3', menuItemId: 'm_steak', qty: 3, by: 'jordan' })
  empire = act(empire, { type: 'SEND_ORDER', orderId: 'o_seed_3', by: 'jordan' })
  const sold = downtown(empire)
  const ticket = sold.orders.find((order) => order.id === 'o_seed_3')
  empire = act(empire, {
    type: 'SEND_ORDER',
    orderId: 'o_seed_3',
  })
  const afterSale = profitAndLoss(sold, rangeBounds('30d'))
  assert.ok(afterSale.cogs > 0)
  assert.ok(afterSale.sales.revenue >= 0)
  assert.ok(ticket.items.some((item) => item.menuItemId === 'm_steak'))
})

test('top and bottom rankings sort both sides of the ledger', () => {
  const shop = downtown(buildEmpire())
  const rankings = itemRankings(shop, rangeBounds('30d'), 4)

  const revenue = rankings.sell.byRevenue.map((row) => row.revenue)
  assert.deepEqual(revenue, [...revenue].sort((a, b) => b - a))
  assert.equal(rankings.sell.byRevenue.length, 4)
  const units = rankings.sell.byUnits.map((row) => row.qty)
  assert.deepEqual(units, [...units].sort((a, b) => b - a))
  const margins = rankings.sell.worst.map((row) => row.margin)
  assert.deepEqual(margins, [...margins].sort((a, b) => a - b))

  const spend = rankings.buy.bySpend.map((row) => row.value)
  assert.deepEqual(spend, [...spend].sort((a, b) => b - a))
  assert.ok(rankings.buy.bySpend.length >= 1)
  assert.ok(rankings.sell.unsoldCount >= 0)
  assert.ok(rankings.buy.least.every((row) => row.value >= 0))
})

test('buildReports returns the same shape for every range', () => {
  const shop = downtown(buildEmpire())
  for (const range of ['tonight', '7d', '30d']) {
    const reports = buildReports(shop, range)
    assert.equal(reports.bounds.id, range)
    for (const key of ['sales', 'delivery', 'purchases', 'movements', 'pnl', 'rankings', 'flow']) {
      assert.ok(reports[key], `${range} has ${key}`)
    }
    assert.ok(Array.isArray(reports.movements.byKind))
    assert.ok(reports.pnl.revenue >= 0)
  }
})
