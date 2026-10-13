// ─── Units of measure ───────────────────────────────────────────────
// Stock is always counted in one base unit per item ("the stock unit" —
// ea, kg, ml, portion …). On top of that an item can carry any number of
// pack units the way it is really bought and stored: a bottle of 750 ml,
// a case of 12 bottles, a 5 kg bag. Packs may be sized in the stock unit
// or in another pack, so chains like case → bottle → ml work without a
// fixed global table.
//
// The vocabulary itself is data, not code: `settings.units.list` holds the
// units the owner added (label, short label, family, factor, decimals) and
// `settings.units.packNames` the pack labels offered when packaging an
// item. Everything downstream (purchases, receiving, recipes, reports)
// reads these helpers, so a new unit needs no migration.

export const UNIT_FAMILIES = [
  { id: 'count', label: 'Count' },
  { id: 'weight', label: 'Weight' },
  { id: 'volume', label: 'Volume' },
  { id: 'length', label: 'Length' },
]

export const MAX_UNITS = 24
export const MAX_PACKS = 6
const MAX_UNIT_LABEL = 24
const MAX_UNIT_SHORT = 6
const MAX_PACK_NAME = 16
const MAX_DEPTH = 4

// Families convert through a factor relative to the family's base unit,
// so 1 kg = 1000 g and 0.25 l = 250 ml without an item being involved.
export const DEFAULT_UNITS = [
  { id: 'each', label: 'Each', short: 'ea', family: 'count', factor: 1, decimals: 0 },
  { id: 'portion', label: 'Portion', short: 'ptn', family: 'count', factor: 1, decimals: 0 },
  { id: 'slice', label: 'Slice', short: 'sl', family: 'count', factor: 1, decimals: 0 },
  { id: 'scoop', label: 'Scoop', short: 'sc', family: 'count', factor: 1, decimals: 0 },
  { id: 'can', label: 'Can', short: 'can', family: 'count', factor: 1, decimals: 0 },
  { id: 'g', label: 'Gram', short: 'g', family: 'weight', factor: 1, decimals: 0 },
  { id: 'kg', label: 'Kilogram', short: 'kg', family: 'weight', factor: 1000, decimals: 2 },
  { id: 'oz', label: 'Ounce', short: 'oz', family: 'weight', factor: 28.3495, decimals: 2 },
  { id: 'lb', label: 'Pound', short: 'lb', family: 'weight', factor: 453.592, decimals: 2 },
  { id: 'ml', label: 'Millilitre', short: 'ml', family: 'volume', factor: 1, decimals: 0 },
  { id: 'l', label: 'Litre', short: 'l', family: 'volume', factor: 1000, decimals: 2 },
  { id: 'cup', label: 'Cup', short: 'cup', family: 'volume', factor: 240, decimals: 2 },
  { id: 'bottle', label: 'Bottle', short: 'btl', family: 'volume', factor: 750, decimals: 2 },
  { id: 'cm', label: 'Centimetre', short: 'cm', family: 'length', factor: 1, decimals: 1 },
  { id: 'm', label: 'Metre', short: 'm', family: 'length', factor: 100, decimals: 2 },
]

export const DEFAULT_PACK_NAMES = ['Case', 'Bottle', 'Can', 'Bag', 'Box', 'Crate', 'Keg', 'Pack']

const FAMILY_IDS = new Set(UNIT_FAMILIES.map((family) => family.id))

export function slugUnitId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 12)
}

function positive(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function sanitizeUnit(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const label = String(raw.label ?? raw.name ?? '').trim().slice(0, MAX_UNIT_LABEL)
  const id = slugUnitId(raw.id || label)
  if (!id) return null
  return {
    id,
    label: label || id,
    short: (String(raw.short ?? '').trim().slice(0, MAX_UNIT_SHORT) || id).slice(0, MAX_UNIT_SHORT),
    family: FAMILY_IDS.has(raw.family) ? raw.family : 'count',
    factor: Math.round(positive(raw.factor, 1) * 1000000) / 1000000,
    decimals: Math.min(3, Math.max(0, Math.trunc(Number(raw.decimals) || 0))),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
  }
}

/** The owner's unit vocabulary: unique ids, capped, seeded from the defaults. */
export function sanitizeUnitList(raw) {
  const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_UNITS
  const seen = new Set()
  const list = []
  for (const entry of source) {
    const unit = sanitizeUnit(entry, list.length)
    if (!unit || seen.has(unit.id)) continue
    seen.add(unit.id)
    list.push(unit)
    if (list.length >= MAX_UNITS) break
  }
  return list.length ? list : DEFAULT_UNITS.map((unit, index) => sanitizeUnit(unit, index))
}

export function sanitizePackNames(raw) {
  const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_PACK_NAMES
  const seen = new Set()
  const names = []
  for (const entry of source) {
    const name = String(entry ?? '').trim().slice(0, MAX_PACK_NAME)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length >= 12) break
  }
  return names.length ? names : DEFAULT_PACK_NAMES.slice()
}

/** Per-item packaging: one entry per pack unit, sized in the stock unit or in another pack. */
export function sanitizePackList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const packs = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const name = String(entry.name ?? entry.label ?? '').trim().slice(0, MAX_PACK_NAME)
    const id = slugUnitId(entry.id || name)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const qty = Math.round(positive(entry.qty, 1) * 1000) / 1000
    packs.push({ id, name: name || id, qty, of: entry.of ? slugUnitId(entry.of) : null })
    if (packs.length >= MAX_PACKS) break
  }
  return packs
}

