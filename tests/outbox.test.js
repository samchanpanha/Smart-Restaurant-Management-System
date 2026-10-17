// ─── Offline outbox (localStorage queue) ────────────────────────────
// The queue must survive a reload: entries persist untouched; dequeue
// is keyed on `_lid`; the conflicts log captures financial rejections;
// `hasSeenServer` separates a real terminal booting during an outage
// from the pure localStorage demo.

import assert from 'node:assert/strict'
import test, { before } from 'node:test'

// The outbox hydrates its mirror from storage on first use, so the stub
// must exist before the first queue call. A Map never persists across
// test files — exactly the isolation this needs.
const backing = new Map()
before(() => {
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, String(value)) },
    removeItem: (key) => { backing.delete(key) },
    clear: () => backing.clear(),
  }
  for (const key of [...backing.keys()]) backing.delete(key)
})

const {
  enqueue, dequeue, readOutbox, outboxSize, offlineCreatedOrderIds, clearOutbox,
  readConflicts, appendConflict, clearConflicts,
  markServerSeen, hasSeenServer,
} = await import('../src/lib/outbox.js')

const sale = (id, locId = 'downtown') => ({
  _lid: `l-${id}`,
  locId,
  action: { type: 'CREATE_ORDER', id, _lid: `l-${id}` },
  financial: true,
})

test('entries persist in order and survive a re-warm', () => {
  clearOutbox()
  enqueue(sale('o-1'))
  enqueue({ _lid: 'l-2', locId: 'riverside', action: { type: 'PAY_ORDER', _lid: 'l-2' }, financial: true })
  assert.equal(outboxSize(), 2)
  assert.deepEqual(readOutbox().map((e) => e.action.type), ['CREATE_ORDER', 'PAY_ORDER'])
  assert.equal(backing.get('restora-outbox-v1').includes('"_lid":"l-o-1"'), true)
})

test('dequeue removes exactly the committed lid', () => {
  dequeue(readOutbox()[0]._lid)
  assert.equal(outboxSize(), 1)
  assert.equal(readOutbox()[0].locId, 'riverside')
  // A repeat no-op leaves the rest intact.
  dequeue('never-queued')
  assert.equal(outboxSize(), 1)
})

test('offline-created order ids come from the queue only', () => {
  clearOutbox()
  enqueue(sale('o-a'))
  enqueue(sale('o-b', 'riverside'))
  assert.deepEqual([...offlineCreatedOrderIds('downtown')], ['o-a'])
  assert.deepEqual(readOutbox().length, 2)
  const everywhere = offlineCreatedOrderIds()
  assert.equal(everywhere.has('o-a') && everywhere.has('o-b'), true)
  clearOutbox()
  assert.equal(offlineCreatedOrderIds().size, 0)
})

test('conflicts: appended, capped, dismissable', () => {
  clearConflicts()
  for (let i = 0; i < 60; i += 1) appendConflict({ lid: `c-${i}`, type: 'PAY_ORDER', financial: true, error: 'x', at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}` })
  const list = readConflicts()
  assert.equal(list.length, 50, 'cap at 50')
  assert.equal(list.at(-1).lid, 'c-59', 'newest survives')
  clearConflicts()
  assert.equal(readConflicts().length, 0)
})

test('server-seen flag flips and wipes with storage', () => {
  backing.delete('restora-server-seen')
  assert.equal(hasSeenServer(), false)
  markServerSeen()
  assert.equal(hasSeenServer(), true)
})

test('malformed storage degrades to an empty queue, not a crash', async () => {
  backing.set('restora-outbox-v1', '{ not json')
  // Fresh mirror state is only re-tested through a new module instance.
  const fresh = await import('../src/lib/outbox.js?fresh=1')
  assert.equal(fresh.outboxSize(), 0)
  assert.deepEqual(fresh.readOutbox(), [])
})
