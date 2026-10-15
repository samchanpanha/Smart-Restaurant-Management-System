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
const { createAuthRouter, seedAuth, ALL_SCREENS } = await import('../server/auth.js')

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

async function api(method, route, { body, cookie, token, proto, headers: extra } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(proto ? { 'X-Forwarded-Proto': proto } : {}),
      ...(extra || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null, setCookie }
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

// ─── Sessions over a bearer token, not just a cookie ────────────────
// The workspace can run where the session cookie is not sent back: embedded
// in an iframe (a subresource request from a cross-site frame is cross-site,
// so SameSite=Lax cookies are dropped), a browser with third-party cookies
// blocked, or a deployment forcing Secure cookies over http. Those terminals
// reported "sign in required" on Users/Roles while the workspace itself still
// loaded. The token that comes back from sign-in is the answer.

test('sign-in hands out a token that works without any cookie', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.equal(login.status, 200)
  assert.equal(typeof login.data.token, 'string')
  assert.ok(login.data.token.length >= 32, 'a real session token, not a placeholder')

  // Exactly what an embedded terminal does: no Cookie header at all.
  const me = await api('GET', '/api/auth/me', { token: login.data.token })
  assert.equal(me.data.user.email, 'nora@harbor.test')

  const users = await api('GET', '/api/users', { token: login.data.token })
  assert.equal(users.status, 200, 'the Users screen works without a cookie')
  assert.ok(users.data.users.some((entry) => entry.email === 'nora@harbor.test'), 'the owner is listed')
  assert.ok(users.data.users.every((entry) => entry.ownerId === me.data.user.owner.id), 'scoped to one restaurant')

  const roles = await api('GET', '/api/roles', { token: login.data.token })
  assert.equal(roles.status, 200)

  // Registration signs a browser in the same way.
  const fresh = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Token Cafe', name: 'Tina Token', email: 'tina@token.test', password: 'token-pass-1' },
  })
  assert.equal(fresh.status, 201)
  const freshUsers = await api('GET', '/api/users', { token: fresh.data.token })
  assert.equal(freshUsers.status, 200)
  assert.equal(freshUsers.data.users[0].email, 'tina@token.test')
})

test('a bad token is refused and logout revokes a token session', async () => {
  const denied = await api('GET', '/api/users', { token: 'not-a-real-token' })
  assert.equal(denied.status, 401)
  assert.equal(denied.data.error, 'sign in required')

  const login = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const token = login.data.token
  assert.equal((await api('GET', '/api/users', { token })).status, 200)

  const out = await api('POST', '/api/auth/logout', { token })
  assert.equal(out.status, 200)
  assert.equal((await api('GET', '/api/users', { token })).status, 401, 'the revoked token is dead')
})

