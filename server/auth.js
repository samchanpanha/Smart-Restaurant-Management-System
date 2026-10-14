// ─── Restora accounts, roles, and sessions ─────────────────────────
// Phase 1 of multi-tenant ownership: real accounts, owner-scoped roles,
// and a super admin who manages every host owner. Restaurant data is not
// yet isolated per owner (Phase 2) — this layer owns identity only.
//
//   POST /api/auth/register   → create a host owner + its first owner user
//   POST /api/auth/login      → email + password → httpOnly session cookie
//   POST /api/auth/logout     → drop the session
//   GET  /api/auth/me         → the signed-in identity (null when anonymous)
//
//   GET/POST/PATCH/DELETE /api/roles            → owner-scoped role store
//   GET/POST/PATCH/DELETE /api/users            → owner-scoped user store
//   GET/POST/PATCH/DELETE /api/admin/owners     → super-admin tenant store
//
// Passwords are hashed with scrypt; sessions are opaque random tokens kept
// server-side in SQLite, delivered as an httpOnly cookie.

import crypto from 'node:crypto'
import express from 'express'
import { db } from './db.js'

// ─── Schema ──────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_owners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_roles (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    screens TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES auth_owners (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role_id TEXT NOT NULL,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES auth_owners (id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES auth_roles (id)
  );
  CREATE INDEX IF NOT EXISTS auth_users_by_owner ON auth_users (owner_id);

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE CASCADE
  );
