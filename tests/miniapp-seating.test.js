// ─── Self-Seating & Safe Table Release Unit & Integration Tests ─────────
// Covers:
//  - MINIAPP_CLAIM_TABLE (concurrency guards, session tokens, party size)
//  - MINIAPP_RELEASE_TABLE (financial guardrails: unpaid -> billing, paid -> cleaning, zero-order -> available)
//  - FLOOR_MARK_TABLE_AVAILABLE (staff reset)
//  - Ownership guards & staff force-release overrides
//  - Database helper functions getState & saveState

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeed, reducer } from '../src/lib/reducer.js'
import { getState, saveState } from '../server/db.js'

function freshDowntown() {
  return buildSeed()
}

test('MINIAPP_CLAIM_TABLE: successfully claims an available/free table', () => {
  const shop = freshDowntown()
  const freeTable = shop.tables.find((t) => t.status === 'free')
  assert.ok(freeTable, 'should have a free table in seed')

  const sessionToken = 'sess_guest_abc123'
  const action = {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: {
      tableId: freeTable.id,
      guestName: 'Sokha Chan',
      partySize: 3,
      guestPhone: '012345678',
      sessionToken,
    },
  }

  const next = reducer(shop, action)
  const claimed = next.tables.find((t) => t.id === freeTable.id)

  assert.equal(claimed.status, 'occupied')
  assert.equal(claimed.guestName, 'Sokha Chan')
  assert.equal(claimed.partySize, 3)
  assert.equal(claimed.sessionToken, sessionToken)
  assert.equal(claimed.selfSeated, true)
  assert.ok(claimed.seatedAt)

  const mov = (next.movements || []).find((m) => m.type === 'TABLE_SELF_SEATED')
  assert.ok(mov, 'should record TABLE_SELF_SEATED movement event')
  assert.equal(mov.tableId, freeTable.id)
})

test('MINIAPP_CLAIM_TABLE: concurrency guard rejects claiming occupied or seated tables', () => {
  const shop = freshDowntown()
  const occupiedTable = shop.tables.find((t) => t.status === 'seated' || t.status === 'ordered')
  assert.ok(occupiedTable, 'should have a seated/ordered table in seed')

  const action = {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: {
      tableId: occupiedTable.id,
      guestName: 'Late Guest',
      partySize: 2,
      sessionToken: 'sess_intruder',
    },
  }

  const next = reducer(shop, action)
  // State must remain unchanged
  assert.equal(next, shop, 'concurrency guard must reject claiming occupied table')
})

test('MINIAPP_RELEASE_TABLE: unpaid items trigger financial guard -> table transitions to billing', () => {
  const shop = freshDowntown()
  const table = shop.tables.find((t) => t.status === 'free')
  const sessionToken = 'sess_diner_999'

  // Step 1: Claim table
  const seatedShop = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: {
      tableId: table.id,
      guestName: 'Vanna',
      partySize: 2,
      sessionToken,
    },
  })

  // Step 2: Add an active open order with items
  const orderWithItems = {
    id: 'ord_test_unpaid_1',
    tableId: table.id,
    status: 'in_prep',
    items: [
      { id: 'item_1', menuItemId: 'm_burger', qty: 2, price: 16 },
    ],
  }
  const orderedShop = {
    ...seatedShop,
    orders: [...(seatedShop.orders || []), orderWithItems],
  }

  // Step 3: Guest attempts to release table without paying
  const releaseAction = {
    type: 'MINIAPP_RELEASE_TABLE',
    payload: {
      tableId: table.id,
      sessionToken,
    },
  }

  const billingShop = reducer(orderedShop, releaseAction)
  const billingTable = billingShop.tables.find((t) => t.id === table.id)

  assert.equal(billingTable.status, 'billing', 'table must enter billing status when tickets are unpaid')
  assert.ok(billingTable.releaseRequestedAt, 'releaseRequestedAt timestamp must be recorded')

  const billMovement = (billingShop.movements || []).find((m) => m.type === 'TABLE_BILL_REQUESTED')
  assert.ok(billMovement, 'movement log must record TABLE_BILL_REQUESTED')
})

