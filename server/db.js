// ─── Restora persistence ──────────────────────────────────────────
// SQLite holds the authoritative state snapshot + append-only action log.
// The menu is also projected into normalized tables for fast catalog reads;
// snapshot, action, and menu projection are committed together.

import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.RESTORA_DATA || path.join(here, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'restora.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS actions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    ts TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_catalog_meta (
    location_id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS menu_categories (
    location_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (location_id, id),
    UNIQUE (location_id, name COLLATE NOCASE)
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    location_id TEXT NOT NULL,
    id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    station TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    substitute_id TEXT,
    image_url TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (location_id, id),
    FOREIGN KEY (location_id, category_id)
      REFERENCES menu_categories (location_id, id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS menu_items_display_order
    ON menu_items (location_id, category_id, active, available, sort_order);
  CREATE INDEX IF NOT EXISTS menu_items_name
    ON menu_items (location_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS menu_item_labels (
    location_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('dietary', 'allergen')),
    value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (location_id, menu_item_id, kind, value COLLATE NOCASE),
    FOREIGN KEY (location_id, menu_item_id)
      REFERENCES menu_items (location_id, id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS menu_modifier_groups (
    location_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    id TEXT NOT NULL,
    label TEXT NOT NULL,
    required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (location_id, menu_item_id, id),
    FOREIGN KEY (location_id, menu_item_id)
      REFERENCES menu_items (location_id, id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS menu_modifier_options (
    location_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    modifier_id TEXT NOT NULL,
    option TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (location_id, menu_item_id, modifier_id, sort_order),
    FOREIGN KEY (location_id, menu_item_id, modifier_id)
      REFERENCES menu_modifier_groups (location_id, menu_item_id, id) ON DELETE CASCADE
  );
`)

// Version 1 adds the normalized catalog to the original kv/actions database.
// All schema changes are additive, so existing snapshots/action history remain valid.
if (db.pragma('user_version', { simple: true }) < 1) db.pragma('user_version = 1')

const getKv = db.prepare('SELECT v FROM kv WHERE k = ?')
const setKv = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
const insertAction = db.prepare('INSERT INTO actions (client_id, type, action, ts) VALUES (?, ?, ?, ?)')
const selectSince = db.prepare('SELECT seq, client_id AS clientId, action FROM actions WHERE seq > ? ORDER BY seq ASC LIMIT ?')
const countActions = db.prepare('SELECT COUNT(*) AS n, MAX(seq) AS max FROM actions')
const selectCatalogChecksum = db.prepare('SELECT checksum FROM menu_catalog_meta WHERE location_id = ?')
const setCatalogChecksum = db.prepare(`
  INSERT INTO menu_catalog_meta (location_id, checksum) VALUES (?, ?)
  ON CONFLICT(location_id) DO UPDATE SET checksum = excluded.checksum
`)
const selectCatalogLocations = db.prepare('SELECT location_id FROM menu_catalog_meta')
const deleteCatalogItems = db.prepare('DELETE FROM menu_items WHERE location_id = ?')
const deleteCatalogCategories = db.prepare('DELETE FROM menu_categories WHERE location_id = ?')
const deleteCatalogMeta = db.prepare('DELETE FROM menu_catalog_meta WHERE location_id = ?')
const insertCategory = db.prepare(`
  INSERT INTO menu_categories (location_id, id, name, sort_order) VALUES (?, ?, ?, ?)
`)
const insertMenuItem = db.prepare(`
  INSERT INTO menu_items (
    location_id, id, category_id, name, description, price_cents, station,
    available, active, substitute_id, image_url, sort_order, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
`)
const updateSubstitute = db.prepare(`
  UPDATE menu_items SET substitute_id = ? WHERE location_id = ? AND id = ?
`)
const insertLabel = db.prepare(`
  INSERT OR IGNORE INTO menu_item_labels (location_id, menu_item_id, kind, value, sort_order)
  VALUES (?, ?, ?, ?, ?)
`)
const insertModifierGroup = db.prepare(`
  INSERT INTO menu_modifier_groups (location_id, menu_item_id, id, label, required, sort_order)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const insertModifierOption = db.prepare(`
  INSERT INTO menu_modifier_options (location_id, menu_item_id, modifier_id, option, sort_order)
  VALUES (?, ?, ?, ?, ?)
`)

function cleanText(value, maxLength, fallback = '') {
  return String(value ?? fallback).trim().slice(0, maxLength)
}

function cleanList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value
    .map((entry) => cleanText(entry, 48))
    .filter((entry) => {
      const key = entry.toLocaleLowerCase('en-US')
      if (!entry || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

function categoryId(name) {
  return name.toLocaleLowerCase('en-US')
}

function menusByLocation(empire) {
  if (empire?.locations && typeof empire.locations === 'object') {
    return Object.entries(empire.locations)
      .filter(([, shop]) => Array.isArray(shop?.menu))
      .map(([locationId, shop]) => [locationId, shop.menu])
  }
  if (Array.isArray(empire?.menu)) return [['downtown', empire.menu]]
  return []
}

function syncMenuCatalogTx(empire) {
  const locations = menusByLocation(empire)
  const locationIds = new Set(locations.map(([locationId]) => locationId))

  // Drop projections for a removed store (normally RESET_ALL retains both stores).
  for (const { location_id: oldId } of selectCatalogLocations.all()) {
    if (locationIds.has(oldId)) continue
    deleteCatalogItems.run(oldId)
    deleteCatalogCategories.run(oldId)
    deleteCatalogMeta.run(oldId)
  }

  for (const [locationId, menu] of locations) {
    const checksum = createHash('sha256').update(JSON.stringify(menu)).digest('hex')
    if (selectCatalogChecksum.get(locationId)?.checksum === checksum) continue

    // Rebuild one small location catalog atomically. The checksum avoids doing
    // this for unrelated floor/ticket actions.
    deleteCatalogItems.run(locationId)
    deleteCatalogCategories.run(locationId)

    const categories = new Map()
    for (const [index, item] of menu.entries()) {
      const name = cleanText(item?.category, 40, 'Other') || 'Other'
      const id = categoryId(name)
      if (!categories.has(id)) categories.set(id, { id, name, sortOrder: index })
    }
    for (const category of categories.values()) {
      insertCategory.run(locationId, category.id, category.name, category.sortOrder)
    }

    const itemIds = new Set()
    const substitutes = []
    const now = new Date().toISOString()
    for (const [index, raw] of menu.entries()) {
      const id = cleanText(raw?.id, 100)
      const name = cleanText(raw?.name, 60)
      if (!id || !name || itemIds.has(id)) continue
      itemIds.add(id)
      const category = cleanText(raw?.category, 40, 'Other') || 'Other'
      const numericPrice = Number(raw?.price)
      const priceCents = Number.isFinite(numericPrice) ? Math.max(0, Math.round(numericPrice * 100)) : 0
      const sortOrder = Number.isFinite(Number(raw?.sortOrder)) ? Math.max(0, Math.trunc(Number(raw.sortOrder))) : index
      const imageUrl = cleanText(raw?.imageUrl, 500)
      const substituteId = cleanText(raw?.substituteId, 100)

      insertMenuItem.run(
        locationId,
        id,
        categoryId(category),
        name,
        cleanText(raw?.description, 240),
        priceCents,
        cleanText(raw?.station, 24, 'pantry') || 'pantry',
        raw?.available === false ? 0 : 1,
        raw?.active === false ? 0 : 1,
        imageUrl,
        sortOrder,
        now,
      )
      substitutes.push([substituteId, id])

      for (const [kind, values] of [['dietary', cleanList(raw?.dietaryTags)], ['allergen', cleanList(raw?.allergens)]]) {
        values.forEach((value, labelOrder) => insertLabel.run(locationId, id, kind, value, labelOrder))
      }

      const seenModifierIds = new Set()
      for (const [groupIndex, modifier] of (Array.isArray(raw?.modifiers) ? raw.modifiers : []).entries()) {
        const baseId = cleanText(modifier?.id, 80, `modifier_${groupIndex}`) || `modifier_${groupIndex}`
        let modifierId = baseId
        let suffix = 1
        while (seenModifierIds.has(modifierId)) modifierId = `${baseId}_${suffix++}`
        seenModifierIds.add(modifierId)
        insertModifierGroup.run(
          locationId,
          id,
          modifierId,
          cleanText(modifier?.label, 60, 'Options') || 'Options',
          modifier?.required ? 1 : 0,
          groupIndex,
        )
        const options = Array.isArray(modifier?.options) ? modifier.options : []
        options.forEach((option, optionIndex) => {
          const value = cleanText(option, 80)
          if (value) insertModifierOption.run(locationId, id, modifierId, value, optionIndex)
        })
      }
    }

    // Insert substitute references after all item rows exist. Keep unknown ids
    // unset so stale references cannot break the menu read model.
    for (const [substituteId, id] of substitutes) {
      if (substituteId && itemIds.has(substituteId)) updateSubstitute.run(substituteId, locationId, id)
    }
    setCatalogChecksum.run(locationId, checksum)
  }
}

const saveSnapshotTx = db.transaction((stateJson, seq, state) => {
  setKv.run('snapshot', stateJson)
  setKv.run('snapshot_seq', String(seq))
  syncMenuCatalogTx(state)
})

const syncMenuCatalogStandalone = db.transaction(syncMenuCatalogTx)

const commitActionTx = db.transaction((clientId, actionType, actionJson, timestamp, stateJson, state) => {
  const info = insertAction.run(clientId, actionType, actionJson, timestamp)
  const seq = Number(info.lastInsertRowid)
  setKv.run('snapshot', stateJson)
  setKv.run('snapshot_seq', String(seq))
  syncMenuCatalogTx(state)
  return seq
})

export function loadSnapshot() {
  const snap = getKv.get('snapshot')
  const seq = getKv.get('snapshot_seq')
  if (!snap) return null
  try {
    return { state: JSON.parse(snap.v), seq: Number(seq?.v || 0) }
  } catch {
    return null
  }
}

export function saveSnapshot(state, seq) {
  saveSnapshotTx(JSON.stringify(state), seq, state)
}

export function syncMenuCatalog(state) {
  syncMenuCatalogStandalone(state)
}

export function commitAction(clientId, action, state) {
  const stateJson = JSON.stringify(state)
  return commitActionTx(
    typeof clientId === 'string' ? clientId : 'anon',
    action.type,
    JSON.stringify(action),
    new Date().toISOString(),
    stateJson,
    state,
  )
}

export function actionsSince(seq, limit = 500) {
  return selectSince.all(seq, limit).map((row) => ({ ...row, action: JSON.parse(row.action) }))
}

export function logStats() {
  return countActions.get()
}

const selectCategories = db.prepare(`
  SELECT id, name, sort_order AS sortOrder
  FROM menu_categories
  WHERE location_id = ?
  ORDER BY sort_order ASC, name COLLATE NOCASE ASC
`)
const selectMenuItems = db.prepare(`
  SELECT
    item.id,
    item.name,
    item.description,
    category.name AS category,
    item.price_cents AS priceCents,
    item.station,
    item.available,
    item.active,
    item.substitute_id AS substituteId,
    item.image_url AS imageUrl,
    item.sort_order AS sortOrder
  FROM menu_items AS item
  JOIN menu_categories AS category
    ON category.location_id = item.location_id AND category.id = item.category_id
  WHERE item.location_id = @locationId
    AND (@query = '' OR instr(lower(item.name), lower(@query)) > 0 OR instr(lower(item.description), lower(@query)) > 0)
    AND (@category = '' OR category.name = @category COLLATE NOCASE)
    AND (@availableOnly = 0 OR (item.available = 1 AND item.active = 1))
  ORDER BY category.sort_order ASC, item.sort_order ASC, item.name COLLATE NOCASE ASC
`)
const selectLabels = db.prepare(`
  SELECT menu_item_id AS menuItemId, kind, value, sort_order AS sortOrder
  FROM menu_item_labels
  WHERE location_id = ?
  ORDER BY sort_order ASC, value COLLATE NOCASE ASC
`)
const selectModifierGroups = db.prepare(`
  SELECT menu_item_id AS menuItemId, id, label, required, sort_order AS sortOrder
  FROM menu_modifier_groups
  WHERE location_id = ?
  ORDER BY menu_item_id, sort_order ASC
`)
const selectModifierOptions = db.prepare(`
  SELECT menu_item_id AS menuItemId, modifier_id AS modifierId, option, sort_order AS sortOrder
  FROM menu_modifier_options
  WHERE location_id = ?
  ORDER BY menu_item_id, modifier_id, sort_order ASC
`)

export function getMenuCatalog(locationId, filters = {}) {
  const query = cleanText(filters.query, 80)
  const category = cleanText(filters.category, 40)
  const availableOnly = filters.availableOnly ? 1 : 0
  const rows = selectMenuItems.all({ locationId, query, category, availableOnly })
  const itemById = new Map(rows.map((row) => [row.id, {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: row.priceCents / 100,
    priceCents: row.priceCents,
    station: row.station,
    available: Boolean(row.available),
    active: Boolean(row.active),
    substituteId: row.substituteId,
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
    dietaryTags: [],
    allergens: [],
    modifiers: [],
  }]))

  for (const label of selectLabels.all(locationId)) {
    const item = itemById.get(label.menuItemId)
    if (item) item[label.kind === 'dietary' ? 'dietaryTags' : 'allergens'].push(label.value)
  }

  const optionsByGroup = new Map()
  for (const option of selectModifierOptions.all(locationId)) {
    const key = `${option.menuItemId}:${option.modifierId}`
    if (!optionsByGroup.has(key)) optionsByGroup.set(key, [])
    optionsByGroup.get(key).push(option.option)
  }
  for (const group of selectModifierGroups.all(locationId)) {
    const item = itemById.get(group.menuItemId)
    if (!item) continue
    item.modifiers.push({
      id: group.id,
      label: group.label,
      required: Boolean(group.required),
      options: optionsByGroup.get(`${group.menuItemId}:${group.id}`) || [],
    })
  }

  return {
    locationId,
    categories: selectCategories.all(locationId).map((row) => ({ ...row, sortOrder: Number(row.sortOrder) })),
    items: rows.map((row) => itemById.get(row.id)),
  }
}

// Useful for graceful shutdown and isolated SQLite tests.
export function closeDatabase() {
  if (db.open) db.close()
}
