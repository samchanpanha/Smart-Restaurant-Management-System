import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'

const act = (empire, locId, action) => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]

test('LOG_WASTE decreases inventory on-hand, appends waste movement, and records to wasteLog', () => {
  let empire = buildEmpire()
  const lettuce = shopOf(empire).inventory.find((i) => i.id === 'inv_lettuce')
  assert.ok(lettuce)
  const initialOnHand = lettuce.onHand
  const initialMovements = shopOf(empire).movements.length
  const initialWasteLogs = (shopOf(empire).wasteLog || []).length

  empire = act(empire, 'downtown', {
    type: 'LOG_WASTE',
    inventoryItemId: 'inv_lettuce',
    qty: 2,
    reason: 'spoil',
    by: 'chef',
  })

  const updatedLettuce = shopOf(empire).inventory.find((i) => i.id === 'inv_lettuce')
  assert.equal(updatedLettuce.onHand, initialOnHand - 2)

  // Movements ledger has waste entry
  const lastMovement = shopOf(empire).movements.at(-1)
  assert.equal(shopOf(empire).movements.length, initialMovements + 1)
  assert.equal(lastMovement.kind, 'waste')
  assert.equal(lastMovement.qty, -2)
  assert.equal(lastMovement.note, 'spoil')

  // wasteLog has the recorded entry
  const wasteLog = shopOf(empire).wasteLog
  assert.equal(wasteLog.length, initialWasteLogs + 1)
  const lastLog = wasteLog.at(-1)
  assert.equal(lastLog.inventoryItemId, 'inv_lettuce')
  assert.equal(lastLog.qty, 2)
  assert.equal(lastLog.reason, 'spoil')
  assert.equal(lastLog.by, 'chef')
  assert.ok(lastLog.value > 0)
})

test('LOG_WASTE caps at on-hand when allowNegativeStock is false', () => {
  let empire = buildEmpire()
  // Disable negative stock
  empire = act(empire, 'downtown', {
    type: 'UPDATE_SETTINGS',
    patch: { stock: { ...shopOf(empire).settings.stock, allowNegativeStock: false } },
  })

  const item = shopOf(empire).inventory.find((i) => i.id === 'inv_lettuce')
  const available = item.onHand

  // Attempt to waste more than available
  empire = act(empire, 'downtown', {
    type: 'LOG_WASTE',
    inventoryItemId: 'inv_lettuce',
    qty: available + 10,
    reason: 'error',
  })

  const updatedItem = shopOf(empire).inventory.find((i) => i.id === 'inv_lettuce')
  assert.equal(updatedItem.onHand, 0) // capped at 0
})
