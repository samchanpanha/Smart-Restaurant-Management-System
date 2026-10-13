// ─── Restora reducer (shared) ─────────────────────────────────────
// Pure business logic: the SAME code runs in the browser and on the
// Express server. No React, no DOM — safe to import from Node.
// The ticket stays the system of record on every terminal.

import { STATIONS, TARGETS } from './constants.js'
import {
  applyAuto86,
  assertTableTransition,
  costingFor,
  minutesBetween,
  money,
  orderSubtotal,
  plateCostFor,
  quoteWaitMinutes,
  reorderPointFor,
  stockStatusFor,
  suggestedOrderQty,
  theoreticalDecrementFor,
  ticketAgeState,
  uid,
} from './models.js'
import { currencyMeta } from './currency.js'
import {
  DOC_KINDS,
  categoryById,
  descendantCategoryIds,
  defaultSettings,
  documentNumber,
  sanitizeSettings,
  sanitizeSupplier,
  sanitizeTemplate,
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
    notifications: { ...current.notifications, ...(patch.notifications || {}) },
    numbering: { ...current.numbering, ...(patch.numbering || {}) },
    templates: { ...current.templates, ...(patch.templates || {}) },
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

function cleanImageUrl(value) {
  const url = String(value ?? '').trim().slice(0, 500)
  if (!url) return ''
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) ? url : ''
  } catch {
    return ''
  }
}

