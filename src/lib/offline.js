// ─── Offline policy ─────────────────────────────────────────────────
// What a terminal may keep doing while the link is down, and what it may
// not. The store consults these gates before an action is applied
// offline; the server (authoritative) still validates every replayed
// action, so a gate only prevents a doomed write, never a legal one.
//
// First-release restrictions: no offline catalog edits, no offline
// settings/exchange-rate changes, no offline purchase receipt, no
// offline void of a server order, no offline sale without a cached
// menu, an open cash session and a valid cached sign-in. Employee and
// role edits are API-routed (never reducer actions), so they are
// offline-blocked without appearing here.

// Money-/stock-touching actions. If one of these fails to replay
// against the server (409 / 403), it is parked for review instead of
// silently discarded — a paid check may never just disappear.
export const FINANCIAL_ACTIONS = new Set([
  'CREATE_ORDER', 'ADD_ITEM', 'UPDATE_ITEM', 'REMOVE_ITEM',
  'SEND_ORDER', 'UNDO_SEND', 'PAY_ORDER', 'VOID_ITEM', 'VOID_ORDER',
  'COMP_ITEM', 'REQUEST_BILL', 'ISSUE_DOCUMENT', 'UPSERT_CUSTOMER',
  // Guest phones order through the same provider; an offline table order
  // is money in motion just as much as a POS check.
  'GUEST_SEND',
])

// Blocked while offline in the first release. Operational inventory
// (sales, waste logging, stock counts) deliberately stays allowed — it
// is the same trust class as capturing a cash payment, and the cached
// on-hand is what the room is actually working from.
export const OFFLINE_BLOCKED = new Set([
  // Menu & catalog edits, prices and recipes
  'ADD_MENU_ITEM', 'UPDATE_MENU_ITEM', 'UPDATE_PRICE', 'UPDATE_RECIPE', 'REPLACE_MENU',
  'UPSERT_CATEGORY', 'DELETE_CATEGORY', 'REORDER_CATEGORIES',
  'REORDER_MENU_ITEMS', 'MOVE_CATEGORY_ITEMS',
  // Inventory master data (items, units, counted flags)
  'ADD_INVENTORY_ITEM', 'UPDATE_INVENTORY_ITEM', 'DELETE_INVENTORY_ITEM',
  // Settings, document templates, money & tax config (covers exchange rates)
  'UPDATE_SETTINGS', 'RESET_SETTINGS', 'UPDATE_TEMPLATE',
  'SET_BASE_CURRENCY', 'RESCALE_CATALOG',
  // Suppliers & purchasing
  'UPSERT_SUPPLIER', 'DELETE_SUPPLIER',
  'UPSERT_PURCHASE', 'SET_PURCHASE_STATUS', 'RECEIVE_PURCHASE', 'DELETE_PURCHASE',
  // Documents & the staff roster
  'VOID_DOCUMENT', 'ADD_SHIFT', 'UPDATE_SHIFT', 'DELETE_SHIFT',
])

// Empire-level provisions are never allowed offline: they reshape the
// branches every other terminal is standing in.
export const OFFLINE_EMPIRE_BLOCKED = new Set([
  'CREATE_LOCATION', 'REMOVE_LOCATION', 'TRANSFER_STOCK', 'RESET_ALL',
])

// Order-entry actions that run the full offline sale preflight.
export const SALE_GATE_ACTIONS = new Set(['CREATE_ORDER', 'PAY_ORDER'])

/**
 * Why an offline sale may not proceed on this branch, or `null`.
 * `shop` is the branch state the terminal is about to write into;
 * `session` is the cached sign-in object (null = no session known).
 *
 * The open-shift gate is opt-in per branch: it arms the first time an
 * operator opens or closes a cash session (`status` on a shift). A
 * roster that never used the feature — including every pre-existing
 * deployment — keeps offline selling unblocked.
 */
export function offlineSaleBlock(shop, { session = null } = {}) {
  if (!Array.isArray(shop?.menu) || shop.menu.length === 0) return 'noMenu'
  if (session && session.valid === false) return 'sessionStale'
  const shifts = Array.isArray(shop?.shifts) ? shop.shifts : []
  const adopted = shifts.some((s) => s?.status != null)
  if (adopted && !shifts.some((s) => s?.status === 'open')) return 'noShift'
  return null
}

/**
 * Why an offline `PAY_ORDER` may not proceed, or `null`. The device
 * cannot reach a payment gateway and must not paper over it: cash only.
 */
export function offlinePayBlock(action) {
  const methods = Array.isArray(action?.payments) && action.payments.length
    ? action.payments.map((p) => String(p?.method || '').toLowerCase())
    : [String(action?.method || 'card').toLowerCase()]
  return methods.every((m) => m === 'cash') ? null : 'cashOnly'
}

/**
 * Why an offline void/refund may not proceed, or `null`. `localOrderIds`
 * is the set of order ids this terminal created while offline (from the
 * outbox). A cached server order stays readable but is never refunded
 * from a terminal with no connection.
 */
export function offlineVoidBlock(action, localOrderIds) {
  if (action?.type === 'VOID_ITEM') return null // pre-payment edit; the reducer guards transitions
  const orderId = action?.orderId
  return orderId && localOrderIds.has(orderId) ? null : 'voidServerOrder'
}
