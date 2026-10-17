// ─── Units of measure ───────────────────────────────────────────────
// The vocabulary is data: units are configured, packs are per item, and a
// purchase ordered in cases lands in stock as stock units.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'
import { configurationAudit, defaultSettings, sanitizeSettings } from '../src/lib/settings.js'
import {
  DEFAULT_UNITS,
  basePrice,
  convertQty,
  describeQty,
  formatQty,
  itemUnitChoices,
  packFactor,
  packPrice,
  sanitizePackList,
  sanitizePackNames,
  sanitizeUnitList,
  slugUnitId,
  toBaseQty,
} from '../src/lib/units.js'

const settings = sanitizeSettings(defaultSettings('DT'))

const shopOf = (empire) => empire.locations.downtown
const itemOf = (empire, id) => shopOf(empire).inventory.find((entry) => entry.id === id)

function local(empire, action) {
  return reducer(empire, { type: 'LOC', locId: 'downtown', action })
}

// An item bought in bottles of 750 ml, cased 12 at a time.
const DRESSING = {
  id: 'inv_house_dressing',
  name: 'House dressing',
  unit: 'ml',
  onHand: 0,
  par: 3000,
  lastCost: 0.002,
  packs: [
    { id: 'bottle', name: 'Bottle', qty: 750 },
    { id: 'case', name: 'Case', qty: 12, of: 'bottle' },
  ],
  purchaseUnit: 'case',
}

// Seeded items all have history, and history freezes the stock unit — so the
// tests that change a unit add their own item first.
const freshDressing = (empire, overrides = {}) => local(empire, {
  type: 'ADD_INVENTORY_ITEM',
  item: { supplierId: 'sup_dry', location: 'dry', ...DRESSING, ...overrides },
})

test('the unit vocabulary is data and survives hand-edited input', () => {
  const list = sanitizeUnitList([
    { label: 'Keg' },
    { label: 'Keg' },
    { name: 'Pony keg', short: 'pk', family: 'volume', factor: 30000, decimals: 1 },
    { label: '' },
    'nonsense',
    { id: 'x'.repeat(40), label: 'Long' },
  ])
  assert.deepEqual(list.map((unit) => unit.id), ['keg', 'pony_keg', 'x'.repeat(12)])
  assert.equal(list[1].family, 'volume')
  assert.equal(list[1].factor, 30000)
  assert.equal(list[1].decimals, 1)
  // An empty list falls back to the shipped vocabulary rather than no units.
  assert.equal(sanitizeUnitList([]).length, DEFAULT_UNITS.length)
  assert.equal(sanitizeUnitList('nope').length, DEFAULT_UNITS.length)
  assert.equal(slugUnitId('  Half & Half '), 'half_half')

  assert.deepEqual(sanitizePackNames(['Case', 'case', ' Bag ', '']), ['Case', 'Bag'])
  assert.equal(sanitizePackNames([]).includes('Case'), true)
  assert.equal(sanitizeUnitList(DEFAULT_UNITS.map((unit) => unit)).every((unit) => unit.family), true)
})

test('packaging is per item and chains through other packs', () => {
  assert.equal(packFactor(DRESSING, 'ml'), 1, 'the stock unit is always 1')
  assert.equal(packFactor(DRESSING, 'bottle'), 750)
  assert.equal(packFactor(DRESSING, 'case'), 9000, '12 bottles of 750 ml')
  assert.equal(packFactor(DRESSING, 'pallet'), 1, 'an unknown unit behaves like 1')
  assert.equal(packFactor({ unit: 'each', packs: [{ id: 'loop', name: 'Loop', qty: 3, of: 'loop' }] }, 'loop'), 3, 'a self-referencing chain still resolves')

  const choices = itemUnitChoices(DRESSING, settings)
  assert.deepEqual(choices.map((choice) => choice.id), ['ml', 'case', 'bottle'], 'biggest pack first')
  assert.equal(choices[0].kind, 'stock')

  assert.deepEqual(sanitizePackList([
    { name: 'Case', qty: 12 },
    { name: 'case', qty: 99 },
    { name: '', qty: 4 },
    { name: 'Box', qty: '-3' },
    'junk',
  ]), [{ id: 'case', name: 'Case', qty: 12, of: null }, { id: 'box', name: 'Box', qty: 1, of: null }])
})

