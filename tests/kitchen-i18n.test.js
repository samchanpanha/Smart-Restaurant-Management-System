// ─── Kitchen languages, dish names and photo galleries ──────────────
// The kitchen display speaks Khmer by default (English and Chinese one
// tap away) and shows every photo of a dish. These tests pin the pieces
// underneath: language resolution, the message table, the glossary, the
// per-item names and galleries, and how the reducer and the v5 migration
// treat them.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_LANGUAGE, LANGUAGES, MAX_TRANSLATED_NAME, createTranslator, formatClockIn, glossaryEntries, interpolate,
  localizeTableName, localizeTerm, localizedName, normalizeLanguage, sanitizeTranslations, translationDraft, translationPatch,
} from '../src/lib/i18n.js'
import { itemPhotos } from '../src/lib/images.js'
import { KITCHEN_STRINGS } from '../src/lib/kitchen-strings.js'
import { buildEmpire, buildSeed, migrateToEmpire, reducer } from '../src/lib/reducer.js'
import { SEED_INVENTORY_NAMES, SEED_MENU_MEDIA } from '../src/lib/seed.js'
import {
  DEFAULT_ALLERGENS, DEFAULT_COURSES, DEFAULT_DIETARY_TAGS, FOOD_STATIONS, MAX_ITEM_MEDIA_CHARS, MAX_ITEM_PHOTOS,
  defaultSettings, sanitizeImageList, sanitizeSettings,
} from '../src/lib/settings.js'
import { languageFromQuery } from '../src/lib/useLanguage.js'

const act = (empire, action) => reducer(empire, { type: 'LOC', locId: 'downtown', action })
const downtown = (empire) => empire.locations.downtown
const slots = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

test('Khmer is the default, and every common spelling of a language resolves', () => {
  assert.equal(DEFAULT_LANGUAGE, 'km')
  assert.deepEqual(LANGUAGES.map((language) => language.id), ['km', 'en', 'zh'])
  assert.deepEqual(LANGUAGES.map((language) => language.label), ['ខ្មែរ', 'English', '中文'])
  for (const blank of ['', null, undefined, '   ']) assert.equal(normalizeLanguage(blank), 'km')
  assert.equal(normalizeLanguage('km-KH'), 'km')
  assert.equal(normalizeLanguage('kh'), 'km')
  assert.equal(normalizeLanguage('EN'), 'en')
  assert.equal(normalizeLanguage('en-GB'), 'en')
  assert.equal(normalizeLanguage('zh-CN'), 'zh')
  assert.equal(normalizeLanguage('zh_Hans'), 'zh')
  assert.equal(normalizeLanguage('cn'), 'zh')
  assert.equal(normalizeLanguage('fr'), 'km', 'an unsupported language falls back to Khmer')
  assert.equal(normalizeLanguage('fr', null), null)
  // Kiosk links: /?role=kitchen&screen=kitchen&lang=zh
  assert.equal(languageFromQuery('?role=kitchen&lang=zh-CN'), 'zh')
  assert.equal(languageFromQuery('?lang=en'), 'en')
  assert.equal(languageFromQuery('?lang=fr'), null)
  assert.equal(languageFromQuery(''), null)
})

test('every kitchen string exists in English, Khmer and Chinese with the same slots', () => {
  const keys = Object.keys(KITCHEN_STRINGS.en).sort()
  assert.ok(keys.length > 50)
  for (const lang of ['km', 'zh']) {
    assert.deepEqual(Object.keys(KITCHEN_STRINGS[lang]).sort(), keys, `${lang} has exactly the English keys`)
    for (const key of keys) {
      const text = KITCHEN_STRINGS[lang][key]
      assert.ok(typeof text === 'string' && text.trim(), `${lang}.${key} is written`)
      assert.deepEqual(slots(text), slots(KITCHEN_STRINGS.en[key]), `${lang}.${key} keeps the {slots}`)
    }
  }
  // The Khmer copy really is Khmer, the Chinese copy really is Chinese.
  assert.match(KITCHEN_STRINGS.km.title, /[\u1780-\u17FF]/)
  assert.match(KITCHEN_STRINGS.zh.title, /[\u4E00-\u9FFF]/)
})

test('a string missing in one language falls back to English, then to its key', () => {
  const t = createTranslator({ en: { hello: 'Hello {name}', only: 'English only' }, km: { hello: 'សួស្តី {name}' } }, 'km')
  assert.equal(t('hello', { name: 'Kim' }), 'សួស្តី Kim')
  assert.equal(t('only'), 'English only')
  assert.equal(t('nope'), 'nope')
  assert.equal(interpolate('{a} and {b}', { a: 1 }), '1 and {b}', 'an unfilled slot stays visible')
  assert.equal(createTranslator(KITCHEN_STRINGS, 'xx')('title'), KITCHEN_STRINGS.km.title, 'unknown language → Khmer')
})

