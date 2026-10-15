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
        tables: legacy.locations.downtown.tables.map(({ posX, posY, ...rest }) => rest),
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
