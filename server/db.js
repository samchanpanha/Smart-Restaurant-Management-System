// ─── Restora persistence ──────────────────────────────────────────
// SQLite holds the authoritative state snapshot + append-only action log,
// scoped per tenant (host owner). Every table gained an `owner_id` column
// in schema v3 so one database serves every restaurant with full isolation:
// snapshots, action replay, and the menu/config projections are all keyed
// by owner. The account tables (auth_*) stay global.

import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.RESTORA_DATA || path.join(here, 'data')
fs.mkdirSync(dataDir, { recursive: true })

export const db = new Database(path.join(dataDir, 'restora.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Rows that predate multi-tenancy belong to this owner id. The super admin
// can adopt them; nobody else can see them unless they are that tenant.
export const DEFAULT_OWNER = 'default'

// ─── Schema ──────────────────────────────────────────────────────
// Kept as a named map so the v3 migration can recreate a legacy table with
// the same definition after copying its rows under DEFAULT_OWNER.

const TENANT_TABLES = {
  menu_catalog_meta: `
    CREATE TABLE IF NOT EXISTS menu_catalog_meta (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      checksum TEXT NOT NULL,
      PRIMARY KEY (owner_id, location_id)
    );`,
  menu_categories: `
    CREATE TABLE IF NOT EXISTS menu_categories (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (owner_id, location_id, id),
      UNIQUE (owner_id, location_id, name COLLATE NOCASE)
    );`,
  menu_items: `
    CREATE TABLE IF NOT EXISTS menu_items (
      owner_id TEXT NOT NULL,
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
      sub_category TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, location_id, id),
      FOREIGN KEY (owner_id, location_id, category_id)
        REFERENCES menu_categories (owner_id, location_id, id) ON DELETE RESTRICT
    );`,
  menu_item_labels: `
    CREATE TABLE IF NOT EXISTS menu_item_labels (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      menu_item_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dietary', 'allergen')),
      value TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_id, location_id, menu_item_id, kind, value COLLATE NOCASE),
      FOREIGN KEY (owner_id, location_id, menu_item_id)
        REFERENCES menu_items (owner_id, location_id, id) ON DELETE CASCADE
    );`,
  menu_modifier_groups: `
    CREATE TABLE IF NOT EXISTS menu_modifier_groups (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      menu_item_id TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_id, location_id, menu_item_id, id),
      FOREIGN KEY (owner_id, location_id, menu_item_id)
        REFERENCES menu_items (owner_id, location_id, id) ON DELETE CASCADE
    );`,
  menu_modifier_options: `
    CREATE TABLE IF NOT EXISTS menu_modifier_options (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      menu_item_id TEXT NOT NULL,
      modifier_id TEXT NOT NULL,
      option TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_id, location_id, menu_item_id, modifier_id, sort_order),
      FOREIGN KEY (owner_id, location_id, menu_item_id, modifier_id)
        REFERENCES menu_modifier_groups (owner_id, location_id, menu_item_id, id) ON DELETE CASCADE
    );`,
  suppliers: `
    CREATE TABLE IF NOT EXISTS suppliers (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      contact_name TEXT NOT NULL DEFAULT '',
      contact_role TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      address_line1 TEXT NOT NULL DEFAULT '',
      address_line2 TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      payment_terms TEXT NOT NULL DEFAULT 'net_30',
      lead_time_days INTEGER NOT NULL DEFAULT 0,
      min_order_value REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT '',
      delivery_days TEXT NOT NULL DEFAULT '[]',
      categories TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
      rating INTEGER NOT NULL DEFAULT 0,
      account_number TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, location_id, id)
    );`,
  inventory_items: `
    CREATE TABLE IF NOT EXISTS inventory_items (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      sku TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'each',
      on_hand REAL NOT NULL DEFAULT 0,
      par REAL NOT NULL DEFAULT 0,
      reorder_point REAL NOT NULL DEFAULT 0,
      daily_use REAL NOT NULL DEFAULT 0,
      last_cost REAL NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,
      vendor TEXT NOT NULL DEFAULT '',
      supplier_id TEXT,
      category TEXT NOT NULL DEFAULT '',
      sub_category TEXT NOT NULL DEFAULT '',
      storage TEXT NOT NULL DEFAULT 'dry',
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, location_id, id)
    );`,
  location_settings: `
    CREATE TABLE IF NOT EXISTS location_settings (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      settings TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, location_id)
    );`,
  issued_documents: `
    CREATE TABLE IF NOT EXISTS issued_documents (
      owner_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('invoice', 'receipt', 'ticket', 'report')),
      number TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'USD',
      total REAL NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      voided INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_id, location_id, id)
    );`,
  projection_meta: `
    CREATE TABLE IF NOT EXISTS projection_meta (
      owner_id TEXT NOT NULL,
      area TEXT NOT NULL,
      location_id TEXT NOT NULL,
      checksum TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, area, location_id)
    );`,
}

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    owner_id TEXT NOT NULL,
    k TEXT NOT NULL,
    v TEXT NOT NULL,
    PRIMARY KEY (owner_id, k)
  );
  CREATE TABLE IF NOT EXISTS actions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL DEFAULT '${DEFAULT_OWNER}',
    client_id TEXT NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    ts TEXT NOT NULL
  );