/** A missing unit still works: it behaves like a stock-unit-only definition. */
export function unitOf(settings, unitId) {
  const id = slugUnitId(unitId)
  const found = (settings?.units?.list || []).find((unit) => unit.id === id)
  if (found) return found
  return { id: id || 'each', label: id || 'each', short: id || 'ea', family: 'count', factor: 1, decimals: 0 }
}

export function unitShort(settings, unitId) {
  return unitOf(settings, unitId).short
}

export function unitLabel(settings, unitId) {
  const unit = unitOf(settings, unitId)
  return unit.id === unit.short ? unit.label : `${unit.label} (${unit.short})`
}

export function itemPacks(item) {
  return sanitizePackList(item?.packs)
}

export function itemStockUnit(item) {
  return slugUnitId(item?.unit) || 'each'
}

/** How many stock units one of `unitId` holds. Stock unit = 1; unknown = 1. */
export function packFactor(item, unitId, chain = []) {
  const id = slugUnitId(unitId)
  if (!id) return 1
  if (id === itemStockUnit(item)) return 1
  // A packaging chain that loops back on itself (or runs too deep) is
  // treated as ending here instead of recursing forever.
  if (chain.includes(id) || chain.length >= MAX_DEPTH) return 1
  const pack = itemPacks(item).find((entry) => entry.id === id)
  if (!pack) return 1
  const inner = pack.of ? packFactor(item, pack.of, [...chain, id]) : 1
  const factor = pack.qty * inner
  return Number.isFinite(factor) && factor > 0 ? Math.round(factor * 1000) / 1000 : 1
}

/** Every unit this item can be counted in: its stock unit first, then packs (big → small). */
export function itemUnitChoices(item, settings) {
  const stock = itemStockUnit(item)
  const stockDef = unitOf(settings, stock)
  const choices = [{
    id: stock,
    label: stockDef.label,
    short: stockDef.short,
    kind: 'stock',
    factor: 1,
  }]
  const packs = itemPacks(item)
    .map((pack) => ({
      id: pack.id,
      label: pack.name,
      short: pack.name.slice(0, MAX_UNIT_SHORT),
      kind: 'pack',
      factor: packFactor(item, pack.id),
      of: pack.of,
    }))
    .sort((a, b) => b.factor - a.factor)
  return [...choices, ...packs]
}

export function unitChoice(item, settings, unitId) {
  const id = slugUnitId(unitId)
  return itemUnitChoices(item, settings).find((choice) => choice.id === id) || null
}

export function toBaseQty(item, qty, unitId) {
  const n = Number(qty) || 0
  return Math.round(n * packFactor(item, unitId) * 1000000) / 1000000
}

export function fromBaseQty(item, qty, unitId) {
  const factor = packFactor(item, unitId)
  const n = Number(qty) || 0
  return factor ? Math.round((n / factor) * 1000000) / 1000000 : n
}

export function packPrice(baseCost, factor) {
  const f = positive(factor, 1)
  return Math.round((Number(baseCost) || 0) * f * 10000) / 10000
}

export function basePrice(packCost, factor) {
  const f = positive(factor, 1)
  return Math.round(((Number(packCost) || 0) / f) * 10000) / 10000
}

/**
 * "2 cases + 1 bottle + 250 ml" — the way a chef reads a stock figure.
 * Falls back to the plain stock-unit number when the item has no packs.
 */
export function describeQty(item, qty, settings, { maxParts = 3, sep = ' + ' } = {}) {
  const total = Number(qty) || 0
  const stock = itemStockUnit(item)
  const stockDef = unitOf(settings, stock)
  const decimals = stockDef.decimals
  const unitName = (name, short) => (name || short)
  if (!itemPacks(item).length) {
    return `${roundTo(total, decimals)} ${stockDef.short}`
  }
  const parts = []
  let left = Math.abs(total)
  const packs = itemPacks(item)
    .map((pack) => ({ ...pack, factor: packFactor(item, pack.id) }))
    .sort((a, b) => b.factor - a.factor)
  for (const pack of packs) {
    if (left < pack.factor - 1e-9) continue
    const count = Math.floor(left / pack.factor + 1e-9)
    if (!count) continue
    left = Math.round((left - count * pack.factor) * 1000000) / 1000000
    parts.push(`${count} ${count === 1 ? pack.name : `${pack.name}s`}`)
    if (parts.length >= maxParts) break
  }
  if (left > 1e-9 || !parts.length) {
    parts.push(`${roundTo(left, decimals)} ${stockDef.short}`)
  }
  const text = parts.join(sep)
  return total < 0 ? `-${text}` : text
}

export function formatQty(qty, unitId, settings) {
  const unit = unitOf(settings, unitId)
  return `${roundTo(Number(qty) || 0, unit.decimals)} ${unit.short}`
}

/** Convert between two units of the same family (kg ↔ g, l ↔ ml). */
export function convertQty(qty, fromId, toId, settings) {
  const from = unitOf(settings, fromId)
  const to = unitOf(settings, toId)
  if (from.id === to.id) return Number(qty) || 0
  if (from.family !== to.family) return null
  const n = Number(qty) || 0
  return Math.round((n * from.factor) / to.factor * 1000000) / 1000000
}

function roundTo(value, decimals = 0) {
  const step = 10 ** Math.min(3, Math.max(0, decimals))
  return Math.round(value * step) / step
}

/** Family summary for the settings table ("Weight · 1 kg = 1000 g"). */
export function familySummary(unit) {
  const family = UNIT_FAMILIES.find((entry) => entry.id === unit.family)
  return family ? family.label : 'Count'
}
