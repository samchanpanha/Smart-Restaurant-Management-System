// ─── What a registered owner may open ───────────────────────────────
// Registration hands the first account the host-owner role and every other
// restaurant its owner role. That promise is only as good as the two screen
// lists agreeing: the server grants screens by name, the sidebar shows the
// screens the workspace knows about, and a name missing from either side is a
// screen nobody can ever open (Ops Copilot was granted by the sidebar and
// unknown to the server, so every owner — and every role they created — was
// missing it).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-grant-'))
process.env.RESTORA_DATA = dataDir
delete process.env.SUPERADMIN_EMAIL
delete process.env.SUPERADMIN_PASSWORD

const express = (await import('express')).default
const { createAuthRouter, seedAuth, ALL_SCREENS } = await import('../server/auth.js')
const { NAV_SECTIONS } = await import('../src/lib/constants.js')

// The workspace nav, flattened — the screens an operator can actually reach.
const WORKSPACE_SCREENS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.id))

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
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.() })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function api(method, route, { body, token } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

test('the server and the workspace agree on every screen', () => {
  assert.deepEqual([...ALL_SCREENS].sort(), [...WORKSPACE_SCREENS].sort(),
    'a screen only one side knows about can never be granted')
  assert.ok(ALL_SCREENS.includes('assistant'), 'Ops Copilot is a screen like any other')
})

test('a registered owner is granted every owner screen, and nothing above it', async () => {
  // The first account is the platform's host owner…
  const host = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Harbor Bistro', name: 'Nora Owner', email: 'nora@harbor.test', password: 'hunter2-long' },
  })
  assert.equal(host.status, 201)
  assert.equal(host.data.user.isSuperAdmin, true)
  assert.deepEqual(host.data.user.screens, ['*'], 'the host owner holds every screen, console included')

  // …and every restaurant after that is an ordinary owner.
  const registered = await api('POST', '/api/auth/register', {
    body: { ownerName: 'Riverside Grill', name: 'Rae Owner', email: 'rae@riverside.test', password: 'river-pass-1' },
  })
  assert.equal(registered.status, 201)
  assert.equal(registered.data.user.isSuperAdmin, false)
  const screens = registered.data.user.screens

  for (const screen of WORKSPACE_SCREENS) {
    if (screen === 'owners') continue // the platform console is the super admin's
    assert.ok(screens.includes(screen), `the owner may open ${screen}`)
  }
  assert.ok(!screens.includes('owners'), 'but not the tenant console')

  // The same list is what the Roles screen offers to build from, and what a
  // staff member gets when the owner picks a role.
  const roles = await api('GET', '/api/roles', { token: registered.data.token })
  const byKey = Object.fromEntries(roles.data.roles.map((role) => [role.key, role]))
  assert.ok(byKey.owner.screens.includes('assistant'))
  assert.ok(byKey.manager.screens.includes('assistant'))
  assert.ok(byKey.host.screens.includes('assistant'))
  assert.deepEqual(byKey.server.screens, ['floor', 'tickets'])
  assert.deepEqual(byKey.kitchen.screens, ['kitchen'])
})

test('a database seeded by an older release picks the new screen up', async () => {
  // Rewind the owner role to the list an earlier release would have written…
  const { db } = await import('../server/db.js')
  const before = db.prepare('SELECT screens FROM auth_roles WHERE id = ?').get('sys_owner')
  assert.ok(before)
  db.prepare('UPDATE auth_roles SET screens = ? WHERE id = ?')
    .run(JSON.stringify(['dashboard', 'floor', 'users', 'roles']), 'sys_owner')

  // …then boot again, which is exactly what a restart does.
  seedAuth()
  const repaired = await api('POST', '/api/auth/login', {
    body: { email: 'rae@riverside.test', password: 'river-pass-1' },
  }).then((res) => res.data)
  assert.ok(repaired.user.screens.includes('assistant'), 'the restart restated the system roles')
  assert.ok(repaired.user.screens.includes('settings'))
})
