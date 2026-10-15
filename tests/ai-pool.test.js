// ─── Multi-key AI: providers, pool, failover ─────────────────────────
// Restora can hold several keys — several DeepSeek keys, a Qwen key, a free
// vendor, a local Ollama — and walks them in order when one is rate limited,
// out of quota, or down. Three layers are covered here:
//
//   src/lib/ai-providers.js  — the vendor catalogue and the four wire shapes
//   server/ai.js             — mergeAiConfig / buildAttempts + failover router
//   server/ai-config.js      — the owner-facing save path (secrets stay in)
//
// Everything runs offline with an injected fetch; no key is ever real.

import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { buildEmpire } from '../src/lib/reducer.js'
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  listProviders,
  normalizeProvider,
  providerMeta,
  providerNeedsKey,
  providerRequest,
  providerResult,
} from '../src/lib/ai-providers.js'
import { buildAttempts, createAiRouter, mergeAiConfig, normalizeKeyPool, parseEnvKeys } from '../server/ai.js'
import { createAiConfigRouter } from '../server/ai-config.js'

// ─── Provider catalogue ────────────────────────────────────────────

test('the vendors people actually asked for are in the catalogue', () => {
  for (const id of ['deepseek', 'qwen', 'groq', 'openrouter', 'mistral', 'cerebras', 'zhipu', 'moonshot', 'xai', 'together', 'perplexity', 'gemini', 'openai', 'anthropic', 'ollama', 'lmstudio']) {
    assert.ok(PROVIDERS[id], `${id} is a known provider`)
  }
  assert.equal(PROVIDERS.deepseek.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(PROVIDERS.deepseek.defaultModel, 'deepseek-chat')
  assert.match(PROVIDERS.qwen.baseUrl, /dashscope-intl.*compatible-mode\/v1$/)
  assert.equal(PROVIDERS.qwen.defaultModel, 'qwen-plus')
  assert.ok(PROVIDERS.qwen.alternates.some((entry) => /dashscope\.aliyuncs\.com/.test(entry.baseUrl)), 'the mainland endpoint is offered as an alternate')
  assert.equal(PROVIDERS.openrouter.defaultModel.endsWith(':free'), true, 'OpenRouter defaults to a free model')
  assert.equal(providerNeedsKey('ollama'), false)
  assert.equal(providerNeedsKey('lmstudio'), false)
  assert.equal(providerNeedsKey('deepseek'), true)
})

test('aliases and unknown names resolve predictably', () => {
  assert.equal(normalizeProvider('DashScope'), 'qwen')
  assert.equal(normalizeProvider('kimi'), 'moonshot')
  assert.equal(normalizeProvider('GLM'), 'zhipu')
  assert.equal(normalizeProvider('claude'), 'anthropic')
  assert.equal(normalizeProvider('grok'), 'xai')
  assert.equal(normalizeProvider('lm-studio'), 'lmstudio')
  assert.equal(normalizeProvider('nonsense'), DEFAULT_PROVIDER)
  assert.equal(normalizeProvider(''), DEFAULT_PROVIDER)
})

test('every catalogued vendor builds a request and reads a reply', () => {
  const args = { model: 'm', baseUrl: 'https://x.test', apiKey: 'k', system: 'SYS', messages: [{ role: 'user', content: 'hi' }] }
  for (const id of Object.keys(PROVIDERS)) {
    const req = providerRequest({ provider: id, ...args })
    assert.ok(req.url.startsWith('https://x.test'), `${id} uses the configured base URL`)
    assert.equal(typeof req.body, 'object')
    const wire = providerMeta(id).wire
    const body = wire === 'anthropic'
      ? { content: [{ type: 'text', text: 'ok' }] }
      : wire === 'gemini'
        ? { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }
        : wire === 'ollama'
          ? { message: { content: 'ok' } }
          : { choices: [{ message: { content: 'ok' } }] }
    assert.equal(providerResult({ provider: id, json: body }).text, 'ok', `${id} reads its own reply shape`)
  }
})

test('OpenAI-compatible vendors send a bearer token; OpenRouter adds attribution', () => {
  const deepseek = providerRequest({ provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(deepseek.url, 'https://api.deepseek.com/v1/chat/completions')
  assert.equal(deepseek.headers.Authorization, 'Bearer sk-ds')

  const qwen = providerRequest({ provider: 'qwen', apiKey: 'sk-qw', messages: [] })
  assert.match(qwen.url, /dashscope-intl\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions$/)
  assert.equal(qwen.body.model, 'qwen-plus')

  const openrouter = providerRequest({ provider: 'openrouter', apiKey: 'sk-or', messages: [] })
  assert.equal(openrouter.headers['X-Title'], 'Restora')
  assert.ok(openrouter.headers['HTTP-Referer'].startsWith('https://'))
})

test('the provider catalogue sent to the browser carries no secrets', () => {
  const catalogue = listProviders()
  assert.ok(catalogue.length >= 16)
  for (const entry of catalogue) {
    assert.ok(entry.id && entry.label && entry.defaultModel)
    assert.ok(Array.isArray(entry.models) && entry.models.length)
    assert.ok(['free', 'cheap', 'paid', 'local'].includes(entry.tier), `${entry.id} declares a tier`)
    assert.equal(entry.apiKey, undefined)
  }
  assert.ok(catalogue.filter((entry) => entry.tier === 'free').length >= 5, 'several genuinely free options are offered')
})

// ─── Key pool (pure) ───────────────────────────────────────────────

test('the key pool drops unusable entries and keeps local ones', () => {
  const pool = normalizeKeyPool([
    { id: 'a', provider: 'deepseek', apiKey: 'sk-1' },
    { provider: 'deepseek', apiKey: '   ' }, // no key ⇒ dropped
    null,
    { id: 'c', provider: 'ollama' }, // local ⇒ kept without a key
    { id: 'd', provider: 'qwen', apiKey: 'sk-2', model: 'qwen-max', enabled: false },
  ], 'deepseek')

  assert.deepEqual(pool.map((entry) => entry.id), ['a', 'c', 'd'])
  assert.equal(pool[0].provider, 'deepseek')
  assert.equal(pool[0].model, 'deepseek-chat', 'a named provider brings its default model')
  assert.equal(pool[1].provider, 'ollama')
  assert.equal(pool[2].enabled, false)
  assert.equal(normalizeKeyPool(Array.from({ length: 30 }, (_, index) => ({ id: `k${index}`, apiKey: `sk-${index}` }))).length, 12, 'the pool is capped')
})

test('AI_KEYS accepts a comma list or a JSON array', () => {
  const simple = parseEnvKeys('sk-a, sk-b\nsk-c', 'deepseek')
  assert.deepEqual(simple.map((entry) => entry.apiKey), ['sk-a', 'sk-b', 'sk-c'])
  assert.equal(simple[0].provider, 'deepseek')
  assert.equal(simple[0].id, 'env-1')

  const mixed = parseEnvKeys(JSON.stringify([{ provider: 'qwen', apiKey: 'sk-q' }, { provider: 'groq', apiKey: 'sk-g' }]), 'deepseek')
  assert.deepEqual(mixed.map((entry) => entry.provider), ['qwen', 'groq'])

  assert.deepEqual(parseEnvKeys('', 'openai'), [])
  assert.deepEqual(parseEnvKeys('[not json', 'openai'), [])
})

test('attempts run primary → backup keys → environment, with no duplicates', () => {
  const attempts = buildAttempts({
    primary: { id: 'primary', label: 'Primary key', provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-primary' },
    pool: [
      { id: 'key-2', provider: 'deepseek', apiKey: 'sk-second' },
      { id: 'key-3', provider: 'deepseek', apiKey: 'sk-primary' }, // duplicate secret
      { id: 'key-4', provider: 'qwen', apiKey: 'sk-qwen' },
    ],
    environment: [{ id: 'env-1', provider: 'groq', apiKey: 'sk-groq', source: 'environment' }],
  })
  assert.deepEqual(attempts.map((entry) => entry.id), ['primary', 'key-2', 'key-4', 'env-1'], 'order and de-duplication')
  assert.equal(attempts.find((entry) => entry.id === 'key-4').model, 'qwen-plus', 'a pool entry without a model gets its vendor default')
  assert.equal(attempts.find((entry) => entry.id === 'env-1').source, 'environment')
})

test('a keyless primary simply drops out of the chain', () => {
  const attempts = buildAttempts({
    primary: { id: 'primary', provider: 'openai', apiKey: '' },
    pool: [{ id: 'key-1', provider: 'deepseek', apiKey: 'sk-1' }],
  })
  assert.deepEqual(attempts.map((entry) => entry.id), ['key-1'])
  assert.deepEqual(buildAttempts({ primary: { id: 'primary', provider: 'openai', apiKey: '' } }), [], 'nothing to try ⇒ nothing to try')
})

test('mergeAiConfig keeps its old shape and adds the chain', () => {
  const env = { provider: 'openai', model: 'env-model', apiKey: 'env-key' }
  const mixed = mergeAiConfig({ apiKey: 'tenant-key', keys: [{ id: 'k2', provider: 'deepseek', apiKey: 'sk-2' }] }, env)
  assert.equal(mixed.provider, 'openai')
  assert.equal(mixed.apiKey, 'tenant-key', 'field-by-field override is unchanged')
  assert.equal(mixed.source, 'tenant')
  assert.equal(mixed.attempts.length, 3, 'primary + backup + env fallback')
  assert.deepEqual(mixed.attempts.map((entry) => entry.id), ['primary', 'k2', 'env-primary'])
  assert.equal(mixed.rotate, false, 'rotation is opt-in')

  const rotating = mergeAiConfig({ provider: 'qwen', apiKey: 'k', rotate: true }, {})
  assert.equal(rotating.rotate, true)
  assert.equal(rotating.model, 'qwen-plus', 'a named provider still gets its own default model')

  const local = mergeAiConfig({ provider: 'ollama' }, {})
  assert.equal(local.attempts.length, 1, 'a local provider needs no key to be configured')
  assert.equal(local.attempts[0].local, true)
  assert.equal(mergeAiConfig(null, {}).attempts.length, 0)
})

test('AI_KEYS in the environment is folded into the chain', () => {
  const merged = mergeAiConfig(null, { provider: 'deepseek', apiKey: 'sk-main', keys: 'sk-a,sk-b' })
  assert.deepEqual(merged.attempts.map((entry) => entry.apiKey), ['sk-main', 'sk-a', 'sk-b'])
})

// ─── Failover router ───────────────────────────────────────────────

function startRouter({ stored = null, env = {}, fetchImpl, authed = true, ...overrides } = {}) {
  const calls = []
  const empire = buildEmpire()
  const ai = createAiRouter({
    getState: () => empire,
    resolveConfig: () => stored,
    provider: env.provider || 'openai',
    model: env.model || '',
    baseUrl: env.baseUrl || '',
    apiKey: env.apiKey || '',
    fetchImpl: fetchImpl || (async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body || '{}') })
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'canned reply' } }] }) }
    }),
    resolveTenant: (req, _res, next) => { req.tenantId = 'tenant-a'; next() },
    now: () => NOW.value,
    ...overrides,
  })
  const app = express()
  app.use(express.json())
  if (authed) app.use((req, _res, next) => { req.auth = { user: { owner_id: 'owner-1' } }; next() })
  app.use(ai.router)
  return {
    calls,
    ai,
    listen: async () => {
      const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s))
      })
      return {
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
      }
    },
  }
}

