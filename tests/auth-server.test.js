// ─── Auth, roles, and the super-admin tenant console ────────────────
// Boots the real auth router against a throwaway SQLite file so registration,
// sessions, RBAC, and owner management are exercised end to end.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

// Point persistence at a scratch DB and seed a super admin before the
// auth module (and its db connection) is imported.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-auth-'))
process.env.RESTORA_DATA = dataDir
process.env.SUPERADMIN_EMAIL = 'root@restora.test'
process.env.SUPERADMIN_PASSWORD = 'super-secret-1'
process.env.SUPERADMIN_NAME = 'Root Admin'

const express = (await import('express')).default
const { createAuthRouter, seedAuth, ALL_SCREENS, DEFAULT_SUPERADMIN } = await import('../server/auth.js')

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

test('the super admin is seeded from the environment', async () => {
  const { status, data, cookie } = await api('POST', '/api/auth/login', {
    body: { email: 'root@restora.test', password: 'super-secret-1' },
  })
  assert.equal(status, 200)
  assert.equal(data.user.isSuperAdmin, true)
  assert.equal(data.user.role.key, 'super')
  assert.ok(cookie, 'login set a session cookie')
})

test('seedAuth defaults to DEFAULT_SUPERADMIN if SUPERADMIN_EMAIL is empty or omitted', async () => {
  const oldEmail = process.env.SUPERADMIN_EMAIL
  const oldPass = process.env.SUPERADMIN_PASSWORD
  try {
    delete process.env.SUPERADMIN_EMAIL
    delete process.env.SUPERADMIN_PASSWORD
    seedAuth()
    const { status, data } = await api('POST', '/api/auth/login', {
      body: { email: DEFAULT_SUPERADMIN.email, password: DEFAULT_SUPERADMIN.password },
    })
    assert.equal(status, 200)
    assert.equal(data.user.isSuperAdmin, true)
    assert.equal(data.user.email, DEFAULT_SUPERADMIN.email)
  } finally {
    process.env.SUPERADMIN_EMAIL = oldEmail
    process.env.SUPERADMIN_PASSWORD = oldPass
  }
})

test('seedAuth resets password when SUPERADMIN_RESET_PASSWORD is set', async () => {
  const oldEmail = process.env.SUPERADMIN_EMAIL
  const oldPass = process.env.SUPERADMIN_PASSWORD
  const oldReset = process.env.SUPERADMIN_RESET_PASSWORD
  try {
    process.env.SUPERADMIN_EMAIL = DEFAULT_SUPERADMIN.email
    process.env.SUPERADMIN_PASSWORD = 'new-super-pass-99'
    process.env.SUPERADMIN_RESET_PASSWORD = '1'
    seedAuth()
    const { status, data } = await api('POST', '/api/auth/login', {
      body: { email: DEFAULT_SUPERADMIN.email, password: 'new-super-pass-99' },
    })
    assert.equal(status, 200)
    assert.equal(data.user.email, DEFAULT_SUPERADMIN.email)
  } finally {
    process.env.SUPERADMIN_EMAIL = oldEmail
    process.env.SUPERADMIN_PASSWORD = oldPass
    if (oldReset !== undefined) {
      process.env.SUPERADMIN_RESET_PASSWORD = oldReset
    } else {
      delete process.env.SUPERADMIN_RESET_PASSWORD
    }
  }
})

test('registering a host owner creates the tenant and its owner user', async () => {
  const { status, data, cookie } = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Harbor Bistro', name: 'Nora Owner', email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.equal(status, 201)
  assert.equal(data.user.owner.name, 'Harbor Bistro')
  assert.equal(data.user.role.key, 'owner')
  assert.equal(data.user.isSuperAdmin, false)
  assert.ok(data.user.screens.includes('users'), 'owner can manage users')
  assert.ok(!data.user.screens.includes('owners'), 'owner cannot see the tenant console')
  assert.ok(cookie)

  const me = await api('GET', '/api/auth/me', { cookie })
  assert.equal(me.data.user.email, 'nora@harbor.test')
})

test('register rejects duplicate emails and weak passwords', async () => {
  const dup = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Other', name: 'Nora Again', email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.equal(dup.status, 409)
  const weak = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Other', name: 'Someone', email: 'someone@x.test', password: 'short' },
  })
  assert.equal(weak.status, 400)
})

test('login refuses a wrong password and logout ends the session', async () => {
  const bad = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'nope' },
  })
  assert.equal(bad.status, 401)

  const good = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.equal(good.status, 200)
  await api('POST', '/api/auth/logout', { cookie: good.cookie })
  const me = await api('GET', '/api/auth/me', { cookie: good.cookie })
  assert.equal(me.data.user, null)
})

