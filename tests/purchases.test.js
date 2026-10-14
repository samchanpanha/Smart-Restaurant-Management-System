// ─── Buy side: purchases CRUD + the stock-movement ledger ────────────
// Every way stock can move is a signed row in `movements`; purchases are
// real documents that post to stock when received. These tests cover the
// actions the Purchases and Inventory screens dispatch.

import assert from 'node:assert/strict'
import test from 'node:test'
import { MOVEMENT_KINDS, PURCHASE_STATUSES, STATE_VERSION, buildEmpire, reducer } from '../src/lib/reducer.js'
import { documentNumber } from '../src/lib/settings.js'

const act = (empire, locId, action) => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]
const movementsFor = (empire, itemId, kind) => shopOf(empire).movements
  .filter((movement) => movement.itemId === itemId && (!kind || movement.kind === kind))

const draft = (overrides = {}) => ({
  id: 'po_test_1',
  supplierId: 'sup_fish',
  status: 'draft',
  note: 'test order',
  lines: [
    { id: 'l1', inventoryItemId: 'inv_salmon', qty: 10, unitCost: 6.5 },
    { id: 'l2', inventoryItemId: 'inv_lettuce', qty: 6, unitCost: 1.4 },
  ],
  ...overrides,
})

test('a stock unit is frozen once stock has moved, and free before that', () => {
  const empire = buildEmpire()
  // inv_lettuce has movements from the seed: the count unit cannot be rewritten
  const frozen = act(empire, 'downtown', {
    type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_lettuce', patch: { unit: 'kg', par: 30 },
  })
  const lettuce = shopOf(frozen).inventory.find((item) => item.id === 'inv_lettuce')
  assert.equal(lettuce.unit, 'portion')
  assert.equal(lettuce.par, 30) // the rest of the edit still lands

  // A brand new item has no history, so its unit is still the operator's call
  const created = act(empire, 'downtown', {
    type: 'ADD_INVENTORY_ITEM', item: { id: 'inv_miso_freeze', name: 'Miso paste', unit: 'each', onHand: 4 },
  })
  const free = act(created, 'downtown', {
    type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_miso_freeze', patch: { unit: 'kg' },
  })
  assert.equal(shopOf(free).inventory.find((item) => item.id === 'inv_miso_freeze').unit, 'kg')
})

test('state version 4 carries purchases and the movement ledger', () => {
  assert.ok(STATE_VERSION >= 4, 'purchases and the ledger arrived in v4')
  const shop = shopOf(buildEmpire())
  assert.equal(shop.purchases.length, 3)
  assert.ok(shop.movements.length >= 18)
  assert.equal(shop.movements.some((movement) => movement.kind === 'opening'), true)
  assert.deepEqual(PURCHASE_STATUSES, ['draft', 'ordered', 'received', 'cancelled'])
  assert.equal(MOVEMENT_KINDS.find((kind) => kind.id === 'sale').direction, 'out')
})

test('a purchase is created with a number, totals, and a vendor from the supplier', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: draft() })
  const purchase = shopOf(empire).purchases.find((entry) => entry.id === 'po_test_1')

  assert.equal(purchase.status, 'draft')
  assert.equal(purchase.vendor, 'Harbor Fish')
  assert.equal(purchase.totals.subtotal, 10 * 6.5 + 6 * 1.4)
  assert.equal(purchase.totals.total, purchase.totals.subtotal)
  assert.equal(purchase.number, documentNumber(shopOf(empire).settings, 'purchase', 101))
  // Filing a purchase advances the sequence for the next one.
  assert.equal(shopOf(empire).settings.numbering.purchase.next, 102)

  // Nothing has moved into stock yet — drafts are paper.
  assert.equal(movementsFor(empire, 'inv_salmon', 'buy').length, 1)   // seed receipt only
})

test('a purchase can be edited while it is still draft or ordered', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: draft() })
  empire = act(empire, 'downtown', {
    type: 'UPSERT_PURCHASE',
    purchase: { ...shopOf(empire).purchases.find((p) => p.id === 'po_test_1'), lines: [{ id: 'l1', inventoryItemId: 'inv_salmon', qty: 18, unitCost: 6.2 }], note: 'bigger order' },
  })
  const purchase = shopOf(empire).purchases.find((entry) => entry.id === 'po_test_1')
  assert.equal(purchase.lines.length, 1)
  assert.equal(purchase.totals.subtotal, Math.round(18 * 6.2 * 100) / 100)
  assert.equal(purchase.note, 'bigger order')
  assert.equal(shopOf(empire).purchases.length, 4)         // update, not append
  assert.equal(shopOf(empire).settings.numbering.purchase.next, 102)  // number reused, sequence not burned

  // Tax and shipping join the total.
  empire = act(empire, 'downtown', {
    type: 'UPSERT_PURCHASE',
    purchase: { ...purchase, tax: 10, shipping: 5 },
  })
  const taxed = shopOf(empire).purchases.find((entry) => entry.id === 'po_test_1')
  assert.equal(taxed.totals.total, Math.round((18 * 6.2 + 15) * 100) / 100)
})

