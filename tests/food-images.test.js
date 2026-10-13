// ─── Item photos and the food vocabulary they are tagged with ────────
// Photos live in state as data URLs, resized in the browser, so the
// snapshot stays portable (SQLite, localStorage, an export file) with no
// upload service. The vocabulary lists (dietary tags, allergens, spice
// levels, service windows) belong to settings so every screen tags items
// the same way.

import assert from 'node:assert/strict'
import test from 'node:test'
import { reducer, buildEmpire } from '../src/lib/reducer.js'
import {
  DEFAULT_ALLERGENS, DEFAULT_DIETARY_TAGS, MAX_IMAGE_CHARS, defaultSettings,
  sanitizeImageRef, sanitizeLabelList, sanitizeSettings,
} from '../src/lib/settings.js'

const act = (empire, action, locId = 'downtown') => reducer(empire, { type: 'LOC', locId, action })
const downtown = (empire) => empire.locations.downtown
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

test('food settings ship with a usable vocabulary', () => {
  const food = defaultSettings('Test').food
  assert.ok(food.dietaryTags.includes('Vegetarian'))
  assert.ok(food.allergens.includes('Gluten'))
  assert.deepEqual(food.courses, ['Appetizer', 'Main', 'Side', 'Dessert', 'Drink'])
  assert.equal(food.stations.includes('grill'), true)
  assert.equal(food.menuWindows.length, 4)
  assert.equal(food.menuWindows.find((window) => window.id === 'dinner').enabled, true)
  assert.equal(food.showImages, true)
  assert.equal(food.imagesInPrint, false)
  assert.equal(food.imageMaxKb, 180)
})

test('food settings survive a sanitize round trip and reject junk', () => {
  const cleaned = sanitizeSettings({
    food: {
      dietaryTags: ['Vegan', 'vegan', '  ', 'Halal'],
      allergens: [],
      imageMaxKb: 9999,
      defaultCourse: 'Dessert',
      menuWindows: [
        { id: 'brunch', label: 'Brunch', from: '10:00', to: '14:00', enabled: true },
        { id: 'brunch', label: 'Duplicate', from: '10:00', to: '11:00' },
        { id: 'broken', label: '', from: 'x', to: 'y' },
      ],
    },
  }, 'Test')
  assert.deepEqual(cleaned.food.dietaryTags, ['Vegan', 'Halal'])
  assert.deepEqual(cleaned.food.allergens, DEFAULT_ALLERGENS)
  assert.equal(cleaned.food.imageMaxKb, 600)
  assert.equal(cleaned.food.defaultCourse, 'Dessert')
  assert.equal(cleaned.food.menuWindows.length, 1)
  assert.equal(cleaned.food.menuWindows[0].label, 'Brunch')
  assert.equal(cleaned.food.menuWindows[0].to, '14:00')
  const fallback = sanitizeSettings({ food: { menuWindows: [] } }, 'Test')
  assert.equal(fallback.food.menuWindows.length, 4)
})

test('label lists are de-duplicated and capped', () => {
  assert.deepEqual(sanitizeLabelList(['a', 'A', 'b', '', null, 'c']), ['a', 'b', 'c'])
  assert.equal(sanitizeLabelList(Array.from({ length: 60 }, (_, index) => `tag${index}`)).length, 24)
  assert.deepEqual(sanitizeLabelList('not-a-list'), [])
})

test('image references allow urls, paths and small uploads only', () => {
  assert.equal(sanitizeImageRef('https://cdn.example/plate.jpg'), 'https://cdn.example/plate.jpg')
  assert.equal(sanitizeImageRef('/photos/plate.jpg'), '/photos/plate.jpg')
  assert.equal(sanitizeImageRef(tinyPng), tinyPng)
  assert.equal(sanitizeImageRef('data:image/svg+xml;base64,PHN2Zz4='), '')
  assert.equal(sanitizeImageRef('javascript:alert(1)'), '')
  assert.equal(sanitizeImageRef('//evil.example/x.png'), '')
  assert.equal(sanitizeImageRef(`data:image/png;base64,${'A'.repeat(MAX_IMAGE_CHARS + 10)}`), '')
})

test('a menu item keeps its photo, tags, course and window', () => {
  let empire = buildEmpire()
  empire = act(empire, {
    type: 'UPDATE_MENU_ITEM',
    menuItemId: 'm_burger',
    patch: {
      imageUrl: tinyPng,
      dietaryTags: ['Spicy', 'Spicy', 'Kid-friendly'],
      allergens: ['Gluten', 'Dairy'],
      course: 'Main',
      menuWindow: 'dinner',
      spiceLevel: 'Medium',
    },
  })
  const burger = downtown(empire).menu.find((item) => item.id === 'm_burger')
  assert.equal(burger.imageUrl, tinyPng)
  assert.deepEqual(burger.dietaryTags, ['Spicy', 'Kid-friendly'])
  assert.deepEqual(burger.allergens, ['Gluten', 'Dairy'])
  assert.equal(burger.course, 'Main')
  assert.equal(burger.menuWindow, 'dinner')
  assert.equal(burger.spiceLevel, 'Medium')

  // A hostile value never reaches state.
  empire = act(empire, { type: 'UPDATE_MENU_ITEM', menuItemId: 'm_burger', patch: { imageUrl: 'javascript:alert(1)' } })
  assert.equal(downtown(empire).menu.find((item) => item.id === 'm_burger').imageUrl, '')
})

test('stock items can carry a photo too', () => {
  let empire = buildEmpire()
  empire = act(empire, { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_salmon', patch: { imageUrl: '/photos/salmon.jpg' } })
  assert.equal(downtown(empire).inventory.find((item) => item.id === 'inv_salmon').imageUrl, '/photos/salmon.jpg')
})

test('the configuration audit covers the food vocabulary and item media', async () => {
  const { configurationAudit } = await import('../src/lib/settings.js')
  const shop = downtown(buildEmpire())
  const audit = configurationAudit(shop)
  const byId = Object.fromEntries(audit.checks.map((check) => [check.id, check]))
  assert.equal(byId.food.ok, true, byId.food.fix)
  assert.equal(byId.food.section, 'food')
  assert.equal(byId.itemmedia.ok, true, byId.itemmedia.fix)
  assert.equal(audit.ready, true, audit.checks.filter((check) => !check.ok).map((check) => check.label).join(' · '))
  assert.ok(DEFAULT_DIETARY_TAGS.length >= 6)

  // Break the vocabulary and the audit notices.
  const broken = { ...shop, settings: { ...shop.settings, food: { ...shop.settings.food, allergens: [] } } }
  const brokenAudit = configurationAudit(broken)
  assert.equal(brokenAudit.checks.find((check) => check.id === 'food').ok, false)
  assert.equal(brokenAudit.ready, false)
})

test('the seed shows photos and courses out of the box', () => {
  const shop = downtown(buildEmpire())
  const photoed = shop.menu.filter((item) => item.imageUrl)
  assert.ok(photoed.length >= 2, 'at least two demo dishes have a photo')
  assert.ok(photoed.every((item) => item.imageUrl.startsWith('/photos/')), 'demo photos are local assets')
  assert.ok(shop.menu.every((item) => item.course), 'every dish knows its course')
  assert.ok(shop.menu.every((item) => Array.isArray(item.dietaryTags) && Array.isArray(item.allergens)))
  const windows = new Set(shop.settings.food.menuWindows.map((window) => window.id))
  assert.ok(shop.menu.every((item) => !item.menuWindow || windows.has(item.menuWindow)))
})
