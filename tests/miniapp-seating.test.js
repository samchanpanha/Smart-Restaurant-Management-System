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
import { findAvailableTablesForSlot, findNearestAvailableSlots, isTableAvailable } from '../src/lib/models.js'

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

// ─── Pre-Arrival Rescheduling & Availability Tests ─────────────────────

test('isTableAvailable & findAvailableTablesForSlot: detect booking slot overlaps and capacity', () => {
  const shop = freshDowntown()
  const table = shop.tables[0]
  const futureTime = new Date(Date.now() + 4 * 3600 * 1000).toISOString()

  // Initially available
  assert.equal(isTableAvailable(shop, { tableId: table.id, time: futureTime }), true)

  // Add an overlapping reservation on this table at the same time
  const shopWithRes = {
    ...shop,
    reservations: [
      ...(shop.reservations || []),
      { id: 'res_test_1', tableId: table.id, time: futureTime, status: 'booked', partySize: 2 },
    ],
  }

  // Now blocked on that table
  assert.equal(isTableAvailable(shopWithRes, { tableId: table.id, time: futureTime }), false)

  // But excluded booking ID can check its own table
  assert.equal(
    isTableAvailable(shopWithRes, { tableId: table.id, time: futureTime, excludeBookingId: 'res_test_1' }),
    true,
  )

  // findAvailableTablesForSlot returns only tables fitting party size and not in conflict
  const available = findAvailableTablesForSlot(shopWithRes, { time: futureTime, partySize: 2 })
  assert.ok(!available.some((t) => t.id === table.id), 'conflicting table must not be in available list')
})

test('findNearestAvailableSlots: returns closest alternative slots when requested slot is booked', () => {
  const shop = freshDowntown()
  const reqTime = new Date(Date.now() + 5 * 3600 * 1000).toISOString()
  const suggestions = findNearestAvailableSlots(shop, { requestedTime: reqTime, partySize: 2, maxSlots: 3 })
  assert.ok(Array.isArray(suggestions))
  assert.ok(suggestions.length > 0 && suggestions.length <= 3)
  assert.ok(suggestions[0].offsetMinutes !== 0)
  assert.ok(suggestions[0].availableTablesCount > 0)
})

test('RESCHEDULE_BOOKING: updates date/time and preserves previousSlot audit', () => {
  const shop = freshDowntown()
  const futureTime1 = new Date(Date.now() + 3 * 3600 * 1000).toISOString()
  const futureTime2 = new Date(Date.now() + 6 * 3600 * 1000).toISOString()

  const booking = {
    id: 'res_test_reschedule',
    name: 'Vannak Party',
    partySize: 2,
    time: futureTime1,
    tableId: 't01',
    status: 'booked',
    modificationCount: 0,
  }
  const stateWithRes = {
    ...shop,
    reservations: [...shop.reservations, booking],
  }

  const action = {
    type: 'RESCHEDULE_BOOKING',
    payload: {
      bookingId: 'res_test_reschedule',
      newTime: futureTime2,
      newPartySize: 3,
      actor: 'guest',
    },
  }

  const next = reducer(stateWithRes, action)
  const updated = next.reservations.find((r) => r.id === 'res_test_reschedule')

  assert.equal(updated.time, futureTime2)
  assert.equal(updated.partySize, 3)
  assert.equal(updated.modificationCount, 1)
  assert.equal(updated.previousSlot.time, futureTime1)
  assert.equal(updated.previousSlot.partySize, 2)
})

test('RESCHEDULE_BOOKING: auto-reassigns table when preferred table has a conflict', () => {
  const shop = freshDowntown()
  const futureTime1 = new Date(Date.now() + 3 * 3600 * 1000).toISOString()
  const futureTime2 = new Date(Date.now() + 6 * 3600 * 1000).toISOString()

  // Booking A is at t01 at futureTime2
  const bookingA = {
    id: 'res_A',
    name: 'Party A',
    partySize: 2,
    time: futureTime2,
    tableId: 't01',
    status: 'booked',
  }
  // Booking B wants to move to futureTime2 and currently has t01
  const bookingB = {
    id: 'res_B',
    name: 'Party B',
    partySize: 2,
    time: futureTime1,
    tableId: 't01',
    status: 'booked',
  }
  const stateWithBookings = {
    ...shop,
    reservations: [...shop.reservations, bookingA, bookingB],
  }

  const action = {
    type: 'RESCHEDULE_BOOKING',
    payload: {
      bookingId: 'res_B',
      newTime: futureTime2,
      actor: 'guest',
    },
  }

  const next = reducer(stateWithBookings, action)
  const updatedB = next.reservations.find((r) => r.id === 'res_B')

  assert.equal(updatedB.time, futureTime2)
  assert.notEqual(updatedB.tableId, 't01', 'auto-reassign must pick an alternative available table')
  assert.ok(updatedB.tableId, 'should have assigned an available table')
})

