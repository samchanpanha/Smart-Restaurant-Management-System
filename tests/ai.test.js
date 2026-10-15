// ─── AI layer ───────────────────────────────────────────────────────
// The provider adapter and the context digest are pure, so most of this
// runs with no server and no network. The router is exercised with an
// injected fetch, and no AI_API_KEY is ever required.

import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { buildEmpire } from '../src/lib/reducer.js'
import {
  AI_INSIGHT_KINDS,
  AI_SCOPES,
  buildAiContext,
  buildMessages,
  hashContext,
} from '../src/lib/ai.js'
import {
  DEFAULT_PROVIDER,
  normalizeProvider,
  providerDefaults,
  providerRequest,
  providerResult,
} from '../src/lib/ai-providers.js'
import { createAiRouter } from '../server/ai.js'

const shopOf = (empire) => empire.locations.downtown

// ─── Provider adapter (pure) ───────────────────────────────────────

test('provider names normalize to a known provider', () => {
  assert.equal(normalizeProvider('OpenAI'), 'openai')
  assert.equal(normalizeProvider('anthropic'), 'anthropic')
  assert.equal(normalizeProvider('nonsense'), DEFAULT_PROVIDER)
  assert.equal(providerDefaults('ollama').baseUrl, 'http://localhost:11434')
  assert.ok(providerDefaults('gemini').model)
})

test('every provider builds a request and reads its own reply shape', () => {
  const args = { model: 'm', baseUrl: 'https://x.test', apiKey: 'k', system: 'SYS', messages: [{ role: 'user', content: 'hi' }] }

  const openai = providerRequest({ provider: 'openai', ...args })
  assert.equal(openai.url, 'https://x.test/chat/completions')
  assert.equal(openai.headers.Authorization, 'Bearer k')
  assert.deepEqual(openai.body.messages[0], { role: 'system', content: 'SYS' })
  assert.equal(providerResult({ provider: 'openai', json: { choices: [{ message: { content: ' hello ' } }] } }).text, 'hello')
  assert.equal(providerResult({ provider: 'openai', json: { error: { message: 'nope' } } }).error, 'nope')

  const anthropic = providerRequest({ provider: 'anthropic', ...args })
  assert.equal(anthropic.url, 'https://x.test/v1/messages')
  assert.equal(anthropic.headers['x-api-key'], 'k')
  assert.equal(anthropic.body.system, 'SYS')
  assert.equal(providerResult({ provider: 'anthropic', json: { content: [{ type: 'text', text: 'yo' }] } }).text, 'yo')

  const gemini = providerRequest({ provider: 'gemini', ...args })
  assert.match(gemini.url, /models\/m:generateContent\?key=k/)
  assert.equal(gemini.body.systemInstruction.parts[0].text, 'SYS')
  assert.equal(gemini.body.contents[0].role, 'user')
  const gem = providerResult({ provider: 'gemini', json: { candidates: [{ content: { parts: [{ text: 'gem' }] } }] } })
  assert.equal(gem.text, 'gem')

  const ollama = providerRequest({ provider: 'ollama', ...args })
  assert.equal(ollama.url, 'https://x.test/api/chat')
  assert.equal(ollama.body.stream, false)
  assert.equal(providerResult({ provider: 'ollama', json: { message: { content: 'local' } } }).text, 'local')

  assert.equal(providerResult({ provider: 'openai', json: {} }).error, 'empty response')
})

// ─── Context digest (pure) ─────────────────────────────────────────

test('ops context carries the live shift but no raw orders or PII', () => {
  const shop = shopOf(buildEmpire())
  const ctx = buildAiContext(shop, { scope: 'ops', locId: 'downtown', now: Date.now() })
  assert.equal(ctx.scope, 'ops')
  assert.equal(ctx.location.id, 'downtown')
  assert.ok(ctx.dashboard && typeof ctx.dashboard.sales === 'number')
  assert.ok(Array.isArray(ctx.alerts))
  assert.ok(Array.isArray(ctx.topSellers))
  assert.ok(Array.isArray(ctx.lowStock))
  assert.ok(Array.isArray(ctx.menu) && ctx.menu.length > 0)
  // No raw ticket/guest arrays leak into the digest.
  assert.equal(ctx.orders, undefined)
  assert.equal(ctx.tables, undefined)
  assert.equal(ctx.inventory, undefined)
})

