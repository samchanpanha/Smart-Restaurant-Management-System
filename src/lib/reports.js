// ─── Reports engine ─────────────────────────────────────────────────
// One place that turns the shop into numbers: what sold, what was
// bought, what moved in and out of the store room, and what is left as
// profit. Every figure traces back to a ticket, a purchase, or a signed
// row in the movement ledger — nothing here invents data.
//
// Pure module: screens and the print renderer both call it, and the
// server can run the same functions when it grows report endpoints.

import { roundMoney } from './currency.js'
import { money, orderCharges, plateCostFor } from './models.js'

export const RANGES = [
  { id: 'tonight', label: 'Tonight', days: 1, blurb: 'Since midnight' },
  { id: '7d', label: '7 days', days: 7, blurb: 'Rolling week' },
  { id: '30d', label: '30 days', days: 30, blurb: 'Rolling month' },
]

export const REPORT_TABS = [
  { id: 'sales', label: 'Sales, buys & stock', blurb: 'What you sold, what you bought, what moved' },
  { id: 'pnl', label: 'Profit & loss', blurb: 'Revenue less cost of goods, waste, and shrinkage' },
  { id: 'items', label: 'Top & bottom', blurb: 'Best and worst items on both sides of the ledger' },
]

const DAY_MS = 24 * 60 * 60 * 1000

/** Half-open time window: [start, end). `tonight` starts at local midnight. */
export function rangeBounds(range = 'tonight', now = Date.now()) {
  const days = RANGES.find((entry) => entry.id === range)?.days || 1
  if (range === 'tonight') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return { id: range, label: 'Tonight', start: start.getTime(), end: now + 1, days }
  }
  return {
    id: range,
    label: RANGES.find((entry) => entry.id === range)?.label || range,
    start: now - days * DAY_MS,
    end: now + 1,
    days,
  }
}

const timeOf = (value, fallback = 0) => {
  const t = new Date(value ?? fallback).getTime()
  return Number.isFinite(t) ? t : 0
}

export function inRange(value, bounds) {
  const t = timeOf(value)
  return t >= bounds.start && t < bounds.end
}

export function withinRange(values, bounds) {
  return values.filter((entry) => inRange(entry, bounds))
}

// ─── Sales ──────────────────────────────────────────────────────────

const paidOrders = (shop) => (shop.orders || []).filter((order) => order.status === 'paid')

export function orderRevenue(order, shop) {
  const menuById = Object.fromEntries((shop.menu || []).map((item) => [item.id, item]))
  return orderCharges(order, menuById, shop.settings || {})
}

