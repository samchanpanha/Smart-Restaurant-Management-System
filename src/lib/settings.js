// ─── Restora configuration model ───────────────────────────────────
// One place that defines what a location can be configured with:
// business identity, multi-currency, tax/service, document design
// templates, document numbering, stock policy, POS rules, and
// notification preferences.
//
// Every value here is sanitized on the way in (reducer + server), so a
// hand-edited action log or a stale localStorage snapshot can never
// produce a broken storefront or a receipt with a 4MB logo.

import { CURRENCY_CODES, currencyMeta } from './currency.js'
import { STATIONS } from './constants.js'
import { DEFAULT_PACK_NAMES, DEFAULT_UNITS, sanitizePackNames, sanitizeUnitList, slugUnitId } from './units.js'

export const DOC_KINDS = ['invoice', 'receipt', 'ticket', 'report', 'purchase']

export const DOC_KIND_META = {
  invoice: {
    label: 'Invoice',
    short: 'INV',
    audience: 'Guest / accounts payable',
    blurb: 'Itemized bill on a full page, with tax breakdown, terms, and payment details.',
  },
  receipt: {
    label: 'Receipt',
    short: 'RCT',
    audience: 'Guest at the table',
    blurb: 'Narrow thermal receipt with payments, tip, and a thank-you line.',
  },
  ticket: {
    label: 'Kitchen ticket',
    short: 'TKT',
    audience: 'Kitchen + expo',
    blurb: 'Station ticket with modifiers, courses, and guest notes. Prices optional.',
  },
  report: {
    label: 'Report',
    short: 'RPT',
    audience: 'Owner / accountant',
    blurb: 'Shift report: sales, service, voids, variance and P&L-lite on one page.',
  },
  purchase: {
    label: 'Purchase order',
    short: 'PO',
    audience: 'Supplier / receiving',
    blurb: 'What you are buying, at what cost, delivered when — the document you send a vendor and check the delivery against.',
  },
}

export const PAPER_SIZES = {
  thermal80: { label: 'Thermal roll · 80mm', widthMm: 72, pageWidthMm: 80, roll: true },
  thermal58: { label: 'Thermal roll · 58mm', widthMm: 48, pageWidthMm: 58, roll: true },
  a5: { label: 'A5 · 148×210mm', widthMm: 148, pageWidthMm: 148, roll: false },
  a4: { label: 'A4 · 210×297mm', widthMm: 210, pageWidthMm: 210, roll: false },
  letter: { label: 'Letter · 8.5×11in', widthMm: 216, pageWidthMm: 216, roll: false },
}

export const PAYMENT_TERMS = [
  { id: 'due_on_receipt', label: 'Due on receipt', days: 0 },
  { id: 'net_7', label: 'Net 7', days: 7 },
  { id: 'net_14', label: 'Net 14', days: 14 },
  { id: 'net_30', label: 'Net 30', days: 30 },
  { id: 'net_60', label: 'Net 60', days: 60 },
  { id: 'cod', label: 'Cash on delivery', days: 0 },
]

export const SUPPLIER_STATUSES = ['active', 'paused', 'archived']

export const VALUATION_METHODS = [
  { id: 'last_cost', label: 'Last invoice cost', blurb: 'Plate cost follows the newest invoice — the v1 rule.' },
  { id: 'weighted_average', label: 'Weighted average', blurb: 'Blend every receipt; smooths volatile market prices.' },
]

export const REORDER_POLICIES = [
  { id: 'par', label: 'Par level', blurb: 'Alert when on-hand drops under par.' },
  { id: 'reorder_point', label: 'Reorder point + safety stock', blurb: 'Alert when on-hand under reorder point; order up to par.' },
]

export const STORAGE_LOCATIONS = [
  { id: 'dry', label: 'Dry storage' },
  { id: 'walk_in', label: 'Walk-in cooler' },
  { id: 'freezer', label: 'Freezer' },
  { id: 'bar', label: 'Bar' },
  { id: 'prep', label: 'Prep station' },
]

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'webhook']

// Food settings: the vocabulary the menu, the guest app and the printed
// documents all read. Owners edit these lists; items just reference them.
export const DEFAULT_DIETARY_TAGS = [
  'Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Contains nuts', 'Spicy', 'Halal', 'Kid-friendly',
]
export const DEFAULT_ALLERGENS = [
  'Gluten', 'Dairy', 'Eggs', 'Nuts', 'Peanuts', 'Shellfish', 'Fish', 'Soy', 'Sesame', 'Celery', 'Mustard',
]
export const DEFAULT_COURSES = ['Appetizer', 'Main', 'Side', 'Dessert', 'Drink']
export const FOOD_STATIONS = ['grill', 'saute', 'pantry', 'fry', 'dessert', 'bar', 'expo']
export const DEFAULT_MENU_WINDOWS = [
  { id: 'breakfast', label: 'Breakfast', from: '06:00', to: '11:00', enabled: false },
  { id: 'lunch', label: 'Lunch', from: '11:00', to: '16:00', enabled: true },
  { id: 'dinner', label: 'Dinner', from: '16:00', to: '23:00', enabled: true },
  { id: 'late', label: 'Late night', from: '23:00', to: '02:00', enabled: false },
]
/** Longest image we will keep in state: ~190 KB of base64 photo. */
export const MAX_IMAGE_CHARS = 260000
export const IMAGE_DATA_PREFIXES = ['data:image/png', 'data:image/jpeg', 'data:image/jpg', 'data:image/webp', 'data:image/gif', 'data:image/avif']

/** Items can carry a photo; the reducer and the settings editor share this. */
export function sanitizeImageRef(value, maxChars = MAX_IMAGE_CHARS) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.length > maxChars) return ''
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  if (raw.startsWith('data:')) {
    return IMAGE_DATA_PREFIXES.some((prefix) => raw.startsWith(prefix)) ? raw : ''
  }
  try {
    const parsed = new URL(raw)
    return ['https:', 'http:'].includes(parsed.protocol) ? raw : ''
  } catch {
    return ''
  }
}