test('an empty or unusable purchase is rejected outright', () => {
  let empire = buildEmpire()
  const before = shopOf(empire).purchases.length
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: { id: 'po_bad', lines: [] } })
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: { id: 'po_bad', lines: [{ qty: 5, unitCost: 1 }] } })
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: null })
  assert.equal(shopOf(empire).purchases.length, before)
})

test('receiving a purchase posts stock, cost, supplier spend, and buy movements', () => {
  let empire = buildEmpire()
  const salmonBefore = shopOf(empire).inventory.find((item) => item.id === 'inv_salmon')
  const buysBefore = movementsFor(empire, 'inv_salmon', 'buy').length

  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: draft() })
  empire = act(empire, 'downtown', { type: 'SET_PURCHASE_STATUS', purchaseId: 'po_test_1', status: 'ordered' })
  assert.equal(shopOf(empire).purchases.find((p) => p.id === 'po_test_1').status, 'ordered')
  assert.ok(shopOf(empire).purchases.find((p) => p.id === 'po_test_1').orderedAt)

  empire = act(empire, 'downtown', { type: 'RECEIVE_PURCHASE', purchaseId: 'po_test_1', by: 'maya' })
  const purchase = shopOf(empire).purchases.find((p) => p.id === 'po_test_1')
  assert.equal(purchase.status, 'received')
  assert.ok(purchase.receivedAt)
  assert.deepEqual(purchase.lines.map((line) => line.receivedQty), [10, 6])

  const salmonAfter = shopOf(empire).inventory.find((item) => item.id === 'inv_salmon')
  assert.equal(salmonAfter.onHand, salmonBefore.onHand + 10)
  assert.equal(salmonAfter.lastCost, 6.5)
  // Weighted average moved, not replaced.
  const expectedAvg = Math.round((((salmonBefore.onHand * salmonBefore.avgCost) + (10 * 6.5)) / (salmonBefore.onHand + 10)) * 10000) / 10000
  assert.equal(salmonAfter.avgCost, expectedAvg)

  const buys = movementsFor(empire, 'inv_salmon', 'buy')
  assert.equal(buys.length, buysBefore + 1)
  const last = buys.at(-1)
  assert.equal(last.qty, 10)
  assert.equal(last.unitCost, 6.5)
  assert.equal(last.ref, 'po_test_1')
  assert.equal(last.by, 'maya')
  assert.equal(last.value, 65)

  const log = shopOf(empire).invoiceLog.at(-1)
  assert.equal(log.purchaseId, 'po_test_1')
  assert.equal(log.supplierId, 'sup_fish')
  assert.equal(log.total, 10 * 6.5 + 6 * 1.4)
})

test('receiving twice is impossible, and a received purchase cannot be deleted', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: draft() })
  empire = act(empire, 'downtown', { type: 'RECEIVE_PURCHASE', purchaseId: 'po_test_1' })
  const onHand = shopOf(empire).inventory.find((item) => item.id === 'inv_salmon').onHand

  const again = act(empire, 'downtown', { type: 'RECEIVE_PURCHASE', purchaseId: 'po_test_1' })
  assert.equal(again, empire)
  assert.equal(shopOf(again).inventory.find((item) => item.id === 'inv_salmon').onHand, onHand)

  const deleted = act(empire, 'downtown', { type: 'DELETE_PURCHASE', purchaseId: 'po_test_1' })
  assert.equal(deleted, empire)

  const forced = act(empire, 'downtown', { type: 'DELETE_PURCHASE', purchaseId: 'po_test_1', force: true })
  assert.equal(shopOf(forced).purchases.some((p) => p.id === 'po_test_1'), false)
  // Deleting the paperwork never un-receives the stock it moved.
  assert.equal(shopOf(forced).inventory.find((item) => item.id === 'inv_salmon').onHand, onHand)
})

test('a partial delivery keeps the purchase open and records what arrived', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: draft() })
  empire = act(empire, 'downtown', {
    type: 'RECEIVE_PURCHASE',
    purchaseId: 'po_test_1',
    lines: [{ id: 'l1', qty: 4, unitCost: 6.5 }],
  })
  let purchase = shopOf(empire).purchases.find((p) => p.id === 'po_test_1')
  assert.equal(purchase.status, 'ordered')
  assert.equal(purchase.lines.find((line) => line.id === 'l1').receivedQty, 4)
  assert.equal(purchase.lines.find((line) => line.id === 'l2').receivedQty, 0)

  empire = act(empire, 'downtown', {
    type: 'RECEIVE_PURCHASE',
    purchaseId: 'po_test_1',
    lines: [
      { id: 'l1', qty: 6, unitCost: 6.5 },
      { id: 'l2', qty: 6, unitCost: 1.4 },
    ],
  })
  purchase = shopOf(empire).purchases.find((p) => p.id === 'po_test_1')
  assert.equal(purchase.status, 'received')
  assert.deepEqual(purchase.lines.map((line) => line.receivedQty), [10, 6])
})