export function salesSummary(shop, bounds) {
  const orders = paidOrders(shop).filter((order) => inRange(order.paidAt || order.createdAt, bounds))
  const inventoryById = Object.fromEntries((shop.inventory || []).map((item) => [item.id, item]))
  const lines = []
  let takings = 0
  let subtotal = 0
  let discount = 0
  let service = 0
  let tax = 0
  let tips = 0
  let cogs = 0
  let covers = 0
  const byMethod = {}

  for (const order of orders) {
    const totals = orderRevenue(order, shop)
    // Grand total is money actually collected: sales + service + tax + tip.
    takings += totals.grandTotal ?? totals.total ?? 0
    subtotal += totals.subtotal || 0
    discount += totals.discount || 0
    service += totals.service || 0
    tax += totals.tax || 0
    tips += totals.tip || 0
    covers += Number(order.covers) || 0
    const method = order.payMethod || 'unspecified'
    byMethod[method] = roundMoney((byMethod[method] || 0) + (totals.grandTotal ?? totals.total ?? 0))

    // orderCharges lines are print rows (name, qty, price) — the menu link
    // lives on the ticket item, so map it back through the line id.
    const ticketItemByLineId = Object.fromEntries((order.items || []).map((item) => [item.id, item]))
    for (const line of totals.lines || []) {
      const ticketItem = ticketItemByLineId[line.id]
      const menuItemId = ticketItem?.menuItemId || null
      const menuItem = (shop.menu || []).find((entry) => entry.id === menuItemId)
      const recipe = shop.recipes?.[menuItemId]
      const snapshot = ticketItem?.recipeSnapshot
      const unitCost = Number(snapshot?.plateCost) || plateCostFor(recipe, inventoryById, shop.settings) || 0
      const lineRevenue = Number(line.lineTotal) || 0
      const lineCost = roundMoney(unitCost * (Number(line.qty) || 0))
      cogs += lineCost
      lines.push({
        menuItemId: menuItemId || line.id,
        name: line.name || menuItem?.name || 'Unknown item',
        category: menuItem?.category || 'Uncategorised',
        qty: Number(line.qty) || 0,
        revenue: lineRevenue,
        cost: lineCost,
        margin: roundMoney(lineRevenue - lineCost),
        marginPct: lineRevenue > 0 ? (lineRevenue - lineCost) / lineRevenue : 0,
      })
    }
  }

  const checks = orders.length
  // Net sales is what a P&L calls revenue: menu sales less discounts, plus
  // service when the house charges it. Tax and tips never count as sales.
  const netSales = roundMoney(subtotal - discount + service)
  return {
    checks,
    covers,
    subtotal: roundMoney(subtotal),
    discount: roundMoney(discount),
    service: roundMoney(service),
    netSales,
    revenue: roundMoney(takings),
    takings: roundMoney(takings),
    tax: roundMoney(tax),
    tips: roundMoney(tips),
    cogs: roundMoney(cogs),
    grossProfit: roundMoney(netSales - cogs),
    marginPct: netSales > 0 ? (netSales - cogs) / netSales : 0,
    avgCheck: checks ? roundMoney(takings / checks) : 0,
    avgCover: covers ? roundMoney(takings / covers) : 0,
    byMethod,
    lines,
  }
}

export function deliverySummary(shop, bounds) {
  const completed = (shop.orders || []).filter((order) => (
    order.type === 'delivery'
    && order.deliveryStatus === 'delivered'
    && inRange(order.deliveredAt, bounds)
  ))
  const cancelled = (shop.orders || []).filter((order) => (
    order.type === 'delivery'
    && order.deliveryStatus === 'cancelled'
    && inRange(order.deliveryStatusAt, bounds)
  ))
  const withEta = completed.filter((order) => order.eta && Number.isFinite(new Date(order.eta).getTime()))
  const onTime = withEta.filter((order) => new Date(order.deliveredAt).getTime() <= new Date(order.eta).getTime())
  const minutesBetween = (later, earlier) => {
    const end = new Date(later).getTime()
    const start = new Date(earlier).getTime()
    return Number.isFinite(end) && Number.isFinite(start) && end >= start ? (end - start) / 60000 : null
  }
  const average = (values) => {
    const measured = values.filter((value) => value != null)
    return measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null
  }

  return {
    completed: completed.length,
    cancelled: cancelled.length,
    withEta: withEta.length,
    onTime: onTime.length,
    onTimeRate: withEta.length ? onTime.length / withEta.length : null,
    avgDeliveryMinutes: average(completed.map((order) => minutesBetween(order.deliveredAt, order.outForDeliveryAt))),
    avgReadyToHandoffMinutes: average(completed.map((order) => minutesBetween(order.outForDeliveryAt, order.readyAt))),
  }
}

// ─── Purchases ──────────────────────────────────────────────────────

/**
 * Spend in the window comes from two places: purchase orders that were
 * received (they carry the supplier and the number) and quick receipts
 * taken straight from the Suppliers screen. Both are money out.
 */