/** Clean, de-duplicated, length-capped label list (tags, allergens, …). */
export function sanitizeLabelList(value, max = 24, maxLength = 40) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  const out = []
  for (const entry of list) {
    const label = String(entry ?? '').trim().slice(0, maxLength)
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label)
    if (out.length >= max) break
  }
  return out
}

// ─── Document design templates ─────────────────────────────────────

export function defaultTemplates() {
  return {
    invoice: {
      name: 'Standard invoice',
      paper: 'a4',
      title: 'INVOICE',
      accent: '#f36a21',
      fontScale: 1,
      currency: 'base',
      // blocks
      showLogo: true,
      showCompany: true,
      showCustomer: true,
      showSku: false,
      showDescription: true,
      showUnitPrice: true,
      showModifiers: true,
      showTaxBreakdown: true,
      showServiceCharge: true,
      showDiscount: true,
      showPaymentTerms: true,
      showBankDetails: true,
      showSignature: false,
      showQr: true,
      showNotes: true,
      headerText: '',
      footerText: 'Restora · invoice generated from the live ticket of record.',
      termsText: 'Payment due within 14 days unless agreed otherwise.',
      thankYou: 'Thank you for dining with us.',
      bankDetails: 'Bank transfer · Restora Hospitality · Acct 0001 2345 6789 · Routing 021000021',
      signatureLabel: 'Authorized by',
      copies: 1,
    },
    receipt: {
      name: 'Guest receipt',
      paper: 'thermal80',
      title: 'RECEIPT',
      accent: '#111827',
      fontScale: 1,
      currency: 'base',
      showLogo: true,
      showCompany: true,
      showCustomer: false,
      showSku: false,
      showDescription: false,
      showUnitPrice: true,
      showModifiers: true,
      showTaxBreakdown: true,
      showServiceCharge: true,
      showDiscount: true,
      showPayments: true,
      showTipLine: true,
      showServer: true,
      showTable: true,
      showQr: true,
      showSignature: false,
      showNotes: false,
      headerText: '',
      footerText: 'Prices include service unless stated.',
      termsText: '',
      thankYou: 'Thank you — see you next time!',
      bankDetails: '',
      signatureLabel: '',
      copies: 1,
    },
    ticket: {
      name: 'Kitchen ticket',
      paper: 'thermal80',
      title: 'KITCHEN TICKET',
      accent: '#111827',
      fontScale: 1.15,
      currency: 'base',
      showLogo: false,
      showCompany: false,
      showCustomer: false,
      showSku: false,
      showDescription: false,
      showUnitPrice: false,
      showPrices: false,
      showModifiers: true,
      showCourse: true,
      showGuestNotes: true,
      showServer: true,
      showTable: true,
      showFiredTime: true,
      groupByStation: true,
      showQr: false,
      showSignature: false,
      headerText: '',
      footerText: '',
      termsText: '',
      thankYou: '',
      bankDetails: '',
      signatureLabel: '',
      copies: 1,
    },
    report: {
      name: 'Shift report',
      paper: 'a4',
      title: 'SHIFT REPORT',
      accent: '#f36a21',
      fontScale: 1,
      currency: 'base',
      showLogo: true,
      showCompany: true,
      showComparison: true,
      showHourly: true,
      showCategories: true,
      showTopSellers: true,
      showService: true,
      showVoids: true,
      showVariance: true,
      showPnl: true,
      showPurchases: true,
      showStockFlow: true,
      showTopLow: true,
      showSignature: true,
      showQr: false,
      showNotes: true,
      headerText: '',
      footerText: 'Generated by Restora — every number traces back to a ticket.',
      termsText: '',
      thankYou: '',
      bankDetails: '',
      signatureLabel: 'Reviewed by',
      copies: 1,
    },
    purchase: {
      name: 'Supplier purchase order',
      paper: 'a4',
      title: 'PURCHASE ORDER',
      accent: '#0f766e',
      fontScale: 1,
      currency: 'base',
      showLogo: true,
      showCompany: true,
      showCustomer: true,
      showSku: true,
      showDescription: true,
      showUnitPrice: true,
      showModifiers: false,
      showTaxBreakdown: true,
      showServiceCharge: false,
      showDiscount: false,
      showShipping: true,
      showPaymentTerms: true,
      showBankDetails: false,
      showSignature: true,
      showQr: false,
      showNotes: true,
      headerText: '',
      footerText: 'Please confirm availability and delivery date. Quote the PO number on all paperwork.',
      termsText: 'Deliver to the address above during receiving hours. Short or substituted lines must be noted on the delivery note.',
      thankYou: '',
      bankDetails: '',
      signatureLabel: 'Approved by',
      copies: 1,
    },
  }
}

export function templateFor(settings, kind) {
  const base = defaultTemplates()[kind] || defaultTemplates().invoice
  const saved = settings?.templates?.[kind] || {}
  return sanitizeTemplate({ ...base, ...saved }, kind)
}

// ─── Business identity + preferences ───────────────────────────────

/**
 * A display label is either a bare store name ("Riverside") or an already
 * branded one ("Restora · Downtown" — what mergeSettings passes back in).
 * Never double-prefix it.
 */
function fallbackRestaurantName(label) {
  const text = clampText(label, 80)
  if (!text) return 'Restora'
  return /^restora\b/i.test(text) ? text : `Restora · ${text}`
}