test('the kitchen vocabulary translates by context, and unknown words pass through', () => {
  assert.equal(localizeTerm('Medium rare', 'zh', 'modifier'), '三分熟')
  assert.equal(localizeTerm('Medium', 'zh', 'modifier'), '五分熟')
  assert.equal(localizeTerm('Medium', 'zh', 'spice'), '中辣', 'the same English word, a different kitchen meaning')
  assert.equal(localizeTerm('Sauté', 'km', 'station'), 'ឆា', 'accents fold')
  assert.equal(localizeTerm('main', 'km', 'course'), 'ម្ហូបចម្បង', 'order lines store courses in lower case')
  assert.equal(localizeTerm('  BLUE   cheese ', 'zh', 'modifier'), '蓝纹奶酪酱')
  assert.equal(localizeTerm('dine_in', 'km', 'orderType'), 'ញ៉ាំនៅហាង')
  assert.equal(localizeTerm('Extra pickles', 'km', 'modifier'), 'Extra pickles', 'owner words stay as typed')
  assert.equal(localizeTerm('Medium', 'en', 'modifier'), 'Medium')
  assert.match(localizeTerm('Rare', 'km', 'modifier'), /\(Rare\)/, 'Khmer doneness keeps the English term')

  for (const { kind, term, names } of glossaryEntries()) {
    assert.ok(names.km?.trim() && names.zh?.trim(), `${kind}:${term} has Khmer and Chinese`)
  }
  // Everything the default settings and the demo menu put on a ticket is covered.
  const settings = defaultSettings()
  const covered = (term, kind) => localizeTerm(term, 'km', kind) !== term && localizeTerm(term, 'zh', kind) !== term
  for (const allergen of DEFAULT_ALLERGENS) assert.ok(covered(allergen, 'allergen'), allergen)
  for (const tag of DEFAULT_DIETARY_TAGS) assert.ok(covered(tag, 'diet'), tag)
  for (const course of DEFAULT_COURSES) assert.ok(covered(course, 'course'), course)
  for (const station of FOOD_STATIONS) assert.ok(covered(station, 'station'), station)
  for (const level of settings.food.spiceLevels) assert.ok(covered(level, 'spice'), level)
  const seed = buildSeed()
  for (const dish of seed.menu) {
    for (const allergen of dish.allergens) assert.ok(covered(allergen, 'allergen'), `${dish.name}: ${allergen}`)
    for (const option of dish.modifiers.flatMap((group) => group.options)) assert.ok(covered(option, 'modifier'), `${dish.name}: ${option}`)
  }
})

test('dish and table names come out in the chosen language, English as the fallback', () => {
  const soda = { name: 'Soda', translations: { km: { name: 'ភេសជ្ជៈកំប៉ុង' } } }
  assert.equal(localizedName(soda, 'km'), 'ភេសជ្ជៈកំប៉ុង')
  assert.equal(localizedName(soda, 'zh'), 'Soda', 'no Chinese name yet → English')
  assert.equal(localizedName(soda, 'en'), 'Soda')
  assert.equal(localizedName({ name: 'Soda', translations: { km: { name: '   ' } } }, 'km'), 'Soda')
  assert.equal(localizedName(null, 'km'), '')

  assert.equal(localizeTableName('Table 7', 'km'), 'តុ 7')
  assert.equal(localizeTableName('Table 7', 'zh'), '7号桌')
  assert.equal(localizeTableName('Table 7', 'en'), 'Table 7')
  assert.equal(localizeTableName('Patio', 'km'), 'Patio', 'custom table names stay as typed')

  assert.match(formatClockIn('2026-10-14T19:05:00', 'zh'), /^\d{2}:\d{2}$/, 'Latin digits, 24-hour in Chinese')
  assert.match(formatClockIn('2026-10-14T19:05:00', 'km'), /\d{2}:\d{2}/)
  assert.equal(formatClockIn('not a date', 'km'), '—')
})