test('MINIAPP_RELEASE_TABLE: paid order transitions table to cleaning for staff bussing', () => {
  const shop = freshDowntown()
  const table = shop.tables.find((t) => t.status === 'free')
  const sessionToken = 'sess_happy_diner'

  // Claim table
  const seatedShop = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: {
      tableId: table.id,
      guestName: 'Dara',
      partySize: 4,
      sessionToken,
    },
  })

  // Add a paid order
  const paidOrder = {
    id: 'ord_test_paid_1',
    tableId: table.id,
    status: 'paid',
    paidAt: new Date().toISOString(),
    items: [{ id: 'item_1', menuItemId: 'm_steak', qty: 1 }],
  }
  const withPaid = {
    ...seatedShop,
    orders: [...(seatedShop.orders || []), paidOrder],
  }

  const releaseAction = {
    type: 'MINIAPP_RELEASE_TABLE',
    payload: {
      tableId: table.id,
      sessionToken,
    },
  }

  const cleanedShop = reducer(withPaid, releaseAction)
  const target = cleanedShop.tables.find((t) => t.id === table.id)

  assert.equal(target.status, 'cleaning', 'paid table transitions to cleaning')
  assert.equal(target.sessionToken, null, 'session token is cleared')
  assert.equal(target.guestName, null, 'guest name is cleared')

  const relMovement = (cleanedShop.movements || []).find((m) => m.type === 'TABLE_RELEASED')
  assert.ok(relMovement && relMovement.detail.includes('cleaning'))
})

test('MINIAPP_RELEASE_TABLE: zero-order walkout immediately frees table to available', () => {
  const shop = freshDowntown()
  const table = shop.tables.find((t) => t.status === 'free')
  const sessionToken = 'sess_no_order'

  // Claim table
  const seatedShop = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: {
      tableId: table.id,
      guestName: 'Window Shopper',
      partySize: 1,
      sessionToken,
    },
  })

  const releaseAction = {
    type: 'MINIAPP_RELEASE_TABLE',
    payload: {
      tableId: table.id,
      sessionToken,
    },
  }

  const freedShop = reducer(seatedShop, releaseAction)
  const target = freedShop.tables.find((t) => t.id === table.id)

  assert.equal(target.status, 'available', 'no-order session frees immediately to available')
  assert.equal(target.sessionToken, null)
  assert.equal(target.selfSeated, false)
})

test('MINIAPP_RELEASE_TABLE: ownership guard blocks unauthorized sessionToken', () => {
  const shop = freshDowntown()
  const table = shop.tables.find((t) => t.status === 'free')
  const ownerToken = 'sess_real_owner'

  const seatedShop = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: {
      tableId: table.id,
      guestName: 'Real Guest',
      partySize: 2,
      sessionToken: ownerToken,
    },
  })

  // Another session tries to release
  const hackerAction = {
    type: 'MINIAPP_RELEASE_TABLE',
    payload: {
      tableId: table.id,
      sessionToken: 'sess_intruder_token',
    },
  }

  const unchanged = reducer(seatedShop, hackerAction)
  assert.equal(unchanged, seatedShop, 'ownership guard must reject release from another session')
})

test('MINIAPP_RELEASE_TABLE: staff force-release overrides token and unpaid tickets', () => {
  const shop = freshDowntown()
  const table = shop.tables.find((t) => t.status === 'free')

  const seatedShop = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: {
      tableId: table.id,
      guestName: 'Stuck Guest',
      partySize: 2,
      sessionToken: 'sess_stuck',
    },
  })

  const forceAction = {
    type: 'MINIAPP_RELEASE_TABLE',
    payload: {
      tableId: table.id,
      sessionToken: null,
      forceByStaff: true,
    },
  }

  const freed = reducer(seatedShop, forceAction)
  const target = freed.tables.find((t) => t.id === table.id)
  assert.equal(target.status, 'available')
  assert.equal(target.sessionToken, null)
})

test('FLOOR_MARK_TABLE_AVAILABLE: staff resets cleaning table back to available', () => {
  const shop = freshDowntown()
  const table = shop.tables.find((t) => t.status === 'free')

  // Set table into cleaning status
  const cleaningShop = {
    ...shop,
    tables: shop.tables.map((t) => (t.id === table.id ? { ...t, status: 'cleaning', selfSeated: true } : t)),
  }

  const next = reducer(cleaningShop, {
    type: 'FLOOR_MARK_TABLE_AVAILABLE',
    payload: { tableId: table.id },
  })

  const target = next.tables.find((t) => t.id === table.id)
  assert.equal(target.status, 'available')
  assert.equal(target.selfSeated, false)
})

test('database helper getState and saveState work as expected', async () => {
  const seed = buildSeed()
  await saveState('test_tenant', seed)
  const state = await getState('test_tenant')
  assert.ok(state, 'should retrieve saved tenant state')
  assert.ok(Array.isArray(state.tables), 'state has tables array')
  assert.equal(state.tables.length, seed.tables.length)
})
