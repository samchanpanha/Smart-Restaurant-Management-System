// ─── Telegram bot ───────────────────────────────────────────────────
// The engine is pure, the webhook is a thin shell around it, and nothing
// here needs a token or the internet: a chat that is mapped to `manager`
// may change the book, a staff chat may only look.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import express from 'express'
import { buildEmpire, reducer } from '../src/lib/reducer.js'
import {
  TELEGRAM_COMMANDS,
  commandsFor,
  matchByName,
  parseCommand,
  parseTelegramUpdate,
  replyKeyboard,
  runTelegramCommand,
} from '../src/lib/telegram.js'
import { createTelegramRouter, parseChatRoles, sendTelegramMessage } from '../server/telegram.js'

const shopOf = (empire) => empire.locations.downtown

// ─── The engine ────────────────────────────────────────────────────

test('commands parse the way Telegram sends them', () => {
  assert.deepEqual(parseCommand('/stock Salmon fillet'), { name: 'stock', arg: 'Salmon fillet', raw: '/stock Salmon fillet' })
  assert.deepEqual(parseCommand('  /RECEIVE@restora_bot po-1 '), { name: 'receive', arg: 'po-1', raw: '/RECEIVE@restora_bot po-1' })
  assert.equal(parseCommand('   '), null)
  assert.deepEqual(parseCommand('/today'), { name: 'today', arg: '', raw: '/today' })

  assert.equal(matchByName('salmon', shopOf(buildEmpire()).inventory).id, 'inv_salmon')
  assert.equal(matchByName('RESTORA burger', shopOf(buildEmpire()).menu).id, 'm_burger')
  assert.equal(matchByName('tiramisu', shopOf(buildEmpire()).menu), null)
})

