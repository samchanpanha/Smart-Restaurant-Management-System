// ─── Configuration, documents, catalog, suppliers ───────────────────
// Covers the settings & document surface: multi-currency maths, the
// sanitizers that protect the store, the category/supplier/stock actions,
// auto-86, document builders, and the print renderer.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRounding, convertAmount, currencyTable, formatMoney, setActiveCurrency,
} from '../src/lib/currency.js'
import {
  categoryPath, configurationAudit, defaultSettings, documentNumber, sanitizeSettings,
  sanitizeSupplier, sanitizeTemplate, templateFor,
} from '../src/lib/settings.js'
import {
  buildInvoiceDocument, buildReceiptDocument, buildReportDocument, buildShiftReport,
  buildTicketDocument, renderDocumentHtml,
} from '../src/lib/documents.js'
import { buildEmpire, reducer, STATE_VERSION } from '../src/lib/reducer.js'
import { money, plateCostFor, stockStatusFor, suggestedOrderQty } from '../src/lib/models.js'

const shopOf = (empire, locId = 'downtown') => empire.locations[locId]
const act = (empire, locId, action) => reducer(empire, { type: 'LOC', locId, action })

// ─── Currency ───────────────────────────────────────────────────────

test('currency table holds the base first and converts every rate both ways', () => {
  const settings = defaultSettings('Downtown')
  const table = currencyTable(settings)

  assert.equal(table[0].code, 'USD')
  assert.equal(table[0].rate, 1)
  const khr = table.find((row) => row.code === 'KHR')
  assert.equal(khr.rate, 4100)
  assert.equal(khr.decimals, 0)

  assert.equal(convertAmount(10, 'USD', 'KHR', settings), 41000)
  assert.equal(convertAmount(41000, 'KHR', 'USD', settings), 10)
  assert.equal(Math.round(convertAmount(92, 'EUR', 'USD', settings)), 100)
})

test('formatMoney follows symbol, position, and decimals of the active currency', () => {
  const settings = defaultSettings('Downtown')
  setActiveCurrency({ ...currencyTable(settings).find((row) => row.code === 'KHR') })
  assert.equal(money(12.5), '៛13')                       // 0-decimal currency rounds to the unit
  assert.equal(money(-4), '-៛4')

  setActiveCurrency({ code: 'USD', symbol: '$', decimals: 2, symbolPosition: 'before' })
  assert.equal(money(1234.5), '$1,234.50')
  assert.equal(
    formatMoney(1234.5, { code: 'EUR', symbol: '€', decimals: 2, symbolPosition: 'after', space: true }),
    '1,234.50 €',
  )
  setActiveCurrency({ code: 'USD', symbol: '$', decimals: 2 })
})

test('rounding rules return the adjustment the receipt prints', () => {
  assert.deepEqual(applyRounding(10.03, 'none'), { total: 10.03, adjustment: 0 })
  const nickel = applyRounding(10.03, 'nearest_005')
  assert.equal(nickel.total, 10.05)
  assert.equal(Math.round(nickel.adjustment * 100) / 100, 0.02)
  const whole = applyRounding(10.4, 'nearest_whole')
  assert.equal(whole.total, 10)
  assert.equal(Math.round(whole.adjustment * 100) / 100, -0.4)
})

// ─── Sanitizers ─────────────────────────────────────────────────────

test('settings sanitizer clamps hostile values and keeps the shape complete', () => {
  const bad = {
    restaurantName: '   ',
    baseCurrency: 'khr',
    taxPct: 12,
    servicePct: -1,
    rounding: 'round_to_whatever',
    rushHour: 99,
    currencies: [
      { code: 'EUR', rate: 0.9 },
      { code: 'khr', rate: 0 },       // base currency — dropped
      { code: '', rate: 5 },          // empty code — dropped
    ],
    stock: { valuationMethod: 'vibes', reorderPolicy: 'nope', allowNegativeStock: 'yes' },
    notifications: { digestTime: '9am', channel: 'carrier-pigeon' },
    templates: { invoice: { paper: 'tissue', showLogo: false } },
  }
  const settings = sanitizeSettings(bad, 'Downtown')

  assert.equal(settings.restaurantName, 'Restora · Downtown')         // blank name falls back to the location label
  assert.equal(settings.baseCurrency, 'KHR')                          // upper-cased, kept
  assert.equal(settings.taxPct, 1)                                    // ratio clamped to 100%
  assert.equal(settings.servicePct, 0)
  assert.equal(settings.rounding, 'none')
  assert.equal(settings.rushHour, 23)
  assert.equal(settings.currencies.length, 1)
  assert.equal(settings.currencies[0].code, 'EUR')
  assert.equal(settings.stock.valuationMethod, 'last_cost')
  assert.equal(settings.stock.reorderPolicy, 'par')
  assert.equal(settings.stock.allowNegativeStock, false)              // string is not `true`
  assert.equal(settings.notifications.digestTime, '09:00')
  assert.equal(settings.notifications.channel, 'in_app')
  assert.equal(settings.templates.invoice.paper, 'a4')
  assert.equal(settings.templates.invoice.showLogo, false)            // explicit false survives
})

