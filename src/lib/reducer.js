// ─── Restora reducer (shared) ─────────────────────────────────────
// Pure business logic: the SAME code runs in the browser and on the
// Express server. No React, no DOM — safe to import from Node.
// The ticket stays the system of record on every terminal.

import { DELIVERY_STATUS_META, STATIONS, TARGETS } from './constants.js'
import { packFactor, sanitizePackList, slugUnitId } from './units.js'
import {
  applyAuto86,
  assertTableTransition,
  canTicketTransition,
  costingFor,
  findAvailableTablesForSlot,
  isTableAvailable,
  minutesBetween,
  money,
  orderCharges,
  orderStatusFromItems,
  plateCostFor,
  quoteWaitMinutes,
  reorderPointFor,
  stockStatusFor,
  suggestedOrderQty,
  theoreticalDecrementFor,
  ticketAgeState,
  uid,
} from './models.js'
import { currencyMeta, roundMoney } from './currency.js'
import {
  DOC_KINDS,
  categoryById,
  descendantCategoryIds,
  defaultSettings,
  documentNumber,
  sanitizeSettings,
  sanitizeSupplier,
  sanitizeTemplate,
  MAX_IMAGE_CHARS,
  sanitizeImageRef,
} from './settings.js'
import { buildSeed, buildSeedRiverside } from './seed.js'

export { buildSeed, buildSeedRiverside }

const MAX_MENU_PRICE = 999999.99

/** Round a stock quantity to the configured precision (0–4 decimals). */
function roundQty(value, precision = 2) {
  const digits = Math.max(0, Math.min(4, Math.trunc(Number(precision) || 0)))
  const factor = 10 ** digits
  return Math.round((Number(value) || 0) * factor) / factor
}

/** Merge a settings patch section-by-section, then sanitize the result. */
function mergeSettings(current, patch) {
  const merged = {
    ...current,
    ...patch,
    stock: { ...current.stock, ...(patch.stock || {}) },
    pos: { ...current.pos, ...(patch.pos || {}) },
    booking: { ...current.booking, ...(patch.booking || {}) },
    notifications: { ...current.notifications, ...(patch.notifications || {}) },
    telegram: { ...current.telegram, ...(patch.telegram || {}) },
    numbering: { ...current.numbering, ...(patch.numbering || {}) },
    templates: { ...current.templates, ...(patch.templates || {}) },
    dashboard: { ...current.dashboard, ...(patch.dashboard || {}) },
    currencies: Array.isArray(patch.currencies) ? patch.currencies : current.currencies,
  }
  const settings = sanitizeSettings(merged, current.restaurantName)
  settings.updatedAt = new Date().toISOString()
  settings.updatedBy = patch.updatedBy || 'owner'
  return settings
}

/** Keep an issued document small, printable, and free of surprises. */
function sanitizeDocument(raw, kind, number, id) {
  const positive = (value) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000000) / 1000000 : 0
  }
  return {
    id,
    kind,
    number,
    title: String(raw?.title ?? '').slice(0, 40),
    issuedAt: new Date().toISOString(),
    reference: String(raw?.reference ?? '').slice(0, 80),
    currency: {
      code: String(raw?.currency?.code ?? 'USD').slice(0, 6),
      symbol: String(raw?.currency?.symbol ?? '$').slice(0, 6),
      decimals: Math.max(0, Math.min(4, Math.trunc(Number(raw?.currency?.decimals) || 2))),
      rate: positive(raw?.currency?.rate) || 1,
      baseCode: String(raw?.currency?.baseCode ?? 'USD').slice(0, 6),
    },
    totals: Object.fromEntries(
      Object.entries(raw?.totals || {}).map(([key, value]) => [key, positive(value)]),
    ),
    lines: (Array.isArray(raw?.lines) ? raw.lines : []).slice(0, 80).map((line) => ({
      name: String(line?.name ?? '').slice(0, 60),
      qty: positive(line?.qty),
      unitPrice: positive(line?.unitPrice),
      lineTotal: positive(line?.lineTotal),
      modifiers: (Array.isArray(line?.modifiers) ? line.modifiers : []).slice(0, 8).map((mod) => String(mod).slice(0, 48)),
      notes: String(line?.notes ?? '').slice(0, 160),
      station: String(line?.station ?? '').slice(0, 24),
      course: String(line?.course ?? '').slice(0, 24),
    })),
    payments: (Array.isArray(raw?.payments) ? raw.payments : []).slice(0, 8).map((payment) => ({
      method: String(payment?.method ?? 'card').slice(0, 24),
      amount: positive(payment?.amount),
    })),
    meta: {
      orderId: String(raw?.meta?.orderId ?? '').slice(0, 60),
      tableId: String(raw?.meta?.tableId ?? '').slice(0, 60),
      range: String(raw?.meta?.range ?? '').slice(0, 16),
      issuedBy: String(raw?.meta?.issuedBy ?? 'owner').slice(0, 40),
      voided: false,
      voidReason: null,
    },
  }
}

function cleanLabelList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map((entry) => String(entry ?? '').trim().replace(/\s+/g, ' ').slice(0, 48))
    .filter(Boolean))].slice(0, 12)
}

/** Photos may be a URL, a local path, or a small uploaded data URL. */
function cleanImageUrl(value, maxChars = MAX_IMAGE_CHARS) {
  return sanitizeImageRef(value, maxChars)
}

function cleanImageList(value, primaryUrl = '', maxChars = MAX_IMAGE_CHARS) {
  const rawList = Array.isArray(value) ? value : []
  const cleaned = [primaryUrl, ...rawList]
    .map((entry) => cleanImageUrl(entry, maxChars))
    .filter(Boolean)
  return [...new Set(cleaned)].slice(0, 6)
}

function normalizeMenuItem(item, index = 0) {
  const numericPrice = Number(item?.price)
  const numericOrder = Number(item?.sortOrder)
  const primaryImage = cleanImageUrl(item?.imageUrl)
  return {
    ...item,
    id: String(item?.id ?? '').trim(),
    name: String(item?.name ?? 'Menu item').trim().slice(0, 60) || 'Menu item',
    description: String(item?.description ?? '').trim().slice(0, 240),
    category: String(item?.category ?? 'Other').trim().slice(0, 40) || 'Other',
    price: Number.isFinite(numericPrice)
      ? Math.round(Math.min(MAX_MENU_PRICE, Math.max(0, numericPrice)) * 100) / 100
      : 0,
    station: STATIONS.includes(item?.station) ? item.station : 'pantry',
    available: item?.available !== false,
    active: item?.active !== false,
    subCategory: String(item?.subCategory ?? '').trim().slice(0, 40),
    sku: String(item?.sku ?? '').trim().slice(0, 40),
    dietaryTags: cleanLabelList(item?.dietaryTags),
    allergens: cleanLabelList(item?.allergens),
    imageUrl: primaryImage,
    images: cleanImageList(item?.images, primaryImage),
    course: String(item?.course ?? '').trim().slice(0, 24),
    menuWindow: String(item?.menuWindow ?? '').trim().slice(0, 24),
    spiceLevel: String(item?.spiceLevel ?? '').trim().slice(0, 20),
    sortOrder: Number.isFinite(numericOrder) ? Math.max(0, Math.trunc(numericOrder)) : index,
    modifiers: Array.isArray(item?.modifiers) ? item.modifiers : [],
    substituteId: item?.substituteId ? String(item.substituteId) : null,
    // Auto-86 is written by the stock policy; a manual 86 is never cleared by it.
    auto86: item?.auto86 === true,
    auto86At: item?.auto86 === true ? item?.auto86At || null : null,
  }
}

function slugify(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
}

/** Stock-management fields every SKU carries, backfilled on migration. */
function packPriceFromItem(item, packSize) {
  const size = Number(packSize) > 0 ? Number(packSize) : 1
  return Math.round(((Number(item?.lastCost) || 0) * size) * 10000) / 10000
}

function normalizeInventoryItem(item, index = 0) {
  const par = Number.isFinite(Number(item?.par)) ? Number(item.par) : 0
  const lastCost = Number.isFinite(Number(item?.lastCost)) ? Number(item.lastCost) : 0
  return {
    ...item,
    id: String(item?.id ?? '').trim() || `inv_${index}`,
    name: String(item?.name ?? 'Stock item').trim().slice(0, 60) || 'Stock item',
    // `unit` is the stock unit: every qty in the book (on hand, par, recipes,
    // movements) is counted in it. Packs only describe how it is bought.
    unit: slugUnitId(item?.unit) || 'each',
    packs: sanitizePackList(item?.packs),
    purchaseUnit: slugUnitId(item?.purchaseUnit) || null,
    onHand: Number.isFinite(Number(item?.onHand)) ? Number(item.onHand) : 0,
    par,
    lastCost,
    avgCost: Number.isFinite(Number(item?.avgCost)) && Number(item.avgCost) > 0 ? Number(item.avgCost) : lastCost,
    reorderPoint: Number.isFinite(Number(item?.reorderPoint)) ? Number(item.reorderPoint) : par,
    dailyUse: Number.isFinite(Number(item?.dailyUse)) ? Number(item.dailyUse) : 0,
    incoming: Number.isFinite(Number(item?.incoming)) ? Number(item.incoming) : 0,
    imageUrl: cleanImageUrl(item?.imageUrl),
    vendor: String(item?.vendor ?? '').trim().slice(0, 60),
    supplierId: item?.supplierId ? String(item.supplierId) : null,
    sku: String(item?.sku ?? '').trim().slice(0, 40),
    category: String(item?.category ?? 'Dry goods').trim().slice(0, 40) || 'Dry goods',
    subCategory: String(item?.subCategory ?? '').trim().slice(0, 40),
    location: String(item?.location ?? 'dry').trim().slice(0, 24) || 'dry',
    countDueDays: Number.isFinite(Number(item?.countDueDays)) ? Math.max(0, Math.trunc(Number(item.countDueDays))) : 7,
    expiresOn: item?.expiresOn || null,
    lot: String(item?.lot ?? '').trim().slice(0, 40) || null,
    notes: String(item?.notes ?? '').trim().slice(0, 240),
    active: item?.active !== false,
    // `counted: false` items sit outside stock tracking: count sheets,
    // low-stock alerts, auto-86, theoretical usage, and stock-flow reports
    // skip them. Receiving still adds stock and updates cost.
    counted: item?.counted !== false,
  }
}

function normalizeCategory(raw, index = 0) {
  const name = String(raw?.name ?? '').trim().slice(0, 40)
  if (!name) return null
  const kind = raw?.kind === 'inventory' ? 'inventory' : 'menu'
  return {
    id: String(raw?.id ?? '').trim() || `cat_${slugify(name)}_${index}`,
    kind,
    name,
    parentId: raw?.parentId ? String(raw.parentId) : null,
    description: String(raw?.description ?? '').trim().slice(0, 200),
    station: STATIONS.includes(raw?.station) ? raw.station : 'pantry',
    color: /^#[0-9a-fA-F]{6}$/.test(String(raw?.color || '')) ? String(raw.color) : '',
    sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Math.max(0, Math.trunc(Number(raw.sortOrder))) : index,
    active: raw?.active !== false,
  }
}

