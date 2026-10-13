// ─── Telegram bot engine ────────────────────────────────────────────
// One pure command interpreter shared by the server (webhook) and the
// Telegram screen (live simulator). It never touches the network: a
// command returns the text to send back plus the shop actions it wants,
// and the caller decides whether to apply them (webhook: yes; simulator:
// preview only). That keeps the bot testable without a token.
//
// Roles: `staff` may look things up, `manager` may change them. The
// chat→role mapping lives in the server (TELEGRAM_CHAT_ROLES).

import { money, pct, reorderPointFor, stockStatusFor, suggestedOrderQty } from './models.js'
import { RANGES, buildReports, rangeBounds } from './reports.js'
import { describeQty, itemUnitChoices, unitShort } from './units.js'
import { dailyDigest } from './telegram-digest.js'

export const TELEGRAM_ROLES = ['staff', 'manager']

export const TELEGRAM_COMMANDS = [
  { command: '/start', args: '', role: 'staff', blurb: 'What this bot can do for the floor right now.' },
  { command: '/help', args: '', role: 'staff', blurb: 'The command list for your role.' },
  { command: '/today', args: '', role: 'staff', blurb: "Today's checks, net sales, and best seller." },
  { command: '/week', args: '', role: 'staff', blurb: 'Last 7 days: sales, spend, and stock movement.' },
  { command: '/low', args: '', role: 'staff', blurb: 'What is low or out, with the order suggestion.' },
  { command: '/stock', args: '<item>', role: 'staff', blurb: 'On hand, par, and packs for one item.' },
  { command: '/menu', args: '[term]', role: 'staff', blurb: 'Menu prices, and what is currently 86’d.' },
  { command: '/orders', args: '', role: 'staff', blurb: 'Open tickets with age and value.' },
  { command: '/qr', args: '<table>', role: 'staff', blurb: 'Guest QR / mini app link for a table.' },
  { command: '/table', args: '<n>', role: 'staff', blurb: 'One table: status, wait, and the live check.' },
  { command: '/pnl', args: '', role: 'manager', blurb: 'Rolling-month profit and loss.' },
  { command: '/report', args: '[tonight|7d|30d]', role: 'manager', blurb: 'Sell vs buy, top and bottom items.' },
  { command: '/86', args: '<item>', role: 'manager', blurb: 'Take a dish off the menu everywhere.' },
  { command: '/un86', args: '<item>', role: 'manager', blurb: 'Put a dish back on.' },
  { command: '/po', args: '', role: 'manager', blurb: 'Open purchase orders and what is waiting.' },
  { command: '/receive', args: '<PO number>', role: 'manager', blurb: 'Receive a purchase order into stock.' },
  { command: '/buy', args: '[tonight|7d|30d]', role: 'manager', blurb: 'What the kitchen bought: spend, units, and the small stuff.' },
  { command: '/digest', args: '', role: 'manager', blurb: 'The close-of-day note the bot pushes to the chat.' },
]

const COMMAND_INDEX = Object.fromEntries(
  TELEGRAM_COMMANDS.map((entry) => [entry.command.slice(1), entry]),
)

export function commandsFor(role = 'staff') {
  return TELEGRAM_COMMANDS.filter((entry) => role === 'manager' || entry.role === 'staff')
}

export function isManager(role) {
  return ['manager', 'owner', 'admin'].includes(String(role || '').toLowerCase())
}