test('template sanitizer keeps false-by-default flags false but honors explicit true', () => {
  const receipt = sanitizeTemplate({}, 'receipt')
  assert.equal(receipt.showSignature, false)
  assert.equal(receipt.showPayments, true)
  const ticket = sanitizeTemplate({ showPrices: true, fontScale: 9 }, 'ticket')
  assert.equal(ticket.showPrices, true)
  assert.equal(ticket.fontScale, 1.6)
  assert.equal(templateFor({ templates: { ticket: { title: 'hot line' } } }, 'ticket').title, 'HOT LINE')
})

test('document numbers follow prefix, year, store code, and padding', () => {
  const settings = { ...defaultSettings('Downtown'), locationShort: 'DT' }
  const at = new Date('2026-10-13T12:00:00Z')
  assert.equal(documentNumber(settings, 'invoice', 1041, at), 'INV-2026-01041')
  assert.equal(documentNumber(settings, 'ticket', 7, at), 'TKT-DT-0007')
  const custom = { ...settings, numbering: { ...settings.numbering, receipt: { prefix: 'RCPT', next: 1, pad: 8, includeYear: false, includeLocation: false } } }
  assert.equal(documentNumber(custom, 'receipt', 42, at), 'RCPT-00000042')
})

test('supplier sanitizer trims, validates lists, and defaults terms', () => {
  const supplier = sanitizeSupplier({
    id: 'sup_@@bogus!!',
    name: '  Harbor Fish  ',
    paymentTerms: 'net_5000',
    deliveryDays: ['tue', 'FRI', 'FR', 'monday'],
    rating: 9,
    leadTimeDays: -3,
  })
  assert.equal(supplier.id, 'sup_bogus')
  assert.equal(supplier.name, 'Harbor Fish')
  assert.equal(supplier.paymentTerms, 'net_30')
  assert.deepEqual([...supplier.deliveryDays].sort(), ['FRI', 'MON', 'TUE'])  // full names normalise to codes, dupes drop
  assert.equal(supplier.rating, 5)
  assert.equal(supplier.leadTimeDays, 0)
  assert.equal(supplier.status, 'active')
})

test('configuration audit reports what still needs attention', () => {
  const empire = buildEmpire()
  const audit = configurationAudit(shopOf(empire))
  assert.equal(audit.total, 10)
  assert.ok(audit.done >= 8)
  const empty = configurationAudit({ settings: defaultSettings('X'), menu: [], inventory: [], suppliers: [], categories: [] })
  assert.equal(empty.ready, false)
  assert.ok(empty.checks.some((check) => !check.ok && check.id === 'suppliers'))
})

// ─── Categories ─────────────────────────────────────────────────────

