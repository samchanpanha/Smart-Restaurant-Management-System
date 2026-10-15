// ─── Growth guards ──────────────────────────────────────────────────
// The empire (orders, alerts) and the server action log are append-only in
// normal operation. Without caps a busy room grows them forever and every
// snapshot/SSE payload gets slower to serialize. These tests pin the caps.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildEmpire, buildSeed, migrateToEmpire, reducer } from '../src/lib/reducer.js'

test('orders: closed tickets are capped, open tickets survive', () => {
  const seed = buildSeed()
  const closed = Array.from({ length: 401 }, (_, i) => ({
    id: `old${i}`, tableId: null, type: 'takeout', status: 'paid', items: [],
  }))
  const shop = { ...seed, orders: closed }

  const next = reducer(shop, { type: 'CREATE_ORDER', orderType: 'takeout', id: 'fresh' })

  assert.equal(next.orders.filter((o) => o.status === 'paid').length, 400)
  assert.ok(next.orders.some((o) => o.id === 'fresh'), 'new open order is kept')
  assert.ok(!next.orders.some((o) => o.id === 'old0'), 'oldest closed ticket is dropped')
  assert.equal(next.orders.length, 401)
})

test('orders: open tickets are never dropped', () => {
  const seed = buildSeed()
  const open = Array.from({ length: 450 }, (_, i) => ({
    id: `open${i}`, tableId: null, type: 'takeout', status: 'open', items: [],
  }))
  const shop = { ...seed, orders: open }

  const next = reducer(shop, { type: 'CREATE_ORDER', orderType: 'takeout', id: 'one-more' })

  assert.equal(next.orders.length, 451)
})

test('dismissed alerts: newest 200 kept', () => {
  let shop = buildSeed()
  for (let i = 0; i < 210; i += 1) {
    shop = reducer(shop, { type: 'DISMISS_ALERT', key: `k${i}` })
  }
  assert.equal(shop.dismissedAlerts.length, 200)
  assert.equal(shop.dismissedAlerts[0], 'k10')
  assert.equal(shop.dismissedAlerts.at(-1), 'k209')
})

test('migration trims oversized snapshots on boot', () => {
  const empire = buildEmpire()
  empire.locations.downtown.orders = Array.from({ length: 500 }, (_, i) => ({
    id: `o${i}`, tableId: null, type: 'takeout', status: 'paid', items: [],
  }))
  empire.locations.downtown.dismissedAlerts = Array.from({ length: 300 }, (_, i) => `a${i}`)

  const migrated = migrateToEmpire(empire)
  assert.equal(migrated.locations.downtown.orders.length, 400)
  assert.equal(migrated.locations.downtown.dismissedAlerts.length, 200)
})

test('server action log retains only the newest 5000 per tenant', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-retention-'))
  process.env.RESTORA_DATA = dataDir
  const { commitAction, logStats, DEFAULT_OWNER } = await import('../server/db.js')

  const state = { version: 4, locations: {} }
  for (let i = 0; i < 5050; i += 1) {
    commitAction(DEFAULT_OWNER, 'test', { type: 'NOOP', i }, state)
  }

  assert.equal(logStats(DEFAULT_OWNER).n, 5000)
})
