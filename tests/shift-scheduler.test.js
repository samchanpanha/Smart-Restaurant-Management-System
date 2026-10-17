import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'

const act = (empire, locId, action) => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]

test('ADD_SHIFT appends a valid shift to state.shifts', () => {
  let empire = buildEmpire()
  const initialCount = (shopOf(empire).shifts || []).length

  const shift = {
    id: 'shf_test_1',
    staffName: 'Jordan Lee',
    role: 'server',
    date: '2026-10-19',
    startTime: '10:00',
    endTime: '17:00',
    note: 'Lunch lead',
  }

  empire = act(empire, 'downtown', { type: 'ADD_SHIFT', shift })
  const updated = shopOf(empire).shifts
  assert.equal(updated.length, initialCount + 1)
  const found = updated.find((s) => s.id === 'shf_test_1')
  assert.ok(found)
  assert.equal(found.staffName, 'Jordan Lee')
  assert.equal(found.role, 'server')
  assert.equal(found.startTime, '10:00')
  assert.equal(found.endTime, '17:00')
})

test('UPDATE_SHIFT patches an existing shift by id', () => {
  let empire = buildEmpire()
  const shift = {
    id: 'shf_test_update',
    staffName: 'Kim Park',
    role: 'kitchen',
    date: '2026-10-20',
    startTime: '09:00',
    endTime: '17:00',
    note: 'Prep',
  }
  empire = act(empire, 'downtown', { type: 'ADD_SHIFT', shift })

  empire = act(empire, 'downtown', {
    type: 'UPDATE_SHIFT',
    shiftId: 'shf_test_update',
    patch: { startTime: '08:30', note: 'Early prep lead' },
  })

  const found = shopOf(empire).shifts.find((s) => s.id === 'shf_test_update')
  assert.ok(found)
  assert.equal(found.startTime, '08:30')
  assert.equal(found.note, 'Early prep lead')
  assert.equal(found.role, 'kitchen') // unchanged
})

test('DELETE_SHIFT removes a shift by id', () => {
  let empire = buildEmpire()
  const shift = {
    id: 'shf_test_delete',
    staffName: 'Alex Smith',
    role: 'server',
    date: '2026-10-21',
  }
  empire = act(empire, 'downtown', { type: 'ADD_SHIFT', shift })
  assert.ok(shopOf(empire).shifts.some((s) => s.id === 'shf_test_delete'))

  empire = act(empire, 'downtown', { type: 'DELETE_SHIFT', shiftId: 'shf_test_delete' })
  assert.ok(!shopOf(empire).shifts.some((s) => s.id === 'shf_test_delete'))
})
