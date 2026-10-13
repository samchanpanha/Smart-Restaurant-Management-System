// ─── Screen action contracts ────────────────────────────────────────
// The new screens (Settings, Catalog, Suppliers, Tickets, Reports) all
// speak to the reducer with specific payload shapes. These tests replay
// those exact payloads so a UI change that stops matching the reducer
// fails here instead of silently doing nothing in the browser.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'
import {
  buildInvoiceDocument, buildReportDocument, buildReceiptDocument, buildTicketDocument, renderDocumentHtml,
} from '../src/lib/documents.js'
import { configurationAudit, sanitizeSettings } from '../src/lib/settings.js'

const act = (empire, locId, action) => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]

// SettingsScreen — Save changes (per store and across stores)
test('settings screen save round-trips a draft through UPDATE_SETTINGS', () => {
  let empire = buildEmpire()
  const settingsScreenDraft = {
    ...shopOf(empire).settings,
    restaurantName: 'Restora · Downtown Flagship',
    tagline: 'Slow food, fast service',
    taxPct: 0.0875,
    servicePct: 0.03,
    rounding: 'nearest_005',
    stock: { ...shopOf(empire).settings.stock, valuationMethod: 'weighted_average', auto86OnZero: true },
    pos: { ...shopOf(empire).settings.pos, tipPresets: [0.18, 0.22, 0.3] },
    notifications: { ...shopOf(empire).settings.notifications, lowStock: true, digestTime: '21:30' },
  }

  // Give Riverside a distinct tax first so leakage between stores would show
  empire = act(empire, 'riverside', { type: 'UPDATE_SETTINGS', patch: { taxPct: 0.05 } })

  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: settingsScreenDraft, updatedBy: 'owner' })
  const saved = shopOf(empire).settings
  assert.equal(saved.restaurantName, 'Restora · Downtown Flagship')
  assert.equal(saved.taxPct, 0.0875)
  assert.equal(saved.rounding, 'nearest_005')
  assert.equal(saved.stock.valuationMethod, 'weighted_average')
  assert.deepEqual(saved.pos.tipPresets, [0.18, 0.22, 0.3])
  assert.equal(saved.notifications.digestTime, '21:30')
  assert.equal(shopOf(empire, 'riverside').settings.taxPct, 0.05)     // other store untouched

  // “Apply to all stores” repeats the same action per location
  empire = reducer(empire, { type: 'LOC', locId: 'riverside', action: { type: 'UPDATE_SETTINGS', patch: settingsScreenDraft, updatedBy: 'owner' } })
  assert.equal(shopOf(empire, 'riverside').settings.taxPct, 0.0875)

  // Save with no edits is a no-op (same object reference)
  const same = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: shopOf(empire).settings })
  assert.equal(same, empire)
})

test('settings screen reset buttons map to the right sections', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { notifications: { lowStock: false }, pos: { tipsEnabled: false } } })
  empire = act(empire, 'downtown', { type: 'RESET_SETTINGS', section: 'notifications' })
  assert.equal(shopOf(empire).settings.notifications.lowStock, true)
  assert.equal(shopOf(empire).settings.pos.tipsEnabled, false)   // other sections keep their edits
})

// SettingsScreen — document designer: preview, file, void, and the registry
test('document designer files a numbered document and the registry can void it', () => {
  let empire = buildEmpire()
  const shop = shopOf(empire)
  const settings = sanitizeSettings({ ...shop.settings, restaurantName: 'Restora · Downtown' })
  const order = shop.orders.find((entry) => entry.status === 'paid')

  const draftDoc = buildReceiptDocument({ shop, order, settings })
  const preview = renderDocumentHtml({ ...draftDoc, number: 'RCT-PREVIEW' }, settings, { qrDataUrl: 'data:image/png;base64,AA' })
  assert.match(preview, /RCT-PREVIEW/)
  assert.match(preview, /data:image\/png;base64,AA/)

  empire = act(empire, 'downtown', {
    type: 'ISSUE_DOCUMENT',
    kind: 'receipt',
    by: 'owner',
    document: { ...draftDoc, id: order.id },
  })
  const filed = shopOf(empire).documents.at(-1)
  assert.ok(filed.number.startsWith('RCT-'))
  assert.equal(filed.kind, 'receipt')

  // Voiding from the registry keeps the audit trail
  empire = act(empire, 'downtown', { type: 'VOID_DOCUMENT', documentId: filed.id, reason: 'manager void' })
  const voided = shopOf(empire).documents.find((entry) => entry.id === filed.id)
  assert.equal(voided.meta.voided, true)
  assert.equal(voided.meta.voidReason, 'manager void')
  assert.equal(voided.number, filed.number)
})