export function defaultSettings(locationLabel = 'Downtown') {
  return {
    // Identity — prints on every document
    restaurantName: fallbackRestaurantName(locationLabel),
    legalName: 'Restora Hospitality LLC',
    tagline: 'Modern comfort food, cooked to order',
    description:
      'A 16-table neighborhood dining room serving seasonal comfort food, craft sodas, and a short, sharp wine list.',
    logoUrl: '',
    logoInitials: 'RS',
    brandColor: '#f36a21',
    addressLine1: '120 Market Street',
    addressLine2: 'Suite 4',
    city: 'Portland',
    state: 'OR',
    postalCode: '97204',
    country: 'United States',
    phone: '+1 (503) 555-0134',
    email: 'hello@restora.example',
    website: 'restora.example',
    taxId: 'EIN 88-1234567',

    // Operating mode: 'demo' (training/walkthrough) or 'production' (live operations)
    operatingMode: 'demo',

    // Money + locale
    baseCurrency: 'USD',
    currency: 'USD',
    currencies: [
      { code: 'EUR', rate: 0.92, enabled: true, symbol: '€', decimals: 2 },
      { code: 'GBP', rate: 0.79, enabled: true, symbol: '£', decimals: 2 },
      { code: 'KHR', rate: 4100, enabled: true, symbol: '៛', decimals: 0 },
      { code: 'THB', rate: 36.4, enabled: false, symbol: '฿', decimals: 2 },
      { code: 'JPY', rate: 157, enabled: false, symbol: '¥', decimals: 0 },
    ],
    locale: 'en-US',
    timezone: 'America/Los_Angeles',
    dateFormat: 'MMM d, yyyy',
    timeFormat: '12h',
    numberFormat: 'comma_dot',
    measurement: 'imperial',

    // Tax, service, rounding
    taxLabel: 'Sales tax',
    taxPct: 0.0875,
    pricesIncludeTax: false,
    servicePct: 0,
    serviceLabel: 'Service charge',
    serviceTaxable: true,
    rounding: 'none',

    // Document numbering
    numbering: {
      invoice: { prefix: 'INV', next: 1041, pad: 5, includeYear: true, includeLocation: false },
      receipt: { prefix: 'RCT', next: 5820, pad: 5, includeYear: true, includeLocation: false },
      ticket: { prefix: 'TKT', next: 1, pad: 4, includeYear: false, includeLocation: true },
      report: { prefix: 'RPT', next: 218, pad: 4, includeYear: true, includeLocation: false },
      purchase: { prefix: 'PO', next: 101, pad: 4, includeYear: true, includeLocation: false },
    },

    // Stock policy
    stock: {
      valuationMethod: 'last_cost',
      reorderPolicy: 'par',
      auto86OnZero: true,
      allowNegativeStock: false,
      safetyStockDays: 2,
      cycleCountDays: 7,
      wasteApprovalAbove: 50,
      expiryWarnDays: 3,
      defaultUnit: 'each',
      storageLocations: ['dry', 'walk_in', 'freezer', 'bar'],
      requireCountReason: true,
      autoReceiveThousandths: 3,
    },

    // POS + service rules
    pos: {
      tipsEnabled: true,
      tipPresets: [0.15, 0.18, 0.2, 0.25],
      autoGratuityPct: 0.18,
      autoGratuityPartySize: 6,
      allowSplit: true,
      allowDiscounts: true,
      requireManagerVoid: true,
      guestQrOrdering: true,
      printTicketCopies: 1,
      printerReceipt: '',
      printerKitchen: '',
    },

    // Booking & table modification rules
    booking: {
      allowGuestTableChange: true,
      allowGuestReschedule: true,
      rescheduleCutoffMinutes: 60,
      defaultBookingDurationMinutes: 90,
      maxGuestReschedules: 2,
    },

    // Units of measure: the vocabulary the owner maintains (label, short
    // label, family, factor) plus the pack labels offered when packaging an
    // item, so "package / bottle / size" are data rather than code.
    units: {
      list: DEFAULT_UNITS.map((unit) => ({ ...unit })),
      packNames: DEFAULT_PACK_NAMES.slice(),
      defaultStockUnit: 'each',
      defaultPurchaseUnit: 'case',
      convertOnReceive: true,
      showPackBreakdown: true,
    },

    // Food: what the menu is made of and how it is sold. Lists are
    // editable in Settings; items reference them by name.
    food: {
      dietaryTags: [...DEFAULT_DIETARY_TAGS],
      allergens: [...DEFAULT_ALLERGENS],
      courses: [...DEFAULT_COURSES],
      stations: [...FOOD_STATIONS],
      menuWindows: DEFAULT_MENU_WINDOWS.map((window) => ({ ...window })),
      showImages: true,
      imagesOnGuestMenu: true,
      imagesInPrint: false,
      imageMaxKb: 180,
      allergenAlerts: true,
      auto86MissingIngredient: true,
      defaultCourse: 'Main',
      childrenMenu: false,
      spiceLevels: ['Mild', 'Medium', 'Hot'],
    },

    // Documents
    templates: defaultTemplates(),
    documentCurrency: 'base',
    footerNote: 'Thank you for supporting a small kitchen.',

    // Shift targets (read by KDS / dashboard / reports)
    targetTurnMinutes: 45,
    ticketMinutes: 18,
    foodCostCap: 0.32,
    rushHour: 18,

    // Telegram: the chat the bot talks to, and which events are worth a
    // message. The token is an environment secret, never state.
    telegram: {
      chatId: '',
      notifyOrders: true,
      notify86: true,
      notifyLowStock: true,
      notifyPurchases: true,
      notifyDailyDigest: false,
      digestHour: 22,
      welcome: 'Restora is watching the floor with you.',
    },

    notifications: {
      lowStock: true,
      lateTickets: true,
      guestRequests: true,
      negativeMargin: true,
      dailyDigest: true,
      digestTime: '09:00',
      channel: 'in_app',
      webhookUrl: '',
      recipients: '',
    },

    updatedAt: null,
    updatedBy: null,
  }
}