test('quantities convert, round, and read the way a kitchen reads them', () => {
  assert.equal(toBaseQty(DRESSING, 2, 'case'), 18000)
  assert.equal(toBaseQty(DRESSING, 0.5, 'bottle'), 375)
  assert.equal(describeQty(DRESSING, 9820, settings), '1 Case + 1 Bottle + 70 ml')
  assert.equal(describeQty(DRESSING, 9000, settings), '1 Case')
  assert.equal(describeQty(DRESSING, 375, settings), '375 ml')
  assert.equal(describeQty(DRESSING, 0, settings), '0 ml')
  assert.equal(describeQty({ unit: 'kg', packs: [] }, 2.5, settings), '2.5 kg')

  assert.equal(formatQty(2.5, 'kg', settings), '2.5 kg')
  assert.equal(convertQty(1, 'kg', 'g', settings), 1000)
  assert.equal(convertQty(250, 'ml', 'l', settings), 0.25)
  assert.equal(convertQty(1, 'kg', 'ml', settings), null, 'families never mix')
  assert.equal(convertQty(3, 'each', 'each', settings), 3)

  assert.equal(packPrice(0.002, 750), 1.5, 'a bottle of something costs the pack')
  assert.equal(basePrice(18, 9000), 0.002, 'and back again')
})

test('settings carry the vocabulary, the pack labels, and the two policy switches', () => {
  const configured = sanitizeSettings({
    units: {
      list: [{ label: 'Each' }, { label: 'Bottle', family: 'volume', factor: 750 }],
      packNames: ['Case', 'Crate'],
      defaultStockUnit: 'bottle',
      defaultPurchaseUnit: 'Crate',
      convertOnReceive: false,
      showPackBreakdown: false,
    },
  })
  assert.deepEqual(configured.units.list.map((unit) => unit.id), ['each', 'bottle'])
  assert.equal(configured.units.defaultStockUnit, 'bottle')
  assert.equal(configured.units.defaultPurchaseUnit, 'crate')
  assert.equal(configured.units.convertOnReceive, false)
  assert.equal(configured.units.showPackBreakdown, false)
  // The stock block keeps pointing at a unit that really exists.
  assert.equal(configured.stock.defaultUnit, 'bottle')
  assert.equal(sanitizeSettings({ units: { defaultStockUnit: 'ghost' } }).stock.defaultUnit, 'each')
})

test('the audit asks for units and packaging', () => {
  const empire = buildEmpire()
  const audit = configurationAudit(shopOf(empire))
  const units = audit.checks.find((check) => check.id === 'units')
  const packaging = audit.checks.find((check) => check.id === 'packaging')
  assert.ok(units && packaging, 'both checks exist')
  assert.equal(units.ok, true, 'the seed uses the shipped vocabulary')
  assert.equal(packaging.ok, true, 'supplied items carry packs')
  assert.equal(audit.ready, true, `audit: ${JSON.stringify(audit.checks.filter((check) => !check.ok))}`)

  const broken = configurationAudit({
    ...shopOf(empire),
    inventory: [
      ...shopOf(empire).inventory,
      { id: 'inv_ghost', name: 'Ghost', unit: 'pallet', supplierId: 'sup_produce', purchaseUnit: 'pallet', packs: [] },
    ],
  })
  assert.equal(broken.checks.find((check) => check.id === 'units').ok, false)
  assert.equal(broken.checks.find((check) => check.id === 'packaging').ok, false)
})

