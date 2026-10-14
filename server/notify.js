// ─── Telegram notifications ─────────────────────────────────────────
// Until now the bot only spoke when spoken to. This module lets it talk
// first: a check is fired, a plate is paid for, a dish is 86'd, stock
// drops under par, a supplier invoice lands — the configured chat hears
// about it without anybody opening the app.
//
// Notices are derived by DIFFING the shop before and after an action, so
// no screen has to remember to notify and the bot can never disagree with
// the book. Transport is the same `sendTelegramMessage` the webhook uses:
// with no TELEGRAM_BOT_TOKEN everything is a logged no-op, which is what
// keeps the tests offline.
//
// Environment / config:
//   TELEGRAM_CHAT_ROLES   chat ids that already exist ("-100123:manager")
//   settings.telegram     chatId, which events to push, digest hour
// Any chat that messages the bot is remembered too, so wiring a new phone
// is "say /start once", not "copy the chat id into an env file".

import { dailyDigest, digestDue, noticeText } from '../src/lib/telegram-digest.js'
import { sendTelegramMessage } from './telegram.js'

const MAX_NOTICES_PER_ACTION = 4
const MAX_HEARD_CHATS = 24

function orderLineTotal(order, menuById) {
  return (order?.items || []).reduce((sum, item) => {
    const price = Number(menuById.get(item.menuItemId)?.price) || 0
    return sum + price * (Number(item.qty) || 0)
  }, 0)
}

function labelOf(table) {
  return table?.name || table?.label || table?.id || 'Table'
}

/**
 * What is worth telling the chat, given one state transition.
 * Pure: same inputs in, same notices out — the caller owns delivery.
 */
