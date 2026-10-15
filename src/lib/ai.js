// ─── AI context + prompts (pure, isomorphic) ─────────────────────────
// The model is never handed the raw state. It gets a small, redacted,
// pre-computed digest built from the same selectors the screens use
// (getDashboard / getAlerts / reports). Money math and unit math stay in
// the app — the model only reads numbers it is given.
//
// `scope: 'menu'` is the guest surface: it strips every operational field
// (sales, inventory, staff, alerts) so a public QR / mini-app caller can
// only ever ask about the menu.
//
// This module runs on both sides of the wire, so it touches no browser
// globals and no `process` at module scope.

import { getAlerts, getDashboard } from './reducer.js'
import { translateDishDesc, translateDishName, translateInventoryName } from './kitchen-i18n.js'

export const AI_SCOPES = ['ops', 'menu']
export const AI_INSIGHT_KINDS = ['alert', 'menu', 'reorder', 'forecast', 'briefing']

const DEFAULTS = {
  alerts: 12,
  sellers: 5,
  lowStock: 12,
  menu: 80,
  salesHistory: 14,
  description: 180,
  ingredients: 12,
  popular: 6,
}

const LANG_NAME = { en: 'English', km: 'Khmer', zh: 'Simplified Chinese' }

function clamp(str, max) {
  const text = typeof str === 'string' ? str.trim() : str == null ? '' : String(str)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function menuName(entry) {
  if (!entry) return ''
  if (typeof entry === 'string') return entry
  return entry.name || entry.label || entry.id || ''
}

function targetSubset(settings = {}) {
  return {
    foodCostCap: num(settings.foodCostCap),
    ticketMinutes: num(settings.ticketMinutes),
    targetTurnMinutes: num(settings.targetTurnMinutes),
  }
}

function lowStockRows(state, limit) {
  const suppliers = new Map((state.suppliers || []).map((s) => [s.id, s.name]))
  return (state.inventory || [])
    .filter((item) => item.active !== false)
    .map((item) => ({
      name: item.name,
      unit: item.unit,
      onHand: num(item.onHand),
      par: num(item.par),
      reorderPoint: num(item.reorderPoint ?? item.par),
      vendor: item.vendor || suppliers.get(item.supplierId) || null,
      gap: num(item.reorderPoint ?? item.par) - num(item.onHand),
    }))
    .filter((row) => row.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, limit)
    .map((row) => ({
      name: row.name,
      unit: row.unit,
      onHand: row.onHand,
      par: row.par,
      reorderPoint: row.reorderPoint,
      vendor: row.vendor,
    }))
}

// The ingredient NAMES a dish is made from (localized when we can). Names only
// — never quantities or costs, which are costing data a guest must not see.
function ingredientNames(state, menuItemId, lang, limit) {
  const recipe = state.recipes?.[menuItemId]
  if (!recipe || !Array.isArray(recipe.ingredients)) return []
  const byId = new Map((state.inventory || []).map((item) => [item.id, item]))
  const names = []
  for (const ing of recipe.ingredients) {
    const item = byId.get(ing?.inventoryItemId)
    if (!item || item.active === false) continue
    const name = translateInventoryName(item, lang)
    if (name && !names.includes(name)) names.push(name)
    if (names.length >= limit) break
  }
  return names
}

// Which dishes actually sell — a coarse "popular" flag (top N by units sold
// across the current book). No raw counts are exposed, only the boolean.
function popularMenuIds(state, top) {
  const qtyByMenu = new Map()
  for (const order of state.orders || []) {
    if (order.status === 'void') continue
    for (const item of order.items || []) {
      if (item.voided) continue
      qtyByMenu.set(item.menuItemId, (qtyByMenu.get(item.menuItemId) || 0) + (item.qty || 0))
    }
  }
  return new Set(
    [...qtyByMenu.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([id]) => id),
  )
}

function menuRows(state, limit, withDetail, lang = 'en', popular = null) {
  return (state.menu || [])
    .filter((item) => item.active !== false)
    .sort((a, b) => num(a.sortOrder) - num(b.sortOrder))
    .slice(0, limit)
    .map((item) => {
      const row = {
        // Localize only when the guest is reading it, so the model recommends
        // the same dish names the menu on screen shows.
        name: withDetail ? translateDishName(item, lang) : item.name,
        category: item.category || null,
        price: num(item.price),
        available: item.available !== false,
      }
      if (withDetail) {
        row.subCategory = item.subCategory || null
        row.description = clamp(translateDishDesc(item, lang) || item.description, DEFAULTS.description)
        row.dietaryTags = Array.isArray(item.dietaryTags) ? item.dietaryTags.slice(0, 8) : []
        row.allergens = Array.isArray(item.allergens) ? item.allergens.slice(0, 8) : []
        if (item.spiceLevel) row.spiceLevel = String(item.spiceLevel).slice(0, 20)
        const ingredients = ingredientNames(state, item.id, lang, DEFAULTS.ingredients)
        if (ingredients.length) row.ingredients = ingredients
        if (popular && popular.has(item.id)) row.popular = true
      }
      return row
    })
}

/**
 * Build the redacted digest handed to the model.
 * @param {object} state  one shop's state (empire.locations[locId])
 * @param {{ scope?: 'ops'|'menu', locId?: string, now?: number, limits?: object }} opts
 */
export function buildAiContext(state, { scope = 'ops', locId = 'downtown', lang = 'en', now = Date.now(), limits = {} } = {}) {
  const shop = state || {}
  const settings = shop.settings || {}
  const cap = { ...DEFAULTS, ...limits }
  const base = {
    scope,
    location: { id: locId, name: settings.restaurantName || locId },
    generatedAt: new Date(now).toISOString(),
  }

  if (scope === 'menu') {
    return {
      ...base,
      // Guests get the rich row (localized, with ingredients/spice/diet tags)
      // plus a "popular" hint so recommendations can be grounded in real sales.
      menu: menuRows(shop, cap.menu, true, lang, popularMenuIds(shop, cap.popular)),
      categories: (shop.categories || []).filter((c) => c.kind !== 'inventory').map((c) => c.name).slice(0, 30),
    }
  }

  const dash = getDashboard(shop, now)
  const alerts = getAlerts(shop)
  return {
    ...base,
    targets: targetSubset(settings),
    dashboard: {
      sales: num(dash.sales),
      covers: num(dash.covers),
      avgCheck: num(dash.avgCheck),
      checks: num(dash.checks),
      occupancy: num(dash.occupancy),
      foodCost7d: num(dash.foodCost7d),
      tonightCostPct: num(dash.tonightCostPct),
      avgTicketMin: num(dash.avgTicketMin),
      openTickets: num(dash.openTickets),
    },
    alerts: alerts.slice(0, cap.alerts).map((alert) => ({
      type: alert.type,
      severity: alert.severity,
      label: clamp(alert.label, 80),
      detail: clamp(alert.detail, 160),
    })),
    topSellers: (dash.topSellers || []).slice(0, cap.sellers).map((row) => ({ name: menuName(row.menu), qty: num(row.qty) })),
    bottomContribution: (dash.bottomContribution || []).slice(0, cap.sellers).map((row) => ({
      name: menuName(row.menu),
      qty: num(row.qty),
      contribution: num(row.contribution),
      band: row.band || null,
    })),
    lowStock: lowStockRows(shop, cap.lowStock),
    menu: menuRows(shop, cap.menu, false),
    salesHistory: (shop.salesHistory || []).slice(-cap.salesHistory).map((row) => ({
      day: row.day,
      sales: num(row.sales),
      foodCostPct: num(row.foodCostPct),
    })),
  }
}

export const SYSTEM_PROMPTS = {
  base: [
    "You are Restora's restaurant operations assistant. You help a restaurant owner and staff understand their live shift.",
    'Answer ONLY from the CONTEXT block you are given (and the app guide). If the answer is not there, say you do not have that data and name where to look.',
    'Never invent numbers, names, or events. Report numbers exactly as given; do not add currency symbols and do not do arithmetic unless it is trivial.',
    'Be concise: 2–4 sentences unless a list is explicitly requested.',
  ].join(' '),
  // Guests ask about the food, not the business. Warm, recommendation-first.
  menuBase: [
    'You are the friendly menu assistant for this restaurant. Guests scan a QR code and ask you about the food.',
    'Recommend dishes ONLY from the menu list in CONTEXT — never invent a dish, ingredient, price, or tag.',
    'When asked for a recommendation, suggest 1–3 specific dishes BY NAME and give their price. Give a short, concrete reason — its category, dietary tags, spice level, ingredients, or that it is marked popular.',
    'Match the request: dietary needs and allergies (use dietaryTags and allergens — warn if a dish may contain an allergen), spice level, budget, or a craving.',
    'Never recommend a dish marked available:false. If asked about one, say it is sold out and offer a close alternative.',
    'If a detail is not in the data (e.g. an ingredient not listed), say you do not have it and suggest asking a server.',
    'Keep it short and appetizing: 2–5 sentences, or up to 3 short bullets when suggesting dishes.',
  ].join(' '),
  // Lets the Ops Copilot answer "how do I …" questions about the product itself.
  appGuide: [
    'HOW RESTORA WORKS (use this to answer any "how do I …" question; you are read-only, so point to the screen rather than claiming to act):',
    'Screens: Dashboard (live KPIs), Floor (tables/seating), Orders, Kitchen (KDS), Menu & Recipes, Catalog, Inventory, Stock movements, Purchases (reorder), Suppliers, Reports & Analytics, Food Cost & Profit, Settings.',
    'Common tasks — add a dish: Menu & Recipes → New item, then set price, category, and its recipe. 86 a dish: the 86 toggle on the dish or Kitchen board. Take an order: Floor → open a table → add items → fire. Request the bill: the guest does it from their QR page, or staff from the ticket. Close the day: the close-of-day digest. Invite staff: Settings → team. Connect AI: Settings → AI assistant.',
  ].join(' '),
  lang: (lang) => `Respond in ${lang}.`,
}

export const INSIGHT_INSTRUCTIONS = {
  alert: 'For each alert, write one line: the likely cause, then a concrete next action. Order by severity. At most 6 lines.',
  menu: 'Suggest menu-engineering actions (raise price / drop / reprice / feature). Base each on the contribution band and quantity sold. At most 4 bullets, each naming the item and a one-line reason.',
  reorder: 'Suggest what to reorder and roughly how much, using on-hand vs par vs reorder point. At most 6 bullets. Never state an exact final purchase total.',
  forecast: 'Give a short prep/setup forecast for the next service: likely busy periods and what to prep. At most 4 bullets.',
  briefing: 'Write a short shift briefing for the manager: the 3 most important things to know right now, then one recommended focus. Plain text, no markdown headers.',
}

function sanitizeHistory(history, maxTurns = 12) {
  return (Array.isArray(history) ? history : [])
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim())
    .slice(-maxTurns)
    .map((msg) => ({ role: msg.role, content: clamp(msg.content, 2000) }))
}

/**
 * Compose the system prompt + conversation for one call.
 * @returns {{ system: string, messages: Array<{role:string,content:string}> }}
 */
export function buildMessages({ kind = 'chat', question = '', history = [], context, lang = 'en' } = {}) {
  const langName = LANG_NAME[lang] || LANG_NAME.en
  const isGuestMenu = context?.scope === 'menu'
  const system = [
    isGuestMenu ? SYSTEM_PROMPTS.menuBase : SYSTEM_PROMPTS.base,
    isGuestMenu ? '' : SYSTEM_PROMPTS.appGuide,
    SYSTEM_PROMPTS.lang(langName),
    isGuestMenu ? '' : (INSIGHT_INSTRUCTIONS[kind] || ''),
    `CONTEXT:\n${JSON.stringify(context)}`,
  ].filter(Boolean).join('\n\n')

  const messages = kind === 'chat'
    ? [...sanitizeHistory(history), { role: 'user', content: clamp(question, 2000) || 'Summarize the current shift.' }]
    : [{ role: 'user', content: 'Analyze the context and respond as instructed.' }]

  return { system, messages }
}

/** Stable, deterministic hash of a context/string — used to cache responses. */
export function hashContext(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value) || ''
  let hash = 5381
  for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}
