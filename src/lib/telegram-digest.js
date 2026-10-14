// ─── Telegram digests & notifications ───────────────────────────────
// The bot does not only answer questions — it also talks first. This
// module owns the words: the close-of-day digest and the short notices
// the server pushes when the floor changes (a check is fired, a plate is
// paid for, a dish is 86'd, stock drops under par, a supplier invoice
// lands).
//
// Everything here is pure: pass the shop, get a string. The server keeps
// the transport and the "have I already sent this?" memory (server/notify.js),
// which is what makes the whole thing testable without a network.

import { money, pct } from './models.js'
import { buildReports } from './reports.js'
import { unitShort } from './units.js'

/** Local YYYY-MM-DD — the key that makes "one digest per day" exact. */
export function dateKey(at = Date.now()) {
  const d = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function localHour(at = Date.now()) {
  return new Date(at).getHours()
}

/**
 * Items that are at or under par, worst first (out-of-stock on top).
 * Shared with /low so the push and the command can never disagree.
 */
export function lowStockRows(shop, limit = 4) {
  return (shop?.inventory || [])
    .filter((item) => Number(item.par) > 0 && (Number(item.onHand) || 0) <= Number(item.par))
    .map((item) => ({ ...item, cover: (Number(item.onHand) || 0) / Number(item.par) }))
    .sort((a, b) => a.cover - b.cover || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit)
}

export function lowStockLine(item, settings) {
  const onHand = Number(item.onHand) || 0
  const label = unitShort(settings, item.unit)
  const head = onHand <= 0 ? `OUT ${item.name}` : `Low ${item.name}`
  return `${head} — ${onHand} ${label} left (par ${item.par} ${label})`
}

/**
 * Close-of-day digest. `key` is the day it belongs to, so the server can
 * send exactly one per day even across restarts.
 */
export function dailyDigest(shop, now = Date.now()) {
  const reports = buildReports(shop, 'tonight', now)
  const { sales, purchases, pnl, movements, rankings } = reports
  const top = (rankings?.sell?.byRevenue || []).slice(0, 3)
  const buys = (rankings?.buy?.bySpend || []).slice(0, 3)
  const lines = [
    `🗒 Close of day · ${shop?.name || 'Restora'}`,
    `Checks ${sales.checks} · Net sales ${money(sales.netSales)} · Avg check ${money(sales.avgCheck)}`,
    `Food cost ${pct(pnl.foodCostPct)} (${money(pnl.cogs)}) · Gross profit ${money(pnl.grossProfit)}`,
    `Buying ${money(purchases.spend)} · Open POs ${(purchases.openOrders || []).length} (${money(purchases.openValue || 0)})`,
    `Stock moved ${movements.inCount} in / ${movements.outCount} out · Waste ${money(pnl.waste)}`,
    top.length
      ? `Top sellers: ${top.map((row) => `${row.name} ${row.qty}× (${money(row.revenue)})`).join(', ')}`
      : 'Top sellers: nothing sold yet',
  ]
  if (buys.length) {
    lines.push(`Biggest buys: ${buys.map((row) => `${row.name} ${money(row.value)}`).join(', ')}`)
  }
  const low = lowStockRows(shop, 3)
  if (low.length) {
    lines.push(`Needs ordering: ${low.map((item) => lowStockLine(item, shop?.settings)).join(' · ')}`)
  }
  return { key: dateKey(now), text: lines.join('\n') }
}

/**
 * True when the digest is switched on, the hour has come, and today has not
 * gone out yet. `force` is the "send it now" button: it skips the hour gate
 * (and the already-sent mark) but still refuses when the push is switched off.
 */
export function digestDue(settings, now = Date.now(), lastKey = null, { force = false } = {}) {
  const config = settings?.telegram
  if (!config?.notifyDailyDigest) return false
  if (force) return true
  if (localHour(now) < Number(config.digestHour ?? 0)) return false
  return dateKey(now) !== lastKey
}

// ─── Event notices ──────────────────────────────────────────────────
// One formatter per kind so the wording lives in one place. Unknown kinds
// return null (the caller drops them) — no notice is better than a
// half-built sentence.

export const NOTICE_KINDS = [
  'order',
  'paid',
  'void',
  '86',
  'un86',
  'purchase',
  'lowStock',
  'booking_rescheduled',
  'table_transfer_requested',
  'table_transferred',
]

export function noticeText(kind, payload = {}, settings = null) {
  switch (kind) {
    case 'order': {
      const { tableName = 'Table', lines = 0, total = 0, guest = false } = payload
      const who = guest ? 'guest' : 'the floor'
      return `🧾 ${tableName}: ${lines} line${lines === 1 ? '' : 's'} fired from ${who} · ${money(total)}`
    }
    case 'paid': {
      const { tableName = 'Table', total = 0, method = 'card', tip = 0 } = payload
      const tipText = Number(tip) > 0 ? ` · tip ${money(tip)}` : ''
      return `💳 ${tableName} paid ${money(total)} by ${method}${tipText}`
    }
    case 'void': {
      const { tableName = 'Table', reason = 'no reason given' } = payload
      return `🗑️ ${tableName} was voided (${reason})`
    }
    case '86':
      return `🚫 86’d: ${payload.name || 'item'}`
    case 'un86':
      return `✅ Back on the menu: ${payload.name || 'item'}`
    case 'purchase': {
      const { number = 'PO', vendor = 'supplier', total = 0, status = 'ordered' } = payload
      if (status === 'received') return `📦 ${number} received from ${vendor} · ${money(total)}`
      if (status === 'ordered') return `📝 ${number} sent to ${vendor} · ${money(total)}`
      return null
    }
    case 'lowStock':
      return `📉 ${lowStockLine(payload, settings)}`
    case 'booking_rescheduled': {
      const { name = 'Guest', partySize = 2, oldTime, newTime, oldTable = 'Unassigned', newTable = 'Unassigned' } = payload
      const oldFmt = oldTime ? new Date(oldTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Earlier'
      const newFmt = newTime ? new Date(newTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'New slot'
      return `📅 Booking Rescheduled: ${name} (${partySize} pax)\n• Old: ${oldFmt} (${oldTable}) ➔ New: ${newFmt} (${newTable})`
    }
    case 'table_transfer_requested': {
      const { fromTable = 'Table', toTable = 'Table', guestName = 'Guest', reason = 'Guest requested' } = payload
      return `🔄 Table Transfer Requested: ${fromTable} ➔ ${toTable}\n• Guest: ${guestName}\n• Reason: ${reason}`
    }
    case 'table_transferred': {
      const { fromTable = 'Table', toTable = 'Table', guestName = 'Guest', actor = 'staff' } = payload
      return `🚀 Table Transferred: ${fromTable} ➔ ${toTable}\n• Guest: ${guestName} (${actor})\n• Orders & active kitchen items migrated`
    }
    default:
      return null
  }
}