test('a stock item keeps its packaging through add and update', () => {
  let empire = freshDressing(buildEmpire())
  const item = itemOf(empire, 'inv_house_dressing')
  assert.equal(item.unit, 'ml')
  assert.deepEqual(item.packs, sanitizePackList(DRESSING.packs))
  assert.equal(item.purchaseUnit, 'case')

  empire = local(empire, { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_house_dressing', patch: { packs: [{ name: 'Tray', qty: 24 }], purchaseUnit: 'Tray' } })
  const retray = itemOf(empire, 'inv_house_dressing')
  assert.deepEqual(retray.packs, [{ id: 'tray', name: 'Tray', qty: 24, of: null }])
  assert.equal(retray.purchaseUnit, 'tray')

  empire = local(empire, { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_house_dressing', patch: { packs: 'junk' } })
  assert.deepEqual(itemOf(empire, 'inv_house_dressing').packs, [])

  // Once stock has moved, the count unit is a promise the item cannot break:
  // every movement and purchase line is counted in it.
  empire = local(empire, {
    type: 'RECEIVE_INVOICE',
    vendor: 'Dry Goods Co',
    supplierId: 'sup_dry',
    lines: [{ inventoryItemId: 'inv_house_dressing', qty: 2000, unitCost: 0.002 }],
  })
  const frozen = local(empire, { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_house_dressing', patch: { unit: 'each', par: 12 } })
  const moved = itemOf(frozen, 'inv_house_dressing')
  assert.equal(moved.unit, 'ml', 'existing movements keep their meaning')
  assert.equal(moved.par, 12, 'the rest of the edit still lands')
})

test('an order placed in cases receives stock units', () => {
  let empire = freshDressing(buildEmpire())
  empire = local(empire, {
    type: 'UPSERT_PURCHASE',
    purchase: {
      id: 'po_units_1',
      supplierId: 'sup_beverage',
      status: 'ordered',
      lines: [{ id: 'l1', inventoryItemId: 'inv_house_dressing', name: 'House dressing', unit: 'case', qty: 2, unitCost: 18 }],
    },
  })
  const draft = shopOf(empire).purchases.find((entry) => entry.id === 'po_units_1')
  assert.equal(draft.lines[0].packSize, 9000, 'the order freezes what a case holds')
  assert.equal(draft.totals.subtotal, 36)

  empire = local(empire, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_units_1' })
  const item = itemOf(empire, 'inv_house_dressing')
  assert.equal(item.onHand, 18000, '2 cases of 12 × 750 ml')
  assert.equal(item.lastCost, 0.002, 'cost per stock unit')
  assert.equal(item.purchaseUnit, 'case')

  const purchase = shopOf(empire).purchases.find((entry) => entry.id === 'po_units_1')
  assert.equal(purchase.status, 'received')
  assert.equal(purchase.lines[0].receivedQty, 2, 'received is still counted in cases')
  assert.equal(purchase.lines[0].receivedBaseQty, 18000)
  assert.equal(purchase.lines[0].unitCost, 18, 'the line keeps the vendor price per case')

  const movement = shopOf(empire).movements.find((entry) => entry.ref === 'po_units_1')
  assert.equal(movement.qty, 18000)
  assert.equal(movement.unitCost, 0.002)
  assert.equal(movement.value, 36)
  assert.match(movement.note, /2 case @ 9000/)

  const logged = shopOf(empire).invoiceLog.at(-1)
  assert.equal(logged.reference, purchase.number)
  assert.equal(logged.lines[0].qty, 18000)
  assert.equal(logged.lines[0].orderedQty, 2)
  assert.equal(logged.lines[0].unit, 'case')
  assert.equal(logged.lines[0].orderedTotal, 36)
  assert.equal(logged.total, 36)
})

test('a partial case delivery lands only what arrived', () => {
  let empire = freshDressing(buildEmpire(), { onHand: 3000 })
  empire = local(empire, {
    type: 'UPSERT_PURCHASE',
    purchase: {
      id: 'po_units_2',
      supplierId: 'sup_beverage',
      status: 'ordered',
      lines: [{ id: 'l1', inventoryItemId: 'inv_house_dressing', name: 'House dressing', unit: 'case', qty: 3, unitCost: 18 }],
    },
  })
  empire = local(empire, {
    type: 'RECEIVE_PURCHASE',
    purchaseId: 'po_units_2',
    lines: [{ id: 'l1', qty: 1, unitCost: 18 }],
  })
  const item = itemOf(empire, 'inv_house_dressing')
  assert.equal(item.onHand, 3000 + 9000, 'one of the three cases arrived')
  const purchase = shopOf(empire).purchases.find((entry) => entry.id === 'po_units_2')
  assert.equal(purchase.status, 'ordered', 'still open — two cases outstanding')
  assert.equal(purchase.lines[0].receivedQty, 1)
  assert.equal(purchase.lines[0].receivedBaseQty, 9000)

  // Ordering the rest in bottles: the same purchase can be topped up.
  empire = local(empire, {
    type: 'RECEIVE_PURCHASE',
    purchaseId: 'po_units_2',
    lines: [{ id: 'l1', qty: 15000, unitCost: 0.002 }],
  })
  const closed = shopOf(empire).purchases.find((entry) => entry.id === 'po_units_2')
  assert.equal(closed.lines[0].receivedQty, 15001, '15 000 stock units read as 15 001 in the ordered unit')
  assert.equal(closed.status, 'received')
})

test('the seed stocks cases and orders produce by the case', () => {
  const shop = buildEmpire().locations.downtown
  const soda = shop.inventory.find((item) => item.id === 'inv_soda')
  const lettuce = shop.inventory.find((item) => item.id === 'inv_lettuce')
  // Seed rows ship the canonical pack shape (packs always carry `of`),
  // so a raw buildEmpire equals the hydrated snapshot bit for bit.
  assert.deepEqual(soda.packs, [{ id: 'case', name: 'Case', qty: 24, of: null }])
  assert.equal(describeQty(soda, soda.onHand, settings), '4 Cases')
  assert.equal(describeQty(lettuce, lettuce.onHand, settings), '6 Cases + 4 ptn')

  const ordered = shop.purchases.find((entry) => entry.id === 'po_seed_3')
  assert.equal(ordered.lines[0].unit, 'case')
  assert.equal(ordered.lines[0].qty, 4)
  assert.equal(ordered.totals.subtotal, 56.4, 'four cases of lettuce plus tomatoes')
  assert.equal(toBaseQty(lettuce, ordered.lines[0].qty, 'case'), 24)
})