export function purchaseSummary(shop, bounds) {
  const purchases = (shop.purchases || []).filter((purchase) => (
    purchase.status === 'received' && inRange(purchase.receivedAt || purchase.updatedAt, bounds)
  ))
  const quickReceipts = (shop.invoiceLog || []).filter((entry) => (
    !entry.purchaseId && inRange(entry.at, bounds)
  ))

  const bySupplier = {}
  const byItem = {}
  let spend = 0

  const supplierRow = (id, name) => {
    bySupplier[id] = bySupplier[id] || { id, name: name || 'Unassigned vendor', value: 0, orders: 0, lines: 0, open: 0 }
    return bySupplier[id]
  }

  const book = (supplierId, vendor, itemId, name, qty, unitCost, value) => {
    const row = supplierRow(supplierId, vendor)
    row.lines += 1
    row.value = roundMoney(row.value + value)
    byItem[itemId] = byItem[itemId] || { itemId, name, qty: 0, value: 0, unitCost }
    byItem[itemId].qty += qty
    byItem[itemId].value = roundMoney(byItem[itemId].value + value)
    byItem[itemId].unitCost = unitCost || byItem[itemId].unitCost
  }

  for (const purchase of purchases) {
    const total = Number(purchase.totals?.total) || 0
    const taxAndShipping = roundMoney((Number(purchase.tax) || 0) + (Number(purchase.shipping) || 0))
    const supplier = (shop.suppliers || []).find((entry) => entry.id === purchase.supplierId)
    const key = purchase.supplierId || purchase.vendor || 'unassigned'
    const row = supplierRow(key, purchase.vendor || supplier?.name)
    row.orders += 1
    spend = roundMoney(spend + total)

    const lines = purchase.lines || []
    const lineSum = lines.reduce((sum, line) => (
      sum + (Number(line.receivedQty ?? line.qty) || 0) * (Number(line.unitCost) || 0)
    ), 0)
    for (const line of lines) {
      const qty = Number(line.receivedQty ?? line.qty) || 0
      // Tax and shipping ride along with the lines so the supplier total
      // always adds back up to what the purchase actually cost.
      const share = lineSum > 0 ? (qty * (Number(line.unitCost) || 0)) / lineSum : 0
      book(
        key, purchase.vendor || supplier?.name,
        line.inventoryItemId, line.name, qty, Number(line.unitCost) || 0,
        roundMoney((qty * (Number(line.unitCost) || 0)) + share * taxAndShipping),
      )
    }
  }

  for (const receipt of quickReceipts) {
    const supplier = (shop.suppliers || []).find((entry) => (
      entry.id === receipt.supplierId || entry.name.toLowerCase() === String(receipt.vendor || '').toLowerCase()
    ))
    const key = supplier?.id || receipt.supplierId || receipt.vendor || 'unassigned'
    const row = supplierRow(key, receipt.vendor || supplier?.name)
    row.orders += 1
    const lineSum = (receipt.lines || []).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitCost) || 0), 0)
    spend = roundMoney(spend + (Number(receipt.total) || lineSum))
    for (const line of receipt.lines || []) {
      const item = (shop.inventory || []).find((entry) => entry.id === line.inventoryItemId)
      const qty = Number(line.qty) || 0
      const cost = Number(line.unitCost) || 0
      const share = lineSum > 0 ? (qty * cost) / lineSum : 0
      book(
        key, receipt.vendor || supplier?.name, line.inventoryItemId,
        item?.name || 'Unknown item', qty, cost,
        roundMoney((qty * cost) + share * Math.max(0, (Number(receipt.total) || lineSum) - lineSum)),
      )
    }
  }

  const open = (shop.purchases || []).filter((purchase) => ['draft', 'ordered'].includes(purchase.status))
  return {
    spend: roundMoney(spend),
    orders: purchases.length,
    quickReceipts: quickReceipts.length,
    units: Object.values(byItem).reduce((sum, entry) => sum + entry.qty, 0),
    bySupplier: Object.values(bySupplier).map((entry) => ({ ...entry, value: roundMoney(entry.value) })).sort((a, b) => b.value - a.value),
    byItem: Object.values(byItem).map((entry) => ({ ...entry, value: roundMoney(entry.value) })).sort((a, b) => b.value - a.value),
    openOrders: open.map((purchase) => ({
      id: purchase.id,
      number: purchase.number,
      vendor: purchase.vendor,
      status: purchase.status,
      expectedAt: purchase.expectedAt,
      total: purchase.totals?.total || 0,
      lines: purchase.lines?.length || 0,
    })),
    openValue: roundMoney(open.reduce((sum, purchase) => sum + (Number(purchase.totals?.total) || 0), 0)),
  }
}

