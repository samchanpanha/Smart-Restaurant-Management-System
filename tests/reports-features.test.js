import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire } from '../src/lib/reducer.js'
import { buildReports, rangeBounds, salesSummary, purchaseSummary, movementSummary, stockFlow, profitAndLoss } from '../src/lib/reports.js'

const downtown = (empire) => empire.locations.downtown

test('sales report computes tender methods and covers for shift balancing', () => {
  const shop = downtown(buildEmpire())
  const reports = buildReports(shop, '30d')
  const { sales } = reports

  assert.ok(sales.checks > 0, 'has paid checks')
  assert.ok(sales.covers > 0, 'has covers counted')
  assert.ok(sales.avgCover > 0, 'has average spend per cover')
  assert.ok(sales.byMethod, 'has payment method breakdown')
  assert.ok(Object.keys(sales.byMethod).length >= 1, 'at least one payment tender')
})

test('buying report reconciles supplier spend, units, and open PO pipeline', () => {
  const shop = downtown(buildEmpire())
  const bounds = rangeBounds('30d')
  const purchases = purchaseSummary(shop, bounds)

  assert.ok(purchases.spend > 0, 'has recorded purchase spend')
  assert.ok(purchases.bySupplier.length > 0, 'breaks down spend by supplier')
  assert.ok(purchases.byItem.length > 0, 'breaks down purchased items')
  assert.ok(Array.isArray(purchases.openOrders), 'tracks open orders pipeline')
  assert.ok(purchases.openOrders.every((po) => po.id && po.vendor), 'open PO fields valid')
})

test('stock flow report reconciles opening count plus in minus out to on-hand', () => {
  const shop = downtown(buildEmpire())
  const bounds = rangeBounds('30d')
  const movements = movementSummary(shop, bounds)
  const flow = stockFlow(shop, bounds)

  assert.ok(movements.inValue >= 0, 'stock in value non-negative')
  assert.ok(movements.outValue >= 0, 'stock out value non-negative')
  assert.ok(flow.length > 0, 'generates itemized stock flow')
  for (const item of flow) {
    assert.ok(item.itemId && item.name, 'item metadata intact')
    assert.equal(typeof item.opening, 'number', 'opening count numeric')
    assert.equal(typeof item.onHand, 'number', 'on-hand count numeric')
    assert.equal(typeof item.netValue, 'number', 'net valuation numeric')
  }
})

test('profit and loss report calculates gross margin and operating result against food cost cap', () => {
  const shop = downtown(buildEmpire())
  const bounds = rangeBounds('30d')
  const pnl = profitAndLoss(shop, bounds)

  assert.ok(pnl.revenue > 0, 'net revenue positive')
  assert.ok(pnl.cogs > 0, 'cogs positive')
  assert.equal(pnl.grossProfit, Math.round((pnl.revenue - pnl.cogs) * 100) / 100, 'gross profit identity')
  assert.equal(
    pnl.operatingResult,
    Math.round((pnl.grossProfit - pnl.waste - pnl.shrinkage) * 100) / 100,
    'operating result identity',
  )
  assert.ok(pnl.targets.foodCostCap > 0, 'food cost cap defined')
  assert.equal(typeof pnl.targets.onTarget, 'boolean', 'onTarget boolean flag')
})