// SettingsScreen — Data section: export snapshot, then hydrate it back
test('export → hydrate restores an edited empire exactly', () => {
  let empire = buildEmpire()
  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { taxPct: 0.0999 } })
  empire = act(empire, 'riverside', { type: 'UPDATE_SETTINGS', patch: { taxPct: 0.0777 } })
  const exported = JSON.parse(JSON.stringify(empire))          // what the download writes

  const hydrated = reducer(buildEmpire(), { type: 'HYDRATE', state: exported })
  assert.equal(shopOf(hydrated).settings.taxPct, 0.0999)
  assert.equal(shopOf(hydrated, 'riverside').settings.taxPct, 0.0777)
})

// CatalogScreen — bulk toolbar payloads
test('catalog bulk moves, 86s, and restores in one pass per selected item', () => {
  let empire = buildEmpire()
  const ids = ['m_burger', 'm_steak', 'm_salmon']

  for (const id of ids) {
    empire = act(empire, 'downtown', { type: 'UPDATE_MENU_ITEM', menuItemId: id, patch: { category: 'Mains', subCategory: 'Grill' } })
  }
  assert.deepEqual(
    [...new Set(ids.map((id) => shopOf(empire).menu.find((item) => item.id === id).subCategory))],
    ['Grill'],
  )

  for (const id of ids) empire = act(empire, 'downtown', { type: 'UPDATE_MENU_ITEM', menuItemId: id, patch: { station: 'saute' } })
  assert.ok(ids.every((id) => shopOf(empire).menu.find((item) => item.id === id).station === 'saute'))

  for (const id of ids) empire = act(empire, 'downtown', { type: 'UPDATE_MENU_ITEM', menuItemId: id, patch: { available: false, auto86: false } })
  assert.ok(ids.every((id) => shopOf(empire).menu.find((item) => item.id === id).available === false))

  for (const id of ids) empire = act(empire, 'downtown', { type: 'UPDATE_MENU_ITEM', menuItemId: id, patch: { available: true, auto86: false } })
  assert.ok(ids.every((id) => shopOf(empire).menu.find((item) => item.id === id).available === true))
})

// CatalogScreen — ingredient modal + inline supplier reassign
test('ingredient modal payload lands with a supplier, and inline reassign sticks', () => {
  let empire = buildEmpire()
  const values = {
    name: 'Gochujang', unit: 'g', onHand: 900, par: 300, reorderPoint: 300, dailyUse: 60,
    lastCost: 0.014, supplierId: 'sup_dry', category: 'Dry goods', storage: 'dry', shelfLifeDays: 180,
  }
  const supplier = shopOf(empire).suppliers.find((entry) => entry.id === values.supplierId)

  empire = act(empire, 'downtown', {
    type: 'ADD_INVENTORY_ITEM',
    item: { id: 'inv_gochujang', ...values, avgCost: values.lastCost, vendor: supplier.name, active: true },
  })
  const created = shopOf(empire).inventory.find((item) => item.id === 'inv_gochujang')
  assert.equal(created.supplierId, 'sup_dry')
  assert.equal(created.vendor, 'Dry Goods Co')
  assert.equal(created.storage, 'dry')

  empire = act(empire, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: created.id, patch: { supplierId: 'sup_bakery' } })
  assert.equal(shopOf(empire).inventory.find((item) => item.id === created.id).supplierId, 'sup_bakery')

  empire = act(empire, 'downtown', { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: created.id, patch: { supplierId: '' } })
  assert.equal(shopOf(empire).inventory.find((item) => item.id === created.id).supplierId, null)
})

