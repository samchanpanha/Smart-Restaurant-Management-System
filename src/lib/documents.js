// ─── Restora document engine ───────────────────────────────────────
// One place that turns live state into the four documents the business
// prints: invoices, guest receipts, kitchen tickets, and shift reports.
//
// Builders are pure functions of (shop, order|report, settings) so the
// same numbers appear on screen, on paper, and in the SQLite document
// registry. Rendering is dependency-free HTML + CSS so printing (or
// "Save as PDF") works in every browser without a print CSS framework.

import { MONO_STACK, SANS_STACK, fontBase, fontFaceCss } from './typography.js'
import { convertAmount, currencyConfig, formatMoney, roundMoney } from './currency.js'
import { DOC_KIND_META, PAPER_SIZES, templateFor } from './settings.js'
import { itemRankings, movementSummary, purchaseSummary, rangeBounds, stockFlow } from './reports.js'
import { orderBillable, orderCharges, plateCostFor, stockStatusFor } from './models.js'

const MAX_LINES = 80

function clampText(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

const OFF_TABLE_LABEL = { takeout: 'Takeout', delivery: 'Delivery' }

/** Who the order is for: table party, named customer, or walk-in. */
function customerLabel(order, table) {
  if (table) return `${table.name} · party of ${table.partySize || '—'}`
  const name = order?.customer?.name
  const type = OFF_TABLE_LABEL[order?.type] || 'Walk-in'
  return name ? `${type} · ${name}` : `${type} guest`
}


function money(amount, currency) {
  return formatMoney(amount, currency)
}

/** Display currency for a document: template choice → base fallback. */
export function documentCurrency(settings, template) {
  const choice = template?.currency && template.currency !== 'base' ? template.currency : null
  const cfg = currencyConfig(settings, choice || 'base')
  const base = currencyConfig(settings, 'base')
  return { ...cfg, baseCode: base.code, fx: cfg.code !== base.code ? cfg.rate : 1 }
}

// ─── Totals ────────────────────────────────────────────────────────
// Charges live in models.js (one implementation for screens, documents,
// and the server). Documents only add currency conversion on top.

export const computeOrderTotals = orderCharges

function sellerBlock(settings) {
  const addressLines = [
    settings.addressLine1,
    settings.addressLine2,
    [settings.city, settings.state, settings.postalCode].filter(Boolean).join(', '),
    settings.country,
  ].filter(Boolean)
  return {
    name: settings.restaurantName,
    legalName: settings.legalName,
    tagline: settings.tagline,
    description: settings.description,
    addressLines,
    phone: settings.phone,
    email: settings.email,
    website: settings.website,
    taxId: settings.taxId,
    logoUrl: settings.logoUrl || '',
    initials: settings.logoInitials || 'RS',
    brandColor: settings.brandColor || '#f36a21',
  }
}

function convertTotals(totals, currency) {
  if (!currency || currency.fx === 1) return totals
  const convert = (value) => roundMoney(convertAmount(value, currency.baseCode, currency.code, {
    baseCurrency: currency.baseCode,
    currencies: [{ code: currency.code, rate: currency.rate, enabled: true }],
  }), currency.decimals)
  return {
    ...totals,
    lines: (totals.lines || []).map((line) => ({
      ...line,
      unitPrice: convert(line.unitPrice),
      price: convert(line.unitPrice),
      lineTotal: convert(line.lineTotal),
    })),
    subtotal: convert(totals.subtotal),
    discount: convert(totals.discount),
    service: convert(totals.service),
    delivery: convert(totals.delivery),
    tax: convert(totals.tax),
    rounding: convert(totals.rounding),
    total: convert(totals.total),
    grandTotal: convert(totals.grandTotal),
    tip: convert(totals.tip),
    paid: convert(totals.paid),
    balance: convert(totals.balance),
    change: convert(totals.change),
    comped: convert(totals.comped),
  }
}

// ─── Invoice ───────────────────────────────────────────────────────

export function buildInvoiceDocument({ shop, order, settings, paymentTermsDays = 14 } = {}) {
  const template = templateFor(settings, 'invoice')
  const currency = documentCurrency(settings, template)
  const menuById = Object.fromEntries((shop.menu || []).map((item) => [item.id, item]))
  const table = (shop.tables || []).find((entry) => entry.id === order?.tableId)
  const totals = convertTotals(computeOrderTotals(order, menuById, settings), currency)
  const dueDate = new Date(Date.now() + Math.max(0, paymentTermsDays) * 86400000)

  return {
    kind: 'invoice',
    title: template.title,
    issuedAt: new Date().toISOString(),
    reference: order?.id || '',
    currency,
    seller: sellerBlock(settings),
    customer: {
      label: customerLabel(order, table),
      lines: [
        table ? `Table ${String(table.name).replace('Table ', '')} · ${table.zone}` : OFF_TABLE_LABEL[order?.type] || 'Counter order',
        order?.customer?.phone ? `Phone: ${order.customer.phone}` : '',
        order?.customer?.address ? `Deliver to: ${order.customer.address}` : '',
        order?.eta ? `ETA: ${new Date(order.eta).toLocaleString()}` : '',
        order?.serverId ? `Server: ${order.serverId}` : '',
        table?.partySize ? `Guests: ${table.partySize}` : '',
      ].filter(Boolean),
      dueDate: dueDate.toISOString(),
      paymentTerms: `${Math.max(0, paymentTermsDays)} days`,
    },
    lines: totals.lines,
    totals,
    payments: [],
    meta: {
      orderStatus: order?.status || 'open',
      openedAt: order?.createdAt || null,
      sentAt: order?.sentAt || null,
      covers: order?.covers || table?.partySize || null,
      notes: clampText(order?.notes, 240),
    },
  }
}

// ─── Receipt ───────────────────────────────────────────────────────

export function buildReceiptDocument({ shop, order, settings } = {}) {
  const template = templateFor(settings, 'receipt')
  const currency = documentCurrency(settings, template)
  const menuById = Object.fromEntries((shop.menu || []).map((item) => [item.id, item]))
  const table = (shop.tables || []).find((entry) => entry.id === order?.tableId)
  const computed = convertTotals(computeOrderTotals(order, menuById, settings), currency)
  const payments = (order?.payments || []).length
    ? order.payments
    : order?.status === 'paid'
      ? [{ method: order.payMethod || 'card', amount: computed.grandTotal }]
      : []
  const totals = convertTotals(computeOrderTotals(order, menuById, settings, { payments }), currency)

  return {
    kind: 'receipt',
    title: template.title,
    issuedAt: new Date().toISOString(),
    reference: order?.id || '',
    currency,
    seller: sellerBlock(settings),
    customer: {
      label: customerLabel(order, table),
      lines: [
        order?.customer?.phone ? `Phone: ${order.customer.phone}` : '',
        order?.customer?.address ? `Deliver to: ${order.customer.address}` : '',
        order?.eta ? `ETA: ${new Date(order.eta).toLocaleString()}` : '',
        order?.serverId ? `Server: ${order.serverId}` : '',
        order?.paidAt ? `Paid ${new Date(order.paidAt).toLocaleString()}` : '',
      ].filter(Boolean),
    },
    lines: totals.lines,
    totals,
    payments: totals.paid
      ? [{ method: order?.payMethod || payments[0]?.method || 'card', amount: totals.paid }]
      : [],
    meta: {
      orderStatus: order?.status || 'open',
      tip: totals.tip,
      split: order?.split || null,
      notes: '',
    },
  }
}

// ─── Kitchen ticket ────────────────────────────────────────────────

export function buildTicketDocument({ shop, order, settings, station = null } = {}) {
  const template = templateFor(settings, 'ticket')
  const currency = documentCurrency(settings, template)
  const menuById = Object.fromEntries((shop.menu || []).map((item) => [item.id, item]))
  const table = (shop.tables || []).find((entry) => entry.id === order?.tableId)

  const lines = orderBillable(order)
    .filter((item) => (station ? item.station === station : true))
    .slice(0, MAX_LINES)
    .map((item) => ({
      id: item.id,
      name: menuById[item.menuItemId]?.name || 'Unknown item',
      qty: Number(item.qty) || 0,
      modifiers: (item.modifiers || []).map((mod) => `${mod.id}: ${mod.value}`),
      notes: item.notes || '',
      station: item.station,
      course: item.course,
      status: item.status,
      guest: item.guest || null,
      firedAt: item.firedAt,
    }))

  const groups = template.groupByStation
    ? Object.values(lines.reduce((acc, line) => {
      const key = `${line.station}|${line.course}`
      acc[key] = acc[key] || { title: `${(line.station || 'expo').toUpperCase()} · ${(line.course || 'main').toUpperCase()}`, lines: [] }
      acc[key].lines.push(line)
      return acc
    }, {}))
    : [{ title: null, lines }]

  const firedTimes = lines.map((line) => line.firedAt).filter(Boolean).sort()

  return {
    kind: 'ticket',
    title: template.title,
    issuedAt: new Date().toISOString(),
    reference: order?.id || '',
    currency,
    seller: sellerBlock(settings),
    customer: {
      label: table ? table.name : customerLabel(order, table),
      lines: [
        table?.zone ? `Zone: ${table.zone}` : '',
        !table && OFF_TABLE_LABEL[order?.type] ? OFF_TABLE_LABEL[order.type] : '',
        !table && order?.customer?.phone ? `Phone: ${order.customer.phone}` : '',
        !table && order?.customer?.address ? `Deliver to: ${order.customer.address}` : '',
        order?.serverId ? `Server: ${order.serverId}` : '',
        order?.covers || table?.partySize ? `Guests: ${order?.covers || table?.partySize}` : '',
      ].filter(Boolean),
    },
    groups,
    lines,
    totals: { items: lines.reduce((sum, line) => sum + line.qty, 0) },
    meta: {
      station,
      orderStatus: order?.status || 'open',
      firedAt: firedTimes[0] || null,
      sentAt: order?.sentAt || null,
      copies: template.copies,
      reprint: true,
    },
  }
}

// ─── Shift report ──────────────────────────────────────────────────

function categoryOf(shop, menuItemId) {
  return (shop.menu || []).find((item) => item.id === menuItemId)?.category || 'Other'
}

/**
 * Aggregate the shift: sales, hourly curve, categories, service stats,
 * voids/comps, stock exceptions, and P&L-lite. Pure numbers — the
 * renderer formats them in the report's chosen currency.
 */
export function buildShiftReport(shop, { range = 'tonight', now = Date.now() } = {}) {
  // The buy side reads from the same engine the screens use, so the paper
  // and the screen can never disagree about what was bought or moved.
  const bounds = rangeBounds(range, now)
  const buys = purchaseSummary(shop, bounds)
  const stock = movementSummary(shop, bounds)
  const flow = stockFlow(shop, bounds)
  const ranks = itemRankings(shop, bounds, 6)
  const menuById = Object.fromEntries((shop.menu || []).map((item) => [item.id, item]))
  const invById = Object.fromEntries((shop.inventory || []).map((item) => [item.id, item]))
  const paid = (shop.orders || []).filter((order) => order.status === 'paid')
  const liveTotals = (shop.orders || [])
    .filter((order) => order.status !== 'void')
    .reduce((sum, order) => sum + computeOrderTotals(order, menuById, shop.settings || {}).total, 0)
  const paidSales = paid.reduce((sum, order) => sum + (Number(order.total) || 0), 0)
  const periodDays = range === '7d' ? 7 : range === '30d' ? 30 : 1
  const history = (shop.salesHistory || []).slice(-periodDays)
  const historySales = history.reduce((sum, day) => sum + (Number(day.sales) || 0), 0)
  const sales = range === 'tonight' ? Math.max(liveTotals, paidSales) : historySales + paidSales
  const covers = paid.reduce((sum, order) => sum + (Number(order.covers) || 2), 0)
  const avgCheck = paid.length ? sales / paid.length : 0

  const hourly = {}
  for (const order of shop.orders || []) {
    if (order.status === 'void') continue
    const hour = new Date(order.createdAt || Date.now()).getHours()
    const value = order.status === 'paid' ? Number(order.total) || 0 : computeOrderTotals(order, menuById, shop.settings || {}).total
    hourly[hour] = (hourly[hour] || 0) + value
  }

  const byCategory = {}
  const byItem = {}
  for (const order of shop.orders || []) {
    if (order.status === 'void') continue
    for (const item of orderBillable(order)) {
      const menu = menuById[item.menuItemId]
      if (!menu) continue
      const line = (Number(menu.price) || 0) * (Number(item.qty) || 0)
      const category = categoryOf(shop, item.menuItemId)
      byCategory[category] = (byCategory[category] || 0) + line
      byItem[item.menuItemId] = (byItem[item.menuItemId] || 0) + (Number(item.qty) || 0)
    }
  }

  // Food cost from the live recipe book (snapshots win when present)
  let foodCost = 0
  for (const order of shop.orders || []) {
    if (order.status === 'void') continue
    for (const item of orderBillable(order)) {
      const plate = item.recipeSnapshot?.plateCost ?? plateCostFor(shop.recipes?.[item.menuItemId], invById)
      foodCost += (Number(plate) || 0) * (Number(item.qty) || 0)
    }
  }

  const voidLines = (shop.orders || []).flatMap((order) =>
    (order.items || [])
      .filter((item) => item.voided || item.comped)
      .map((item) => ({
        orderId: order.id,
        name: menuById[item.menuItemId]?.name || item.menuItemId,
        qty: Number(item.qty) || 0,
        value: roundMoney((Number(menuById[item.menuItemId]?.price) || 0) * (Number(item.qty) || 0)),
        reason: item.voidReason || item.compReason || '—',
        kind: item.voided ? 'void' : 'comp',
      })),
  )

  const waste = (shop.wasteLog || []).reduce(
    (sum, entry) => sum + (Number(invById[entry.inventoryItemId]?.lastCost) || 0) * (Number(entry.qty) || 0),
    0,
  )
  const negativeStock = (shop.inventory || [])
    .filter((item) => Number(item.onHand) < 0)
    .map((item) => ({ name: item.name, onHand: item.onHand, unit: item.unit, value: roundMoney(Math.abs(item.onHand) * (item.lastCost || 0)) }))
  const stockExceptions = (shop.inventory || [])
    .map((item) => ({ item, status: stockStatusFor(item, shop.settings) }))
    .filter((row) => row.status !== 'ok')

  const bumped = (shop.orders || []).flatMap((order) => order.items || [])
    .filter((item) => item.status === 'bump' && item.firedAt && item.bumpedAt)
  const avgTicketMin = bumped.length
    ? bumped.reduce((sum, item) => sum + (new Date(item.bumpedAt) - new Date(item.firedAt)) / 60000, 0) / bumped.length
    : 0
  const turns = (shop.turnHistory || [])
  const avgTurn = turns.length ? turns.reduce((sum, turn) => sum + (Number(turn.minutes) || 0), 0) / turns.length : 0

  const sellers = Object.entries(byItem)
    .map(([menuItemId, qty]) => {
      const menu = menuById[menuItemId]
      const plate = plateCostFor(shop.recipes?.[menuItemId], invById)
      const contribution = menu?.price ? (menu.price - plate) / menu.price : 0
      return { name: menu?.name || menuItemId, qty, contribution, value: roundMoney((menu?.price || 0) * qty) }
    })
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8)

  return {
    range,
    generatedAt: new Date(now).toISOString(),
    kpis: [
      { label: 'Net sales', value: roundMoney(sales), sub: `${paid.length} paid checks` },
      { label: 'Covers', value: covers || paid.length * 2, sub: `${(turns.length ? covers / Math.max(1, turns.length) : 0).toFixed(1)} per turn` },
      { label: 'Average check', value: roundMoney(avgCheck), sub: `target 38–62` },
      { label: 'Food cost', value: roundMoney(foodCost), sub: sales ? `${((foodCost / sales) * 100).toFixed(1)}% of sales` : 'no sales yet' },
    ],
    hourly: Object.entries(hourly)
      .map(([hour, value]) => ({ hour: Number(hour), value: roundMoney(value) }))
      .sort((a, b) => a.hour - b.hour),
    byCategory: Object.entries(byCategory)
      .map(([label, value]) => ({ label, value: roundMoney(value) }))
      .sort((a, b) => b.value - a.value),
    byDay: history.map((day) => ({ label: day.day, value: roundMoney(day.sales), foodCostPct: day.foodCostPct })),
    service: {
      avgTicketMin,
      avgTurn,
      checks: paid.length,
      liveTickets: (shop.orders || []).filter((order) => !['paid', 'void'].includes(order.status)).length,
      late: (shop.orders || []).flatMap((order) => order.items || [])
        .filter((item) => item.status === 'fired' && item.firedAt
          && (now - new Date(item.firedAt).getTime()) / 60000 >= (shop.settings?.ticketMinutes || 18)).length,
    },
    voids: {
      lines: voidLines,
      value: roundMoney(voidLines.reduce((sum, line) => sum + line.value, 0)),
    },
    variance: {
      waste: roundMoney(waste),
      negativeStock,
      stockExceptions: stockExceptions.slice(0, 10).map((row) => ({ name: row.item.name, status: row.status, onHand: row.item.onHand, par: row.item.par, unit: row.item.unit })),
    },
    pnl: {
      sales: roundMoney(sales),
      foodCost: roundMoney(foodCost),
      foodPct: sales ? foodCost / sales : 0,
      waste: roundMoney(waste),
      comps: roundMoney(voidLines.filter((line) => line.kind === 'comp').reduce((sum, line) => sum + line.value, 0)),
      voids: roundMoney(voidLines.filter((line) => line.kind === 'void').reduce((sum, line) => sum + line.value, 0)),
      grossProfit: roundMoney(sales - foodCost),
      netAfterWaste: roundMoney(sales - foodCost - waste),
    },
    sellers,
    // Buy side: what left the bank, from whom, and what the store room did
    // in the same window.
    purchases: {
      spend: buys.spend,
      orders: buys.orders,
      quickReceipts: buys.quickReceipts,
      openValue: buys.openValue,
      openOrders: buys.openOrders.slice(0, 8),
      suppliers: buys.bySupplier.slice(0, 8),
      items: buys.byItem.slice(0, 8),
    },
    stock: {
      inValue: stock.inValue,
      outValue: stock.outValue,
      netValue: stock.netValue,
      openingValue: stock.openingValue,
      inUnits: stock.inUnits,
      outUnits: stock.outUnits,
      byKind: stock.byKind,
      flow: flow.slice(0, 10).map((row) => ({
        name: row.name, unit: row.unit, opening: row.opening, inQty: row.inQty,
        outQty: row.outQty, onHand: row.onHand, bookValue: row.bookValue,
      })),
    },
    topLow: {
      sellByRevenue: ranks.sell.byRevenue,
      sellByMargin: ranks.sell.byMargin,
      sellWorst: ranks.sell.worst,
      unsoldCount: ranks.sell.unsoldCount,
      buyBySpend: ranks.buy.bySpend,
      buyByQty: ranks.buy.byQty,
    },
    inventoryValue: roundMoney((shop.inventory || []).reduce((sum, item) => sum + Math.max(0, Number(item.onHand) || 0) * (Number(item.lastCost) || 0), 0)),
  }
}

