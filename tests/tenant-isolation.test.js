// ─── Tenant isolation ───────────────────────────────────────────────
// Boots the real API server (state, actions, catalog, telemetry) against a
// throwaway SQLite file and proves one host owner can never read or change
// another owner's restaurant. The bot/guest paths are tenant-scoped too.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-tenant-'))

let child = null
let base = ''

function waitForPort(proc) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${buffer}`)), 20_000)
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(/api on http:\/\/[^:]+:(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(`http://127.0.0.1:${match[1]}`)
      }
    })
    proc.stderr.on('data', (chunk) => { buffer += chunk.toString() })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited early (${code}):\n${buffer}`))
    })
  })
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      RESTORA_DATA: dataDir,
      PORT: '0',
      HOST: '127.0.0.1',
      SUPERADMIN_EMAIL: 'root@tenant.test',
      SUPERADMIN_PASSWORD: 'super-secret-1',
      SUPERADMIN_NAME: 'Root Admin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  base = await waitForPort(child)
})

after(async () => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function api(method, route, { body, cookie } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null }
}

// Opens the SSE stream as a given session, runs `during`, and returns every
// event the stream delivered after its opening hello — so a test can prove
// which broadcasts a terminal actually heard.
async function sseWindow(cookie, during, settleMs = 500) {
  const ctrl = new AbortController()
  const res = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: ctrl.signal })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(decoder.decode(value, { stream: true }))
      }
    } catch { /* stream aborted */ }
  })()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const mark = chunks.join('').length
  await during()
  await new Promise((resolve) => setTimeout(resolve, settleMs))
  ctrl.abort()
  await pump
  return chunks.join('').slice(mark)
}

const alphaMenuItem = (id, name) => ({
  id, name, description: '', category: 'Mains', price: 8, station: 'grill',
  available: true, active: true, dietaryTags: [], allergens: [], imageUrl: '',
  sortOrder: 97, substituteId: null, modifiers: [],
})

const locAction = (locId, itemId, name) => ({
  clientId: 'branch-test',
  action: { type: 'LOC', locId, action: { type: 'ADD_MENU_ITEM', item: alphaMenuItem(itemId, name) } },
})

const ADD_ALPHA = {
  clientId: 'alpha-1',
  action: {
    type: 'LOC',
    locId: 'downtown',
    action: {
      type: 'ADD_MENU_ITEM',
      item: {
        id: 'm_alpha_only', name: 'Alpha Special', description: 'house only', category: 'Mains',
        price: 9.5, station: 'grill', available: true, active: true, dietaryTags: [], allergens: [],
        imageUrl: '', sortOrder: 99, substituteId: null, modifiers: [],
      },
    },
  },
}

const hasAlpha = (state) => (state?.locations?.downtown?.menu || []).some((item) => item.id === 'm_alpha_only')

let alpha = null
let bravo = null
let patCookie = null

test('two owners can register and stay isolated', async () => {
  const a = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Alpha Diner', name: 'Al', email: 'al@alpha.test', password: 'password-1' },
  })
  const b = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Bravo Bistro', name: 'Bo', email: 'bo@bravo.test', password: 'password-1' },
  })
  assert.equal(a.status, 201)
  assert.equal(b.status, 201)
  alpha = { cookie: a.cookie, slug: a.data.user.owner.slug, id: a.data.user.owner.id }
  bravo = { cookie: b.cookie, slug: b.data.user.owner.slug, id: b.data.user.owner.id }
  assert.notEqual(alpha.id, bravo.id)
})

test('an action lands only in the acting owner snapshot', async () => {
  const posted = await api('POST', '/api/actions', { cookie: alpha.cookie, body: ADD_ALPHA })
  assert.equal(posted.status, 200)
  assert.ok(typeof posted.data.seq === 'number')

  const aState = await api('GET', '/api/state', { cookie: alpha.cookie })
  const bState = await api('GET', '/api/state', { cookie: bravo.cookie })
  assert.equal(hasAlpha(aState.data.state), true)
  assert.equal(hasAlpha(bState.data.state), false)
})

test('a signed-in owner cannot name another tenant', async () => {
  const peek = await api('GET', `/api/state?ownerId=${alpha.id}`, { cookie: bravo.cookie })
  assert.equal(hasAlpha(peek.data.state), false, '?ownerId is ignored for a pinned user')
})

test('the catalog read model is tenant-scoped by slug and location', async () => {
  const alphaMenu = await api('GET', `/api/menu?loc=downtown&owner=${alpha.slug}`)
  assert.equal(alphaMenu.status, 200)
  assert.ok(alphaMenu.data.items.some((item) => item.id === 'm_alpha_only'))

  const bravoMenu = await api('GET', `/api/menu?loc=downtown&owner=${bravo.slug}`)
  assert.equal(bravoMenu.data.items.some((item) => item.id === 'm_alpha_only'), false)

  // No owner param → the legacy default tenant, which knows nothing of alpha.
  const guestDefault = await api('GET', '/api/menu?loc=downtown')
  assert.equal(guestDefault.data.items.some((item) => item.id === 'm_alpha_only'), false)
})

test('a guest can read a tenant by slug', async () => {
  const guestAlpha = await api('GET', `/api/state?owner=${alpha.slug}`)
  assert.equal(hasAlpha(guestAlpha.data.state), true)
  const guestBravo = await api('GET', `/api/state?owner=${bravo.slug}`)
  assert.equal(hasAlpha(guestBravo.data.state), false)
})

test('the super admin may select a tenant by id', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { email: 'root@tenant.test', password: 'super-secret-1' },
  })
  assert.equal(login.status, 200)
  const selected = await api('GET', `/api/state?ownerId=${alpha.id}`, { cookie: login.cookie })
  assert.equal(hasAlpha(selected.data.state), true)
})

test('a suspended owner is locked out for users and guests', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { email: 'root@tenant.test', password: 'super-secret-1' },
  })
  const suspended = await api('PATCH', `/api/admin/owners/${bravo.id}`, {
    cookie: login.cookie,
    body: { status: 'suspended' },
  })
  assert.equal(suspended.status, 200)

  const pinned = await api('GET', '/api/state', { cookie: bravo.cookie })
  assert.equal(pinned.status, 403)
  const guest = await api('GET', `/api/state?owner=${bravo.slug}`)
  assert.equal(guest.status, 403)

  // The super admin still reaches it (support + recovery).
  const asSuper = await api('GET', `/api/state?ownerId=${bravo.id}`, { cookie: login.cookie })
  assert.equal(asSuper.status, 200)
})

test('a manager cannot promote themselves to owner', async () => {
  const c = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Charlie Cafe', name: 'CJ', email: 'cj@charlie.test', password: 'password-1' },
  })
  const created = await api('POST', '/api/users', {
    cookie: c.cookie,
    body: { name: 'Mia', email: 'mia@charlie.test', password: 'password-1', roleId: 'sys_manager' },
  })
  assert.equal(created.status, 201)
  const login = await api('POST', '/api/auth/login', {
    body: { email: 'mia@charlie.test', password: 'password-1' },
  })
  const me = await api('GET', '/api/auth/me', { cookie: login.cookie })
  const promoted = await api('PATCH', `/api/users/${me.data.user.id}`, {
    cookie: login.cookie,
    body: { roleId: 'sys_owner' },
  })
  assert.equal(promoted.status, 403)
})

test('naming a tenant that does not exist is a 404, never a new tenant', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { email: 'root@tenant.test', password: 'super-secret-1' },
  })
  const ghost = await api('GET', '/api/state?ownerId=owner_ghost', { cookie: login.cookie })
  assert.equal(ghost.status, 404)
  const badSlug = await api('GET', '/api/state?owner=no-such-diner')
  assert.equal(badSlug.status, 404)
})

test('a user assigned to a branch is pinned to it everywhere', async () => {
  const created = await api('POST', '/api/users', {
    cookie: alpha.cookie,
    body: { name: 'Pat Pin', email: 'pat@alpha.test', password: 'password-1', roleId: 'sys_manager', locationId: 'downtown' },
  })
  assert.equal(created.status, 201)
  assert.equal(created.data.user.locationId, 'downtown')

  const login = await api('POST', '/api/auth/login', {
    body: { email: 'pat@alpha.test', password: 'password-1' },
  })
  patCookie = login.cookie

  // The snapshot they receive carries only their branch, so switchers and
  // cross-branch tabs have nothing to switch to.
  const state = await api('GET', '/api/state', { cookie: login.cookie })
  assert.deepEqual(Object.keys(state.data.state.locations), ['downtown'])

  // Catalog reads for the other branch are refused; their own branch reads.
  const otherMenu = await api('GET', '/api/menu?loc=riverside', { cookie: login.cookie })
  assert.equal(otherMenu.status, 403)
  const ownMenu = await api('GET', '/api/menu?loc=downtown', { cookie: login.cookie })
  assert.equal(ownMenu.status, 200)
  const otherStock = await api('GET', '/api/inventory?loc=riverside', { cookie: login.cookie })
  assert.equal(otherStock.status, 403)
  const ownStock = await api('GET', '/api/inventory?loc=downtown', { cookie: login.cookie })
  assert.equal(ownStock.status, 200)

  // Actions outside the branch — and empire-level ones — are refused.
  const foreign = await api('POST', '/api/actions', {
    cookie: login.cookie, body: locAction('riverside', 'm_pat_riv', 'Pat Riverside'),
  })
  assert.equal(foreign.status, 403)
  const empire = await api('POST', '/api/actions', {
    cookie: login.cookie, body: { clientId: 'pat', action: { type: 'RESET_ALL' } },
  })
  assert.equal(empire.status, 403)
  const own = await api('POST', '/api/actions', {
    cookie: login.cookie, body: locAction('downtown', 'm_pat_dt', 'Pat Downtown'),
  })
  assert.equal(own.status, 200)
})

test('a branch-pinned terminal hears only its own branch on SSE', async () => {
  const seen = await sseWindow(patCookie, async () => {
    await api('POST', '/api/actions', {
      cookie: alpha.cookie, body: locAction('riverside', 'm_riv_sse', 'Riverside SSE'),
    })
    await api('POST', '/api/actions', {
      cookie: alpha.cookie, body: locAction('downtown', 'm_dt_sse', 'Downtown SSE'),
    })
  })
  assert.ok(seen.includes('m_dt_sse'), 'own-branch events reach the pinned terminal')
  assert.equal(seen.includes('m_riv_sse'), false, 'other-branch events are filtered')
})

test('clearing the assignment hands the whole empire back', async () => {
  const list = await api('GET', '/api/users', { cookie: alpha.cookie })
  const pat = list.data.users.find((user) => user.email === 'pat@alpha.test')
  const cleared = await api('PATCH', `/api/users/${pat.id}`, { cookie: alpha.cookie, body: { locationId: '' } })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.data.user.locationId, null)

  const state = await api('GET', '/api/state', { cookie: patCookie })
  assert.equal(Object.keys(state.data.state.locations).length, 2)
  const otherMenu = await api('GET', '/api/menu?loc=riverside', { cookie: patCookie })
  assert.equal(otherMenu.status, 200)
})
