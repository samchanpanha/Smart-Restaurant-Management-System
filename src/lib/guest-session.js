// ─── Guest session identity ───────────────────────────────────────
// The QR page and the Telegram mini app share one anonymous guest id.
// It powers table claims and lets an off-table order be found again
// after a reload without exposing any other guest's tickets.

export const GUEST_SESSION_KEY = 'restora_miniapp_session_v1'
export const GUEST_ORDER_KEY = 'restora_guest_order_v1'

export function guestSessionToken() {
  try {
    const existing = localStorage.getItem(GUEST_SESSION_KEY)
    if (existing) return existing
    const created = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(GUEST_SESSION_KEY, created)
    return created
  } catch {
    return `sess_${Date.now().toString(36)}`
  }
}

/** The last off-table order this browser placed, keyed by order type. */
export function loadGuestOrder() {
  try {
    const raw = localStorage.getItem(GUEST_ORDER_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function saveGuestOrder(entry) {
  try {
    if (!entry || !entry.orderId) localStorage.removeItem(GUEST_ORDER_KEY)
    else localStorage.setItem(GUEST_ORDER_KEY, JSON.stringify(entry))
  } catch {
    // Private mode: the in-memory id still carries the current visit.
  }
}