/** Normalise "  /STOCK   Salmon  fillet " → { name: 'stock', arg: 'Salmon fillet' }. */
export function parseCommand(input) {
  const text = String(input || '').trim()
  if (!text) return null
  const withoutSlash = text.replace(/^\//, '')
  const [head, ...rest] = withoutSlash.split(/\s+/)
  const name = head.toLowerCase()
  // /receive@restora_bot still routes to /receive
  const bare = name.split('@')[0]
  return { name: bare, arg: rest.join(' ').trim(), raw: text }
}

/** Find the item whose name matches best: exact, then starts-with, then contains. */
export function matchByName(query, list, key = 'name') {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return null
  const rows = (list || []).filter((row) => row && row[key])
  const exact = rows.find((row) => String(row[key]).toLowerCase() === needle)
  if (exact) return exact
  const starts = rows.find((row) => String(row[key]).toLowerCase().startsWith(needle))
  if (starts) return starts
  return rows.find((row) => String(row[key]).toLowerCase().includes(needle)) || null
}

const line = (...parts) => parts.filter(Boolean).join(' · ')
const heading = (text) => `${text}\n${'-'.repeat(Math.min(28, text.length))}`

function rangeLabel(range) {
  return RANGES.find((entry) => entry.id === range)?.label || range
}

function tableName(shop, tableId) {
  return shop.tables?.find((table) => table.id === tableId)?.name || 'Table'
}

function locationName(shop) {
  return shop.settings?.restaurantName || 'Restaurant'
}

function helpText(role) {
  const rows = commandsFor(role).map((entry) => `${entry.command}${entry.args ? ` ${entry.args}` : ''} — ${entry.blurb}`)
  return [
    heading(`Restora bot · ${isManager(role) ? 'manager' : 'staff'} access`),
    ...rows,
    '',
    'Send /today for the numbers, /86 Salmon fillet to pull a dish, or /qr 12 for a guest link.',
  ].join('\n')
}

function startText(role, shop) {
  return [
    heading(`${locationName(shop)} · Restora bot`),
    'I answer from the same live book the terminals use — nothing to sync.',
    '',
    ...commandsFor(role).slice(0, 6).map((entry) => `${entry.command} — ${entry.blurb}`),
    '',
    'Full list: /help',
  ].join('\n')
}

function todayText(shop, now) {
  const reports = buildReports(shop, 'tonight', now)
  const top = reports.rankings.sell.byRevenue[0]
  return [
    heading(`Today · ${locationName(shop)}`),
    line(`Checks ${reports.sales.checks}`, `Net sales ${money(reports.sales.netSales)}`),
    line(`Avg check ${money(reports.sales.avgCheck)}`, `Tips ${money(reports.sales.tips)}`),
    top ? `Top seller: ${top.name} · ${top.qty} sold · ${money(top.revenue)}` : 'Top seller: nothing sold yet',
    `86’d: ${(shop.menu || []).filter((item) => item.available === false && item.active !== false).length}`,
  ].join('\n')
}

function rangeText(shop, range, now) {
  const reports = buildReports(shop, range, now)
  const bounds = rangeBounds(range, now)
  const spend = reports.purchases.spend || 0
  return [
    heading(`${rangeLabel(range)} · ${locationName(shop)}`),
    line(`Checks ${reports.sales.checks}`, `Net sales ${money(reports.sales.netSales)}`),
    line(`Buying ${money(spend)}`, `Movements ${reports.movements.inCount + reports.movements.outCount}`),
    line(`Stock in ${reports.movements.inUnits}`, `out ${reports.movements.outUnits}`),
    `Window starts ${new Date(bounds.start).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`,
  ].join('\n')
}

function pnlText(shop, now) {
  const reports = buildReports(shop, '30d', now)
  const pnl = reports.pnl
  return [
    heading('Profit & loss · 30 days'),
    line(`Revenue ${money(pnl.revenue)}`, `COGS ${money(pnl.cogs)}`),
    line(`Gross profit ${money(pnl.grossProfit)}`, `${pct(pnl.foodCostPct)} food cost`),
    line(`Waste ${money(pnl.waste)}`, `Shrinkage ${money(pnl.shrinkage)}`),
    `Operating result: ${money(pnl.operatingResult)}`,
    `Top margin: ${reports.rankings.sell.byMargin[0]?.name || '—'}`,
  ].join('\n')
}

function itemsText(shop, range, now) {
  const reports = buildReports(shop, range, now)
  const sell = reports.rankings.sell
  const buy = reports.rankings.buy
  const names = (rows) => rows.map((row) => `${row.name} (${row.qty})`).join(', ') || '—'
  const spend = (rows) => rows.map((row) => `${row.name} ${money(row.value)}`).join(', ') || '—'
  return [
    heading(`Sell vs buy · ${rangeLabel(range)}`),
    `Top sellers: ${names(sell.byRevenue)}`,
    `Worst sellers: ${names(sell.worst)}`,
    `Best margin: ${names(sell.byMargin)}`,
    `Unsold: ${sell.unsold.map((row) => row.name).join(', ') || 'none'}`,
    '',
    `Top spend: ${spend(buy.bySpend)}`,
    `Least spend: ${spend(buy.least)}`,
  ].join('\n')
}

function lowText(shop) {
  const rows = (shop.inventory || [])
    .map((item) => ({ item, status: stockStatusFor(item, shop.settings) }))
    .filter((row) => row.status === 'low' || row.status === 'out')
    .sort((a, b) => (a.status === 'out' ? -1 : 1) - (b.status === 'out' ? -1 : 1))
  if (!rows.length) return 'Nothing is low. Every SKU is above its reorder point.'
  return [
    heading(`Low stock · ${rows.length} item${rows.length === 1 ? '' : 's'}`),
    ...rows.slice(0, 12).map(({ item, status }) => {
      const order = suggestedOrderQty(item, shop.settings)
      const par = reorderPointFor(item, shop.settings)
      const short = unitShort(shop.settings, item.unit)
      return `${status === 'out' ? 'OUT' : 'LOW'} ${item.name} — ${describeQty(item, item.onHand, shop.settings)} left (order ${order} ${short}, par ${par} ${short})`
    }),
  ].join('\n')
}

function stockText(shop, arg) {
  if (!arg) return 'Which item? Try /stock salmon.'
  const item = matchByName(arg, shop.inventory)
  if (!item) return `No stock item matches “${arg}”. Try /low to see what is short.`
  const choices = itemUnitChoices(item, shop.settings).filter((choice) => choice.kind === 'pack')
  const supplier = shop.suppliers?.find((entry) => entry.id === item.supplierId)
  return [
    heading(`${item.name}`),
    line(`On hand ${describeQty(item, item.onHand, shop.settings)}`, `par ${item.par} ${unitShort(shop.settings, item.unit)}`),
    line(`Cost ${money(item.lastCost)}/${unitShort(shop.settings, item.unit)}`, item.avgCost !== item.lastCost ? `avg ${money(item.avgCost)}` : ''),
    choices.length ? `Packs: ${choices.map((choice) => `1 ${choice.label} = ${choice.factor} ${item.unit}`).join(' · ')}` : 'No packs configured',
    supplier ? `Supplier: ${supplier.name}` : '',
  ].join('\n')
}

function menuText(shop, arg) {
  const query = String(arg || '').trim().toLowerCase()
  const rows = (shop.menu || []).filter((item) => item.active !== false)
    .filter((item) => !query || String(item.name).toLowerCase().includes(query) || String(item.category).toLowerCase().includes(query))
  if (!rows.length) return `Nothing on the menu matches “${arg}”.`
  const unavailable = rows.filter((item) => item.available === false)
  return [
    heading(query ? `Menu · “${arg}”` : `Menu · ${rows.length} dishes`),
    ...rows.slice(0, 12).map((item) => `${item.available === false ? '86’D ' : ''}${item.name} — ${money(item.price)} · ${item.category}`),
    unavailable.length ? `\n${unavailable.length} dish${unavailable.length === 1 ? ' is' : 'es are'} currently 86’d.` : '',
  ].join('\n')
}

/** Line prices live on the menu, not on the ticket — resolve them here. */
function orderTotal(shop, order) {
  const priceById = new Map((shop.menu || []).map((item) => [item.id, Number(item.price) || 0]))
  return (order?.items || [])
    .filter((item) => !item.voided)
    .reduce((sum, item) => sum + (priceById.get(item.menuItemId) || 0) * (Number(item.qty) || 1), 0)
}

function openOrderFor(shop, table) {
  return (shop.orders || []).find((order) => order.id === table?.currentCheckId)
    || (shop.orders || []).find((order) => order.tableId === table?.id && !['paid', 'void'].includes(order.status))
}

function ordersText(shop, now) {
  const open = (shop.orders || []).filter((order) => ['open', 'in_prep', 'ready', 'sent'].includes(order.status))
  if (!open.length) return 'No open tickets.'
  return [
    heading(`Open tickets · ${open.length}`),
    ...open.slice(0, 12).map((order) => {
      const minutes = Math.max(0, Math.round((now - new Date(order.openedAt || order.firedAt || now).getTime()) / 60000))
      return `${tableName(shop, order.tableId)} · ${order.status} · ${minutes}m · ${money(orderTotal(shop, order))}`
    }),
  ].join('\n')
}

function tableText(shop, arg, now = Date.now()) {
  const table = matchByName(arg, shop.tables, 'name')
    || (shop.tables || []).find((entry) => String(entry.id).endsWith(String(arg)))
  if (!table) return 'Which table? Try /table 12.'
  const order = openOrderFor(shop, table)
  const minutes = table.seatedAt ? Math.max(0, Math.round((now - new Date(table.seatedAt).getTime()) / 60000)) : null
  const lines = (order?.items || []).filter((item) => !item.voided)
  const fired = lines.filter((item) => item.status !== 'held')
  return [
    heading(`${table.name} · ${table.status}`),
    line(
      `${table.seats} seats · ${table.zone}`,
      table.partySize ? `party ${table.partySize}` : '',
      minutes != null && ['seated', 'ordered', 'billed'].includes(table.status) ? `seated ${minutes}m` : '',
    ),
    order
      ? line(`${lines.length} line${lines.length === 1 ? '' : 's'}`, `${fired.length} fired`, money(orderTotal(shop, order)))
      : 'No open check yet.',
    order?.status ? `Check is ${order.status}${order.billRequested ? ' · bill requested' : ''}` : '',
    table.status === 'seated' ? 'Tip: /qr ' + String(table.id).replace(/\D/g, '') + ' for the guest menu link.' : '',
  ].join('\n')
}

function buyText(shop, range, now = Date.now()) {
  const reports = buildReports(shop, range, now)
  const buy = reports.rankings.buy
  const spend = (rows) => rows.map((row) => `${row.name} ${money(row.value)}`).join(', ') || 'nothing yet'
  const units = (rows) => rows.map((row) => `${row.name} ${Math.round(row.qty * 10) / 10}`).join(', ') || 'nothing yet'
  return [
    heading(`Buying · ${rangeLabel(range)}`),
    line(`Spent ${money(reports.purchases.spend)}`, `${reports.purchases.orders} invoices`, `${reports.purchases.units} units`),
    `Biggest spend: ${spend(buy.bySpend)}`,
    `Biggest units: ${units(buy.byQty)}`,
    `Smallest buys: ${spend(buy.least)}`,
    (reports.purchases.openOrders || []).length
      ? `Open: ${reports.purchases.openOrders.map((po) => `${po.number} ${po.vendor} ${money(po.total)}`).join(' · ')}`
      : 'No open purchase orders.',
  ].join('\n')
}

function digestText(shop, now = Date.now()) {
  return dailyDigest(shop, now).text
}

function qrText(shop, arg, miniAppUrl) {
  const table = matchByName(arg, shop.tables, 'name') || (shop.tables || []).find((entry) => String(entry.id).endsWith(String(arg)))
  if (!table) return 'Which table? Try /qr 12.'
  const base = miniAppUrl || 'https://restora.example'
  const guestLink = `${base}?guest=${encodeURIComponent(table.id)}`
  const miniApp = `${guestLink}&tg=1`
  return [
    heading(`Guest link · ${table.name}`),
    `Menu + ordering: ${guestLink}`,
    `Telegram mini app: ${miniApp}`,
    `Seats ${table.seats} · ${table.zone}`,
  ].join('\n')
}

function poText(shop) {
  const open = (shop.purchases || []).filter((purchase) => ['draft', 'ordered'].includes(purchase.status))
  if (!open.length) return 'No open purchase orders.'
  return [
    heading(`Open purchase orders · ${open.length}`),
    ...open.slice(0, 10).map((purchase) => `${purchase.number} · ${purchase.vendor} · ${purchase.lines.length} lines · ${money(purchase.totals?.total || 0)} · ${purchase.status}`),
    '',
    'Receive one with /receive ' + (open[0].number || 'PO-…'),
  ].join('\n')
}

function receiveText(shop, arg) {
  if (!arg) return 'Which purchase order? Try /po for the open list.'
  const needle = arg.trim().toLowerCase()
  const purchase = (shop.purchases || []).find((entry) => String(entry.number || '').toLowerCase() === needle)
    || (shop.purchases || []).find((entry) => String(entry.number || '').toLowerCase().includes(needle.replace(/^po-?/, '')))
  if (!purchase) return `No purchase order matches “${arg}”.`
  if (purchase.status === 'received') return `${purchase.number} was already received.`
  if (purchase.status === 'cancelled') return `${purchase.number} was cancelled.`
  return {
    reply: [
      heading(`Receive ${purchase.number}`),
      `Vendor: ${purchase.vendor}`,
      ...purchase.lines.map((entry) => {
        const item = (shop.inventory || []).find((row) => row.id === entry.inventoryItemId)
        const landed = (Number(entry.qty) || 0) * (Number(entry.packSize) || 1)
        return item
          ? `${entry.name} — ${entry.qty} ${entry.unit || unitShort(shop.settings, item.unit)} → ${describeQty(item, landed, shop.settings)}`
          : `${entry.name} — ${entry.qty} → ${landed} stock units`
      }),
      `Total ${money(purchase.totals?.total || 0)} · ${purchase.lines.length} line${purchase.lines.length === 1 ? '' : 's'} land on hand.`,
      'Stock, ledger, and invoice log all update together.',
    ].join('\n'),
    actions: [{ type: 'RECEIVE_PURCHASE', purchaseId: purchase.id, by: 'telegram' }],
  }
}

function set86Text(shop, arg, available) {
  if (!arg) return `Which dish? Try /${available ? 'un86' : '86'} salmon.`
  const dish = matchByName(arg, shop.menu)
  if (!dish) return `No menu item matches “${arg}”.`
  const already = dish.available === available
  return {
    reply: already
      ? `${dish.name} is ${available ? 'already on the menu' : 'already 86’d'}.`
      : `${available ? 'Back on' : '86’d'}: ${dish.name}\nEvery terminal, the KDS, and the guest QR follow instantly.`,
    actions: already ? [] : [{ type: 'SET_86', menuItemId: dish.id, available, by: 'telegram' }],
  }
}

function unknownText(name, role) {
  const known = COMMAND_INDEX[name]
  if (known) return `${known.command} is for managers. Your chat is mapped to staff access.`
  return [`Unknown command “/${name}”.`, '', helpText(role)].join('\n')
}

/**
 * Run one message. Pure: the returned `actions` are applied by the caller
 * (the webhook applies them; the simulator only shows them).
 */
export function runTelegramCommand(input, context = {}) {
  const { shop, now = Date.now(), role = 'staff', miniAppUrl = '' } = context
  const parsed = parseCommand(input)
  if (!shop) return { ok: false, command: null, reply: 'No restaurant data yet.', actions: [] }
  if (!parsed) return { ok: false, command: null, reply: 'Say something like /today or /help.', actions: [] }

  const manager = isManager(role)
  const needsManager = (text) => ({ ok: false, command: parsed.name, reply: text, actions: [] })
  const done = (reply, actions = []) => ({ ok: true, command: parsed.name, reply, actions })

  switch (parsed.name) {
    case 'start':
      return done(startText(role, shop))
    case 'help':
    case 'commands':
      return done(helpText(role))
    case 'today':
      return done(todayText(shop, now))
    case 'week':
      return done(rangeText(shop, '7d', now))
    case 'month':
    case '30d':
      return done(rangeText(shop, '30d', now))
    case 'low':
    case 'stock_low':
      return done(lowText(shop))
    case 'stock':
      return done(stockText(shop, parsed.arg))
    case 'menu':
      return done(menuText(shop, parsed.arg))
    case 'orders':
    case 'tickets':
      return done(ordersText(shop, now))
    case 'qr':
      return done(qrText(shop, parsed.arg, miniAppUrl))
    case 'table':
      return done(tableText(shop, parsed.arg, now))
    case 'pnl':
      if (!manager) return needsManager(unknownText('pnl', role))
      return done(pnlText(shop, now))
    case 'report':
      if (!manager) return needsManager(unknownText('report', role))
      return done(itemsText(shop, RANGES.some((entry) => entry.id === parsed.arg) ? parsed.arg : '30d', now))
    case 'po':
      if (!manager) return needsManager(unknownText('po', role))
      return done(poText(shop))
    case 'buy':
      if (!manager) return needsManager(unknownText('buy', role))
      return done(buyText(shop, RANGES.some((entry) => entry.id === parsed.arg) ? parsed.arg : '30d', now))
    case 'digest':
      if (!manager) return needsManager(unknownText('digest', role))
      return done(digestText(shop, now))
    case 'receive': {
      if (!manager) return needsManager(unknownText('receive', role))
      const result = receiveText(shop, parsed.arg)
      if (typeof result === 'string') return done(result)
      return { ok: true, command: parsed.name, reply: result.reply, actions: result.actions }
    }
    case '86':
    case 'un86': {
      if (!manager) return needsManager(unknownText(parsed.name, role))
      const result = set86Text(shop, parsed.arg, parsed.name === 'un86')
      if (typeof result === 'string') return done(result)
      return { ok: true, command: parsed.name, reply: result.reply, actions: result.actions }
    }
    default:
      return { ok: false, command: parsed.name, reply: unknownText(parsed.name, role), actions: [] }
  }
}

/** What a webhook update means: chat, text, and the role that chat holds. */
export function parseTelegramUpdate(update, chatRoles = {}) {
  const message = update?.message || update?.edited_message || update?.channel_post || null
  if (!message?.text) return null
  const chatId = String(message.chat?.id ?? '')
  const fromId = String(message.from?.id ?? chatId)
  const role = chatRoles[chatId] || chatRoles[fromId] || chatRoles['*'] || 'staff'
  return {
    chatId,
    fromId,
    userName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'team',
    text: message.text,
    role,
    messageId: message.message_id,
  }
}

/** The buttons Telegram shows under a reply. */
export function replyKeyboard(role = 'staff') {
  const rows = commandsFor(role).filter((entry) => !entry.args)
  const keyboard = []
  for (let index = 0; index < rows.length; index += 3) {
    keyboard.push(rows.slice(index, index + 3).map((entry) => ({ text: entry.command })))
  }
  return keyboard
}