export function noticesFor(prev, next, action = null, settings = null) {
  if (!prev || !next || !next.tables) return []
  const out = []
  const inner = action?.type === 'LOC' ? action.action : action
  const menuById = new Map((next.menu || []).map((entry) => [entry.id, entry]))
  const prevTableById = new Map((prev.tables || []).map((table) => [table.id, table]))
  const prevMenuById = new Map((prev.menu || []).map((entry) => [entry.id, entry]))
  const prevPurchaseById = new Map((prev.purchases || []).map((po) => [po.id, po]))

  // ── Tables: a check was fired, or a table paid up ─────────────────
  for (const table of next.tables || []) {
    const before = prevTableById.get(table.id)
    if (!before || before.status === table.status) continue
    if (table.status === 'ordered' && before.status !== 'ordered') {
      const order = (next.orders || []).find((o) => o.id === table.currentCheckId)
        || (next.orders || []).find((o) => o.tableId === table.id && !['paid', 'void'].includes(o.status))
      const lines = order?.items?.length || 0
      if (!lines) continue
      out.push({
        kind: 'order',
        payload: {
          tableName: labelOf(table),
          lines,
          total: orderLineTotal(order, menuById),
          guest: inner?.type === 'GUEST_SEND' || (order.items || []).some((item) => item.by === 'guest'),
        },
      })
      continue
    }
    if (table.status === 'billed' && before.status !== 'billed') {
      const paid = [...(next.orders || [])]
        .filter((o) => o.tableId === table.id && o.status === 'paid')
        .sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')))[0]
      if (!paid) continue
      out.push({
        kind: 'paid',
        payload: {
          tableName: labelOf(table),
          total: Number(paid.total) || orderLineTotal(paid, menuById),
          method: paid.payMethod || 'card',
          tip: Number(paid.tip) || 0,
        },
      })
    }
  }

  // ── A whole check thrown away ─────────────────────────────────────
  if (inner?.type === 'VOID_ORDER') {
    const order = (prev.orders || []).find((o) => o.id === inner.orderId)
    const table = (next.tables || []).find((t) => t.id === order?.tableId)
    if (order) {
      out.push({ kind: 'void', payload: { tableName: labelOf(table), reason: inner.reason || 'no reason given' } })
    }
  }

  // ── Booking reschedule diff ───────────────────────────────────────
  if (inner?.type === 'RESCHEDULE_BOOKING') {
    const bId = inner.payload?.bookingId || inner.bookingId
    const nextRes = (next.reservations || []).find((r) => String(r.id) === String(bId))
    const prevRes = (prev.reservations || []).find((r) => String(r.id) === String(bId))
    if (nextRes) {
      const prevTable = (prev.tables || []).find((t) => String(t.id) === String(prevRes?.tableId))
      const nextTable = (next.tables || []).find((t) => String(t.id) === String(nextRes?.tableId))
      out.push({
        kind: 'booking_rescheduled',
        payload: {
          name: nextRes.name,
          partySize: nextRes.partySize,
          oldTime: prevRes?.time || nextRes.previousSlot?.time,
          newTime: nextRes.time,
          oldTable: prevTable?.name || 'Unassigned',
          newTable: nextTable?.name || 'Unassigned',
        },
      })
    }
  }

  // ── Table transfer request & execution ────────────────────────────
  if (inner?.type === 'REQUEST_TABLE_TRANSFER') {
    const cId = inner.payload?.currentTableId || inner.currentTableId
    const tId = inner.payload?.targetTableId || inner.targetTableId
    const fromTable = (next.tables || []).find((t) => String(t.id) === String(cId))
    const toTable = (next.tables || []).find((t) => String(t.id) === String(tId))
    out.push({
      kind: 'table_transfer_requested',
      payload: {
        fromTable: fromTable?.name || cId,
        toTable: toTable?.name || tId,
        guestName: fromTable?.guestName || 'Guest',
        reason: inner.payload?.reason || inner.reason || 'Guest requested',
      },
    })
  }

  if (inner?.type === 'APPROVE_TABLE_TRANSFER' || inner?.type === 'TRANSFER_TABLE') {
    const cId = inner.payload?.currentTableId || inner.currentTableId
    const tId = inner.payload?.targetTableId || inner.targetTableId
    const fromTable = (prev.tables || []).find((t) => String(t.id) === String(cId))
    const toTable = (next.tables || []).find((t) => String(t.id) === String(tId))
    out.push({
      kind: 'table_transferred',
      payload: {
        fromTable: fromTable?.name || cId,
        toTable: toTable?.name || tId,
        guestName: toTable?.guestName || fromTable?.guestName || 'Guest',
        actor: inner.payload?.actor || inner.actor || 'staff',
      },
    })
  }

  // ── Menu availability flipped ─────────────────────────────────────
  for (const item of next.menu || []) {
    const before = prevMenuById.get(item.id)
    if (!before || before.available === item.available) continue
    out.push({ kind: item.available === false ? '86' : 'un86', payload: { name: item.name } })
  }

  // ── Purchase orders living their life ─────────────────────────────
  for (const po of next.purchases || []) {
    const before = prevPurchaseById.get(po.id)
    const statusChanged = !before || before.status !== po.status
    if (!statusChanged) continue
    if (!before && !['ordered', 'received'].includes(po.status)) continue
    out.push({
      kind: 'purchase',
      payload: {
        number: po.number || po.id,
        vendor: po.vendor || 'supplier',
        total: Number(po.totals?.total) || 0,
        status: po.status,
      },
    })
  }

  // ── Stock crossing under par ──────────────────────────────────────
  const isLow = (item) => Number(item.par) > 0 && (Number(item.onHand) || 0) <= Number(item.par)
  const wasLow = new Set((prev.inventory || []).filter(isLow).map((item) => item.id))
  for (const item of next.inventory || []) {
    if (!isLow(item) || wasLow.has(item.id)) continue
    out.push({ kind: 'lowStock', payload: item })
  }

  return out
    .map((notice) => ({ ...notice, text: noticeText(notice.kind, notice.payload, settings) }))
    .filter((notice) => notice.text)
    .slice(0, MAX_NOTICES_PER_ACTION)
}

/**
 * Transport + memory. `handleAction` is fire-and-forget: the API response
 * never waits for Telegram, and a dead Telegram never breaks a service.
 */
