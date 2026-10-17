import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer, PURCHASE_STATUSES } from '../src/lib/reducer.js'

const act = (empire, locId, action) => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]

test('PURCHASE_STATUSES carries the standard lifecycle statuses', () => {
  assert.ok(PURCHASE_STATUSES.includes('draft'))
  assert.ok(PURCHASE_STATUSES.includes('ordered'))
  assert.ok(PURCHASE_STATUSES.includes('received'))
  assert.ok(PURCHASE_STATUSES.includes('cancelled'))
})

test('PO lifecycle transitions: draft -> ordered -> cancelled', () => {
  let empire = buildEmpire()
  const poId = 'po_lifecycle_test'
  const po = {
    id: poId,
    number: 'PO-2026-TEST',
    supplierId: 'sup_fish',
    status: 'draft',
    lines: [
      { id: 'pol_1', inventoryItemId: 'inv_salmon', name: 'Salmon', qty: 10, unitCost: 5, unit: 'each' },
    ],
  }
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: po })
  assert.equal(shopOf(empire).purchases.find((p) => p.id === poId).status, 'draft')

  // Mark ordered
  empire = act(empire, 'downtown', { type: 'SET_PURCHASE_STATUS', purchaseId: poId, status: 'ordered' })
  assert.equal(shopOf(empire).purchases.find((p) => p.id === poId).status, 'ordered')

  // Mark cancelled
  empire = act(empire, 'downtown', { type: 'SET_PURCHASE_STATUS', purchaseId: poId, status: 'cancelled' })
  assert.equal(shopOf(empire).purchases.find((p) => p.id === poId).status, 'cancelled')
})

test('RECEIVE_PURCHASE keeps status as ordered on partial receive and marks received on full receive', () => {
  let empire = buildEmpire()
  const poId = 'po_partial_test'
  const po = {
    id: poId,
    number: 'PO-2026-PART',
    supplierId: 'sup_fish',
    status: 'ordered',
    lines: [
      { id: 'pol_part_1', inventoryItemId: 'inv_salmon', name: 'Salmon', qty: 10, unitCost: 5, unit: 'each', packSize: 1 },
    ],
  }
  empire = act(empire, 'downtown', { type: 'UPSERT_PURCHASE', purchase: po })

  // Receive partial (4 of 10)
  empire = act(empire, 'downtown', {
    type: 'RECEIVE_PURCHASE',
    purchaseId: poId,
    lines: [{ id: 'pol_part_1', inventoryItemId: 'inv_salmon', qty: 4, unitCost: 5, unit: 'each', packSize: 1 }],
  })
  const afterPartial = shopOf(empire).purchases.find((p) => p.id === poId)
  assert.equal(afterPartial.status, 'ordered')
  assert.equal(afterPartial.lines[0].receivedQty, 4)

  // Receive remaining (6 of 10)
  empire = act(empire, 'downtown', {
    type: 'RECEIVE_PURCHASE',
    purchaseId: poId,
    lines: [{ id: 'pol_part_1', inventoryItemId: 'inv_salmon', qty: 6, unitCost: 5, unit: 'each', packSize: 1 }],
  })
  const afterFull = shopOf(empire).purchases.find((p) => p.id === poId)
  assert.equal(afterFull.status, 'received')
  assert.equal(afterFull.lines[0].receivedQty, 10)
})