`)

// ─── Vocabulary ──────────────────────────────────────────────────

const SESSION_COOKIE = 'restora_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // one week
const MIN_PASSWORD = 8

// Every screen a role can be granted. The workspace router maps these to
// the same screen components the sidebar already knows.
export const ALL_SCREENS = [
  'dashboard', 'floor', 'tickets', 'kitchen', 'menu', 'catalog', 'inventory',
  'movements', 'purchases', 'suppliers', 'reports', 'costing', 'settings',
  'telegram', 'system', 'users', 'roles', 'owners',
]

// System roles are shared by every host owner (owner_id NULL, is_system 1).
// The super admin owns the tenant console; a host owner runs their own shop.
const SYSTEM_ROLES = [
  { id: 'sys_super', key: 'super', label: 'Super admin', screens: ['*'] },
  { id: 'sys_owner', key: 'owner', label: 'Owner', screens: ALL_SCREENS.filter((s) => s !== 'owners') },
  {
    id: 'sys_manager', key: 'manager', label: 'Manager',
    screens: ['dashboard', 'floor', 'tickets', 'kitchen', 'menu', 'catalog', 'inventory', 'movements', 'purchases', 'suppliers', 'reports', 'costing', 'settings', 'telegram', 'users'],
  },
  { id: 'sys_server', key: 'server', label: 'Server', screens: ['floor', 'tickets'] },
  { id: 'sys_kitchen', key: 'kitchen', label: 'Kitchen', screens: ['kitchen'] },
  { id: 'sys_host', key: 'host', label: 'Host', screens: ['floor', 'dashboard'] },
]

const ROLE_BY_KEY = Object.fromEntries(SYSTEM_ROLES.map((role) => [role.key, role]))

// ─── Small helpers ───────────────────────────────────────────────

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isEmail(value) {
  return value.length <= 254 && EMAIL_RE.test(value)
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'owner'
}

function normalizeScreens(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const entry of raw) {
    if (entry === '*') return ['*']
    if (typeof entry !== 'string') continue
    const screen = entry.trim()
    if (!ALL_SCREENS.includes(screen) || seen.has(screen)) continue
    seen.add(screen)
    out.push(screen)
  }
  return out
}

// ─── Password hashing (scrypt) ───────────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  let derived
  try {
    derived = crypto.scryptSync(password, salt, expected.length)
  } catch {
    return false
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
}

// ─── Cookies ─────────────────────────────────────────────────────

function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim())
    } catch {
      out[key] = part.slice(idx + 1).trim()
    }
  }
  return out
}

function cookieHeader(token, maxAgeSeconds) {
  const bits = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (typeof maxAgeSeconds === 'number') bits.push(`Max-Age=${maxAgeSeconds}`)
  if (process.env.RESTORA_SECURE_COOKIES === '1') bits.push('Secure')
  return bits.join('; ')
}

// ─── Prepared statements ─────────────────────────────────────────

const q = {
  ownerById: db.prepare('SELECT * FROM auth_owners WHERE id = ?'),
  ownerBySlug: db.prepare('SELECT id FROM auth_owners WHERE slug = ?'),
  ownerBySlugFull: db.prepare('SELECT * FROM auth_owners WHERE slug = ?'),
  insertOwner: db.prepare('INSERT INTO auth_owners (id, name, slug, status, created_at) VALUES (?, ?, ?, ?, ?)'),
  updateOwner: db.prepare('UPDATE auth_owners SET name = ?, status = ? WHERE id = ?'),
  deleteOwner: db.prepare('DELETE FROM auth_owners WHERE id = ?'),
  owners: db.prepare('SELECT * FROM auth_owners ORDER BY created_at ASC'),
  ownerUserCount: db.prepare('SELECT COUNT(*) AS n FROM auth_users WHERE owner_id = ?'),

  roleById: db.prepare('SELECT * FROM auth_roles WHERE id = ?'),
  roleByOwnerKey: db.prepare('SELECT * FROM auth_roles WHERE owner_id = ? AND key = ?'),
  systemRoles: db.prepare('SELECT * FROM auth_roles WHERE is_system = 1 ORDER BY rowid ASC'),
  ownerRoles: db.prepare('SELECT * FROM auth_roles WHERE owner_id = ? ORDER BY created_at ASC'),
  insertRole: db.prepare('INSERT INTO auth_roles (id, owner_id, key, label, screens, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateRole: db.prepare('UPDATE auth_roles SET label = ?, screens = ? WHERE id = ?'),
  deleteRole: db.prepare('DELETE FROM auth_roles WHERE id = ?'),
  roleUserCount: db.prepare('SELECT COUNT(*) AS n FROM auth_users WHERE role_id = ?'),

  userById: db.prepare('SELECT * FROM auth_users WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM auth_users WHERE email = ? COLLATE NOCASE'),
  insertUser: db.prepare(`INSERT INTO auth_users
    (id, owner_id, email, name, password_hash, role_id, is_super_admin, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateUser: db.prepare('UPDATE auth_users SET name = ?, role_id = ?, status = ?, updated_at = ? WHERE id = ?'),
  updateUserPassword: db.prepare('UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM auth_users WHERE id = ?'),
  ownerUsers: db.prepare('SELECT * FROM auth_users WHERE owner_id = ? ORDER BY created_at ASC'),
  allUsers: db.prepare('SELECT * FROM auth_users ORDER BY created_at ASC'),
  usersForRole: db.prepare('SELECT id FROM auth_users WHERE role_id = ? LIMIT 1'),

  insertSession: db.prepare('INSERT INTO auth_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionByToken: db.prepare('SELECT * FROM auth_sessions WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM auth_sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?'),
}

// ─── Serialization ───────────────────────────────────────────────

function roleView(row) {
  if (!row) return null
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    screens: JSON.parse(row.screens),
    isSystem: Boolean(row.is_system),
    ownerId: row.owner_id,
  }
}

function ownerView(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    userCount: q.ownerUserCount.get(row.id).n,
  }
}

function userView(row) {
  if (!row) return null
  return {
    id: row.id,
    ownerId: row.owner_id,
    email: row.email,
    name: row.name,
    roleId: row.role_id,
    role: roleView(q.roleById.get(row.role_id)),
    isSuperAdmin: Boolean(row.is_super_admin),
    status: row.status,
    createdAt: row.created_at,
  }
}

function publicUser(user, owner) {
  const role = roleView(q.roleById.get(user.role_id))
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: Boolean(user.is_super_admin),
    status: user.status,
    role,
    owner: ownerView(owner),
    screens: role?.screens || [],
  }
}

// ─── Sessions ────────────────────────────────────────────────────

function startSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const created = new Date()
  const expires = new Date(created.getTime() + SESSION_TTL_MS)
  q.insertSession.run(token, userId, created.toISOString(), expires.toISOString())
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) }
}

// ─── Seed ────────────────────────────────────────────────────────

