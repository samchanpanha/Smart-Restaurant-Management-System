// ─── Restora object model + status machines ─────────────────────────
// Spec: docs/superpowers/specs/2026-10-12-restora-ux-design.md §7–§8.
// The ticket is the system of record: floor, kitchen, and inventory
// all read the same order object.

import {
  TABLE_TRANSITIONS,
  TICKET_TRANSITIONS,
  TARGETS,
  marginBandFor,
} from './constants.js'
import { applyRounding, formatMoney, roundMoney } from './currency.js'

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
// Money prints in the ACTIVE currency, which the store re-configures
// from the location's settings (base currency first, override allowed).
// Pass an explicit currency (code, config, or row) to force one.

export function money(n, currency) {
  return formatMoney(n, currency)
}

// ─── Stock policy ────────────────────────────────────────────────
// The reorder policy decides when a SKU counts as low: classic par, or
// reorder point + safety stock (days of cover against last week's use).

export function reorderPointFor(item, settings) {
  const policy = settings?.stock?.reorderPolicy || 'par'
  const par = Number(item?.par) || 0
  if (policy !== 'reorder_point') return par
  const explicit = Number(item?.reorderPoint)
  const safetyDays = Math.max(0, Number(settings?.stock?.safetyStockDays) || 0)
  const dailyUse = Number(item?.dailyUse) || 0
  const safety = safetyDays * dailyUse
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(explicit + safety, 0)
  return Math.max(par + safety, 0)
}

export function stockStatusFor(item, settings) {
  const onHand = Number(item?.onHand ?? 0)
  if (onHand <= 0) return 'out'
  const threshold = reorderPointFor(item, settings)
  if (onHand < threshold) return 'low'
  return 'ok'
}

/** How much to order to get back to par (par + safety − on-hand − incoming). */
export function suggestedOrderQty(item, settings) {
  const target = reorderPointFor(item, settings)
  const incoming = Number(item?.incoming) || 0
  const onHand = Number(item?.onHand) || 0
  return Math.max(0, Math.ceil(target - onHand - incoming))
}

/**
 * Auto-86: dishes whose recipe ran out are marked unavailable, so the
 * composer and the guest QR menu stop selling them before the kitchen
 * finds out the hard way. Only dishes the system 86'd (`auto86`) are
 * cleared automatically when stock returns — a manual 86 stays manual.
 */
export function applyAuto86(shop, now = null) {
  if (!shop?.settings?.stock?.auto86OnZero) return shop
  const invById = Object.fromEntries((shop.inventory || []).map((item) => [item.id, item]))
  const outOfStock = (menuItemId) => {
    const recipe = shop.recipes?.[menuItemId]
    if (!recipe?.ingredients?.length) return false
    return recipe.ingredients.some((ing) => {
      const inv = invById[ing.inventoryItemId]
      return inv ? Number(inv.onHand) <= 0 : false
    })
  }
  let changed = false
  const menu = (shop.menu || []).map((item) => {
    const out = outOfStock(item.id)
    if (out && item.available !== false) {
      changed = true
      return { ...item, available: false, auto86: true, auto86At: now || new Date().toISOString() }
    }
    if (!out && item.auto86 === true && item.available === false) {
      changed = true
      return { ...item, available: true, auto86: false, auto86At: null }
    }
    return item
  })
  return changed ? { ...shop, menu } : shop
}

/** Stock value at the configured valuation method (last cost or weighted avg). */
export function stockValue(shop) {
  const method = shop?.settings?.stock?.valuationMethod || 'last_cost'
  return roundMoney((shop?.inventory || []).reduce((sum, item) => {
    const unitCost = method === 'weighted_average' && Number(item.avgCost) > 0 ? item.avgCost : item.lastCost
    return sum + Math.max(0, Number(item.onHand) || 0) * (Number(unitCost) || 0)
  }, 0))
}

/** Unit cost used by the recipe book for a SKU under the current method. */
export function unitCostFor(item, settings) {
  const method = settings?.stock?.valuationMethod || 'last_cost'
  if (method === 'weighted_average' && Number(item?.avgCost) > 0) return Number(item.avgCost)
  return Number(item?.lastCost) || 0
}

export function pct(ratio, digits = 1) {
  return `${(Number(ratio) * 100).toFixed(digits)}%`
}

// ─── Recipes & costing ───────────────────────────────────────────
// Plate cost = Σ (qty × lastCost × (1 + wastePct)) / yieldPortions