function normalizeMenuItem(item, index = 0) {
  const numericPrice = Number(item?.price)
  const numericOrder = Number(item?.sortOrder)
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
    imageUrl: cleanImageUrl(item?.imageUrl),
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
function normalizeInventoryItem(item, index = 0) {
  const par = Number.isFinite(Number(item?.par)) ? Number(item.par) : 0
  const lastCost = Number.isFinite(Number(item?.lastCost)) ? Number(item.lastCost) : 0
  return {
    ...item,
    id: String(item?.id ?? '').trim() || `inv_${index}`,
    name: String(item?.name ?? 'Stock item').trim().slice(0, 60) || 'Stock item',
    unit: String(item?.unit ?? 'each').trim().slice(0, 16) || 'each',
    onHand: Number.isFinite(Number(item?.onHand)) ? Number(item.onHand) : 0,
    par,
    lastCost,
    avgCost: Number.isFinite(Number(item?.avgCost)) && Number(item.avgCost) > 0 ? Number(item.avgCost) : lastCost,
    reorderPoint: Number.isFinite(Number(item?.reorderPoint)) ? Number(item.reorderPoint) : par,
    dailyUse: Number.isFinite(Number(item?.dailyUse)) ? Number(item.dailyUse) : 0,
    incoming: Number.isFinite(Number(item?.incoming)) ? Number(item.incoming) : 0,
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
  return {
    ...shop, menu, inventory: linkedInventory, categories, suppliers, documents,
    purchases, movements, settings,
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

export const MOVEMENT_KINDS = [
  { id: 'buy', label: 'Purchase', direction: 'in', icon: 'cart' },
  { id: 'opening', label: 'Opening stock', direction: 'in', icon: 'inventory' },
  { id: 'return', label: 'Return to vendor', direction: 'out', icon: 'swap' },
  { id: 'sale', label: 'Sold', direction: 'out', icon: 'orders' },
  { id: 'waste', label: 'Waste', direction: 'out', icon: 'trash' },
  { id: 'count', label: 'Count variance', direction: 'adjust', icon: 'check' },
  { id: 'adjust', label: 'Manual adjust', direction: 'adjust', icon: 'settings' },
]

const MOVEMENT_LABEL = Object.fromEntries(MOVEMENT_KINDS.map((kind) => [kind.id, kind.label]))

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
      return {
        id: String(line.id || uid('pline')).slice(0, 40),
        inventoryItemId: String(line.inventoryItemId).slice(0, 60),
        name: String(line.name || '').slice(0, 80),
        unit: String(line.unit || '').slice(0, 12),
        qty,
        unitCost,
        receivedQty,
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

function decrementInventory(inventory, decMap, sign = -1) {
  const byId = Object.fromEntries(inventory.map((i) => [i.id, i]))
  const next = inventory.map((item) => {
    const delta = decMap[item.id] || 0
    if (!delta) return item
    const onHand = Math.round((item.onHand + sign * delta) * 100) / 100
    return { ...item, onHand }
  })
  // Auto-86 is derived in selectors (out-of-stock ingredients), not stored —
  // except the manual 86 flag on menu items. Negative on-hand is kept as a
  // visible flag, never silently wrapped.
  void byId
  return next
}

function shopReducerBase(state, action) {
  switch (action.type) {
    // ── Floor ──────────────────────────────────────────────
    case 'SEAT_PARTY': {
      const { tableId, partySize, reservationId } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      assertTableTransition(table.status, 'seated')
      const tables = state.tables.map((t) =>
        t.id === tableId
          ? { ...t, status: 'seated', seatedAt: new Date().toISOString(), partySize }
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

    // ── Orders / tickets ───────────────────────────────────
    case 'CREATE_ORDER': {
      const { tableId, orderType = 'dine_in' } = action
      const existing = state.orders.find(
        (o) => o.tableId === tableId && !['paid', 'void'].includes(o.status),
      )
      if (existing) return state
      const order = {
        id: action.id || uid('o'),
        tableId,
        type: orderType,
        serverId: 'server',
        status: 'open',
        createdAt: new Date().toISOString(),
        sentAt: null,
        paidAt: null,
        voidReason: null,
        compTotal: 0,
        items: [],
      }
      const tables = state.tables.map((t) =>
        t.id === tableId && t.currentCheckId == null ? { ...t, currentCheckId: order.id } : t,
      )
      return { ...state, orders: [...state.orders, order], tables }
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
        for (const [k, v] of Object.entries(dec)) totalDec[k] = (totalDec[k] || 0) + v
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
        const status = o.status === 'open' ? 'sent' : o.status === 'sent' ? 'in_prep' : o.status
        return { ...o, items, status, sentAt: o.sentAt || nowIso }
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
      // Atomic QR order: find-or-create the table's check, add guest lines,
      // fire them immediately. One action so two phones can't fork a check.
      // 86'd lines are skipped (the live menu hides them; this is the race guard).
      const { tableId, items = [] } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table || !['seated', 'ordered'].includes(table.status)) return state
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
        for (const [k, v] of Object.entries(dec)) totalDec[k] = (totalDec[k] || 0) + v
        newLines.push({
          id: uid('it'), menuItemId: g.menuItemId, qty,
          modifiers: g.modifiers || [], station: menuItem.station, status: 'fired',
          course: g.course || 'main', notes: g.notes || '',
          by: 'guest', guest: g.guest || null, firedAt: nowIso,
          recipeSnapshot: recipe ? { ...recipe, plateCost: plateCostFor(recipe, inventoryById) } : null,
        })
      }
      if (!newLines.length) return state.orders === orders ? state : { ...state, orders, tables }
      orders = orders.map((o) =>
        o.id === order.id
          ? { ...o, items: [...o.items, ...newLines], status: o.status === 'open' ? 'sent' : o.status === 'sent' ? 'in_prep' : o.status, sentAt: o.sentAt || nowIso }
          : o,
      )
      const sale = applyStockLines(state, saleMovements(state, totalDec, {
        ref: order.id,
        note: `${newLines.reduce((sum, line) => sum + line.qty, 0)} line(s) from the QR menu`,
      }), { at: nowIso, by: 'guest' })
      const inventory = sale ? sale.inventory : state.inventory
      if (table.status === 'seated') {
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
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          ids.has(i.id) ? { ...i, status: 'held', firedAt: null, recipeSnapshot: null } : i,
        )
        const anyFired = items.some((i) => i.status === 'fired')
        return { ...o, items, status: anyFired ? o.status : 'open', sentAt: anyFired ? o.sentAt : null }
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
        // Derive order progress
        let status = o.status
        if (items.length && items.every((i) => i.status === 'bump')) status = 'ready'
        else if (items.some((i) => i.status === 'fired')) status = o.status === 'sent' ? 'in_prep' : o.status
        return { ...o, items, status }
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
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          i.id === itemId && i.status === 'bump' ? { ...i, status: 'fired', bumpedAt: null } : i,
        )
        return { ...o, items, status: 'in_prep' }
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
      const orders = state.orders.map((o) =>
        o.id === orderId && o.status === 'ready' ? { ...o, status: 'served' } : o,
      )
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
      const { orderId, method = 'card', split = null, tip = 0 } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || !['ready', 'served', 'in_prep', 'sent'].includes(order.status)) return state
      const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
      const total = orderSubtotal(order, menuById)
      const orders = state.orders.map((o) =>
        o.id === orderId
          ? { ...o, status: 'paid', paidAt: new Date().toISOString(), payMethod: method, split, tip: Number(tip) || 0, total, billRequested: null }
          : o,
      )
      // Table ordered -> billed; record the turn for host wait quotes
      let tables = state.tables
      let turnHistory = state.turnHistory
      const table = state.tables.find((t) => t.id === order.tableId)
      if (table) {
        const seatedMin = table.seatedAt ? minutesBetween(table.seatedAt) : table.targetTurnMinutes
        turnHistory = [...turnHistory.slice(-40), { partySize: table.partySize || 2, minutes: seatedMin }]
        tables = tables.map((t) => {
          if (t.id !== table.id) return t
          if (t.status === 'ordered' || t.status === 'seated') return { ...t, status: 'billed' }
          return t
        })
      }
      return { ...state, orders, tables, turnHistory }
    }

    case 'VOID_ORDER': {
      const { orderId, reason } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || ['paid', 'void'].includes(order.status)) return state
      const orders = state.orders.map((o) =>
        o.id === orderId ? { ...o, status: 'void', voidReason: reason || 'manager void' } : o,
      )
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
          const qty = roundQty(line.qty ?? source?.qty, precision)
          if (!item || !(qty > 0)) return null
          const unitCost = Number.isFinite(Number(line.unitCost)) && Number(line.unitCost) >= 0
            ? Number(line.unitCost)
            : Number(source?.unitCost) || Number(item.lastCost) || 0
          return { inventoryItemId: item.id, qty, unitCost, name: item.name, source }
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
          note: purchase.number,
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
        }
      })

      const lines = purchase.lines.map((line) => {
        const hit = received.find((entry) => entry.source?.id === line.id)
        if (!hit) return line
        return {
          ...line,
          unitCost: hit.unitCost,
          receivedQty: roundQty((Number(line.receivedQty) || 0) + hit.qty, precision),
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
      const receivedTotal = Math.round(received.reduce((sum, line) => sum + line.qty * line.unitCost, 0) * 100) / 100
      const invoiceLog = [
        ...state.invoiceLog,
        {
          id: uid('invlog'),
          vendor: purchase.vendor || supplier?.name || 'Vendor',
          supplierId: purchase.supplierId || null,
          at,
          purchaseId: purchase.id,
          reference: purchase.reference || purchase.number,
          lines: received.map(({ inventoryItemId, qty, unitCost }) => ({ inventoryItemId, qty, unitCost })),
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
        .filter((item) => counts?.[item.id] != null)
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
      const next = normalizeInventoryItem({ ...current, ...action.patch, id: current.id }, 0)
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

    // ── Misc ───────────────────────────────────────────────
    case 'DISMISS_ALERT':
      return state.dismissedAlerts.includes(action.key)
        ? state
        : { ...state, dismissedAlerts: [...state.dismissedAlerts, action.key] }

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

function shopReducer(state, action) {
  const next = shopReducerBase(state, action)
  if (next === state) return state
  return STOCK_ACTIONS.has(action.type) ? applyAuto86(next) : next
}

// ─── Empire router (multi-location) ───────────────────────────────
// State shape v2: { version: 2, locations: { downtown: shop, riverside: shop } }.
// Every shop action travels wrapped: { type: 'LOC', locId, action: inner }.
// RESET_ALL reseeds the whole empire; HYDRATE swaps it (bootstrap only).

export const STATE_VERSION = 4

export function buildEmpire() {
  const downtown = buildSeed()
  downtown.settings = {
    ...downtown.settings,
    restaurantName: 'Restora · Downtown',
    locationShort: 'DT',
  }
  return { version: STATE_VERSION, locations: { downtown, riverside: buildSeedRiverside() } }
}

const LOCATION_LABELS = { downtown: 'Downtown', riverside: 'Riverside' }

export function migrateToEmpire(old) {
  if (!old) return null
  if (old.locations && old.version >= 2 && old.version <= STATE_VERSION) {
    return {
      version: STATE_VERSION,
      ...old,
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
  if (action.type === 'LOC') {
    const shop = state.locations?.[action.locId]
    if (!shop || !action.action) return state
    const next = shopReducer(shop, action.action)
    if (next === shop) return state
    return { ...state, locations: { ...state.locations, [action.locId]: next } }
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
        detail: `${money(orderSubtotal(order, menuById))} due — guest is ready to pay`,
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

export function getDashboard(state) {
  const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
  const paid = state.orders.filter((o) => o.status === 'paid')
  const sales = paid.reduce((s, o) => s + (o.total ?? orderSubtotal(o, menuById)), 0)
  const covers = paid.reduce((s, o) => s + (o.covers ?? 2), 0)
  const avgCheck = paid.length ? sales / paid.length : 0
  const occupied = state.tables.filter((t) => ['seated', 'ordered', 'billed'].includes(t.status)).length
  const occupancy = state.tables.length ? occupied / state.tables.length : 0

  // Rolling 7-day food cost from history + tonight's theoretical
  const invById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))
  let tonightFood = 0
  for (const o of state.orders) {
    if (o.status === 'void') continue
    for (const it of o.items) {
      if (it.voided) continue
      const snap = it.recipeSnapshot
      const plate = snap?.plateCost ?? plateCostFor(state.recipes[it.menuItemId], invById, state.settings)
      tonightFood += plate * (it.qty || 0)
    }
  }
  const tonightSales = state.orders
    .filter((o) => o.status !== 'void')
    .reduce((s, o) => s + (o.total ?? orderSubtotal(o, menuById)), 0)
  const tonightCostPct = tonightSales ? tonightFood / tonightSales : 0
  const hist = state.salesHistory.map((d) => d.foodCostPct)
  const foodCost7d = [...hist, tonightCostPct].reduce((a, b) => a + b, 0) / (hist.length + 1)

  // Kitchen SLA: avg fire-to-bump of bumped items tonight
  const bumped = state.orders.flatMap((o) => o.items).filter((i) => i.status === 'bump' && i.firedAt && i.bumpedAt)
  const avgTicketMin = bumped.length
    ? bumped.reduce((s, i) => s + (new Date(i.bumpedAt) - new Date(i.firedAt)) / 60000, 0) / bumped.length
    : 0

  // Top sellers + bottom contribution
  const qtyByMenu = {}
  for (const o of state.orders) {
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
    sales, covers, avgCheck, occupancy, foodCost7d, tonightCostPct,
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
