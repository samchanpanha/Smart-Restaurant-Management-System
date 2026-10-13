import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { buildEmpire, buildSeed, migrateToEmpire, reducer } from '../src/lib/reducer.js'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'restora-menu-test-'))
process.env.RESTORA_DATA = dataDir
const { closeDatabase, getMenuCatalog, saveSnapshot } = await import('../server/db.js')

after(() => {
  closeDatabase()
  rmSync(dataDir, { recursive: true, force: true })
})

test('catalog is normalized in SQLite and independent per location', () => {
  const empire = buildEmpire()
  saveSnapshot(empire, 0)

  const downtown = getMenuCatalog('downtown')
  const riverside = getMenuCatalog('riverside')
  const salmonDowntown = downtown.items.find((item) => item.id === 'm_salmon')
  const salmonRiverside = riverside.items.find((item) => item.id === 'm_salmon')
  const salad = downtown.items.find((item) => item.id === 'm_salad')

  assert.equal(downtown.items.length, 13)
  assert.equal(salmonDowntown.available, false)
  assert.equal(salmonRiverside.available, true)
  assert.equal(downtown.categories[0].name, 'Starters')
  assert.deepEqual(salad.modifiers[0].options, ['Ranch', 'Vinaigrette', 'Blue cheese'])
  assert.deepEqual(salad.dietaryTags, ['Vegetarian'])
  assert.equal(getMenuCatalog('downtown', { availableOnly: true }).items.some((item) => item.id === 'm_salmon'), false)
})

test('menu add and edit actions persist cents, labels, display details, and active state', () => {
  let empire = buildEmpire()
  const newItem = {
    id: 'm_test_special',
    name: 'Roasted Carrots',
    description: 'Sweet roasted carrots with herbs.',
    category: 'Sides',
    price: 7.5,
    station: 'pantry',
    available: true,
    active: true,
    dietaryTags: ['Vegan'],
    allergens: [],
    imageUrl: '/images/carrots.jpg',
    sortOrder: 13,
    substituteId: null,
    modifiers: [],
  }
  empire = reducer(empire, {
    type: 'LOC',
    locId: 'downtown',
    action: { type: 'ADD_MENU_ITEM', item: newItem },
  })
  saveSnapshot(empire, 1)

  let catalogItem = getMenuCatalog('downtown').items.find((item) => item.id === newItem.id)
  assert.equal(catalogItem.price, 7.5)
  assert.equal(catalogItem.priceCents, 750)
  assert.deepEqual(catalogItem.dietaryTags, ['Vegan'])
  assert.equal(getMenuCatalog('riverside').items.some((item) => item.id === newItem.id), false)

  empire = reducer(empire, {
    type: 'LOC',
    locId: 'downtown',
    action: {
      type: 'UPDATE_MENU_ITEM',
      menuItemId: newItem.id,
      patch: { description: 'Roasted with lemon and garden herbs.', active: false, price: 8.25 },
    },
  })
  saveSnapshot(empire, 2)

  catalogItem = getMenuCatalog('downtown').items.find((item) => item.id === newItem.id)
  assert.equal(catalogItem.description, 'Roasted with lemon and garden herbs.')
  assert.equal(catalogItem.priceCents, 825)
  assert.equal(catalogItem.active, false)
  assert.equal(getMenuCatalog('downtown', { availableOnly: true }).items.some((item) => item.id === newItem.id), false)
})

test('older single-store snapshots gain safe catalog defaults', () => {
  const legacy = buildSeed()
  delete legacy.menu[0].description
  delete legacy.menu[0].dietaryTags
  delete legacy.menu[0].active
  const migrated = migrateToEmpire(legacy)
  const salad = migrated.locations.downtown.menu.find((item) => item.id === 'm_salad')

  assert.equal(salad.description, '')
  assert.deepEqual(salad.dietaryTags, [])
  assert.equal(salad.active, true)
  assert.equal(migrated.locations.riverside.menu.length, legacy.menu.length)
})
