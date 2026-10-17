// ─── Floor layout ───────────────────────────────────────────────────
// Tables carry a normalized (0–100) floor position so the Floor screen can
// draw a real plan and persist drags. These tests pin the seed layout, the
// SET_TABLE_LAYOUT action, clamping, and the v4 → v5 migration.

import assert from 'node:assert/strict'
import test from 'node:test'

import { STATE_VERSION, buildEmpire, buildSeed, migrateToEmpire, reducer } from '../src/lib/reducer.js'

const shopOf = (empire) => empire.locations.downtown
const local = (empire, action) => reducer(empire, { type: 'LOC', locId: 'downtown', action })

test('seed tables all carry an in-range floor position', () => {
  const tables = buildSeed().tables
  assert.ok(tables.length > 0)
  for (const table of tables) {
    assert.ok(Number.isFinite(table.posX), `${table.id} has posX`)
    assert.ok(Number.isFinite(table.posY), `${table.id} has posY`)
    assert.ok(table.posX >= 0 && table.posX <= 100, `${table.id} x in range`)
    assert.ok(table.posY >= 0 && table.posY <= 100, `${table.id} y in range`)
  }
})

test('SET_TABLE_LAYOUT moves one table and clamps out-of-range values', () => {
  const empire = buildEmpire()
  const moved = local(empire, { type: 'SET_TABLE_LAYOUT', tableId: 't01', posX: 120, posY: -5 })
  const table = shopOf(moved).tables.find((t) => t.id === 't01')
  assert.equal(table.posX, 100)
  assert.equal(table.posY, 0)
  // Other tables are untouched.
  const other = shopOf(empire).tables.find((t) => t.id === 't02')
  const otherAfter = shopOf(moved).tables.find((t) => t.id === 't02')
  assert.deepEqual({ x: otherAfter.posX, y: otherAfter.posY }, { x: other.posX, y: other.posY })
})

test('SET_TABLE_LAYOUT accepts a batch of moves', () => {
  const empire = buildEmpire()
  const moved = local(empire, {
    type: 'SET_TABLE_LAYOUT',
    moves: [{ tableId: 't01', posX: 30, posY: 30 }, { tableId: 't16', posX: 70, posY: 70 }],
  })
  const tables = shopOf(moved).tables
  assert.equal(tables.find((t) => t.id === 't01').posX, 30)
  assert.equal(tables.find((t) => t.id === 't16').posY, 70)
})

test('a no-op move returns the same state object', () => {
  const empire = buildEmpire()
  const table = shopOf(empire).tables.find((t) => t.id === 't01')
  const same = local(empire, { type: 'SET_TABLE_LAYOUT', tableId: 't01', posX: table.posX, posY: table.posY })
  assert.equal(shopOf(same), shopOf(empire))
})

test('v4 snapshots gain a layout on migration', () => {
  const legacy = buildEmpire()
  const stripped = {
    ...legacy,
    version: 4,
    locations: {
      downtown: {
        ...legacy.locations.downtown,
        tables: legacy.locations.downtown.tables.map(({ posX: _posX, posY: _posY, ...rest }) => rest),
      },
    },
  }
  const migrated = migrateToEmpire(stripped)
  assert.equal(migrated.version, STATE_VERSION)
  for (const table of shopOf(migrated).tables) {
    assert.ok(Number.isFinite(table.posX), `${table.id} gained posX`)
    assert.ok(Number.isFinite(table.posY), `${table.id} gained posY`)
  }
})

test('migration preserves positions already in a snapshot', () => {
  const empire = buildEmpire()
  const moved = local(empire, { type: 'SET_TABLE_LAYOUT', tableId: 't01', posX: 42, posY: 42 })
  const again = migrateToEmpire(moved)
  const table = shopOf(again).tables.find((t) => t.id === 't01')
  assert.equal(table.posX, 42)
  assert.equal(table.posY, 42)
})

// ─── Tile size ─────────────────────────────────────────────────────