/** Legacy snapshots only had vendor strings — promote them to real suppliers. */
function suppliersFromVendors(inventory, existing) {
  const known = new Set(existing.map((supplier) => supplier.name.toLowerCase()))
  const out = [...existing]
  for (const item of inventory) {
    const vendor = String(item?.vendor || '').trim()
    if (!vendor || known.has(vendor.toLowerCase())) continue
    known.add(vendor.toLowerCase())
    out.push({
      id: `sup_${slugify(vendor) || out.length}`,
      name: vendor.slice(0, 60),
      contactName: '', contactRole: '', email: '', phone: '', website: '',
      addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: '',
      taxId: '', paymentTerms: 'net_30', leadTimeDays: 2, minOrderValue: 0, currency: '',
      deliveryDays: [], categories: [], status: 'active', rating: 0,
      notes: 'Auto-created from an existing inventory vendor during migration.',
      accountNumber: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
  }
  return out
}

const DELIVERY_ORDER_STATUSES = new Set(Object.keys(DELIVERY_STATUS_META))

function normalizeDeliveryOrder(order) {
  if (!order || order.type !== 'delivery' || DELIVERY_ORDER_STATUSES.has(order.deliveryStatus)) return order
  const deliveryStatus = order.status === 'void' ? 'cancelled'
    : order.status === 'ready' ? 'ready'
      : ['sent', 'in_prep'].includes(order.status) ? 'preparing'
        : order.status === 'open' ? 'queued' : 'untracked'
  return {
    ...order,
    deliveryStatus,
    deliveryStatusAt: null,
    preparingAt: null,
    readyAt: null,
    outForDeliveryAt: null,
    deliveredAt: null,
  }
}

function withShopDefaults(shop, locationLabel = 'Downtown') {
  if (!shop) return shop
  const settings = sanitizeSettings(shop.settings, locationLabel)
  const menu = Array.isArray(shop.menu)
    ? shop.menu.map((item, index) => normalizeMenuItem(item, index))
    : []
  const inventory = Array.isArray(shop.inventory)
    ? shop.inventory.map((item, index) => normalizeInventoryItem(item, index))
    : []
  const categories = (Array.isArray(shop.categories) ? shop.categories : [])
    .map((category, index) => normalizeCategory(category, index))
    .filter(Boolean)
  const suppliers = suppliersFromVendors(
    inventory,
    (Array.isArray(shop.suppliers) ? shop.suppliers : [])
      .map((supplier) => sanitizeSupplier(supplier))
      .map(({ _existing, ...supplier }) => supplier),
  )
  // Link SKUs to a supplier when they only had a vendor string.
  const supplierByName = new Map(suppliers.map((supplier) => [supplier.name.toLowerCase(), supplier.id]))
  const linkedInventory = inventory.map((item) => (
    item.supplierId || !item.vendor
      ? item
      : { ...item, supplierId: supplierByName.get(item.vendor.toLowerCase()) || null }
  ))
  const documents = (Array.isArray(shop.documents) ? shop.documents : []).slice(-300)
  const purchases = (Array.isArray(shop.purchases) ? shop.purchases : [])
    .map((purchase) => normalizePurchase(purchase, purchase, purchase?.id || uid('po')))
    .filter(Boolean)
    .slice(-400)
  const movements = (Array.isArray(shop.movements) ? shop.movements : [])
    .filter((movement) => movement && movement.itemId && Number.isFinite(Number(movement.qty)))
    .slice(-MAX_MOVEMENTS)
  const orders = (capOrders(shop.orders) || []).map(normalizeDeliveryOrder)
  return {
    ...shop, menu, inventory: linkedInventory, categories, suppliers, documents,
    purchases, movements, settings,
    tables: normalizeTablePositions(shop.tables),
    // Floor plan geometry, per branch: room size + real zone rectangles.
    // Legacy floors (no records yet) get zones derived once from the old
    // auto-bands so the upgrade redraws the same picture.
    floor: sanitizeFloorRoom(shop.floor),
    floorZones: Array.isArray(shop.floorZones)
      ? shop.floorZones.slice(0, 12).map((zone, index) => sanitizeZoneRecord(zone, index))
      : seedFloorZones(shop.tables),
    orders,
    // A shift doubles as the cash session for offline gating: `status` is
    // 'open' while the drawer is out. The marker only comes from the new
    // open/close feature — a legacy roster row carries none, so an
    // upgrade never locks offline selling on branches that never used it.
    shifts: (Array.isArray(shop.shifts) ? shop.shifts : [])
      .map((shift) => {
        if (!shift) return shift
        if (shift.status === 'open' || shift.status === 'closed') return shift
        // A stray marker is not a session state: strip it so the row
        // reads as a plain legacy roster entry (no gate adoption).
        const { status, ...rest } = shift
        return rest
      })
      .slice(-500),
    customers: (Array.isArray(shop.customers) ? shop.customers : [])
      .map((customer) => sanitizeCustomerRecord(customer))
      .filter(Boolean)
      .slice(-800),
    wasteLog: (Array.isArray(shop.wasteLog) ? shop.wasteLog : []).slice(-500),
    dismissedAlerts: (Array.isArray(shop.dismissedAlerts) ? shop.dismissedAlerts : []).slice(-MAX_DISMISSED_ALERTS),
  }
}

/** Rebuild the category tree defaults when a legacy snapshot had none. */
function seedCategoriesIfEmpty(shop) {
  if (shop.categories?.length) return shop
  return { ...shop, categories: buildSeed().categories }
}

function uniqueMenuName(menu, itemId, name) {
  const normalized = String(name ?? '').trim().toLocaleLowerCase()
  return normalized && !menu.some((item) => item.id !== itemId && item.name.toLocaleLowerCase() === normalized)
}

// ─── Stock movements: one ledger for every in/out ───────────────────
// Sales, waste, counts, deliveries and purchases all land here, signed,
// so the in/out report and the per-item history read one array.

const MAX_MOVEMENTS = 4000

// A shift never ends with an unbounded ticket list. Closed tickets are kept
// for the night's reports; the oldest are dropped once the cap is reached so
// the snapshot (and the SSE payload) stays a fixed size. Open tickets are
// always kept — a table mid-service must never vanish.
const MAX_ORDERS = 400
const MAX_DISMISSED_ALERTS = 200

function capOrders(orders) {
  if (!Array.isArray(orders) || orders.length <= MAX_ORDERS) return orders
  const openIds = new Set()
  const closed = []
  for (const order of orders) {
    if (order && !['paid', 'void'].includes(order.status)) openIds.add(order.id)
    else if (order) closed.push(order)
  }
  const keepClosed = new Set(closed.slice(-MAX_ORDERS).map((order) => order.id))
  return orders.filter((order) => openIds.has(order?.id) || keepClosed.has(order?.id))
}

export const MOVEMENT_KINDS = [
  { id: 'buy', label: 'Purchase', direction: 'in', icon: 'cart' },
  { id: 'opening', label: 'Opening stock', direction: 'in', icon: 'inventory' },
  { id: 'return', label: 'Return to vendor', direction: 'out', icon: 'swap' },
  { id: 'sale', label: 'Sold', direction: 'out', icon: 'orders' },
  { id: 'waste', label: 'Waste', direction: 'out', icon: 'trash' },
  { id: 'count', label: 'Count variance', direction: 'adjust', icon: 'check' },
  { id: 'adjust', label: 'Manual adjust', direction: 'adjust', icon: 'settings' },
  { id: 'transfer', label: 'Branch transfer', direction: 'adjust', icon: 'swap' },
]

export const MOVEMENT_LABEL = Object.fromEntries(MOVEMENT_KINDS.map((kind) => [kind.id, kind.label]))

/**
 * Apply signed stock deltas and record the matching movements.
 * `lines` = [{ inventoryItemId, qty (signed), unitCost, kind, ref, note }]
 */
function applyStockLines(state, lines, meta = {}) {
  const precision = Math.trunc(Number(state.settings?.stock?.autoReceiveThousandths) || 2)
  const at = meta.at || new Date().toISOString()
  const by = meta.by || 'system'
  const allowNegative = meta.allowNegative === true
  const byId = Object.fromEntries(state.inventory.map((item) => [item.id, item]))
  const movements = []

  const inventory = state.inventory.map((item) => {
    const hits = lines.filter((line) => line.inventoryItemId === item.id && Number(line.qty))
    if (!hits.length) return item
    let next = item
    for (const hit of hits) {
      const qty = roundQty(hit.qty, precision)
      if (!qty) continue
      const onHand = roundQty(next.onHand + qty, precision)
      if (!allowNegative && onHand < 0 && qty < 0) {
        // Policy: never let a decrement invent negative stock.
        const capped = roundQty(-next.onHand, precision)
        if (!capped) continue
        movements.push(movementEntry(next, { ...hit, qty: capped }, at, by))
        next = { ...next, onHand: 0 }
        continue
      }
      movements.push(movementEntry(next, { ...hit, qty }, at, by, byId))
      if (!allowNegative && onHand < 0) next = { ...next, onHand: 0 }
      else next = { ...next, onHand }
      if (qty > 0 && hit.unitCost != null) {
        const unitCost = Number(hit.unitCost)
        const prevQty = Math.max(0, Number(item.onHand) || 0)
        const prevAvg = Number(item.avgCost) || Number(item.lastCost) || 0
        const newQty = next.onHand
        next = {
          ...next,
          lastCost: Number.isFinite(unitCost) ? Math.round(unitCost * 10000) / 10000 : next.lastCost,
          avgCost: newQty > 0
            ? Math.round((((prevQty * prevAvg) + (qty * (Number.isFinite(unitCost) ? unitCost : prevAvg))) / newQty) * 10000) / 10000
            : next.avgCost,
        }
      }
    }
    return next
  })

  if (!movements.length) return null
  return { inventory, movements }
}

function movementEntry(item, hit, at, by, byId) {
  const unitCost = Number.isFinite(Number(hit.unitCost))
    ? Number(hit.unitCost)
    : Number(byId?.[item.id]?.lastCost) || Number(item.lastCost) || 0
  return {
    id: uid('mv'),
    at,
    itemId: item.id,
    name: hit.name || item.name,
    unit: item.unit,
    kind: hit.kind || 'adjust',
    qty: hit.qty,
    unitCost: Math.round(unitCost * 10000) / 10000,
    value: Math.round(hit.qty * unitCost * 100) / 100,
    ref: hit.ref || null,
    note: hit.note || '',
    by,
  }
}

function pushMovements(state, movements) {
  return [...(state.movements || []), ...movements].slice(-MAX_MOVEMENTS)
}

/** Stock deltas that come from a sale: theoretical recipe usage, costed. */
function saleMovements(shop, decMap, meta) {
  return Object.entries(decMap)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([inventoryItemId, qty]) => ({
      inventoryItemId,
      qty: -roundQty(qty, 3),
      kind: 'sale',
      ref: meta.ref,
      note: meta.note,
    }))
}

// ─── Purchase orders ────────────────────────────────────────────────

export const PURCHASE_STATUSES = ['draft', 'ordered', 'received', 'cancelled']

const PURCHASE_STATUS_META = {
  draft: { label: 'Draft', tone: 'muted' },
  ordered: { label: 'Ordered', tone: 'info' },
  received: { label: 'Received', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
}

export { PURCHASE_STATUS_META }

/** Advance the purchase number sequence past a number we just handed out. */
function bumpPurchaseNumber(settings, number) {
  const match = String(number || '').match(/(\d+)\s*$/)
  if (!match || !settings?.numbering?.purchase) return settings
  const used = Number(match[1])
  if (!Number.isFinite(used) || used < settings.numbering.purchase.next) return settings
  return {
    ...settings,
    numbering: {
      ...settings.numbering,
      purchase: { ...settings.numbering.purchase, next: used + 1 },
    },
  }
}

/** Keep a purchase small, valid, and printable. */
function normalizePurchase(raw, existing, fallbackId) {
  if (!raw || typeof raw !== 'object') return null
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .map((line) => {
      const qty = Math.max(0, Math.round((Number(line?.qty) || 0) * 1000) / 1000)
      const unitCost = Math.max(0, Math.round((Number(line?.unitCost) || 0) * 10000) / 10000)
      const receivedQty = Math.max(0, Math.round((Number(line?.receivedQty) || 0) * 1000) / 1000)
      if (!line?.inventoryItemId || (!qty && !receivedQty)) return null
      const packSize = Math.round((Number(line.packSize) || 0) * 1000) / 1000
      return {
        id: String(line.id || uid('pline')).slice(0, 40),
        inventoryItemId: String(line.inventoryItemId).slice(0, 60),
        name: String(line.name || '').slice(0, 80),
        // `qty` and `unitCost` are in this line's unit (a case, a bottle, …);
        // `packSize` is how many stock units one of them holds.
        unit: slugUnitId(line.unit) || '',
        qty,
        unitCost,
        receivedQty,
        packSize: packSize > 0 ? packSize : 1,
      }
    })
    .filter(Boolean)
    .slice(0, 60)
  if (!lines.length) return null

  const status = PURCHASE_STATUSES.includes(raw.status) ? raw.status : 'draft'
  const tax = Math.max(0, Math.round((Number(raw.tax) || 0) * 100) / 100)
  const shipping = Math.max(0, Math.round((Number(raw.shipping) || 0) * 100) / 100)
  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0) * 100) / 100
  const nowIso = new Date().toISOString()
  return {
    id: String(raw.id || fallbackId).slice(0, 60),
    number: String(raw.number || existing?.number || '').slice(0, 40),
    supplierId: raw.supplierId ? String(raw.supplierId).slice(0, 60) : null,
    vendor: String(raw.vendor || '').slice(0, 80),
    reference: String(raw.reference || '').slice(0, 60),
    status,
    note: String(raw.note || '').slice(0, 400),
    orderedAt: raw.orderedAt ? String(raw.orderedAt).slice(0, 40) : status === 'ordered' ? nowIso : null,
    expectedAt: raw.expectedAt ? String(raw.expectedAt).slice(0, 40) : null,
    receivedAt: raw.receivedAt ? String(raw.receivedAt).slice(0, 40) : existing?.receivedAt || null,
    createdBy: String(raw.createdBy || existing?.createdBy || 'owner').slice(0, 40),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    lines,
    tax,
    shipping,
    totals: {
      subtotal,
      tax,
      shipping,
      total: Math.round((subtotal + tax + shipping) * 100) / 100,
    },
  }
}

/** Re-label menu + inventory items when a category is renamed or merged. */
function relabelCategoryItems(state, from, to) {
  const sources = (Array.isArray(from) ? from : [from]).map((category) => category.name)
  const parent = to.parentId ? categoryById(state.categories, to.parentId) : null
  const targetName = parent ? parent.name : to.name
  const targetSub = parent ? to.name : ''
  const relabel = (item) => {
    const hitTop = sources.includes(item.category)
    const hitSub = sources.includes(item.subCategory)
    if (!hitTop && !hitSub) return item
    return { ...item, category: targetName, subCategory: targetSub }
  }
  // Menu rows are labeled by category name; stock rows carry the same
  // category/sub-category names, so both arrays follow the rename.
  const isStock = (item) => item.unit !== undefined
  return {
    menu: state.menu.filter((item) => !isStock(item)).map(relabel),
    inventory: state.inventory.filter(isStock).map(relabel),
  }
}

// ─── Reducer ────────────────────────────────────────────────────

// ─── Table CRUD helpers ─────────────────────────────────────
// Tables are editable config: name, seats, zone, and target turn. Status
// moves through the status machine, never through editing.

function targetTurnMinutesFor(seats) {
  return seats <= 2 ? 35 : seats <= 4 ? 45 : 60
}

function sanitizeTableFields(raw, existing = {}) {
  const name = String(raw?.name ?? existing.name ?? '').trim().slice(0, 40)
  const seatsRaw = Math.round(Number(raw?.seats ?? existing.seats))
  const seats = Number.isFinite(seatsRaw) ? Math.max(1, Math.min(24, seatsRaw)) : 2
  const zone = String(raw?.zone ?? existing.zone ?? '').trim().slice(0, 32)
  const targetRaw = Math.round(Number(raw?.targetTurnMinutes ?? existing.targetTurnMinutes))
  const targetTurnMinutes = Number.isFinite(targetRaw)
    ? Math.max(10, Math.min(300, targetRaw))
    : targetTurnMinutesFor(seats)
  // Visual footprint on the floor plan: 1 = the shipped tile size.
  const scaleRaw = Number(raw?.tileScale ?? existing.tileScale)
  const tileScale = Number.isFinite(scaleRaw)
    ? Math.min(3, Math.max(0.75, Math.round(scaleRaw * 100) / 100))
    : 1
  return {
    name: name || existing.name || 'Table',
    seats,
    zone: zone || existing.zone || 'Main',
    targetTurnMinutes,
    tileScale,
  }
}

// ── Table layout ───────────────────────────────────────────
// Every table carries a normalized floor position (0–100 on both axes) so
// the Floor screen can draw a real plan and persist drags. Snapshots from
// before layout existed (or a table added without a spot) get a deterministic
// grid slot: one column per zone, tables stacked down each column.

const clampPct = (value) => Math.max(0, Math.min(100, Math.round(Number(value) * 10) / 10))

function hasPosition(table) {
  return Number.isFinite(Number(table?.posX)) && Number.isFinite(Number(table?.posY))
}

function normalizeTablePositions(tables) {
  if (!Array.isArray(tables) || !tables.length) return tables
  const missing = tables.filter((table) => !hasPosition(table))
  if (!missing.length) {
    return tables.every((table) => table.posX === clampPct(table.posX) && table.posY === clampPct(table.posY))
      ? tables
      : tables.map((table) => (hasPosition(table)
        ? { ...table, posX: clampPct(table.posX), posY: clampPct(table.posY) }
        : table))
  }
  const zones = []
  for (const table of tables) {
    const zone = table.zone || 'Main'
    if (!zones.includes(zone)) zones.push(zone)
  }
  const zoneIndex = new Map(zones.map((zone, index) => [zone, index]))
  const zoneTotals = new Map()
  for (const table of tables) {
    const zone = table.zone || 'Main'
    zoneTotals.set(zone, (zoneTotals.get(zone) || 0) + 1)
  }
  const zoneSeen = new Map()
  const placed = tables.map((table) => {
    if (hasPosition(table)) return { ...table, posX: clampPct(table.posX), posY: clampPct(table.posY) }
    const zone = table.zone || 'Main'
    const total = zoneTotals.get(zone) || 1
    const seen = zoneSeen.get(zone) || 0
    zoneSeen.set(zone, seen + 1)
    const columns = Math.max(1, zones.length)
    const posX = ((zoneIndex.get(zone) + 0.5) * (100 / columns))
    const posY = total > 1 ? ((seen + 0.5) * (72 / total)) + 14 : 50
    return { ...table, posX: clampPct(posX), posY: clampPct(posY) }
  })
  return placed
}