// ─── Sanitizers ────────────────────────────────────────────────────

const clampText = (value, max) => String(value ?? '').trim().slice(0, max)
const clampNumber = (value, min, max, fallback = 0) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const clampRatio = (value, fallback = 0) => clampNumber(value, 0, 1, fallback)

/** Service windows: 06:00–11:00 style, de-duplicated, at most 6. */
export function sanitizeMenuWindows(value, fallback) {
  const list = Array.isArray(value) ? value : []
  const time = (input, alt) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input)) ? String(input) : alt)
  const out = []
  for (const entry of list.slice(0, 6)) {
    const id = String(entry?.id || entry?.label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)
    const label = String(entry?.label || '').trim().slice(0, 24)
    if (!id || !label) continue
    if (out.some((window) => window.id === id)) continue
    out.push({ id, label, from: time(entry?.from, '06:00'), to: time(entry?.to, '23:00'), enabled: entry?.enabled === true })
  }
  return out.length ? out : fallback.map((window) => ({ ...window }))
}

export function sanitizeTemplate(raw, kind) {
  const base = defaultTemplates()[kind] || defaultTemplates().invoice
  const merged = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) }
  const bools = Object.fromEntries(
    Object.keys(base)
      .filter((key) => typeof base[key] === 'boolean')
      .map((key) => [key, merged[key] !== false]),
  )
  // Boolean flags that default to false must stay false unless explicitly true.
  for (const key of Object.keys(bools)) {
    if (base[key] === false) bools[key] = merged[key] === true
  }
  const paper = PAPER_SIZES[merged.paper] ? merged.paper : base.paper
  return {
    ...base,
    ...bools,
    name: clampText(merged.name, 48) || base.name,
    paper,
    title: (clampText(merged.title, 32) || base.title).toUpperCase(),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(merged.accent || '')) ? String(merged.accent) : base.accent,
    fontScale: clampNumber(merged.fontScale, 0.8, 1.6, 1),
    currency: sanitizeCurrencyChoice(merged.currency),
    headerText: clampText(merged.headerText, 240),
    footerText: clampText(merged.footerText, 240),
    termsText: clampText(merged.termsText, 240),
    thankYou: clampText(merged.thankYou, 160),
    bankDetails: clampText(merged.bankDetails, 200),
    signatureLabel: clampText(merged.signatureLabel, 40),
    copies: Math.trunc(clampNumber(merged.copies, 1, 4, 1)),
  }
}

function sanitizeCurrencyChoice(value) {
  const code = String(value || 'base').trim()
  if (code === 'base') return 'base'
  const upper = code.toUpperCase()
  return CURRENCY_CODES.includes(upper) ? upper : upper.slice(0, 6)
}

function sanitizeLogoUrl(value) {
  const url = String(value ?? '').trim().slice(0, 400000)
  if (!url) return ''
  if (url.startsWith('data:image/')) return url
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) ? url : ''
  } catch {
    return ''
  }
}

function sanitizeNumbering(raw, base) {
  const out = {}
  for (const kind of DOC_KINDS) {
    const source = raw?.[kind] || {}
    const fallback = base.numbering[kind]
    out[kind] = {
      prefix: (clampText(source.prefix, 8) || fallback.prefix).replace(/[^A-Za-z0-9-]/g, '') || fallback.prefix,
      next: Math.trunc(clampNumber(source.next, 1, 999999999, fallback.next)),
      pad: Math.trunc(clampNumber(source.pad, 1, 10, fallback.pad)),
      includeYear: source.includeYear === undefined ? fallback.includeYear : source.includeYear !== false,
      includeLocation: source.includeLocation === undefined ? fallback.includeLocation : source.includeLocation === true,
    }
  }
  return out
}

function sanitizeStrings(list, allowed, fallback) {
  if (!Array.isArray(list)) return fallback
  const out = [...new Set(list.map((entry) => String(entry ?? '').trim()).filter((entry) => entry && allowed.includes(entry)))]
  return out.length ? out.slice(0, 12) : fallback
}