test('categories support sub-categories, reject duplicates and cycles, and rename items', () => {
  let empire = buildEmpire()
  const before = shopOf(empire).categories.length

  // New top-level category
  empire = act(empire, 'downtown', {
    type: 'UPSERT_CATEGORY',
    category: { id: 'cat_sides', kind: 'menu', name: 'Sides', parentId: null, station: 'pantry', sortOrder: 9 },
  })
  assert.equal(shopOf(empire).categories.length, before + 1)

  // Nested sub-category
  empire = act(empire, 'downtown', {
    type: 'UPSERT_CATEGORY',
    category: { id: 'cat_sides_fries', kind: 'menu', name: 'Fries', parentId: 'cat_sides', station: 'grill', sortOrder: 1 },
  })
  const child = shopOf(empire).categories.find((category) => category.id === 'cat_sides_fries')
  assert.equal(child.parentId, 'cat_sides')

  // Duplicate sibling name is refused
  const dup = act(empire, 'downtown', {
    type: 'UPSERT_CATEGORY',
    category: { id: 'cat_sides_fries_2', kind: 'menu', name: 'fries', parentId: 'cat_sides' },
  })
  assert.equal(shopOf(dup).categories.length, before + 2)

  // A category cannot become its own descendant
  const cyclic = act(empire, 'downtown', {
    type: 'UPSERT_CATEGORY',
    category: { id: 'cat_sides', name: 'Sides', parentId: 'cat_sides_fries', kind: 'menu' },
  })
  assert.equal(shopOf(cyclic).categories.find((category) => category.id === 'cat_sides').parentId, null)

  // Renaming re-labels the items that point at the old name
  const renamed = act(empire, 'downtown', {
    type: 'UPSERT_CATEGORY',
    category: { id: 'cat_mains_grill', kind: 'menu', name: 'Griddle', parentId: 'cat_mains' },
  })
  const burger = shopOf(renamed).menu.find((item) => item.id === 'm_burger')
  assert.equal(burger.subCategory, 'Griddle')
  assert.equal(burger.category, 'Mains')
})

test('deleting a category is blocked while items reference it, then moves them', () => {
  let empire = buildEmpire()
  const blocked = act(empire, 'downtown', { type: 'DELETE_CATEGORY', categoryId: 'cat_drinks_cold' })
  assert.ok(shopOf(blocked).categories.some((category) => category.id === 'cat_drinks_cold'))

  const moved = act(empire, 'downtown', {
    type: 'DELETE_CATEGORY',
    categoryId: 'cat_drinks_cold',
    moveTo: 'cat_drinks_hot',
  })
  assert.equal(shopOf(moved).categories.some((category) => category.id === 'cat_drinks_cold'), false)
  const soda = shopOf(moved).menu.find((item) => item.id === 'm_soda')
  assert.equal(soda.subCategory, 'Hot')
  assert.equal(categoryPath(soda), 'Drinks › Hot')
})

// ─── Suppliers ──────────────────────────────────────────────────────

test('suppliers can be created, edited, and only deleted after their SKUs move', () => {
  let empire = buildEmpire()
  const before = shopOf(empire).suppliers.length

  empire = act(empire, 'downtown', {
    type: 'UPSERT_SUPPLIER',
    supplier: { id: 'sup_greens', name: 'Green Leaf', paymentTerms: 'net_7', leadTimeDays: 1, deliveryDays: ['MON', 'THU'] },
  })
  assert.equal(shopOf(empire).suppliers.length, before + 1)
  assert.equal(shopOf(empire).suppliers.find((supplier) => supplier.id === 'sup_greens').paymentTerms, 'net_7')

  // Duplicate names are refused
  const dup = act(empire, 'downtown', { type: 'UPSERT_SUPPLIER', supplier: { id: 'sup_other', name: 'green leaf' } })
  assert.equal(shopOf(dup).suppliers.length, before + 1)

  // Editing keeps the same id and createdAt
  const created = shopOf(empire).suppliers.find((supplier) => supplier.id === 'sup_greens')
  empire = act(empire, 'downtown', {
    type: 'UPSERT_SUPPLIER',
    supplier: { ...created, contactName: 'Ada Green', rating: 4 },
  })
  const edited = shopOf(empire).suppliers.find((supplier) => supplier.id === 'sup_greens')
  assert.equal(edited.contactName, 'Ada Green')
  assert.equal(edited.createdAt, created.createdAt)

  // Harbor Fish owns salmon — deleting it without a destination is refused
  const stuck = act(empire, 'downtown', { type: 'DELETE_SUPPLIER', supplierId: 'sup_fish' })
  assert.ok(shopOf(stuck).suppliers.some((supplier) => supplier.id === 'sup_fish'))

  // …and allowed once the SKUs are reassigned
  const freed = act(empire, 'downtown', { type: 'DELETE_SUPPLIER', supplierId: 'sup_fish', reassignTo: 'sup_greens' })
  assert.equal(shopOf(freed).suppliers.some((supplier) => supplier.id === 'sup_fish'), false)
  assert.equal(shopOf(freed).inventory.find((item) => item.id === 'inv_salmon').supplierId, 'sup_greens')
})