test('menu scope strips every operational field', () => {
  const shop = shopOf(buildEmpire())
  const ctx = buildAiContext(shop, { scope: 'menu', locId: 'downtown' })
  assert.equal(ctx.scope, 'menu')
  assert.ok(ctx.menu.length > 0)
  assert.equal(ctx.dashboard, undefined)
  assert.equal(ctx.alerts, undefined)
  assert.equal(ctx.lowStock, undefined)
  assert.equal(ctx.salesHistory, undefined)
  assert.equal(ctx.topSellers, undefined)
})

test('guest menu context names ingredients and flags popular dishes', () => {
  const shop = shopOf(buildEmpire())
  const ctx = buildAiContext(shop, { scope: 'menu', locId: 'downtown', lang: 'en' })
  for (const row of ctx.menu) {
    assert.equal(typeof row.available, 'boolean', 'availability is explicit so the model can skip sold-out dishes')
    assert.equal(typeof row.price, 'number')
  }
  const dish = ctx.menu.find((row) => Array.isArray(row.ingredients) && row.ingredients.length)
  assert.ok(dish, 'a recipe-backed dish lists its ingredients by name')
  assert.ok(dish.ingredients.every((name) => typeof name === 'string' && name.length), 'ingredients are names, never quantities')
  assert.ok(ctx.menu.some((row) => row.popular === true), 'at least one dish is flagged popular from real sales')
})

test('insight kinds and scopes are closed sets', () => {
  assert.deepEqual(AI_SCOPES, ['ops', 'menu'])
  assert.ok(AI_INSIGHT_KINDS.includes('briefing'))
  assert.ok(AI_INSIGHT_KINDS.includes('reorder'))
})

test('messages embed the context and the requested language', () => {
  const { system, messages } = buildMessages({
    kind: 'chat', question: 'Food cost?', context: { x: 1 }, lang: 'km',
  })
  assert.match(system, /CONTEXT:\n\{"x":1\}/)
  assert.match(system, /Khmer/)
  assert.equal(messages.at(-1).content, 'Food cost?')

  const insight = buildMessages({ kind: 'menu', context: {}, lang: 'en' })
  assert.match(insight.system, /menu-engineering/i)
})

test('hashContext is deterministic and input-sensitive', () => {
  assert.equal(hashContext({ a: 1 }), hashContext({ a: 1 }))
  assert.notEqual(hashContext({ a: 1 }), hashContext({ a: 2 }))
})

// ─── Router (injected fetch, no network) ───────────────────────────