export function plateCostFor(recipe, inventoryById, settings) {
  if (!recipe || !recipe.ingredients?.length) return 0
  const total = recipe.ingredients.reduce((sum, ing) => {
    const inv = inventoryById[ing.inventoryItemId]
    const unitCost = unitCostFor(inv, settings)
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

export function costingFor(menuItem, recipe, inventoryById, settings) {
  const plate = plateCostFor(recipe, inventoryById, settings)
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
  return orderBillable(order).reduce((sum, it) => {
    const menu = menuById[it.menuItemId]
    return sum + (menu?.price ?? 0) * (it.qty || 0)
  }, 0)
}

// Billable lines exclude comps and voids (manager actions remove the charge,
// the line stays for audit).
export function orderBillable(order) {
  return (order.items || []).filter((i) => !i.comped && !i.voided)
}

/**
 * Every charge on a check, in the location's base currency:
 * discount → service charge → tax (on the taxable base) → rounding → tip.
 * `settings` carries taxPct, taxLabel, servicePct, serviceTaxable,
 * pricesIncludeTax, and rounding.
 */
export function orderCharges(order, menuById, settings = {}, options = {}) {
  const lines = orderBillable(order).map((item) => {
    const menu = menuById[item.menuItemId]
    const unitPrice = Number(menu?.price) || 0
    const qty = Number(item.qty) || 0
    return {
      id: item.id,
      name: menu?.name || 'Unknown item',
      sku: menu?.sku || '',
      qty,
      unitPrice,
      price: unitPrice,
      lineTotal: roundMoney(unitPrice * qty),
      modifiers: (item.modifiers || []).map((mod) => `${mod.id}: ${mod.value}`),
      notes: item.notes || '',
      station: item.station,
      course: item.course,
      status: item.status,
      guest: item.guest || null,
    }
  })

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0))
  const discountPct = Math.min(1, Math.max(0, Number(order?.discountPct) || 0))
  const discount = roundMoney(subtotal * discountPct)
  const netSubtotal = roundMoney(subtotal - discount)
  const servicePct = Math.max(0, Number(settings.servicePct) || 0)
  const service = roundMoney(netSubtotal * servicePct)
  const taxPct = Math.max(0, Number(settings.taxPct) || 0)
  const serviceTaxable = settings.serviceTaxable !== false
  const taxBase = roundMoney(netSubtotal + (serviceTaxable ? service : 0))
  const tax = settings.pricesIncludeTax
    ? roundMoney(taxBase * (taxPct / (1 + (taxPct || 1))))
    : roundMoney(taxBase * taxPct)
  const { total, adjustment } = applyRounding(roundMoney(netSubtotal + service + tax), settings.rounding || 'none')
  const tip = roundMoney(Number(options.tip ?? order?.tip ?? 0) || 0)
  const compTotal = roundMoney((order?.items || [])
    .filter((item) => item.comped && !item.voided)
    .reduce((sum, item) => sum + (Number(menuById[item.menuItemId]?.price) || 0) * (Number(item.qty) || 0), 0))
  const payments = (options.payments || order?.payments || []).map((payment) => ({
    method: String(payment?.method || 'card'),
    amount: roundMoney(Number(payment?.amount) || 0),
    at: payment?.at || null,
  }))
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0))
  const grandTotal = roundMoney(total + tip)

  return {
    lines,
    subtotal,
    discountPct,
    discount,
    service,
    servicePct,
    tax,
    taxPct,
    taxLabel: settings.taxLabel || 'Tax',
    serviceLabel: settings.serviceLabel || 'Service charge',
    rounding: adjustment,
    total,
    grandTotal,
    tip,
    paid,
    balance: roundMoney(grandTotal - paid),
    change: paid > grandTotal ? roundMoney(paid - grandTotal) : 0,
    compTotal,
    voidedLines: (order?.items || []).filter((item) => item.voided).length,
  }
}

/** Legacy shape used by the ticket + guest screens (tax rate only). */
export function orderTotals(order, menuById, taxPct = 0) {
  const charges = orderCharges(order, menuById, { taxPct })
  return {
    lines: charges.lines,
    subtotal: charges.subtotal,
    compTotal: charges.compTotal,
    tax: charges.tax,
    total: charges.total,
  }
}

export function orderStatusFromItems(items) {
  // Derive ticket progress from item states (held/fired/bump).
  if (!items.length) return 'open'
  if (items.every((i) => i.status === 'bump')) return 'ready'
  if (items.some((i) => i.status === 'fired')) return 'in_prep'
  return 'open'
}