// ─── Stock management ───────────────────────────────────────────────

test('stock items can be created, edited, and deleted once recipes let go', () => {
  let empire = buildEmpire()

  empire = act(empire, 'downtown', {
    type: 'ADD_INVENTORY_ITEM',
    item: {
      id: 'inv_miso', name: 'Miso paste', unit: 'g', onHand: 400, par: 200, lastCost: 0.02,
      category: 'Dry goods', supplierId: 'sup_dry', location: 'dry',
    },
  })
  const miso = shopOf(empire).inventory.find((item) => item.id === 'inv_miso')
  assert.equal(miso.sku !== undefined, true)
  assert.equal(miso.avgCost, 0.02)
  assert.equal(miso.reorderPoint, 200)

  const dupName = act(empire, 'downtown', { type: 'ADD_INVENTORY_ITEM', item: { id: 'inv_miso2', name: 'miso PASTE' } })
  assert.equal(shopOf(dupName).inventory.some((item) => item.id === 'inv_miso2'), false)

  empire = act(empire, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_miso', patch: { par: 500, dailyUse: 40, notes: 'keeps 3 weeks' } })
  assert.equal(shopOf(empire).inventory.find((item) => item.id === 'inv_miso').par, 500)

  // Negative on-hand is refused on edit while the policy says so…
  const clamped = act(empire, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_miso', patch: { onHand: -20 } })
  assert.equal(shopOf(clamped).inventory.find((item) => item.id === 'inv_miso').onHand, 0)

  // …and permitted when the manager opts into negative stock
  const permissive = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { stock: { allowNegativeStock: true } } })
  const negative = act(permissive, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_miso', patch: { onHand: -20 } })
  assert.equal(shopOf(negative).inventory.find((item) => item.id === 'inv_miso').onHand, -20)

  // Ingredients used by a recipe cannot vanish until forced
  const guarded = act(empire, 'downtown', { type: 'DELETE_INVENTORY_ITEM', inventoryItemId: 'inv_bun' })
  assert.ok(shopOf(guarded).inventory.some((item) => item.id === 'inv_bun'))
  const forced = act(empire, 'downtown', { type: 'DELETE_INVENTORY_ITEM', inventoryItemId: 'inv_bun', force: true })
  assert.equal(shopOf(forced).inventory.some((item) => item.id === 'inv_bun'), false)
})

test('auto-86 pulls a dish the moment its recipe runs out and restores it on receipt', () => {
  let empire = buildEmpire()
  assert.equal(shopOf(empire).menu.find((item) => item.id === 'm_wings').available, true)

  empire = act(empire, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_wings', patch: { onHand: 0 } })
  const wings = shopOf(empire).menu.find((item) => item.id === 'm_wings')
  assert.equal(wings.available, false)
  assert.equal(wings.auto86, true)

  // The manual 86 on salmon is never cleared automatically…
  const manual = shopOf(empire).menu.find((item) => item.id === 'm_salmon')
  assert.equal(manual.available, false)
  assert.equal(manual.auto86, false)

  empire = act(empire, 'downtown', {
    type: 'RECEIVE_INVOICE',
    vendor: 'Prime Meats',
    supplierId: 'sup_meats',
    lines: [{ inventoryItemId: 'inv_wings', qty: 24, unitCost: 2.5 }],
  })
  const restored = shopOf(empire).menu.find((item) => item.id === 'm_wings')
  assert.equal(restored.available, true)
  assert.equal(restored.auto86, false)
  assert.equal(shopOf(empire).inventory.find((item) => item.id === 'inv_wings').onHand, 24)
})

test('auto-86 can be switched off from settings', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { stock: { auto86OnZero: false } } })
  empire = act(empire, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_wings', patch: { onHand: 0 } })
  assert.equal(shopOf(empire).menu.find((item) => item.id === 'm_wings').available, true)
})