export function seedAuth() {
  seedSystemRoles()

  const created = nowIso()
  const email = normalizeEmail(process.env.SUPERADMIN_EMAIL)
  const password = String(process.env.SUPERADMIN_PASSWORD || '')
  if (email && password) {
    const existing = q.userByEmail.get(email)
    if (!existing) {
      if (password.length < MIN_PASSWORD) {
        console.warn('[restora] SUPERADMIN_PASSWORD too short — super admin not seeded')
      } else {
        q.insertUser.run(
          uid('user'), null, email, process.env.SUPERADMIN_NAME || 'Super Admin',
          hashPassword(password), ROLE_BY_KEY.super.id, 1, 'active', created, created,
        )
        console.log(`[restora] seeded super admin ${email}`)
      }
    } else if (!existing.is_super_admin) {
      db.prepare('UPDATE auth_users SET is_super_admin = 1, role_id = ? WHERE id = ?')
        .run(ROLE_BY_KEY.super.id, existing.id)
      console.log(`[restora] promoted ${email} to super admin`)
    }
  }
  q.purgeSessions.run(nowIso())
}

// ─── Demo tenant ─────────────────────────────────────────────────
// Create (or refresh) one complete demo restaurant: a host owner plus one
// account per staff role, so a whole team can sign in for a walkthrough.
// Idempotent — re-running updates the same owner and accounts rather than
// piling up duplicates. Callers still seed the shop data (buildEmpire) and
// save the snapshot against the returned owner id.

export const DEMO_PASSWORD = 'demo1234'

const DEMO_ACCOUNTS = [
  { role: 'owner', name: 'Demo Owner' },
  { role: 'manager', name: 'Demo Manager' },
  { role: 'server', name: 'Demo Server' },
  { role: 'kitchen', name: 'Demo Kitchen' },
  { role: 'host', name: 'Demo Host' },
]

export function seedSystemRoles() {
  const created = nowIso()
  const insertSystem = db.prepare(`INSERT OR IGNORE INTO auth_roles
    (id, owner_id, key, label, screens, is_system, created_at) VALUES (?, NULL, ?, ?, ?, 1, ?)`)
  for (const role of SYSTEM_ROLES) {
    insertSystem.run(role.id, role.key, role.label, JSON.stringify(role.screens), created)
  }
}

/**
 * @param {{ ownerName?: string, slug?: string, password?: string,
 *           accounts?: { role: string, name?: string, email?: string, password?: string }[] }} options
 */
export function seedDemoTenant(options = {}) {
  seedSystemRoles()
  const ownerName = String(options.ownerName || 'Restora Demo').trim() || 'Restora Demo'
  const ownerSlug = slugify(options.slug || ownerName)
  const defaultPassword = options.password || DEMO_PASSWORD
  const requested = Array.isArray(options.accounts) && options.accounts.length ? options.accounts : DEMO_ACCOUNTS

  const existingOwner = q.ownerBySlugFull.get(ownerSlug)
  const ownerId = existingOwner?.id || uid('owner')
  const createdAt = nowIso()
  if (existingOwner) q.updateOwner.run(ownerName, 'active', ownerId)
  else q.insertOwner.run(ownerId, ownerName, ownerSlug, 'active', createdAt)

  const accounts = []
  for (const entry of requested) {
    const role = ROLE_BY_KEY[String(entry.role || '').trim()] || ROLE_BY_KEY.server
    const email = normalizeEmail(entry.email || `${role.key}@${ownerSlug}.demo`)
    const name = String(entry.name || role.label).trim() || role.label
    const password = String(entry.password || defaultPassword)
    const existing = q.userByEmail.get(email)
    if (existing && existing.owner_id && existing.owner_id !== ownerId) {
      console.warn(`[restora] demo account ${email} belongs to another owner — skipped`)
      continue
    }
    const id = existing?.id || uid('user')
    if (existing) {
      q.updateUser.run(name, role.id, 'active', nowIso(), id)
      q.updateUserPassword.run(hashPassword(password), nowIso(), id)
    } else {
      q.insertUser.run(id, ownerId, email, name, hashPassword(password), role.id, 0, 'active', createdAt, createdAt)
    }
    accounts.push({ role: role.key, label: role.label, email, name, password })
  }

  return {
    owner: ownerView(q.ownerById.get(ownerId)),
    slug: ownerSlug,
    password: defaultPassword,
    accounts,
  }
}

