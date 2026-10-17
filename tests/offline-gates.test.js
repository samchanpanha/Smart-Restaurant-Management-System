// ─── Offline policy gates ───────────────────────────────────────────
// The pure policy module + the reducer surfaces the offline release
// needs: blocked action types, the offline sale preflight, cash-only
// payments, the void/refund rule, open cash-session shifts and the
// local customer directory.

import assert from 'node:assert/strict'
import test from 'node:test'

const {
  FINANCIAL_ACTIONS, OFFLINE_BLOCKED, OFFLINE_EMPIRE_BLOCKED,
  offlineSaleBlock, offlinePayBlock, offlineVoidBlock,
} = await import('../src/lib/offline.js')
const { buildEmpire, migrateToEmpire, reducer } = await import('../src/lib/reducer.js')

const SHOP = 'downtown'
const apply = (empire, action) => reducer(empire, { type: 'LOC', locId: SHOP, action })
const shopOf = (empire) => empire.locations[SHOP]
const withMenu = (empire) => (shopOf(empire).menu.length ? empire : apply(empire, {
  type: 'ADD_MENU_ITEM',
  item: { id: 'dish-1', name: 'Amok', price: 6, station: 'grill' },
}))

test('first-release restrictions name real reducer actions', () => {
  for (const type of [
    'ADD_MENU_ITEM', 'UPDATE_MENU_ITEM', 'UPDATE_PRICE', 'UPDATE_RECIPE', 'REPLACE_MENU',
    'UPSERT_CATEGORY', 'DELETE_CATEGORY', 'REORDER_CATEGORIES', 'REORDER_MENU_ITEMS',
    'MOVE_CATEGORY_ITEMS', 'ADD_INVENTORY_ITEM', 'UPDATE_INVENTORY_ITEM', 'DELETE_INVENTORY_ITEM',
    'UPDATE_SETTINGS', 'RESET_SETTINGS', 'UPDATE_TEMPLATE', 'SET_BASE_CURRENCY', 'RESCALE_CATALOG',
    'UPSERT_SUPPLIER', 'DELETE_SUPPLIER',
    'UPSERT_PURCHASE', 'SET_PURCHASE_STATUS', 'RECEIVE_PURCHASE', 'DELETE_PURCHASE',
    'VOID_DOCUMENT', 'ADD_SHIFT', 'UPDATE_SHIFT', 'DELETE_SHIFT',
  ]) {
    assert.ok(OFFLINE_BLOCKED.has(type), `${type} must be blocked offline`)
  }
  // Money flows stay open; empire provisions never run offline.
  assert.equal(OFFLINE_BLOCKED.has('PAY_ORDER'), false)
  assert.equal(OFFLINE_BLOCKED.has('CREATE_ORDER'), false)
  for (const type of ['CREATE_LOCATION', 'REMOVE_LOCATION', 'TRANSFER_STOCK', 'RESET_ALL']) {
    assert.ok(OFFLINE_EMPIRE_BLOCKED.has(type))
  }
  for (const type of ['CREATE_ORDER', 'PAY_ORDER', 'VOID_ORDER', 'ISSUE_DOCUMENT', 'UPSERT_CUSTOMER']) {
    assert.ok(FINANCIAL_ACTIONS.has(type), `${type} is money in motion`)
  }
})

test('offline sale preflight: menu, session, and the opt-in shift gate', () => {
  const empire = withMenu(migrateToEmpire(buildEmpire()))
  const shop = shopOf(empire)
  assert.equal(shop.menu.length > 0, true, 'seed has a cached menu')

  // No cached menu → no offline selling.
  assert.equal(offlineSaleBlock({ ...shop, menu: [] }), 'noMenu')
  // Menu present, roster may even have legacy rows — without an explicit
  // cash-session marker the branch never adopted the gate.
  assert.ok(shop.shifts.length > 0, 'seed carries legacy roster rows')
  assert.equal(shop.shifts.some((s) => s.status != null), false, 'legacy rows carry no marker')
  assert.equal(offlineSaleBlock(shop), null)
  assert.equal(offlineSaleBlock({ ...shop, shifts: [{ id: 'l1' }, { id: 'l2' }] }), null)
  // Open cash session → selling allowed.
  assert.equal(offlineSaleBlock({ ...shop, shifts: [{ id: 's1', status: 'open' }] }), null)
  // Adopted (marker present) but nothing open → the drawer is closed.
  assert.equal(offlineSaleBlock({ ...shop, shifts: [{ id: 'l1' }, { id: 's1', status: 'closed' }] }), 'noShift')
  // Expired sign-in blocks even the best-stocked drawer.
  assert.equal(offlineSaleBlock({ ...shop, shifts: [] }, { session: { valid: false } }), 'sessionStale')
  assert.equal(offlineSaleBlock({ ...shop, shifts: [] }, { session: { valid: true } }), null)
  assert.equal(offlineSaleBlock({ ...shop, shifts: [] }, { session: null }), null)
})

