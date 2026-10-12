// ─── Restora object model + status machines ─────────────────────────
// Spec: docs/superpowers/specs/2026-10-12-restora-ux-design.md §7–§8.
// The ticket is the system of record: floor, kitchen, and inventory
// all read the same order object.

import {
  TABLE_TRANSITIONS,
  TICKET_TRANSITIONS,
  TARGETS,
  marginBandFor,
} from './constants'

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

// ─── Status machines ─────────────────────────────────────────────

export function canTableTransition(from, to) {
  return (TABLE_TRANSITIONS[from] || []).includes(to)
}

export function assertTableTransition(from, to) {
  if (!canTableTransition(from, to)) {
    throw new Error(`Illegal table transition: ${from} -> ${to}`)
  }
}

export function canTicketTransition(from, to) {
  return (TICKET_TRANSITIONS[from] || []).includes(to)
}

export function nextTableStatuses(from) {
  return TABLE_TRANSITIONS[from] || []
}

// ─── Money ───────────────────────────────────────────────────────

export function money(n) {
  const v = Number(n) || 0
  return `$${v.toFixed(2)}`
}

export function pct(ratio, digits = 1) {
  return `${(Number(ratio) * 100).toFixed(digits)}%`
}

// ─── Recipes & costing ───────────────────────────────────────────
// Plate cost = Σ (qty × lastCost × (1 + wastePct)) / yieldPortions

export function plateCostFor(recipe, inventoryById) {
  if (!recipe || !recipe.ingredients?.length) return 0
  const total = recipe.ingredients.reduce((sum, ing) => {
    const inv = inventoryById[ing.inventoryItemId]
    const unitCost = inv?.lastCost ?? 0
    const waste = 1 + (Number(ing.wastePct) || 0)
    return sum + Number(ing.qty || 0) * unitCost * waste
  }, 0)
  const portions = Number(recipe.yieldPortions) || 1
  return total / portions
}

export function contributionFor(price, plateCost) {
  const p = Number(price) || 0
  if (p <= 0) return 0
  return (p - plateCost) / p
}

export function costingFor(menuItem, recipe, inventoryById) {
  const plate = plateCostFor(recipe, inventoryById)
  const contribution = contributionFor(menuItem.price, plate)
  return { plate, contribution, band: marginBandFor(contribution) }
}

// ─── Time helpers ────────────────────────────────────────────────

export function minutesBetween(a, b = Date.now()) {
  return Math.max(0, Math.floor((b - new Date(a).getTime()) / 60000))
}

export function secondsBetween(a, b = Date.now()) {
  return Math.max(0, Math.floor((b - new Date(a).getTime()) / 1000))
}

export function formatClock(d) {
  const dt = new Date(d)
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatElapsed(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// KDS age state: on-time | warning (≥70% of 18min) | late (≥100%)
export function ticketAgeState(firedAt, now = Date.now()) {
  if (!firedAt) return 'on-time'
  const elapsedMin = (now - new Date(firedAt).getTime()) / 60000
  const ratio = elapsedMin / TARGETS.ticketMinutes
  if (ratio >= 1) return 'late'
  if (ratio >= TARGETS.ticketWarnRatio) return 'warning'
  return 'on-time'
}

// ─── Inventory ───────────────────────────────────────────────────
// Theoretical on-hand drops on FIRE, not on draft and not on pay.
// Counted on-hand only changes via receive, waste log, or close count.

export function stockStatusFor(item) {
  if ((item.onHand ?? 0) <= 0) return 'out'
  if ((item.onHand ?? 0) < (item.par ?? 0)) return 'low'
  return 'ok'
}

// Decrement map for firing N portions of a recipe: { inventoryItemId: qty }
export function theoreticalDecrementFor(recipe, portions = 1) {
  const out = {}
  if (!recipe?.ingredients) return out
  const yieldPortions = Number(recipe.yieldPortions) || 1
  for (const ing of recipe.ingredients) {
    const perPortion = Number(ing.qty || 0) / yieldPortions
    const need = perPortion * portions
    out[ing.inventoryItemId] = (out[ing.inventoryItemId] || 0) + need
  }
  return out
}

// ─── Floor ───────────────────────────────────────────────────────

export function isSeatBlocked(table) {
  // Dirty tables cannot be seated; ordered/billed are occupied.
  return table.status === 'dirty' || table.status === 'ordered' || table.status === 'billed'
}

export function needsOverSeatConfirm(table, partySize) {
  return partySize > table.seats
}

// Quote wait from today's actual average turn for that party size.
export function quoteWaitMinutes(partySize, turnsToday) {
  const same = turnsToday.filter((t) => Math.abs(t.partySize - partySize) <= 1)
  const pool = same.length ? same : turnsToday
  if (!pool.length) return TARGETS.targetTurnMinutes
  const avg = pool.reduce((s, t) => s + t.minutes, 0) / pool.length
  return Math.round(avg)
}

// ─── Orders ─────────────────────────────────────────────────────

export function orderSubtotal(order, menuById) {
  return (order.items || []).reduce((sum, it) => {
    const menu = menuById[it.menuItemId]
    return sum + (menu?.price ?? 0) * (it.qty || 0)
  }, 0)
}

export function orderStatusFromItems(items) {
  // Derive ticket progress from item states (held/fired/bump).
  if (!items.length) return 'open'
  if (items.every((i) => i.status === 'bump')) return 'ready'
  if (items.some((i) => i.status === 'fired')) return 'in_prep'
  return 'open'
}