// ─── Router ──────────────────────────────────────────────────────

function readSession(req) {
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[SESSION_COOKIE]
  if (!token) return null
  const session = q.sessionByToken.get(token)
  if (!session) return null
  if (session.expires_at < nowIso()) {
    q.deleteSession.run(token)
    return null
  }
  const user = q.userById.get(session.user_id)
  if (!user || user.status !== 'active') return null
  return { token, user }
}

// ─── Tenant resolution ───────────────────────────────────────────
// The API layer attaches req.auth to every request and resolves which
// tenant's state/catalog a request may read. A signed-in user is pinned to
// their own owner; a super admin may name any owner; guests (QR + Telegram
// mini app) pick a tenant by slug through ?owner=<slug>.

export function attachAuth(req, res, next) {
  req.auth = readSession(req)
  return next()
}

export function readAuth(req) {
  return readSession(req)
}

export function getOwnerById(ownerId) {
  return ownerId ? q.ownerById.get(ownerId) || null : null
}

export function getOwnerBySlug(slug) {
  return slug ? q.ownerBySlugFull.get(String(slug)) || null : null
}

export function listOwners() {
  return q.owners.all()
}

function badRequest(res, message) {
  return res.status(400).json({ error: message })
}

function uniqueSlug(base) {
  let slug = slugify(base)
  let n = 2
  while (q.ownerBySlug.get(slug)) {
    slug = `${slugify(base)}-${n}`
    n += 1
  }
  return slug
}

function createOwnerWithOwnerUser({ ownerName, name, email, password }) {
  const ownerId = uid('owner')
  const created = nowIso()
  q.insertOwner.run(ownerId, ownerName, uniqueSlug(ownerName), 'active', created)
  const userId = uid('user')
  q.insertUser.run(userId, ownerId, email, name, hashPassword(password), ROLE_BY_KEY.owner.id, 0, 'active', created, created)
  return { ownerId, userId }
}

