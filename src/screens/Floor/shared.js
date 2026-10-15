import { TABLE_STATUS_META } from '../../lib/constants'

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

const TONE_STYLES = {
  ok: 'bg-emerald-500 text-white ring-emerald-200 shadow-emerald-900/20',
  info: 'bg-sky-500 text-white ring-sky-200 shadow-sky-900/20',
  warn: 'bg-amber-400 text-amber-950 ring-amber-200 shadow-amber-900/10',
  bad: 'bg-rose-500 text-white ring-rose-200 shadow-rose-900/20',
  muted: 'bg-zinc-300 text-zinc-700 ring-zinc-200 shadow-zinc-900/5',
}

const toneClass = (status) => TONE_STYLES[TABLE_STATUS_META[status]?.tone] || TONE_STYLES.muted

const clampPct = (value) => Math.max(0, Math.min(100, value))
const snapPct = (value) => Math.round(clampPct(value) / SNAP) * SNAP

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


export { slotLabel, localInputDefault, SNAP, MIN_SCALE, MAX_SCALE, TONE_STYLES, toneClass, clampPct, snapPct, zoneBands }