test('names in other languages are cleaned: trimmed, capped, never English, never junk', () => {
  assert.deepEqual(
    sanitizeTranslations({ km: { name: '  នំ   ខេក ' }, zh: '巧克力', en: { name: 'Cake' }, fr: { name: 'Gâteau' } }),
    { km: { name: 'នំ ខេក' }, zh: { name: '巧克力' } },
  )
  assert.deepEqual(sanitizeTranslations({ km: { name: '' }, zh: { name: null } }), {})
  assert.deepEqual(sanitizeTranslations('junk'), {})
  assert.deepEqual(sanitizeTranslations(['km']), {})
  assert.equal(sanitizeTranslations({ zh: { name: '菜'.repeat(200) } }).zh.name.length, MAX_TRANSLATED_NAME)

  const item = { name: 'Coffee', translations: { km: { name: 'កាហ្វេ' } } }
  assert.deepEqual(translationDraft(item), { km: 'កាហ្វេ', zh: '' })
  assert.deepEqual(sanitizeTranslations(translationPatch({ km: ' កាហ្វេ ', zh: '' })), { km: { name: 'កាហ្វេ' } })
})

test('a gallery is cleaned against its cover, the photo cap and the media budget', () => {
  assert.equal(MAX_ITEM_PHOTOS, 6)
  assert.deepEqual(
    sanitizeImageList(['/photos/a.svg', '/photos/a.svg', 'javascript:alert(1)', '//evil.test/x.png', '/photos/b.svg', '/photos/cover.svg'], { cover: '/photos/cover.svg' }),
    ['/photos/a.svg', '/photos/b.svg'],
  )
  const many = Array.from({ length: 12 }, (_, index) => `/photos/p${index}.svg`)
  assert.equal(sanitizeImageList(many).length, MAX_ITEM_PHOTOS - 1, 'the cover plus five more')
  assert.deepEqual(sanitizeImageList('not a list'), [])

  // Uploads count against the budget an edit can carry to the server.
  const upload = (seed) => `data:image/jpeg;base64,${String(seed).repeat(250000 - 23)}`
  const cover = upload('a')
  const kept = sanitizeImageList([upload('b'), upload('c'), '/photos/small.svg'], { cover })
  assert.deepEqual(kept.map((ref) => ref.slice(0, 24)), [upload('b').slice(0, 24), '/photos/small.svg'])
  assert.ok(cover.length + kept.reduce((sum, ref) => sum + ref.length, 0) <= MAX_ITEM_MEDIA_CHARS)

  assert.deepEqual(
    itemPhotos({ imageUrl: '/photos/a.svg', images: ['/photos/b.svg', '/photos/a.svg', 'ftp://x', ''] }),
    ['/photos/a.svg', '/photos/b.svg'],
  )
  assert.deepEqual(itemPhotos({ images: ['/photos/b.svg'] }), ['/photos/b.svg'], 'a gallery without a cover still shows')
  assert.deepEqual(itemPhotos(undefined), [])
})

test('the reducer keeps galleries and names through edits and drops what is unsafe', () => {
  let empire = buildEmpire()
  empire = act(empire, {
    type: 'UPDATE_MENU_ITEM',
    menuItemId: 'm_burger',
    patch: {
      imageUrl: '/photos/burger.svg',
      images: ['/photos/burger-top.svg', 'javascript:alert(1)', '/photos/burger-top.svg', '/photos/burger.svg'],
      translations: { km: { name: '  ប៊ឺហ្គឺពិសេស ' }, zh: { name: '' }, en: { name: 'ignored' } },
    },
  })
  const burger = downtown(empire).menu.find((item) => item.id === 'm_burger')
  assert.deepEqual(burger.images, ['/photos/burger-top.svg'])
  assert.deepEqual(burger.translations, { km: { name: 'ប៊ឺហ្គឺពិសេស' } })

  empire = act(empire, {
    type: 'ADD_MENU_ITEM',
    item: {
      id: 'm_loklak', name: 'Lok Lak', category: 'Mains', price: 12, station: 'saute',
      imageUrl: '', images: ['https://cdn.example/loklak.jpg'], translations: { km: { name: 'ឡុកឡាក់' }, zh: { name: '牛肉炒饭' } },
    },
  })
  const loklak = downtown(empire).menu.find((item) => item.id === 'm_loklak')
  assert.deepEqual(loklak.images, ['https://cdn.example/loklak.jpg'])
  assert.equal(localizedName(loklak, 'km'), 'ឡុកឡាក់')
  assert.deepEqual(itemPhotos(loklak), ['https://cdn.example/loklak.jpg'])

  empire = act(empire, { type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: 'inv_tomato', patch: { translations: { zh: { name: ' 西红柿 ' } } } })
  assert.deepEqual(downtown(empire).inventory.find((item) => item.id === 'inv_tomato').translations, { zh: { name: '西红柿' } })
})