test('SET_TABLE_LAYOUT persists a tile scale and clamps it', () => {
  const empire = buildEmpire()
  const huge = local(empire, { type: 'SET_TABLE_LAYOUT', tableId: 't01', posX: 20, posY: 20, scale: 9 })
  assert.equal(shopOf(huge).tables.find((t) => t.id === 't01').tileScale, 3)
  const tiny = local(empire, { type: 'SET_TABLE_LAYOUT', tableId: 't01', posX: 20, posY: 20, scale: 0.1 })
  assert.equal(shopOf(tiny).tables.find((t) => t.id === 't01').tileScale, 0.75)
  const fine = local(empire, { type: 'SET_TABLE_LAYOUT', tableId: 't01', posX: 20, posY: 20, scale: 1.5 })
  assert.equal(shopOf(fine).tables.find((t) => t.id === 't01').tileScale, 1.5)
})

test('UPDATE_TABLE sanitizes tileScale; leaving it keeps the value', () => {
  const empire = buildEmpire()
  const updated = local(empire, { type: 'UPDATE_TABLE', tableId: 't01', patch: { tileScale: 2.5 } })
  const table = shopOf(updated).tables.find((t) => t.id === 't01')
  assert.equal(table.tileScale, 2.5)
  const renamed = local(updated, { type: 'UPDATE_TABLE', tableId: 't01', patch: { name: 'Hightop' } })
  const renamedTable = shopOf(renamed).tables.find((t) => t.id === 't01')
  assert.equal(renamedTable.name, 'Hightop')
  assert.equal(renamedTable.tileScale, 2.5)
})

// ─── Room size ─────────────────────────────────────────────────────

test('fresh empires ship the auto-fit room and seeded zone records', () => {
  const empire = buildEmpire()
  const shop = shopOf(empire)
  assert.deepEqual(shop.floor, { roomW: 0, roomH: 0 })
  const names = [...new Set(shop.tables.map((t) => t.zone))]
  assert.equal(shop.floorZones.length, names.length)
  for (const zone of shop.floorZones) {
    assert.ok(zone.id && zone.name)
    assert.ok(zone.x >= 0 && zone.x <= 100, `${zone.name} x in range`)
    assert.ok(zone.w >= 6 && zone.w <= 100, `${zone.name} width in range`)
    assert.equal(zone.h, 100, `${zone.name} seeds as a full-height band`)
  }
})

test('SET_FLOOR_ROOM clamps, keeps omitted axes, and resets to auto', () => {
  const empire = buildEmpire()
  const big = local(empire, { type: 'SET_FLOOR_ROOM', roomW: 5000, roomH: -3 })
  assert.deepEqual(shopOf(big).floor, { roomW: 3000, roomH: 0 })
  const grown = local(big, { type: 'SET_FLOOR_ROOM', roomW: 1350, roomH: 900 })
  assert.deepEqual(shopOf(grown).floor, { roomW: 1350, roomH: 900 })
  const kept = local(grown, { type: 'SET_FLOOR_ROOM', roomH: 1400 })
  assert.deepEqual(shopOf(kept).floor, { roomW: 1350, roomH: 1400 })
  const reset = local(kept, { type: 'SET_FLOOR_ROOM', roomW: 0, roomH: 0 })
  assert.deepEqual(shopOf(reset).floor, { roomW: 0, roomH: 0 })
})

// ─── Zone records ──────────────────────────────────────────────────

test('CREATE_FLOOR_ZONE de-dupes names and stacks the default slot', () => {
  const empire = buildEmpire()
  const first = local(empire, { type: 'CREATE_FLOOR_ZONE', name: 'Poolside' })
  const zones = shopOf(first).floorZones
  const made = zones[zones.length - 1]
  assert.equal(made.name, 'Poolside')
  assert.equal(made.x, 0)
  assert.equal(made.w, 100)
  assert.ok(made.y === 0 || made.y > 0, 'default slot exists')
  const second = local(first, { type: 'CREATE_FLOOR_ZONE', name: 'Poolside' })
  const again = shopOf(second).floorZones
  assert.notEqual(again.at(-1).name, again.at(-2).name, 'duplicate name gets suffixed')
})

