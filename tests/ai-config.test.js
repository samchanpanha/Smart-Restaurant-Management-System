// ─── AI provider config ─────────────────────────────────────────────
// Two layers: the pure env/stored merge (server/ai.js) and the privileged
// config router (server/ai-config.js). The router is exercised against
// stub storage so it needs no database; a small round-trip covers the
// kv-backed persistence in server/db.js.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import express from 'express'
import { mergeAiConfig } from '../server/ai.js'
import { createAiConfigRouter } from '../server/ai-config.js'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'restora-ai-config-'))
process.env.RESTORA_DATA = dataDir
const { closeDatabase, getAiConfig, setAiConfig } = await import('../server/db.js')

after(() => {
  closeDatabase()
  rmSync(dataDir, { recursive: true, force: true })
})

// ─── mergeAiConfig (pure) ──────────────────────────────────────────

test('a tenant config overrides the environment, field by field', () => {
  const env = { provider: 'openai', model: 'env-model', baseUrl: 'https://env', apiKey: 'env-key' }

  // No stored config ⇒ pure environment.
  const envOnly = mergeAiConfig(null, env)
  assert.equal(envOnly.provider, 'openai')
  assert.equal(envOnly.model, 'env-model')
  assert.equal(envOnly.apiKey, 'env-key')
  assert.equal(envOnly.source, 'environment')

  // Tenant key wins; unset fields still fall back to env.
  const mixed = mergeAiConfig({ apiKey: 'tenant-key' }, env)
  assert.equal(mixed.apiKey, 'tenant-key')
  assert.equal(mixed.model, 'env-model')
  assert.equal(mixed.source, 'tenant')

  // Tenant names a provider but no model ⇒ that provider's default, not env's.
  const switched = mergeAiConfig({ provider: 'ollama', apiKey: 'k' }, env)
  assert.equal(switched.provider, 'ollama')
  assert.equal(switched.model, 'llama3.1')

  // Nothing anywhere ⇒ unconfigured.
  const none = mergeAiConfig(null, {})
  assert.equal(none.apiKey, '')
  assert.equal(none.source, 'none')
})

// ─── Config router (stubbed storage) ───────────────────────────────

async function bootApp(opts = {}) {
  const { canManage = true, env = {}, probe = null } = opts
  const state = { stored: opts.stored || null }
  const router = createAiConfigRouter({
    requireAdmin: (req, res, next) => (canManage ? next() : res.status(403).json({ error: 'owner access required' })),
    getConfig: () => state.stored,
    setConfig: (_ownerId, config) => { state.stored = config },
    probe: probe || null,
    env,
  })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = { user: { owner_id: 'owner-1', is_super_admin: false } }; next() })
  app.use(router.router)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, state, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('non-owner callers are rejected with 403', async () => {
  const app = await bootApp({ canManage: false })
  try {
    const get = await fetch(`${app.base}/api/ai/config`)
    assert.equal(get.status, 403)
    const put = await fetch(`${app.base}/api/ai/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'x' }),
    })
    assert.equal(put.status, 403)
    assert.equal(app.state.stored, null, 'a blocked request never writes')
  } finally {
    await app.close()
  }
})

test('GET reports the catalogue but never the stored key', async () => {
  const app = await bootApp({ stored: { provider: 'openai', model: 'gpt-x', apiKey: 'super-secret' } })
  try {
    const res = await fetch(`${app.base}/api/ai/config`)
    const raw = await res.text()
    assert.equal(res.status, 200)
    assert.ok(!raw.includes('super-secret'), 'the key value must not appear in the response')
    const body = JSON.parse(raw)
    assert.equal(body.configured, true)
    assert.equal(body.hasKey, true)
    assert.equal(body.keySource, 'tenant')
    assert.equal(body.model, 'gpt-x')
    assert.equal(body.apiKey, undefined)
    assert.ok(Array.isArray(body.providers) && body.providers.some((p) => p.id === 'openai'))
  } finally {
    await app.close()
  }
})

test('PUT saves a key and normalizes an unknown provider', async () => {
  const app = await bootApp()
  try {
    const res = await fetch(`${app.base}/api/ai/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'Nonsense', model: 'm1', baseUrl: 'https://proxy.test', apiKey: 'new-key' }),
    })
    assert.equal(res.status, 200)
    const raw = await res.text()
    assert.ok(!raw.includes('new-key'), 'the key is write-only')
    assert.equal(app.state.stored.provider, 'openai', 'unknown provider falls back to the default')
    assert.equal(app.state.stored.apiKey, 'new-key')
    assert.equal(app.state.stored.baseUrl, 'https://proxy.test')
  } finally {
    await app.close()
  }
})

test('PUT rejects a malformed base URL without writing', async () => {
  const app = await bootApp()
  try {
    const res = await fetch(`${app.base}/api/ai/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'ftp://not-http', apiKey: 'k' }),
    })
    assert.equal(res.status, 400)
    assert.equal(app.state.stored, null)
  } finally {
    await app.close()
  }
})

test('PUT with an empty key clears it and falls back to the environment', async () => {
  const app = await bootApp({ stored: { provider: 'openai', apiKey: 'old' }, env: { apiKey: 'env-key' } })
  try {
    const res = await fetch(`${app.base}/api/ai/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: '' }),
    })
    const body = await res.json()
    assert.equal(app.state.stored.apiKey, undefined)
    assert.equal(body.hasKey, false)
    assert.equal(body.configured, true, 'still configured via the environment key')
    assert.equal(body.keySource, 'environment')
  } finally {
    await app.close()
  }
})

test('the test route forwards an unsaved override to the probe', async () => {
  const calls = []
  const probe = async (tenantId, override) => {
    calls.push({ tenantId, override })
    return { ok: true, reply: 'OK', provider: 'ollama', model: 'llama3.1' }
  }
  const app = await bootApp({ probe })
  try {
    const res = await fetch(`${app.base}/api/ai/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', apiKey: 'try-me' }),
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].override.provider, 'ollama')
    assert.equal(calls[0].override.apiKey, 'try-me')
    assert.equal(app.state.stored, null, 'testing does not persist')
  } finally {
    await app.close()
  }
})

// ─── Persistence (kv) ──────────────────────────────────────────────

test('ai config round-trips through kv, scoped per tenant', () => {
  setAiConfig('owner-a', { provider: 'openai', model: 'gpt', apiKey: 'a-key' })
  setAiConfig('owner-b', { provider: 'ollama', apiKey: 'b-key' })

  assert.equal(getAiConfig('owner-a').apiKey, 'a-key')
  assert.equal(getAiConfig('owner-b').provider, 'ollama')
  assert.equal(getAiConfig('owner-c'), null)

  setAiConfig('owner-a', {})
  assert.equal(getAiConfig('owner-a'), null, 'an empty config clears the row')
})