export function createAuthRouter() {
  function requireAuth(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'sign in required' })
    return next()
  }

  function can(permission) {
    return (req, res, next) => {
      if (!req.auth) return res.status(401).json({ error: 'sign in required' })
      if (req.auth.user.is_super_admin) return next()
      const screens = roleView(q.roleById.get(req.auth.user.role_id))?.screens || []
      if (screens.includes('*') || screens.includes(permission)) return next()
      return res.status(403).json({ error: `your role cannot manage ${permission}` })
    }
  }

  const routerApp = express.Router()
  routerApp.use(express.json())
  routerApp.use((req, res, next) => {
    req.auth = readSession(req)
    return next()
  })

  // ── Auth ───────────────────────────────────────────────────────

  routerApp.post('/api/auth/register', (req, res) => {
    const { ownerName, name, email, password } = req.body || {}
    const cleanOwner = String(ownerName ?? '').trim()
    const cleanName = String(name ?? '').trim()
    const cleanEmail = normalizeEmail(email)
    const pass = String(password ?? '')
    if (cleanOwner.length < 2) return badRequest(res, 'restaurant/business name is required')
    if (cleanName.length < 2) return badRequest(res, 'your name is required')
    if (!isEmail(cleanEmail)) return badRequest(res, 'a valid email is required')
    if (pass.length < MIN_PASSWORD) return badRequest(res, `password must be at least ${MIN_PASSWORD} characters`)
    if (q.userByEmail.get(cleanEmail)) return res.status(409).json({ error: 'that email is already registered' })

    const { ownerId, userId } = createOwnerWithOwnerUser({
      ownerName: cleanOwner, name: cleanName, email: cleanEmail, password: pass,
    })
    const session = startSession(userId)
    res.setHeader('Set-Cookie', cookieHeader(session.token, session.maxAge))
    return res.status(201).json({ user: publicUser(q.userById.get(userId), q.ownerById.get(ownerId)) })
  })

  routerApp.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {}
    const cleanEmail = normalizeEmail(email)
    const pass = String(password ?? '')
    const user = cleanEmail ? q.userByEmail.get(cleanEmail) : null
    if (!user || !verifyPassword(pass, user.password_hash)) {
      return res.status(401).json({ error: 'email or password is incorrect' })
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'this account is disabled' })
    const session = startSession(user.id)
    res.setHeader('Set-Cookie', cookieHeader(session.token, session.maxAge))
    return res.json({ user: publicUser(user, user.owner_id ? q.ownerById.get(user.owner_id) : null) })
  })

  routerApp.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie)
    if (cookies[SESSION_COOKIE]) q.deleteSession.run(cookies[SESSION_COOKIE])
    res.setHeader('Set-Cookie', cookieHeader('', 0))
    return res.json({ ok: true })
  })

  routerApp.get('/api/auth/me', (req, res) => {
    if (!req.auth) return res.json({ user: null })
    const user = q.userById.get(req.auth.user.id)
    if (!user || user.status !== 'active') return res.json({ user: null })
    return res.json({ user: publicUser(user, user.owner_id ? q.ownerById.get(user.owner_id) : null) })
  })

  // ── Owner resolution ───────────────────────────────────────────

  // Which owner's records a request may touch. Super admin may name any
  // owner (or none, to mean "all owners"); everyone else is pinned.
  function targetOwnerId(req) {
    if (req.auth.user.is_super_admin) {
      const named = req.query.ownerId || req.body?.ownerId
      return named ? String(named) : null
    }
    return req.auth.user.owner_id
  }

  function ownerExists(ownerId) {
    return ownerId && Boolean(q.ownerById.get(ownerId))
  }

  // A role is usable by an owner if it is a system role or belongs to them.
  function roleForOwner(roleId, ownerId) {
    const role = q.roleById.get(roleId)
    if (!role) return null
    if (role.is_system) return role
    return role.owner_id === ownerId ? role : null
  }

  // Nobody below the super admin may hand out a role broader than their own,
  // so a manager cannot promote themselves (or anyone) to owner.
  function canGrantRole(actor, role) {
    if (actor.is_super_admin) return true
    const held = roleView(q.roleById.get(actor.role_id))?.screens || []
    if (held.includes('*')) return true
    const granted = roleView(role)?.screens || []
    if (granted.includes('*')) return false
    return granted.every((screen) => held.includes(screen))
  }

  // ── Roles ──────────────────────────────────────────────────────

  routerApp.get('/api/roles', requireAuth, can('roles'), (req, res) => {
    const ownerId = targetOwnerId(req)
    const system = q.systemRoles.all().map(roleView)
    if (req.auth.user.is_super_admin && !ownerId) return res.json({ roles: system })
    if (!ownerExists(ownerId)) return badRequest(res, 'an owner is required')
    return res.json({ roles: [...system, ...q.ownerRoles.all(ownerId).map(roleView)] })
  })

  routerApp.post('/api/roles', requireAuth, can('roles'), (req, res) => {
    const ownerId = targetOwnerId(req)
    if (!ownerExists(ownerId)) return badRequest(res, 'an owner is required')
    const { key, label, screens } = req.body || {}
    const cleanKey = String(key ?? '').trim().toLowerCase()
    const cleanLabel = String(label ?? '').trim()
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(cleanKey)) return badRequest(res, 'role key must be 2–32 chars: a-z, 0-9, _ or -')
    if (!cleanLabel) return badRequest(res, 'a role name is required')
    if (SYSTEM_ROLES.some((role) => role.key === cleanKey)) return res.status(409).json({ error: 'that role key is reserved' })
    if (q.roleByOwnerKey.get(ownerId, cleanKey)) return res.status(409).json({ error: 'that role key already exists' })
    const id = uid('role')
    q.insertRole.run(id, ownerId, cleanKey, cleanLabel, JSON.stringify(normalizeScreens(screens)), 0, nowIso())
    return res.status(201).json({ role: roleView(q.roleById.get(id)) })
  })

  routerApp.patch('/api/roles/:id', requireAuth, can('roles'), (req, res) => {
    const role = q.roleById.get(req.params.id)
    if (!role) return res.status(404).json({ error: 'role not found' })
    if (role.is_system) return res.status(403).json({ error: 'system roles cannot be edited' })
    const ownerId = targetOwnerId(req)
    if (!req.auth.user.is_super_admin && role.owner_id !== ownerId) {
      return res.status(403).json({ error: 'not your role' })
    }
    const label = req.body?.label !== undefined ? String(req.body.label).trim() : role.label
    if (!label) return badRequest(res, 'label cannot be empty')
    const screens = req.body?.screens !== undefined ? JSON.stringify(normalizeScreens(req.body.screens)) : role.screens
    q.updateRole.run(label, screens, role.id)
    return res.json({ role: roleView(q.roleById.get(role.id)) })
  })

  routerApp.delete('/api/roles/:id', requireAuth, can('roles'), (req, res) => {
    const role = q.roleById.get(req.params.id)
    if (!role) return res.status(404).json({ error: 'role not found' })
    if (role.is_system) return res.status(403).json({ error: 'system roles cannot be deleted' })
    const ownerId = targetOwnerId(req)
    if (!req.auth.user.is_super_admin && role.owner_id !== ownerId) {
      return res.status(403).json({ error: 'not your role' })
    }
    if (q.usersForRole.get(role.id)) return res.status(409).json({ error: 'reassign the users on this role first' })
    q.deleteRole.run(role.id)
    return res.json({ ok: true })
  })

  // ── Users ──────────────────────────────────────────────────────

  routerApp.get('/api/users', requireAuth, can('users'), (req, res) => {
    const ownerId = targetOwnerId(req)
    const rows = ownerId ? q.ownerUsers.all(ownerId) : q.allUsers.all()
    return res.json({ users: rows.map(userView) })
  })

  routerApp.post('/api/users', requireAuth, can('users'), (req, res) => {
    const ownerId = targetOwnerId(req)
    if (!ownerExists(ownerId)) return badRequest(res, 'an owner is required')
    const { name, email, password, roleId } = req.body || {}
    const cleanName = String(name ?? '').trim()
    const cleanEmail = normalizeEmail(email)
    const pass = String(password ?? '')
    if (cleanName.length < 2) return badRequest(res, 'name is required')
    if (!isEmail(cleanEmail)) return badRequest(res, 'a valid email is required')
    if (pass.length < MIN_PASSWORD) return badRequest(res, `password must be at least ${MIN_PASSWORD} characters`)
    if (q.userByEmail.get(cleanEmail)) return res.status(409).json({ error: 'that email is already registered' })
    const role = roleForOwner(String(roleId ?? ''), ownerId) || q.roleById.get(ROLE_BY_KEY.server.id)
    if (!role) return badRequest(res, 'a valid role is required')
    if (!canGrantRole(req.auth.user, role)) return res.status(403).json({ error: 'you cannot grant a role broader than your own' })
    const created = nowIso()
    const id = uid('user')
    q.insertUser.run(id, ownerId, cleanEmail, cleanName, hashPassword(String(password ?? '')), role.id, 0, 'active', created, created)
    return res.status(201).json({ user: userView(q.userById.get(id)) })
  })

  routerApp.patch('/api/users/:id', requireAuth, can('users'), (req, res) => {
    const user = q.userById.get(req.params.id)
    if (!user) return res.status(404).json({ error: 'user not found' })
    if (user.is_super_admin && !req.auth.user.is_super_admin) {
      return res.status(403).json({ error: 'cannot edit a super admin' })
    }
    const ownerId = targetOwnerId(req)
    if (!req.auth.user.is_super_admin && user.owner_id !== ownerId) {
      return res.status(403).json({ error: 'not your user' })
    }
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : user.name
    if (!name) return badRequest(res, 'name cannot be empty')
    let roleId = user.role_id
    if (req.body?.roleId !== undefined) {
      const role = roleForOwner(String(req.body.roleId), user.owner_id)
      if (!role) return badRequest(res, 'that role is not available to this owner')
      if (role.is_system && role.key === 'super' && !req.auth.user.is_super_admin) {
        return res.status(403).json({ error: 'only a super admin can grant super admin' })
      }
      if (!canGrantRole(req.auth.user, role)) return res.status(403).json({ error: 'you cannot grant a role broader than your own' })
      roleId = role.id
    }
    const status = req.body?.status !== undefined ? String(req.body.status) : user.status
    if (!['active', 'disabled'].includes(status)) return badRequest(res, 'status must be active or disabled')
    if (user.id === req.auth.user.id && status === 'disabled') return badRequest(res, 'you cannot disable yourself')
    q.updateUser.run(name, roleId, status, nowIso(), user.id)
    if (req.body?.password) {
      const pass = String(req.body.password)
      if (pass.length < MIN_PASSWORD) return badRequest(res, `password must be at least ${MIN_PASSWORD} characters`)
      q.updateUserPassword.run(hashPassword(pass), nowIso(), user.id)
    }
    return res.json({ user: userView(q.userById.get(user.id)) })
  })

  routerApp.delete('/api/users/:id', requireAuth, can('users'), (req, res) => {
    const user = q.userById.get(req.params.id)
    if (!user) return res.status(404).json({ error: 'user not found' })
    if (user.id === req.auth.user.id) return badRequest(res, 'you cannot delete yourself')
    if (user.is_super_admin) return res.status(403).json({ error: 'cannot delete a super admin' })
    const ownerId = targetOwnerId(req)
    if (!req.auth.user.is_super_admin && user.owner_id !== ownerId) {
      return res.status(403).json({ error: 'not your user' })
    }
    // Keep at least one owner user per tenant.
    if (user.owner_id) {
      const role = q.roleById.get(user.role_id)
      if (role && role.key === 'owner') {
        const owners = q.ownerUsers.all(user.owner_id).filter((u) => u.role_id === role.id)
        if (owners.length <= 1) return badRequest(res, 'a restaurant must keep at least one owner')
      }
    }
    q.deleteUser.run(user.id)
    return res.json({ ok: true })
  })

  // ── Super admin: host owners ───────────────────────────────────

  function requireSuper(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'sign in required' })
    if (!req.auth.user.is_super_admin) return res.status(403).json({ error: 'super admin only' })
    return next()
  }

  routerApp.get('/api/admin/owners', requireSuper, (req, res) => {
    return res.json({ owners: q.owners.all().map(ownerView) })
  })

  routerApp.post('/api/admin/owners', requireSuper, (req, res) => {
    const { ownerName, name, email, password } = req.body || {}
    const cleanOwner = String(ownerName ?? '').trim()
    const cleanName = String(name ?? '').trim()
    const cleanEmail = normalizeEmail(email)
    const pass = String(password ?? '')
    if (cleanOwner.length < 2) return badRequest(res, 'restaurant/business name is required')
    if (cleanName.length < 2) return badRequest(res, 'owner name is required')
    if (!isEmail(cleanEmail)) return badRequest(res, 'a valid email is required')
    if (pass.length < MIN_PASSWORD) return badRequest(res, `password must be at least ${MIN_PASSWORD} characters`)
    if (q.userByEmail.get(cleanEmail)) return res.status(409).json({ error: 'that email is already registered' })
    const { ownerId, userId } = createOwnerWithOwnerUser({
      ownerName: cleanOwner, name: cleanName, email: cleanEmail, password: pass,
    })
    return res.status(201).json({
      owner: ownerView(q.ownerById.get(ownerId)),
      user: userView(q.userById.get(userId)),
    })
  })

  routerApp.patch('/api/admin/owners/:id', requireSuper, (req, res) => {
    const owner = q.ownerById.get(req.params.id)
    if (!owner) return res.status(404).json({ error: 'owner not found' })
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : owner.name
    if (!name) return badRequest(res, 'name cannot be empty')
    const status = req.body?.status !== undefined ? String(req.body.status) : owner.status
    if (!['active', 'suspended'].includes(status)) return badRequest(res, 'status must be active or suspended')
    q.updateOwner.run(name, status, owner.id)
    return res.json({ owner: ownerView(q.ownerById.get(owner.id)) })
  })

  routerApp.delete('/api/admin/owners/:id', requireSuper, (req, res) => {
    const owner = q.ownerById.get(req.params.id)
    if (!owner) return res.status(404).json({ error: 'owner not found' })
    q.deleteOwner.run(owner.id) // cascades users, roles, sessions
    return res.json({ ok: true })
  })

  return routerApp
}