test('RESCHEDULE_BOOKING: enforces cutoff window and modification limit for guests', () => {
  const shop = freshDowntown()
  // 1. Cutoff: 20 minutes from now (cutoff is 60 min)
  const soonTime = new Date(Date.now() + 20 * 60 * 1000).toISOString()
  const bookingSoon = {
    id: 'res_soon',
    name: 'Late Rescheduler',
    partySize: 2,
    time: soonTime,
    tableId: 't01',
    status: 'booked',
    modificationCount: 0,
  }
  const stateSoon = { ...shop, reservations: [...shop.reservations, bookingSoon] }

  assert.throws(() => {
    reducer(stateSoon, {
      type: 'RESCHEDULE_BOOKING',
      payload: { bookingId: 'res_soon', newTime: new Date(Date.now() + 4 * 3600000).toISOString(), actor: 'guest' },
    })
  }, /Modifications cannot be made within/)

  // 2. Limit: already rescheduled 2 times (max is 2)
  const farTime = new Date(Date.now() + 5 * 3600 * 1000).toISOString()
  const bookingCapped = {
    id: 'res_capped',
    name: 'Frequent Changer',
    partySize: 2,
    time: farTime,
    tableId: 't01',
    status: 'booked',
    modificationCount: 2,
  }
  const stateCapped = { ...shop, reservations: [...shop.reservations, bookingCapped] }

  assert.throws(() => {
    reducer(stateCapped, {
      type: 'RESCHEDULE_BOOKING',
      payload: { bookingId: 'res_capped', newTime: new Date(Date.now() + 6 * 3600000).toISOString(), actor: 'guest' },
    })
  }, /Maximum self-service reschedule limit/)
})

// ─── Active Dining Table Transfers Tests ───────────────────────────────

test('REQUEST_TABLE_TRANSFER and REJECT_TABLE_TRANSFER: guest requests move and staff can reject', () => {
  const shop = freshDowntown()
  const table1 = shop.tables[0]
  const table2 = shop.tables[1]
  const sessionToken = 'sess_transfer_diner'

  const seatedShop = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: { tableId: table1.id, guestName: 'Dara', partySize: 2, sessionToken },
  })

  // Guest requests move
  const reqAction = {
    type: 'REQUEST_TABLE_TRANSFER',
    payload: {
      currentTableId: table1.id,
      targetTableId: table2.id,
      reason: 'Prefers window seat',
      sessionToken,
    },
  }
  const requestedShop = reducer(seatedShop, reqAction)
  const target1 = requestedShop.tables.find((t) => t.id === table1.id)
  assert.ok(target1.pendingTransfer, 'should have pendingTransfer on table')
  assert.equal(target1.pendingTransfer.targetTableId, table2.id)
  assert.equal(target1.pendingTransfer.status, 'pending')

  // Staff rejects
  const rejectedShop = reducer(requestedShop, {
    type: 'REJECT_TABLE_TRANSFER',
    payload: { currentTableId: table1.id, reason: 'Window table reserved' },
  })
  const cleared1 = rejectedShop.tables.find((t) => t.id === table1.id)
  assert.equal(cleared1.pendingTransfer, null, 'pendingTransfer must be cleared upon rejection')
})