/**
 * A purchase order is the same paper as an invoice with the parties
 * swapped: the house is the buyer, the supplier is the vendor, and the
 * lines are what is being ordered. Quantities carry what has already
 * arrived, so a partially delivered order can be re-sent as-is.
 */
export function buildPurchaseOrderDocument({ shop, purchase, settings } = {}) {
  const template = templateFor(settings, 'purchase')
  const currency = documentCurrency(settings, template)
  const supplier = (shop.suppliers || []).find((entry) => entry.id === purchase?.supplierId)
  const inventoryById = Object.fromEntries((shop.inventory || []).map((item) => [item.id, item]))

  const lines = (purchase?.lines || []).map((line) => {
    const item = inventoryById[line.inventoryItemId]
    const qty = Number(line.qty) || 0
    const unitCost = Number(line.unitCost) || 0
    const received = Number(line.receivedQty) || 0
    return {
      id: line.id,
      name: line.name || item?.name || 'Item',
      sku: item?.sku || '',
      unit: line.unit || item?.unit || '',
      qty,
      receivedQty: received,
      backorderQty: Math.max(0, Math.round((qty - received) * 1000) / 1000),
      unitPrice: unitCost,
      lineTotal: roundMoney(qty * unitCost),
      notes: received > 0 && received < qty ? `${received} of ${qty} received` : '',
    }
  })

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0))
  const tax = roundMoney(Number(purchase?.tax) || 0)
  const shipping = roundMoney(Number(purchase?.shipping) || 0)

  return {
    kind: 'purchase',
    title: template.title,
    issuedAt: new Date().toISOString(),
    number: purchase?.number || '',
    reference: purchase?.reference || purchase?.id || '',
    currency,
    seller: sellerBlock(settings),
    partyLabels: { left: 'Vendor', right: 'Deliver to' },
    customer: {
      label: purchase?.vendor || supplier?.name || 'Unassigned vendor',
      lines: [
        supplier?.contact ? `Contact: ${supplier.contact}` : '',
        supplier?.email || '',
        supplier?.phone || '',
        purchase?.reference ? `Their ref: ${purchase.reference}` : '',
      ].filter(Boolean),
    },
    delivery: {
      expectedAt: purchase?.expectedAt || null,
      orderedAt: purchase?.orderedAt || null,
      receivedAt: purchase?.receivedAt || null,
      status: purchase?.status || 'draft',
      location: settings.restaurantName,
      addressLines: (settings.addressLines || []).filter(Boolean),
    },
    lines,
    totals: {
      subtotal,
      tax,
      taxPct: Number(settings.taxPct) || 0,
      taxLabel: settings.taxLabel || 'Tax',
      shipping,
      grandTotal: roundMoney(subtotal + tax + shipping),
    },
    payments: [],
    meta: {
      status: purchase?.status || 'draft',
      note: clampText(purchase?.note, 240),
      createdBy: purchase?.createdBy || '',
    },
  }
}