test('offline payments are cash-only (all tenders)', () => {
  assert.equal(offlinePayBlock({ type: 'PAY_ORDER', method: 'cash' }), null)
  assert.equal(offlinePayBlock({ type: 'PAY_ORDER', method: 'card' }), 'cashOnly')
  assert.equal(offlinePayBlock({ type: 'PAY_ORDER', method: 'qr' }), 'cashOnly')
  assert.equal(offlinePayBlock({ type: 'PAY_ORDER' }), 'cashOnly', 'absent method defaults to card')
  assert.equal(offlinePayBlock({ type: 'PAY_ORDER', payments: [{ method: 'cash' }, { method: 'cash' }] }), null)
  assert.equal(offlinePayBlock({ type: 'PAY_ORDER', payments: [{ method: 'cash' }, { method: 'card' }] }), 'cashOnly')
})

test('offline void/refund: only orders this terminal created offline', () => {
  const localIds = new Set(['o-offline'])
  assert.equal(offlineVoidBlock({ type: 'VOID_ORDER', orderId: 'o-offline' }, localIds), null)
  assert.equal(offlineVoidBlock({ type: 'VOID_ORDER', orderId: 'o-from-server' }, localIds), 'voidServerOrder')
  assert.equal(offlineVoidBlock({ type: 'VOID_ORDER' }, localIds), 'voidServerOrder')
  assert.equal(offlineVoidBlock({ type: 'VOID_ITEM', orderId: 'o-from-server' }, localIds), null)
})

test('shift state: only explicit markers survive normalize; open/close works', () => {
  const empire = migrateToEmpire(buildEmpire())
  const patchLegacy = (shop) => ({ ...shop, shifts: [{ id: 'legacy', date: '2026-10-16', status: 'weird' }] })
  const legacy = {
    ...empire,
    locations: { ...empire.locations, [SHOP]: patchLegacy(shopOf(empire)) },
  }
  // A garbage marker is dropped, not coerced: the row then reads as a
  // plain legacy roster entry (no adoption).
  const normalized = migrateToEmpire(legacy).locations[SHOP].shifts[0]
  assert.equal(normalized.status, undefined)

  let next = apply(empire, {
    type: 'ADD_SHIFT',
    shift: { id: 'shf-1', staffName: 'Jordan', date: '2026-10-17', status: 'open' },
  })
  assert.equal(shopOf(next).shifts.at(-1).status, 'open')
  assert.equal(offlineSaleBlock(shopOf(withMenu(next))), null, 'an open session allows offline selling')

  // Close it and the opt-in gate arms shut: branch adopted, nothing open.
  next = apply(next, { type: 'UPDATE_SHIFT', shiftId: 'shf-1', patch: { status: 'closed' } })
  assert.equal(shopOf(next).shifts.at(-1).status, 'closed')
  assert.equal(offlineSaleBlock(shopOf(withMenu(next))), 'noShift')
})

test('local customer directory: create, link, update', () => {
  const empire = migrateToEmpire(buildEmpire())
  assert.deepEqual(shopOf(empire).customers, [])

  let next = apply(empire, {
    type: 'UPSERT_CUSTOMER',
    customer: { id: 'cus-1', name: 'Ava Chen', phone: '012 345 678' },
  })
  const created = shopOf(next).customers.find((c) => c.id === 'cus-1')
  assert.equal(created.name, 'Ava Chen')
  assert.equal(created.phone, '012 345 678')

  // The order's customer block carries the link back to the directory.
  next = apply(next, {
    type: 'CREATE_ORDER',
    id: 'o-1',
    orderType: 'takeout',
    customer: { name: 'Ava Chen', phone: '012 345 678', customerId: 'cus-1' },
  })
  const order = shopOf(next).orders.find((o) => o.id === 'o-1')
  assert.equal(order.customer.customerId, 'cus-1')
  assert.ok(shopOf(next).orders.find((o) => o.id === 'o-1').customer.name)

  // A second UPSERT with the same id edits in place — never duplicates.
  next = apply(next, {
    type: 'UPSERT_CUSTOMER',
    customer: { id: 'cus-1', name: 'Ava C.', phone: '012 345 678' },
  })
  const list = shopOf(next).customers
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'Ava C.')
})