test('waste cannot drive stock negative under the default policy, and honours precision', () => {
  let empire = buildEmpire()
  const item = shopOf(empire).inventory.find((entry) => entry.id === 'inv_lettuce')
  empire = act(empire, 'downtown', { type: 'LOG_WASTE', inventoryItemId: 'inv_lettuce', qty: 999, reason: 'spoil' })
  assert.equal(shopOf(empire).inventory.find((entry) => entry.id === 'inv_lettuce').onHand, 0)
  assert.equal(shopOf(empire).wasteLog.at(-1).qty, item.onHand)

  const precise = act(empire, 'downtown', { type: 'LOG_WASTE', inventoryItemId: 'inv_lettuce', qty: 0.0001, reason: 'prep' })
  assert.equal(shopOf(precise).wasteLog.length, shopOf(empire).wasteLog.length)

  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { stock: { allowNegativeStock: true } } })
  empire = act(empire, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_lettuce', patch: { onHand: 5 } })
  empire = act(empire, 'downtown', { type: 'LOG_WASTE', inventoryItemId: 'inv_lettuce', qty: 8, reason: 'spoil' })
  assert.equal(shopOf(empire).inventory.find((entry) => entry.id === 'inv_lettuce').onHand, -3)
})

test('weighted-average valuation changes plate cost and reorder points follow policy', () => {
  let empire = buildEmpire()
  const invById = Object.fromEntries(shopOf(empire).inventory.map((item) => [item.id, item]))
  const lastCostPlate = plateCostFor(shopOf(empire).recipes.m_burger, invById, shopOf(empire).settings)

  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { stock: { valuationMethod: 'weighted_average' } } })
  const weightedPlate = plateCostFor(shopOf(empire).recipes.m_burger, invById, shopOf(empire).settings)
  assert.notEqual(Number(lastCostPlate.toFixed(4)), Number(weightedPlate.toFixed(4)))

  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { stock: { reorderPolicy: 'reorder_point', safetyStockDays: 2 } } })
  const item = shopOf(empire).inventory.find((entry) => entry.id === 'inv_patty')
  const threshold = item.reorderPoint + 2 * item.dailyUse
  assert.ok(stockStatusFor({ ...item, onHand: threshold - 1 }, shopOf(empire).settings) === 'low')
  assert.ok(stockStatusFor({ ...item, onHand: threshold + 5 }, shopOf(empire).settings) === 'ok')
  assert.ok(suggestedOrderQty({ ...item, onHand: 2 }, shopOf(empire).settings) > 0)
})

// ─── Settings actions ───────────────────────────────────────────────

test('UPDATE_SETTINGS merges section by section and RESET_SETTINGS restores one section', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', {
    type: 'UPDATE_SETTINGS',
    patch: { taxPct: 0.1, stock: { cycleCountDays: 14 }, notifications: { lowStock: false }, updatedBy: 'maya' },
  })
  const settings = shopOf(empire).settings
  assert.equal(settings.taxPct, 0.1)
  assert.equal(settings.stock.cycleCountDays, 14)
  assert.equal(settings.stock.valuationMethod, 'last_cost')       // untouched sibling keys survive
  assert.equal(settings.notifications.lowStock, false)
  assert.equal(settings.updatedBy, 'maya')
  assert.ok(settings.updatedAt)

  const reset = act(empire, 'downtown', { type: 'RESET_SETTINGS', section: 'stock' })
  assert.equal(shopOf(reset).settings.stock.cycleCountDays, 7)
  assert.equal(shopOf(reset).settings.taxPct, 0.1)                // other sections keep their edits
})

test('templates are edited per kind and validated on the way in', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', {
    type: 'UPDATE_TEMPLATE',
    kind: 'receipt',
    patch: { title: 'ta bill', paper: 'thermal58', showSignature: true, accent: 'orange' },
  })
  const receipt = shopOf(empire).settings.templates.receipt
  assert.equal(receipt.title, 'TA BILL')
  assert.equal(receipt.paper, 'thermal58')
  assert.equal(receipt.showSignature, true)
  assert.equal(receipt.accent, '#111827')                          // invalid color falls back
  assert.equal(shopOf(empire).settings.templates.invoice.paper, 'a4')
})