test('manager-only commands are gated and every reply is plain text', () => {
  const shop = shopOf(buildEmpire())
  const staff = runTelegramCommand('/pnl', { shop, role: 'staff' })
  assert.equal(staff.actions.length, 0)
  assert.match(staff.reply, /for managers/)

  const help = runTelegramCommand('/help', { shop, role: 'staff' })
  assert.equal(help.ok, true)
  assert.match(help.reply, /\/today/)
  assert.doesNotMatch(help.reply, /\/receive/, 'staff never see the manager list')
  assert.match(runTelegramCommand('/help', { shop, role: 'manager' }).reply, /\/receive/)

  const unknown = runTelegramCommand('/frobnicate', { shop, role: 'staff' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.reply, /Unknown command/)
  assert.deepEqual(runTelegramCommand('/help', { shop }).actions, [])

  assert.equal(commandsFor('staff').length, 9)
  assert.equal(commandsFor('manager').length, TELEGRAM_COMMANDS.length)
  assert.ok(replyKeyboard('manager').flat().some((button) => button.text === '/po'))
  assert.ok(!replyKeyboard('staff').flat().some((button) => button.text === '/po'))
})

test('the numbers come from the same reports engine the screens use', () => {
  const shop = shopOf(buildEmpire())
  const today = runTelegramCommand('/today', { shop, role: 'staff' })
  assert.match(today.reply, /Net sales \$425\.00/)
  assert.match(today.reply, /Top seller: Restora Burger/)
  assert.match(today.reply, /86’d: 1/)

  const week = runTelegramCommand('/week', { shop, role: 'staff' })
  assert.match(week.reply, /7 days/)
  assert.match(week.reply, /Buying \$/)

  const pnl = runTelegramCommand('/pnl', { shop, role: 'manager' })
  assert.match(pnl.reply, /Operating result: \$/)
  assert.match(pnl.reply, /food cost/)

  const report = runTelegramCommand('/report 7d', { shop, role: 'manager' })
  assert.match(report.reply, /Sell vs buy · 7 days/)
  assert.match(report.reply, /Top spend: Beef patty 6oz \$108\.00/)

  const orders = runTelegramCommand('/orders', { shop, role: 'staff' })
  assert.ok(orders.reply.length > 0)
})

test('lookups answer with packs, suppliers, and what is short', () => {
  const shop = shopOf(buildEmpire())
  const stock = runTelegramCommand('/stock salmon', { shop, role: 'staff' })
  assert.match(stock.reply, /Salmon fillet/)
  assert.match(stock.reply, /On hand 0 ea/)
  assert.match(stock.reply, /1 Case = 12 each/)
  assert.match(stock.reply, /Supplier: Harbor Fish/)
  assert.match(runTelegramCommand('/stock nothing-like-this', { shop }).reply, /No stock item matches/)
  assert.match(runTelegramCommand('/stock', { shop }).reply, /Which item/)

  const low = runTelegramCommand('/low', { shop, role: 'staff' })
  assert.match(low.reply, /OUT Salmon fillet/)
  assert.match(low.reply, /par 12 ea/)

  const menu = runTelegramCommand('/menu burger', { shop })
  assert.match(menu.reply, /Restora Burger — \$16\.00/)
  const qr = runTelegramCommand('/qr 12', { shop, miniAppUrl: 'https://restora.test' })
  assert.match(qr.reply, /https:\/\/restora\.test\?guest=t12/)
  assert.match(qr.reply, /&tg=1/)
})

test('changing commands come back as actions, never as side effects', () => {
  const shop = shopOf(buildEmpire())
  const offer = runTelegramCommand('/86 Restora burger', { shop, role: 'manager' })
  assert.deepEqual(offer.actions, [{ type: 'SET_86', menuItemId: 'm_burger', available: false, by: 'telegram' }])
  assert.match(offer.reply, /Every terminal, the KDS, and the guest QR follow instantly/)
  assert.equal(shop.menu.find((item) => item.id === 'm_burger').available, true, 'the engine never mutates the shop')

  const already = runTelegramCommand('/86 Grilled Salmon', { shop, role: 'manager' })
  assert.deepEqual(already.actions, [], 'already 86’d is not an action')
  assert.match(already.reply, /already 86’d/)
  assert.deepEqual(runTelegramCommand('/un86 Grilled Salmon', { shop, role: 'manager' }).actions,
    [{ type: 'SET_86', menuItemId: 'm_salmon', available: true, by: 'telegram' }])

  const receive = runTelegramCommand('/receive PO-2026-0100', { shop, role: 'manager' })
  assert.equal(receive.actions[0].type, 'RECEIVE_PURCHASE')
  assert.equal(receive.actions[0].purchaseId, 'po_seed_3')
  assert.match(receive.reply, /Lettuce portion — 4 case → 4 Cases/)
  assert.match(receive.reply, /2 lines land on hand/)
  assert.match(
    runTelegramCommand('/receive PO-9999', { shop, role: 'manager' }).reply,
    /No purchase order matches/,
  )
  assert.match(runTelegramCommand('/receive', { shop, role: 'manager' }).reply, /Which purchase order/)
})

test('updates map a chat to a role', () => {
  const update = {
    update_id: 1,
    message: {
      message_id: 7,
      from: { id: 4242, first_name: 'Nita', last_name: 'Sok' },
      chat: { id: -100123 },
      text: '/86 Ribeye',
    },
  }
  const parsed = parseTelegramUpdate(update, { '-100123': 'manager' })
  assert.deepEqual(parsed, {
    chatId: '-100123', fromId: '4242', userName: 'Nita Sok', text: '/86 Ribeye', role: 'manager', messageId: 7,
  })
  assert.equal(parseTelegramUpdate(update).role, 'staff', 'unmapped chats are staff')
  assert.equal(parseTelegramUpdate({ message: { chat: { id: 1 }, photo: [] } }), null)
  assert.equal(parseTelegramUpdate({ edited_message: { chat: { id: 2 }, text: '/today' } }).role, 'staff')

  assert.deepEqual(parseChatRoles('123:manager, 456:staff ,bad'), { 123: 'manager', 456: 'staff' })
  assert.deepEqual(parseChatRoles('999:owner'), { 999: 'manager' })
  assert.deepEqual(parseChatRoles(''), { '*': 'staff' })
})

test('sending is skipped without a token and never throws when Telegram is down', async () => {
  const skipped = await sendTelegramMessage('1', 'hi')
  assert.equal(skipped.skipped, true)

  const calls = []
  const ok = await sendTelegramMessage('777', 'Net sales $425', {
    token: 'test-token',
    keyboard: [[{ text: '/today' }]],
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, json: async () => ({ result: { message_id: 11 } }) }
    },
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.messageId, 11)
  assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token/sendMessage')
  assert.equal(calls[0].body.chat_id, '777')
  assert.deepEqual(calls[0].body.reply_markup.keyboard, [[{ text: '/today' }]])

  const failed = await sendTelegramMessage('777', 'x', {
    token: 't',
    fetchImpl: async () => { throw new Error('getaddrinfo EAI_AGAIN api.telegram.org') },
  })
  assert.equal(failed.ok, false)
  assert.match(failed.error, /EAI_AGAIN/)

  const rejected = await sendTelegramMessage('777', 'x', {
    token: 't',
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ description: 'chat not found' }) }),
  })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /chat not found/)
})