/** Coerce any stored/patched settings object into a safe, complete one. */
export function sanitizeSettings(raw, locationLabel = 'Downtown') {
  const base = defaultSettings(locationLabel)
  const source = raw && typeof raw === 'object' ? raw : {}

  const baseCurrency = String(source.baseCurrency || source.currency || base.baseCurrency).toUpperCase().slice(0, 6)
  const currencies = (Array.isArray(source.currencies) ? source.currencies : base.currencies)
    .map((entry) => {
      const code = String(entry?.code || '').toUpperCase().slice(0, 6)
      if (!code || code === baseCurrency) return null
      const meta = currencyMeta(code)
      const rate = Number(entry?.rate)
      return {
        code,
        name: clampText(entry?.name, 40) || meta.name,
        symbol: clampText(entry?.symbol, 6) || meta.symbol,
        decimals: Math.trunc(clampNumber(entry?.decimals, 0, 4, meta.decimals)),
        symbolPosition: entry?.symbolPosition === 'after' ? 'after' : 'before',
        space: entry?.space === true,
        rate: Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1e6) / 1e6 : 1,
        enabled: entry?.enabled !== false,
        updatedAt: entry?.updatedAt || null,
      }
    })
    .filter(Boolean)
    .slice(0, 12)

  const tipPresets = (Array.isArray(source.pos?.tipPresets) ? source.pos.tipPresets : base.pos.tipPresets)
    .map((value) => clampRatio(value, 0))
    .filter((value) => value > 0 && value <= 0.5)
    .slice(0, 6)

  const storageSpaces = sanitizeStrings(
    source.stock?.storageLocations,
    STORAGE_LOCATIONS.map((entry) => entry.id),
    base.stock.storageLocations,
  )

  // Units are the vocabulary every other unit field points at, so they are
  // resolved before stock, packaging, and the item sanitizers.
  const unitList = sanitizeUnitList(source.units?.list)
  const unitIds = unitList.map((unit) => unit.id)
  const pickUnit = (value, fallback) => (unitIds.includes(slugUnitId(value)) ? slugUnitId(value) : fallback)

  return {
    ...base,
    restaurantName: clampText(source.restaurantName, 80) || base.restaurantName,
    legalName: clampText(source.legalName, 80),
    tagline: clampText(source.tagline, 120),
    description: clampText(source.description, 400),
    logoUrl: sanitizeLogoUrl(source.logoUrl),
    logoInitials: (clampText(source.logoInitials, 4) || base.logoInitials).toUpperCase(),
    brandColor: /^#[0-9a-fA-F]{6}$/.test(String(source.brandColor || '')) ? String(source.brandColor) : base.brandColor,
    addressLine1: clampText(source.addressLine1, 80),
    addressLine2: clampText(source.addressLine2, 80),
    city: clampText(source.city, 48),
    state: clampText(source.state, 48),
    postalCode: clampText(source.postalCode, 16),
    country: clampText(source.country, 48),
    phone: clampText(source.phone, 32),
    email: clampText(source.email, 80),
    website: clampText(source.website, 80),
    taxId: clampText(source.taxId, 40),
    operatingMode: ['demo', 'production'].includes(source.operatingMode)
      ? source.operatingMode
      : (base.operatingMode || 'demo'),

    baseCurrency,
    currency: baseCurrency,
    currencies,
    locale: clampText(source.locale, 12) || base.locale,
    timezone: clampText(source.timezone, 48) || base.timezone,
    dateFormat: ['MMM d, yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'].includes(source.dateFormat)
      ? source.dateFormat
      : base.dateFormat,
    timeFormat: source.timeFormat === '24h' ? '24h' : '12h',
    numberFormat: ['comma_dot', 'dot_comma', 'space_comma'].includes(source.numberFormat)
      ? source.numberFormat
      : base.numberFormat,
    measurement: source.measurement === 'metric' ? 'metric' : 'imperial',

    taxLabel: clampText(source.taxLabel, 32) || base.taxLabel,
    taxPct: clampRatio(source.taxPct, base.taxPct),
    pricesIncludeTax: source.pricesIncludeTax === true,
    servicePct: clampRatio(source.servicePct, 0),
    serviceLabel: clampText(source.serviceLabel, 32) || base.serviceLabel,
    serviceTaxable: source.serviceTaxable !== false,
    rounding: ['none', 'nearest_005', 'nearest_whole'].includes(source.rounding) ? source.rounding : 'none',

    numbering: sanitizeNumbering(source.numbering, base),

    stock: {
      valuationMethod: VALUATION_METHODS.some((m) => m.id === source.stock?.valuationMethod)
        ? source.stock.valuationMethod
        : base.stock.valuationMethod,
      reorderPolicy: REORDER_POLICIES.some((p) => p.id === source.stock?.reorderPolicy)
        ? source.stock.reorderPolicy
        : base.stock.reorderPolicy,
      auto86OnZero: source.stock?.auto86OnZero !== false,
      allowNegativeStock: source.stock?.allowNegativeStock === true,
      safetyStockDays: clampNumber(source.stock?.safetyStockDays, 0, 30, base.stock.safetyStockDays),
      cycleCountDays: Math.trunc(clampNumber(source.stock?.cycleCountDays, 1, 90, base.stock.cycleCountDays)),
      wasteApprovalAbove: clampNumber(source.stock?.wasteApprovalAbove, 0, 100000, base.stock.wasteApprovalAbove),
      expiryWarnDays: Math.trunc(clampNumber(source.stock?.expiryWarnDays, 0, 60, base.stock.expiryWarnDays)),
      // An explicit stock default wins; otherwise the stock unit follows the
      // vocabulary's own default so the two never disagree.
      defaultUnit: pickUnit(
        source.stock?.defaultUnit || source.units?.defaultStockUnit || base.units.defaultStockUnit,
        unitIds[0],
      ),
      storageLocations: storageSpaces,
      requireCountReason: source.stock?.requireCountReason !== false,
      autoReceiveThousandths: Math.trunc(clampNumber(source.stock?.autoReceiveThousandths, 0, 4, base.stock.autoReceiveThousandths)),
    },

    units: {
      list: unitList,
      packNames: sanitizePackNames(source.units?.packNames),
      defaultStockUnit: pickUnit(source.units?.defaultStockUnit, unitIds[0]),
      defaultPurchaseUnit: slugUnitId(source.units?.defaultPurchaseUnit) || base.units.defaultPurchaseUnit,
      convertOnReceive: source.units?.convertOnReceive !== false,
      showPackBreakdown: source.units?.showPackBreakdown !== false,
    },

    food: {
      dietaryTags: sanitizeLabelList(source.food?.dietaryTags?.length ? source.food.dietaryTags : base.food.dietaryTags),
      allergens: sanitizeLabelList(source.food?.allergens?.length ? source.food.allergens : base.food.allergens),
      courses: sanitizeLabelList(source.food?.courses?.length ? source.food.courses : base.food.courses, 12, 24),
      stations: sanitizeLabelList(source.food?.stations?.length ? source.food.stations : base.food.stations, 12, 24)
        .map((station) => station.toLowerCase()),
      menuWindows: sanitizeMenuWindows(source.food?.menuWindows, base.food.menuWindows),
      showImages: source.food?.showImages !== false,
      imagesOnGuestMenu: source.food?.imagesOnGuestMenu !== false,
      imagesInPrint: source.food?.imagesInPrint === true,
      imageMaxKb: Math.trunc(clampNumber(source.food?.imageMaxKb, 20, 600, base.food.imageMaxKb)),
      allergenAlerts: source.food?.allergenAlerts !== false,
      auto86MissingIngredient: source.food?.auto86MissingIngredient !== false,
      defaultCourse: sanitizeLabelList([source.food?.defaultCourse], 1, 24)[0] || base.food.defaultCourse,
      childrenMenu: source.food?.childrenMenu === true,
      spiceLevels: sanitizeLabelList(source.food?.spiceLevels?.length ? source.food.spiceLevels : base.food.spiceLevels, 8, 20),
    },

    pos: {
      tipsEnabled: source.pos?.tipsEnabled !== false,
      tipPresets: tipPresets.length ? tipPresets : base.pos.tipPresets,
      autoGratuityPct: clampRatio(source.pos?.autoGratuityPct, base.pos.autoGratuityPct),
      autoGratuityPartySize: Math.trunc(clampNumber(source.pos?.autoGratuityPartySize, 1, 40, base.pos.autoGratuityPartySize)),
      allowSplit: source.pos?.allowSplit !== false,
      allowDiscounts: source.pos?.allowDiscounts !== false,
      requireManagerVoid: source.pos?.requireManagerVoid !== false,
      guestQrOrdering: source.pos?.guestQrOrdering !== false,
      printTicketCopies: Math.trunc(clampNumber(source.pos?.printTicketCopies, 1, 4, 1)),
      printerReceipt: clampText(source.pos?.printerReceipt, 60),
      printerKitchen: clampText(source.pos?.printerKitchen, 60),
    },

    booking: {
      allowGuestTableChange: source.booking?.allowGuestTableChange !== false,
      allowGuestReschedule: source.booking?.allowGuestReschedule !== false,
      rescheduleCutoffMinutes: Math.trunc(clampNumber(source.booking?.rescheduleCutoffMinutes, 0, 1440, base.booking.rescheduleCutoffMinutes)),
      defaultBookingDurationMinutes: Math.trunc(clampNumber(source.booking?.defaultBookingDurationMinutes, 15, 360, base.booking.defaultBookingDurationMinutes)),
      maxGuestReschedules: Math.trunc(clampNumber(source.booking?.maxGuestReschedules, 1, 10, base.booking.maxGuestReschedules)),
    },

    templates: Object.fromEntries(DOC_KINDS.map((kind) => [kind, sanitizeTemplate(source.templates?.[kind], kind)])),
    documentCurrency: sanitizeCurrencyChoice(source.documentCurrency),
    footerNote: clampText(source.footerNote, 240),

    targetTurnMinutes: Math.trunc(clampNumber(source.targetTurnMinutes, 10, 240, base.targetTurnMinutes)),
    ticketMinutes: Math.trunc(clampNumber(source.ticketMinutes, 2, 90, base.ticketMinutes)),
    foodCostCap: clampRatio(source.foodCostCap, base.foodCostCap),
    rushHour: Math.trunc(clampNumber(source.rushHour, 0, 23, base.rushHour)),

    telegram: {
      chatId: clampText(source.telegram?.chatId, 40),
      notifyOrders: source.telegram?.notifyOrders !== false,
      notify86: source.telegram?.notify86 !== false,
      notifyLowStock: source.telegram?.notifyLowStock !== false,
      notifyPurchases: source.telegram?.notifyPurchases !== false,
      notifyDailyDigest: source.telegram?.notifyDailyDigest === true,
      digestHour: Math.trunc(clampNumber(source.telegram?.digestHour, 0, 23, base.telegram.digestHour)),
      welcome: clampText(source.telegram?.welcome, 160) || base.telegram.welcome,
    },

    notifications: {
      lowStock: source.notifications?.lowStock !== false,
      lateTickets: source.notifications?.lateTickets !== false,
      guestRequests: source.notifications?.guestRequests !== false,
      negativeMargin: source.notifications?.negativeMargin !== false,
      dailyDigest: source.notifications?.dailyDigest !== false,
      digestTime: /^\d{2}:\d{2}$/.test(String(source.notifications?.digestTime || ''))
        ? source.notifications.digestTime
        : base.notifications.digestTime,
      channel: NOTIFICATION_CHANNELS.includes(source.notifications?.channel)
        ? source.notifications.channel
        : base.notifications.channel,
      webhookUrl: clampText(source.notifications?.webhookUrl, 200),
      recipients: clampText(source.notifications?.recipients, 200),
    },

    updatedAt: source.updatedAt || null,
    updatedBy: clampText(source.updatedBy, 40) || null,
  }
}