`)
for (const sql of Object.values(TENANT_TABLES)) db.exec(sql)

// ─── Migrations ──────────────────────────────────────────────────
// v1 → v2 added the config read models (handled additively below).
// v2 → v3 scoped every state table by owner. Legacy rows are copied under
// DEFAULT_OWNER so an existing single-tenant deployment keeps its data.
// The indexes are created after this block: they reference owner_id.

function hasColumn(table, column) {
  return db.pragma(`table_info(${table})`).some((info) => info.name === column)
}

function tableExists(table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

if (!hasColumn('menu_items', 'sub_category')) db.exec("ALTER TABLE menu_items ADD COLUMN sub_category TEXT NOT NULL DEFAULT ''")
if (!hasColumn('menu_items', 'sku')) db.exec("ALTER TABLE menu_items ADD COLUMN sku TEXT NOT NULL DEFAULT ''")
if (!hasColumn('menu_categories', 'parent_id')) db.exec('ALTER TABLE menu_categories ADD COLUMN parent_id TEXT')
if (!hasColumn('menu_categories', 'description')) db.exec("ALTER TABLE menu_categories ADD COLUMN description TEXT NOT NULL DEFAULT ''")
if (!hasColumn('menu_categories', 'station')) db.exec("ALTER TABLE menu_categories ADD COLUMN station TEXT NOT NULL DEFAULT ''")
if (!hasColumn('menu_categories', 'active')) db.exec('ALTER TABLE menu_categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1')

if (db.pragma('user_version', { simple: true }) < 3) {
  // FK toggles are ignored inside a transaction, so flip them off up front and
  // back on once every table has been rebuilt.
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('PRAGMA legacy_alter_table = ON')
  try {
    if (!hasColumn('actions', 'owner_id')) {
      db.exec(`ALTER TABLE actions ADD COLUMN owner_id TEXT NOT NULL DEFAULT '${DEFAULT_OWNER}'`)
    }
    if (!hasColumn('kv', 'owner_id')) {
      // kv has a composite primary key in v3, so rebuild the table.
      db.exec(`
        BEGIN;
        ALTER TABLE kv RENAME TO kv__legacy;
        CREATE TABLE kv (
          owner_id TEXT NOT NULL,
          k TEXT NOT NULL,
          v TEXT NOT NULL,
          PRIMARY KEY (owner_id, k)
        );
        INSERT INTO kv (owner_id, k, v) SELECT '${DEFAULT_OWNER}', k, v FROM kv__legacy;
        DROP TABLE kv__legacy;
        COMMIT;
      `)
    }
    // Any tenant table that still lacks owner_id gets rebuilt with its rows
    // adopted by DEFAULT_OWNER. RENAME keeps child FK references pointing at
    // the final table name, not the scratch one.
    for (const [table, createSql] of Object.entries(TENANT_TABLES)) {
      if (!tableExists(table) || hasColumn(table, 'owner_id')) continue
      const legacy = `${table}__legacy`
      db.exec('BEGIN')
      db.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`)
      db.exec(createSql)
      const cols = db.pragma(`table_info(${legacy})`).map((info) => info.name).join(', ')
      db.exec(`INSERT INTO ${table} (owner_id, ${cols}) SELECT '${DEFAULT_OWNER}', ${cols} FROM ${legacy}`)
      db.exec(`DROP TABLE ${legacy}`)
      db.exec('COMMIT')
    }
    db.pragma('user_version = 3')
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF')
    db.exec('PRAGMA foreign_keys = ON')
  }
  const violations = db.pragma('foreign_key_check')
  if (violations.length) {
    throw new Error(`schema v3 migration left ${violations.length} broken reference(s)`)
  }
}

// Indexes are created after the migration so every table already has owner_id.
db.exec(`
  CREATE INDEX IF NOT EXISTS menu_items_display_order
    ON menu_items (owner_id, location_id, category_id, active, available, sort_order);
  CREATE INDEX IF NOT EXISTS menu_items_name
    ON menu_items (owner_id, location_id, name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS suppliers_by_name
    ON suppliers (owner_id, location_id, name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS inventory_items_by_name
    ON inventory_items (owner_id, location_id, name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS inventory_items_by_supplier
    ON inventory_items (owner_id, location_id, supplier_id);
  CREATE INDEX IF NOT EXISTS issued_documents_by_kind
    ON issued_documents (owner_id, location_id, kind, issued_at DESC);
  CREATE INDEX IF NOT EXISTS actions_by_owner
    ON actions (owner_id, seq);
`)

