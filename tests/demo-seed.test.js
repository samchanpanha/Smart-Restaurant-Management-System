// ─── Demo seed smoke test ────────────────────────────────────────
// Run the demo seeder against a throwaway database, boot the server on
// it, and prove the walkthrough is real: every staff account can sign in
// and every module has data, including the guest menu by slug.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restora-demo-'))

const SLUG = 'restora-demo'
const PASSWORD = 'demo1234'
const ROLES = ['owner', 'manager', 'server', 'kitchen', 'host']

let child = null
let base = ''

function runSeed() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server/seed-demo.js'], {
      cwd: root,
      env: { ...process.env, RESTORA_DATA: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    proc.stdout.on('data', (chunk) => { out += chunk.toString() })
    proc.stderr.on('data', (chunk) => { out += chunk.toString() })
    proc.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`seed exited ${code}:\n${out}`))))
  })
}

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

before(async () => {
  await runSeed()
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      RESTORA_DATA: dataDir,
      PORT: '0',
      HOST: '127.0.0.1',
      SUPERADMIN_EMAIL: '',
      SUPERADMIN_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  base = await waitForPort(child)
})

after(async () => {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('every staff role has a working sign-in', async () => {
  for (const role of ROLES) {
    const email = `${role}@${SLUG}.demo`
    const res = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } })
    assert.equal(res.status, 200, `${role} should sign in`)
    assert.equal(res.data.user.role.key, role)
    assert.equal(res.data.user.owner.slug, SLUG)
    assert.ok(Array.isArray(res.data.user.screens) && res.data.user.screens.length > 0, `${role} has screens`)
  }
})

test('the demo shop has data in every module', async () => {
  const login = await api('POST', '/api/auth/login', { body: { email: `owner@${SLUG}.demo`, password: PASSWORD } })
  const { data } = await api('GET', '/api/state', { cookie: login.cookie })
  const state = data.state
  assert.ok(state?.locations?.downtown && state.locations.riverside, 'two locations')

  for (const [id, shop] of Object.entries(state.locations)) {
    const label = `${id} shop`
    assert.ok(shop.tables.length > 0, `${label} has tables`)
    assert.ok(shop.menu.length > 0, `${label} has menu items`)
    assert.ok(shop.inventory.length > 0, `${label} has inventory`)
    assert.ok(shop.suppliers.length > 0, `${label} has suppliers`)
    assert.ok(shop.purchases.length > 0, `${label} has purchases`)
    assert.ok(shop.movements.length > 0, `${label} has a stock ledger`)
    assert.ok(shop.orders.length > 0, `${label} has tickets`)
    assert.ok(shop.documents.length > 0, `${label} has issued documents`)
    assert.ok(shop.salesHistory.length > 0, `${label} has sales history`)
    assert.ok(shop.settings?.restaurantName?.startsWith('Restora'), `${label} is named`)
  }
})

test('the guest menu is reachable by slug without signing in', async () => {
  const { status, data } = await api('GET', `/api/state?owner=${SLUG}`)
  assert.equal(status, 200)
  assert.ok((data.state?.locations?.downtown?.menu || []).length > 0)
})