async function startApp({ apiKey = 'test-key', authed = false, tenantId = 'default', ...overrides } = {}) {
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'canned reply' } }] }) }
  }
  const empire = buildEmpire()
  const ai = createAiRouter({
    getState: () => empire,
    fetchImpl,
    apiKey,
    resolveTenant: (req, _res, next) => { req.tenantId = tenantId; next() },
    ...overrides,
  })
  const app = express()
  app.use(express.json())
  if (authed) app.use((req, _res, next) => { req.auth = { user: { owner_id: 'owner-1' } }; next() })
  app.use(ai.router)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, calls, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('with no key every route is an offline no-op', async () => {
  const app = await startApp({ apiKey: '' })
  try {
    const status = await (await fetch(`${app.base}/api/ai/status`)).json()
    assert.equal(status.configured, false)
    assert.equal(status.provider, 'openai')

    const chat = await fetch(`${app.base}/api/ai/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'hi' }),
    })
    assert.equal(chat.status, 503)
    assert.equal((await chat.json()).configured, false)
    assert.equal(app.calls.length, 0, 'no outbound call without a key')
  } finally {
    await app.close()
  }
})

test('guests read AI status without the server-wide stats', async () => {
  const app = await startApp({ authed: false })
  try {
    const body = await (await fetch(`${app.base}/api/ai/status`)).json()
    assert.equal(body.configured, true)
    assert.ok(Array.isArray(body.providers))
    assert.equal(body.stats, undefined, 'request stats are staff-only')
    assert.equal(body.rateLimit, undefined, 'staff rate limit is not advertised to guests')
  } finally {
    await app.close()
  }
})

test('a chat round-trips through the adapter and caches the repeat', async () => {
  const app = await startApp({ authed: true })
  try {
    const ask = () => fetch(`${app.base}/api/ai/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Food cost?', lang: 'en' }),
    })
    const first = await (await ask()).json()
    assert.equal(first.ok, true)
    assert.equal(first.reply, 'canned reply')
    assert.equal(first.scope, 'ops')
    assert.equal(app.calls.length, 1)

    const second = await (await ask()).json()
    assert.equal(second.cached, true)
    assert.equal(app.calls.length, 1, 'identical context+question is served from cache')
  } finally {
    await app.close()
  }
})

test('guests are pinned to the menu scope', async () => {
  const app = await startApp({ authed: false })
  try {
    const res = await fetch(`${app.base}/api/ai/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'gluten free?', scope: 'ops' }),
    })
    const body = await res.json()
    assert.equal(body.scope, 'menu', 'no session ⇒ menu only, even if ops was requested')
    const systemTurn = app.calls[0].body.messages[0]
    assert.match(systemTurn.content, /"scope":"menu"/)
    assert.doesNotMatch(systemTurn.content, /"dashboard"/)
  } finally {
    await app.close()
  }
})

test('insight returns a suggestion and the rate limit eventually bites', async () => {
  const app = await startApp({ authed: true, rateLimit: 3, guestRateLimit: 1 })
  try {
    const insight = await (await fetch(`${app.base}/api/ai/insight`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'menu', lang: 'en' }),
    })).json()
    assert.equal(insight.ok, true)
    assert.equal(insight.kind, 'menu')

    let last
    for (let i = 0; i < 4; i += 1) {
      last = await fetch(`${app.base}/api/ai/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: `q${i}` }),
      })
    }
    assert.equal(last.status, 429)
    assert.ok(Number(last.headers.get('retry-after')) >= 0)
  } finally {
    await app.close()
  }
})

test('briefing never throws and degrades cleanly without a key', async () => {
  const app = await startApp({ apiKey: '' })
  try {
    const res = await fetch(`${app.base}/api/ai/briefing`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'open' }),
    })
    assert.equal(res.status, 503)
  } finally {
    await app.close()
  }
})

test('a briefing can be pushed through the Telegram hook, even when cached', async () => {
  const delivered = []
  const app = await startApp({
    authed: true,
    tenantId: 'tenant-x',
    onBriefing: async (text, meta) => { delivered.push({ text, meta }); return true },
  })
  const push = () => fetch(`${app.base}/api/ai/briefing`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'close', lang: 'en', deliver: true }),
  })
  try {
    const first = await (await push()).json()
    assert.equal(first.ok, true)
    assert.equal(first.phase, 'close')
    assert.equal(first.delivered, true)
    assert.equal(delivered.length, 1)
    assert.equal(delivered[0].text, 'canned reply')
    assert.equal(delivered[0].meta.phase, 'close')
    assert.equal(delivered[0].meta.tenantId, 'tenant-x', 'the push carries the caller tenant, never a default')

    const again = await (await push()).json()
    assert.equal(again.cached, true, 'the second briefing is cached')
    assert.equal(delivered.length, 2, 'a cached briefing still delivers')
  } finally {
    await app.close()
  }
})
