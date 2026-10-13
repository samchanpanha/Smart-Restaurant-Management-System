// ─── Restora multi-currency ────────────────────────────────────────
// Money is stored as a plain number in the location's BASE currency.
// Every other currency carries a `rate` = how many units of that
// currency one base unit buys (rate 1 for the base itself), so a
// document can be issued in any configured currency without ever
// rewriting stored prices.
//
// `money(n)` in models.js formats with the ACTIVE currency, which the
// store re-configures whenever a location's settings change — so every
// existing screen picks up the configured symbol with no changes.

export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US', decimals: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'de-DE', decimals: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB', decimals: 2 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP', decimals: 0 },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese Yuan', locale: 'zh-CN', decimals: 2 },
  { code: 'KHR', symbol: '៛', name: 'Cambodian Riel', locale: 'km-KH', decimals: 0 },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', locale: 'th-TH', decimals: 2 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', locale: 'vi-VN', decimals: 0 },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', locale: 'id-ID', decimals: 0 },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', locale: 'ms-MY', decimals: 2 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG', decimals: 2 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU', decimals: 2 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA', decimals: 2 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN', decimals: 2 },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', locale: 'ko-KR', decimals: 0 },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', locale: 'ar-AE', decimals: 2 },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', locale: 'de-CH', decimals: 2 },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', locale: 'es-MX', decimals: 2 },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', locale: 'pt-BR', decimals: 2 },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', locale: 'en-PH', decimals: 2 },
]

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code)

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

/** Currency metadata for a code; unknown codes degrade to a readable label. */
export function currencyMeta(code) {
  const key = String(code || '').trim().toUpperCase()
  const known = BY_CODE.get(key)
  if (known) return { ...known, symbolPosition: 'before', space: false, rate: 1 }
  const text = key || 'USD'
  return {
    code: text,
    symbol: text.length === 3 ? text : `${text} `,
    name: text,
    locale: 'en-US',
    decimals: 2,
    symbolPosition: 'before',
    space: !/^[A-Z]{3}$/.test(text),
    rate: 1,
  }
}

/** The currency config a set of settings displays money in. */
export function baseCurrencyConfig(settings) {
  const code = String(settings?.baseCurrency || settings?.currency || 'USD').toUpperCase()
  const meta = currencyMeta(code)
  const configured = (settings?.currencies || []).find(
    (entry) => String(entry?.code || '').toUpperCase() === code,
  )
  return {
    ...meta,
    ...pickCurrencyOverrides(configured),
    code,
    rate: 1,
    base: true,
  }
}

function pickCurrencyOverrides(entry) {
  if (!entry) return {}
  const out = {}
  if (entry.symbol) out.symbol = String(entry.symbol).slice(0, 6)
  if (Number.isFinite(Number(entry.decimals))) out.decimals = clampDecimals(entry.decimals)
  if (entry.symbolPosition === 'after') out.symbolPosition = 'after'
  if (typeof entry.space === 'boolean') out.space = entry.space
  return out
}

function clampDecimals(value) {
  return Math.max(0, Math.min(4, Math.trunc(Number(value) || 0)))
}

/** Enabled, normalized currency table: base first, then rates high → low. */
export function currencyTable(settings) {
  const base = baseCurrencyConfig(settings)
  const rows = (settings?.currencies || [])
    .map((entry) => normalizeCurrencyEntry(entry, base.code))
    .filter(Boolean)
  const seen = new Set([base.code])
  const out = [base]
  for (const row of rows) {
    if (seen.has(row.code)) continue
    seen.add(row.code)
    out.push(row)
  }
  return out
}

/** Normalize one editable currency row (`{code, rate, enabled, …}`). */
export function normalizeCurrencyEntry(entry, baseCode = 'USD') {
  const code = String(entry?.code || '').trim().toUpperCase().slice(0, 6)
  if (!code || code === baseCode) return null
  const meta = currencyMeta(code)
  const rate = Number(entry?.rate)
  return {
    ...meta,
    ...pickCurrencyOverrides(entry),
    code,
    rate: Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1e6) / 1e6 : 1,
    enabled: entry?.enabled !== false,
    updatedAt: entry?.updatedAt || null,
  }
}

/** Look up one currency (base or configured) from settings. */
export function currencyConfig(settings, code) {
  const key = String(code || '').trim().toUpperCase()
  const table = currencyTable(settings)
  if (!key || key === 'base') return table[0]
  return table.find((row) => row.code === key) || table[0]
}

/**
 * Convert an amount between currencies using rate = units per base unit.
 * `settings.currencies` is the live table; the base currency converts at 1.
 */
export function convertAmount(amount, from, to, settings) {
  const value = Number(amount) || 0
  const source = currencyConfig(settings, from)
  const target = currencyConfig(settings, to)
  if (source.code === target.code) return value
  const inBase = value / (source.rate || 1)
  return inBase * (target.rate || 1)
}

export function roundMoney(value, decimals = 2) {
  const factor = 10 ** clampDecimals(decimals)
  return Math.round((Number(value) || 0) * factor) / factor
}

// ─── Formatting ────────────────────────────────────────────────────

let ACTIVE = currencyMeta('USD')

/** Store calls this whenever the active location's settings change. */
export function setActiveCurrency(config) {
  ACTIVE = { ...currencyMeta(config?.code || 'USD'), ...config }
  return ACTIVE
}

export function activeCurrency() {
  return ACTIVE
}

function groupDigits(text, thousands = ',') {
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, thousands)
}

/** Format a number in a currency; `currency` may be a code, row, or config. */
export function formatMoney(amount, currency) {
  const cfg = !currency
    ? ACTIVE
    : typeof currency === 'string'
      ? { ...currencyMeta(currency) }
      : currency
  const decimals = clampDecimals(cfg.decimals ?? 2)
  const value = Number(amount) || 0
  const negative = value < 0
  const fixed = Math.abs(value).toFixed(decimals)
  const [whole, fraction] = fixed.split('.')
  const number = groupDigits(whole, cfg.thousands || ',') + (fraction ? `.${fraction}` : '')
  const symbol = cfg.symbol ?? currencyMeta(cfg.code).symbol
  const gap = cfg.space ? ' ' : ''
  const body = cfg.symbolPosition === 'after' ? `${number}${gap}${symbol}` : `${symbol}${gap}${number}`
  return negative ? `-${body}` : body
}

/** Plain number without symbol — reports, CSV, exports. */
export function formatNumber(amount, decimals = 2) {
  const value = Number(amount) || 0
  return `${groupDigits(value.toFixed(clampDecimals(decimals)), ',')}`
}

/**
 * Round a bill total per the location's rounding rule.
 * Returns `{ total, adjustment }` so the receipt can print the rounding line.
 */
export function applyRounding(total, rule = 'none') {
  const value = Number(total) || 0
  if (rule === 'nearest_005') {
    const rounded = Math.round(value * 20) / 20
    return { total: rounded, adjustment: roundMoney(rounded - value, 4) }
  }
  if (rule === 'nearest_whole') {
    const rounded = Math.round(value)
    return { total: rounded, adjustment: roundMoney(rounded - value, 4) }
  }
  return { total: roundMoney(value, 4), adjustment: 0 }
}

export const ROUNDING_RULES = [
  { id: 'none', label: 'No rounding (exact cents)' },
  { id: 'nearest_005', label: 'Round to nearest 0.05' },
  { id: 'nearest_whole', label: 'Round to nearest whole unit' },
]
