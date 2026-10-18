import { TABLE_STATUS_META } from '../../lib/constants'
import { minutesBetween } from '../../lib/models'
import { quoteWait } from '../../lib/reducer'

function slotLabel(iso) {
  const d = new Date(iso)
  const m = Math.floor(d.getMinutes() / 15) * 15
  return `${String(d.getHours()).padStart(2, '0')}:${String(m).padStart(2, '0')} slot`
}

function localInputDefault(hoursAhead = 1) {
  const d = new Date(Date.now() + hoursAhead * 3600000)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const SNAP = 5
const MIN_SCALE = 0.6
const MAX_SCALE = 2.5

// Map-tile status fills, on the semantic status tokens so the plan reads the
// same in the light workspace and any dark surface. Text goes white on the
// saturated fills; the muted tone keeps token text.
const TONE_STYLES = {
  ok: 'bg-[var(--success)] text-white ring-[var(--success)]/25 shadow-black/10',
  info: 'bg-[var(--info)] text-white ring-[var(--info)]/25 shadow-black/10',
  warn: 'bg-[var(--warning)] text-white ring-[var(--warning)]/25 shadow-black/10',
  bad: 'bg-[var(--danger)] text-white ring-[var(--danger)]/25 shadow-black/10',
  muted: 'bg-[var(--border-strong)] text-[var(--text)] ring-[var(--border)] shadow-black/5',
}

const toneClass = (status) => TONE_STYLES[TABLE_STATUS_META[status]?.tone] || TONE_STYLES.muted

// Table status → `Badge` tone (the token-based replacement for StatusPill).
const BADGE_TONES = { ok: 'success', warn: 'warning', bad: 'danger', info: 'info', muted: 'neutral' }
const badgeToneFor = (status) => BADGE_TONES[TABLE_STATUS_META[status]?.tone] || 'neutral'

const clampPct = (value) => Math.max(0, Math.min(100, value))
const snapPct = (value) => Math.round(clampPct(value) / SNAP) * SNAP

// The table that will free up soonest — the earliest (today's average turn for
// its party − minutes already seated) across the occupied room. Shared by the
// waitlist quote and the map header so both quote the same number.
function nextFreeTable(state) {
  const occupied = (state?.tables || []).filter(
    (table) => (table.status === 'seated' || table.status === 'ordered') && table.seatedAt,
  )
  let best = null
  for (const table of occupied) {
    const avg = quoteWait(state, table.partySize || table.seats)
    const mins = Math.max(0, avg - minutesBetween(table.seatedAt))
    if (!best || mins < best.mins) best = { mins, table, avg }
  }
  return best
}

function zoneBands(tables) {
  const bands = new Map()
  for (const table of tables) {
    const zone = table.zone || 'Main'
    const x = Number.isFinite(Number(table.posX)) ? Number(table.posX) : 50
    const band = bands.get(zone) || { zone, min: x, max: x, count: 0 }
    band.min = Math.min(band.min, x)
    band.max = Math.max(band.max, x)
    band.count += 1
    bands.set(zone, band)
  }
  return [...bands.values()]
}


export { slotLabel, localInputDefault, SNAP, MIN_SCALE, MAX_SCALE, TONE_STYLES, toneClass, badgeToneFor, clampPct, snapPct, zoneBands, nextFreeTable }