const NOW = { value: 1_700_000_000_000 }
// Each call asks something different: identical context+question is served
// from the response cache, which would hide the key that actually answered.
let askCount = 0
const ask = (base) => fetch(`${base}/api/ai/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: `food cost? (${(askCount += 1)})`, lang: 'en' }),
})

test('a failing primary key fails over to the backup key', async () => {
  const attemptsByUrl = []
  const fetchImpl = async (url) => {
    attemptsByUrl.push(url)
    if (url.startsWith('https://api.deepseek.com')) {
      return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) }
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'backup answered' } }] }) }
  }
  const router = startRouter({
    stored: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-primary',
      keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-qwen' }],
    },
    fetchImpl,
  })
  const app = await router.listen()
  try {
    const body = await (await ask(app.base)).json()
    assert.equal(body.ok, true)
    assert.equal(body.reply, 'backup answered')
    assert.equal(body.failover, true, 'the caller can see a backup answered')
    assert.equal(body.provider, 'qwen')
    assert.equal(body.via, 'key-2')
    assert.equal(attemptsByUrl.length, 2)
    assert.ok(body.reply && !JSON.stringify(body).includes('sk-primary'), 'no key material in the response')
  } finally {
    await app.close()
  }
})

test('a key that just failed is parked, so the next request skips it', async () => {
  let primaryHits = 0
  const fetchImpl = async (url) => {
    if (url.startsWith('https://api.deepseek.com')) {
      primaryHits += 1
      return { ok: false, status: 401, json: async () => ({ error: { message: 'invalid key' } }) }
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'backup' } }] }) }
  }
  const router = startRouter({
    stored: { provider: 'deepseek', apiKey: 'sk-dead', keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-qwen' }] },
    fetchImpl,
  })
  const app = await router.listen()
  try {
    await (await ask(app.base)).json()
    assert.equal(primaryHits, 1)
    const second = await (await ask(app.base)).json()
    assert.equal(second.ok, true)
    assert.equal(primaryHits, 1, 'the dead key stayed parked during its cooldown')
    assert.equal(second.failover, false, 'the backup is now first in line')
  } finally {
    await app.close()
  }
})

test('the cooldown expires and the primary is tried again', async () => {
  let primaryHits = 0
  const fetchImpl = async (url) => {
    if (url.startsWith('https://api.deepseek.com')) {
      primaryHits += 1
      return primaryHits === 1
        ? { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }
        : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'recovered' } }] }) }
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'backup' } }] }) }
  }
  const router = startRouter({
    stored: { provider: 'deepseek', apiKey: 'sk-flaky', keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-qwen' }] },
    fetchImpl,
    cooldownMs: 1000,
  })
  const app = await router.listen()
  try {
    await (await ask(app.base)).json()
    NOW.value += 1500
    const body = await (await ask(app.base)).json()
    assert.equal(body.reply, 'recovered')
    assert.equal(body.failover, false)
    assert.equal(primaryHits, 2)
  } finally {
    NOW.value = 1_700_000_000_000
    await app.close()
  }
})

test('rotate spreads requests across every key', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
  }
  const router = startRouter({
    stored: {
      provider: 'deepseek',
      apiKey: 'sk-1',
      rotate: true,
      keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-2' }],
    },
    fetchImpl,
  })
  const app = await router.listen()
  try {
    const first = await (await ask(app.base)).json()
    const second = await (await ask(app.base)).json()
    assert.notEqual(first.via, second.via, 'the second request took the next key')
    assert.deepEqual(seen.map((url) => new URL(url).host), ['api.deepseek.com', 'dashscope-intl.aliyuncs.com'])
  } finally {
    await app.close()
  }
})

test('a local provider is configured without any key at all', async () => {
  const router = startRouter({ stored: { provider: 'ollama', model: 'qwen3' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ message: { content: 'local answer' } }) }) })
  const app = await router.listen()
  try {
    const body = await (await ask(app.base)).json()
    assert.equal(body.ok, true)
    assert.equal(body.reply, 'local answer')
    assert.equal(body.model, 'qwen3')
  } finally {
    await app.close()
  }
})

test('when everything fails the caller gets one honest error and the list of tries', async () => {
  const router = startRouter({
    stored: { provider: 'deepseek', apiKey: 'sk-1', keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-2' }] },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'upstream down' } }) }),
  })
  const app = await router.listen()
  try {
    const res = await ask(app.base)
    assert.equal(res.status, 502)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'upstream down')
    assert.deepEqual(body.tried.map((entry) => entry.id), ['primary', 'key-2'])
  } finally {
    await app.close()
  }
})

test('status exposes pool health to staff and nothing to guests', async () => {
  const router = startRouter({
    stored: { provider: 'deepseek', apiKey: 'super-secret-primary', keys: [{ id: 'key-2', label: 'Kitchen key', provider: 'qwen', apiKey: 'super-secret-qwen' }] },
  })
  const app = await router.listen()
  try {
    const staff = await (await fetch(`${app.base}/api/ai/status`)).json()
    assert.equal(staff.keyCount, 2)
    assert.equal(staff.pool.length, 2)
    assert.deepEqual(staff.pool.map((entry) => entry.id), ['primary', 'key-2'])
    assert.equal(staff.pool[1].label, 'Kitchen key')
    assert.ok(staff.pool.every((entry) => entry.hasKey && !('apiKey' in entry)))
    assert.equal(staff.rotate, false)

  } finally {
    await app.close()
  }

  const guestRouter = startRouter({ authed: false, stored: { provider: 'deepseek', apiKey: 'super-secret-primary' } })
  const guestApp = await guestRouter.listen()
  try {
    const guest = await (await fetch(`${guestApp.base}/api/ai/status`)).json()
    assert.equal(guest.pool, undefined, 'a guest never sees pool health')
    assert.equal(guest.keyCount, undefined)
  } finally {
    await guestApp.close()
  }
})

test('the connectivity probe can target one stored key', async () => {
  const seen = []
  const router = startRouter({
    stored: { provider: 'deepseek', apiKey: 'sk-primary', keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-qwen' }] },
    fetchImpl: async (url) => {
      seen.push(new URL(url).host)
      return { ok: url.includes('dashscope'), status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) }
    },
  })
  const app = await router.listen()
  try {
    const primary = await router.ai.probe('tenant-a', null)
    assert.equal(primary.ok, false, 'the primary is the only one probed by default')

    const backup = await router.ai.probe('tenant-a', { keyId: 'key-2' })
    assert.equal(backup.ok, true)
    assert.equal(backup.via, 'key-2')
    assert.equal(backup.provider, 'qwen')
    assert.deepEqual(seen, ['api.deepseek.com', 'dashscope-intl.aliyuncs.com'])
  } finally {
    await app.close()
  }
})

// ─── Owner-facing save path ────────────────────────────────────────

async function bootConfigApp({ stored = null, env = {}, probe = null } = {}) {
  const state = { stored }
  const router = createAiConfigRouter({
    requireAdmin: (_req, _res, next) => next(),
    getConfig: () => state.stored,
    setConfig: (_tenantId, config) => { state.stored = config },
    probe,
    env,
  })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = { user: { owner_id: 'owner-1' } }; next() })
  app.use(router.router)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  return { base: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((resolve) => server.close(resolve)) }
}

const put = (base, payload) => fetch(`${base}/api/ai/config`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

test('saving a key pool persists it and never echoes a secret', async () => {
  const app = await bootConfigApp()
  try {
    const res = await put(app.base, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-primary-secret',
      rotate: true,
      keys: [
        { id: 'key-2', label: 'Backup DeepSeek', provider: 'deepseek', apiKey: 'sk-backup-secret' },
        { id: 'key-3', label: 'Local box', provider: 'ollama', baseUrl: 'http://10.0.0.9:11434' },
      ],
    })
    const raw = await res.text()
    assert.equal(res.status, 200)
    assert.ok(!raw.includes('sk-primary-secret') && !raw.includes('sk-backup-secret'), 'keys are write-only')
    const body = JSON.parse(raw)
    assert.equal(body.configured, true)
    assert.equal(body.keyCount, 3, 'primary + two backups are in the chain')
    assert.equal(body.poolCount, 2)
    assert.equal(body.rotate, true)
    assert.deepEqual(body.keys.map((entry) => entry.id), ['key-2', 'key-3'])
    assert.deepEqual(body.keys.map((entry) => entry.label), ['Backup DeepSeek', 'Local box'])
    assert.equal(body.keys[0].hasKey, true)
    assert.equal(app.state.stored.keys.length, 2)
    assert.equal(app.state.stored.keys[0].apiKey, 'sk-backup-secret', 'the secret is stored server-side')
    assert.equal(app.state.stored.rotate, true)
  } finally {
    await app.close()
  }
})

test('editing a key’s label without re-pasting it keeps the stored secret', async () => {
  const app = await bootConfigApp({
    stored: { provider: 'deepseek', apiKey: 'sk-primary', keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-qwen', label: 'old label' }] },
  })
  try {
    const body = await (await put(app.base, { keys: [{ id: 'key-2', provider: 'qwen', label: 'Kitchen tablet' }] })).json()
    assert.equal(app.state.stored.keys[0].apiKey, 'sk-qwen', 'the stored key survived an edit that omitted it')
    assert.equal(app.state.stored.keys[0].label, 'Kitchen tablet')
    assert.equal(body.keys[0].label, 'Kitchen tablet')
  } finally {
    await app.close()
  }
})

test('disabling a key removes it from the chain but keeps it stored', async () => {
  const app = await bootConfigApp({ stored: { provider: 'deepseek', apiKey: 'sk-primary', keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-qwen' }] } })
  try {
    const body = await (await put(app.base, { keys: [{ id: 'key-2', provider: 'qwen', enabled: false }] })).json()
    assert.equal(body.keyCount, 1, 'only the primary is tried')
    assert.equal(body.keys[0].enabled, false, 'the key is still stored, just off')
    assert.equal(app.state.stored.keys[0].apiKey, 'sk-qwen')
  } finally {
    await app.close()
  }
})

test('the pool is capped and keyless cloud entries are refused', async () => {
  const app = await bootConfigApp({ stored: { provider: 'deepseek', apiKey: 'sk-primary' } })
  try {
    const many = Array.from({ length: 20 }, (_, index) => ({ id: `k${index}`, provider: 'deepseek', apiKey: `sk-${index}` }))
    const body = await (await put(app.base, { keys: many })).json()
    assert.equal(app.state.stored.keys.length, 12, 'at most 12 backup keys')
    assert.equal(body.poolCount, 12)

    // An entry that names an existing id inherits its key; a brand-new
    // keyless cloud entry is refused outright.
    await put(app.base, { keys: [{ id: 'k0', provider: 'deepseek' }] })
    assert.equal(app.state.stored.keys.length, 1, 'the known key was kept after a label-only edit')
    await put(app.base, { keys: [{ id: 'brand-new', provider: 'deepseek' }] })
    assert.equal(app.state.stored.keys, undefined, 'a cloud entry with no key is not stored')
  } finally {
    await app.close()
  }
})

test('removing the keys clears the primary and the whole pool', async () => {
  const app = await bootConfigApp({ stored: { provider: 'deepseek', apiKey: 'sk-primary', keys: [{ id: 'key-2', provider: 'qwen', apiKey: 'sk-qwen' }] } })
  try {
    const body = await (await put(app.base, { apiKey: '', removeKey: true })).json()
    assert.equal(app.state.stored.apiKey, undefined)
    assert.equal(app.state.stored.keys, undefined)
    assert.equal(body.keyCount, 0)
    assert.equal(body.configured, false)
    assert.equal(body.keySource, 'none')
  } finally {
    await app.close()
  }
})

test('the environment still configures a tenant that has saved nothing', async () => {
  const app = await bootConfigApp({ env: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'env-key', keys: 'env-backup' } })
  try {
    const body = await (await fetch(`${app.base}/api/ai/config`)).json()
    assert.equal(body.configured, true)
    assert.equal(body.keySource, 'environment')
    assert.equal(body.keyCount, 2, 'AI_KEYS joins the env key in the chain')
  } finally {
    await app.close()
  }
})

test('the test route passes keyId through to the probe', async () => {
  const calls = []
  const probe = async (tenantId, override) => {
    calls.push({ tenantId, override })
    return { ok: true, reply: 'OK', provider: 'qwen', model: 'qwen-plus', via: 'key-2' }
  }
  const app = await bootConfigApp({ probe })
  try {
    const res = await fetch(`${app.base}/api/ai/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId: 'key-2' }),
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).via, 'key-2')
    assert.equal(calls[0].override.keyId, 'key-2')
    assert.equal(app.state.stored, null, 'testing never persists')
  } finally {
    await app.close()
  }
})