// ─── Prepared statements ─────────────────────────────────────────
// Every statement is tenant-scoped by owner_id; the owner id is always the
// first bound parameter so a query can never leak across restaurants.

const getKv = db.prepare('SELECT v FROM kv WHERE owner_id = ? AND k = ?')
const setKv = db.prepare(`
  INSERT INTO kv (owner_id, k, v) VALUES (?, ?, ?)
  ON CONFLICT(owner_id, k) DO UPDATE SET v = excluded.v
`)
const insertAction = db.prepare('INSERT INTO actions (owner_id, client_id, type, action, ts) VALUES (?, ?, ?, ?, ?)')
const selectSince = db.prepare('SELECT seq, client_id AS clientId, action FROM actions WHERE owner_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
const countActions = db.prepare('SELECT COUNT(*) AS n, MAX(seq) AS max FROM actions WHERE owner_id = ?')
// The action log is a replay buffer, not an audit archive: keep the newest
// RETAIN_ACTIONS per tenant so the table (and replay payloads) stay bounded.
// AUTOINCREMENT never reuses seq, so a client too far behind simply resyncs.
const pruneActions = db.prepare('DELETE FROM actions WHERE owner_id = ? AND seq <= ?')
const RETAIN_ACTIONS = 5000

const selectCatalogChecksum = db.prepare('SELECT checksum FROM menu_catalog_meta WHERE owner_id = ? AND location_id = ?')
const setCatalogChecksum = db.prepare(`
  INSERT INTO menu_catalog_meta (owner_id, location_id, checksum) VALUES (?, ?, ?)
  ON CONFLICT(owner_id, location_id) DO UPDATE SET checksum = excluded.checksum
`)
const selectCatalogLocations = db.prepare('SELECT location_id FROM menu_catalog_meta WHERE owner_id = ?')
const deleteCatalogItems = db.prepare('DELETE FROM menu_items WHERE owner_id = ? AND location_id = ?')
const deleteCatalogCategories = db.prepare('DELETE FROM menu_categories WHERE owner_id = ? AND location_id = ?')
const deleteCatalogMeta = db.prepare('DELETE FROM menu_catalog_meta WHERE owner_id = ? AND location_id = ?')
const insertCategory = db.prepare(`
  INSERT INTO menu_categories (
    owner_id, location_id, id, name, sort_order, parent_id, description, station, active
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertMenuItem = db.prepare(`
  INSERT INTO menu_items (
    owner_id, location_id, id, category_id, name, description, price_cents, station,
    available, active, substitute_id, image_url, sub_category, sku, sort_order, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
`)
const updateSubstitute = db.prepare('UPDATE menu_items SET substitute_id = ? WHERE owner_id = ? AND location_id = ? AND id = ?')
const insertLabel = db.prepare(`
  INSERT OR IGNORE INTO menu_item_labels (owner_id, location_id, menu_item_id, kind, value, sort_order)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const insertModifierGroup = db.prepare(`
  INSERT INTO menu_modifier_groups (owner_id, location_id, menu_item_id, id, label, required, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const insertModifierOption = db.prepare(`
  INSERT INTO menu_modifier_options (owner_id, location_id, menu_item_id, modifier_id, option, sort_order)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const deleteSuppliers = db.prepare('DELETE FROM suppliers WHERE owner_id = ? AND location_id = ?')
const insertSupplier = db.prepare(`
  INSERT INTO suppliers (
    owner_id, location_id, id, name, contact_name, contact_role, email, phone, website,
    address_line1, address_line2, city, state, postal_code, country, tax_id,
    payment_terms, lead_time_days, min_order_value, currency, delivery_days,
    categories, status, rating, account_number, notes, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const deleteInventoryItems = db.prepare('DELETE FROM inventory_items WHERE owner_id = ? AND location_id = ?')
const insertInventoryItem = db.prepare(`
  INSERT INTO inventory_items (
    owner_id, location_id, id, name, sku, unit, on_hand, par, reorder_point, daily_use,
    last_cost, avg_cost, vendor, supplier_id, category, sub_category, storage, active, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const deleteSettings = db.prepare('DELETE FROM location_settings WHERE owner_id = ? AND location_id = ?')
const insertSettings = db.prepare('INSERT INTO location_settings (owner_id, location_id, settings, updated_at) VALUES (?, ?, ?, ?)')
const deleteDocuments = db.prepare('DELETE FROM issued_documents WHERE owner_id = ? AND location_id = ?')
const insertDocument = db.prepare(`
  INSERT INTO issued_documents (
    owner_id, location_id, id, kind, number, reference, currency, total, payload, issued_at, voided
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const selectProjectionChecksum = db.prepare('SELECT checksum FROM projection_meta WHERE owner_id = ? AND area = ? AND location_id = ?')
const setProjectionChecksum = db.prepare(`
  INSERT INTO projection_meta (owner_id, area, location_id, checksum, updated_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(owner_id, area, location_id) DO UPDATE SET checksum = excluded.checksum, updated_at = excluded.updated_at
`)
const selectProjectionLocations = db.prepare('SELECT DISTINCT location_id FROM projection_meta WHERE owner_id = ? AND area = ?')

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
      .map(([locationId, shop]) => [locationId, shop.menu, shop])
  }
  if (Array.isArray(empire?.menu)) return [['downtown', empire.menu, empire]]
  return []
}

function syncMenuCatalogTx(ownerId, empire) {
  const locations = menusByLocation(empire)
  const locationIds = new Set(locations.map(([locationId]) => locationId))

  // Drop projections for a removed store (normally RESET_ALL retains both stores).
  for (const { location_id: oldId } of selectCatalogLocations.all(ownerId)) {
    if (locationIds.has(oldId)) continue
    deleteCatalogItems.run(ownerId, oldId)
    deleteCatalogCategories.run(ownerId, oldId)
    deleteCatalogMeta.run(ownerId, oldId)
  }

  for (const [locationId, menu, shop] of locations) {
    const checksum = createHash('sha256')
      .update(JSON.stringify([menu, shop?.categories || null]))
      .digest('hex')
    if (selectCatalogChecksum.get(ownerId, locationId)?.checksum === checksum) continue

    // Rebuild one small location catalog atomically. The checksum avoids doing
    // this for unrelated floor/ticket actions.
    deleteCatalogItems.run(ownerId, locationId)
    deleteCatalogCategories.run(ownerId, locationId)

    // Category rows come from the configured tree (kind = menu) so
    // sub-categories survive the projection; any menu item that names a
    // category the tree does not know about still gets a row.
    const shopCategories = Array.isArray(shop?.categories) ? shop.categories : []
    const treeRows = shopCategories.filter((category) => (category?.kind || 'menu') === 'menu')
    const nameToId = new Map()
    for (const category of treeRows) {
      const name = cleanText(category?.name, 40)
      if (!name) continue
      const id = cleanText(category?.id, 100) || categoryId(name)
      nameToId.set(name.toLocaleLowerCase('en-US'), id)
    }
    const extra = new Map()
    for (const [index, item] of menu.entries()) {
      const name = cleanText(item?.category, 40, 'Other') || 'Other'
      const key = name.toLocaleLowerCase('en-US')
      if (nameToId.has(key)) continue
      if (!extra.has(key)) extra.set(key, { id: categoryId(name), name, sortOrder: treeRows.length + index })
    }
    for (const category of treeRows) {
      const name = cleanText(category?.name, 40)
      if (!name) continue
      const id = nameToId.get(name.toLocaleLowerCase('en-US'))
      const parentName = category?.parentId
        ? treeRows.find((entry) => entry?.id === category.parentId)?.name
        : null
      const parentRow = parentName ? nameToId.get(parentName.toLocaleLowerCase('en-US')) : null
      insertCategory.run(
        ownerId,
        locationId,
        id,
        name,
        Number.isFinite(Number(category?.sortOrder)) ? Math.max(0, Math.trunc(Number(category.sortOrder))) : 0,
        parentRow || null,
        cleanText(category?.description, 200),
        cleanText(category?.station, 24, 'pantry') || 'pantry',
        category?.active === false ? 0 : 1,
      )
    }
    for (const category of extra.values()) {
      insertCategory.run(ownerId, locationId, category.id, category.name, category.sortOrder, null, '', 'pantry', 1)
    }
    const resolveCategoryId = (name) => nameToId.get(String(name || 'Other').toLocaleLowerCase('en-US'))
      || categoryId(cleanText(name, 40, 'Other') || 'Other')

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
      const substituteId = cleanText(raw?.substituteId, 100)

      insertMenuItem.run(
        ownerId,
        locationId,
        id,
        resolveCategoryId(category),
        name,
        cleanText(raw?.description, 240),
        priceCents,
        cleanText(raw?.station, 24, 'pantry') || 'pantry',
        raw?.available === false ? 0 : 1,
        raw?.active === false ? 0 : 1,
        cleanText(raw?.imageUrl, 500),
        cleanText(raw?.subCategory, 40),
        cleanText(raw?.sku, 40),
        sortOrder,
        now,
      )
      substitutes.push([substituteId, id])

      for (const [kind, values] of [['dietary', cleanList(raw?.dietaryTags)], ['allergen', cleanList(raw?.allergens)]]) {
        values.forEach((value, labelOrder) => insertLabel.run(ownerId, locationId, id, kind, value, labelOrder))
      }

      const seenModifierIds = new Set()
      for (const [groupIndex, modifier] of (Array.isArray(raw?.modifiers) ? raw.modifiers : []).entries()) {
        const baseId = cleanText(modifier?.id, 80, `modifier_${groupIndex}`) || `modifier_${groupIndex}`
        let modifierId = baseId
        let suffix = 1
        while (seenModifierIds.has(modifierId)) modifierId = `${baseId}_${suffix++}`
        seenModifierIds.add(modifierId)
        insertModifierGroup.run(
          ownerId,
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
          if (value) insertModifierOption.run(ownerId, locationId, id, modifierId, value, optionIndex)
        })
      }
    }

    // Insert substitute references after all item rows exist. Keep unknown ids
    // unset so stale references cannot break the menu read model.
    for (const [substituteId, id] of substitutes) {
      if (substituteId && itemIds.has(substituteId)) updateSubstitute.run(substituteId, ownerId, locationId, id)
    }
    setCatalogChecksum.run(ownerId, locationId, checksum)
  }
}

// ─── Configuration projections ─────────────────────────────────
// Suppliers, stock items, location settings, and issued documents each
// carry their own checksum, so an unrelated floor action never rewrites
// them — and a change to any one of them is committed in the same
// SQLite transaction as the snapshot and the action log.

function shopsById(empire) {
  if (empire?.locations && typeof empire.locations === 'object') {
    return Object.entries(empire.locations).filter(([, shop]) => shop && typeof shop === 'object')
  }
  if (Array.isArray(empire?.tables)) return [['downtown', empire]]
  return []
}

function projectionChecksum(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
}

function syncConfigTx(ownerId, empire) {
  const shops = shopsById(empire)
  const locationIds = new Set(shops.map(([locationId]) => locationId))
  for (const area of ['suppliers', 'inventory', 'settings', 'documents']) {
    for (const { location_id: oldId } of selectProjectionLocations.all(ownerId, area)) {
      if (locationIds.has(oldId)) continue
      if (area === 'suppliers') deleteSuppliers.run(ownerId, oldId)
      if (area === 'inventory') deleteInventoryItems.run(ownerId, oldId)
      if (area === 'settings') deleteSettings.run(ownerId, oldId)
      if (area === 'documents') deleteDocuments.run(ownerId, oldId)
      db.prepare('DELETE FROM projection_meta WHERE owner_id = ? AND area = ? AND location_id = ?').run(ownerId, area, oldId)
    }
  }

  const now = new Date().toISOString()
  for (const [locationId, shop] of shops) {
    const suppliers = shop.suppliers || []
    const inventory = shop.inventory || []
    const documents = shop.documents || []

    const supplierChecksum = projectionChecksum(suppliers)
    if (selectProjectionChecksum.get(ownerId, 'suppliers', locationId)?.checksum !== supplierChecksum) {
      // Rebuild inside the transaction: suppliers exist first (FK safety is
      // enforced by ordering, not by SQLite constraints, so old rows drop first).
      deleteSuppliers.run(ownerId, locationId)
      for (const supplier of suppliers) {
        const id = cleanText(supplier?.id, 60)
        const name = cleanText(supplier?.name, 80)
        if (!id || !name) continue
        insertSupplier.run(
          ownerId,
          locationId,
          id,
          name,
          cleanText(supplier?.contactName, 60),
          cleanText(supplier?.contactRole, 40),
          cleanText(supplier?.email, 80),
          cleanText(supplier?.phone, 32),
          cleanText(supplier?.website, 80),
          cleanText(supplier?.addressLine1, 80),
          cleanText(supplier?.addressLine2, 80),
          cleanText(supplier?.city, 48),
          cleanText(supplier?.state, 48),
          cleanText(supplier?.postalCode, 16),
          cleanText(supplier?.country, 48),
          cleanText(supplier?.taxId, 40),
          cleanText(supplier?.paymentTerms, 16, 'net_30') || 'net_30',
          Math.max(0, Math.trunc(Number(supplier?.leadTimeDays) || 0)),
          Math.max(0, Number(supplier?.minOrderValue) || 0),
          cleanText(supplier?.currency, 6),
          JSON.stringify(Array.isArray(supplier?.deliveryDays) ? supplier.deliveryDays.slice(0, 7) : []),
          JSON.stringify(Array.isArray(supplier?.categories) ? supplier.categories.slice(0, 8) : []),
          ['active', 'paused', 'archived'].includes(supplier?.status) ? supplier.status : 'active',
          Math.max(0, Math.min(5, Math.trunc(Number(supplier?.rating) || 0))),
          cleanText(supplier?.accountNumber, 40),
          cleanText(supplier?.notes, 400),
          cleanText(supplier?.updatedAt, 40) || now,
        )
      }
      setProjectionChecksum.run(ownerId, 'suppliers', locationId, supplierChecksum, now)
    }

    const inventoryChecksum = projectionChecksum(inventory)
    if (selectProjectionChecksum.get(ownerId, 'inventory', locationId)?.checksum !== inventoryChecksum) {
      deleteInventoryItems.run(ownerId, locationId)
      const supplierIds = new Set(suppliers.map((supplier) => supplier?.id))
      for (const item of inventory) {
        const id = cleanText(item?.id, 100)
        const name = cleanText(item?.name, 60)
        if (!id || !name) continue
        const supplierId = supplierIds.has(item?.supplierId) ? item.supplierId : null
        insertInventoryItem.run(
          ownerId,
          locationId,
          id,
          name,
          cleanText(item?.sku, 40),
          cleanText(item?.unit, 16, 'each') || 'each',
          Number(item?.onHand) || 0,
          Number(item?.par) || 0,
          Number(item?.reorderPoint) || 0,
          Number(item?.dailyUse) || 0,
          Number(item?.lastCost) || 0,
          Number(item?.avgCost) || 0,
          cleanText(item?.vendor, 60),
          supplierId,
          cleanText(item?.category, 40),
          cleanText(item?.subCategory, 40),
          cleanText(item?.location, 24, 'dry') || 'dry',
          item?.active === false ? 0 : 1,
          now,
        )
      }
      setProjectionChecksum.run(ownerId, 'inventory', locationId, inventoryChecksum, now)
    }

    const settings = shop.settings || null
    const settingsChecksum = projectionChecksum(settings)
    if (selectProjectionChecksum.get(ownerId, 'settings', locationId)?.checksum !== settingsChecksum) {
      deleteSettings.run(ownerId, locationId)
      if (settings) insertSettings.run(ownerId, locationId, JSON.stringify(settings), settings.updatedAt || now)
      setProjectionChecksum.run(ownerId, 'settings', locationId, settingsChecksum, now)
    }

    const documentsChecksum = projectionChecksum(documents)
    if (selectProjectionChecksum.get(ownerId, 'documents', locationId)?.checksum !== documentsChecksum) {
      deleteDocuments.run(ownerId, locationId)
      for (const document of documents.slice(-300)) {
        const id = cleanText(document?.id, 60)
        const kind = ['invoice', 'receipt', 'ticket', 'report'].includes(document?.kind) ? document.kind : null
        if (!id || !kind) continue
        insertDocument.run(
          ownerId,
          locationId,
          id,
          kind,
          cleanText(document?.number, 40),
          cleanText(document?.reference, 80),
          cleanText(document?.currency?.code, 6, 'USD') || 'USD',
          Number(document?.totals?.grandTotal ?? document?.totals?.total ?? document?.totals?.sales) || 0,
          JSON.stringify(document),
          cleanText(document?.issuedAt, 40) || now,
          document?.meta?.voided ? 1 : 0,
        )
      }
      setProjectionChecksum.run(ownerId, 'documents', locationId, documentsChecksum, now)
    }
  }
}

const saveSnapshotTx = db.transaction((ownerId, stateJson, seq, state) => {
  setKv.run(ownerId, 'snapshot', stateJson)
  setKv.run(ownerId, 'snapshot_seq', String(seq))
  syncMenuCatalogTx(ownerId, state)
  syncConfigTx(ownerId, state)
})

const syncMenuCatalogStandalone = db.transaction((ownerId, state) => {
  syncMenuCatalogTx(ownerId, state)
  syncConfigTx(ownerId, state)
})

const commitActionTx = db.transaction((ownerId, clientId, actionType, actionJson, timestamp, stateJson, state) => {
  const info = insertAction.run(ownerId, clientId, actionType, actionJson, timestamp)
  const seq = Number(info.lastInsertRowid)
  if (seq > RETAIN_ACTIONS) pruneActions.run(ownerId, seq - RETAIN_ACTIONS)
  setKv.run(ownerId, 'snapshot', stateJson)
  setKv.run(ownerId, 'snapshot_seq', String(seq))
  syncMenuCatalogTx(ownerId, state)
  syncConfigTx(ownerId, state)
  return seq
})

export function loadSnapshot(ownerId) {
  const owner = ownerId || DEFAULT_OWNER
  const snap = getKv.get(owner, 'snapshot')
  const seq = getKv.get(owner, 'snapshot_seq')
  if (!snap) return null
  try {
    return { state: JSON.parse(snap.v), seq: Number(seq?.v || 0) }
  } catch {
    return null
  }
}

export function saveSnapshot(ownerId, state, seq) {
  saveSnapshotTx(ownerId, JSON.stringify(state), seq, state)
}

export async function getState(ownerId = DEFAULT_OWNER) {
  const snap = loadSnapshot(ownerId)
  if (snap?.state) {
    const locId = 'downtown'
    return snap.state.locations?.[locId] || snap.state
  }
  return null
}

export async function saveState(ownerId = DEFAULT_OWNER, state) {
  const persisted = loadSnapshot(ownerId)
  let fullState = persisted?.state || {}
  if (fullState.locations) {
    fullState = { ...fullState, locations: { ...fullState.locations, downtown: state } }
  } else {
    fullState = state
  }
  saveSnapshot(ownerId, fullState, persisted?.seq || 0)
}

db.getState = getState
db.saveState = saveState


export function syncMenuCatalog(ownerId, state) {
  syncMenuCatalogStandalone(ownerId, state)
}

export function commitAction(ownerId, clientId, action, state) {
  const stateJson = JSON.stringify(state)
  return commitActionTx(
    ownerId,
    typeof clientId === 'string' ? clientId : 'anon',
    action.type,
    JSON.stringify(action),
    new Date().toISOString(),
    stateJson,
    state,
  )
}

export function actionsSince(ownerId, seq, limit = 500) {
  return selectSince.all(ownerId, seq, limit).map((row) => ({ ...row, action: JSON.parse(row.action) }))
}

export function logStats(ownerId) {
  return countActions.get(ownerId)
}

const selectCategories = db.prepare(`
  SELECT id, name, parent_id AS parentId, description, station, sort_order AS sortOrder, active
  FROM menu_categories
  WHERE owner_id = ? AND location_id = ?
  ORDER BY parent_id IS NOT NULL ASC, sort_order ASC, name COLLATE NOCASE ASC
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
    item.sub_category AS subCategory,
    item.sku,
    item.sort_order AS sortOrder
  FROM menu_items AS item
  JOIN menu_categories AS category
    ON category.owner_id = item.owner_id AND category.location_id = item.location_id AND category.id = item.category_id
  WHERE item.owner_id = @ownerId AND item.location_id = @locationId
    AND (@query = '' OR instr(lower(item.name), lower(@query)) > 0 OR instr(lower(item.description), lower(@query)) > 0)
    AND (@category = '' OR category.name = @category COLLATE NOCASE)
    AND (@availableOnly = 0 OR (item.available = 1 AND item.active = 1))
  ORDER BY category.sort_order ASC, item.sort_order ASC, item.name COLLATE NOCASE ASC
`)
const selectLabels = db.prepare(`
  SELECT menu_item_id AS menuItemId, kind, value, sort_order AS sortOrder
  FROM menu_item_labels
  WHERE owner_id = ? AND location_id = ?
  ORDER BY sort_order ASC, value COLLATE NOCASE ASC
`)
const selectModifierGroups = db.prepare(`
  SELECT menu_item_id AS menuItemId, id, label, required, sort_order AS sortOrder
  FROM menu_modifier_groups
  WHERE owner_id = ? AND location_id = ?
  ORDER BY menu_item_id, sort_order ASC
`)
const selectModifierOptions = db.prepare(`
  SELECT menu_item_id AS menuItemId, modifier_id AS modifierId, option, sort_order AS sortOrder
  FROM menu_modifier_options
  WHERE owner_id = ? AND location_id = ?
  ORDER BY menu_item_id, modifier_id, sort_order ASC
`)

export function getMenuCatalog(ownerId, locationId, filters = {}) {
  const query = cleanText(filters.query, 80)
  const category = cleanText(filters.category, 40)
  const availableOnly = filters.availableOnly ? 1 : 0
  const rows = selectMenuItems.all({ ownerId, locationId, query, category, availableOnly })
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
    subCategory: row.subCategory,
    sku: row.sku,
    sortOrder: row.sortOrder,
    dietaryTags: [],
    allergens: [],
    modifiers: [],
  }]))

  for (const label of selectLabels.all(ownerId, locationId)) {
    const item = itemById.get(label.menuItemId)
    if (!item) continue
    if (label.kind === 'dietary') item.dietaryTags.push(label.value)
    else item.allergens.push(label.value)
  }
  for (const group of selectModifierGroups.all(ownerId, locationId)) {
    const item = itemById.get(group.menuItemId)
    if (!item) continue
    item.modifiers.push({ id: group.id, label: group.label, required: Boolean(group.required), options: [] })
  }
  const groupById = new Map()
  for (const item of itemById.values()) for (const group of item.modifiers) groupById.set(`${item.id}::${group.id}`, group)
  for (const option of selectModifierOptions.all(ownerId, locationId)) {
    groupById.get(`${option.menuItemId}::${option.modifierId}`)?.options.push(option.option)
  }

  return {
    locationId,
    categories: selectCategories.all(ownerId, locationId),
    items: [...itemById.values()],
  }
}

const selectSuppliers = db.prepare(`
  SELECT id, name, contact_name AS contactName, contact_role AS contactRole, email, phone,
         website, address_line1 AS addressLine1, address_line2 AS addressLine2, city, state,
         postal_code AS postalCode, country, tax_id AS taxId, payment_terms AS paymentTerms,
         lead_time_days AS leadTimeDays, min_order_value AS minOrderValue, currency,
         delivery_days AS deliveryDays, categories, status, rating, account_number AS accountNumber,
         notes, updated_at AS updatedAt
  FROM suppliers
  WHERE owner_id = ? AND location_id = ?
  ORDER BY name COLLATE NOCASE ASC
`)

const selectInventoryItems = db.prepare(`
  SELECT item.id, item.name, item.sku, item.unit, item.on_hand AS onHand, item.par,
         item.reorder_point AS reorderPoint, item.daily_use AS dailyUse,
         item.last_cost AS lastCost, item.avg_cost AS avgCost, item.vendor,
         item.supplier_id AS supplierId, item.category, item.sub_category AS subCategory,
         item.storage AS location, item.active
  FROM inventory_items AS item
  WHERE item.owner_id = @ownerId AND item.location_id = @locationId
    AND (@supplierId = '' OR item.supplier_id = @supplierId)
    AND (@query = '' OR instr(lower(item.name), lower(@query)) > 0 OR instr(lower(item.sku), lower(@query)) > 0)
    AND (@exceptionsOnly = 0 OR item.on_hand < item.reorder_point OR item.on_hand <= 0)
  ORDER BY item.category COLLATE NOCASE ASC, item.name COLLATE NOCASE ASC
`)

const selectLocationSettings = db.prepare('SELECT settings, updated_at AS updatedAt FROM location_settings WHERE owner_id = ? AND location_id = ?')

const selectCategoryTree = db.prepare(`
  SELECT id, name, parent_id AS parentId, description, station, sort_order AS sortOrder, active
  FROM menu_categories
  WHERE owner_id = ? AND location_id = ?
  ORDER BY parent_id IS NOT NULL, sort_order ASC, name COLLATE NOCASE ASC
`)

const selectDocuments = db.prepare(`
  SELECT id, kind, number, reference, currency, total, payload, issued_at AS issuedAt, voided
  FROM issued_documents
  WHERE owner_id = @ownerId AND location_id = @locationId
    AND (@kind = '' OR kind = @kind)
  ORDER BY issued_at DESC, rowid DESC
  LIMIT @limit
`)

const selectDocumentTotals = db.prepare(`
  SELECT kind, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
  FROM issued_documents
  WHERE owner_id = ? AND location_id = ? AND voided = 0
  GROUP BY kind
`)

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function getSuppliers(ownerId, locationId) {
  return selectSuppliers.all(ownerId, locationId).map((row) => ({
    ...row,
    deliveryDays: parseJsonList(row.deliveryDays),
    categories: parseJsonList(row.categories),
    minOrderValue: Number(row.minOrderValue),
    leadTimeDays: Number(row.leadTimeDays),
    rating: Number(row.rating),
  }))
}

export function getInventory(ownerId, locationId, filters = {}) {
  return selectInventoryItems.all({
    ownerId,
    locationId,
    supplierId: cleanText(filters.supplierId, 60),
    query: cleanText(filters.query, 80),
    exceptionsOnly: filters.exceptionsOnly ? 1 : 0,
  }).map((row) => ({ ...row, onHand: Number(row.onHand), par: Number(row.par), reorderPoint: Number(row.reorderPoint) }))
}

export function getCategories(ownerId, locationId) {
  const rows = selectCategoryTree.all(ownerId, locationId)
  const roots = rows.filter((row) => !row.parentId)
  const children = rows.filter((row) => row.parentId)
  return roots.map((root) => ({
    ...root,
    children: children.filter((child) => child.parentId === root.id),
  }))
}

export function getSettings(ownerId, locationId) {
  const row = selectLocationSettings.get(ownerId, locationId)
  if (!row) return null
  try {
    return { ...JSON.parse(row.settings), updatedAt: row.updatedAt }
  } catch {
    return null
  }
}

export function getDocuments(ownerId, locationId, filters = {}) {
  const limit = Math.max(1, Math.min(200, Number(filters.limit) || 50))
  return selectDocuments.all({
    ownerId,
    locationId,
    kind: cleanText(filters.kind, 16),
    limit,
  }).map((row) => ({
    id: row.id,
    kind: row.kind,
    number: row.number,
    reference: row.reference,
    currency: row.currency,
    total: Number(row.total),
    issuedAt: row.issuedAt,
    voided: Boolean(row.voided),
    document: JSON.parse(row.payload),
  }))
}

export function getDocumentTotals(ownerId, locationId) {
  const out = { invoice: { count: 0, total: 0 }, receipt: { count: 0, total: 0 }, ticket: { count: 0, total: 0 }, report: { count: 0, total: 0 } }
  for (const row of selectDocumentTotals.all(ownerId, locationId)) {
    out[row.kind] = { count: Number(row.count), total: Number(row.total) }
  }
  return out
}

// Useful for graceful shutdown and isolated SQLite tests.
export function closeDatabase() {
  if (db.open) db.close()
}