// ─── Document numbering ────────────────────────────────────────────

/**
 * Build the next human-facing document number.
 * Examples: INV-2026-01041 · RCT-2026-05820 · TKT-DT-0007 · RPT-2026-00218
 */
export function documentNumber(settings, kind, seq, at = new Date()) {
  const counter = settings?.numbering?.[kind] || defaultSettings().numbering[kind] || { prefix: 'DOC', pad: 4 }
  const year = new Date(at).getFullYear()
  const parts = [counter.prefix]
  if (counter.includeYear) parts.push(String(year))
  if (counter.includeLocation && settings?.locationShort) parts.push(String(settings.locationShort).toUpperCase().slice(0, 4))
  parts.push(String(Math.max(1, Math.trunc(seq))).padStart(counter.pad, '0'))
  return parts.join('-')
}

// ─── Catalog helpers: categories (with sub-categories) ─────────────

export const CATEGORY_KINDS = [
  { id: 'menu', label: 'Menu' },
  { id: 'inventory', label: 'Inventory' },
]

export function categoryTree(categories, kind = 'menu') {
  const list = (categories || [])
    .filter((category) => (category.kind || 'menu') === kind)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
  const roots = list.filter((category) => !category.parentId)
  const childrenOf = (id) => list.filter((category) => category.parentId === id)
  return roots.map((root) => ({ ...root, children: childrenOf(root.id) }))
}