test('roles and users are owner-scoped, and assignments stick', async () => {
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const cookie = owner.cookie

  const roles = await api('GET', '/api/roles', { cookie })
  assert.equal(roles.status, 200)
  const keys = roles.data.roles.map((role) => role.key)
  for (const expected of ['owner', 'manager', 'server', 'kitchen', 'host']) {
    assert.ok(keys.includes(expected), `system role ${expected} is offered`)
  }

  const custom = await api('POST', '/api/roles', {
    cookie,
    body: { key: 'shift_lead', label: 'Shift lead', screens: ['floor', 'tickets', 'reports'] },
  })
  assert.equal(custom.status, 201)
  assert.deepEqual(custom.data.role.screens, ['floor', 'tickets', 'reports'])

  const created = await api('POST', '/api/users', {
    cookie,
    body: { name: 'Sam Server', email: 'sam@harbor.test', password: 'sam-pass-123', roleId: custom.data.role.id },
  })
  assert.equal(created.status, 201)
  assert.equal(created.data.user.role.key, 'shift_lead')

  const list = await api('GET', '/api/users', { cookie })
  assert.equal(list.data.users.length, 2, 'owner plus the new user')
  assert.ok(list.data.users.every((user) => user.ownerId === owner.data.user.owner.id))

  const promoted = await api('PATCH', `/api/users/${created.data.user.id}`, {
    cookie,
    body: { status: 'disabled' },
  })
  assert.equal(promoted.data.user.status, 'disabled')

  // A role that still has a user cannot be deleted.
  const blocked = await api('DELETE', `/api/roles/${custom.data.role.id}`, { cookie })
  assert.equal(blocked.status, 409)
})

test('a user can be pinned to one branch, and only a real branch', async () => {
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const cookie = owner.cookie

  // No snapshot has been written for this tenant yet, so the assignment
  // validates against the seed empire (downtown / riverside).
  const pinned = await api('POST', '/api/users', {
    cookie,
    body: { name: 'Dana Downtown', email: 'dana@harbor.test', password: 'dana-pass-123', roleId: 'sys_server', locationId: 'downtown' },
  })
  assert.equal(pinned.status, 201)
  assert.equal(pinned.data.user.locationId, 'downtown')

  const ghost = await api('POST', '/api/users', {
    cookie,
    body: { name: 'Ghost', email: 'ghost@harbor.test', password: 'ghost-pass-123', roleId: 'sys_server', locationId: 'nowhere' },
  })
  assert.equal(ghost.status, 400)

  // The signed-in user carries their branch, so the terminal knows it is pinned.
  const login = await api('POST', '/api/auth/login', {
    body: { email: 'dana@harbor.test', password: 'dana-pass-123' },
  })
  const me = await api('GET', '/api/auth/me', { cookie: login.cookie })
  assert.equal(me.data.user.locationId, 'downtown')

  // Reassignment and clearing both work.
  const moved = await api('PATCH', `/api/users/${pinned.data.user.id}`, {
    cookie, body: { locationId: 'riverside' },
  })
  assert.equal(moved.status, 200)
  assert.equal(moved.data.user.locationId, 'riverside')
  const cleared = await api('PATCH', `/api/users/${pinned.data.user.id}`, {
    cookie, body: { locationId: '' },
  })
  assert.equal(cleared.data.user.locationId, null)
})

test('a role without the users screen cannot manage users', async () => {
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const roles = await api('GET', '/api/roles', { cookie: owner.cookie })
  const serverRole = roles.data.roles.find((role) => role.key === 'server')
  const staff = await api('POST', '/api/users', {
    cookie: owner.cookie,
    body: { name: 'Kitchen Kim', email: 'kim@harbor.test', password: 'kim-pass-123', roleId: serverRole.id },
  })
  assert.equal(staff.status, 201)

  const login = await api('POST', '/api/auth/login', {
    body: { email: 'kim@harbor.test', password: 'kim-pass-123' },
  })
  assert.equal(login.status, 200)
  const denied = await api('GET', '/api/users', { cookie: login.cookie })
  assert.equal(denied.status, 403)
  const rolesDenied = await api('GET', '/api/roles', { cookie: login.cookie })
  assert.equal(rolesDenied.status, 403)
})

test('a host owner cannot reach the super-admin console', async () => {
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const owners = await api('GET', '/api/admin/owners', { cookie: owner.cookie })
  assert.equal(owners.status, 403)
})

test('the super admin manages every host owner', async () => {
  const admin = await api('POST', '/api/auth/login', {
    body: { email: 'root@restora.test', password: 'super-secret-1' },
  })
  const cookie = admin.cookie

  const list = await api('GET', '/api/admin/owners', { cookie })
  assert.equal(list.status, 200)
  assert.ok(list.data.owners.length >= 1, 'the registered tenant is listed')
  assert.ok(list.data.owners.every((owner) => typeof owner.userCount === 'number'))

  const made = await api('POST', '/api/admin/owners', {
    cookie,
    body: { ownerName: 'Riverside Grill', name: 'Rae Owner', email: 'rae@riverside.test', password: 'river-pass-1' },
  })
  assert.equal(made.status, 201)
  assert.equal(made.data.owner.name, 'Riverside Grill')

  const suspended = await api('PATCH', `/api/admin/owners/${made.data.owner.id}`, {
    cookie,
    body: { status: 'suspended' },
  })
  assert.equal(suspended.data.owner.status, 'suspended')

  // Super admin can list any tenant's users and roles.
  const users = await api('GET', `/api/users?ownerId=${made.data.owner.id}`, { cookie })
  assert.equal(users.status, 200)
  assert.equal(users.data.users.length, 1)

  const removed = await api('DELETE', `/api/admin/owners/${made.data.owner.id}`, { cookie })
  assert.equal(removed.status, 200)
  const after = await api('GET', '/api/admin/owners', { cookie })
  assert.ok(!after.data.owners.some((owner) => owner.id === made.data.owner.id))
})

test('the screen vocabulary is the single source roles draw from', () => {
  assert.ok(ALL_SCREENS.includes('owners'))
  assert.ok(ALL_SCREENS.includes('users'))
  assert.ok(ALL_SCREENS.includes('roles'))
})