test('SET_BASE_CURRENCY re-bases every rate and keeps the old base as a row', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'SET_BASE_CURRENCY', code: 'KHR' })
  const settings = shopOf(empire).settings
  assert.equal(settings.baseCurrency, 'KHR')
  const usd = settings.currencies.find((row) => row.code === 'USD')
  assert.ok(Math.abs(usd.rate - 1 / 4100) < 1e-6)
  const eur = settings.currencies.find((row) => row.code === 'EUR')
  assert.ok(Math.abs(eur.rate - 0.92 / 4100) < 1e-6)
  assert.equal(settings.currencies.some((row) => row.code === 'KHR'), false)
})

test('RESCALE_CATALOG revalues menu prices and stock costs by one factor', () => {
  let empire = buildEmpire()
  const burgerBefore = shopOf(empire).menu.find((item) => item.id === 'm_burger').price
  const bunBefore = shopOf(empire).inventory.find((item) => item.id === 'inv_bun').lastCost

  empire = act(empire, 'downtown', { type: 'RESCALE_CATALOG', factor: 2 })
  assert.equal(shopOf(empire).menu.find((item) => item.id === 'm_burger').price, burgerBefore * 2)
  assert.equal(shopOf(empire).inventory.find((item) => item.id === 'inv_bun').lastCost, Math.round(bunBefore * 2 * 10000) / 10000)

  const refused = act(empire, 'downtown', { type: 'RESCALE_CATALOG', factor: 0 })
  assert.equal(refused, empire)
})

// ─── Document registry ──────────────────────────────────────────────

test('filing documents assigns a running number per kind and void keeps it on record', () => {
  let empire = buildEmpire()
  const starting = shopOf(empire).settings.numbering.receipt.next

  empire = act(empire, 'downtown', {
    type: 'ISSUE_DOCUMENT',
    kind: 'receipt',
    by: 'jordan',
    document: { reference: 'o_seed_9', totals: { grandTotal: 61.75 }, currency: { code: 'USD', symbol: '$', decimals: 2 }, lines: [{ name: 'Ribeye Plate', qty: 1, unitPrice: 29, lineTotal: 29 }] },
  })
  const first = shopOf(empire).documents.at(-1)
  assert.equal(first.kind, 'receipt')
  assert.equal(first.number, `RCT-${new Date().getFullYear()}-${String(starting).padStart(5, '0')}`)
  assert.equal(first.meta.issuedBy, 'jordan')
  assert.equal(shopOf(empire).settings.numbering.receipt.next, starting + 1)

  empire = act(empire, 'downtown', {
    type: 'ISSUE_DOCUMENT',
    kind: 'invoice',
    document: { reference: 'o_seed_3', totals: { grandTotal: 49.2 }, lines: [] },
  })
  assert.equal(shopOf(empire).documents.length, 2)
  assert.notEqual(shopOf(empire).documents[0].number, shopOf(empire).documents[1].number)

  // Re-filing the same document id is a no-op (retry-safe)
  const retried = act(empire, 'downtown', { type: 'ISSUE_DOCUMENT', kind: 'invoice', document: { id: first.id, totals: {} } })
  assert.equal(shopOf(retried).documents.length, 2)

  empire = act(empire, 'downtown', { type: 'VOID_DOCUMENT', documentId: first.id, reason: 'guest left' })
  const voided = shopOf(empire).documents.find((document) => document.id === first.id)
  assert.equal(voided.meta.voided, true)
  assert.equal(voided.meta.voidReason, 'guest left')
})

// ─── Document builders ──────────────────────────────────────────────

function seedOrder(shop, orderId) {
  return shop.orders.find((order) => order.id === orderId)
}

test('invoice totals run discount → service → tax → rounding and print the tax label', () => {
  const empire = buildEmpire()
  const shop = shopOf(empire)
  const settings = sanitizeSettings({ ...shop.settings, servicePct: 0.1, taxPct: 0.1, rounding: 'nearest_005' })
  const order = seedOrder(shop, 'o_seed_9')

  const invoice = buildInvoiceDocument({ shop, order, settings, paymentTermsDays: 14 })
  const t = invoice.totals
  const expectedSubtotal = 2 * 29 + 8 + 2 * 4
  assert.equal(t.subtotal, expectedSubtotal)
  assert.equal(t.service, Math.round(expectedSubtotal * 0.1 * 100) / 100)
  assert.equal(t.tax, Math.round((t.subtotal + t.service) * 0.1 * 100) / 100)
  assert.equal(invoice.customer.dueDate > new Date().toISOString(), true)

  const html = renderDocumentHtml(invoice, settings)
  assert.match(html, /INVOICE/)
  assert.match(html, /Sales tax/)
  assert.match(html, new RegExp(`\\$${t.grandTotal.toFixed(2)}`))
  assert.match(html, /@page/)
})