test('UPDATE_FLOOR_ZONE renames with its tables and clamps rects', () => {
  const base = local(buildEmpire(), { type: 'CREATE_FLOOR_ZONE', name: 'Poolside' })
  const made = shopOf(base).floorZones.at(-1)
  let state = local(base, { type: 'UPDATE_TABLE', tableId: 't01', patch: { zone: 'Poolside' } })
  state = local(state, { type: 'UPDATE_FLOOR_ZONE', zoneId: made.id, patch: { name: 'Garden' } })
  const shop = shopOf(state)
  assert.equal(shop.floorZones.at(-1).name, 'Garden')
  assert.equal(shop.tables.find((t) => t.id === 't01').zone, 'Garden')
  const clamped = local(state, { type: 'UPDATE_FLOOR_ZONE', zoneId: made.id, patch: { rect: { x: 95, w: 50 } } })
  const rectZone = shopOf(clamped).floorZones.at(-1)
  assert.equal(rectZone.x, 95)
  assert.equal(rectZone.w, Math.min(100 - 95, 50) || 10, 'width never runs past the canvas')
  assert.equal(shopOf(clamped).tables.find((t) => t.id === 't01').zone, 'Garden', 'a rename-only no-op rect keeps tables')
})

test('DELETE_FLOOR_ZONE falls its tables back to Main and removes the record', () => {
  const base = local(buildEmpire(), { type: 'CREATE_FLOOR_ZONE', name: 'Poolside' })
  const made = shopOf(base).floorZones.at(-1)
  let state = local(base, { type: 'UPDATE_TABLE', tableId: 't01', patch: { zone: 'Poolside' } })
  state = local(state, { type: 'DELETE_FLOOR_ZONE', zoneId: made.id })
  const shop = shopOf(state)
  assert.equal(shop.floorZones.some((z) => z.id === made.id), false)
  assert.equal(shop.tables.find((t) => t.id === 't01').zone, 'Main')
  const nothing = local(state, { type: 'DELETE_FLOOR_ZONE', zoneId: made.id })
  assert.equal(shopOf(nothing), shopOf(state), 'second delete is a no-op')
})

test('a first ADD_TABLE on a zone-less floor seeds one full-canvas zone', () => {
  const empire = buildEmpire()
  const stripped = {
    ...empire,
    locations: { downtown: { ...empire.locations.downtown, floorZones: [] } },
  }
  const seeded = local(stripped, { type: 'ADD_TABLE', table: { name: 'Patio 9', seats: 4, zone: 'Patio' } })
  const zones = shopOf(seeded).floorZones
  assert.equal(zones.length, 1)
  assert.equal(zones[0].name, 'Patio')
  assert.deepEqual({ x: zones[0].x, y: zones[0].y, w: zones[0].w, h: zones[0].h }, { x: 0, y: 0, w: 100, h: 100 })
  assert.equal(shopOf(seeded).tables.at(-1).name, 'Patio 9')
})

test('migrateToEmpire seeds legacy floors with zone records once', () => {
  const legacy = {
    ...buildEmpire(),
    locations: {
      downtown: Object.fromEntries(
        Object.entries(buildEmpire().locations.downtown).filter(([key]) => key !== 'floorZones' && key !== 'floor'),
      ),
    },
  }
  const migrated = migrateToEmpire(legacy)
  const shop = shopOf(migrated)
  assert.deepEqual(shop.floor, { roomW: 0, roomH: 0 })
  const names = new Set(shop.tables.map((t) => t.zone))
  assert.equal(shop.floorZones.length, names.size)
  // Zone geometry is deterministic, so two branches hosting the same
  // names (offline or independently seeded) converge on the same rects.
  const again = migrateToEmpire(legacy)
  assert.deepEqual(shopOf(again).floorZones, shop.floorZones)
})