test('every demo dish ships three local, text-free photos and Khmer and Chinese names', () => {
  const seed = buildSeed()
  const seen = new Set()
  for (const dish of seed.menu) {
    const photos = itemPhotos(dish)
    assert.equal(photos.length, 3, `${dish.name} has a cover and two more photos`)
    for (const ref of photos) {
      assert.match(ref, /^\/photos\/[a-z-]+\.svg$/)
      assert.ok(!seen.has(ref), `${ref} is used once`)
      seen.add(ref)
      const file = new URL(`../public${ref}`, import.meta.url)
      assert.ok(existsSync(file), `${ref} exists in public/`)
      const svg = readFileSync(file, 'utf8')
      assert.match(svg, /role="img"/)
      assert.doesNotMatch(svg, /<text[\s>]/, `${ref} carries no words — it reads the same in every language`)
    }
    assert.match(localizedName(dish, 'km'), /[\u1780-\u17FF]/, `${dish.name} has a Khmer name`)
    assert.match(localizedName(dish, 'zh'), /[\u4E00-\u9FFF]/, `${dish.name} has a Chinese name`)
    assert.equal(SEED_MENU_MEDIA[dish.id].name, dish.name)
  }
  for (const item of seed.inventory) {
    assert.match(localizedName(item, 'km'), /[\u1780-\u17FF]/, `${item.name} has a Khmer name`)
    assert.match(localizedName(item, 'zh'), /[\u4E00-\u9FFF]/, `${item.name} has a Chinese name`)
    assert.equal(SEED_INVENTORY_NAMES[item.id].name, item.name)
  }
  // The seed constants are copied, never shared with live state.
  const shop = downtown(buildEmpire())
  shop.menu[0].images.push('/photos/mutated.svg')
  assert.ok(!SEED_MENU_MEDIA[shop.menu[0].id].images.includes('/photos/mutated.svg'))
})

test('snapshots saved before v5 get the demo photos and names once, never over the owner’s own', () => {
  const legacy = JSON.parse(JSON.stringify(buildEmpire()))
  legacy.version = 4
  for (const shop of Object.values(legacy.locations)) {
    for (const dish of shop.menu) {
      delete dish.images
      delete dish.translations
      if (!['m_burger', 'm_salmon'].includes(dish.id)) dish.imageUrl = ''
    }
    for (const item of shop.inventory) delete item.translations
  }
  const shop = legacy.locations.downtown
  shop.menu.find((dish) => dish.id === 'm_steak').name = 'Lok Lak' // made their own
  shop.menu.find((dish) => dish.id === 'm_cake').imageUrl = 'https://cdn.example/our-cake.jpg' // own photo
  shop.inventory.find((item) => item.id === 'inv_bun').name = 'Bao bun'

  const migrated = migrateToEmpire(legacy)
  assert.equal(migrated.version, 5, 'the upgrade is recorded, so it runs once')
  const dish = (id) => migrated.locations.downtown.menu.find((entry) => entry.id === id)
  assert.equal(itemPhotos(dish('m_salad')).length, 3)
  assert.equal(itemPhotos(dish('m_burger')).length, 3)
  assert.equal(localizedName(dish('m_salad'), 'km'), 'សាឡាដពិសេសរបស់ហាង')
  assert.deepEqual(itemPhotos(dish('m_steak')), [], 'a renamed dish is left alone')
  assert.deepEqual(dish('m_steak').translations, {})
  assert.deepEqual(itemPhotos(dish('m_cake')), ['https://cdn.example/our-cake.jpg'], 'an owner photo is kept')
  assert.equal(localizedName(dish('m_cake'), 'zh'), '巧克力蛋糕', '…and the dish still gets its names')
  assert.deepEqual(migrated.locations.downtown.inventory.find((item) => item.id === 'inv_bun').translations, {})
  assert.equal(itemPhotos(migrated.locations.riverside.menu.find((entry) => entry.id === 'm_soup')).length, 3)

  // At v5 nothing is backfilled again: photos the owner removed stay removed.
  const later = JSON.parse(JSON.stringify(migrated))
  Object.assign(later.locations.downtown.menu.find((entry) => entry.id === 'm_salad'), { imageUrl: '', images: [] })
  assert.deepEqual(itemPhotos(migrateToEmpire(later).locations.downtown.menu.find((entry) => entry.id === 'm_salad')), [])
})

test('kitchen photos are on by default and the switch survives sanitizing', () => {
  assert.equal(defaultSettings().food.imagesOnKitchen, true)
  assert.equal(sanitizeSettings({ food: { imagesOnKitchen: false } }).food.imagesOnKitchen, false)
  assert.equal(sanitizeSettings({ food: {} }).food.imagesOnKitchen, true)
  assert.equal(sanitizeSettings({}).food.imagesOnKitchen, true)
})