// ─── The webhook ───────────────────────────────────────────────────

let server = null
let base = ''
const applied = []

before(async () => {
  const app = express()
  app.use(express.json())
  app.use(createTelegramRouter({
    getState: () => buildEmpire(),
    applyAction: (action) => { applied.push(action); return true },
    publicUrl: 'https://restora.test',
  }).router)
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server?.close(resolve)))

const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

test('a staff chat can look but not touch', async () => {
  const res = await post('/api/telegram/webhook', {
    update_id: 2,
    message: { message_id: 1, from: { id: 5, first_name: 'Nita' }, chat: { id: 5 }, text: '/today' },
  })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.role, 'staff')
  assert.equal(body.command, 'today')
  assert.match(body.reply, /Net sales \$425\.00/)
  assert.equal(body.applied, 0)
  assert.equal(body.delivery, 'skipped', 'no token configured in tests')
  assert.equal(applied.length, 0)
})

test('a manager chat changes the book through the shared reducer', async () => {
  applied.length = 0
  const res = await post('/api/telegram/simulate', { text: '/86 Restora burger', role: 'manager', locId: 'downtown' })
  const dry = await res.json()
  assert.equal(dry.applied, 0, 'the simulator never touches the book')
  assert.equal(dry.actions[0].type, 'SET_86')

  const live = await post('/api/telegram/simulate', { text: '/86 Restora burger', role: 'manager', dryRun: false })
  const appliedBody = await live.json()
  assert.equal(appliedBody.applied, 1)
  assert.equal(applied.length, 1)
  assert.equal(applied[0].type, 'SET_86')
  assert.equal(applied[0].menuItemId, 'm_burger')
  assert.equal(applied[0].available, false)

  const webhook = await post('/api/telegram/webhook', {
    message: { message_id: 2, from: { id: 9 }, chat: { id: 9 }, text: '/receive PO-2026-0100' },
  })
  const viaWebhook = await webhook.json()
  assert.equal(viaWebhook.role, 'staff')
  assert.equal(viaWebhook.applied, 0, 'a staff chat cannot receive stock')
  assert.match(viaWebhook.reply, /for managers/)
})

test('the status endpoint explains the wiring', async () => {
  const res = await fetch(`${base}/api/telegram/status`)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.configured, false)
  assert.equal(body.webhookPath, '/api/telegram/webhook')
  assert.equal(body.publicUrl, 'https://restora.test')
  assert.deepEqual(body.chatRoles, { '*': 'staff' })
  assert.equal(body.commands.length, TELEGRAM_COMMANDS.length)
  assert.ok(body.stats.updates >= 2)
  assert.ok(body.stats.commands >= 2)
})

test('the webhook refuses updates without the shared secret and ignores non-text', async () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET
  process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret'
  try {
    const bad = await post('/api/telegram/webhook', { message: { chat: { id: 1 }, text: '/today' } })
    assert.equal(bad.status, 401)
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET
    else process.env.TELEGRAM_WEBHOOK_SECRET = previous
  }
  const photo = await post('/api/telegram/webhook', { message: { chat: { id: 1 }, photo: [{ file_id: 'x' }] } })
  assert.equal((await photo.json()).ignored, 'no text message')

  const empty = await post('/api/telegram/simulate', { text: '   ' })
  assert.equal(empty.status, 400)
})

test('a bot action really changes the location through the reducer', () => {
  let empire = buildEmpire()
  const before = shopOf(empire).menu.find((item) => item.id === 'm_burger').available
  const offer = runTelegramCommand('/86 Restora burger', { shop: shopOf(empire), role: 'manager' })
  for (const action of offer.actions) {
    empire = reducer(empire, { type: 'LOC', locId: 'downtown', action })
  }
  assert.equal(before, true)
  assert.equal(shopOf(empire).menu.find((item) => item.id === 'm_burger').available, false)
  assert.equal(empire.locations.riverside.menu.find((item) => item.id === 'm_burger').available, true, 'one location only')

  const po = shopOf(buildEmpire()).purchases.find((entry) => entry.id === 'po_seed_3')
  const receive = runTelegramCommand('/receive ' + po.number, { shop: shopOf(empire), role: 'manager' })
  let received = empire
  for (const action of receive.actions) received = reducer(received, { type: 'LOC', locId: 'downtown', action })
  assert.equal(shopOf(received).inventory.find((item) => item.id === 'inv_lettuce').onHand, 40 + 24)
  assert.equal(shopOf(received).purchases.find((entry) => entry.id === 'po_seed_3').status, 'received')
})