// ─── Stock movements in and out ─────────────────────────────────────

export function movementSummary(shop, bounds) {
  const rows = (shop.movements || []).filter((movement) => inRange(movement.at, bounds))
  const empty = () => ({ value: 0, units: 0, count: 0 })
  const totals = { in: empty(), out: empty() }
  const byKind = {}
  const byItem = {}

  for (const movement of rows) {
    const qty = Number(movement.qty) || 0
    const value = Number(movement.value) || 0
    // Opening balances (and any correction to them) are the baseline the
    // book starts from — not stock that walked in or out this window.
    const isBaseline = movement.kind === 'opening' || movement.baseline === true
    const countable = !isBaseline
    const bucket = qty >= 0 ? 'in' : 'out'
    if (countable) {
      totals[bucket].value += Math.abs(value)
      totals[bucket].units += Math.abs(qty)
      totals[bucket].count += 1
    }

    byKind[movement.kind] = byKind[movement.kind] || { kind: movement.kind, ...empty(), inValue: 0, outValue: 0, baseline: false }
    const kindRow = byKind[movement.kind]
    kindRow.count += 1
    if (isBaseline) kindRow.baseline = true
    if (qty >= 0) { kindRow.units += qty; kindRow.inValue += Math.abs(value) } else { kindRow.units += Math.abs(qty); kindRow.outValue += Math.abs(value) }
    kindRow.value = roundMoney(kindRow.inValue - kindRow.outValue)

    byItem[movement.itemId] = byItem[movement.itemId] || {
      itemId: movement.itemId,
      name: movement.name,
      unit: movement.unit,
      inQty: 0,
      outQty: 0,
      inValue: 0,
      outValue: 0,
      openingQty: 0,
      openingValue: 0,
      correctionQty: 0,
      correctionValue: 0,
      lastAt: movement.at,
    }
    const itemRow = byItem[movement.itemId]
    if (isBaseline) {
      // Counted stock at the start of the book — a baseline, not a receipt.
      // Corrections to it stay signed: they exist to make the book add up.
      if (movement.kind === 'opening') {
        itemRow.openingQty += qty
        itemRow.openingValue += value
      } else {
        itemRow.correctionQty += qty
        itemRow.correctionValue += value
      }
    } else if (qty >= 0) {
      itemRow.inQty += qty
      itemRow.inValue += Math.abs(value)
    } else {
      itemRow.outQty += Math.abs(qty)
      itemRow.outValue += Math.abs(value)
    }
    if (timeOf(movement.at) > timeOf(itemRow.lastAt)) itemRow.lastAt = movement.at
  }

  const baselineRows = rows.filter((movement) => movement.kind === 'opening' || movement.baseline === true)
  const openingValue = roundMoney(baselineRows.reduce((sum, movement) => sum + (Number(movement.value) || 0), 0))
  return {
    rows,
    baselineRows,
    openingValue,
    openingUnits: Math.round(baselineRows.reduce((sum, movement) => sum + (Number(movement.qty) || 0), 0) * 1000) / 1000,
    inValue: roundMoney(totals.in.value),
    outValue: roundMoney(totals.out.value),
    netValue: roundMoney(totals.in.value - totals.out.value),
    inUnits: Math.round(totals.in.units * 1000) / 1000,
    outUnits: Math.round(totals.out.units * 1000) / 1000,
    inCount: totals.in.count,
    outCount: totals.out.count,
    byKind: Object.values(byKind).map((row) => ({
      ...row,
      inValue: roundMoney(row.inValue),
      outValue: roundMoney(row.outValue),
    })),
    byItem: Object.values(byItem).map((row) => ({
      ...row,
      inValue: roundMoney(row.inValue),
      outValue: roundMoney(row.outValue),
      netQty: Math.round((row.inQty - row.outQty) * 1000) / 1000,
      netValue: roundMoney(row.inValue - row.outValue),
      baselineQty: Math.round((row.openingQty + row.correctionQty) * 1000) / 1000,
      baselineValue: roundMoney(row.openingValue + row.correctionValue),
    })),
  }
}

