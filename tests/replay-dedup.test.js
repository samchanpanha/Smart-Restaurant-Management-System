// ─── Server-side replay idempotency ────────────────────────────────
// A terminal that flushed an offline queue twice — crash between the
// committed POST and its response, two tabs racing — must get the
// original seq back with no second apply. `findDuplicateAction` is the
// check the actions route runs before touching the reducer.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

// Scratch data dir must be set before the module is imported: db.js
// binds its SQLite file at import time.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-replay-'))
process.env.RESTORA_DATA = dataDir

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const { commitAction, findDuplicateAction, db } = await import('../server/db.js')
const { buildEmpire, migrateToEmpire, reducer } = await import('../src/lib/reducer.js')

const OWNER = 'default'
const CLIENT = 'term-replay'

function nextOf(state, customer) {
  return reducer(
    state,
    { type: 'LOC', locId: 'downtown', action: { type: 'UPSERT_CUSTOMER', customer } },
  )
}

const wrapped = (payload) => ({ type: 'LOC', locId: 'downtown', action: payload })

test('a commit with a client `_lid` dedups on replay', () => {
  let state = migrateToEmpire(buildEmpire())
  const queued = {
    ...wrapped({ type: 'UPSERT_CUSTOMER', customer: { id: 'cus-1', name: 'Ava Chen', phone: '012' }, _lid: 'l-77' }),
    action: { type: 'UPSERT_CUSTOMER', customer: { id: 'cus-1', name: 'Ava Chen', phone: '012' }, _lid: 'l-77' },
  }
  // Same shape the client sends: _lid inside the inner shop action.
  const action = wrapped({ type: 'UPSERT_CUSTOMER', customer: { id: 'cus-1', name: 'Ava Chen', phone: '012' }, _lid: 'l-77' })

  const seq = commitAction(OWNER, CLIENT, action, nextOf(state, { id: 'cus-1', name: 'Ava Chen', phone: '012' }))
  state = reducer(state, action)
  assert.equal(typeof seq, 'number')

  // Before the reducer runs, the route asks: did this _lid land already?
  assert.equal(findDuplicateAction(OWNER, CLIENT, action), seq)
  assert.equal(findDuplicateAction(OWNER, 'other-terminal', action), null, 'id is per client, not global')

  // A second tab replaying the same entry from the same terminal also
  // hits the dedup (same client id, same local id).
  assert.equal(findDuplicateAction(OWNER, CLIENT, JSON.parse(JSON.stringify(action))), seq)

  // Nothing was double-applied: exactly one customer row.
  const snapshot = JSON.parse(db.prepare("SELECT v FROM kv WHERE owner_id = ? AND k = 'snapshot'").get(OWNER).v)
  assert.equal(
    (snapshot.locations?.downtown?.customers || []).filter((c) => c.id === 'cus-1').length,
    1,
  )
})

test('actions without a local id never dedup', () => {
  const action = wrapped({ type: 'DISMISS_ALERT', key: 'k1' })
  assert.equal(findDuplicateAction(OWNER, CLIENT, action), null)
  assert.equal(findDuplicateAction(OWNER, CLIENT, { type: 'RESET_ALL' }), null)
})

test('empire-level actions can carry their `_lid` at the top level', () => {
  const action = { type: 'CREATE_LOCATION', locId: 'harbor', name: 'Harbor', _lid: 'l-99' }
  assert.equal(findDuplicateAction(OWNER, CLIENT, action), null, 'nothing committed yet')
  const seq = commitAction(OWNER, CLIENT, action, buildEmpire())
  assert.equal(findDuplicateAction(OWNER, CLIENT, action), seq)
})
