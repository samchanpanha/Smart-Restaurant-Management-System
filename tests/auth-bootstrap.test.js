// ─── First-run provisioning ──────────────────────────────────────────
// Who the account that registers a restaurant is, and what it may do.
//
// The reported bug: register a restaurant, open **Users**, and it answered
// "sign in required" — the session was only a cookie, so any context that did
// not send the cookie back looked signed in while every owner-only screen
// failed. tests/auth-server.test.js covers that transport fix.
//
// This file covers the *shape* of the account that gets created:
//   1. the first account on a fresh install is the host owner (all screens,
//      including the tenant console) — otherwise the console is unreachable
//      without knowing SUPERADMIN_EMAIL/PASSWORD;
//   2. every later registration is an ordinary restaurant owner with every
//      owner screen, so Users/Roles work immediately with no extra setup;
//   3. RESTORA_BOOTSTRAP_HOST_OWNER=0 turns (1) off for a public sign-up page.
//
// No SUPERADMIN_* is set here on purpose: that is the situation the bootstrap
// exists for.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-bootstrap-'))
process.env.RESTORA_DATA = dataDir
delete process.env.SUPERADMIN_EMAIL
delete process.env.SUPERADMIN_PASSWORD

const express = (await import('express')).default
const { createAuthRouter, seedAuth, shouldBootstrapHostOwner, ALL_SCREENS } = await import('../server/auth.js')
const { db } = await import('../server/db.js')

let server = null
let base = ''

before(async () => {
  const app = express()
  app.use(express.json())
  seedAuth()
  app.use(createAuthRouter())
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function api(method, route, { body, token } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

test('the first account to register hosts the owner of the platform', async () => {
  assert.equal(shouldBootstrapHostOwner(), true, 'no host owner exists yet')

  const first = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Harbor Bistro', name: 'Nora Owner', email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.equal(first.status, 201)
  assert.equal(first.data.user.isSuperAdmin, true, 'the first account is the host owner')
  assert.equal(first.data.user.role.key, 'super')
  assert.deepEqual(first.data.user.screens, ['*'], 'every screen, including the tenant console')
  assert.equal(first.data.user.owner.name, 'Harbor Bistro', 'and it still owns the restaurant it registered')

  // The tenant console is reachable straight away — this is what the flag buys.
  const owners = await api('GET', '/api/admin/owners', { token: first.data.token })
  assert.equal(owners.status, 200)
  assert.ok(owners.data.owners.length >= 1)

  // Every owner screen is granted, so Users/Roles/Settings all open.
  for (const screen of ['users', 'roles', 'settings', 'owners']) {
    assert.ok(ALL_SCREENS.includes(screen))
  }

  // …and it is only the first one.
  assert.equal(shouldBootstrapHostOwner(), false)
})

test('the next restaurant registers as an ordinary owner with every owner screen', async () => {
  const second = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Riverside Grill', name: 'Rae Owner', email: 'rae@riverside.test', password: 'river-pass-1' },
  })
  assert.equal(second.status, 201)
  assert.equal(second.data.user.isSuperAdmin, false, 'only the first account hosts the platform')
  assert.equal(second.data.user.role.key, 'owner')

  const screens = second.data.user.screens
  for (const screen of ['dashboard', 'floor', 'tickets', 'kitchen', 'menu', 'catalog', 'inventory', 'movements', 'purchases', 'suppliers', 'reports', 'costing', 'settings', 'telegram', 'system', 'users', 'roles']) {
    assert.ok(screens.includes(screen), `owner has ${screen}`)
  }
  assert.ok(!screens.includes('owners'), 'but not the platform console')

  // Users works immediately, and the standard role set is offered for it.
  const users = await api('GET', '/api/users', { token: second.data.token })
  assert.equal(users.status, 200)
  assert.equal(users.data.users.length, 1, 'just the account that registered')
  assert.equal(users.data.users[0].role.key, 'owner')

  const roles = await api('GET', '/api/roles', { token: second.data.token })
  assert.equal(roles.status, 200)
  const keys = roles.data.roles.map((role) => role.key)
  for (const expected of ['owner', 'manager', 'server', 'kitchen', 'host']) {
    assert.ok(keys.includes(expected), `${expected} can be assigned from day one`)
  }

  // Every system role is usable for a brand-new tenant (none of them is
  // owner-scoped), so "assign any role" needs no seeding step.
  const server = roles.data.roles.find((role) => role.key === 'server')
  const made = await api('POST', '/api/users', {
    token: second.data.token,
    body: { name: 'Sam Server', email: 'sam@riverside.test', password: 'sam-pass-123', roleId: server.id },
  })
  assert.equal(made.status, 201)
  assert.equal(made.data.user.role.key, 'server')
})

test('RESTORA_BOOTSTRAP_HOST_OWNER=0 keeps registration unprivileged', async () => {
  // Wipe the host owners to get back to a fresh-install state, then opt out.
  db.prepare('UPDATE auth_users SET is_super_admin = 0, role_id = ? WHERE is_super_admin = 1')
    .run('sys_owner')
  process.env.RESTORA_BOOTSTRAP_HOST_OWNER = '0'
  try {
    assert.equal(shouldBootstrapHostOwner(), false, 'the escape hatch wins over an empty platform')
    const third = await api('POST', '/api/auth/register', {
      body: { ownerName: 'Third Cafe', name: 'Tess Owner', email: 'tess@third.test', password: 'third-pass-1' },
    })
    assert.equal(third.status, 201)
    assert.equal(third.data.user.isSuperAdmin, false)
    assert.equal(third.data.user.role.key, 'owner')
  } finally {
    delete process.env.RESTORA_BOOTSTRAP_HOST_OWNER
  }
})
