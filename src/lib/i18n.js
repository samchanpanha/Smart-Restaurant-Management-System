// ─── Languages: Khmer first, English and Chinese a tap away ─────────
// The kitchen reads in the language the line thinks in. Khmer is the
// house default; English and Chinese are one tap away, and the choice
// sticks to the terminal (see useLanguage.js), so a station screen
// keeps its language across reloads. A kiosk URL can pin it: ?lang=zh.
//
// What the restaurant typed stays as typed: free-text notes, prep notes
// and staff names are never machine-translated. Dish and ingredient
// names carry an optional per-language name (item.translations), and
// the kitchen's closed vocabulary — stations, courses, doneness,
// allergens — comes from the glossary below. Anything unknown falls
// back to the English the owner entered, never to an empty cell.
//
// Pure module: no React, no DOM — the reducer and the tests import it.

// `htmlLang` goes on lang="" attributes: it picks fonts, line breaking and
// the screen-reader voice ("zh-Hans" keeps CJK glyphs Simplified Chinese).
export const LANGUAGES = [
  { id: 'km', label: 'ខ្មែរ', english: 'Khmer', locale: 'km-KH', htmlLang: 'km' },
  { id: 'en', label: 'English', english: 'English', locale: 'en-US', htmlLang: 'en' },
  { id: 'zh', label: '中文', english: 'Chinese', locale: 'zh-CN', htmlLang: 'zh-Hans' },
]

export const DEFAULT_LANGUAGE = 'km'
/** The language item.name and the rest of the back office are typed in. */
export const BASE_LANGUAGE = 'en'
/** Languages an item can carry its own name for (English is item.name). */
export const TRANSLATED_LANGUAGES = LANGUAGES.map((language) => language.id).filter((id) => id !== BASE_LANGUAGE)
export const LANGUAGE_STORAGE_KEY = 'restora-lang'
export const MAX_TRANSLATED_NAME = 80

const ALIASES = {
  kh: 'km', khm: 'km', khmer: 'km', cambodian: 'km',
  cn: 'zh', zho: 'zh', chi: 'zh', chinese: 'zh', hans: 'zh',
  eng: 'en', english: 'en',
}

/** Any spelling a URL, a header or old storage might hold → 'km' | 'en' | 'zh'. */
export function normalizeLanguage(value, fallback = DEFAULT_LANGUAGE) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  const base = raw.split(/[-_]/)[0]
  const id = ALIASES[raw] || ALIASES[base] || base
  return LANGUAGES.some((language) => language.id === id) ? id : fallback
}

export function languageMeta(lang) {
  const id = normalizeLanguage(lang)
  return LANGUAGES.find((language) => language.id === id)
}

/** "{count} photos" + { count: 3 } → "3 photos". Unknown slots stay visible. */
export function interpolate(template, vars) {
  const text = String(template ?? '')
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (slot, key) => (
    vars[key] === undefined || vars[key] === null ? slot : String(vars[key])
  ))
}

/**
 * t(key, vars) over a { en, km, zh } message table. A key missing in the
 * chosen language falls back to English, then to the key itself — the
 * screen degrades to English, never to a blank.
 */
export function createTranslator(messages, lang) {
  const id = normalizeLanguage(lang)
  const chosen = messages?.[id] || {}
  const base = messages?.[BASE_LANGUAGE] || {}
  return function t(key, vars) {
    return interpolate(chosen[key] ?? base[key] ?? key, vars)
  }
}

// ─── Names typed by the restaurant ──────────────────────────────────

/** The item's name in `lang` when the owner gave one, else its English name. */
export function localizedName(item, lang) {
  if (!item) return ''
  const id = normalizeLanguage(lang)
  if (id !== BASE_LANGUAGE) {
    const name = item.translations?.[id]?.name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return item.name || ''
}

/**
 * Keep only real, trimmed per-language names: { km: { name }, zh: { name } }.
 * English never lives here — it is item.name. Returns {} for junk input.
 */
export function sanitizeTranslations(value, { maxName = MAX_TRANSLATED_NAME } = {}) {
  const out = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const id of TRANSLATED_LANGUAGES) {
    const entry = value[id]
    const raw = typeof entry === 'string' ? entry : entry?.name
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, maxName)
    if (name) out[id] = { name }
  }
  return out
}