export function categoryOptions(categories, kind = 'menu') {
  return categoryTree(categories, kind).flatMap((root) => [
    { id: root.id, name: root.name, depth: 0 },
    ...root.children.map((child) => ({ id: child.id, name: child.name, depth: 1, parentName: root.name })),
  ])
}

export function categoryById(categories, id) {
  return (categories || []).find((category) => category.id === id) || null
}

export function descendantCategoryIds(categories, id) {
  const ids = [id]
  const walk = (parentId) => {
    for (const category of categories || []) {
      if (category.parentId === parentId) {
        ids.push(category.id)
        walk(category.id)
      }
    }
  }
  walk(id)
  return ids
}

/** Menu items that reference a category (or any of its sub-categories). */
export function itemsInCategory(menu, categories, categoryId) {
  const ids = descendantCategoryIds(categories || [], categoryId)
  const names = new Set(
    ids.map((id) => categoryById(categories, id)?.name?.toLowerCase()).filter(Boolean),
  )
  return (menu || []).filter((item) => {
    const c = String(item.category || '').toLowerCase()
    const sc = String(item.subCategory || '').toLowerCase()
    return names.has(c) || names.has(sc)
  })
}

/** Total item count for a category, summing itself and all descendant sub-categories. */
export function categoryTotalCount(categories = [], categoryId, items = [], _kind = 'menu') {
  const ids = descendantCategoryIds(categories, categoryId)
  const names = new Set(ids.map((id) => categoryById(categories, id)?.name?.toLowerCase()).filter(Boolean))
  return (items || []).filter((item) => {
    const c = String(item.category || '').toLowerCase()
    const sc = String(item.subCategory || '').toLowerCase()
    return names.has(c) || names.has(sc)
  }).length
}

/**
 * Hierarchical grouping of menu items by category tree (parent -> sub).
 * Returns array of root groups:
 * [
 *   {
 *     category: rootNode,
 *     directItems: [...],
 *     children: [
 *       { category: childNode, items: [...] }
 *     ],
 *     allItems: [...],
 *     totalCount: number
 *   }
 * ]
 * plus any uncategorized items.
 */
export function groupMenuByCategories(menu = [], categories = []) {
  const tree = categoryTree(categories, 'menu')
  const matchedItemIds = new Set()

  const groups = tree.map((root) => {
    const childGroups = (root.children || []).map((child) => {
      const items = (menu || []).filter((item) => {
        const matchesCat = String(item.category || '').toLowerCase() === root.name.toLowerCase()
        const matchesSub = String(item.subCategory || '').toLowerCase() === child.name.toLowerCase()
        return (matchesCat && matchesSub) || (!item.subCategory && String(item.category || '').toLowerCase() === child.name.toLowerCase())
      })
      items.forEach((item) => matchedItemIds.add(item.id))
      return { category: child, items }
    })

    const directItems = (menu || []).filter((item) => {
      if (matchedItemIds.has(item.id)) return false
      const matchesCat = String(item.category || '').toLowerCase() === root.name.toLowerCase()
      return matchesCat
    })
    directItems.forEach((item) => matchedItemIds.add(item.id))

    const allItems = [...directItems, ...childGroups.flatMap((cg) => cg.items)]
    return {
      category: root,
      directItems,
      children: childGroups,
      allItems,
      totalCount: allItems.length,
    }
  })

  const uncategorized = (menu || []).filter((item) => !matchedItemIds.has(item.id))
  return { groups, uncategorized }
}

/** "Mains › Pasta" — the display path for an item's category and sub-category. */
export function categoryPath(item) {
  const parts = [item?.category, item?.subCategory].map((part) => String(part || '').trim()).filter(Boolean)
  return parts.length ? parts.join(' › ') : 'Uncategorized'
}

// ─── Supplier helpers ──────────────────────────────────────────────

export function sanitizeSupplier(raw, existingIds = []) {
  const id = clampText(raw?.id, 60).replace(/[^A-Za-z0-9_-]/g, '')
  return {
    id: id || `sup_${Math.random().toString(36).slice(2, 8)}`,
    name: clampText(raw?.name, 60) || 'New supplier',
    contactName: clampText(raw?.contactName, 60),
    contactRole: clampText(raw?.contactRole, 40),
    email: clampText(raw?.email, 80),
    phone: clampText(raw?.phone, 32),
    website: clampText(raw?.website, 80),
    addressLine1: clampText(raw?.addressLine1, 80),
    addressLine2: clampText(raw?.addressLine2, 80),
    city: clampText(raw?.city, 48),
    state: clampText(raw?.state, 48),
    postalCode: clampText(raw?.postalCode, 16),
    country: clampText(raw?.country, 48),
    taxId: clampText(raw?.taxId, 40),
    paymentTerms: PAYMENT_TERMS.some((term) => term.id === raw?.paymentTerms) ? raw.paymentTerms : 'net_30',
    leadTimeDays: Math.trunc(clampNumber(raw?.leadTimeDays, 0, 120, 2)),
    minOrderValue: clampNumber(raw?.minOrderValue, 0, 1000000, 0),
    currency: String(raw?.currency || '').toUpperCase().slice(0, 6),
    deliveryDays: Array.isArray(raw?.deliveryDays)
      ? [...new Set(raw.deliveryDays.map((day) => clampText(day, 3).toUpperCase()).filter((day) => /^[A-Z]{3}$/.test(day)))].slice(0, 7)
      : [],
    categories: Array.isArray(raw?.categories)
      ? [...new Set(raw.categories.map((entry) => clampText(entry, 32)).filter(Boolean))].slice(0, 8)
      : [],
    status: SUPPLIER_STATUSES.includes(raw?.status) ? raw.status : 'active',
    rating: Math.trunc(clampNumber(raw?.rating, 0, 5, 0)),
    notes: clampText(raw?.notes, 400),
    accountNumber: clampText(raw?.accountNumber, 40),
    createdAt: raw?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _existing: existingIds.includes(id),
  }
}

