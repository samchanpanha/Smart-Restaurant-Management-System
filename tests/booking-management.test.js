// ─── Guest booking management ─────────────────────────────────────
// The Book tab can reschedule and cancel the booking it created. The
// reducer is the guard rail: policy, cutoff, and modification limits are
// enforced there even if a stale tab tries to replay the change.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeed, reducer } from '../src/lib/reducer.js'
import { findAvailableTablesForSlot } from '../src/lib/models.js'

function localDate(daysAhead) {
  const date = new Date()
  date.setDate(date.getDate() + daysAhead)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function withBooking(overrides = {}) {
  const shop = buildSeed()
  const time = new Date(`${localDate(3)}T18:00:00`).toISOString()
  const reservation = {
    id: 'res_guest_test',
    name: 'Sokha Chan',
    phone: '012345678',
    partySize: 2,
    time,
    tableId: 't01',
    status: 'booked',
    source: 'online',
    guestToken: 'sess_guest_1',
    modificationCount: 0,
    ...overrides,
  }
  return {
    shop: reducer(shop, { type: 'ADD_RESERVATION', reservation }),
    reservation,
  }
}

test('a guest can move a booking inside the policy window', () => {
  const { shop } = withBooking()
  const next = reducer(shop, {
    type: 'RESCHEDULE_BOOKING',
    payload: {
      bookingId: 'res_guest_test',
      newDate: localDate(4),
      newTime: '19:00',
      actor: 'guest',
    },
  })
  const booking = next.reservations.find((entry) => entry.id === 'res_guest_test')

  assert.equal(booking.modificationCount, 1)
  assert.equal(booking.guestToken, 'sess_guest_1')
  assert.ok(booking.tableId, 'the new slot gets a table')
  assert.ok(booking.previousSlot, 'the old slot is kept for the audit trail')
  assert.equal(new Date(booking.time).getHours(), 19)
})

test('the modification limit blocks a third self-service change', () => {
  const { shop } = withBooking({ modificationCount: 2 })

  assert.throws(
    () => reducer(shop, {
      type: 'RESCHEDULE_BOOKING',
      payload: {
        bookingId: 'res_guest_test',
        newDate: localDate(4),
        newTime: '19:00',
        actor: 'guest',
      },
    }),
    /Maximum self-service reschedule limit/,
  )
})

test('the cutoff blocks a change inside the protected window', () => {
  const soon = new Date(Date.now() + 20 * 60 * 1000).toISOString()
  const { shop } = withBooking({ time: soon })

  assert.throws(
    () => reducer(shop, {
      type: 'RESCHEDULE_BOOKING',
      payload: {
        bookingId: 'res_guest_test',
        newDate: localDate(4),
        newTime: '19:00',
        actor: 'guest',
      },
    }),
    /cannot be made within|Modifications cannot be made within/,
  )
})

test('a restaurant can turn self-service changes off', () => {
  const { shop, reservation } = withBooking()
  const disabled = reducer(shop, {
    type: 'UPDATE_SETTINGS',
    patch: { booking: { ...shop.settings.booking, allowGuestReschedule: false } },
  })

  assert.equal(disabled.settings.booking.allowGuestReschedule, false)
  assert.throws(
    () => reducer(disabled, {
      type: 'RESCHEDULE_BOOKING',
      payload: {
        bookingId: reservation.id,
        newDate: localDate(4),
        newTime: '19:00',
        actor: 'guest',
      },
    }),
    /Guest rescheduling is disabled/,
  )
})

test('a cancellation keeps the record and releases the slot', () => {
  const { shop } = withBooking()
  const next = reducer(shop, {
    type: 'SET_RESERVATION',
    id: 'res_guest_test',
    patch: {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: 'guest',
    },
  })
  const booking = next.reservations.find((entry) => entry.id === 'res_guest_test')

  assert.equal(booking.status, 'cancelled')
  assert.equal(next.reservations.length, shop.reservations.length, 'history is not deleted')

  // The cancelled booking no longer occupies the slot.
  const available = findAvailableTablesForSlot(next, {
    time: booking.time,
    partySize: 2,
    durationMinutes: 90,
  })
  assert.ok(available.length > 0)
})

test('waitlist entries add and remove without touching reservations', () => {
  const shop = buildSeed()
  const added = reducer(shop, {
    type: 'ADD_WAITLIST',
    entry: { id: 'wl_guest_1', name: 'Sokha', phone: '012345678', partySize: 2, guestToken: 'sess_guest_1' },
  })
  assert.equal(added.waitlist.length, shop.waitlist.length + 1)
  assert.equal(added.reservations.length, shop.reservations.length)

  const removed = reducer(added, { type: 'REMOVE_WAITLIST', id: 'wl_guest_1' })
  assert.ok(!removed.waitlist.some((entry) => entry.id === 'wl_guest_1'))
})