test('APPROVE_TABLE_TRANSFER: atomically moves seated guest, orders, and active kitchen items', () => {
  const shop = freshDowntown()
  const tSource = shop.tables.find((t) => t.status === 'free')
  const tTarget = shop.tables.find((t) => t.id !== tSource.id && t.status === 'free')
  const sessionToken = 'sess_move_me'

  // Claim source table
  const seatedShop = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: { tableId: tSource.id, guestName: 'Sophea', partySize: 4, sessionToken },
  })

  // Add an active order with fired items
  const activeOrder = {
    id: 'ord_move_test_1',
    tableId: tSource.id,
    status: 'in_prep',
    items: [
      { id: 'item_m1', menuItemId: 'm_burger', qty: 2, status: 'fired' },
      { id: 'item_m2', menuItemId: 'm_salad', qty: 1, status: 'fired' },
    ],
  }
  const orderedShop = {
    ...seatedShop,
    orders: [...(seatedShop.orders || []), activeOrder],
  }

  // Execute transfer to target table
  const transferAction = {
    type: 'APPROVE_TABLE_TRANSFER',
    payload: {
      currentTableId: tSource.id,
      targetTableId: tTarget.id,
      reason: 'Moved by host',
      actor: 'staff',
    },
  }

  const transferredShop = reducer(orderedShop, transferAction)

  const updatedSource = transferredShop.tables.find((t) => t.id === tSource.id)
  const updatedTarget = transferredShop.tables.find((t) => t.id === tTarget.id)
  const updatedOrder = transferredShop.orders.find((o) => o.id === 'ord_move_test_1')

  // Source table must be set to cleaning (because food was fired)
  assert.equal(updatedSource.status, 'cleaning', 'source table must transition to cleaning')
  assert.equal(updatedSource.sessionToken, null)
  assert.equal(updatedSource.guestName, null)

  // Target table must now be occupied with guest session
  assert.equal(updatedTarget.status, 'occupied')
  assert.equal(updatedTarget.guestName, 'Sophea')
  assert.equal(updatedTarget.partySize, 4)
  assert.equal(updatedTarget.sessionToken, sessionToken)
  assert.equal(updatedTarget.transferredFromTableId, tSource.id)
  assert.ok(updatedTarget.transferredAt)

  // Order must be rebound to target table with transferredFromTableId badge
  assert.equal(updatedOrder.tableId, tTarget.id)
  assert.equal(updatedOrder.transferredFromTableId, tSource.id)
  assert.ok(updatedOrder.transferredAt)

  // Order items must also carry transferredFromTableId
  assert.equal(updatedOrder.items[0].transferredFromTableId, tSource.id)
  assert.equal(updatedOrder.items[1].transferredFromTableId, tSource.id)

  const mov = (transferredShop.movements || []).find((m) => m.type === 'TABLE_TRANSFERRED')
  assert.ok(mov, 'should record TABLE_TRANSFERRED movement event')
})


// Regression: a table the mini app self-seats (or a staff transfer) lands in
// 'occupied', and GUEST_SEND used to no-op there — the order never reached
// the Orders page or the kitchen board. The guest order must fire and the
// table must flip to 'ordered' so both surfaces show it.
test('GUEST_SEND from an occupied (mini-app seated) table fires and shows on Orders', () => {
  const shop = freshDowntown()
  const freeTable = shop.tables.find((t) => t.status === 'free')
  const claimed = reducer(shop, {
    type: 'MINIAPP_CLAIM_TABLE',
    payload: { tableId: freeTable.id, guestName: 'Sokha', partySize: 3, sessionToken: 'sess' },
  })
  assert.equal(claimed.tables.find((t) => t.id === freeTable.id).status, 'occupied')

  const menuItem = claimed.menu.find((m) => m.available && m.active !== false)
  const fired = reducer(claimed, {
    type: 'GUEST_SEND',
    tableId: freeTable.id,
    items: [{ menuItemId: menuItem.id, qty: 2 }],
  })

  const order = fired.orders.find((o) => o.tableId === freeTable.id)
  assert.ok(order, 'guest order created')
  assert.equal(order.status, 'sent')
  assert.equal(order.items.length, 1)
  assert.equal(order.items[0].status, 'fired')
  assert.ok(order.items[0].firedAt, 'line is fired for the kitchen')
  assert.equal(order.items[0].station, menuItem.station, 'line carries its station')
  assert.ok(order.sentAt)

  const table = fired.tables.find((t) => t.id === freeTable.id)
  assert.equal(table.status, 'ordered')
  assert.equal(table.currentCheckId, order.id)

  // The Orders page "Active" tab matches exactly these statuses.
  assert.ok(['open', 'sent', 'in_prep'].includes(order.status), 'ticket is on the Active tab')
})
