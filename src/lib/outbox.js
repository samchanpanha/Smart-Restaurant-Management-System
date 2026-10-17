// ─── The offline outbox ─────────────────────────────────────────────
// Queued-action replay for terminals that kept working while the link
// was down. Entries persist to localStorage, so neither a crash nor a
// refresh loses a sale: the queue empties only when the server has
// committed an action (confirmed by seq), and server-side `_lid`
// idempotency makes replaying after a half-flush a harmless no-op.
//
// Mirrors are module-scoped, matching the tab's own writes; two tabs of
// the same terminal share localStorage but each flushes with its own
// client id, and a committed `_lid` is deduped no matter which tab
// replays it.

const OUTBOX_KEY = 'restora-outbox-v1'
const CONFLICT_KEY = 'restora-conflicts-v1'
const SEEN_SERVER_KEY = 'restora-server-seen'
const MAX_OUTBOX = 500
const MAX_CONFLICTS = 50

function readList(key) {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* storage full/blocked — the queue stays in memory for this tab */
  }
}

let queue = null // lazily hydrated in-memory mirror

function hydrate() {
  if (!queue) queue = readList(OUTBOX_KEY)
  return queue
}

function persist() {
  writeList(OUTBOX_KEY, queue)
}

/** Ordered snapshot of every queued action (oldest first). */
export function readOutbox() {
  return [...hydrate()]
}

/** Append one tagged action. Oldest entries drop past the cap. */
export function enqueue(entry) {
  const q = hydrate()
  if (entry && entry._lid && entry.locId && entry.action) {
    q.push({ at: new Date().toISOString(), ...entry })
    if (q.length > MAX_OUTBOX) q.splice(0, q.length - MAX_OUTBOX)
    persist()
  }
  return q.length
}

/** Remove one committed/rejected entry by its local action id. */
export function dequeue(_lid) {
  const q = hydrate()
  const at = q.findIndex((entry) => entry._lid === _lid)
  if (at >= 0) {
    q.splice(at, 1)
    persist()
  }
}

export function outboxSize() {
  return hydrate().length
}

/** Ids of orders this terminal created while still queued — the offline
 * void gate treats exactly these as "created here". */
export function offlineCreatedOrderIds(locId = null) {
  return new Set(hydrate()
    .filter((entry) => (!locId || entry.locId === locId) && entry.action?.type === 'CREATE_ORDER')
    .map((entry) => entry.action?.id)
    .filter(Boolean))
}

export function clearOutbox() {
  queue = []
  persist()
}

// ─── Replay conflicts ──────────────────────────────────────────────
// A financial action the server refused (409/403) is never dropped
// silently: it is parked here until the operator dismisses it, so the
// review banner can point at exactly what needs fixing.

export function readConflicts() {
  return readList(CONFLICT_KEY)
}

export function appendConflict(conflict) {
  const list = [...readList(CONFLICT_KEY), conflict].slice(-MAX_CONFLICTS)
  writeList(CONFLICT_KEY, list)
  return list
}

export function clearConflicts() {
  writeList(CONFLICT_KEY, [])
}

// ─── Has this terminal ever seen a server? ─────────────────────────
// Distinguishes a production terminal that booted during an outage from
// the offline demo (`npm run dev` with no API): only the former queues.

export function markServerSeen() {
  try { localStorage.setItem(SEEN_SERVER_KEY, '1') } catch { /* ignore */ }
}

export function hasSeenServer() {
  try { return localStorage.getItem(SEEN_SERVER_KEY) === '1' } catch { return false }
}