test('receipts carry payments, tips, and honour the template currency', () => {
  const empire = buildEmpire()
  const shop = shopOf(empire)
  const settings = sanitizeSettings(shop.settings)
  const order = shop.orders.find((entry) => entry.status === 'paid')
  const receipt = buildReceiptDocument({ shop, order, settings })

  assert.equal(receipt.kind, 'receipt')
  assert.ok(receipt.payments.length >= 1)
  assert.equal(receipt.payments[0].amount, receipt.totals.paid)
  assert.equal(receipt.currency.code, 'USD')

  const khrSettings = sanitizeSettings({
    ...shop.settings,
    templates: { ...shop.settings.templates, receipt: { ...shop.settings.templates.receipt, currency: 'KHR' } },
  })
  const converted = buildReceiptDocument({ shop, order, settings: khrSettings })
  assert.equal(converted.currency.code, 'KHR')
  assert.equal(converted.totals.paid, Math.round(receipt.totals.paid * 4100))
  const html = renderDocumentHtml(converted, khrSettings)
  assert.match(html, /៛/)
  assert.match(html, /Converted to KHR/)
})

test('kitchen tickets group by station and hide prices when the template says so', () => {
  const empire = buildEmpire()
  const shop = shopOf(empire)
  const settings = sanitizeSettings(shop.settings)
  const order = seedOrder(shop, 'o_seed_3')
  const ticket = buildTicketDocument({ shop, order, settings })

  assert.equal(ticket.kind, 'ticket')
  assert.equal(ticket.currency.code, 'USD')
  assert.equal(ticket.totals.items, 5)
  assert.deepEqual(ticket.groups.map((group) => group.title).sort(), ['GRILL · MAIN', 'PANTRY · APPETIZER', 'PANTRY · MAIN'])
  assert.equal(ticket.groups.find((group) => group.title === 'GRILL · MAIN').lines.length, 1)

  const html = renderDocumentHtml(ticket, settings)
  assert.match(html, /KITCHEN TICKET/)
  assert.doesNotMatch(html, /\$\d/)

  const stationTicket = buildTicketDocument({ shop, order, settings, station: 'grill' })
  assert.ok(stationTicket.lines.every((line) => line.station === 'grill'))
})

test('shift reports aggregate sales, service, variance, and P&L from live state', () => {
  const empire = buildEmpire()
  const shop = shopOf(empire)
  const report = buildShiftReport(shop, { range: 'tonight' })

  assert.equal(report.kpis.length, 4)
  assert.ok(report.pnl.sales > 0)
  assert.ok(report.pnl.foodCost > 0)
  assert.ok(report.byCategory.length >= 3)
  assert.ok(report.service.checks > 0)
  assert.ok(report.inventoryValue > 0)

  const doc = buildReportDocument({ shop, settings: shop.settings, report, range: 'tonight' })
  const html = renderDocumentHtml(doc, shop.settings)
  assert.match(html, /SHIFT REPORT/)
  assert.match(html, /P&amp;L-lite/)
  assert.match(html, /Sales by category/)
  assert.match(html, /Top sellers/)
})

test('print renderer states the document currency conversion and repeats copies', () => {
  const empire = buildEmpire()
  const shop = shopOf(empire)
  const settings = sanitizeSettings({
    ...shop.settings,
    templates: {
      ...shop.settings.templates,
      invoice: { ...shop.settings.templates.invoice, currency: 'EUR', copies: 2, showSignature: true, bankDetails: 'IBAN DE00 1234' },
    },
  })
  const invoice = buildInvoiceDocument({ shop, order: seedOrder(shop, 'o_seed_9'), settings })
  const html = renderDocumentHtml(invoice, settings)
  assert.match(html, /1 USD = 0\.92 EUR/)
  assert.match(html, /IBAN DE00 1234/)
  assert.match(html, /Authorized by/)
})

test('the store state version is the one the server and migrations expect', () => {
  assert.equal(STATE_VERSION, 3)
  assert.equal(buildEmpire().version, 3)
})