/** Keep table names unique so two tables never print the same label. */
function uniqueTableName(tables, name, exceptId = null) {
  const base = String(name || 'Table').trim() || 'Table'
  const taken = new Set(tables.filter((t) => t.id !== exceptId).map((t) => String(t.name).toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1
  return `${base} ${n}`
}

// ── Floor plan geometry ──────────────────────────────────────────
// Zones are real rectangles on the plan (top-left x/y in %, w/h in % of
// the room), while `table.zone` stays the assignment string. A table
// whose zone text has no record still renders — it just sits outside
// every rect with its own label chip.

function sanitizeZoneRect(raw) {
  const x = clampPct(raw?.x ?? 0)
  const y = clampPct(raw?.y ?? 0)
  // Ten-percent minimums keep a zone grabbable on a tablet.
  const w = Math.min(100 - x, Math.max(10, clampPct(raw?.w ?? 100)))
  const h = Math.min(100 - y, Math.max(10, clampPct(raw?.h ?? 100)))
  return { x, y, w, h }
}

function sanitizeZoneRecord(raw, index = 0) {
  const name = String(raw?.name ?? '').trim().slice(0, 32) || `Zone ${index + 1}`
  return {
    id: String(raw?.id ?? `z_${index + 1}`).trim().slice(0, 50),
    name,
    ...sanitizeZoneRect(raw),
  }
}

/** Zone names stay unique so one table never sits in two zones at once. */
function uniqueZoneName(zones, name, exceptId = null) {
  const base = String(name || 'Zone').trim().slice(0, 32) || 'Zone'
  const taken = new Set(zones.filter((z) => z.id !== exceptId).map((z) => String(z.name).toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1
  return `${base} ${n}`
}

/**
 * Legacy floors carry no zone records: derive one full-height band per
 * zone name that reproduces the old auto-band geometry exactly, so an
 * upgrade redraws the same picture and becomes draggable from there.
 */
function seedFloorZones(tables) {
  const bands = new Map()
  for (const table of Array.isArray(tables) ? tables : []) {
    const zone = table?.zone || 'Main'
    const x = Number.isFinite(Number(table?.posX)) ? clampPct(table.posX) : 50
    const band = bands.get(zone) || { min: x, max: x }
    band.min = Math.min(band.min, x)
    band.max = Math.max(band.max, x)
    bands.set(zone, band)
  }
  const zones = []
  for (const [name, band] of bands) {
    const x = clampPct(band.min - 10)
    const right = clampPct(band.max + 10)
    zones.push(sanitizeZoneRecord({
      id: `z_seed_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name,
      x,
      y: 0,
      w: Math.min(100 - x, Math.max(6, right - x)),
      h: 100,
    }))
  }
  return zones
}

/** Room size in content pixels; 0 on either axis = auto-fit (shipped look). */
function sanitizeFloorRoomValue(value, min, max) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(max, Math.max(min, n))
}

function sanitizeFloorRoom(raw) {
  const room = raw && typeof raw === 'object' ? raw : {}
  return {
    roomW: sanitizeFloorRoomValue(room.roomW, 600, 3000),
    roomH: sanitizeFloorRoomValue(room.roomH, 400, 1800),
  }
}

/** Off-table orders carry a customer block; inline orders do not. */
function sanitizeCustomer(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim().slice(0, 60)
  const phone = String(raw.phone || '').trim().slice(0, 30)
  const address = String(raw.address || '').trim().slice(0, 160)
  const customerId = String(raw.customerId || '').trim().slice(0, 64)
  if (!name && !phone && !address) return null
  return {
    name,
    phone,
    address,
    // Link back to the saved customer directory entry, when the check was
    // created from one. Optional, so legacy payloads keep their shape.
    ...(customerId ? { customerId } : {}),
  }
}

/** A saved local customer: the directory the Tickets composer picks from. */
function sanitizeCustomerRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim().slice(0, 60)
  const phone = String(raw.phone || '').trim().slice(0, 30)
  const note = String(raw.note || '').trim().slice(0, 200)
  if (!name && !phone) return null
  return {
    id: raw.id || uid('cus'),
    name,
    phone,
    ...(note ? { note } : {}),
    createdAt: String(raw.createdAt || '').slice(0, 30),
  }
}

const OFF_TABLE_TYPES = ['takeout', 'delivery']

function shopReducerBase(state, action) {
  switch (action.type) {
    // ── Floor ──────────────────────────────────────────────
    case 'SEAT_PARTY': {
      const { tableId, partySize, reservationId, by } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      if (table.status !== 'seated' && table.status !== 'occupied') {
        assertTableTransition(table.status, 'seated')
      }
      const tables = state.tables.map((t) =>
        t.id === tableId
          ? { ...t, status: 'seated', seatedAt: t.seatedAt || new Date().toISOString(), partySize: partySize || t.partySize || 2, seatedBy: by || t.seatedBy || 'host' }
          : t,
      )
      let { reservations, waitlist } = state
      if (reservationId) {
        reservations = reservations.map((r) =>
          r.id === reservationId ? { ...r, status: 'seated', tableId } : r,
        )
        waitlist = waitlist.filter((w) => w.id !== reservationId)
      }
      return { ...state, tables, reservations, waitlist }
    }

    case 'SET_TABLE_STATUS': {
      const { tableId, to, force } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      if (!force) assertTableTransition(table.status, to)
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        const clearing = to === 'free'
        return {
          ...t,
          status: to,
          ...(clearing ? { currentCheckId: null, seatedAt: null, partySize: null } : {}),
        }
      })
      return { ...state, tables }
    }

    case 'BUS_TABLE': {
      // billed -> dirty (server/host clears after pay)
      const { tableId } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table || table.status !== 'billed') return state
      return shopReducerBase(state, { type: 'SET_TABLE_STATUS', tableId, to: 'dirty' })
    }

    case 'RELEASE_STALE_TABLES': {
      // A table the mini app self-seated but where the guest never ordered is
      // released back to the floor, so a dropped session can't squat a table.
      const nowMs = Number(action.now) || Date.now()
      const limitMin = Number(action.timeoutMinutes) || TARGETS.selfSeatReleaseMinutes
      const occupied = new Set(
        state.orders.filter((o) => !['paid', 'void'].includes(o.status)).map((o) => o.tableId),
      )
      let changed = false
      const tables = state.tables.map((t) => {
        if (!['seated', 'occupied'].includes(t.status) || t.seatedBy !== 'guest' || !t.seatedAt) return t
        if (occupied.has(t.id)) return t
        const ageMin = (nowMs - new Date(t.seatedAt).getTime()) / 60000
        if (ageMin < limitMin) return t
        changed = true
        return { ...t, status: 'free', currentCheckId: null, seatedAt: null, partySize: null, seatedBy: null }
      })
      return changed ? { ...state, tables } : state
    }

    case 'MINIAPP_CLAIM_TABLE': {
      const payload = action.payload || action
      const { tableId, guestName, partySize, guestPhone, sessionToken } = payload
      const targetTable = (state.tables || []).find((t) => String(t.id) === String(tableId))

      // Concurrency Guard: Only allow claiming if table is available/free
      if (!targetTable || !['available', 'free', 'idle'].includes(targetTable.status)) {
        return state
      }

      const seatedAt = new Date().toISOString()

      return {
        ...state,
        tables: state.tables.map((t) =>
          String(t.id) === String(tableId)
            ? {
                ...t,
                status: 'occupied',
                guestName: guestName?.trim() || 'Walk-in Guest',
                partySize: Number(partySize) || 2,
                guestPhone: guestPhone || '',
                sessionToken,
                seatedAt,
                selfSeated: true,
                // The stale-table sweep only releases tables a guest took
                // themselves — a self-seated table is 'occupied', so the
                // claim has to carry the same marker SEAT_PARTY sets.
                seatedBy: 'guest',
                lastActivityAt: seatedAt,
              }
            : t,
        ),
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'TABLE_SELF_SEATED',
            tableId,
            detail: `${guestName || 'Guest'} (${partySize || 2} pax) self-seated at ${targetTable.name || tableId}`,
            timestamp: seatedAt,
          },
          ...(state.movements || []),
        ],
      }
    }

    case 'MINIAPP_RELEASE_TABLE': {
      const payload = action.payload || action
      const { tableId, sessionToken, forceByStaff = false } = payload
      const targetTable = (state.tables || []).find((t) => String(t.id) === String(tableId))
      if (!targetTable) return state

      // Ownership Guard: Prevent another guest from releasing someone else's table
      if (!forceByStaff && targetTable.sessionToken && targetTable.sessionToken !== sessionToken) {
        return state
      }

      // Financial Guard: Check for open/unpaid tickets with ordered items
      const ticketList = state.tickets || state.orders || []
      const unpaidTickets = ticketList.filter(
        (tk) =>
          String(tk.tableId) === String(tableId) &&
          !['paid', 'cancelled', 'closed', 'void'].includes(tk.status) &&
          (tk.items?.length || 0) > 0,
      )

      const now = new Date().toISOString()

      // Case 1: Guest has unpaid items -> Transition to 'billing' and alert staff
      if (unpaidTickets.length > 0 && !forceByStaff) {
        return {
          ...state,
          tables: state.tables.map((t) =>
            String(t.id) === String(tableId)
              ? { ...t, status: 'billing', releaseRequestedAt: now }
              : t,
          ),
          movements: [
            {
              id: `mov-${Date.now()}`,
              type: 'TABLE_BILL_REQUESTED',
              tableId,
              detail: `${targetTable.name || tableId} requested bill & table release`,
              timestamp: now,
            },
            ...(state.movements || []),
          ],
        }
      }

      // Case 2: Guest already paid a ticket -> Mark table as 'cleaning' for bussing
      // Case 3: Guest sat down, ordered nothing, and left -> Immediately 'available'
      const hadPaidTicket = ticketList.some(
        (tk) =>
          String(tk.tableId) === String(tableId) &&
          tk.status === 'paid' &&
          (!targetTable.seatedAt || (tk.updatedAt || tk.paidAt || '') >= targetTable.seatedAt),
      )

      const nextStatus = hadPaidTicket && !forceByStaff ? 'cleaning' : 'available'

      const nextTables = state.tables.map((t) =>
        String(t.id) === String(tableId)
          ? {
              ...t,
              status: nextStatus,
              guestName: null,
              partySize: null,
              guestPhone: null,
              sessionToken: null,
              seatedAt: null,
              selfSeated: false,
              releaseRequestedAt: null,
              currentCheckId: null,
            }
          : t,
      )

      const closeDraftTickets = (tk) =>
        String(tk.tableId) === String(tableId) && (tk.items?.length || 0) === 0
          ? { ...tk, status: 'closed' }
          : tk

      const nextState = {
        ...state,
        tables: nextTables,
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'TABLE_RELEASED',
            tableId,
            detail: `${targetTable.name || tableId} released -> ${nextStatus}`,
            timestamp: now,
          },
          ...(state.movements || []),
        ],
      }

      if (state.tickets) {
        nextState.tickets = state.tickets.map(closeDraftTickets)
      }
      if (state.orders) {
        nextState.orders = state.orders.map(closeDraftTickets)
      }

      return nextState
    }

    case 'FLOOR_MARK_TABLE_AVAILABLE': {
      const payload = action.payload || action
      const { tableId } = payload
      return {
        ...state,
        tables: state.tables.map((t) =>
          String(t.id) === String(tableId)
            ? {
                ...t,
                status: 'available',
                guestName: null,
                partySize: null,
                sessionToken: null,
                seatedAt: null,
                selfSeated: false,
                releaseRequestedAt: null,
                currentCheckId: null,
              }
            : t,
        ),
      }
    }

    case 'ADD_TABLE': {
      const fields = sanitizeTableFields(action.table || {})
      const table = {
        id: action.id || uid('t'),
        ...fields,
        name: uniqueTableName(state.tables, fields.name),
        status: 'free',
        currentCheckId: null,
        seatedAt: null,
        partySize: null,
      }
      // A first table on a floor with no zone records gives the room one
      // full-canvas zone to grow from, so the picker never blocks on "no
      // zones defined".
      const zones = Array.isArray(state.floorZones) ? state.floorZones : []
      const floorZones = zones.length ? zones : [
        sanitizeZoneRecord({ name: fields.zone || 'Main', x: 0, y: 0, w: 100, h: 100 }),
      ]
      return {
        ...state,
        floorZones,
        tables: normalizeTablePositions([...state.tables, table]),
      }
    }

    case 'SET_TABLE_LAYOUT': {
      // Accept one move ({ tableId, posX, posY, scale? }) or an array of them.
      const moves = Array.isArray(action.moves)
        ? action.moves
        : [{ tableId: action.tableId, posX: action.posX, posY: action.posY, scale: action.scale }]
      const byId = new Map()
      for (const move of moves) {
        if (!move?.tableId) continue
        const scaleRaw = Number(move.scale)
        byId.set(move.tableId, {
          posX: clampPct(move.posX),
          posY: clampPct(move.posY),
          scale: Number.isFinite(scaleRaw)
            ? Math.min(3, Math.max(0.75, Math.round(scaleRaw * 100) / 100))
            : undefined,
        })
      }
      if (!byId.size) return state
      let changed = false
      const tables = state.tables.map((table) => {
        const move = byId.get(table.id)
        if (!move) return table
        const scale = move.scale === undefined ? table.tileScale ?? 1 : move.scale
        if (table.posX === move.posX && table.posY === move.posY && (table.tileScale ?? 1) === scale) return table
        changed = true
        return { ...table, posX: move.posX, posY: move.posY, tileScale: scale }
      })
      return changed ? { ...state, tables } : state
    }

    case 'UPDATE_TABLE': {
      const { tableId } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      const fields = sanitizeTableFields(action.patch || {}, table)
      fields.name = uniqueTableName(state.tables, fields.name, tableId)
      const tables = state.tables.map((t) => (t.id === tableId ? { ...t, ...fields } : t))
      return { ...state, tables }
    }

    case 'DELETE_TABLE': {
      const { tableId } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      // Never delete a table that still has an open check or occupied party.
      const openCheck = state.orders.some(
        (o) => o.tableId === tableId && !['paid', 'void'].includes(o.status),
      )
      if (openCheck || ['seated', 'ordered', 'billed'].includes(table.status)) return state
      const tables = state.tables.filter((t) => t.id !== tableId)
      // Orphaned reservations fall back to unassigned rather than dangling.
      const reservations = state.reservations.map((r) =>
        r.tableId === tableId ? { ...r, tableId: null } : r,
      )
      return { ...state, tables, reservations }
    }

    // ── Floor plan: room size + zones ──────────────────────────
    case 'SET_FLOOR_ROOM': {
      // Room pixels per axis; 0 = auto-fit. Omitting a field keeps it.
      const floor = {
        roomW: action.roomW === undefined
          ? state.floor?.roomW ?? 0
          : sanitizeFloorRoomValue(action.roomW, 600, 3000),
        roomH: action.roomH === undefined
          ? state.floor?.roomH ?? 0
          : sanitizeFloorRoomValue(action.roomH, 400, 1800),
      }
      const current = state.floor || {}
      if (state.floor && (current.roomW ?? 0) === floor.roomW && (current.roomH ?? 0) === floor.roomH) return state
      return { ...state, floor }
    }

    case 'CREATE_FLOOR_ZONE': {
      const zones = Array.isArray(state.floorZones) ? state.floorZones : []
      if (zones.length >= 12) return state
      const index = zones.length
      // Default slot: a full-width band under the last zone (the legacy
      // look), unless the caller positions it.
      const tentativeName = String(action.name ?? '').trim().slice(0, 32) || `Zone ${index + 1}`
      const zone = sanitizeZoneRecord({
        id: action.id,
        name: uniqueZoneName(zones, tentativeName),
        x: action.x ?? 0,
        y: action.y ?? Math.min(80, index * 20),
        w: action.w ?? 100,
        h: action.h ?? 20,
      }, index)
      return { ...state, floorZones: [...zones, zone] }
    }

    case 'UPDATE_FLOOR_ZONE': {
      const zones = Array.isArray(state.floorZones) ? state.floorZones : []
      const zone = zones.find((z) => z.id === action.zoneId)
      if (!zone) return state
      const patch = action.patch || {}
      const rect = patch.rect
        && ['x', 'y', 'w', 'h'].some((key) => patch.rect[key] !== undefined)
        ? sanitizeZoneRect({ ...zone, ...patch.rect })
        : zone
      const name = patch.name !== undefined
        ? uniqueZoneName(zones, String(patch.name).trim().slice(0, 32) || zone.name, zone.id)
        : zone.name
      if (name === zone.name && rect === zone) return state
      const floorZones = zones.map((z) => (z.id === zone.id ? { ...z, ...rect, name } : z))
      // Renaming a zone drags its assigned tables along.
      const tables = name !== zone.name
        ? state.tables.map((t) => (t.zone === zone.name ? { ...t, zone: name } : t))
        : state.tables
      return { ...state, floorZones, tables }
    }

    case 'DELETE_FLOOR_ZONE': {
      const zones = Array.isArray(state.floorZones) ? state.floorZones : []
      const zone = zones.find((z) => z.id === action.zoneId)
      if (!zone) return state
      const floorZones = zones.filter((z) => z.id !== zone.id)
      if (floorZones.length === zones.length) return state
      // Tables assigned to the zone fall back to 'Main' — they never vanish.
      const tables = state.tables.some((t) => t.zone === zone.name)
        ? state.tables.map((t) => (t.zone === zone.name ? { ...t, zone: 'Main' } : t))
        : state.tables
      return { ...state, floorZones, tables }
    }

    // ── Orders / tickets ───────────────────────────────────
    case 'CREATE_ORDER': {
      const { orderType = 'dine_in', customer = null, deliveryFee = 0, eta = null } = action
      const offTable = OFF_TABLE_TYPES.includes(orderType)
      const tableId = offTable ? null : action.tableId
      const createdAt = new Date().toISOString()
      // Dine-in: one open check per table. Takeout/delivery: many can coexist.
      if (!offTable) {
        const existing = state.orders.find(
          (o) => o.tableId === tableId && !['paid', 'void'].includes(o.status),
        )
        if (existing) return state
      }
      const order = {
        id: action.id || uid('o'),
        tableId,
        type: orderType,
        serverId: action.serverId || 'server',
        status: 'open',
        createdAt,
        sentAt: null,
        paidAt: null,
        voidReason: null,
        compTotal: 0,
        items: [],
        ...(offTable
          ? {
            customer: sanitizeCustomer(customer),
            ...(orderType === 'delivery'
              ? {
                deliveryFee: Math.max(0, roundMoney(Number(deliveryFee) || 0)),
                deliveryStatus: 'queued',
                deliveryStatusAt: createdAt,
              }
              : {}),
            eta: eta || null,
          }
          : {}),
      }
      const tables = offTable
        ? state.tables
        : state.tables.map((t) =>
          t.id === tableId && t.currentCheckId == null ? { ...t, currentCheckId: order.id } : t,
        )
      return { ...state, orders: capOrders([...state.orders, order]), tables }
    }

    case 'SET_ORDER_DETAILS': {
      // Edit the customer/fulfilment block on a takeout or delivery order.
      const { orderId, customer, deliveryFee, eta } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || !OFF_TABLE_TYPES.includes(order.type)) return state
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const next = { ...o, customer: sanitizeCustomer(customer) }
        if (o.type === 'delivery') next.deliveryFee = Math.max(0, roundMoney(Number(deliveryFee) || 0))
        if (eta !== undefined) next.eta = eta || null
        return next
      })
      return { ...state, orders }
    }

    case 'ADD_ITEM': {
      const { orderId, menuItemId, qty = 1, modifiers = [], course = 'main', notes = '', by = 'server', guest = null } = action
      const menuItem = state.menu.find((m) => m.id === menuItemId)
      if (!menuItem || !menuItem.available || menuItem.active === false) return state // 86/hidden blocked
      const item = {
        id: uid('it'),
        menuItemId,
        qty,
        modifiers,
        station: menuItem.station,
        status: 'held',
        course,
        notes,
        by, // 'server' | 'guest' — guest scans feed the same ticket
        guest, // optional guest name for KDS/server context
        firedAt: null,
        recipeSnapshot: null,
      }
      const orders = state.orders.map((o) =>
        o.id === orderId ? { ...o, items: [...o.items, item] } : o,
      )
      return { ...state, orders }
    }

    case 'UPDATE_ITEM': {
      const { orderId, itemId, patch } = action
      const orders = state.orders.map((o) =>
        o.id === orderId
          ? { ...o, items: o.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }
          : o,
      )
      return { ...state, orders }
    }

    case 'REMOVE_ITEM': {
      const { orderId, itemId } = action
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const item = o.items.find((i) => i.id === itemId)
        if (!item || item.status !== 'held') return o // kitchen owns fired items
        return { ...o, items: o.items.filter((i) => i.id !== itemId) }
      })
      return { ...state, orders }
    }

    case 'SEND_ORDER': {
      const { orderId, courses } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order) return state
      // Fire held items — optionally only the given courses (hold desserts,
      // send starters/mains). Theoretical stock drops here, on fire.
      const heldItems = order.items.filter(
        (i) => i.status === 'held' && !i.voided && (!courses || courses.includes(i.course)),
      )
      if (!heldItems.length) return state
      const nowIso = new Date().toISOString()
      const inventoryById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))

      // Fire held items + snapshot recipe cost at send time
      const firedIds = new Set(heldItems.map((i) => i.id))
      const totalDec = {}
      for (const item of heldItems) {
        const recipe = state.recipes[item.menuItemId]
        const dec = theoreticalDecrementFor(recipe, item.qty)
        for (const [k, v] of Object.entries(dec)) {
          if (inventoryById[k]?.counted === false) continue // not counted: firing never moves the book
          totalDec[k] = (totalDec[k] || 0) + v
        }
      }
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) => {
          if (!firedIds.has(i.id)) return i
          const recipe = state.recipes[i.menuItemId]
          return {
            ...i,
            status: 'fired',
            firedAt: nowIso,
            recipeSnapshot: recipe
              ? { ...recipe, plateCost: plateCostFor(recipe, inventoryById) }
              : null,
          }
        })
        // The status follows the food: firing a course onto a ticket that was
        // already ready or handed over puts it back into production.
        const status = orderStatusFromItems(items, o.status)
        const deliveryUpdate = o.type === 'delivery' && o.deliveryStatus === 'queued'
          ? { deliveryStatus: 'preparing', deliveryStatusAt: nowIso, preparingAt: nowIso }
          : {}
        return { ...o, items, status, sentAt: o.sentAt || nowIso, ...deliveryUpdate }
      })
      const sale = applyStockLines(state, saleMovements(state, totalDec, {
        ref: orderId,
        note: `fired ${heldItems.reduce((sum, item) => sum + item.qty, 0)} line(s)`,
      }), { at: nowIso, by: order.serverId || 'server' })
      const inventory = sale ? sale.inventory : state.inventory
      // Floor follows the ticket: first send moves seated -> ordered
      let tables = state.tables
      const table = state.tables.find((t) => t.id === order.tableId)
      if (table && table.status === 'seated') {
        tables = tables.map((t) =>
          t.id === table.id ? { ...t, status: 'ordered', currentCheckId: order.id } : t,
        )
      } else if (table && !table.currentCheckId) {
        tables = tables.map((t) =>
          t.id === table.id ? { ...t, currentCheckId: order.id } : t,
        )
      }
      const pendingUndo = {
        orderId,
        sentAt: nowIso,
        expiresAt: Date.now() + TARGETS.undoSendSeconds * 1000,
        itemIds: [...firedIds],
        restore: totalDec,
      }
      return {
        ...state,
        orders,
        inventory,
        movements: sale ? pushMovements(state, sale.movements) : state.movements,
        tables,
        pendingUndo,
      }
    }

    case 'GUEST_SEND': {
      // Atomic QR order: find-or-create the table's check (dine_in), OR create
      // a brand-new delivery/takeout order without any table (off-table path).
      // 86'd lines are skipped (the live menu hides them; this is the race guard).
      const {
        tableId,
        items = [],
        orderType = 'dine_in',
        customer = null,
        deliveryFee = 0,
        deliveryAddress = null,
        eta = null,
        orderId = null,
        guestToken = null,
      } = action
      const offTable = OFF_TABLE_TYPES.includes(orderType)

      // ── Off-table path (delivery / takeout) ────────────────────────────
      if (offTable) {
        const createdAt = new Date().toISOString()
        const nowIso = createdAt
        const inventoryById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))
        const sanitized = sanitizeCustomer(customer)
        // The guest keeps a client-generated id so the confirmation screen,
        // tracking tab, and bill all point at the order the reducer created.
        // A collision (replay) falls back to a fresh id instead of merging.
        const requestedId = String(orderId || '').trim().slice(0, 64)
        const id = requestedId && !state.orders.some((o) => o.id === requestedId)
          ? requestedId
          : uid('o')
        const token = String(guestToken || '').trim().slice(0, 64)
        const newOrder = {
          id,
          tableId: null,
          type: orderType,
          serverId: 'guest',
          status: 'open',
          createdAt,
          sentAt: nowIso,
          paidAt: null,
          voidReason: null,
          compTotal: 0,
          items: [],
          customer: sanitized,
          ...(token ? { guestToken: token } : {}),
          eta: eta || null,
          ...(orderType === 'delivery'
            ? {
              deliveryFee: Math.max(0, roundMoney(Number(deliveryFee) || 0)),
              deliveryStatus: 'queued',
              deliveryStatusAt: createdAt,
              deliveryAddress: deliveryAddress || sanitized?.address || null,
            }
            : {}),
        }
        const newLines = []
        const totalDec = {}
        for (const g of items) {
          const menuItem = state.menu.find((m) => m.id === g.menuItemId)
          if (!menuItem || !menuItem.available || menuItem.active === false) continue
          const qty = Math.min(12, Math.max(1, Number(g.qty) || 1))
          const recipe = state.recipes[g.menuItemId]
          const dec = theoreticalDecrementFor(recipe, qty)
          for (const [k, v] of Object.entries(dec)) {
            if (inventoryById[k]?.counted === false) continue
            totalDec[k] = (totalDec[k] || 0) + v
          }
          newLines.push({
            id: uid('it'), menuItemId: g.menuItemId, qty,
            modifiers: g.modifiers || [], station: menuItem.station, status: 'fired',
            course: g.course || 'main', notes: g.notes || '',
            by: 'guest', guest: g.guest || sanitized?.name || null, firedAt: nowIso,
            recipeSnapshot: recipe ? { ...recipe, plateCost: plateCostFor(recipe, inventoryById) } : null,
          })
        }
        if (!newLines.length) return state
        const filledOrder = {
          ...newOrder,
          items: newLines,
          status: orderStatusFromItems(newLines, 'open'),
        }
        const orders = capOrders([...state.orders, filledOrder])
        const sale = applyStockLines(state, saleMovements(state, totalDec, {
          ref: filledOrder.id,
          note: `${newLines.reduce((sum, l) => sum + l.qty, 0)} line(s) from guest ${orderType}`,
        }), { at: nowIso, by: 'guest' })
        const inventory = sale ? sale.inventory : state.inventory
        const pendingUndo = {
          orderId: filledOrder.id, sentAt: nowIso,
          expiresAt: Date.now() + TARGETS.undoSendSeconds * 1000,
          itemIds: newLines.map((l) => l.id), restore: totalDec,
        }
        return {
          ...state,
          orders,
          inventory,
          movements: sale ? pushMovements(state, sale.movements) : state.movements,
          pendingUndo,
        }
      }

      // ── Dine-in path (requires a seated table) ────────────────────────
      const table = state.tables.find((t) => t.id === tableId)
      if (!table || !['seated', 'ordered', 'occupied'].includes(table.status)) return state
      let order = state.orders.find(
        (o) => o.tableId === tableId && !['paid', 'void'].includes(o.status),
      )
      let orders = state.orders
      let tables = state.tables
      if (!order) {
        order = {
          id: uid('o'), tableId, type: 'dine_in', serverId: 'server', status: 'open',
          createdAt: new Date().toISOString(), sentAt: null, paidAt: null,
          voidReason: null, compTotal: 0, items: [],
        }
        orders = [...orders, order]
        tables = tables.map((t) => (t.id === tableId ? { ...t, currentCheckId: order.id } : t))
      }
      const nowIso = new Date().toISOString()
      const inventoryById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))
      const newLines = []
      const totalDec = {}
      for (const g of items) {
        const menuItem = state.menu.find((m) => m.id === g.menuItemId)
        if (!menuItem || !menuItem.available || menuItem.active === false) continue
        const qty = Math.min(12, Math.max(1, Number(g.qty) || 1))
        const recipe = state.recipes[g.menuItemId]
        const dec = theoreticalDecrementFor(recipe, qty)
        for (const [k, v] of Object.entries(dec)) {
          if (inventoryById[k]?.counted === false) continue // not counted: firing never moves the book
          totalDec[k] = (totalDec[k] || 0) + v
        }
        newLines.push({
          id: uid('it'), menuItemId: g.menuItemId, qty,
          modifiers: g.modifiers || [], station: menuItem.station, status: 'fired',
          course: g.course || 'main', notes: g.notes || '',
          by: 'guest', guest: g.guest || null, firedAt: nowIso,
          source: g.source || action.source || 'guest_qr',
          recipeSnapshot: recipe ? { ...recipe, plateCost: plateCostFor(recipe, inventoryById) } : null,
        })
      }
      if (!newLines.length) return state.orders === orders ? state : { ...state, orders, tables }
      orders = orders.map((o) => {
        if (o.id !== order.id) return o
        const items = [...o.items, ...newLines]
        return { ...o, items, status: orderStatusFromItems(items, o.status), sentAt: o.sentAt || nowIso }
      })
      const sale = applyStockLines(state, saleMovements(state, totalDec, {
        ref: order.id,
        note: `${newLines.reduce((sum, line) => sum + line.qty, 0)} line(s) from the QR menu`,
      }), { at: nowIso, by: 'guest' })
      const inventory = sale ? sale.inventory : state.inventory
      if (table.status === 'seated' || table.status === 'occupied') {
        tables = tables.map((t) =>
          t.id === tableId ? { ...t, status: 'ordered', currentCheckId: order.id } : t,
        )
      }
      const pendingUndo = {
        orderId: order.id, sentAt: nowIso,
        expiresAt: Date.now() + TARGETS.undoSendSeconds * 1000,
        itemIds: newLines.map((l) => l.id), restore: totalDec,
      }
      return {
        ...state,
        orders,
        inventory,
        movements: sale ? pushMovements(state, sale.movements) : state.movements,
        tables,
        pendingUndo,
      }
    }

    case 'UNDO_SEND': {
      const { orderId } = action
      const pu = state.pendingUndo
      if (!pu || pu.orderId !== orderId || Date.now() > pu.expiresAt) return state
      const ids = new Set(pu.itemIds)
      const undoneAt = new Date().toISOString()
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          ids.has(i.id) ? { ...i, status: 'held', firedAt: null, recipeSnapshot: null } : i,
        )
        const anyFired = items.some((i) => i.status === 'fired')
        const deliveryUpdate = o.type === 'delivery' && !anyFired && o.deliveryStatus === 'preparing'
          ? { deliveryStatus: 'queued', deliveryStatusAt: undoneAt, preparingAt: null }
          : {}
        return { ...o, items, status: anyFired ? o.status : 'open', sentAt: anyFired ? o.sentAt : null, ...deliveryUpdate }
      })
      // The fire never happened: put the stock back and drop the sale rows
      // it wrote, so the in/out report never counts a sale that was undone.
      const restored = applyStockLines(state, Object.entries(pu.restore || {})
        .filter(([, qty]) => Number(qty) > 0)
        .map(([inventoryItemId, qty]) => ({
          inventoryItemId,
          qty: roundQty(qty, 3),
          kind: 'adjust',
          ref: orderId,
          note: 'undo send',
          unitCost: 0,
        })), { by: 'server' })
      const movements = (state.movements || []).filter(
        (movement) => !(movement.ref === orderId && movement.kind === 'sale'),
      )
      const inventory = restored
        ? restored.inventory.map((item) => {
          // Undo restores quantity, never re-writes what a purchase cost.
          const before = state.inventory.find((entry) => entry.id === item.id)
          return { ...item, lastCost: before?.lastCost, avgCost: before?.avgCost }
        })
        : state.inventory
      // If nothing fired anymore, table drops back ordered -> seated (undo path)
      let tables = state.tables
      const order = state.orders.find((o) => o.id === orderId)
      const stillFired = orders
        .find((o) => o.id === orderId)
        ?.items.some((i) => i.status !== 'held')
      if (order && !stillFired) {
        tables = tables.map((t) =>
          t.id === order.tableId && t.status === 'ordered' ? { ...t, status: 'seated' } : t,
        )
      }
      return { ...state, orders, inventory, movements, tables, pendingUndo: null }
    }

    case 'EXPIRE_UNDO':
      return state.pendingUndo ? { ...state, pendingUndo: null } : state

    // ── Kitchen ────────────────────────────────────────────
    case 'BUMP_ITEM': {
      const { orderId, itemId } = action
      const nowIso = new Date().toISOString()
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          i.id === itemId && i.status === 'fired'
            ? { ...i, status: 'bump', bumpedAt: nowIso }
            : i,
        )
        // The status follows the food: the last line bumped makes the ticket
        // ready, and a voided line no longer holds it back.
        const status = orderStatusFromItems(items, o.status)
        const deliveryUpdate = o.type === 'delivery' && status === 'ready' && o.deliveryStatus === 'preparing'
          ? { deliveryStatus: 'ready', deliveryStatusAt: nowIso, readyAt: nowIso }
          : {}
        return { ...o, items, status, ...deliveryUpdate }
      })
      const recalls = {
        ...state.recalls,
        [`${orderId}:${itemId}`]: Date.now() + TARGETS.recallBumpSeconds * 1000,
      }
      return { ...state, orders, recalls }
    }

    case 'RECALL_ITEM': {
      const { orderId, itemId } = action
      const key = `${orderId}:${itemId}`
      if (!state.recalls[key] || Date.now() > state.recalls[key]) return state
      const nowIso = new Date().toISOString()
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          i.id === itemId && i.status === 'bump' ? { ...i, status: 'fired', bumpedAt: null } : i,
        )
        const deliveryUpdate = o.type === 'delivery' && o.deliveryStatus === 'ready'
          ? { deliveryStatus: 'preparing', deliveryStatusAt: nowIso, readyAt: null }
          : {}
        // A recalled line is back in the pan, so the ticket is in prep again.
        return { ...o, items, status: orderStatusFromItems(items, o.status), ...deliveryUpdate }
      })
      const recalls = { ...state.recalls }
      delete recalls[key]
      return { ...state, orders, recalls }
    }

    case 'SET_86': {
      const { menuItemId, available } = action
      const menu = state.menu.map((m) => (m.id === menuItemId ? { ...m, available } : m))
      return { ...state, menu }
    }

    // ── Pay / void / comp ──────────────────────────────────
    case 'SERVE_ORDER': {
      const { orderId } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order) return state
      // The machine is the only door: a ticket that is not ready cannot be
      // served, and nothing may still be in the pan when the plate lands.
      if (!canTicketTransition(order.status, 'served')) return state
      const stillCooking = (order.items || []).some((i) => !i.voided && i.status === 'fired')
      if (stillCooking) return state
      const orders = state.orders.map((o) =>
        o.id === orderId ? { ...o, status: 'served', servedAt: new Date().toISOString() } : o,
      )
      return { ...state, orders }
    }

    case 'SET_DELIVERY_STATUS': {
      const { orderId, status } = action
      const order = state.orders.find((entry) => entry.id === orderId)
      const nextStatus = { ready: 'out_for_delivery', out_for_delivery: 'delivered' }[order?.deliveryStatus]
      if (!order || order.type !== 'delivery' || order.status === 'void' || nextStatus !== status) return state
      const nowIso = new Date().toISOString()
      const timestampField = status === 'out_for_delivery' ? 'outForDeliveryAt' : 'deliveredAt'
      const orders = state.orders.map((entry) => entry.id === orderId
        ? { ...entry, deliveryStatus: status, deliveryStatusAt: nowIso, [timestampField]: nowIso }
        : entry)
      return { ...state, orders }
    }

    case 'VOID_ITEM': {
      // Manager void of one line (fired or held). The line stays for audit;
      // comps/voids are excluded from the bill. Held voids never touched stock.
      const { orderId, itemId, reason } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || ['paid', 'void'].includes(order.status)) return state
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        return {
          ...o,
          items: o.items.map((i) =>
            i.id === itemId ? { ...i, voided: true, voidReason: reason || 'manager void' } : i,
          ),
        }
      })
      return { ...state, orders }
    }

    case 'PAY_ORDER': {
      const { orderId, method = 'card', split = null, tip = 0, freeTable = false, tenderDetails = null, payments = null } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order) return state
      // One settlement per check. The machine is the only door into "paid",
      // so a second tap, a replayed action, or a second terminal cannot
      // move the money twice.
      if (!canTicketTransition(order.status, 'paid')) return state
      const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
      const tipAmount = roundMoney(Number(tip) || 0)
      // One charge sheet for the whole product: the same numbers the guest
      // saw at the till, the receipt prints, and the Sales Report reads.
      const charges = orderCharges(order, menuById, state.settings || {}, { tip: tipAmount })
      // `total` is the check value — goods, discount, service, tax, delivery.
      // The tip rides on top of it and is collected with it.
      const total = charges.total
      const finalPayments = Array.isArray(payments) && payments.length > 0
        ? payments
        : [{ method, amount: roundMoney(total + tipAmount), at: new Date().toISOString() }]
      const orders = state.orders.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: 'paid',
              paidAt: new Date().toISOString(),
              payMethod: method,
              split,
              tip: tipAmount,
              total,
              charges: {
                subtotal: charges.subtotal,
                discount: charges.discount,
                service: charges.service,
                tax: charges.tax,
                delivery: charges.delivery,
                total: charges.total,
                tip: tipAmount,
                grandTotal: charges.grandTotal,
              },
              tenderDetails,
              payments: finalPayments,
              billRequested: null,
            }
          : o,
      )
      // Table ordered -> billed; record the turn for host wait quotes.
      // `freeTable` (guest paid in the mini app) skips busing and releases it.
      let tables = state.tables
      let turnHistory = state.turnHistory
      const table = state.tables.find((t) => t.id === order.tableId)
      if (table) {
        const seatedMin = table.seatedAt ? minutesBetween(table.seatedAt) : table.targetTurnMinutes
        turnHistory = [...turnHistory.slice(-40), { partySize: table.partySize || 2, minutes: seatedMin }]
        tables = tables.map((t) => {
          if (t.id !== table.id) return t
          if (freeTable) {
            return { ...t, status: 'free', currentCheckId: null, seatedAt: null, partySize: null, seatedBy: null }
          }
          if (t.status === 'ordered' || t.status === 'seated') return { ...t, status: 'billed' }
          return t
        })
      }
      return { ...state, orders, tables, turnHistory }
    }

    case 'VOID_ORDER': {
      const { orderId, reason } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order) return state
      // A closed check is closed for good; a live one can be voided.
      if (!canTicketTransition(order.status, 'void')) return state
      const nowIso = new Date().toISOString()
      const orders = state.orders.map((o) => o.id === orderId
        ? {
          ...o,
          status: 'void',
          voidReason: reason || 'manager void',
          ...(o.type === 'delivery' ? { deliveryStatus: 'cancelled', deliveryStatusAt: nowIso } : {}),
        }
        : o)
      // Manager override: voided check sends the table back through bus flow
      const tables = state.tables.map((t) =>
        t.id === order.tableId ? { ...t, status: 'dirty', currentCheckId: null } : t,
      )
      return { ...state, orders, tables }
    }

    case 'COMP_ITEM': {
      const { orderId, itemId, reason } = action
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          i.id === itemId ? { ...i, comped: true, compReason: reason || 'comp' } : i,
        )
        return { ...o, items }
      })
      return { ...state, orders }
    }

    // ── Guest requests (QR ordering) ───────────────────────
    case 'REQUEST_BILL': {
      const { orderId } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || ['paid', 'void'].includes(order.status)) return state
      const orders = state.orders.map((o) =>
        o.id === orderId ? { ...o, billRequested: new Date().toISOString() } : o,
      )
      return { ...state, orders }
    }

    case 'CALL_SERVER': {
      const { tableId } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      const tables = state.tables.map((t) =>
        t.id === tableId ? { ...t, serverCalledAt: new Date().toISOString() } : t,
      )
      return { ...state, tables }
    }

    case 'ACK_REQUESTS': {
      const { orderId, tableId } = action
      const orders = orderId
        ? state.orders.map((o) => (o.id === orderId ? { ...o, billRequested: null } : o))
        : state.orders
      const tables = tableId
        ? state.tables.map((t) => (t.id === tableId ? { ...t, serverCalledAt: null } : t))
        : state.tables
      return { ...state, orders, tables }
    }

    // ── Host: reservations + waitlist ──────────────────────
    case 'ADD_RESERVATION': {
      const res = {
        id: uid('res'),
        status: 'booked',
        source: 'phone',
        tableId: null,
        notes: '',
        ...action.reservation,
      }
      return { ...state, reservations: [...state.reservations, res] }
    }

    case 'SET_RESERVATION': {
      const { id, patch } = action
      const reservations = state.reservations.map((r) => (r.id === id ? { ...r, ...patch } : r))
      return { ...state, reservations }
    }

    case 'RESCHEDULE_BOOKING': {
      const payload = action.payload || action
      const { bookingId, newDate, newTime, newPartySize, preferredTableId, actor = 'guest' } = payload
      const booking = (state.reservations || []).find((r) => String(r.id) === String(bookingId))
      if (!booking) return state

      // Parse target time (handle separate newDate & newTime or ISO newTime)
      let targetTime = newTime
      if (newDate && newTime && !String(newTime).includes('T')) {
        targetTime = new Date(`${newDate}T${newTime}`).toISOString()
      } else if (newTime) {
        targetTime = new Date(newTime).toISOString()
      } else {
        targetTime = booking.time
      }

      const bookingPolicy = state.settings?.booking || {
        allowGuestReschedule: true,
        allowGuestTableChange: true,
        rescheduleCutoffMinutes: 60,
        defaultBookingDurationMinutes: 90,
        maxGuestReschedules: 2,
      }

      // Guest self-service validation guards
      if (actor === 'guest') {
        if (bookingPolicy.allowGuestReschedule === false) {
          throw new Error('Guest rescheduling is disabled by restaurant policy.')
        }
        const modCount = Number(booking.modificationCount) || 0
        const maxMods = Number(bookingPolicy.maxGuestReschedules) || 2
        if (modCount >= maxMods) {
          throw new Error(`Maximum self-service reschedule limit (${maxMods}) reached. Please contact restaurant staff.`)
        }
        const cutoffMin = Number(bookingPolicy.rescheduleCutoffMinutes) || 60
        const currentBookingMs = new Date(booking.time).getTime()
        const minsUntil = (currentBookingMs - Date.now()) / 60000
        if (minsUntil < cutoffMin) {
          throw new Error(`Modifications cannot be made within ${cutoffMin} minutes of reservation time. Please contact restaurant staff.`)
        }
      }

      const party = Number(newPartySize || booking.partySize) || 2
      const durMin = Number(bookingPolicy.defaultBookingDurationMinutes) || 90

      // Table reassignment logic: check preferred table or smart auto-reassign
      let targetTableId = preferredTableId !== undefined ? preferredTableId : booking.tableId
      if (targetTableId) {
        const isPrefAvail = isTableAvailable(state, {
          tableId: targetTableId,
          time: targetTime,
          durationMinutes: durMin,
          excludeBookingId: booking.id,
        })
        if (!isPrefAvail) {
          // Auto-reassign to equivalent available table
          const available = findAvailableTablesForSlot(state, {
            time: targetTime,
            partySize: party,
            durationMinutes: durMin,
            excludeBookingId: booking.id,
          })
          targetTableId = available[0]?.id || null
          // If preferred was explicitly requested and no tables open at all, block
          if (!targetTableId && preferredTableId) {
            throw new Error('Preferred table is not available at the selected time.')
          }
        }
      } else {
        const available = findAvailableTablesForSlot(state, {
          time: targetTime,
          partySize: party,
          durationMinutes: durMin,
          excludeBookingId: booking.id,
        })
        targetTableId = available[0]?.id || null
      }

      const prevTable = (state.tables || []).find((t) => String(t.id) === String(booking.tableId))
      const newTable = (state.tables || []).find((t) => String(t.id) === String(targetTableId))
      const nowIso = new Date().toISOString()

      const updatedBooking = {
        ...booking,
        time: targetTime,
        partySize: party,
        tableId: targetTableId,
        updatedAt: nowIso,
        modificationCount: (Number(booking.modificationCount) || 0) + 1,
        previousSlot: {
          time: booking.time,
          tableId: booking.tableId,
          partySize: booking.partySize,
        },
      }

      const reservations = state.reservations.map((r) =>
        String(r.id) === String(booking.id) ? updatedBooking : r,
      )

      // Adjust table status if table changed
      let tables = state.tables
      if (booking.tableId && booking.tableId !== targetTableId) {
        tables = tables.map((t) => {
          if (t.id === booking.tableId && t.status === 'reserved') {
            return { ...t, status: 'available' }
          }
          return t
        })
      }

      return {
        ...state,
        reservations,
        tables,
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'BOOKING_RESCHEDULED',
            bookingId: booking.id,
            guestName: booking.name,
            oldTime: booking.time,
            newTime: targetTime,
            oldTable: prevTable?.name || 'Unassigned',
            newTable: newTable?.name || 'Unassigned',
            detail: `${booking.name} rescheduled: ${booking.time} (${prevTable?.name || 'Unassigned'}) ➔ ${targetTime} (${newTable?.name || 'Unassigned'})`,
            timestamp: nowIso,
          },
          ...(state.movements || []),
        ],
      }
    }

    case 'CHANGE_BOOKING_TABLE': {
      const payload = action.payload || action
      const { bookingId, newTableId, actor = 'guest' } = payload
      const booking = (state.reservations || []).find((r) => String(r.id) === String(bookingId))
      if (!booking) return state

      const bookingPolicy = state.settings?.booking || { allowGuestTableChange: true }
      if (actor === 'guest' && bookingPolicy.allowGuestTableChange === false) {
        throw new Error('Guest table selection is disabled by restaurant policy.')
      }

      if (newTableId) {
        const isAvail = isTableAvailable(state, {
          tableId: newTableId,
          time: booking.time,
          durationMinutes: bookingPolicy.defaultBookingDurationMinutes || 90,
          excludeBookingId: booking.id,
        })
        if (!isAvail) {
          throw new Error('Selected table is not available for this reservation window.')
        }
      }

      const nowIso = new Date().toISOString()
      const prevTable = (state.tables || []).find((t) => String(t.id) === String(booking.tableId))
      const newTable = (state.tables || []).find((t) => String(t.id) === String(newTableId))

      const updatedBooking = {
        ...booking,
        tableId: newTableId,
        updatedAt: nowIso,
        modificationCount: (Number(booking.modificationCount) || 0) + 1,
        previousSlot: {
          time: booking.time,
          tableId: booking.tableId,
          partySize: booking.partySize,
        },
      }

      return {
        ...state,
        reservations: state.reservations.map((r) =>
          String(r.id) === String(booking.id) ? updatedBooking : r,
        ),
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'BOOKING_TABLE_CHANGED',
            bookingId: booking.id,
            guestName: booking.name,
            oldTable: prevTable?.name || 'Unassigned',
            newTable: newTable?.name || 'Unassigned',
            detail: `${booking.name} changed table: ${prevTable?.name || 'Unassigned'} ➔ ${newTable?.name || 'Unassigned'}`,
            timestamp: nowIso,
          },
          ...(state.movements || []),
        ],
      }
    }

    case 'REQUEST_TABLE_TRANSFER': {
      const payload = action.payload || action
      const { currentTableId, targetTableId, reason = '', sessionToken } = payload
      const currentTable = (state.tables || []).find((t) => String(t.id) === String(currentTableId))
      const targetTable = (state.tables || []).find((t) => String(t.id) === String(targetTableId))
      if (!currentTable || !targetTable) return state

      // Ownership guard
      if (sessionToken && currentTable.sessionToken && currentTable.sessionToken !== sessionToken) {
        return state
      }

      const nowIso = new Date().toISOString()
      const transferReq = {
        targetTableId,
        targetTableName: targetTable.name || targetTableId,
        reason: reason?.trim() || 'Guest requested table change',
        requestedAt: nowIso,
        status: 'pending',
      }

      return {
        ...state,
        tables: state.tables.map((t) =>
          String(t.id) === String(currentTableId)
            ? { ...t, pendingTransfer: transferReq }
            : t,
        ),
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'TABLE_TRANSFER_REQUESTED',
            tableId: currentTableId,
            targetTableId,
            guestName: currentTable.guestName || 'Guest',
            fromTable: currentTable.name || currentTableId,
            toTable: targetTable.name || targetTableId,
            reason: transferReq.reason,
            detail: `${currentTable.name || currentTableId} requested move to ${targetTable.name || targetTableId} (${transferReq.reason})`,
            timestamp: nowIso,
          },
          ...(state.movements || []),
        ],
      }
    }

    case 'REJECT_TABLE_TRANSFER': {
      const payload = action.payload || action
      const { currentTableId, reason = '' } = payload
      const currentTable = (state.tables || []).find((t) => String(t.id) === String(currentTableId))
      if (!currentTable) return state

      const nowIso = new Date().toISOString()
      return {
        ...state,
        tables: state.tables.map((t) =>
          String(t.id) === String(currentTableId)
            ? { ...t, pendingTransfer: null }
            : t,
        ),
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'TABLE_TRANSFER_REJECTED',
            tableId: currentTableId,
            detail: `Move request for ${currentTable.name || currentTableId} rejected${reason ? `: ${reason}` : ''}`,
            timestamp: nowIso,
          },
          ...(state.movements || []),
        ],
      }
    }

    case 'APPROVE_TABLE_TRANSFER':
    case 'TRANSFER_TABLE': {
      const payload = action.payload || action
      const { currentTableId, targetTableId, reason = '', actor = 'staff' } = payload
      const currentTable = (state.tables || []).find((t) => String(t.id) === String(currentTableId))
      const targetTable = (state.tables || []).find((t) => String(t.id) === String(targetTableId))
      if (!currentTable || !targetTable) return state

      const nowIso = new Date().toISOString()

      // Check whether guest had active tickets or ordered food
      const orderList = state.orders || []
      const hasOrderedItems = orderList.some(
        (o) =>
          String(o.tableId) === String(currentTableId) &&
          !['paid', 'void', 'closed'].includes(o.status) &&
          (o.items || []).some((i) => i.status === 'fired' || i.status === 'bump'),
      )

      // Rebind active tickets/orders and their items to the target table
      const migrateOrder = (order) => {
        if (String(order.tableId) !== String(currentTableId) || ['paid', 'void', 'closed'].includes(order.status)) {
          return order
        }
        return {
          ...order,
          tableId: targetTableId,
          transferredFromTableId: currentTableId,
          transferredAt: nowIso,
          items: (order.items || []).map((item) => ({
            ...item,
            transferredFromTableId: currentTableId,
            transferredAt: nowIso,
          })),
        }
      }

      const nextOrders = (state.orders || []).map(migrateOrder)
      const nextTickets = state.tickets ? state.tickets.map(migrateOrder) : undefined

      // Old table transitions to cleaning if items were already fired, else available
      const oldTableNextStatus = hasOrderedItems ? 'cleaning' : 'available'

      const nextTables = state.tables.map((t) => {
        if (String(t.id) === String(currentTableId)) {
          return {
            ...t,
            status: oldTableNextStatus,
            guestName: null,
            partySize: null,
            guestPhone: null,
            sessionToken: null,
            seatedAt: null,
            selfSeated: false,
            pendingTransfer: null,
            currentCheckId: null,
          }
        }
        if (String(t.id) === String(targetTableId)) {
          return {
            ...t,
            status: currentTable.status === 'ordered' ? 'ordered' : 'occupied',
            guestName: currentTable.guestName,
            partySize: currentTable.partySize,
            guestPhone: currentTable.guestPhone,
            sessionToken: currentTable.sessionToken,
            seatedAt: currentTable.seatedAt || nowIso,
            selfSeated: currentTable.selfSeated,
            lastActivityAt: nowIso,
            pendingTransfer: null,
            transferredFromTableId: currentTableId,
            transferredAt: nowIso,
          }
        }
        return t
      })

      // Link any reservations currently referencing currentTableId to targetTableId
      const nextReservations = (state.reservations || []).map((r) =>
        String(r.tableId) === String(currentTableId) && r.status === 'booked'
          ? { ...r, tableId: targetTableId, updatedAt: nowIso }
          : r,
      )

      const nextState = {
        ...state,
        tables: nextTables,
        orders: nextOrders,
        reservations: nextReservations,
        movements: [
          {
            id: `mov-${Date.now()}`,
            type: 'TABLE_TRANSFERRED',
            fromTableId: currentTableId,
            toTableId: targetTableId,
            fromTable: currentTable.name || currentTableId,
            toTable: targetTable.name || targetTableId,
            guestName: currentTable.guestName || 'Guest',
            detail: `Table transferred: ${currentTable.name || currentTableId} ➔ ${targetTable.name || targetTableId} (${actor})${reason ? ` - ${reason}` : ''}`,
            timestamp: nowIso,
          },
          ...(state.movements || []),
        ],
      }
      if (nextTickets) nextState.tickets = nextTickets
      return nextState
    }

    case 'ADD_WAITLIST': {
      const entry = { id: uid('wl'), addedAt: new Date().toISOString(), ...action.entry }
      return { ...state, waitlist: [...state.waitlist, entry] }
    }

    case 'REMOVE_WAITLIST': {
      return { ...state, waitlist: state.waitlist.filter((w) => w.id !== action.id) }
    }

    // ── Inventory ──────────────────────────────────────────
    case 'RECEIVE_INVOICE': {
      // Quick delivery without a purchase order. lines:
      // [{inventoryItemId, qty, unitCost}] · supplierId links the delivery
      // to a vendor row so spend and reorder lists stay honest.
      const { vendor, lines = [], supplierId = null } = action
      const precision = Math.trunc(Number(state.settings?.stock?.autoReceiveThousandths) || 2)
      const received = lines
        .map((line) => {
          const item = state.inventory.find((entry) => entry.id === line.inventoryItemId)
          const qty = roundQty(line.qty, precision)
          if (!item || !(qty > 0)) return null
          const unitCost = Number.isFinite(Number(line.unitCost)) && Number(line.unitCost) >= 0
            ? Number(line.unitCost)
            : Number(item.lastCost) || 0
          return { inventoryItemId: item.id, qty, unitCost, name: item.name }
        })
        .filter(Boolean)
      if (!received.length) return state

      const at = new Date().toISOString()
      const supplier = state.suppliers.find((entry) => entry.id === supplierId)
      const intake = applyStockLines(
        state,
        received.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          qty: line.qty,
          unitCost: line.unitCost,
          kind: 'buy',
          ref: action.purchaseId || null,
          note: vendor || supplier?.name || 'delivery',
          name: line.name,
        })),
        { at, by: action.by || 'staff', allowNegative: true },
      )
      const inventory = intake.inventory.map((item) => {
        const line = received.find((entry) => entry.inventoryItemId === item.id)
        if (!line) return item
        return {
          ...item,
          vendor: vendor || item.vendor,
          supplierId: supplierId || item.supplierId,
          incoming: Math.max(0, roundQty((Number(item.incoming) || 0) - line.qty, precision)),
        }
      })
      const total = Math.round(received.reduce((sum, line) => sum + line.qty * line.unitCost, 0) * 100) / 100
      const invoiceLog = [
        ...state.invoiceLog,
        {
          id: uid('invlog'),
          vendor: vendor || supplier?.name || 'Vendor',
          supplierId: supplierId || null,
          at,
          lines: received.map(({ inventoryItemId, qty, unitCost }) => ({ inventoryItemId, qty, unitCost })),
          total,
        },
      ]
      // Auto-86 is re-evaluated by the shopReducer wrapper right after this
      // case runs; manual 86 flags stay put until a manager clears them.
      return {
        ...state,
        inventory,
        movements: pushMovements(state, intake.movements),
        invoiceLog,
      }
    }

    // ── Purchases: buy items into stock ───────────────────────────────
    case 'UPSERT_PURCHASE': {
      const draft = normalizePurchase(
        action.purchase,
        state.purchases?.find((entry) => entry.id === action.purchase?.id),
        uid('po'),
      )
      if (!draft) return state
      if (draft.supplierId && !state.suppliers.some((entry) => entry.id === draft.supplierId)) {
        draft.supplierId = null
      }
      // A received or cancelled purchase is history — only status changes
      // and deletion are allowed from here on.
      const existing = state.purchases?.find((entry) => entry.id === draft.id)
      if (existing && ['received', 'cancelled'].includes(existing.status) && draft.status === existing.status) {
        return state
      }
      const supplier = state.suppliers.find((entry) => entry.id === draft.supplierId)
      draft.vendor = draft.vendor || supplier?.name || 'Vendor'
      // Freeze what one line unit holds *now*, so a later packaging edit never
      // rewrites the meaning of an order that was already placed.
      draft.lines = draft.lines.map((line) => {
        const item = state.inventory.find((entry) => entry.id === line.inventoryItemId)
        return { ...line, packSize: item ? packFactor(item, line.unit) : line.packSize || 1 }
      })
      if (!draft.number) {
        const counter = state.settings?.numbering?.purchase
        draft.number = documentNumber(
          state.settings,
          'purchase',
          counter?.next || 1,
        )
      }
      const purchases = existing
        ? state.purchases.map((entry) => (entry.id === draft.id ? draft : entry))
        : [...(state.purchases || []), draft]
      // The number sequence only advances for purchases that were really filed.
      const settings = existing
        ? state.settings
        : bumpPurchaseNumber(state.settings, draft.number)
      return { ...state, purchases, settings }
    }

    case 'SET_PURCHASE_STATUS': {
      const purchase = state.purchases?.find((entry) => entry.id === action.purchaseId)
      if (!purchase) return state
      const status = PURCHASE_STATUSES.includes(action.status) ? action.status : null
      if (!status || status === 'received' || purchase.status === 'received') return state
      const nowIso = new Date().toISOString()
      const purchases = state.purchases.map((entry) => (
        entry.id === purchase.id
          ? {
            ...entry,
            status,
            updatedAt: nowIso,
            orderedAt: status === 'ordered' ? (entry.orderedAt || nowIso) : entry.orderedAt,
          }
          : entry
      ))
      return { ...state, purchases }
    }

    case 'RECEIVE_PURCHASE': {
      const purchase = state.purchases?.find((entry) => entry.id === action.purchaseId)
      if (!purchase || purchase.status === 'received' || purchase.status === 'cancelled') return state
      const precision = Math.trunc(Number(state.settings?.stock?.autoReceiveThousandths) || 2)
      // Receiving may be partial: only lines flagged received (or all of them).
      const wanted = Array.isArray(action.lines) && action.lines.length
        ? action.lines
        : purchase.lines
      const received = wanted
        .map((line) => {
          const source = purchase.lines.find((entry) => entry.id === line.id)
            || purchase.lines.find((entry) => entry.inventoryItemId === line.inventoryItemId)
          const item = state.inventory.find((entry) => entry.id === source?.inventoryItemId)
          const orderedQty = roundQty(line.qty ?? source?.qty, precision)
          if (!item || !(orderedQty > 0)) return null
          const unit = line.unit ?? source?.unit
          // One case of salmon is not one salmon: convert the ordered line
          // into stock units before it touches on-hand or the ledger.
          const packSize = Number(line.packSize ?? source?.packSize) > 0
            ? Number(line.packSize ?? source?.packSize)
            : packFactor(item, unit)
          const qty = roundQty(orderedQty * packSize, precision)
          if (!(qty > 0)) return null
          const orderedCost = Number.isFinite(Number(line.unitCost)) && Number(line.unitCost) >= 0
            ? Number(line.unitCost)
            : Number(source?.unitCost) || packPriceFromItem(item, packSize)
          const unitCost = Math.round((orderedCost / packSize) * 10000) / 10000
          return {
            inventoryItemId: item.id,
            qty,
            orderedQty,
            unitCost,
            orderedCost,
            packSize,
            unit: slugUnitId(unit) || item.unit,
            name: item.name,
            source,
          }
        })
        .filter(Boolean)
      if (!received.length) return state

      const at = new Date().toISOString()
      const by = action.by || 'staff'
      const supplier = state.suppliers.find((entry) => entry.id === purchase.supplierId)
      const intake = applyStockLines(
        state,
        received.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          qty: line.qty,
          unitCost: line.unitCost,
          kind: 'buy',
          ref: purchase.id,
          note: line.packSize > 1
            ? `${purchase.number} · ${line.orderedQty} ${line.unit} @ ${line.packSize}/unit`
            : purchase.number,
          name: line.name,
        })),
        { at, by, allowNegative: true },
      )
      const inventory = intake.inventory.map((item) => {
        const line = received.find((entry) => entry.inventoryItemId === item.id)
        if (!line) return item
        return {
          ...item,
          vendor: purchase.vendor || supplier?.name || item.vendor,
          supplierId: purchase.supplierId || item.supplierId,
          incoming: Math.max(0, roundQty((Number(item.incoming) || 0) - line.qty, precision)),
          // The book now knows how this item arrives: keep the pack the last
          // delivery used as the item's default purchase unit.
          purchaseUnit: line.unit || item.purchaseUnit || null,
        }
      })

      const lines = purchase.lines.map((line) => {
        const hit = received.find((entry) => entry.source?.id === line.id)
        if (!hit) return line
        // Received quantities stay in the unit that was ordered — the
        // purchase reads "6 of 10 cases", while stock took 72 stock units.
        return {
          ...line,
          packSize: hit.packSize,
          unitCost: hit.orderedCost,
          receivedQty: roundQty((Number(line.receivedQty) || 0) + hit.orderedQty, precision),
          receivedBaseQty: roundQty((Number(line.receivedBaseQty) || 0) + hit.qty, precision),
        }
      })
      const fullyReceived = lines.every((line) => line.receivedQty >= line.qty)
      const nextPurchase = {
        ...purchase,
        lines,
        status: fullyReceived ? 'received' : 'ordered',
        receivedAt: at,
        updatedAt: at,
      }
      const receivedTotal = Math.round(received.reduce((sum, line) => sum + line.orderedQty * line.orderedCost, 0) * 100) / 100
      const invoiceLog = [
        ...state.invoiceLog,
        {
          id: uid('invlog'),
          vendor: purchase.vendor || supplier?.name || 'Vendor',
          supplierId: purchase.supplierId || null,
          at,
          purchaseId: purchase.id,
          reference: purchase.reference || purchase.number,
          // `qty` / `unitCost` are stock units (what the ledger used); the
          // ordered pair keeps the invoice readable in the unit the vendor
          // actually billed.
          lines: received.map(({ inventoryItemId, qty, orderedQty, unit, packSize, unitCost, orderedCost }) => ({
            inventoryItemId,
            qty,
            orderedQty,
            unit,
            packSize,
            unitCost,
            orderedCost,
            orderedTotal: Math.round(orderedQty * orderedCost * 100) / 100,
          })),
          total: receivedTotal,
        },
      ]
      return {
        ...state,
        inventory,
        purchases: state.purchases.map((entry) => (entry.id === purchase.id ? nextPurchase : entry)),
        movements: pushMovements(state, intake.movements),
        invoiceLog,
      }
    }

    case 'DELETE_PURCHASE': {
      const purchase = state.purchases?.find((entry) => entry.id === action.purchaseId)
      // Received purchases are stock history — cancel, never delete.
      if (!purchase || (purchase.status === 'received' && !action.force)) return state
      return { ...state, purchases: state.purchases.filter((entry) => entry.id !== purchase.id) }
    }

    case 'LOG_WASTE': {
      const { inventoryItemId, reason } = action
      const item = state.inventory.find((i) => i.id === inventoryItemId)
      if (!item) return state
      const precision = Math.trunc(Number(state.settings?.stock?.autoReceiveThousandths) || 2)
      const requested = roundQty(action.qty, precision)
      if (!(requested > 0)) return state
      // Policy: when negative stock is off, you can only waste what you have.
      const allowNegative = state.settings?.stock?.allowNegativeStock === true
      const qty = allowNegative ? requested : Math.min(requested, Number(item.onHand) || 0)
      if (!(qty > 0)) return state
      const at = new Date().toISOString()
      const waste = applyStockLines(state, [{
        inventoryItemId,
        qty: -qty,
        kind: 'waste',
        ref: null,
        note: reason || '',
      }], { at, by: action.by || 'staff', allowNegative })
      const inventory = waste ? waste.inventory : state.inventory
      const wasteLog = [
        ...state.wasteLog,
        {
          id: uid('w'), inventoryItemId, qty, reason,
          at,
          by: action.by || 'staff',
          value: Math.round(qty * (Number(item.lastCost) || 0) * 100) / 100,
        },
      ]
      return {
        ...state,
        inventory,
        movements: waste ? pushMovements(state, waste.movements) : state.movements,
        wasteLog,
      }
    }

    case 'COUNT_STOCK': {
      // Close count sets counted on-hand directly; the difference against
      // the book becomes a signed count movement so shrinkage is visible.
      const { counts } = action // { inventoryItemId: qty }
      const lines = state.inventory
        .filter((item) => item.counted !== false && counts?.[item.id] != null)
        .map((item) => ({
          inventoryItemId: item.id,
          qty: roundQty(Number(counts[item.id]) - Number(item.onHand), 3),
          kind: 'count',
          note: action.note || '',
        }))
        .filter((line) => line.qty !== 0)
      const counted = applyStockLines(state, lines, { by: action.by || 'staff', allowNegative: true })
      const inventory = counted
        ? counted.inventory.map((item) => {
          // A count corrects quantity — it never re-prices the item.
          const before = state.inventory.find((entry) => entry.id === item.id)
          return before ? { ...item, lastCost: before.lastCost, avgCost: before.avgCost } : item
        })
        : state.inventory
      return {
        ...state,
        inventory,
        movements: counted ? pushMovements(state, counted.movements) : state.movements,
      }
    }

    // ── Menu / costing ─────────────────────────────────────
    case 'ADD_MENU_ITEM': {
      const raw = action.item
      if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return state
      if (state.menu.some((item) => item.id === raw.id.trim())) return state
      const item = normalizeMenuItem(raw, state.menu.length)
      if (!uniqueMenuName(state.menu, item.id, item.name)) return state
      const recipe = {
        id: `r_${item.id}`,
        yieldPortions: 1,
        prepNotes: '',
        ingredients: [],
        ...(action.recipe || {}),
      }
      return {
        ...state,
        menu: [...state.menu, item],
        recipes: { ...state.recipes, [item.id]: recipe },
      }
    }

    case 'UPDATE_MENU_ITEM': {
      const { menuItemId, patch = {} } = action
      const current = state.menu.find((item) => item.id === menuItemId)
      if (!current || !patch || typeof patch !== 'object') return state
      if ('name' in patch && !String(patch.name ?? '').trim()) return state
      if ('category' in patch && !String(patch.category ?? '').trim()) return state
      if ('price' in patch) {
        const price = Number(patch.price)
        if (!Number.isFinite(price) || price < 0 || price > MAX_MENU_PRICE) return state
      }
      const nextItem = normalizeMenuItem({ ...current, ...patch, id: current.id }, current.sortOrder)
      if (!uniqueMenuName(state.menu, current.id, nextItem.name)) return state
      const menu = state.menu.map((item) => (item.id === current.id ? nextItem : item))
      return { ...state, menu }
    }

    case 'UPDATE_RECIPE': {
      const { menuItemId, recipe } = action
      return { ...state, recipes: { ...state.recipes, [menuItemId]: recipe } }
    }

    case 'UPDATE_PRICE': {
      const { menuItemId, price } = action
      const numericPrice = Number(price)
      if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice > MAX_MENU_PRICE) return state
      const menu = state.menu.map((m) =>
        m.id === menuItemId
          ? { ...m, price: Math.round(numericPrice * 100) / 100 }
          : m,
      )
      return { ...state, menu }
    }

    // Cross-branch menu push (Settings → Branches): another branch's menu and
    // category tree replace this shop's, run through the same guards as
    // ADD_MENU_ITEM (ids unique, names unique, prices clamped). Availability is
    // per-branch service state, so pushed items arrive sellable and each
    // branch's own 86 board stays its own. Recipes stay per branch — they
    // follow local suppliers and stock, so they are never pushed.
    case 'REPLACE_MENU': {
      const incoming = Array.isArray(action.menu) ? action.menu : null
      if (!incoming || !incoming.length) return state
      const seenIds = new Set()
      const seenNames = new Set()
      const menu = []
      for (const raw of incoming) {
        if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue
        const id = raw.id.trim()
        if (seenIds.has(id)) continue
        const item = normalizeMenuItem({ ...raw, id }, menu.length)
        const name = item.name.toLocaleLowerCase()
        if (!name || seenNames.has(name)) continue
        seenIds.add(id)
        seenNames.add(name)
        menu.push({ ...item, available: true, auto86: false, auto86At: null })
      }
      if (!menu.length) return state
      let categories = state.categories
      if (Array.isArray(action.categories) && action.categories.length) {
        const normalized = action.categories
          .map((raw, index) => normalizeCategory(raw, index))
          .filter(Boolean)
        const seenCatIds = new Set()
        // A pushed tree must stay a tree: no duplicate nodes, and every parent
        // link points at a category that actually travelled (cycles broken).
        const keep = normalized.filter((category) => {
          if (seenCatIds.has(category.id)) return false
          seenCatIds.add(category.id)
          return true
        })
        const byId = new Map(keep.map((category) => [category.id, category]))
        for (const category of keep) {
          const seen = new Set([category.id])
          let parent = category.parentId
          while (parent) {
            if (seen.has(parent)) { category.parentId = null; break }
            seen.add(parent)
            parent = byId.get(parent)?.parentId || null
          }
          if (category.parentId && !byId.has(category.parentId)) category.parentId = null
        }
        if (keep.length) categories = keep
      }
      return { ...state, menu, categories }
    }

    // ── Configuration: settings, templates, catalog, suppliers ──
    case 'UPDATE_SETTINGS': {
      const patch = action.patch
      if (!patch || typeof patch !== 'object') return state
      const settings = mergeSettings(state.settings, patch)
      // Saving without changing anything must not rewrite the snapshot —
      // compare everything except the bookkeeping stamps.
      const STAMPS = ['updatedAt', 'updatedBy']
      const comparable = (value) => JSON.stringify(
        Object.fromEntries(Object.entries(value).filter(([key]) => !STAMPS.includes(key))),
      )
      if (comparable(settings) === comparable(state.settings)) return state
      return { ...state, settings }
    }

    case 'RESET_SETTINGS': {
      const section = String(action.section || 'all')
      const defaults = defaultSettings(state.settings?.locationShort || 'Downtown')
      const keys = {
        all: Object.keys(defaults),
        business: ['restaurantName', 'legalName', 'tagline', 'description', 'logoUrl', 'logoInitials', 'brandColor', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country', 'phone', 'email', 'website', 'taxId'],
        money: ['baseCurrency', 'currency', 'currencies', 'locale', 'timezone', 'dateFormat', 'timeFormat', 'numberFormat', 'measurement', 'taxLabel', 'taxPct', 'pricesIncludeTax', 'servicePct', 'serviceLabel', 'serviceTaxable', 'rounding'],
        documents: ['templates', 'documentCurrency', 'numbering', 'footerNote'],
        stock: ['stock'],
        pos: ['pos'],
        notifications: ['notifications'],
        targets: ['targetTurnMinutes', 'ticketMinutes', 'foodCostCap', 'rushHour'],
      }[section]
      if (!keys) return state
      const patch = Object.fromEntries(keys.map((key) => [key, defaults[key]]))
      const settings = mergeSettings(state.settings, { ...patch, updatedBy: action.by || 'owner' })
      return { ...state, settings }
    }

    case 'UPDATE_TEMPLATE': {
      const kind = DOC_KINDS.includes(action.kind) ? action.kind : null
      if (!kind) return state
      const current = state.settings.templates[kind]
      const next = sanitizeTemplate({ ...current, ...(action.patch || {}) }, kind)
      next.updatedAt = new Date().toISOString()
      if (JSON.stringify(next) === JSON.stringify(current)) return state
      return {
        ...state,
        settings: { ...state.settings, templates: { ...state.settings.templates, [kind]: next } },
      }
    }

    case 'UPSERT_CATEGORY': {
      const raw = action.category
      if (!raw || typeof raw !== 'object') return state
      const current = raw.id ? categoryById(state.categories, raw.id) : null
      const parentId = raw.parentId ? String(raw.parentId) : null
      if (parentId) {
        const parent = categoryById(state.categories, parentId)
        if (!parent || parent.kind !== (raw.kind || current?.kind || 'menu')) return state
        // Guard against cycles: a node can never sit under its own subtree.
        const blocked = new Set(descendantCategoryIds(state.categories, raw.id || '__new__'))
        if (blocked.has(parentId)) return state
      }
      const candidate = normalizeCategory(
        { ...current, ...raw, parentId },
        current?.sortOrder ?? state.categories.length,
      )
      if (!candidate) return state
      candidate.id = raw.id && current ? current.id : (raw.id || candidate.id)
      const siblings = state.categories.filter(
        (category) => category.id !== candidate.id
          && category.kind === candidate.kind
          && (category.parentId || null) === (candidate.parentId || null),
      )
      if (siblings.some((category) => category.name.toLowerCase() === candidate.name.toLowerCase())) return state
      const exists = state.categories.some((category) => category.id === candidate.id)
      const categories = exists
        ? state.categories.map((category) => (category.id === candidate.id ? candidate : category))
        : [...state.categories, candidate]
      if (current && current.name !== candidate.name) {
        // Renaming a category re-labels the items that reference it.
        return { ...state, categories, ...relabelCategoryItems(state, current, candidate) }
      }
      return { ...state, categories }
    }

    case 'DELETE_CATEGORY': {
      const node = categoryById(state.categories, action.categoryId)
      if (!node) return state
      const ids = descendantCategoryIds(state.categories, node.id)
      const removed = state.categories.filter((category) => ids.includes(category.id))
      const names = new Set(removed.map((category) => category.name))
      const target = action.moveTo ? categoryById(state.categories, action.moveTo) : null
      if (action.moveTo && !target) return state
      const touches = (item) => names.has(item.category) || names.has(item.subCategory)
      if (!target && (
        state.menu.some(touches)
        || state.inventory.some(touches)
        || removed.some((category) => state.categories.some((child) => child.parentId === category.id))
      )) return state // caller must move items / children first
      const categories = state.categories.filter((category) => !ids.includes(category.id))
      if (!target) return { ...state, categories }
      return { ...state, categories, ...relabelCategoryItems(state, removed, target) }
    }

    case 'REORDER_CATEGORIES': {
      const ids = Array.isArray(action.categoryIds) ? action.categoryIds : []
      if (!ids.length) return state
      const idMap = new Map(ids.map((id, index) => [id, index]))
      const categories = state.categories.map((c) => {
        if (idMap.has(c.id)) {
          return { ...c, sortOrder: idMap.get(c.id) }
        }
        return c
      })
      return { ...state, categories }
    }

    case 'REORDER_MENU_ITEMS': {
      const ids = Array.isArray(action.itemIds) ? action.itemIds : []
      if (!ids.length) return state
      const idMap = new Map(ids.map((id, index) => [id, index]))
      const menu = state.menu.map((item) => {
        if (idMap.has(item.id)) {
          return { ...item, sortOrder: idMap.get(item.id) }
        }
        return item
      })
      return { ...state, menu }
    }

    case 'MOVE_CATEGORY_ITEMS': {
      const { fromCategory, fromSubCategory = '', toCategory, toSubCategory = '' } = action
      if (!fromCategory || !toCategory) return state
      const relabel = (item) => {
        const matchesCat = String(item.category || '').toLowerCase() === fromCategory.toLowerCase()
        const matchesSub = !fromSubCategory || String(item.subCategory || '').toLowerCase() === fromSubCategory.toLowerCase()
        if (!matchesCat || !matchesSub) return item
        return { ...item, category: toCategory, subCategory: toSubCategory }
      }
      return {
        ...state,
        menu: state.menu.map(relabel),
        inventory: state.inventory.map(relabel),
      }
    }

    case 'UPSERT_SUPPLIER': {
      const raw = action.supplier
      if (!raw || typeof raw !== 'object') return state
      const existing = state.suppliers.find((supplier) => supplier.id === raw.id)
      const { _existing, ...cleaned } = sanitizeSupplier({ ...existing, ...raw, id: raw.id || existing?.id })
      cleaned.createdAt = existing?.createdAt || cleaned.createdAt
      const duplicate = state.suppliers.some(
        (supplier) => supplier.id !== cleaned.id && supplier.name.toLowerCase() === cleaned.name.toLowerCase(),
      )
      if (duplicate) return state
      const suppliers = existing
        ? state.suppliers.map((supplier) => (supplier.id === cleaned.id ? cleaned : supplier))
        : [...state.suppliers, cleaned]
      return { ...state, suppliers }
    }

    case 'DELETE_SUPPLIER': {
      const supplier = state.suppliers.find((entry) => entry.id === action.supplierId)
      if (!supplier) return state
      const used = state.inventory.filter((item) => item.supplierId === supplier.id)
      const reassignTo = action.reassignTo ? String(action.reassignTo) : null
      if (reassignTo && !state.suppliers.some((entry) => entry.id === reassignTo)) return state
      if (used.length && !reassignTo) return state // move the SKUs first
      const suppliers = state.suppliers.filter((entry) => entry.id !== supplier.id)
      const affected = new Set(used.map((item) => item.id))
      const inventory = state.inventory.map((item) => (
        affected.has(item.id) ? { ...item, supplierId: reassignTo } : item
      ))
      return { ...state, suppliers, inventory }
    }

    case 'ADD_INVENTORY_ITEM': {
      const item = normalizeInventoryItem(action.item, state.inventory.length)
      if (!item.id || state.inventory.some((entry) => entry.id === item.id)) return state
      if (state.inventory.some((entry) => entry.name.toLowerCase() === item.name.toLowerCase())) return state
      if (!(Number(item.par) >= 0) || !(Number(item.lastCost) >= 0)) return state
      if (item.supplierId && !state.suppliers.some((entry) => entry.id === item.supplierId)) item.supplierId = null
      return { ...state, inventory: [...state.inventory, item] }
    }

    case 'UPDATE_INVENTORY_ITEM': {
      const current = state.inventory.find((item) => item.id === action.inventoryItemId)
      if (!current || !action.patch || typeof action.patch !== 'object') return state
      const precision = Math.trunc(Number(state.settings?.stock?.autoReceiveThousandths) || 2)
      // A base unit is a promise: every movement, purchase line, and recipe
      // line is counted in it. Once stock has moved the unit is frozen — a
      // different count unit is a different item (add one and transfer).
      const moved = (state.movements || []).some((movement) => movement.itemId === current.id)
      const patch = moved && action.patch.unit != null ? { ...action.patch, unit: current.unit } : action.patch
      const next = normalizeInventoryItem({ ...current, ...patch, id: current.id }, 0)
      if (!next.name) return state
      if (!state.settings?.stock?.allowNegativeStock && Number(next.onHand) < 0) {
        next.onHand = 0
      }
      next.onHand = roundQty(next.onHand, precision)
      next.par = roundQty(Math.max(0, next.par), precision)
      next.reorderPoint = roundQty(Math.max(0, next.reorderPoint), precision)
      next.lastCost = Math.max(0, Math.round(next.lastCost * 10000) / 10000)
      next.avgCost = Math.max(0, Math.round(next.avgCost * 10000) / 10000)
      if (next.supplierId && !state.suppliers.some((entry) => entry.id === next.supplierId)) next.supplierId = null
      if (state.inventory.some((item) => item.id !== current.id && item.name.toLowerCase() === next.name.toLowerCase())) return state
      return {
        ...state,
        inventory: state.inventory.map((item) => (item.id === current.id ? next : item)),
      }
    }

    case 'DELETE_INVENTORY_ITEM': {
      const item = state.inventory.find((entry) => entry.id === action.inventoryItemId)
      if (!item) return state
      const usedBy = Object.values(state.recipes || {}).filter((recipe) =>
        recipe?.ingredients?.some((ing) => ing.inventoryItemId === item.id))
      if (usedBy.length && !action.force) return state // detach from recipes first
      return { ...state, inventory: state.inventory.filter((entry) => entry.id !== item.id) }
    }

    case 'SET_BASE_CURRENCY': {
      const code = String(action.code || '').toUpperCase().slice(0, 6)
      const from = state.settings.baseCurrency || state.settings.currency || 'USD'
      if (!code || code === from) return state
      const rateOf = (target) => (target === from
        ? 1
        : Number(state.settings.currencies.find((entry) => entry.code === target)?.rate) || 1)
      const newBaseRate = rateOf(code)
      if (!(newBaseRate > 0)) return state
      const currencies = state.settings.currencies
        .filter((entry) => entry.code !== code)
        .map((entry) => ({ ...entry, rate: Math.round((rateOf(entry.code) / newBaseRate) * 1e6) / 1e6 }))
      if (from !== code) {
        const meta = currencyMeta(from)
        currencies.push({
          code: from,
          name: meta.name,
          symbol: meta.symbol,
          decimals: meta.decimals,
          symbolPosition: 'before',
          space: false,
          rate: Math.round((1 / newBaseRate) * 1e6) / 1e6,
          enabled: true,
          updatedAt: new Date().toISOString(),
        })
      }
      const settings = mergeSettings(state.settings, {
        baseCurrency: code,
        currency: code,
        currencies,
        updatedBy: action.by || 'owner',
      })
      return { ...state, settings }
    }

    case 'RESCALE_CATALOG': {
      // One deliberate revaluation of every catalog price and cost — used
      // when the store re-denominates without re-entering the whole book.
      const factor = Number(action.factor)
      if (!Number.isFinite(factor) || factor <= 0 || factor > 1000) return state
      const scale = (value) => Math.round((Number(value) || 0) * factor * 100) / 100
      const menu = state.menu.map((item) => ({ ...item, price: scale(item.price) }))
      const inventory = state.inventory.map((item) => ({
        ...item,
        lastCost: Math.round((Number(item.lastCost) || 0) * factor * 10000) / 10000,
        avgCost: Math.round((Number(item.avgCost) || 0) * factor * 10000) / 10000,
      }))
      return { ...state, menu, inventory }
    }

    case 'ISSUE_DOCUMENT': {
      const kind = DOC_KINDS.includes(action.kind) ? action.kind : null
      if (!kind) return state
      const requestedId = String(action.document?.id || '').slice(0, 60)
      if (requestedId && state.documents.some((entry) => entry.id === requestedId)) return state
      const counter = state.settings.numbering[kind]
      const number = documentNumber(state.settings, kind, counter.next)
      const document = sanitizeDocument(action.document, kind, number, requestedId || uid('doc'))
      document.meta.issuedBy = String(action.by || 'owner').slice(0, 40)
      return {
        ...state,
        documents: [...state.documents, document].slice(-300),
        settings: {
          ...state.settings,
          numbering: {
            ...state.settings.numbering,
            [kind]: { ...counter, next: counter.next + 1 },
          },
        },
      }
    }

    case 'VOID_DOCUMENT': {
      const { documentId, reason } = action
      const documents = state.documents.map((entry) => (
        entry.id === documentId
          ? { ...entry, meta: { ...entry.meta, voided: true, voidReason: String(reason || 'voided').slice(0, 120), voidedAt: new Date().toISOString() } }
          : entry
      ))
      return { ...state, documents }
    }

    // ── Customers (local directory) ────────────────────────
    // The Tickets composer saves walk-in customers here — online or, with
    // the outbox queueing the action, offline. One case serves both
    // create and edit: the record always travels whole.
    case 'UPSERT_CUSTOMER': {
      const customer = sanitizeCustomerRecord(action.customer)
      if (!customer) return state
      const existing = (state.customers || []).some((c) => c.id === customer.id)
      const customers = existing
        ? (state.customers || []).map((c) => (c.id === customer.id ? { ...c, ...customer } : c))
        : [...(state.customers || []), customer]
      return { ...state, customers: customers.slice(-800) }
    }

    // ── Shifts (Schedule) ─────────────────────────────────
    // A shift is also the branch's cash session: `status: 'open'` means the
    // drawer is out and offline selling is allowed. Legacy roster rows are
    // always 'closed'.
    case 'ADD_SHIFT': {
      const shift = action.shift
      if (!shift || !shift.staffName) return state
      const id = shift.id || uid('shf')
      const next = {
        id,
        staffName: String(shift.staffName).trim(),
        role: String(shift.role || 'server').trim(),
        date: String(shift.date || '').slice(0, 10),
        startTime: String(shift.startTime || '09:00').trim(),
        endTime: String(shift.endTime || '17:00').trim(),
        note: String(shift.note || '').slice(0, 120),
        status: shift.status === 'open' ? 'open' : 'closed',
        createdAt: new Date().toISOString(),
      }
      const shifts = [...(state.shifts || []), next].slice(-500)
      return { ...state, shifts }
    }

    case 'UPDATE_SHIFT': {
      const { shiftId, patch } = action
      if (!shiftId || !patch || typeof patch !== 'object') return state
      const shifts = (state.shifts || []).map((s) => (
        s.id === shiftId ? { ...s, ...patch, id: s.id } : s
      ))
      return { ...state, shifts }
    }

    case 'DELETE_SHIFT': {
      const { shiftId } = action
      if (!shiftId) return state
      const shifts = (state.shifts || []).filter((s) => s.id !== shiftId)
      return { ...state, shifts }
    }

    // ── Misc ───────────────────────────────────────────────
    case 'DISMISS_ALERT':
      return state.dismissedAlerts.includes(action.key)
        ? state
        : {
          ...state,
          dismissedAlerts: [...state.dismissedAlerts, action.key].slice(-MAX_DISMISSED_ALERTS),
        }

    default:
      return state
  }
}

// Automatic 86 after anything that moves stock: a dish whose recipe ran
// out stops selling everywhere at once; receiving brings it back.
const STOCK_ACTIONS = new Set([
  'SEND_ORDER', 'GUEST_SEND', 'UNDO_SEND', 'LOG_WASTE', 'COUNT_STOCK',
  'RECEIVE_INVOICE', 'RECEIVE_PURCHASE',
  'ADD_INVENTORY_ITEM', 'UPDATE_INVENTORY_ITEM', 'DELETE_INVENTORY_ITEM',
])

export function shopReducer(state, action) {
  const next = shopReducerBase(state, action)
  if (next === state) return state
  return STOCK_ACTIONS.has(action.type) ? applyAuto86(next) : next
}

// ─── Empire router (multi-location) ───────────────────────────────
// State shape v2: { version: 2, locations: { downtown: shop, riverside: shop } }.
// Every shop action travels wrapped: { type: 'LOC', locId, action: inner }.
// RESET_ALL reseeds the whole empire; HYDRATE swaps it (bootstrap only).

export const STATE_VERSION = 6

export function buildEmpire() {
  const downtownRaw = buildSeed()
  downtownRaw.settings = {
    ...downtownRaw.settings,
    restaurantName: 'Restora · Downtown',
    locationShort: 'DT',
  }
  // Both boots pass through the shared shop defaults so every location —
  // fresh demo or resumed snapshot — carries the same normalized shape.
  const downtown = withShopDefaults(downtownRaw, 'Downtown')
  return { version: STATE_VERSION, locations: { downtown, riverside: withShopDefaults(buildSeedRiverside(), 'Riverside') } }
}

const LOCATION_LABELS = { downtown: 'Downtown', riverside: 'Riverside' }

export function migrateToEmpire(old) {
  if (!old) return null
  if (old.locations && old.version >= 2 && old.version <= STATE_VERSION) {
    return {
      ...old,
      version: STATE_VERSION,
      locations: Object.fromEntries(
        Object.entries(old.locations).map(([id, shop]) => [
          id,
          withShopDefaults(seedCategoriesIfEmpty(shop), LOCATION_LABELS[id] || id),
        ]),
      ),
    }
  }
  if (old.version === 1 && Array.isArray(old.tables)) {
    const downtown = withShopDefaults(seedCategoriesIfEmpty({
      ...old,
      settings: {
        ...old.settings,
        restaurantName: 'Restora · Downtown',
        locationShort: 'DT',
      },
    }), 'Downtown')
    return { version: STATE_VERSION, locations: { downtown, riverside: buildSeedRiverside() } }
  }
  return null
}

export function reducer(state, action) {
  if (!action || typeof action.type !== 'string') return state
  if (action.type === 'HYDRATE') return action.state
  if (action.type === 'RESET_ALL') return buildEmpire()
  // Empire-level branch management (host/owner only). A new location is a
  // fresh shop seeded from the shared defaults; `locId` must be unique and
  // URL-safe so it can travel in ?loc= and the action log.
  if (action.type === 'CREATE_LOCATION') {
    const locId = String(action.locId || '').trim().slice(0, 32)
    if (!locId || state.locations?.[locId]) return state
    const name = String(action.name || locId).trim().slice(0, 80) || locId
    const base = action.state && typeof action.state === 'object' ? action.state : buildSeed()
    const shop = withShopDefaults(seedCategoriesIfEmpty({
      ...base,
      settings: { ...(base.settings || {}), restaurantName: name, locationShort: name.slice(0, 24) },
    }), name)
    return { ...state, locations: { ...state.locations, [locId]: shop } }
  }
  if (action.type === 'REMOVE_LOCATION') {
    const locId = String(action.locId || '').trim()
    if (!locId || !state.locations?.[locId]) return state
    // Never leave an empire with no shop to open.
    if (Object.keys(state.locations).length <= 1) return state
    const locations = { ...state.locations }
    delete locations[locId]
    return { ...state, locations }
  }
  if (action.type === 'TRANSFER_STOCK') {
    const { fromLocId, toLocId, itemId, qty, notes, by } = action
    const fromShop = state.locations?.[fromLocId]
    const toShop = state.locations?.[toLocId]
    const transferQty = Math.abs(Number(qty))
    if (!fromShop || !toShop || fromLocId === toLocId || !transferQty || !itemId) return state
    const fromItem = fromShop.inventory.find((i) => i.id === itemId || i.sku === itemId)
    if (!fromItem) return state
    const toItem = toShop.inventory.find((i) => i.id === fromItem.id || (fromItem.sku && i.sku === fromItem.sku) || i.name.toLowerCase() === fromItem.name.toLowerCase())
    if (!toItem) return state

    const fromDelta = applyStockLines(fromShop, [{
      inventoryItemId: fromItem.id,
      qty: -transferQty,
      kind: 'transfer',
      note: notes || `Transfer to ${toShop.settings?.locationShort || toLocId}`,
    }], { by: by || 'owner' })

    const toDelta = applyStockLines(toShop, [{
      inventoryItemId: toItem.id,
      qty: transferQty,
      kind: 'transfer',
      unitCost: fromItem.avgCost || fromItem.lastCost || 0,
      note: notes || `Transfer from ${fromShop.settings?.locationShort || fromLocId}`,
    }], { by: by || 'owner' })

    return {
      ...state,
      locations: {
        ...state.locations,
        [fromLocId]: fromDelta ? {
          ...fromShop,
          inventory: fromDelta.inventory,
          movements: pushMovements(fromShop, fromDelta.movements),
        } : fromShop,
        [toLocId]: toDelta ? {
          ...toShop,
          inventory: toDelta.inventory,
          movements: pushMovements(toShop, toDelta.movements),
        } : toShop,
      },
    }
  }
  if (action.type === 'LOC') {
    const shop = state.locations?.[action.locId]
    if (!shop || !action.action) return state
    const next = shopReducer(shop, action.action)
    if (next === shop) return state
    return { ...state, locations: { ...state.locations, [action.locId]: next } }
  }
  if (Array.isArray(state.tables)) {
    return shopReducer(state, action)
  }
  // Back-compat: a bare shop action applies to downtown (old clients/logs).
  const shop = state.locations?.downtown
  if (!shop) return state
  const next = shopReducer(shop, action)
  if (next === shop) return state
  return { ...state, locations: { ...state.locations, downtown: next } }
}

// ─── Derived: alerts ──────────────────────────────────────────────
// Exceptions over averages: late tickets, 86 risk, long turns, losers.

export function getAlerts(state) {
  const alerts = []
  const nowMs = Date.now()
  const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
  const invById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))
  // Notification preferences decide which classes of alert surface here.
  const notify = { lowStock: true, lateTickets: true, guestRequests: true, negativeMargin: true, ...(state.settings?.notifications || {}) }

  // Late / warning tickets (KDS SLA)
  for (const order of state.orders) {
    if (!notify.lateTickets) break
    if (['paid', 'void'].includes(order.status)) continue
    for (const item of order.items) {
      if (item.status !== 'fired' || !item.firedAt) continue
      const age = ticketAgeState(item.firedAt, nowMs)
      if (age === 'late') {
        alerts.push({
          key: `late_${order.id}_${item.id}`,
          type: 'late_ticket',
          severity: 'high',
          label: `Late ticket · ${menuById[item.menuItemId]?.name || 'item'}`,
          detail: `Table ${tableName(state, order.tableId)} · fired ${minutesBetween(item.firedAt)}m ago (target ${state.settings.ticketMinutes}m)`,
          entityId: order.id,
        })
      }
    }
  }

  // Low / out stock + 86
  for (const item of state.inventory) {
    if (!notify.lowStock) break
    if (item.counted === false) continue // not counted: never low, never out
    const st = stockStatusFor(item, state.settings)
    if (st === 'out') {
      const dishes = state.menu.filter((m) =>
        state.recipes[m.id]?.ingredients.some((ing) => ing.inventoryItemId === item.id),
      )
      alerts.push({
        key: `out_${item.id}`,
        type: '86',
        severity: 'high',
        label: `86 risk · ${item.name} out`,
        detail: dishes.length ? `Hits: ${dishes.map((d) => d.name).join(', ')}` : 'No recipe impact',
        entityId: item.id,
      })
    } else if (st === 'low') {
      const threshold = reorderPointFor(item, state.settings)
      const order = suggestedOrderQty(item, state.settings)
      const supplier = state.suppliers?.find((entry) => entry.id === item.supplierId)
      alerts.push({
        key: `low_${item.id}`,
        type: 'low_stock',
        severity: 'med',
        label: `Low stock · ${item.name}`,
        detail: `${item.onHand} ${item.unit} left · ${state.settings?.stock?.reorderPolicy === 'reorder_point' ? `reorder at ${threshold}` : `par ${item.par}`}${order ? ` · order ${order}` : ''}${supplier ? ` from ${supplier.name}` : ''}`,
        entityId: item.id,
      })
    }
  }

  // Manual 86 flags (auto-86 is covered by the stock alerts above)
  for (const m of state.menu) {
    if (m.available === false && m.auto86 === true) continue
    if (!m.available && m.active !== false) {
      alerts.push({
        key: `86_${m.id}`,
        type: '86',
        severity: 'med',
        label: `86'd · ${m.name}`,
        detail: m.substituteId ? `Suggest ${menuById[m.substituteId]?.name}` : 'No substitute mapped',
        entityId: m.id,
      })
    }
  }

  // Long turns (90% of target)
  for (const t of state.tables) {
    if ((t.status === 'seated' || t.status === 'ordered') && t.seatedAt) {
      const mins = minutesBetween(t.seatedAt)
      if (mins >= t.targetTurnMinutes * TARGETS.turnAlertRatio) {
        alerts.push({
          key: `turn_${t.id}`,
          type: 'long_turn',
          severity: mins >= t.targetTurnMinutes ? 'high' : 'med',
          label: `Long turn · ${t.name}`,
          detail: `${mins}m seated · target ${t.targetTurnMinutes}m`,
          entityId: t.id,
        })
      }
    }
  }

  // Negative-margin dishes (loss band from LIVE invoice costs)
  for (const m of state.menu) {
    if (!notify.negativeMargin) break
    const recipe = state.recipes[m.id]
    if (!recipe) continue
    const { contribution, band } = costingFor(m, recipe, invById, state.settings)
    if (band === 'loss') {
      alerts.push({
        key: `margin_${m.id}`,
        type: 'negative_margin',
        severity: 'med',
        label: `Losing dish · ${m.name}`,
        detail: `${(contribution * 100).toFixed(1)}% contribution — reprice or 86`,
        entityId: m.id,
      })
    }
  }

  // Guest requests from QR ordering
  for (const order of state.orders) {
    if (!notify.guestRequests) break
    if (order.billRequested && !['paid', 'void'].includes(order.status)) {
      alerts.push({
        key: `bill_${order.id}`,
        type: 'bill_request',
        severity: 'med',
        label: `Bill requested · Table ${tableName(state, order.tableId)}`,
        detail: `${money(orderCharges(order, menuById, state.settings || {}).total)} due — guest is ready to pay`,
        entityId: order.id,
      })
    }
  }
  for (const t of state.tables) {
    if (!t.serverCalledAt) continue
    const ageMin = (nowMs - new Date(t.serverCalledAt).getTime()) / 60000
    if (ageMin < 15 && (t.status === 'seated' || t.status === 'ordered')) {
      alerts.push({
        key: `call_${t.id}`,
        type: 'call_server',
        severity: 'med',
        label: `Guest calling · ${t.name}`,
        detail: `Requested ${Math.max(1, Math.round(ageMin))}m ago — acknowledge on the ticket`,
        entityId: t.id,
      })
    }
  }

  return alerts.filter((a) => !state.dismissedAlerts.includes(a.key))
}

// ─── Derived: dashboard KPIs ──────────────────────────────────────

export function getDashboard(state, now = Date.now()) {
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  const isToday = (value) => {
    const timestamp = new Date(value || 0).getTime()
    return Number.isFinite(timestamp) && timestamp >= todayStart.getTime() && timestamp < tomorrowStart.getTime()
  }
  const todayOrders = state.orders.filter((order) => isToday(order.paidAt || order.createdAt))
  const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
  const paid = todayOrders.filter((o) => o.status === 'paid')
  // Takings are the money actually collected — the same figure the Sales
  // Report and the shift report read, so the dashboard cannot disagree
  // with the books.
  const takingsFor = (order) => orderCharges(order, menuById, state.settings || {}).grandTotal
  const sales = paid.reduce((s, o) => s + takingsFor(o), 0)
  const covers = paid.reduce((s, o) => s + (o.covers ?? 2), 0)
  const avgCheck = paid.length ? sales / paid.length : 0
  const occupied = state.tables.filter((t) => ['seated', 'ordered', 'billed'].includes(t.status)).length
  const occupancy = state.tables.length ? occupied / state.tables.length : 0

  // Rolling 7-day food cost from history + tonight's theoretical
  const invById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))
  let tonightFood = 0
  for (const o of todayOrders) {
    if (o.status === 'void') continue
    for (const it of o.items) {
      if (it.voided) continue
      const snap = it.recipeSnapshot
      const plate = snap?.plateCost ?? plateCostFor(state.recipes[it.menuItemId], invById, state.settings)
      tonightFood += plate * (it.qty || 0)
    }
  }
  // Food cost is a margin ratio, so it is measured against net sales —
  // menu sales less discounts, plus service. Tax and tips are not revenue.
  const tonightSales = todayOrders
    .filter((o) => o.status !== 'void')
    .reduce((s, o) => {
      const charges = orderCharges(o, menuById, state.settings || {})
      return s + (charges.subtotal - charges.discount + charges.service)
    }, 0)
  const tonightCostPct = tonightSales ? tonightFood / tonightSales : 0
  const hist = state.salesHistory.map((d) => d.foodCostPct)
  const foodCost7d = [...hist, tonightCostPct].reduce((a, b) => a + b, 0) / (hist.length + 1)

  // Kitchen SLA: avg fire-to-bump of bumped items tonight
  const bumped = state.orders.flatMap((o) => o.items).filter((i) => i.status === 'bump' && i.firedAt && isToday(i.bumpedAt))
  const avgTicketMin = bumped.length
    ? bumped.reduce((s, i) => s + (new Date(i.bumpedAt) - new Date(i.firedAt)) / 60000, 0) / bumped.length
    : 0

  // Top sellers + bottom contribution
  const qtyByMenu = {}
  for (const o of todayOrders) {
    if (o.status === 'void') continue
    for (const it of o.items) qtyByMenu[it.menuItemId] = (qtyByMenu[it.menuItemId] || 0) + it.qty
  }
  const sellers = Object.entries(qtyByMenu)
    .map(([id, qty]) => ({ menu: menuById[id], qty }))
    .filter((r) => r.menu)
    .sort((a, b) => b.qty - a.qty)
  const withMargin = sellers.map((r) => {
    const { contribution, band } = costingFor(r.menu, state.recipes[r.menu.id], invById, state.settings)
    return { ...r, contribution, band }
  })

  return {
    sales, covers, avgCheck, checks: paid.length, occupancy, foodCost7d, tonightCostPct,
    avgTicketMin, topSellers: sellers.slice(0, 5),
    bottomContribution: [...withMargin].sort((a, b) => a.contribution - b.contribution).slice(0, 5),
    openTickets: state.orders.filter((o) => !['paid', 'void'].includes(o.status)).length,
  }
}

export function tableName(state, tableId) {
  return state.tables.find((t) => t.id === tableId)?.name?.replace('Table ', '') || '—'
}

export function quoteWait(state, partySize) {
  return quoteWaitMinutes(partySize, state.turnHistory)
}