export function buildReportDocument({ shop, settings, report, range = 'tonight' } = {}) {
  const template = templateFor(settings, 'report')
  const currency = documentCurrency(settings, template)
  const data = report || buildShiftReport(shop, { range })
  return {
    kind: 'report',
    title: template.title,
    issuedAt: data.generatedAt,
    reference: `${settings.restaurantName} · ${range}`,
    currency,
    seller: sellerBlock(settings),
    customer: { label: settings.restaurantName, lines: [settings.locationShort ? `Location: ${settings.locationShort}` : ''] },
    report: data,
    totals: { sales: data.pnl.sales },
    lines: [],
    payments: [],
    meta: { range },
  }
}

// ─── HTML rendering (print / PDF / email) ──────────────────────────

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function addressHtml(lines) {
  return lines.filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join('')
}

function modifiersHtml(line) {
  return (line.modifiers || []).map((mod) => `<div class="mod">${escapeHtml(mod)}</div>`).join('')
}

function moneyCell(value, currency) {
  return `<td class="num">${escapeHtml(money(value, currency))}</td>`
}

function lineRows(lines, template, currency) {
  return lines.map((line) => `
    <tr>
      <td class="item">
        <span class="qty">${line.qty}×</span> ${escapeHtml(line.name)}
        ${template.showSku && line.sku ? `<span class="sku">${escapeHtml(line.sku)}</span>` : ''}
        ${template.showModifiers ? modifiersHtml(line) : ''}
        ${line.notes ? `<div class="note">↳ ${escapeHtml(line.notes)}</div>` : ''}
      </td>
      ${template.showUnitPrice ? moneyCell(line.unitPrice, currency) : ''}
      ${moneyCell(line.lineTotal, currency)}
    </tr>`).join('')
}