/**
 * Opening → in → out → closing per item, straight from the ledger plus
 * today's on-hand. Trustworthy because every path that touches stock
 * writes a signed row.
 */
export function stockFlow(shop, bounds) {
  const moved = movementSummary(shop, bounds)
  return moved.byItem.map((row) => {
    const item = (shop.inventory || []).find((entry) => entry.id === row.itemId)
    const closing = Number(item?.onHand) || 0
    // Prefer what the ledger says the book opened with; fall back to
    // working backwards from today's count when a SKU has no baseline row.
    const unitCost = Number(item?.lastCost) || 0
    const opening = row.baselineQty || Math.round((closing - row.inQty + row.outQty) * 1000) / 1000
    return {
      ...row,
      onHand: closing,
      unit: row.unit || item?.unit || '',
      opening: Math.round(opening * 1000) / 1000,
      openingValue: row.baselineValue || roundMoney(opening * unitCost),
      value: roundMoney(row.inValue - row.outValue),
      bookValue: roundMoney(closing * unitCost),
      unitCost,
    }
  }).sort((a, b) => Math.abs(b.netValue) - Math.abs(a.netValue))
}

// ─── Profit & loss ──────────────────────────────────────────────────

export function profitAndLoss(shop, bounds) {
  const sales = salesSummary(shop, bounds)
  const purchases = purchaseSummary(shop, bounds)
  const movements = movementSummary(shop, bounds)

  const waste = (shop.wasteLog || []).filter((entry) => inRange(entry.at, bounds))
  const wasteValue = roundMoney(waste.reduce((sum, entry) => (
    sum + (Number(entry.value) || Number(entry.qty) * (Number((shop.inventory || []).find((item) => item.id === entry.inventoryItemId)?.lastCost) || 0))
  ), 0))

  const varianceRows = movements.rows.filter((movement) => (
    (movement.kind === 'count' || movement.kind === 'adjust') && movement.baseline !== true
  ))
  const shrinkageValue = roundMoney(Math.max(0, varianceRows.reduce((sum, movement) => sum + -(Number(movement.value) || 0), 0)))
  const compValue = roundMoney((shop.orders || [])
    .filter((order) => inRange(order.paidAt || order.createdAt, bounds))
    .reduce((sum, order) => sum + (Number(order.compTotal) || 0), 0))
  const discounts = roundMoney(sales.lines.reduce((sum, line) => sum + 0, 0))

  const grossProfit = roundMoney(sales.netSales - sales.cogs)
  const operatingResult = roundMoney(grossProfit - wasteValue - shrinkageValue)
  const takings = roundMoney(sales.takings)

  const byCategory = {}
  for (const line of sales.lines) {
    const row = byCategory[line.category] || { category: line.category, qty: 0, revenue: 0, cost: 0 }
    row.qty += line.qty
    row.revenue = roundMoney(row.revenue + line.revenue)
    row.cost = roundMoney(row.cost + line.cost)
    byCategory[line.category] = row
  }

  return {
    range: bounds.id,
    label: bounds.label,
    sales,
    purchases,
    movements,
    revenue: sales.netSales,
    tax: sales.tax,
    cogs: sales.cogs,
    grossProfit,
    marginPct: sales.netSales > 0 ? (sales.netSales - sales.cogs) / sales.netSales : 0,
    waste: wasteValue,
    wasteCount: waste.length,
    shrinkage: shrinkageValue,
    comps: compValue,
    discounts,
    operatingResult,
    operatingMarginPct: sales.netSales > 0 ? operatingResult / sales.netSales : 0,
    foodCostPct: sales.netSales > 0 ? sales.cogs / sales.netSales : 0,
    cashIn: takings,
    takings,
    cashOut: purchases.spend,
    netCash: roundMoney(takings - purchases.spend),
    byCategory: Object.values(byCategory)
      .map((row) => ({
        ...row,
        margin: roundMoney(row.revenue - row.cost),
        marginPct: row.revenue > 0 ? (row.revenue - row.cost) / row.revenue : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    targets: {
      foodCostCap: shop.settings?.foodCostCap ?? 0.32,
      onTarget: (sales.netSales > 0 ? sales.cogs / sales.netSales : 0) <= (shop.settings?.foodCostCap ?? 0.32),
    },
  }
}

// ─── Top & bottom on both sides ─────────────────────────────────────

export function itemRankings(shop, bounds, limit = 5) {
  const sales = salesSummary(shop, bounds)
  const purchases = purchaseSummary(shop, bounds)

  const merge = (lines, key) => Object.values(lines.reduce((acc, line) => {
    const id = line[key]
    acc[id] = acc[id] || { id, name: line.name, qty: 0, revenue: 0, cost: 0, margin: 0, marginPct: 0 }
    acc[id].qty += line.qty
    acc[id].revenue = roundMoney(acc[id].revenue + line.revenue)
    acc[id].cost = roundMoney(acc[id].cost + line.cost)
    acc[id].margin = roundMoney(acc[id].revenue - acc[id].cost)
    acc[id].marginPct = acc[id].revenue > 0 ? acc[id].margin / acc[id].revenue : 0
    return acc
  }, {}))

  const sold = merge(sales.lines, 'menuItemId')
  const by = (key, direction = 'desc') => [...sold]
    .sort((a, b) => (direction === 'desc' ? b[key] - a[key] : a[key] - b[key]))
    .slice(0, limit)

  const bought = purchases.byItem
  const boughtBy = (key, direction = 'desc') => [...bought]
    .sort((a, b) => (direction === 'desc' ? b[key] - a[key] : a[key] - b[key]))
    .slice(0, limit)

  const sellers = [...sold].sort((a, b) => b.revenue - a.revenue)
  const withSales = sellers.filter((item) => item.qty > 0)
  const menuNotSold = (shop.menu || [])
    .filter((item) => item.active !== false && !withSales.some((sold2) => sold2.id === item.id))
    .map((item) => ({ id: item.id, name: item.name, price: item.price, category: item.category, qty: 0, revenue: 0, cost: 0, margin: 0, marginPct: 0 }))

  return {
    sell: {
      byRevenue: by('revenue'),
      byUnits: by('qty'),
      byMargin: by('margin'),
      worst: [...withSales].sort((a, b) => a.margin - b.margin).slice(0, limit),
      unsold: menuNotSold.slice(0, limit),
      unsoldCount: menuNotSold.length,
    },
    buy: {
      bySpend: boughtBy('value'),
      byQty: boughtBy('qty'),
      least: [...bought].sort((a, b) => a.value - b.value).slice(0, limit),
    },
  }
}

/** Everything a report screen or a printed report needs, in one call. */
export function buildReports(shop, range = 'tonight', now = Date.now()) {
  const bounds = rangeBounds(range, now)
  const sales = salesSummary(shop, bounds)
  const delivery = deliverySummary(shop, bounds)
  const purchases = purchaseSummary(shop, bounds)
  const movements = movementSummary(shop, bounds)
  const pnl = profitAndLoss(shop, bounds)
  const rankings = itemRankings(shop, bounds)
  const flow = stockFlow(shop, bounds)
  return { bounds, sales, delivery, purchases, movements, pnl, rankings, flow }
}

export { money }