test('the session cookie fits the transport it arrived on', async () => {
  // Plain HTTP (an offline restaurant LAN): Secure is impossible, so Lax.
  const plain = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.match(plain.setCookie, /HttpOnly/)
  assert.match(plain.setCookie, /SameSite=Lax/)
  assert.ok(!/Secure/.test(plain.setCookie))

  // HTTPS behind a proxy: None + Secure + Partitioned, which is what an
  // embedded frame needs to be allowed to store the cookie at all.
  const secure = await api('POST', '/api/auth/login', {
    proto: 'https',
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.match(secure.setCookie, /SameSite=None/)
  assert.match(secure.setCookie, /Secure/)
  assert.match(secure.setCookie, /Partitioned/)

  // And the cookie still authenticates on its own.
  const me = await api('GET', '/api/auth/me', { cookie: secure.cookie })
  assert.equal(me.data.user.email, 'nora@harbor.test')
})

test('an https front is recognised even when the proxy hides the protocol', async () => {
  // Not every proxy forwards X-Forwarded-Proto, and when the workspace is
  // embedded in a frame a Lax cookie is never sent back: the operator sees the
  // app sign them out on the next screen. These are the other traces of TLS a
  // browser leaves, and they have to be enough to pick None + Secure.
  const login = { body: { email: 'nora@harbor.test', password: 'hunter2-long' } }
  const viaSsl = await api('POST', '/api/auth/login', { ...login, headers: { 'X-Forwarded-Ssl': 'on' } })
  assert.match(viaSsl.setCookie, /SameSite=None/)
  assert.match(viaSsl.setCookie, /Secure/)

  const viaOrigin = await api('POST', '/api/auth/login', { ...login, headers: { Origin: 'https://harbor-bistro.example' } })
  assert.match(viaOrigin.setCookie, /Partitioned/)

  const viaCf = await api('POST', '/api/auth/login', { ...login, headers: { 'CF-Visitor': '{\"scheme\":\"https\"}' } })
  assert.match(viaCf.setCookie, /SameSite=None/)

  // With no trace at all the server keeps the LAN-safe Lax cookie.
  const plain = await api('POST', '/api/auth/login', { ...login, headers: { Origin: 'http://192.168.1.20:3001' } })
  assert.match(plain.setCookie, /SameSite=Lax/)
  assert.ok(!/Secure/.test(plain.setCookie))
})

test('a token session resolves to the same tenant as the cookie session', async () => {
  // /api/state is not auth-gated, so a terminal whose cookie went missing used
  // to read the *default* tenant silently (see tests/tenant-isolation.test.js
  // for the tenant-scoped half). What matters here: the bearer path identifies
  // the same restaurant the cookie path does, so the workspace cannot drift to
  // somebody else's shop just because the cookie was dropped.
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const viaCookie = await api('GET', '/api/auth/me', { cookie: owner.cookie })
  const viaToken = await api('GET', '/api/auth/me', { token: owner.data.token })
  assert.equal(viaToken.data.user.owner.id, viaCookie.data.user.owner.id)
  assert.equal(viaToken.data.user.id, viaCookie.data.user.id)
  assert.equal(viaToken.data.user.role.key, 'owner')
  assert.ok(viaToken.data.user.screens.includes('users'), 'the owner keeps every owner screen')
})

// ─── Owner accounts are protected ───────────────────────────────────
// The Users screen is where roles get handed out, so it is also where a
// restaurant can be locked out of itself: a manager demoting the owner, or the
// last owner being disabled, would leave nobody able to reopen Users/Roles.

test('a manager cannot touch the owner account or leave the shop ownerless', async () => {
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const me = await api('GET', '/api/auth/me', { cookie: owner.cookie })
  const ownerUserId = me.data.user.id

  // A fresh manager account, made by the owner.
  const manager = await api('POST', '/api/users', {
    cookie: owner.cookie,
    body: { name: 'Mia Manager', email: 'mia@harbor.test', password: 'mia-pass-123', roleId: 'sys_manager' },
  })
  assert.equal(manager.status, 201)
  const asManager = await api('POST', '/api/auth/login', {
    body: { email: 'mia@harbor.test', password: 'mia-pass-123' },
  })

  // The manager may edit staff…
  const staff = await api('POST', '/api/users', {
    cookie: owner.cookie,
    body: { name: 'Sam Two', email: 'sam2@harbor.test', password: 'sam2-pass-123', roleId: 'sys_server' },
  })
  const renamed = await api('PATCH', `/api/users/${staff.data.user.id}`, {
    cookie: asManager.cookie,
    body: { name: 'Sam Renamed' },
  })
  assert.equal(renamed.status, 200)

  // …but not the owner, and not to a broader role either.
  const demote = await api('PATCH', `/api/users/${ownerUserId}`, {
    cookie: asManager.cookie,
    body: { roleId: 'sys_server' },
  })
  assert.equal(demote.status, 403)

  const disable = await api('PATCH', `/api/users/${ownerUserId}`, {
    cookie: asManager.cookie,
    body: { status: 'disabled' },
  })
  assert.equal(disable.status, 403)

  const selfPromote = await api('PATCH', `/api/users/${manager.data.user.id}`, {
    cookie: asManager.cookie,
    body: { roleId: 'sys_owner' },
  })
  assert.equal(selfPromote.status, 403)
})

test('the last owner cannot be demoted, disabled, or deleted', async () => {
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const me = await api('GET', '/api/auth/me', { cookie: owner.cookie })
  const ownerId = me.data.user.id

  const demote = await api('PATCH', `/api/users/${ownerId}`, {
    cookie: owner.cookie,
    body: { roleId: 'sys_manager' },
  })
  assert.equal(demote.status, 400)
  assert.match(demote.data.error, /keep one active owner/)

  const disable = await api('PATCH', `/api/users/${ownerId}`, {
    cookie: owner.cookie,
    body: { status: 'disabled' },
  })
  assert.equal(disable.status, 400)

  const remove = await api('DELETE', `/api/users/${ownerId}`, { cookie: owner.cookie })
  assert.equal(remove.status, 400, 'you cannot delete yourself')

  // Hand ownership to a second person: now one of them may step down.
  const second = await api('POST', '/api/users', {
    cookie: owner.cookie,
    body: { name: 'Ora Owner', email: 'ora@harbor.test', password: 'ora-pass-123', roleId: 'sys_owner' },
  })
  assert.equal(second.status, 201)
  assert.equal(second.data.user.role.key, 'owner')

  const asSecond = await api('POST', '/api/auth/login', {
    body: { email: 'ora@harbor.test', password: 'ora-pass-123' },
  })
  const stepDown = await api('PATCH', `/api/users/${ownerId}`, {
    cookie: asSecond.cookie,
    body: { status: 'disabled' },
  })
  assert.equal(stepDown.status, 200)

  // With one active owner left, that owner can no longer hand in the shop.
  const lastOne = await api('PATCH', `/api/users/${second.data.user.id}`, {
    cookie: asSecond.cookie,
    body: { roleId: 'sys_manager' },
  })
  assert.equal(lastOne.status, 400)

  // Restore the shop for the tests that follow.
  const restored = await api('PATCH', `/api/users/${ownerId}`, {
    cookie: asSecond.cookie,
    body: { status: 'active' },
  })
  assert.equal(restored.status, 200)
})

test('each user row reports the restaurant it belongs to', async () => {
  const owner = await api('POST', '/api/auth/login', {
    body: { email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  const list = await api('GET', '/api/users', { cookie: owner.cookie })
  assert.equal(list.status, 200)
  assert.ok(list.data.users.length >= 1)
  assert.ok(list.data.users.every((user) => user.ownerName === 'Harbor Bistro'), 'the list names the restaurant')
})

test('naming a restaurant that does not exist is a 404 on the user routes too', async () => {
  const admin = await api('POST', '/api/auth/login', {
    body: { email: 'root@restora.test', password: 'super-secret-1' },
  })
  const ghost = await api('GET', '/api/users?ownerId=owner_ghost', { cookie: admin.cookie })
  assert.equal(ghost.status, 404)
  assert.equal(ghost.data.error, 'unknown restaurant')

  const ghostRoles = await api('GET', '/api/roles?ownerId=owner_ghost', { cookie: admin.cookie })
  assert.equal(ghostRoles.status, 404)

  // A real one still resolves — and without an id the platform view is intact.
  const list = await api('GET', '/api/admin/owners', { cookie: admin.cookie })
  const real = list.data.owners[0]
  const scoped = await api('GET', `/api/users?ownerId=${real.id}`, { cookie: admin.cookie })
  assert.equal(scoped.status, 200)
  assert.ok(scoped.data.users.every((user) => user.ownerId === real.id))
})

// ─── A host owner manages *their own* restaurant ────────────────────
// Registration makes the first account a host owner: a super admin that also
// owns a restaurant. The Users/Roles screens then opened (reads are 200) but
// every action answered 400 "an owner is required", because a super admin's
// target defaults to "all restaurants" and the UI never named one. Managing
// your own shop must not require a query parameter the screen does not send.

test('a host owner reads and writes their own restaurant by default', async () => {
  const { db } = await import('../server/db.js')

  // A tenant owner, promoted the way the bootstrap promotes the first account.
  const made = await api('POST', '/api/admin/owners', {
    cookie: (await api('POST', '/api/auth/login', { body: { email: 'root@restora.test', password: 'super-secret-1' } })).cookie,
    body: { ownerName: 'Harbor Host', name: 'Hana Host', email: 'hana@host.test', password: 'host-pass-1' },
  })
  assert.equal(made.status, 201)
  const restaurantId = made.data.owner.id
  db.prepare('UPDATE auth_users SET is_super_admin = 1, role_id = ? WHERE id = ?').run('sys_super', made.data.user.id)

  const login = await api('POST', '/api/auth/login', {
    body: { email: 'hana@host.test', password: 'host-pass-1' },
  })
  assert.equal(login.data.user.isSuperAdmin, true)

  // Reads default to their own restaurant, not the platform view.
  const users = await api('GET', '/api/users', { cookie: login.cookie })
  assert.equal(users.status, 200)
  assert.deepEqual(users.data.users.map((user) => user.email), ['hana@host.test'])
  assert.ok(users.data.users.every((user) => user.ownerId === restaurantId))

  // Writes land in their own restaurant — this is the reported failure.
  const staff = await api('POST', '/api/users', {
    cookie: login.cookie,
    body: { name: 'Sam Server', email: 'sam@host.test', password: 'sam-pass-123', roleId: 'sys_server' },
  })
  assert.equal(staff.status, 201, 'a host owner can add staff without naming a restaurant')
  assert.equal(staff.data.user.ownerId, restaurantId)

  const role = await api('POST', '/api/roles', {
    cookie: login.cookie,
    body: { key: 'bar', label: 'Bar', screens: ['floor', 'tickets'] },
  })
  assert.equal(role.status, 201, 'and create a role for it')
  assert.equal(role.data.role.ownerId, restaurantId)

  // Their own custom role now shows up in their list.
  const roles = await api('GET', '/api/roles', { cookie: login.cookie })
  assert.ok(roles.data.roles.some((entry) => entry.key === 'bar'))

  // Another restaurant stays reachable by naming it, and is never touched.
  const others = await api('GET', '/api/users?ownerId=owner_ghost', { cookie: login.cookie })
  assert.equal(others.status, 404)
  const named = await api('GET', '/api/users', {
    cookie: (await api('POST', '/api/auth/login', { body: { email: 'nora@harbor.test', password: 'hunter2-long' } })).cookie,
  })
  assert.ok(named.data.users.length >= 1)
  assert.ok(named.data.users.every((user) => user.email !== 'sam@host.test'), 'the other restaurant is untouched')

  // Put the tenant back to a plain owner for the tests that follow.
  db.prepare('UPDATE auth_users SET is_super_admin = 0, role_id = ? WHERE id = ?').run('sys_owner', made.data.user.id)
})

test('a platform admin with no restaurant is told to name one', async () => {
  // The seeded super admin owns nothing, so a write cannot guess a target.
  const admin = await api('POST', '/api/auth/login', {
    body: { email: 'root@restora.test', password: 'super-secret-1' },
  })
  const me = await api('GET', '/api/auth/me', { cookie: admin.cookie })
  assert.equal(me.data.user.owner, null)

  const attempt = await api('POST', '/api/users', {
    cookie: admin.cookie,
    body: { name: 'Nobody', email: 'nobody@nowhere.test', password: 'nobody-pass-1', roleId: 'sys_server' },
  })
  assert.equal(attempt.status, 400)
  assert.match(attempt.data.error, /ownerId=/, 'the message says how to target a restaurant')

  // …and naming one works.
  const owners = await api('GET', '/api/admin/owners', { cookie: admin.cookie })
  const target = owners.data.owners.find((owner) => owner.slug === 'harbor-bistro')
  const scoped = await api('POST', `/api/users?ownerId=${target.id}`, {
    cookie: admin.cookie,
    body: { name: 'Picked Staff', email: 'picked@harbor.test', password: 'picked-pass-1', roleId: 'sys_server' },
  })
  assert.equal(scoped.status, 201)
  assert.equal(scoped.data.user.ownerId, target.id)
})
