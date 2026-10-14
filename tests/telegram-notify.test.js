// ─── Telegram: the bot talks first ──────────────────────────────────
// The push side of the bot: notices derived by diffing a state
// transition, and the close-of-day digest. Transport is a fake `send`,
// so the whole file runs offline — exactly how the server behaves with
// no TELEGRAM_BOT_TOKEN.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEmpire, reducer } from '../src/lib/reducer.js'
import { dailyDigest, dateKey, digestDue, noticeText } from '../src/lib/telegram-digest.js'
import { createNotifier, noticesFor } from '../server/notify.js'

const act = (empire, action, locId = 'downtown') => reducer(empire, { type: 'LOC', locId, action })
const shopOf = (empire, locId = 'downtown') => empire.locations[locId]
const diff = (prev, next, action = null) => noticesFor(shopOf(prev), shopOf(next), action, shopOf(next).settings)
const kinds = (rows) => rows.map((row) => row.kind)
const ofKind = (rows, kind) => rows.filter((row) => row.kind === kind)

// The first action of a session also runs the auto-86 sweep (salmon ran out
// mid-service), which is itself news. Warm the book up so each test can look
// at just the transition it is about.
const warm = () => act(buildEmpire(), { type: 'LOG_WASTE', inventoryItemId: 'inv_bun', qty: 1, reason: 'warm-up' })

test('a guest check fires one announcement with the table, the lines, and the total', () => {
  const before = warm()
  const after = act(before, {
    type: 'GUEST_SEND',
    tableId: 't14',
    items: [{ menuItemId: 'm_burger', qty: 2 }, { menuItemId: 'm_soda', qty: 1 }],
  })
  const rows = ofKind(diff(before, after, { type: 'LOC', locId: 'downtown', action: { type: 'GUEST_SEND' } }), 'order')
  assert.equal(rows.length, 1)
  assert.match(rows[0].text, /🧾 Table 14: 2 lines fired from guest · \$35\.00/)
})

test('paying a check is announced with the method and the tip', () => {
  const before = buildEmpire()
  const { currentCheckId } = shopOf(before).tables.find((table) => table.id === 't03')
  const after = act(before, { type: 'PAY_ORDER', orderId: currentCheckId, method: 'card', tip: 4 })
  const rows = diff(before, after)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'paid')
  assert.match(rows[0].text, /💳 Table 3 paid \$47\.00 by card · tip \$4\.00/)
})

test('86’ing a dish and putting it back are two separate announcements', () => {
  let empire = buildEmpire()
  const off = act(empire, { type: 'SET_86', menuItemId: 'm_burger', available: false })
  const offRows = diff(empire, off)
  assert.deepEqual(kinds(offRows), ['86'])
  assert.match(offRows[0].text, /🚫 86’d: Restora Burger/)

  const back = act(off, { type: 'SET_86', menuItemId: 'm_burger', available: true })
  const backRows = diff(off, back)
  assert.deepEqual(kinds(backRows), ['un86'])
  assert.match(backRows[0].text, /✅ Back on the menu: Restora Burger/)
})

test('a purchase order is announced when it is placed and again when stock lands', () => {
  const empire = warm()
  const draft = act(empire, {
    type: 'UPSERT_PURCHASE',
    purchase: {
      id: 'po_notify_1',
      supplierId: 'sup_fish',
      status: 'draft',
      lines: [{ id: 'l1', inventoryItemId: 'inv_salmon', qty: 12, unitCost: 6.1 }],
    },
  })
  assert.deepEqual(kinds(diff(empire, draft)), []) // a draft is not news

  const placed = act(draft, { type: 'SET_PURCHASE_STATUS', purchaseId: 'po_notify_1', status: 'ordered' })
  const placedRows = ofKind(diff(draft, placed), 'purchase')
  assert.equal(placedRows.length, 1)
  assert.match(placedRows[0].text, /📝 .* sent to Harbor Fish · \$73\.20/)

  const received = act(placed, { type: 'RECEIVE_PURCHASE', purchaseId: 'po_notify_1' })
  const receivedRows = ofKind(diff(placed, received), 'purchase')
  assert.equal(receivedRows.length, 1)
  assert.match(receivedRows[0].text, /📦 .* received from Harbor Fish · \$73\.20/)
})

test('stock dropping under par is announced once, and stays quiet after that', () => {
  const before = warm()
  const low = act(before, { type: 'LOG_WASTE', inventoryItemId: 'inv_bun', qty: 30, reason: 'spoiled' })
  const first = diff(before, low)
  assert.deepEqual(kinds(first), ['lowStock'])
  assert.match(first[0].text, /📉 Low Brioche bun — 33 ea left \(par 40 ea\)/)

  // Nothing else moved: a second, smaller loss on an already-low item is not news.
  const quieter = act(low, { type: 'LOG_WASTE', inventoryItemId: 'inv_bun', qty: 2, reason: 'dropped' })
  assert.deepEqual(diff(low, quieter), [])
})

test('notices are capped so one wild action cannot spam a chat', () => {
  let empire = buildEmpire()
  const before = shopOf(empire)
  const after = {
    ...before,
    menu: before.menu.map((item) => ({ ...item, available: false })),
  }
  const rows = noticesFor(before, after, null, before.settings)
  assert.equal(rows.length, 4)
  assert.equal(rows.every((row) => row.kind === '86'), true)
})

