// ─── Dashboard shared helpers ──────────────────────────────────────
// Data shaping + the quick-action catalogue live here so each section stays a
// thin renderer. Nothing in this file touches state — it only derives views of
// the shop object that `getDashboard`/`getAlerts` already produced.

import { translateTableName, translateTicketStatus } from '../../lib/i18n'

// Quick routes out of the dashboard. `screen` must be a real screen id so the
// role gate in the section can hide anything this role can't open.
export const QUICK_ACTIONS = [
  { id: 'newOrder', screen: 'tickets', icon: 'orders', tone: 'accent' },
  { id: 'viewTables', screen: 'floor', icon: 'tables', tone: 'success' },
  { id: 'checkInventory', screen: 'inventory', icon: 'inventory', tone: 'info' },
  { id: 'viewReports', screen: 'reports', icon: 'reports', tone: 'warning' },
  { id: 'kitchen', screen: 'kitchen', icon: 'kitchen', tone: 'accent' },
  { id: 'foodCost', screen: 'costing', icon: 'costing', tone: 'success' },
]

// The four "quick overview" tiles double as live counters and deep links.
export const OVERVIEW_SCREENS = ['floor', 'tickets', 'kitchen', 'inventory']

// Contribution band → semantic tone, shared with Costing/Menu vocabulary.
export const BAND_TONE = { high: 'success', ok: 'info', low: 'warning', loss: 'danger' }

export function relativeTime(value, now = Date.now()) {
  if (!value) return 'recently'
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} hr ago`
}

// Map an alert to the screen that can resolve it. Mirrors the original
// Dashboard mapping so "Open recommended screen" lands somewhere useful.
export function alertScreenFor(alert) {
  if (!alert) return 'kitchen'
  switch (alert.type) {
    case 'late_ticket': return 'kitchen'
    case 'low_stock': return 'inventory'
    case 'negative_margin': return 'costing'
    case 'bill_request': return 'tickets'
    case 'long_turn':
    case 'call_server': return 'floor'
    case '86': return String(alert.key).startsWith('out_') ? 'inventory' : 'kitchen'
    default: return 'kitchen'
  }
}

// The last five non-void tickets, shaped for the activity feed.
export function activityRows(state, lang, copy) {
  const tableById = Object.fromEntries(state.tables.map((table) => [table.id, table]))
  return [...state.orders]
    .filter((order) => order.status !== 'void')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map((order) => {
      const rawTableName = tableById[order.tableId]?.name || order.type
      const tableName = translateTableName(rawTableName, lang)
      const count = order.items.filter((item) => !item.voided).length
      const statusLabel = translateTicketStatus(order.status, lang)
      const digits = String(order.id).replace(/\D/g, '').slice(-4)
      const done = order.status === 'ready' || order.status === 'paid'
      return {
        id: order.id,
        title: `${done ? copy.orderCompleted : copy.newOrderTitle}${digits ? ` #${digits}` : ''}`,
        detail: `${tableName} · ${copy.itemsCount(count)} · ${statusLabel}`,
        at: order.updatedAt || order.createdAt,
        icon: done ? 'check' : 'orders',
        tone: done ? 'success' : 'accent',
      }
    })
}