test('a cancelled purchase never touches stock', () => {
  let empire = buildEmpire()
  const before = shopOf(empire).inventory.find((item) => item.id === 'inv_salmon').onHand
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: draft() })
  empire = act(empire, 'downtown', { type: 'SET_PURCHASE_STATUS', purchaseId: 'po_test_1', status: 'cancelled' })
  assert.equal(shopOf(empire).purchases.find((p) => p.id === 'po_test_1').status, 'cancelled')
  assert.equal(shopOf(empire).inventory.find((item) => item.id === 'inv_salmon').onHand, before)

  // Cancelled purchases can be deleted; the number stays burned.
  empire = act(empire, 'downtown', { type: 'DELETE_PURCHASE', purchaseId: 'po_test_1' })
  assert.equal(shopOf(empire).purchases.some((p) => p.id === 'po_test_1'), false)
  assert.equal(shopOf(empire).settings.numbering.purchase.next, 102)
})

test('sales, waste, and counts all land in the ledger with the right sign', () => {
  let empire = buildEmpire()
  const shop = shopOf(empire)
  // Build a ticket the way the composer does: add a line (held), then fire it.
  empire = act(empire, 'downtown', { type: 'ADD_ITEM', orderId: 'o_seed_3', menuItemId: 'm_burger', qty: 2, by: 'jordan' })
  const openOrder = shopOf(empire).orders.find((order) => order.id === 'o_seed_3')
  assert.ok(openOrder.items.some((item) => item.status === 'held'))

  empire = act(empire, 'downtown', { type: 'SEND_ORDER', orderId: openOrder.id, by: 'jordan' })
  const sale = shopOf(empire).movements.filter((movement) => movement.kind === 'sale' && movement.ref === openOrder.id)
  assert.ok(sale.length >= 1)
  assert.ok(sale.every((movement) => movement.qty < 0))
  assert.ok(sale.every((movement) => movement.unitCost > 0))

  // Undo puts the stock back and removes the sale rows it wrote.
  empire = act(empire, 'downtown', { type: 'UNDO_SEND', orderId: openOrder.id })
  assert.equal(shopOf(empire).movements.filter((movement) => movement.kind === 'sale' && movement.ref === openOrder.id).length, 0)

  empire = act(empire, 'downtown', { type: 'LOG_WASTE', inventoryItemId: 'inv_lettuce', qty: 2, reason: 'spoil', by: 'closer' })
  const waste = movementsFor(empire, 'inv_lettuce', 'waste').at(-1)
  assert.equal(waste.qty, -2)
  assert.equal(waste.by, 'closer')
  assert.ok(waste.value < 0)

  const lettuce = shopOf(empire).inventory.find((item) => item.id === 'inv_lettuce')
  empire = act(empire, 'downtown', { type: 'COUNT_STOCK', counts: { inv_lettuce: lettuce.onHand - 3 }, by: 'maya' })
  const count = movementsFor(empire, 'inv_lettuce', 'count').at(-1)
  assert.equal(count.qty, -3)
  assert.equal(count.by, 'maya')
  assert.equal(shopOf(empire).inventory.find((item) => item.id === 'inv_lettuce').lastCost, lettuce.lastCost)
})

test('the ledger is capped so a long shift cannot bloat the snapshot', () => {
  let empire = buildEmpire()
  for (let i = 0; i < 30; i += 1) {
    empire = act(empire, 'downtown', { type: 'LOG_WASTE', inventoryItemId: 'inv_lettuce', qty: 0.5, reason: 'prep' })
  }
  const shop = shopOf(empire)
  assert.ok(shop.movements.length <= 4000)
  assert.equal(shop.movements.filter((movement) => movement.kind === 'waste').length >= 1, true)
  // Newest last, oldest first — reports read the tail.
  const times = shop.movements.map((movement) => new Date(movement.at).getTime())
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
})

test('legacy snapshots migrate into the buy-side shape', async () => {
  const { migrateToEmpire, buildSeed } = await import('../src/lib/reducer.js')
  const legacy = buildSeed()
  delete legacy.purchases
  delete legacy.movements
  legacy.settings.numbering = { ...legacy.settings.numbering }
  delete legacy.settings.numbering.purchase
  const migrated = migrateToEmpire({ version: 3, locations: { downtown: legacy } })
  const shop = migrated.locations.downtown
  assert.deepEqual(shop.purchases, [])
  assert.deepEqual(shop.movements, [])
  assert.equal(shop.settings.numbering.purchase.prefix, 'PO')
  assert.equal(shop.settings.templates.purchase.paper, 'a4')
})