function totalsRows(doc, template) {
  const t = doc.totals
  const rows = []
  rows.push(`<tr><td>Subtotal</td><td class="num">${escapeHtml(money(t.subtotal, doc.currency))}</td></tr>`)
  if (template.showDiscount && t.discount) {
    rows.push(`<tr><td>Discount${t.discountPct ? ` (${(t.discountPct * 100).toFixed(0)}%)` : ''}</td><td class="num">−${escapeHtml(money(t.discount, doc.currency))}</td></tr>`)
  }
  if (template.showServiceCharge && t.service) {
    rows.push(`<tr><td>${escapeHtml(doc.serviceLabel || 'Service charge')} (${((t.servicePct || 0) * 100).toFixed(1)}%)</td><td class="num">${escapeHtml(money(t.service, doc.currency))}</td></tr>`)
  }
  if (template.showTaxBreakdown && t.tax) {
    rows.push(`<tr><td>${escapeHtml(t.taxLabel)} (${((t.taxPct || 0) * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%)</td><td class="num">${escapeHtml(money(t.tax, doc.currency))}</td></tr>`)
  }
  if (t.shipping) {
    rows.push(`<tr><td>Delivery</td><td class="num">${escapeHtml(money(t.shipping, doc.currency))}</td></tr>`)
  }
  if (t.delivery) {
    rows.push(`<tr><td>Delivery</td><td class="num">${escapeHtml(money(t.delivery, doc.currency))}</td></tr>`)
  }
  if (t.rounding) {
    rows.push(`<tr><td>Rounding</td><td class="num">${escapeHtml(money(t.rounding, doc.currency))}</td></tr>`)
  }
  if (template.showTipLine && t.tip) {
    rows.push(`<tr><td>Tip</td><td class="num">${escapeHtml(money(t.tip, doc.currency))}</td></tr>`)
  }
  return rows.join('')
}

