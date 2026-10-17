// ─── Deployment brand (name · tagline · logo · icon) ────────────────
// Two layers: the public/super-admin router (server/branding.js) against
// stub storage, and the kv persistence in server/db.js. Reads must work
// with no session at all (the sign-in screen is anonymous); writes must
// be super-admin only; images are size-capped and scheme-checked.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import express from 'express'
import { createBrandingRouter, requireSuperAdmin } from '../server/branding.js'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'restora-branding-'))
process.env.RESTORA_DATA = dataDir
const { closeDatabase, getBranding, setBranding } = await import('../server/db.js')

after(() => {
  closeDatabase()
  rmSync(dataDir, { recursive: true, force: true })
})

// ─── Router (stubbed storage) ──────────────────────────────────────

async function bootApp(opts = {}) {
  const state = { stored: opts.stored || null }
  const router = createBrandingRouter({
    requireAdmin: requireSuperAdmin,
    getBranding: () => state.stored,
    setBranding: (brand) => { state.stored = brand },
  })
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  // opts.auth === undefined simulates an anonymous request; pass a user to
  // simulate a session (attachAuth does the same in the real server).
  app.use((req, _res, next) => { req.auth = opts.auth ?? null; next() })
  app.use(router.router)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, state, close: () => new Promise((resolve) => server.close(resolve)) }
}

const SUPER = { user: { is_super_admin: true, email: 'root@restora.test' } }
const OWNER = { user: { is_super_admin: false, email: 'nora@harbor.test' } }

// attachAuth sets req.auth in the real server; here each test boots with
// the session it wants to exercise.
async function bootAs(auth, opts = {}) {
  return bootApp({ ...opts, auth })
}

test('GET is public and reports empty strings until the super admin saves', async () => {
  const app = await bootAs(null, {})
  try {
    const res = await fetch(`${app.base}/api/branding`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.branding, {
      name: '', tagline: '', logoUrl: '', iconUrl: '', updatedAt: null, updatedBy: null,
    })
  } finally {
    await app.close()
  }
})

test('anonymous and owner writes are rejected without storing', async () => {
  const anon = await bootAs(null, {})
  try {
    const res = await fetch(`${anon.base}/api/branding`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hijack' }),
    })
    assert.equal(res.status, 401)
    assert.equal(anon.state.stored, null)
  } finally {
    await anon.close()
  }

  const owner = await bootAs(OWNER, {})
  try {
    const res = await fetch(`${owner.base}/api/branding`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hijack' }),
    })
    assert.equal(res.status, 403)
    assert.equal(owner.state.stored, null, 'a blocked request never writes')
  } finally {
    await owner.close()
  }
})

test('the super admin saves name, tagline, logo, and icon', async () => {
  const app = await bootAs(SUPER, {})
  try {
    const logo = 'data:image/png;base64,AAAA'
    const icon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>'
    const res = await fetch(`${app.base}/api/branding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Restora', tagline: 'គ្រប់គ្រង · បម្រើ · រីកចម្រើន', logoUrl: logo, iconUrl: icon }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.branding.name, 'Restora')
    assert.equal(body.branding.tagline, 'គ្រប់គ្រង · បម្រើ · រីកចម្រើន')
    assert.equal(body.branding.logoUrl, logo)
    assert.equal(body.branding.iconUrl, icon)
    assert.equal(body.branding.updatedBy, 'root@restora.test')
    assert.ok(body.branding.updatedAt, 'the save is timestamped')
    assert.equal(app.state.stored.logoUrl, logo)

    const read = await fetch(`${app.base}/api/branding`)
    assert.equal((await read.json()).branding.name, 'Restora')
  } finally {
    await app.close()
  }
})

test('a partial save keeps the other fields, and empty strings clear them', async () => {
  const stored = { name: 'Restora', tagline: 'Grow', logoUrl: 'data:image/png;base64,AAAA', iconUrl: '/icon.svg' }
  const app = await bootAs(SUPER, { stored })
  try {
    const res = await fetch(`${app.base}/api/branding`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagline: '' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.branding.tagline, '', 'an empty string clears the tagline')
    assert.equal(body.branding.name, 'Restora')
    assert.equal(body.branding.logoUrl, 'data:image/png;base64,AAAA')
    assert.equal(body.branding.iconUrl, '/icon.svg')
  } finally {
    await app.close()
  }
})

test('oversized or non-image values are rejected without writing', async () => {
  const app = await bootAs(SUPER, {})
  try {
    const hugeLogo = `data:image/png;base64,${'A'.repeat(400001)}`
    const logo = await fetch(`${app.base}/api/branding`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logoUrl: hugeLogo }),
    })
    assert.equal(logo.status, 400)

    const hugeIcon = `data:image/png;base64,${'A'.repeat(160001)}`
    const icon = await fetch(`${app.base}/api/branding`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ iconUrl: hugeIcon }),
    })
    assert.equal(icon.status, 400)

    const script = await fetch(`${app.base}/api/branding`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logoUrl: 'javascript:alert(1)' }),
    })
    assert.equal(script.status, 400)
    assert.equal(app.state.stored, null, 'nothing was stored')
  } finally {
    await app.close()
  }
})

test('long text is clamped, not rejected', async () => {
  const app = await bootAs(SUPER, {})
  try {
    const res = await fetch(`${app.base}/api/branding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'N'.repeat(200), tagline: 'T'.repeat(500) }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.branding.name.length, 60)
    assert.equal(body.branding.tagline.length, 160)
  } finally {
    await app.close()
  }
})

// ─── Persistence (kv) ──────────────────────────────────────────────

test('branding round-trips through kv under the reserved platform owner', () => {
  assert.equal(getBranding(), null, 'nothing stored yet')

  setBranding({ name: 'Restora', tagline: 'គ្រប់គ្រង · បម្រើ · រីកចម្រើន', iconUrl: '/icon.svg' })
  const stored = getBranding()
  assert.equal(stored.name, 'Restora')
  assert.equal(stored.tagline, 'គ្រប់គ្រង · បម្រើ · រីកចម្រើន')
  assert.equal(stored.iconUrl, '/icon.svg')

  setBranding({})
  assert.equal(getBranding(), null, 'an empty object clears the row')
})
