import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'

test('TRANSFER_STOCK moves inventory between branches and records movements in both', () => {
  let empire = buildEmpire()
  const initialDowntown = empire.locations.downtown.inventory.find((i) => i.id === 'inv_tomato')?.onHand ?? 0
  const initialRiverside = empire.locations.riverside.inventory.find((i) => i.id === 'inv_tomato')?.onHand ?? 0

  assert.ok(initialDowntown > 5, 'Downtown has enough tomatoes')

  empire = reducer(empire, {
    type: 'TRANSFER_STOCK',
    fromLocId: 'downtown',
    toLocId: 'riverside',
    itemId: 'inv_tomato',
    qty: 5,
    notes: 'Rush rebalance',
    by: 'owner',
  })

  const afterDowntown = empire.locations.downtown.inventory.find((i) => i.id === 'inv_tomato')
  const afterRiverside = empire.locations.riverside.inventory.find((i) => i.id === 'inv_tomato')

  assert.equal(afterDowntown.onHand, initialDowntown - 5)
  assert.equal(afterRiverside.onHand, initialRiverside + 5)

  // Verify movements in downtown
  const dtMovement = empire.locations.downtown.movements.find(
    (m) => m.itemId === 'inv_tomato' && m.kind === 'transfer' && m.qty === -5,
  )
  assert.ok(dtMovement, 'Downtown has negative transfer movement')
  assert.equal(dtMovement.by, 'owner')

  // Verify movements in riverside
  const rsMovement = empire.locations.riverside.movements.find(
    (m) => m.itemId === 'inv_tomato' && m.kind === 'transfer' && m.qty === 5,
  )
  assert.ok(rsMovement, 'Riverside has positive transfer movement')
  assert.equal(rsMovement.by, 'owner')
})

test('TRANSFER_STOCK rejects invalid transfers gracefully', () => {
  const empire = buildEmpire()

  // Same location
  const same = reducer(empire, {
    type: 'TRANSFER_STOCK',
    fromLocId: 'downtown',
    toLocId: 'downtown',
    itemId: 'inv_tomato',
    qty: 5,
  })
  assert.equal(same, empire)

  // Invalid location
  const invalidLoc = reducer(empire, {
    type: 'TRANSFER_STOCK',
    fromLocId: 'downtown',
    toLocId: 'nonexistent',
    itemId: 'inv_tomato',
    qty: 5,
  })
  assert.equal(invalidLoc, empire)

  // Invalid item
  const invalidItem = reducer(empire, {
    type: 'TRANSFER_STOCK',
    fromLocId: 'downtown',
    toLocId: 'riverside',
    itemId: 'ghost_item',
    qty: 5,
  })
  assert.equal(invalidItem, empire)

  // Zero quantity
  const zeroQty = reducer(empire, {
    type: 'TRANSFER_STOCK',
    fromLocId: 'downtown',
    toLocId: 'riverside',
    itemId: 'inv_tomato',
    qty: 0,
  })
  assert.equal(zeroQty, empire)
})