/** Editor draft from an item: { km: 'name', zh: 'name' } (empty strings when unset). */
export function translationDraft(item) {
  return Object.fromEntries(TRANSLATED_LANGUAGES.map((id) => [id, item?.translations?.[id]?.name || '']))
}

/** An editor draft back to the stored shape; sanitizeTranslations drops the empty ones. */
export function translationPatch(draft) {
  return Object.fromEntries(TRANSLATED_LANGUAGES.map((id) => [id, { name: String(draft?.[id] || '').trim() }]))
}

/** "Table 7" → "តុ 7" / "7号桌". Any other table name is shown as typed. */
export function localizeTableName(name, lang) {
  const text = String(name ?? '')
  const id = normalizeLanguage(lang)
  const match = /^table\s+(\S+)$/i.exec(text.trim())
  if (!match || id === BASE_LANGUAGE) return text
  return id === 'km' ? `តុ ${match[1]}` : `${match[1]}号桌`
}

/** Wall-clock time in the language's locale, always with Latin digits. */
export function formatClockIn(value, lang) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const id = normalizeLanguage(lang)
  // English keeps the terminal's own locale, exactly like formatClock().
  const locale = id === BASE_LANGUAGE ? [] : languageMeta(id).locale
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' })
}

// ─── Kitchen glossary ───────────────────────────────────────────────
// The closed vocabulary a ticket is made of, keyed by the lowercase
// English term (accents folded, so "Sauté" finds "saute"). Settings lets
// owners add their own words; those simply show in English.
//
// Doneness keeps the English term in Khmer: there is no settled Khmer
// word for "medium rare", and a misread steak is worse than a long chip.