/** Full standalone HTML for one document — safe for iframe print or download. */
export function renderDocumentHtml(doc, settings, options = {}) {
  const template = templateFor(settings, options.templateKind ? options.templateKind : doc.kind)
  const paper = PAPER_SIZES[template.paper] || PAPER_SIZES.a4
  const theme = options.theme === 'dark' ? 'dark' : 'light'
  const qr = options.qrDataUrl
  const accent = template.accent
  const fontPx = (paper.roll ? 11 : 12.5) * template.fontScale
  const issued = new Date(doc.issuedAt)
  const dateLabel = issued.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  // The document is a standalone string: it can be printed inside the app's
  // iframe (same origin, so the vendored fonts are reachable) or downloaded and
  // opened elsewhere (no origin, so the stack falls back to the OS faces).
  const faces = fontFaceCss(options.fontBase === undefined ? fontBase() : options.fontBase)
  const currencyNote = doc.currency?.fx && doc.currency.fx !== 1
    ? `Converted to ${doc.currency.code} at 1 ${doc.currency.baseCode} = ${doc.currency.fx} ${doc.currency.code}`
    : ''

  const header = `
    <header class="doc-head">
      ${template.showLogo !== false ? (doc.seller.logoUrl
        ? `<img class="logo" src="${escapeHtml(doc.seller.logoUrl)}" alt="${escapeHtml(doc.seller.name)} logo" />`
        : `<div class="monogram" style="background:${escapeHtml(accent)}">${escapeHtml(doc.seller.initials)}</div>`) : ''}
      <div class="head-copy">
        <h1>${escapeHtml(doc.seller.name)}</h1>
        ${template.showCompany ? `
          ${doc.seller.legalName ? `<div class="legal">${escapeHtml(doc.seller.legalName)}</div>` : ''}
          <div class="addr">${addressHtml(doc.seller.addressLines)}</div>
          <div class="contact">${[doc.seller.phone, doc.seller.email, doc.seller.website].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          ${doc.seller.taxId ? `<div class="taxid">Tax ID: ${escapeHtml(doc.seller.taxId)}</div>` : ''}
        ` : ''}
        ${template.headerText ? `<div class="header-note">${escapeHtml(template.headerText)}</div>` : ''}
      </div>
      <div class="doc-badge">
        <div class="doc-title">${escapeHtml(doc.title || template.title)}</div>
        <div class="doc-number">${escapeHtml(doc.number || '—')}</div>
        <div class="doc-date">${escapeHtml(dateLabel)}</div>
      </div>
    </header>`

  const partyRow = (template.showCustomer && doc.customer) ? `
    <section class="parties">
      <div><span class="label">${escapeHtml(doc.partyLabels?.left || 'Billed to')}</span><div class="value">${escapeHtml(doc.customer.label)}</div>${addressHtml(doc.customer.lines || [])}</div>
      <div><span class="label">${escapeHtml(doc.partyLabels?.right || 'Served by')}</span><div class="value">${escapeHtml(doc.delivery?.location || doc.meta?.serverLabel || doc.customer.lines?.[0] || 'Restora team')}</div>${addressHtml(doc.delivery?.addressLines || [])}${doc.customer.dueDate ? `<div class="muted">Due ${escapeHtml(new Date(doc.customer.dueDate).toLocaleDateString())}</div>` : ''}</div>
    </section>` : ''

  const poStrip = doc.kind === 'purchase' ? `
    <section class="po-strip">
      <div><span class="label">Status</span><div class="value">${escapeHtml(String(doc.delivery?.status || 'draft').replace(/^./, (c) => c.toUpperCase()))}</div></div>
      <div><span class="label">Ordered</span><div class="value">${escapeHtml(doc.delivery?.orderedAt ? new Date(doc.delivery.orderedAt).toLocaleDateString() : '—')}</div></div>
      <div><span class="label">Expected</span><div class="value">${escapeHtml(doc.delivery?.expectedAt ? new Date(doc.delivery.expectedAt).toLocaleDateString() : '—')}</div></div>
      <div><span class="label">Received</span><div class="value">${escapeHtml(doc.delivery?.receivedAt ? new Date(doc.delivery.receivedAt).toLocaleDateString() : '—')}</div></div>
    </section>
    <section class="note-line">${doc.meta?.note ? `Order note: ${escapeHtml(doc.meta.note)}` : ''}</section>` : ''

  const body = doc.kind === 'ticket' ? renderTicketBody(doc, template) : `
    <table class="lines">
      <thead><tr><th>Item</th>${template.showUnitPrice ? '<th class="num">Unit</th>' : ''}<th class="num">Amount</th></tr></thead>
      <tbody>${lineRows(doc.lines, template, doc.currency)}</tbody>
    </table>
    <section class="totals">
      <table>${totalsRows(doc, template)}<tr class="grand"><td>Total</td><td class="num">${escapeHtml(money(doc.totals.grandTotal, doc.currency))}</td></tr></table>
      ${template.showPayments && doc.payments?.length ? `<table class="payments">${doc.payments.map((p) => `<tr><td>Paid · ${escapeHtml(p.method)}</td><td class="num">${escapeHtml(money(p.amount, doc.currency))}</td></tr>`).join('')}${doc.totals.change ? `<tr><td>Change</td><td class="num">${escapeHtml(money(doc.totals.change, doc.currency))}</td></tr>` : ''}${doc.totals.balance ? `<tr class="due"><td>Balance due</td><td class="num">${escapeHtml(money(doc.totals.balance, doc.currency))}</td></tr>` : ''}</table>` : ''}
    </section>`

  const reportBody = doc.kind === 'report' ? renderReportBody(doc, template, options) : ''

  return `<!doctype html>
<html lang="${options.lang || 'en'}"><head><meta charset="utf-8" />
<title>${escapeHtml(`${doc.title || template.title} ${doc.number || ''}`.trim())}</title>
<style>
${faces}
  @page { size: ${paper.roll ? `${paper.pageWidthMm}mm auto` : `A4 ${options.orientation === 'landscape' ? 'landscape' : 'portrait'}`}; margin: ${paper.roll ? '3mm' : '14mm'}; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: ${paper.roll ? '4mm' : '10mm'}; background: ${theme === 'dark' ? '#0b0d12' : '#f4f5f7'};
         font-family: ${SANS_STACK}; color: #1f2328; font-size: ${fontPx}px; }
  .sheet { width: ${paper.widthMm}mm; margin: 0 auto; background: #fff; padding: ${paper.roll ? '4mm 3mm' : '12mm'};
           border-radius: ${paper.roll ? '2mm' : '3mm'}; box-shadow: 0 6px 24px rgba(15,20,30,.10); position: relative; }
  .doc-head { display: flex; align-items: flex-start; gap: 10px; border-bottom: 2px solid ${accent}; padding-bottom: 8px; }
  .logo { max-width: 92px; max-height: 64px; object-fit: contain; }
  .monogram { width: 44px; height: 44px; border-radius: 10px; color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; font-size: 16px; }
  .head-copy { flex: 1; min-width: 0; }
  .head-copy h1 { margin: 0; font-size: 1.15em; letter-spacing: -0.01em; }
  .legal { font-size: .78em; color: #555c66; }
  .addr, .contact { font-size: .78em; color: #555c66; line-height: 1.35; }
  .taxid { font-size: .72em; color: #6b7280; margin-top: 2px; }
  .header-note { margin-top: 4px; font-size: .8em; font-style: italic; color: #444b55; }
  .doc-badge { text-align: right; }
  .doc-title { font-weight: 800; letter-spacing: .14em; font-size: .95em; color: ${accent}; }
  .doc-number { font-family: ${MONO_STACK}; font-size: .85em; }
  .doc-date { font-size: .75em; color: #6b7280; }
  .po-strip { display: flex; gap: 10px; margin: 10px 0 4px; }
  .po-strip > div { flex: 1; border: 1px solid #e6e8eb; border-radius: 6px; padding: 5px 8px; background: #fafbfc; }
  .note-line { font-size: .82em; color: #444b55; margin-bottom: 8px; min-height: 1em; }
  .parties { display: flex; gap: 12px; margin: 10px 0; }
  .parties > div { flex: 1; border: 1px solid #e6e8eb; border-radius: 6px; padding: 6px 8px; }
  .label { display: block; font-size: .68em; letter-spacing: .1em; text-transform: uppercase; color: #78808b; }
  .value { font-weight: 700; font-size: .92em; }
  .muted { color: #6b7280; font-size: .78em; }
  table { width: 100%; border-collapse: collapse; }
  .lines th { text-align: left; font-size: .68em; letter-spacing: .08em; text-transform: uppercase; color: #78808b; border-bottom: 1px solid #e6e8eb; padding: 5px 4px; }
  .lines td { padding: 5px 4px; border-bottom: 1px dashed #eceef1; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .item .qty { font-weight: 700; }
  .item .sku { margin-left: 6px; font-family: ${MONO_STACK}; font-size: .75em; color: #78808b; }
  .mod { font-size: .78em; color: #4b5159; }
  .note { font-size: .78em; font-style: italic; color: #8a5a2b; }
  .totals { margin-top: 10px; width: 58%; margin-left: auto; }
  .totals td { padding: 3px 4px; font-size: .88em; }
  .totals tr.grand td { border-top: 2px solid ${accent}; font-size: 1.05em; font-weight: 800; }
  .totals tr.due td { font-weight: 700; color: #b23b3b; }
  .ticket-group { margin-bottom: 8px; }
  .ticket-group h3 { margin: 0 0 4px; font-size: .78em; letter-spacing: .12em; text-transform: uppercase; border-bottom: 1px dashed #b9bec6; }
  .ticket-line { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; font-size: 1.05em; }
  .ticket-line .qty { font-weight: 800; }
  .report-section { margin-top: 12px; page-break-inside: avoid; }
  .report-section h2 { font-size: .8em; letter-spacing: .12em; text-transform: uppercase; color: #6b7280; margin: 0 0 6px; border-bottom: 1px solid #e6e8eb; padding-bottom: 3px; }
  .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .kpi { border: 1px solid #e6e8eb; border-radius: 6px; padding: 6px 8px; }
  .kpi .k { display: block; font-size: .68em; text-transform: uppercase; letter-spacing: .08em; color: #78808b; }
  .kpi .v { font-weight: 800; font-size: 1.15em; font-variant-numeric: tabular-nums; }
  .kpi .s { font-size: .72em; color: #6b7280; }
  .bars { display: grid; gap: 4px; }
  .bar-row { display: grid; grid-template-columns: 84px 1fr 68px; gap: 6px; align-items: center; font-size: .82em; }
  .bar { height: 8px; border-radius: 4px; background: ${accent}; opacity: .85; }
  .bar-track { background: #eef0f3; border-radius: 4px; overflow: hidden; }
  .foot { margin-top: 12px; border-top: 1px solid #e6e8eb; padding-top: 8px; font-size: .78em; color: #555c66; display: flex; justify-content: space-between; gap: 12px; }
  .qr { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .qr img { width: 74px; height: 74px; }
  .signature { margin-top: 18px; border-top: 1px solid #b9bec6; width: 55%; padding-top: 4px; font-size: .78em; color: #6b7280; }
  .fx { font-size: .72em; color: #6b7280; margin-top: 4px; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; width: auto; margin: 0; } }
</style></head>
<body>
  <div class="sheet">
    ${header}
    ${partyRow}
    ${poStrip}${body}
    ${reportBody}
    ${doc.customer?.dueDate && doc.kind === 'invoice' ? `<div class="foot"><div>Payment terms: ${escapeHtml(doc.customer.paymentTerms || '')} · due ${escapeHtml(new Date(doc.customer.dueDate).toLocaleDateString())}</div><div>${escapeHtml(template.termsText || '')}</div></div>` : ''}
    ${template.thankYou ? `<div class="foot"><div>${escapeHtml(template.thankYou)}</div><div>${escapeHtml(template.footerText || '')}</div></div>` : (template.footerText ? `<div class="foot"><div>${escapeHtml(template.footerText)}</div></div>` : '')}
    ${currencyNote ? `<div class="fx">${escapeHtml(currencyNote)}</div>` : ''}
    ${qr ? `<div class="qr"><img src="${qr}" alt="QR code" /><div class="muted">${escapeHtml(options.qrCaption || 'Scan for the digital copy')}</div></div>` : ''}
    ${template.showSignature ? `<div class="signature">${escapeHtml(template.signatureLabel || 'Authorized by')} · ${escapeHtml(settings.restaurantName || '')}</div>` : ''}
    ${template.showBankDetails && template.bankDetails ? `<div class="foot"><div>${escapeHtml(template.bankDetails)}</div></div>` : ''}
  </div>
</body></html>`
}

function renderTicketBody(doc, template) {
  const groups = doc.groups?.length ? doc.groups : [{ title: null, lines: doc.lines }]
  return groups.map((group) => `
    <section class="ticket-group">
      ${group.title ? `<h3>${escapeHtml(group.title)}</h3>` : ''}
      ${group.lines.map((line) => `
        <div class="ticket-line">
          <span><span class="qty">${line.qty}×</span> ${escapeHtml(line.name)}
            ${template.showModifiers ? modifiersHtml(line) : ''}
            ${template.showGuestNotes && line.guest ? `<div class="note">Guest: ${escapeHtml(line.guest)}</div>` : ''}
            ${template.showGuestNotes && line.notes ? `<div class="note">↳ ${escapeHtml(line.notes)}</div>` : ''}
          </span>
          ${template.showPrices ? `<span class="num">${escapeHtml(money(line.lineTotal || 0, doc.currency))}</span>` : ''}
        </div>`).join('')}
    </section>`).join('')
}

function renderReportBody(doc, template, options) {
  const report = doc.report
  if (!report) return ''
  const baseCurrency = doc.currency?.baseCode || doc.currency?.code
  const cur = doc.currency?.fx === 1 ? baseCurrency : doc.currency
  const conv = (value) => (doc.currency?.fx && doc.currency.fx !== 1
    ? roundMoney(convertAmount(value, baseCurrency, doc.currency.code, {
      baseCurrency,
      currencies: [{ code: doc.currency.code, rate: doc.currency.rate, enabled: true }],
    }), doc.currency.decimals)
    : value)
  const fmt = (value) => escapeHtml(money(conv(value), typeof cur === 'string' ? { ...doc.currency, rate: 1 } : cur))

  const barRow = (label, value, max) => `
    <div class="bar-row"><span>${escapeHtml(label)}</span>
      <span class="bar-track"><span class="bar" style="width:${Math.max(3, (value / Math.max(max, 0.01)) * 100)}%;display:block"></span></span>
      <span class="num">${fmt(value)}</span></div>`

  const sections = []
  sections.push(`<section class="report-section"><h2>Shift summary</h2><div class="kpis">
    ${report.kpis.map((kpi) => `<div class="kpi"><span class="k">${escapeHtml(kpi.label)}</span><span class="v">${kpi.label === 'Covers' ? escapeHtml(kpi.value) : fmt(kpi.value)}</span><span class="s">${escapeHtml(kpi.sub || '')}</span></div>`).join('')}
  </div></section>`)

  if (template.showHourly && report.hourly.length) {
    const max = Math.max(...report.hourly.map((row) => row.value))
    sections.push(`<section class="report-section"><h2>Sales by hour</h2><div class="bars">
      ${report.hourly.map((row) => barRow(`${String(row.hour).padStart(2, '0')}:00`, row.value, max)).join('')}
    </div></section>`)
  }
  if (template.showCategories && report.byCategory.length) {
    const max = Math.max(...report.byCategory.map((row) => row.value))
    sections.push(`<section class="report-section"><h2>Sales by category</h2><div class="bars">
      ${report.byCategory.map((row) => barRow(row.label, row.value, max)).join('')}
    </div></section>`)
  }
  if (template.showComparison && report.byDay.length) {
    const max = Math.max(...report.byDay.map((row) => row.value))
    sections.push(`<section class="report-section"><h2>Day over day</h2><div class="bars">
      ${report.byDay.map((row) => barRow(row.label, row.value, max)).join('')}
    </div></section>`)
  }
  if (template.showService) {
    sections.push(`<section class="report-section"><h2>Service</h2><table>
      <tr><td>Average fire-to-bump</td><td class="num">${report.service.avgTicketMin.toFixed(1)} min</td></tr>
      <tr><td>Average turn</td><td class="num">${report.service.avgTurn.toFixed(1)} min</td></tr>
      <tr><td>Paid checks</td><td class="num">${report.service.checks}</td></tr>
      <tr><td>Live tickets at cut</td><td class="num">${report.service.liveTickets}</td></tr>
      <tr><td>Late items</td><td class="num">${report.service.late}</td></tr>
    </table></section>`)
  }
  if (template.showVoids) {
    sections.push(`<section class="report-section"><h2>Voids &amp; comps · ${fmt(report.voids.value)}</h2>
      ${report.voids.lines.length ? `<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Value</th><th>Reason</th></tr></thead><tbody>
        ${report.voids.lines.slice(0, 12).map((line) => `<tr><td>${escapeHtml(line.name)} <span class="muted">(${escapeHtml(line.kind)})</span></td><td class="num">${line.qty}</td><td class="num">${fmt(line.value)}</td><td>${escapeHtml(line.reason)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="muted">No voids or comps tonight.</div>'}
    </section>`)
  }
  if (template.showVariance) {
    sections.push(`<section class="report-section"><h2>Stock variance</h2><table>
      <tr><td>Waste logged</td><td class="num">${fmt(report.variance.waste)}</td></tr>
      ${report.variance.negativeStock.map((row) => `<tr><td>${escapeHtml(row.name)} negative on-hand</td><td class="num">${row.onHand} ${escapeHtml(row.unit)} · ${fmt(row.value)}</td></tr>`).join('')}
    </table>
    ${report.variance.stockExceptions.length ? `<table><thead><tr><th>Exception</th><th class="num">On hand</th><th class="num">Par</th></tr></thead><tbody>
      ${report.variance.stockExceptions.map((row) => `<tr><td>${escapeHtml(row.name)} <span class="muted">${escapeHtml(row.status)}</span></td><td class="num">${row.onHand} ${escapeHtml(row.unit)}</td><td class="num">${row.par}</td></tr>`).join('')}
    </tbody></table>` : ''}
    </section>`)
  }
  if (template.showTopSellers && report.sellers.length) {
    sections.push(`<section class="report-section"><h2>Top sellers</h2><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Sales</th><th class="num">Contribution</th></tr></thead><tbody>
      ${report.sellers.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="num">${row.qty}</td><td class="num">${fmt(row.value)}</td><td class="num">${(row.contribution * 100).toFixed(1)}%</td></tr>`).join('')}
    </tbody></table></section>`)
  }
  if (template.showPnl) {
    const pnl = report.pnl
    sections.push(`<section class="report-section"><h2>P&amp;L-lite</h2><table>
      <tr><td>Net sales</td><td class="num">${fmt(pnl.sales)}</td></tr>
      <tr><td>Food cost (recipe book)</td><td class="num">−${fmt(pnl.foodCost)}</td></tr>
      <tr><td>Gross profit</td><td class="num">${fmt(pnl.grossProfit)}${pnl.foodPct ? ` <span class="muted">(${((1 - pnl.foodPct) * 100).toFixed(1)}%)</span>` : ''}</td></tr>
      <tr><td>Waste</td><td class="num">−${fmt(pnl.waste)}</td></tr>
      <tr><td>Comps + voids</td><td class="num">−${fmt(pnl.comps + pnl.voids)}</td></tr>
      <tr class="grand"><td>Net after waste</td><td class="num">${fmt(pnl.netAfterWaste)}</td></tr>
    </table></section>`)
  }
  if (template.showPurchases !== false && report.purchases && (report.purchases.spend || report.purchases.openOrders.length)) {
    const buy = report.purchases
    sections.push(`<section class="report-section"><h2>Buying · ${fmt(buy.spend)}</h2>
      <table>
        <tr><td>Receipts booked</td><td class="num">${buy.orders} · ${fmt(buy.spend)}</td></tr>
        <tr><td>Quick receipts at the door</td><td class="num">${buy.quickReceipts}</td></tr>
        <tr><td>Still on order</td><td class="num">${buy.openOrders.length} · ${fmt(buy.openValue)}</td></tr>
      </table>
      ${buy.suppliers.length ? `<table><thead><tr><th>Supplier</th><th class="num">Orders</th><th class="num">Spend</th></tr></thead><tbody>
        ${buy.suppliers.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="num">${row.orders}</td><td class="num">${fmt(row.value)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${buy.items.length ? `<table><thead><tr><th>Bought</th><th class="num">Qty</th><th class="num">Cost</th></tr></thead><tbody>
        ${buy.items.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="num">${row.qty}</td><td class="num">${fmt(row.value)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      <div class="muted">Newest receipt ${buy.orders ? 'booked' : 'none'} · ${buy.openOrders.length} order(s) awaiting delivery.</div>
    </section>`)
  }
  if (template.showStockFlow !== false && report.stock) {
    const stock = report.stock
    sections.push(`<section class="report-section"><h2>Stock in / out · net ${fmt(stock.netValue)}</h2>
      <table>
        <tr><td>Stock in</td><td class="num">${fmt(stock.inValue)} <span class="muted">(${stock.inUnits} units)</span></td></tr>
        <tr><td>Stock out</td><td class="num">−${fmt(stock.outValue)} <span class="muted">(${stock.outUnits} units)</span></td></tr>
        <tr><td>Opening baseline (excluded)</td><td class="num">${fmt(stock.openingValue)}</td></tr>
      </table>
      ${stock.byKind.length ? `<table><thead><tr><th>Reason</th><th>Direction</th><th class="num">Movements</th><th class="num">Value</th></tr></thead><tbody>
        ${stock.byKind.map((row) => `<tr><td>${escapeHtml(row.kind)}${row.baseline ? ' <span class="muted">(baseline)</span>' : ''}</td><td>${row.baseline ? 'baseline' : row.kind === 'buy' || row.kind === 'return' || row.kind === 'opening' ? 'in' : 'out'}</td><td class="num">${row.count}</td><td class="num">${fmt(row.value)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${stock.flow.length ? `<table><thead><tr><th>Item</th><th class="num">Opening</th><th class="num">In</th><th class="num">Out</th><th class="num">On hand</th></tr></thead><tbody>
        ${stock.flow.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="num">${row.opening}</td><td class="num">${row.inQty}</td><td class="num">${row.outQty}</td><td class="num">${row.onHand} ${escapeHtml(row.unit || '')}</td></tr>`).join('')}
      </tbody></table>` : '<div class="muted">No stock moved in this window.</div>'}
    </section>`)
  }
  if (template.showTopLow !== false && report.topLow) {
    const top = report.topLow
    const rowsFor = (title, rows, valueOf) => (rows?.length ? `<table><thead><tr><th>${escapeHtml(title)}</th><th class="num">Qty</th><th class="num">Value</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="num">${row.qty}</td><td class="num">${fmt(valueOf(row))}</td></tr>`).join('')}
    </tbody></table>` : '')
    sections.push(`<section class="report-section"><h2>Top &amp; bottom</h2>
      ${rowsFor('Best sellers · revenue', top.sellByRevenue, (row) => row.revenue)}
      ${rowsFor('Best movers · units', top.sellByMargin, (row) => row.margin)}
      ${rowsFor('Weakest sellers', top.sellWorst, (row) => row.margin)}
      ${rowsFor('Biggest buys', top.buyBySpend, (row) => row.value)}
      <div class="muted">${top.unsoldCount} menu item(s) sold nothing in this window.</div>
    </section>`)
  }
  if (template.showNotes && options.notes) {
    sections.push(`<section class="report-section"><h2>Notes</h2><div>${escapeHtml(options.notes)}</div></section>`)
  }
  return sections.join('')
}

/** `invoice-INV-2026-01041-restora-downtown.html` */
export function documentFileName(doc, settings) {
  const slug = String(settings?.restaurantName || 'restora')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${doc.kind}-${doc.number || 'draft'}-${slug}.html`.toLowerCase()
}

// ─── Browser print helpers (no-ops outside the browser) ────────────

/** Print HTML through a hidden iframe; falls back to opening a tab. */
export function printHtml(html, { title = 'Document' } = {}) {
  if (typeof document === 'undefined') return false
  const frame = document.createElement('iframe')
  frame.setAttribute('title', title)
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.srcdoc = html
  frame.onload = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch {
      openHtmlWindow(html, title)
    }
    // Keep the frame alive just long enough for the print dialog to read
    // it, then clean up. A long grace period used to leave a 60s timer
    // running on the page (and in every test that prints).
    window.setTimeout(() => frame.remove(), 1500)
  }
  document.body.appendChild(frame)
  return true
}

function openHtmlWindow(html, title) {
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(html)
  win.document.title = title
  win.document.close()
  return true
}

/** Download a document as a self-contained HTML file (works offline). */
export function downloadHtml(html, filename) {
  if (typeof document === 'undefined') return false
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return true
}

export { DOC_KIND_META, computeOrderTotals as orderCharges }