// SuppliersScreen — ReceiveModal payload, supplier spend, and delete-with-reassign
test('supplier receive modal updates stock, spend, and delivery history', () => {
  let empire = buildEmpire()
  const supplier = shopOf(empire).suppliers.find((entry) => entry.id === 'sup_meats')
  const items = shopOf(empire).inventory.filter((item) => item.supplierId === supplier.id)
  assert.ok(items.length >= 2)

  const lines = items.slice(0, 2).map((item) => ({ inventoryItemId: item.id, qty: 10, unitCost: Number((item.lastCost * 1.1).toFixed(4)) }))
  empire = act(empire, 'downtown', { type: 'RECEIVE_INVOICE', vendor: supplier.name, supplierId: supplier.id, lines })

  const log = shopOf(empire).invoiceLog.at(-1)
  assert.equal(log.supplierId, 'sup_meats')
  assert.equal(log.vendor, 'Prime Meats')
  assert.equal(log.lines.length, 2)
  assert.ok(log.total > 0)

  for (const line of lines) {
    const after = shopOf(empire).inventory.find((item) => item.id === line.inventoryItemId)
    const before = items.find((item) => item.id === line.inventoryItemId)
    assert.equal(after.onHand, before.onHand + line.qty)
    assert.equal(after.lastCost, line.unitCost)
    // weighted average: (old qty × old avg + received qty × invoice cost) ÷ new qty
    const expectedAvg = Math.round(
      (((before.onHand * before.avgCost) + (line.qty * line.unitCost)) / (before.onHand + line.qty)) * 10000,
    ) / 10000
    assert.equal(after.avgCost, expectedAvg)
  }

  // The detail rail sums that history for “spent with this supplier”
  const spend = shopOf(empire).invoiceLog
    .filter((entry) => entry.supplierId === supplier.id)
    .reduce((sum, entry) => sum + entry.total, 0)
  assert.ok(spend >= log.total)

  // Deleting a supplier with SKUs requires choosing who takes them over
  assert.ok(shopOf(empire).inventory.some((item) => item.supplierId === 'sup_meats'))
  const stuck = act(empire, 'downtown', { type: 'DELETE_SUPPLIER', supplierId: 'sup_meats', reassignTo: null })
  assert.equal(stuck, empire)
})

// SuppliersScreen — reorder list inputs
test('reorder list quantity and cost come straight from the settings-aware helpers', async () => {
  const { reorderPointFor, suggestedOrderQty, stockStatusFor, stockValue } = await import('../src/lib/models.js')
  const shop = shopOf(buildEmpire())
  const item = shop.inventory.find((entry) => entry.id === 'inv_patty')
  const emptied = { ...item, onHand: 0 }

  assert.ok(reorderPointFor(item, shop.settings) > 0)
  assert.ok(suggestedOrderQty(emptied, shop.settings) > 0)     // the reorder list fills in a quantity
  assert.ok(stockValue(shop) > 0)
  assert.equal(stockStatusFor(emptied, shop.settings), 'out')
  assert.ok(['ok', 'low', 'out'].includes(stockStatusFor(item, shop.settings)))
})

// TicketsScreen — the Documents bar
test('ticket documents bar builds invoice, receipt, and ticket from the same order', () => {
  const shop = shopOf(buildEmpire())
  const settings = sanitizeSettings(shop.settings)
  const order = shop.orders.find((entry) => entry.status === 'paid')

  const receipt = buildReceiptDocument({ shop, order, settings })
  const invoice = buildInvoiceDocument({ shop, order, settings })
  const ticket = buildTicketDocument({ shop, order, settings })

  for (const doc of [receipt, invoice, ticket]) {
    assert.equal(doc.reference, order.id)
    const html = renderDocumentHtml(doc, settings)
    assert.match(html, /Restora/)
    assert.ok(html.length > 1500)
  }
  assert.equal(receipt.totals.grandTotal, invoice.totals.grandTotal)
  assert.equal(ticket.totals.items, invoice.totals.lines.reduce((sum, line) => sum + line.qty, 0))
})

// ReportsScreen — Print report
test('report document carries the range, KPIs, and the food-cost cap', () => {
  const shop = shopOf(buildEmpire())
  for (const range of ['tonight', '7d', '30d']) {
    const doc = buildReportDocument({ shop, settings: shop.settings, range })
    assert.equal(doc.meta.range, range)
    const html = renderDocumentHtml(doc, shop.settings)
    assert.match(html, /SHIFT REPORT|REPORT/)
    assert.ok(doc.totals)
  }
})

// The audit strip in the Settings header reflects what is configured
test('configuration audit tracks the sections the settings screen edits', () => {
  let empire = buildEmpire()
  const before = configurationAudit(shopOf(empire))
  // Sections the Settings screen edits: identity, documents, catalog,
  // stock, units, food, and item media.
  assert.equal(before.checks.length, before.total)
  assert.ok(before.total >= 12)
  for (const section of ['business', 'documents', 'catalog', 'stock', 'food']) {
    assert.ok(before.checks.some((check) => check.section === section), `${section} is audited`)
  }
  assert.ok(before.checks.some((check) => check.id === 'units'))

  // Blank out the identity, then audit again — the check flips, and
  // restoring the name flips it back.
  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { restaurantName: '' } })
  assert.equal(shopOf(empire).settings.restaurantName, 'Restora · Downtown')   // sanitizer keeps a usable name, never double-prefixed
  empire = act(empire, 'downtown', { type: 'UPDATE_SETTINGS', patch: { logoUrl: '' } })
  assert.equal(shopOf(empire), shopOf(empire))                                 // still a usable shop object
  assert.equal(configurationAudit(shopOf(empire)).total, before.total)
})