const GLOSSARY = {
  station: {
    grill: { km: 'អាំង', zh: '烧烤' },
    saute: { km: 'ឆា', zh: '炒锅' },
    pantry: { km: 'ម្ហូបត្រជាក់', zh: '冷菜' },
    fry: { km: 'បំពង', zh: '油炸' },
    dessert: { km: 'បង្អែម', zh: '甜品' },
    bar: { km: 'បារ', zh: '吧台' },
    expo: { km: 'ចេញម្ហូប', zh: '出餐口' },
  },
  course: {
    appetizer: { km: 'អាហារសម្រន់', zh: '前菜' },
    starter: { km: 'អាហារសម្រន់', zh: '前菜' },
    main: { km: 'ម្ហូបចម្បង', zh: '主菜' },
    side: { km: 'ម្ហូបបន្ទាប់បន្សំ', zh: '配菜' },
    dessert: { km: 'បង្អែម', zh: '甜品' },
    drink: { km: 'ភេសជ្ជៈ', zh: '饮品' },
  },
  modifier: {
    rare: { km: 'ឆ្អិនតិច (Rare)', zh: '一分熟' },
    'medium rare': { km: 'ឆ្អិនល្មមតិច (Medium rare)', zh: '三分熟' },
    medium: { km: 'ឆ្អិនល្មម (Medium)', zh: '五分熟' },
    'medium well': { km: 'ឆ្អិនល្មមច្រើន (Medium well)', zh: '七分熟' },
    well: { km: 'ឆ្អិនល្អ (Well)', zh: '全熟' },
    'well done': { km: 'ឆ្អិនល្អ (Well done)', zh: '全熟' },
    ranch: { km: 'ទឹកសាឡាដ Ranch', zh: '田园沙拉酱' },
    vinaigrette: { km: 'ទឹកខ្មេះប្រេងអូលីវ', zh: '油醋汁' },
    'blue cheese': { km: 'ទឹកសាឡាដឈីសខៀវ', zh: '蓝纹奶酪酱' },
    buffalo: { km: 'ទឹកជ្រលក់ហឹរ Buffalo', zh: '水牛城辣酱' },
    bbq: { km: 'ទឹកជ្រលក់ BBQ', zh: '烧烤酱' },
    'garlic parm': { km: 'ខ្ទឹមស និងឈីសប៉ាម៉េសាន', zh: '蒜香芝士' },
  },
  allergen: {
    gluten: { km: 'គ្លុយតែន', zh: '麸质' },
    wheat: { km: 'ស្រូវសាលី', zh: '小麦' },
    dairy: { km: 'ផលិតផលទឹកដោះគោ', zh: '乳制品' },
    milk: { km: 'ទឹកដោះគោ', zh: '牛奶' },
    egg: { km: 'ស៊ុត', zh: '蛋' },
    eggs: { km: 'ស៊ុត', zh: '蛋' },
    nuts: { km: 'គ្រាប់ឈើ', zh: '坚果' },
    peanuts: { km: 'សណ្ដែកដី', zh: '花生' },
    shellfish: { km: 'សត្វសំបក', zh: '贝类' },
    fish: { km: 'ត្រី', zh: '鱼' },
    soy: { km: 'សណ្ដែកសៀង', zh: '大豆' },
    sesame: { km: 'ល្ង', zh: '芝麻' },
    celery: { km: 'ខឹនឆាយ', zh: '芹菜' },
    mustard: { km: 'មូស្តាត', zh: '芥末' },
    'varies by dressing choice': { km: 'អាស្រ័យលើទឹកសាឡាដដែលបានជ្រើស', zh: '视所选沙拉酱而定' },
    'varies by sauce choice': { km: 'អាស្រ័យលើទឹកជ្រលក់ដែលបានជ្រើស', zh: '视所选酱料而定' },
    'varies by daily recipe': { km: 'អាស្រ័យលើរូបមន្តប្រចាំថ្ងៃ', zh: '视当日配方而定' },
  },
  diet: {
    vegetarian: { km: 'បួស', zh: '素食' },
    vegan: { km: 'បួសសុទ្ធ', zh: '纯素' },
    'gluten-free': { km: 'គ្មានគ្លុយតែន', zh: '无麸质' },
    'dairy-free': { km: 'គ្មានទឹកដោះគោ', zh: '无乳制品' },
    'contains nuts': { km: 'មានគ្រាប់ឈើ', zh: '含坚果' },
    spicy: { km: 'ហឹរ', zh: '辣' },
    halal: { km: 'ហាឡាល់', zh: '清真' },
    'kid-friendly': { km: 'សម្រាប់កុមារ', zh: '适合儿童' },
  },
  spice: {
    mild: { km: 'ហឹរតិច', zh: '微辣' },
    medium: { km: 'ហឹរមធ្យម', zh: '中辣' },
    hot: { km: 'ហឹរខ្លាំង', zh: '特辣' },
  },
  orderType: {
    dine_in: { km: 'ញ៉ាំនៅហាង', zh: '堂食' },
    takeout: { km: 'ខ្ចប់យកទៅ', zh: '外带' },
    delivery: { km: 'ដឹកជញ្ជូន', zh: '外卖' },
  },
}

export const GLOSSARY_KINDS = Object.keys(GLOSSARY)

function glossaryKey(term) {
  return String(term ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * A kitchen word in `lang`: localizeTerm('Medium rare', 'zh', 'modifier')
 * → '三分熟'. Unknown words (and English) come back exactly as given.
 */
export function localizeTerm(term, lang, kind = 'modifier') {
  const text = String(term ?? '')
  const id = normalizeLanguage(lang)
  if (!text.trim() || id === BASE_LANGUAGE) return text
  return GLOSSARY[kind]?.[glossaryKey(text)]?.[id] || text
}

/** Every glossary entry, for completeness checks in the tests. */
export function glossaryEntries() {
  return GLOSSARY_KINDS.flatMap((kind) => Object.entries(GLOSSARY[kind]).map(([term, names]) => ({ kind, term, names })))
}