export function paymentTermsLabel(id) {
  return PAYMENT_TERMS.find((term) => term.id === id)?.label || 'Net 30'
}

// ─── Readiness audit ───────────────────────────────────────────────
// The Settings screen uses this to show "what still needs attention"
// before a store goes live with printed documents.

export function configurationAudit(shop) {
  const settings = shop?.settings || {}
  const checks = [
    {
      id: 'identity',
      label: 'Business identity complete',
      ok: Boolean(settings.restaurantName && settings.addressLine1 && (settings.phone || settings.email)),
      fix: 'Add the legal name, street address, and a phone or email.',
      section: 'business',
    },
    {
      id: 'logo',
      label: 'Logo uploaded or initials set',
      ok: Boolean(settings.logoUrl || settings.logoInitials),
      fix: 'Upload a logo (PNG/SVG under ~300KB) or keep the initials monogram.',
      section: 'business',
    },
    {
      id: 'tax',
      label: 'Tax and tax ID configured',
      ok: Number(settings.taxPct) >= 0 && Boolean(settings.taxId),
      fix: 'Set the tax rate and the tax registration number printed on invoices.',
      section: 'money',
    },
    {
      id: 'currencies',
      label: 'Currency table has a rate for every enabled currency',
      ok: (settings.currencies || []).filter((c) => c.enabled).every((c) => Number(c.rate) > 0),
      fix: 'Every enabled currency needs a rate greater than zero.',
      section: 'money',
    },
    {
      id: 'numbering',
      label: 'Document numbering defined for all four documents',
      ok: DOC_KINDS.every((kind) => settings.numbering?.[kind]?.prefix && settings.numbering?.[kind]?.next >= 1),
      fix: 'Give invoices, receipts, tickets, and reports a prefix and starting number.',
      section: 'documents',
    },
    {
      id: 'templates',
      label: 'Templates picked for all four documents',
      ok: DOC_KINDS.every((kind) => settings.templates?.[kind]?.paper && settings.templates?.[kind]?.title),
      fix: 'Choose a paper size and title for each document template.',
      section: 'documents',
    },
    {
      id: 'suppliers',
      label: 'At least one active supplier',
      ok: (shop?.suppliers || []).some((supplier) => supplier.status === 'active'),
      fix: 'Add the vendors you order from so receiving and reorder lists work.',
      section: 'catalog',
    },
    {
      id: 'categories',
      label: 'Menu has categories with sub-categories',
      ok: (shop?.categories || []).some((category) => category.kind === 'menu' && !category.parentId)
        && (shop?.categories || []).some((category) => category.kind === 'menu' && category.parentId),
      fix: 'Split the menu into categories and at least one sub-category (e.g. Mains › Pasta).',
      section: 'catalog',
    },
    {
      id: 'stock',
      label: 'Stock policy chosen (valuation + reorder)',
      ok: Boolean(settings.stock?.valuationMethod && settings.stock?.reorderPolicy),
      fix: 'Pick how plate cost is valued and when reorder alerts fire.',
      section: 'stock',
    },
    {
      id: 'units',
      label: 'Units of measure defined and used by every stock item',
      ok: (settings.units?.list || []).length >= 3
        && (settings.units?.list || []).some((unit) => unit.family === 'weight' || unit.family === 'volume')
        && (shop?.inventory || []).every((item) => (settings.units?.list || []).some((unit) => unit.id === item.unit)),
      fix: 'Add the units you buy in (kg, ml, bottle, …) and give every stock item one of them.',
      section: 'stock',
    },
    {
      id: 'packaging',
      label: 'Packaging set on the items bought in packs',
      ok: (() => {
        const packed = (shop?.inventory || []).filter((item) => item.purchaseUnit || (item.packs || []).length)
        return packed.length > 0
          && packed.every((item) => (item.packs || []).length
            && (item.packs || []).every((pack) => Number(pack.qty) > 0)
            && (!item.purchaseUnit || (item.packs || []).some((pack) => pack.id === item.purchaseUnit)))
      })(),
      fix: 'Tell the app what a case or a bottle holds, so a purchase becomes the right amount of stock.',
      section: 'stock',
    },
    {
      id: 'telegram',
      label: 'Telegram bot has a chat to talk to',
      ok: Boolean(settings.telegram?.chatId)
        || Object.values(settings.telegram || {}).some((value) => value === true),
      fix: 'Add the chat id the bot should report to (Settings → Telegram & Mini App).',
      section: 'channels',
    },
    {
      id: 'stations',
      label: 'Every menu item has a kitchen station',
      ok: (shop?.menu || []).every((item) => STATIONS.includes(item.station)),
      fix: 'Route each dish to grill, sauté, pantry, dessert, or expo.',
      section: 'catalog',
    },
    {
      id: 'food',
      label: 'Food vocabulary and guest-facing detail configured',
      ok: Boolean(settings.food?.dietaryTags?.length
        && settings.food?.allergens?.length
        && settings.food?.courses?.length
        && settings.food?.menuWindows?.length
        && (shop?.menu || []).every((item) => item.dietaryTags && item.allergens)),
      fix: 'Keep the dietary tag, allergen, and course lists populated so items can be tagged.',
      section: 'food',
    },
    {
      id: 'itemmedia',
      label: 'Menu items have photos and courses',
      ok: (shop?.menu || []).some((item) => item.imageUrl)
        && (shop?.menu || []).every((item) => Boolean(item.course)),
      fix: 'Add a photo and a course to each dish — the guest menu and ticket order read both.',
      section: 'catalog',
    },
  ]
  const done = checks.filter((check) => check.ok).length
  return { checks, done, total: checks.length, ready: done === checks.length }
}