export function createNotifier({
  getState,
  send = sendTelegramMessage,
  chatRoles = {},
  now = () => Date.now(),
} = {}) {
  const heard = new Set() // chat ids that have messaged the bot
  let lastDigestKey = null
  const stats = {
    notices: 0, delivered: 0, skipped: 0, failed: 0,
    digests: 0, lastAt: null, lastText: null, lastTargets: [], lastError: null, digestKey: null,
  }

  /** A chat talked to us — from now on it can also be pushed to. */
  function registerChat(chatId) {
    const id = String(chatId ?? '').trim()
    if (!id) return
    heard.add(id)
    while (heard.size > MAX_HEARD_CHATS) heard.delete(heard.values().next().value)
  }

  function targets(settings) {
    const ids = [
      settings?.telegram?.chatId,
      ...heard,
      ...Object.keys(chatRoles || {}).filter((chat) => chat !== '*'),
    ]
    return [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))]
  }

  async function deliver(text, settings) {
    const list = targets(settings)
    if (!list.length) {
      stats.skipped += 1
      stats.lastText = text
      stats.lastTargets = []
      stats.lastAt = new Date().toISOString()
      return { sent: 0, skipped: true, reason: 'no chat configured — add one in Settings → Telegram' }
    }
    let sent = 0
    for (const chatId of list) {
      const result = await send(chatId, text)
      if (result?.ok) { sent += 1; stats.delivered += 1 } else if (result?.skipped) stats.skipped += 1
      else { stats.failed += 1; stats.lastError = result?.error || 'send failed' }
    }
    stats.lastText = text
    stats.lastTargets = list
    stats.lastAt = new Date().toISOString()
    return { sent, targets: list }
  }

  /** Diff one committed action and push whatever it changed. */
  function handleAction(prev, next, action) {
    let notices = []
    let settings = null
    try {
      const locId = action?.locId || action?.action?.locId || 'downtown'
      const prevShop = prev?.locations?.[locId] || Object.values(prev?.locations || {})[0]
      const nextShop = next?.locations?.[locId] || Object.values(next?.locations || {})[0]
      settings = nextShop?.settings || null
      notices = noticesFor(prevShop, nextShop, action, settings)
    } catch (err) {
      stats.lastError = err?.message || 'notice build failed'
      return
    }
    if (!notices.length) return
    stats.notices += notices.length
    for (const notice of notices) {
      Promise.resolve()
        .then(() => deliver(notice.text, settings))
        .catch((err) => { stats.failed += 1; stats.lastError = err?.message || 'delivery failed' })
    }
  }

  /** What the digest would say right now — no sending, no marks. */
  function preview(at = now()) {
    const empire = getState?.()
    const shop = empire?.locations?.['downtown'] || Object.values(empire?.locations || {})[0]
    if (!shop) return null
    return { ...dailyDigest(shop, at), targets: targets(shop.settings) }
  }

  /**
   * The close-of-day digest: automatic once per day after its hour, or on
   * demand from the Telegram screen (`force`, which also previews with
   * `dryRun` and does not touch the "already sent today" mark).
   */
  async function tick(at = now(), { force = false } = {}) {
    const empire = getState?.()
    const shop = empire?.locations?.['downtown'] || Object.values(empire?.locations || {})[0]
    if (!shop) return null
    if (!digestDue(shop.settings, at, lastDigestKey, { force })) {
      // Not due: say why, so the "send it now" button can explain itself.
      return {
        ...dailyDigest(shop, at),
        sent: null,
        blocked: shop.settings?.telegram?.notifyDailyDigest ? 'already sent today' : 'the daily digest is switched off in Settings',
      }
    }
    const digest = dailyDigest(shop, at)
    lastDigestKey = digest.key
    stats.digestKey = digest.key
    stats.digests += 1
    const result = await deliver(digest.text, shop.settings)
    return { ...digest, sent: result.sent, targets: result.targets || [] }
  }

  async function sendTelegramEvent(tenantId, event) {
    const text = event?.text || ''
    if (!text) return { sent: 0 }
    const empire = getState?.()
    const shop = empire?.locations?.['downtown'] || Object.values(empire?.locations || {})[0]
    return deliver(text, shop?.settings)
  }

  return { registerChat, handleAction, tick, preview, stats, targets, deliver, sendTelegramEvent, get lastDigestKey() { return lastDigestKey } }
}

export async function sendTelegramEvent(tenantId, event) {
  const text = event?.text || ''
  if (!text) return { sent: 0 }
  return sendTelegramMessage(process.env.TELEGRAM_NOTIFICATION_CHAT || '', text, { parseMode: 'Markdown' })
}

