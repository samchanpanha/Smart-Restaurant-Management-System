// ─── "Not counted" inventory items ───────────────────────────────────
// An item can be flagged `counted: false` (supplies, one-off purchases).
// Those items sit outside stock tracking — count sheets, alerts, auto-86,
// theoretical usage, and stock-flow reporting skip them. Receiving still
// adds stock and updates cost, so the item stays a real spend record.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, getAlerts, reducer } from '../src/lib/reducer.js'
import { applyAuto86, stockStatusFor, stockValue } from '../src/lib/models.js'
import { buildShiftReport } from '../src/lib/documents.js'
import { movementSummary, rangeBounds, stockFlow } from '../src/lib/reports.js'

const act = (empire, action, locId = 'downtown') => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire) => empire.locations.downtown
const itemOf = (empire, id) => shopOf(empire).inventory.find((item) => item.id === id)

const notCounted = (empire, id) => act(empire, {
  type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: id, patch: { counted: false },
})

const purchaseFor = (overrides = {}) => ({
  id: 'po_not_counted_1',
  supplierId: null,
  status: 'draft',
  note: 'supplies',
  lines: [{ id: 'l1', inventoryItemId: 'inv_lettuce', qty: 6, unitCost: 2 }],
  ...overrides,
})

test('items are counted by default, and the flag round-trips through edits', () => {
  let empire = buildEmpire()
  assert.equal(itemOf(empire, 'inv_lettuce').counted, true)

  empire = notCounted(empire, 'inv_lettuce')
  assert.equal(itemOf(empire, 'inv_lettuce').counted, false)

  // A later edit keeps the flag; a brand-new item defaults back to counted.
  empire = act(empire, { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_lettuce', patch: { par: 30 } })
  assert.equal(itemOf(empire, 'inv_lettuce').counted, false)
  empire = act(empire, { type: 'ADD_INVENTORY_ITEM', item: { id: 'inv_supplies', name: 'To-go supplies', unit: 'each', onHand: 0 } })
  assert.equal(itemOf(empire, 'inv_supplies').counted, true)
})

test('stock status reads not_counted — never low, never out', () => {
  const shop = shopOf(buildEmpire())
  const lettuce = shop.inventory.find((item) => item.id === 'inv_lettuce')
  assert.equal(stockStatusFor({ ...lettuce, onHand: 0, counted: false }, shop.settings), 'not_counted')
  // Control: the same zero on a counted item reads out.
  assert.equal(stockStatusFor({ ...lettuce, onHand: 0 }, shop.settings), 'out')
})

test('count sheets ignore a not-counted item even when a count is posted', () => {
  let empire = buildEmpire()
  const lettuceBefore = itemOf(empire, 'inv_lettuce').onHand
  const bunBefore = itemOf(empire, 'inv_bun').onHand
  empire = notCounted(empire, 'inv_lettuce')

  empire = act(empire, {
    type: 'COUNT_STOCK',
    counts: { inv_lettuce: 1, inv_bun: bunBefore - 2 },
    by: 'maya',
  })

  assert.equal(itemOf(empire, 'inv_lettuce').onHand, lettuceBefore) // untouched
  assert.equal(itemOf(empire, 'inv_bun').onHand, bunBefore - 2) // control still reconciles
  assert.equal(
    shopOf(empire).movements.some((movement) => movement.itemId === 'inv_lettuce' && movement.kind === 'count'),
    false,
  )
})

test('firing a dish never decrements a not-counted ingredient', () => {
  let empire = buildEmpire()
  const lettuceBefore = itemOf(empire, 'inv_lettuce').onHand
  const bunBefore = itemOf(empire, 'inv_bun').onHand
  empire = notCounted(empire, 'inv_lettuce')

  empire = act(empire, { type: 'GUEST_SEND', tableId: 't08', items: [{ menuItemId: 'm_burger', qty: 1 }] })

  assert.equal(itemOf(empire, 'inv_lettuce').onHand, lettuceBefore)
  assert.equal(itemOf(empire, 'inv_bun').onHand, bunBefore - 1) // control ingredient dropped
  assert.equal(
    shopOf(empire).movements.some((movement) => movement.itemId === 'inv_lettuce' && movement.kind === 'sale'),
    false,
  )
})

test('receiving a purchase still adds stock and updates cost', () => {
  let empire = buildEmpire()
  const before = itemOf(empire, 'inv_lettuce')
  empire = notCounted(empire, 'inv_lettuce')

  empire = act(empire, { type: 'UPSERT_PURCHASE', purchase: purchaseFor() })
  empire = act(empire, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_not_counted_1' })

  const after = itemOf(empire, 'inv_lettuce')
  assert.equal(after.onHand, before.onHand + 6)
  assert.equal(after.lastCost, 2)
  assert.equal(
    shopOf(empire).movements.some((movement) => movement.itemId === 'inv_lettuce' && movement.kind === 'buy' && movement.ref === 'po_not_counted_1'),
    true,
  )
})

test('alerts and auto-86 skip a not-counted item', () => {
  let empire = buildEmpire()
  empire = notCounted(empire, 'inv_lettuce')
  empire = act(empire, { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_lettuce', patch: { onHand: 0 } })
  const shop = shopOf(empire)

  assert.equal(
    getAlerts(shop).some((alert) => alert.type === '86' && alert.entityId === 'inv_lettuce'),
    false,
  )
  assert.equal(applyAuto86(shop).menu.find((item) => item.id === 'm_burger').available, true)

  // Control: flip the flag back and the same zero 86's the burger.
  const control = {
    ...shop,
    inventory: shop.inventory.map((item) => (item.id === 'inv_lettuce' ? { ...item, counted: true } : item)),
  }
  assert.equal(
    getAlerts(control).some((alert) => alert.type === '86' && alert.entityId === 'inv_lettuce'),
    true,
  )
  assert.equal(applyAuto86(control).menu.find((item) => item.id === 'm_burger').available, false)
})

test('stock-flow reports and stock value exclude not-counted items', () => {
  let empire = buildEmpire()
  empire = notCounted(empire, 'inv_lettuce')
  empire = act(empire, { type: 'UPSERT_PURCHASE', purchase: purchaseFor({ id: 'po_not_counted_2' }) })
  empire = act(empire, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_not_counted_2' })
  const shop = shopOf(empire)

  const bounds = rangeBounds('30d')
  const summary = movementSummary(shop, bounds)
  assert.equal(summary.rows.some((movement) => movement.itemId === 'inv_lettuce'), false)
  assert.equal(summary.byItem.some((row) => row.itemId === 'inv_lettuce'), false)
  assert.equal(summary.rows.some((movement) => movement.itemId === 'inv_bun'), true) // other items stay

  const flow = stockFlow(shop, bounds)
  assert.equal(flow.some((row) => row.itemId === 'inv_lettuce'), false)

  const shift = buildShiftReport(shop)
  assert.equal(shift.variance.stockExceptions.some((row) => row.name === 'Lettuce portion'), false)

  const withoutFlag = stockValue({
    ...shop,
    inventory: shop.inventory.map((item) => (item.id === 'inv_lettuce' ? { ...item, counted: true } : item)),
  })
  assert.ok(withoutFlag > stockValue(shop))
})