test('the notifier pushes to the settings chat and the mapped chats, once each', async () => {
  const sent = []
  const notifier = createNotifier({
    getState: () => buildEmpire(),
    chatRoles: { '-100123': 'manager', '*': 'staff' },
    send: async (chatId, text) => { sent.push({ chatId, text }); return { ok: true } },
  })
  const before = warm()
  before.locations.downtown.settings.telegram.chatId = '555'
  const after = act(before, { type: 'LOG_WASTE', inventoryItemId: 'inv_bun', qty: 30, reason: 'spoiled' })
  notifier.handleAction(before, after, { type: 'LOC', locId: 'downtown', action: { type: 'LOG_WASTE' } })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(sent.map((row) => row.chatId), ['555', '-100123'])
  assert.equal(sent[0].text, sent[1].text)
  assert.match(sent[0].text, /📉 Low Brioche bun/)
  assert.deepEqual(notifier.targets(shopOf(after).settings), ['555', '-100123'])

  // Say /start once from a new phone and it starts receiving pushes too.
  notifier.registerChat('777')
  assert.deepEqual(notifier.targets(shopOf(after).settings), ['555', '777', '-100123'])
  assert.equal(notifier.stats.delivered, 2)
  assert.equal(notifier.stats.notices, 1)
})

test('with no chat configured the notice is a recorded skip, never an error', async () => {
  const notifier = createNotifier({ getState: () => buildEmpire(), chatRoles: {}, send: async () => ({ skipped: true }) })
  const result = await notifier.deliver('hello?', { telegram: { chatId: '' } })
  assert.equal(result.sent, 0)
  assert.equal(result.skipped, true)
  assert.match(result.reason, /no chat configured/)
  assert.equal(notifier.stats.failed, 0)
})

test('the close-of-day digest goes out once per day, after its hour', async () => {
  const sent = []
  const empire = buildEmpire()
  shopOf(empire).settings.telegram.chatId = '555'
  shopOf(empire).settings.telegram.notifyDailyDigest = true
  shopOf(empire).settings.telegram.digestHour = 22
  const notifier = createNotifier({
    getState: () => empire,
    chatRoles: {},
    send: async (chatId, text) => { sent.push({ chatId, text }); return { ok: true } },
  })
  const at = new Date('2026-10-13T22:05:00').getTime()
  const first = await notifier.tick(at)
  assert.ok(first)
  assert.equal(first.sent, 1)
  const again = await notifier.tick(at + 60_000) // same day: nothing twice…
  assert.equal(again.sent, null)
  assert.equal(again.blocked, 'already sent today')
  assert.equal(sent.length, 1)
  assert.equal(notifier.stats.digestKey, dateKey(at))

  // …but the screen's "send it now" button can preview and force it.
  const preview = notifier.preview(at)
  assert.match(preview.text, /Close of day · Restora/)
  const forced = await notifier.tick(at + 120_000, { force: true })
  assert.equal(forced.sent, 1)
  assert.equal(sent.length, 2)
})

test('the digest reads like a close-of-day note: sales, buying, what to order', () => {
  // The seed builds its orders relative to "now", so pin the clock to the
  // evening the digest describes — otherwise the numbers drift with the
  // day the suite happens to run on.
  const at = new Date('2026-10-13T22:00:00').getTime()
  const realNow = Date.now
  Date.now = () => at
  try {
    const shop = shopOf(buildEmpire())
    const digest = dailyDigest(shop, at)
    assert.equal(digest.key, dateKey(at))
    assert.match(digest.text, /Close of day · Restora/)
    assert.match(digest.text, /Checks 8 · Net sales \$425\.00 · Avg check \$66\.50/)
    assert.match(digest.text, /Food cost 22\.4% \(\$95\.11\)/)
    assert.match(digest.text, /Top sellers: Restora Burger 6× \(\$96\.00\)/)
    assert.match(digest.text, /Needs ordering: OUT Salmon fillet — 0 ea left \(par 12 ea\)/)
  } finally {
    Date.now = realNow
  }
})

test('digestDue honours the switch, the hour, and the day already sent', () => {
  const at = new Date('2026-10-13T09:00:00').getTime()
  const base = { telegram: { notifyDailyDigest: true, digestHour: 22 } }
  assert.equal(digestDue(base, at, null), false) // too early
  assert.equal(digestDue(base, new Date('2026-10-13T22:00:00').getTime(), null), true)
  assert.equal(digestDue(base, new Date('2026-10-13T23:00:00').getTime(), '2026-10-13'), false)
  assert.equal(digestDue({ telegram: { notifyDailyDigest: false, digestHour: 0 } }, at, null), false)
})

test('noticeText stays silent about transitions that are not news', () => {
  assert.equal(noticeText('purchase', { status: 'draft', number: 'PO-1', vendor: 'X' }), null)
  assert.equal(noticeText('purchase', { status: 'cancelled' }), null)
  assert.equal(noticeText('something-else', {}), null)
  assert.equal(noticeText('86', {}), '🚫 86’d: item')
})
