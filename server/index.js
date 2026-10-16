// ─── Restora API server ───────────────────────────────────────────
// One process, many tenants: each host owner gets an isolated runtime
// (state snapshot + action log + live SSE subscribers). A terminal posts
// an action, the SHARED reducer applies it, and SSE fans it back out to
// every terminal of that same tenant.
//
//   GET  /api/health        → { ok, seq, terminals }
//   GET  /api/state         → { state, seq }  (boot snapshot)
//   GET  /api/menu          → normalized catalog (loc, q, category, availableOnly)
//   GET  /api/suppliers     → supplier directory (loc)
//   GET  /api/inventory     → stock items joined to suppliers (loc, q, supplierId)
//   GET  /api/categories    → category tree with sub-categories (loc)
//   GET  /api/settings      → configuration for one location (loc)
//   GET  /api/documents     → issued invoice/receipt/ticket/report registry (loc)
//   POST /api/actions       → { seq } | 409 (illegal transition)
//   GET  /api/events?since=N → SSE stream (replay + live)
//   POST /api/telegram/webhook  → Telegram update → bot reply (+ actions)
//   POST /api/telegram/simulate → run a bot command without changing state
//   GET  /api/telegram/status   → token/chat wiring and command list
//   GET  /api/ai/status         → is AI configured, provider/model, limits
//   POST /api/ai/chat           → grounded Q&A over the live shift (read-only)
//   POST /api/ai/insight        → alert/menu/reorder/forecast suggestions
//   POST /api/ai/briefing       → shift briefing (optionally pushed to Telegram)
//   GET  /api/ai/config         → tenant AI provider config (owner-only, no key)
//   PUT  /api/ai/config         → save tenant AI provider/key (owner-only)
//   POST /api/ai/config/test    → live provider connectivity check (owner-only)
//
// Tenant resolution: a signed-in user is pinned to their own owner; a super
// admin may name any owner via ?ownerId=; guests (QR + Telegram mini app)
// pick a tenant via ?owner=<slug>. A named tenant that does not exist is a
// 404. The bot is bound to RESTORA_TENANT (or the first owner, or the legacy
// DEFAULT_OWNER tenant).
//
// Serves ../dist when built, so `npm run build && npm run server`
// runs the whole restaurant on one port.

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachAuth, createAuthRouter, getOwnerById, getOwnerBySlug, listOwners, seedAuth, userRole } from './auth.js'
import { createTelegramRouter, sendTelegramMessage } from './telegram.js'
import { createAiRouter } from './ai.js'
import { createAiConfigRouter } from './ai-config.js'
import { createNotifier, sendTelegramEvent } from './notify.js'
import { replyKeyboard } from '../src/lib/telegram.js'
import { STATE_VERSION, buildEmpire, migrateToEmpire, reducer } from '../src/lib/reducer.js'
import { DOC_KINDS } from '../src/lib/settings.js'
import {
  db, DEFAULT_OWNER, actionsSince, commitAction, getAiConfig, getCategories, getDocumentTotals, getDocuments,
  getInventory, getMenuCatalog, getSettings, getSuppliers, loadSnapshot, logStats, saveSnapshot, setAiConfig,
  syncMenuCatalog,
} from './db.js'

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

// HYDRATE is a local-only bootstrap action — never applied server-side.
const REJECTED = new Set(['HYDRATE'])

// ─── Tenant runtimes ────────────────────────────────────────────
// Lazily materialized per owner: the persisted snapshot is migrated on
// first touch, and each tenant keeps its own action sequence + SSE fans.

const runtimes = new Map()

function configuredTenantId() {
  const raw = String(process.env.RESTORA_TENANT || '').trim()
  if (raw) {
    const byId = getOwnerById(raw)
    if (byId) return byId.id
    const bySlug = getOwnerBySlug(raw)
    if (bySlug) return bySlug.id
  }
  const first = listOwners()[0]
  return first?.id || DEFAULT_OWNER
}

// The tenant the Telegram bot and its notifications belong to.
const DEFAULT_TENANT = configuredTenantId()

function runtimeFor(ownerId) {
  const id = ownerId || DEFAULT_TENANT
  const existing = runtimes.get(id)
  if (existing) return existing
  const persisted = loadSnapshot(id)
  const migrated = migrateToEmpire(persisted?.state)
  let state = migrated || buildEmpire()
  let seq = persisted?.seq || 0
  if (!migrated) {
    saveSnapshot(id, state, seq)
    console.log(`[restora] seeded fresh two-store empire for tenant ${id}`)
  } else if (persisted.state.version !== STATE_VERSION) {
    saveSnapshot(id, state, seq)
    console.log(`[restora] migrated tenant ${id} snapshot v${persisted.state.version} → v${STATE_VERSION}`)
  } else {
    // Also backfill the relational menu tables when booting an older SQLite file.
    syncMenuCatalog(id, state)
    console.log(`[restora] restored tenant ${id} at seq=${seq}`)
  }
  const runtime = { ownerId: id, state, seq, subscribers: new Set() }
  runtimes.set(id, runtime)
  return runtime
}

// Attach auth + the resolved tenant to every API request. A named tenant
// that does not exist is a 404 (never a fresh empty tenant); suspended
// tenants are locked out for everyone except a super admin.
function resolveTenant(req, res, next) {
  const isSuper = Boolean(req.auth && req.auth.user.is_super_admin)
  let ownerId = DEFAULT_TENANT
  let named = false
  if (req.auth) {
    if (isSuper) {
      const wanted = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : ''
      if (wanted) {
        ownerId = wanted
        named = true
      }
    } else {
      ownerId = req.auth.user.owner_id || DEFAULT_TENANT
    }
  } else {
    const slug = typeof req.query.owner === 'string' ? req.query.owner.trim() : ''
    if (slug) {
      const owner = getOwnerBySlug(slug)
      if (!owner) return res.status(404).json({ error: 'unknown restaurant' })
      ownerId = owner.id
    }
  }
  const owner = getOwnerById(ownerId)
  if (named && !owner) return res.status(404).json({ error: 'unknown restaurant' })
  if (owner && owner.status !== 'active' && !isSuper) {
    return res.status(403).json({ error: 'this restaurant is unavailable' })
  }
  req.tenantId = ownerId
  req.tenant = owner
  // A staff member assigned to one branch is pinned to it: the snapshot
  // they receive, the catalog they read, and the actions they send all
  // stay inside that branch. Owners, super admins, and guests are free.
  req.scopeLocationId = null
  if (!isSuper && req.auth && req.auth.user.location_id) {
    const locations = runtimeFor(ownerId).state.locations || {}
    if (Object.hasOwn(locations, req.auth.user.location_id)) {
      req.scopeLocationId = req.auth.user.location_id
    }
  }
  return next()
}

// ─── App ────────────────────────────────────────────────────────

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(attachAuth)

// Accounts, roles, sessions, and the super-admin tenant console.
seedAuth()
app.use(createAuthRouter())

app.get('/api/health', resolveTenant, (req, res) => {
  const runtime = runtimeFor(req.tenantId)
  res.json({ ok: true, seq: runtime.seq, terminals: runtime.subscribers.size, log: logStats(runtime.ownerId) })
})

// A branch-pinned user only ever receives their own branch, so branch
// switchers, cross-branch tabs, and "all branches" views collapse on
// their own. Everyone else gets the whole empire.
function scopeState(state, scopeLocationId) {
  if (!scopeLocationId || !state?.locations || !Object.hasOwn(state.locations, scopeLocationId)) return state
  return { ...state, locations: { [scopeLocationId]: state.locations[scopeLocationId] } }
}

app.get('/api/state', resolveTenant, (req, res) => {
  const runtime = runtimeFor(req.tenantId)
  res.json({ state: scopeState(runtime.state, req.scopeLocationId), seq: runtime.seq })
})

// Relational read model for owner catalog and guest-menu displays.
// Example: GET /api/menu?loc=downtown&q=burger&availableOnly=true&owner=joes-diner
app.get('/api/menu', resolveTenant, (req, res) => {
  const locationId = typeof req.query.loc === 'string' ? req.query.loc : (req.scopeLocationId || 'downtown')
  if (req.scopeLocationId && locationId !== req.scopeLocationId) {
    return res.status(403).json({ error: 'your account is restricted to its assigned branch' })
  }
  const state = runtimeFor(req.tenantId).state
  if (!Object.hasOwn(state.locations || {}, locationId)) {
    return res.status(400).json({ error: 'loc must name a configured restaurant location' })
  }
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : ''
  if (query.length > 80 || category.length > 40) {
    return res.status(400).json({ error: 'search and category values are too long' })
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json(getMenuCatalog(req.tenantId, locationId, {
    query,
    category,
    availableOnly: req.query.availableOnly === 'true',
  }))
})

// ─── Configuration read models ──────────────────────────────────
// Every endpoint takes ?loc=<locationId> and answers from the SQLite
// projection, so a terminal can read configuration without the snapshot.

function resolveLocation(req, res) {
  const locationId = typeof req.query.loc === 'string' ? req.query.loc : (req.scopeLocationId || 'downtown')
  if (req.scopeLocationId && locationId !== req.scopeLocationId) {
    res.status(403).json({ error: 'your account is restricted to its assigned branch' })
    return null
  }
  const state = runtimeFor(req.tenantId).state
  if (!Object.hasOwn(state.locations || {}, locationId)) {
    res.status(400).json({ error: 'loc must name a configured restaurant location' })
    return null
  }
  return locationId
}

function shortQuery(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

app.get('/api/suppliers', resolveTenant, (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  res.setHeader('Cache-Control', 'no-store')
  res.json({ locationId, suppliers: getSuppliers(req.tenantId, locationId) })
})

app.get('/api/inventory', resolveTenant, (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  const supplierId = shortQuery(req.query.supplierId, 60)
  const query = shortQuery(req.query.q, 80)
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    locationId,
    items: getInventory(req.tenantId, locationId, {
      supplierId,
      query,
      exceptionsOnly: req.query.exceptionsOnly === 'true',
    }),
  })
})

app.get('/api/categories', resolveTenant, (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  res.setHeader('Cache-Control', 'no-store')
  const tree = getCategories(req.tenantId, locationId)
  res.json({
    locationId,
    categories: req.query.flat === 'true'
      ? tree.flatMap((root) => [root, ...root.children])
      : tree,
  })
})

app.get('/api/settings', resolveTenant, (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  res.setHeader('Cache-Control', 'no-store')
  res.json({ locationId, settings: getSettings(req.tenantId, locationId) })
})

app.get('/api/documents', resolveTenant, (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  const kind = shortQuery(req.query.kind, 16)
  if (kind && !DOC_KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of ${DOC_KINDS.join(', ')}` })
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    locationId,
    summary: getDocumentTotals(req.tenantId, locationId),
    documents: getDocuments(req.tenantId, locationId, { kind, limit: Number(req.query.limit) || 50 }),
  })
})

app.post('/api/actions', resolveTenant, (req, res) => {
  const { action, clientId } = req.body || {}
  if (!action || typeof action.type !== 'string') {
    return res.status(400).json({ error: 'body.action.type is required' })
  }
  if (REJECTED.has(action.type)) {
    return res.status(400).json({ error: `${action.type} is local-only` })
  }
  // Branch-pinned users may only send shop actions to their own branch —
  // never the empire-level ones (reset, branch create/remove).
  if (req.scopeLocationId) {
    if (action.type !== 'LOC' || String(action.locId ?? '') !== req.scopeLocationId) {
      return res.status(403).json({ error: 'your account is restricted to its assigned branch' })
    }
  }
  const runtime = runtimeFor(req.tenantId)
  let next
  try {
    next = reducer(runtime.state, action)
  } catch (err) {
    // Illegal transition (e.g. two hosts seating the same table):
    // the loser resyncs from the server snapshot.
    return res.status(409).json({ error: err.message || 'illegal transition' })
  }
  if (next === runtime.state) return res.json({ seq: runtime.seq, noop: true }) // no-op action
  // Keep action log, JSON snapshot, and normalized catalog in one SQLite commit.
  const previous = runtime.state
  const nextSeq = commitAction(runtime.ownerId, clientId, action, next)
  runtime.state = next
  runtime.seq = nextSeq
  broadcast(runtime, { seq: nextSeq, action, clientId: clientId || 'anon' })
  // The chat hears about what the floor just did (fire-and-forget).
  if (runtime.ownerId === DEFAULT_TENANT) notifier?.handleAction(previous, next, action)
  res.json({ seq: nextSeq })
})

app.post('/api/miniapp/tables/:tableId/claim', async (req, res) => {
  try {
    const { tableId } = req.params
    const { tenantId = DEFAULT_TENANT, guestName, partySize = 2, sessionToken } = req.body || {}

    const state = await db.getState(tenantId)
    if (!state) return res.status(404).json({ error: 'Tenant state not found' })
    const table = (state.tables || []).find((t) => String(t.id) === String(tableId))

    if (!table) return res.status(404).json({ error: 'Table not found' })
    if (!['available', 'free', 'idle'].includes(table.status)) {
      return res.status(409).json({ error: 'Table is already occupied' })
    }

    if (partySize > (table.capacity || table.seats || 12) + 2) {
      return res.status(400).json({ error: 'Party size exceeds table capacity' });
    }

    table.status = 'occupied'
    table.guestName = guestName?.trim() || 'Walk-in Guest'
    table.partySize = Number(partySize)
    table.sessionToken = sessionToken
    table.seatedAt = new Date().toISOString()
    table.selfSeated = true

    await db.saveState(tenantId, state)

    const runtime = runtimes.get(tenantId)
    if (runtime) {
      const action = {
        type: 'MINIAPP_CLAIM_TABLE',
        payload: { tableId, guestName, partySize, sessionToken },
      }
      const locId = req.body?.locId || 'downtown'
      const wrapped = { type: 'LOC', locId, action }
      try {
        const next = reducer(runtime.state, wrapped)
        const nextSeq = commitAction(runtime.ownerId, 'miniapp', wrapped, next)
        runtime.state = next
        runtime.seq = nextSeq
        broadcast(runtime, { seq: nextSeq, action: wrapped, clientId: 'miniapp' })
      } catch {
        /* best-effort sync */
      }
    }

    // Trigger Telegram notification to restaurant floor group
    await (notifier?.sendTelegramEvent || sendTelegramEvent)(tenantId, {
      type: 'SELF_SEATED',
      text: `🪑 *New Self-Seated Table*\n• Table: *${table.name || table.id}*\n• Guest: ${table.guestName} (${table.partySize} pax)\n• Status: Ready to order`,
    }).catch(() => {})

    res.json({ ok: true, table })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/miniapp/tables/:tableId/release', async (req, res) => {
  try {
    const { tableId } = req.params
    const { tenantId = DEFAULT_TENANT, sessionToken } = req.body || {}

    const state = await db.getState(tenantId)
    if (!state) return res.status(404).json({ error: 'Tenant state not found' })
    const table = (state.tables || []).find((t) => String(t.id) === String(tableId))
    if (!table) return res.status(404).json({ error: 'Table not found' })

    if (table.sessionToken && table.sessionToken !== sessionToken) {
      return res.status(403).json({ error: 'Unauthorized table session' })
    }

    const ticketList = state.tickets || state.orders || []
    const unpaidTickets = ticketList.filter(
      (tk) =>
        String(tk.tableId) === String(tableId) &&
        !['paid', 'cancelled', 'closed', 'void'].includes(tk.status) &&
        (tk.items?.length || 0) > 0,
    )

    if (unpaidTickets.length > 0) {
      table.status = 'billing'
      table.releaseRequestedAt = new Date().toISOString()
      await db.saveState(tenantId, state)

      const runtime = runtimes.get(tenantId)
      if (runtime) {
        const action = {
          type: 'MINIAPP_RELEASE_TABLE',
          payload: { tableId, sessionToken },
        }
        const locId = req.body?.locId || 'downtown'
        const wrapped = { type: 'LOC', locId, action }
        try {
          const next = reducer(runtime.state, wrapped)
          const nextSeq = commitAction(runtime.ownerId, 'miniapp', wrapped, next)
          runtime.state = next
          runtime.seq = nextSeq
          broadcast(runtime, { seq: nextSeq, action: wrapped, clientId: 'miniapp' })
        } catch {
          /* best-effort sync */
        }
      }

      await (notifier?.sendTelegramEvent || sendTelegramEvent)(tenantId, {
        type: 'BILL_REQUESTED',
        text: `💳 *Bill & Table Release Requested*\n• Table: *${table.name || table.id}*\n• Unpaid Tickets: ${unpaidTickets.length}\n• Action: Bring check / verify payment`,
      }).catch(() => {})

      return res.json({
        ok: true,
        mode: 'BILLING_REQUIRED',
        message: 'Your server has been notified to settle your bill.',
        table,
      })
    }

    const hadPaidOrders = ticketList.some(
      (tk) => String(tk.tableId) === String(tableId) && tk.status === 'paid',
    )

    table.status = hadPaidOrders ? 'cleaning' : 'available'
    table.guestName = null
    table.partySize = null
    table.sessionToken = null
    table.seatedAt = null
    table.selfSeated = false
    table.releaseRequestedAt = null

    await db.saveState(tenantId, state)

    const runtime = runtimes.get(tenantId)
    if (runtime) {
      const action = {
        type: 'MINIAPP_RELEASE_TABLE',
        payload: { tableId, sessionToken },
      }
      const locId = req.body?.locId || 'downtown'
      const wrapped = { type: 'LOC', locId, action }
      try {
        const next = reducer(runtime.state, wrapped)
        const nextSeq = commitAction(runtime.ownerId, 'miniapp', wrapped, next)
        runtime.state = next
        runtime.seq = nextSeq
        broadcast(runtime, { seq: nextSeq, action: wrapped, clientId: 'miniapp' })
      } catch {
        /* best-effort sync */
      }
    }

    await (notifier?.sendTelegramEvent || sendTelegramEvent)(tenantId, {
      type: 'TABLE_RELEASED',
      text: `✨ *Table Released by Guest*\n• Table: *${table.name || table.id}*\n• Next State: *${table.status.toUpperCase()}*`,
    }).catch(() => {})

    res.json({ ok: true, mode: 'RELEASED', table })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/bookings/:id/reschedule', async (req, res) => {
  try {
    const { id } = req.params
    const {
      tenantId = DEFAULT_TENANT,
      locId = 'downtown',
      newDate,
      newTime,
      newPartySize,
      preferredTableId,
      actor = 'guest',
    } = req.body || {}

    const state = await db.getState(tenantId)
    if (!state) return res.status(404).json({ error: 'Tenant state not found' })

    const booking = (state.reservations || []).find((r) => String(r.id) === String(id))
    if (!booking) return res.status(404).json({ error: 'Booking not found' })

    const action = {
      type: 'RESCHEDULE_BOOKING',
      payload: {
        bookingId: id,
        newDate,
        newTime,
        newPartySize,
        preferredTableId,
        actor,
      },
    }

    const wrapped = { type: 'LOC', locId, action }
    const runtime = runtimes.get(tenantId) || runtimeFor(tenantId)
    const prevShop = runtime.state.locations?.[locId] || state
    let nextEmpire
    try {
      nextEmpire = reducer(runtime.state, wrapped)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }

    if (nextEmpire === runtime.state) {
      return res.status(400).json({ error: 'Reschedule produced no state change' })
    }

    const nextSeq = commitAction(runtime.ownerId, 'api', wrapped, nextEmpire)
    runtime.state = nextEmpire
    runtime.seq = nextSeq
    broadcast(runtime, { seq: nextSeq, action: wrapped, clientId: 'api' })

    const updatedShop = nextEmpire.locations?.[locId] || nextEmpire
    await db.saveState(tenantId, updatedShop)

    const updatedBooking = (updatedShop.reservations || []).find((r) => String(r.id) === String(id))
    const prevTable = (prevShop.tables || []).find((t) => String(t.id) === String(booking.tableId))
    const nextTable = (updatedShop.tables || []).find((t) => String(t.id) === String(updatedBooking?.tableId))

    // Trigger Telegram diff notification
    const oldFmt = booking.time ? new Date(booking.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    const newFmt = updatedBooking?.time ? new Date(updatedBooking.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    await (notifier?.sendTelegramEvent || sendTelegramEvent)(tenantId, {
      type: 'BOOKING_RESCHEDULED',
      text: `📅 *Booking Rescheduled*\n• Guest: *${booking.name}* (${updatedBooking?.partySize || booking.partySize} pax)\n• Old: ${oldFmt} (${prevTable?.name || 'Unassigned'})\n• New: *${newFmt}* (${nextTable?.name || 'Unassigned'})`,
    }).catch(() => {})

    res.json({ ok: true, booking: updatedBooking })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/tables/:id/transfer', async (req, res) => {
  try {
    const { id } = req.params
    const { tenantId = DEFAULT_TENANT, locId = 'downtown', targetTableId, reason = '', actor = 'staff' } = req.body || {}

    if (!targetTableId) {
      return res.status(400).json({ error: 'targetTableId is required' })
    }

    const action = {
      type: 'APPROVE_TABLE_TRANSFER',
      payload: {
        currentTableId: id,
        targetTableId,
        reason,
        actor,
      },
    }

    const wrapped = { type: 'LOC', locId, action }
    const runtime = runtimes.get(tenantId) || runtimeFor(tenantId)
    const prevShop = runtime.state.locations?.[locId]
    let nextEmpire
    try {
      nextEmpire = reducer(runtime.state, wrapped)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }

    const nextSeq = commitAction(runtime.ownerId, 'api', wrapped, nextEmpire)
    runtime.state = nextEmpire
    runtime.seq = nextSeq
    broadcast(runtime, { seq: nextSeq, action: wrapped, clientId: 'api' })

    const updatedShop = nextEmpire.locations?.[locId] || nextEmpire
    await db.saveState(tenantId, updatedShop)

    const fromTable = (prevShop?.tables || []).find((t) => String(t.id) === String(id))
    const toTable = (updatedShop.tables || []).find((t) => String(t.id) === String(targetTableId))

    await (notifier?.sendTelegramEvent || sendTelegramEvent)(tenantId, {
      type: 'TABLE_TRANSFERRED',
      text: `🚀 *Table Transferred*\n• From: *${fromTable?.name || id}* ➔ To: *${toTable?.name || targetTableId}*\n• Guest: ${toTable?.guestName || 'Guest'} (${actor})\n• Status: Orders & active tickets rebound`,
    }).catch(() => {})

    res.json({ ok: true, fromTable: id, toTable: targetTableId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/tables/:id/transfer-request', async (req, res) => {
  try {
    const { id } = req.params
    const { tenantId = DEFAULT_TENANT, locId = 'downtown', targetTableId, reason = '', sessionToken } = req.body || {}

    if (!targetTableId) {
      return res.status(400).json({ error: 'targetTableId is required' })
    }

    const action = {
      type: 'REQUEST_TABLE_TRANSFER',
      payload: {
        currentTableId: id,
        targetTableId,
        reason,
        sessionToken,
      },
    }

    const wrapped = { type: 'LOC', locId, action }
    const runtime = runtimes.get(tenantId) || runtimeFor(tenantId)
    const nextEmpire = reducer(runtime.state, wrapped)
    const nextSeq = commitAction(runtime.ownerId, 'api', wrapped, nextEmpire)
    runtime.state = nextEmpire
    runtime.seq = nextSeq
    broadcast(runtime, { seq: nextSeq, action: wrapped, clientId: 'api' })

    const updatedShop = nextEmpire.locations?.[locId] || nextEmpire
    await db.saveState(tenantId, updatedShop)

    const fromTable = (updatedShop.tables || []).find((t) => String(t.id) === String(id))
    const toTable = (updatedShop.tables || []).find((t) => String(t.id) === String(targetTableId))

    await (notifier?.sendTelegramEvent || sendTelegramEvent)(tenantId, {
      type: 'TABLE_TRANSFER_REQUESTED',
      text: `🔄 *Table Transfer Requested*\n• From: *${fromTable?.name || id}* ➔ To: *${toTable?.name || targetTableId}*\n• Guest: ${fromTable?.guestName || 'Guest'}\n• Reason: ${reason || 'Guest requested'}`,
    }).catch(() => {})

    res.json({ ok: true, pendingTransfer: fromTable?.pendingTransfer })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// ─── Telegram bot ───────────────────────────────────────────────
// The bot runs the SAME reducer as the terminals: a /86 from a phone is
// committed, logged, and broadcast exactly like a tap on the KDS. The bot
// is bound to one tenant (RESTORA_TENANT → first owner → legacy default).

function applyActionServer(action, locId = 'downtown') {
  const runtime = runtimeFor(DEFAULT_TENANT)
  if (!action || typeof action.type !== 'string' || REJECTED.has(action.type)) return false
  const wrapped = action.type === 'LOC' ? action : { type: 'LOC', locId, action }
  const next = reducer(runtime.state, wrapped)
  if (next === runtime.state) return false
  const previous = runtime.state
  const nextSeq = commitAction(runtime.ownerId, 'telegram', wrapped, next)
  runtime.state = next
  runtime.seq = nextSeq
  broadcast(runtime, { seq: nextSeq, action: wrapped, clientId: 'telegram' })
  // A command from a phone can move stock or 86 a dish — the other chats
  // should hear about it exactly like they hear about a terminal action.
  notifier?.handleAction(previous, next, wrapped)
  return true
}

let notifier = null

const telegram = createTelegramRouter({
  getState: () => runtimeFor(DEFAULT_TENANT).state,
  applyAction: applyActionServer,
  publicUrl: process.env.RESTORA_PUBLIC_URL || '',
  ownerSlug: getOwnerById(DEFAULT_TENANT)?.slug || '',
  onChat: (chatId) => notifier?.registerChat(chatId),
  notifier: () => notifier,
})
app.use(telegram.router)

// ─── Notifications ──────────────────────────────────────────────
// Same token, same chats, other direction: the bot pushes fires, payments,
// 86s, low stock, purchase orders, and the close-of-day digest.
const roleForChat = (chatId) => telegram.chatRoles?.[chatId] || telegram.chatRoles?.['*'] || 'staff'

notifier = createNotifier({
  getState: () => runtimeFor(DEFAULT_TENANT).state,
  chatRoles: telegram.chatRoles,
  // Pushes arrive with the same reply keyboard the bot answers with, so the
  // buttons in the chat match the role the chat actually has.
  send: (chatId, text) => sendTelegramMessage(chatId, text, { keyboard: replyKeyboard(roleForChat(chatId)) }),
})

// The digest is checked once a minute; it only sends once a day, after its hour.
const digestTimer = setInterval(() => {
  Promise.resolve(notifier.tick()).catch((err) => {
    console.warn('[restora] digest failed:', err?.message || err)
  })
}, 60_000)
digestTimer.unref?.()

// ─── AI assistant ───────────────────────────────────────────────
// Provider-agnostic and read-only: the model reads a redacted digest and
// returns text — it never dispatches a reducer action. No AI_API_KEY ⇒ every
// route is a no-op. Tenant-scoped through the same resolveTenant middleware
// the rest of the API uses; guests are pinned to the menu scope.
const ai = createAiRouter({
  getState: (tenantId) => runtimeFor(tenantId).state,
  resolveTenant,
  // A tenant may store its own provider/key (set from Settings); anything it
  // leaves unset falls back to the AI_* environment defaults.
  resolveConfig: (tenantId) => getAiConfig(tenantId),
  onBriefing: async (text, { tenantId, locId }) => {
    // Deliver with the *caller's* tenant settings, never the default tenant's.
    const empire = runtimeFor(tenantId || DEFAULT_TENANT).state
    const shop = empire.locations?.[locId] || empire.locations?.downtown || Object.values(empire.locations || {})[0]
    const result = await notifier.deliver(text, shop?.settings)
    return (result?.sent || 0) > 0
  },
})
app.use(ai.router)

// Only an owner (or a super admin, who may target any tenant) may read or
// change a tenant's AI provider config.
function requireAiAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'sign in required' })
  if (req.auth.user.is_super_admin) return next()
  if (userRole(req.auth.user)?.key === 'owner') return next()
  return res.status(403).json({ error: 'owner access required' })
}

const aiConfig = createAiConfigRouter({
  resolveTenant,
  requireAdmin: requireAiAdmin,
  getConfig: (ownerId) => getAiConfig(ownerId),
  setConfig: (ownerId, config) => setAiConfig(ownerId, config),
  probe: (tenantId, override) => ai.probe(tenantId, override),
  env: {
    provider: process.env.AI_PROVIDER,
    model: process.env.AI_MODEL,
    baseUrl: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY,
  },
})
app.use(aiConfig.router)

// ─── SSE fan-out ────────────────────────────────────────────────

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

// A branch-pinned terminal only hears events for its own branch. Applied to
// both live broadcasts and the replay a reconnecting terminal receives.
function eventInScope(msg, scopeLocationId) {
  if (!scopeLocationId) return true
  const action = msg?.action
  return Boolean(action?.type === 'LOC' && action.locId === scopeLocationId)
}

function broadcast(runtime, msg) {
  for (const res of runtime.subscribers) {
    if (!eventInScope(msg, res.scopeLocationId)) continue
    try {
      sendEvent(res, msg)
    } catch {
      runtime.subscribers.delete(res)
    }
  }
}

app.get('/api/events', resolveTenant, (req, res) => {
  const runtime = runtimeFor(req.tenantId)
  const since = Number(req.query.since || 0)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  // Replay what the terminal missed; force a snapshot resync if the gap is huge.
  const scope = req.scopeLocationId
  const gap = runtime.seq - since
  if (gap > 500) {
    sendEvent(res, { resync: true, seq: runtime.seq })
  } else if (gap > 0) {
    for (const row of actionsSince(runtime.ownerId, since, 500)) {
      if (eventInScope(row, scope)) sendEvent(res, row)
    }
  }
  sendEvent(res, { hello: true, seq: runtime.seq })
  res.scopeLocationId = scope
  runtime.subscribers.add(res)

  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      clearInterval(beat)
      runtime.subscribers.delete(res)
    }
  }, 25_000)

  req.on('close', () => {
    clearInterval(beat)
    runtime.subscribers.delete(res)
  })
})

// ─── Static frontend (production single-port mode) ──────────────

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const distDir = path.join(rootDir, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
  console.log('[restora] serving frontend from dist/')
} else {
  console.log('[restora] dist/ not found — API only (run `npm run build` or use vite dev proxy)')
}

// ─── Listen ─────────────────────────────────────────────────────

const bootRuntime = runtimeFor(DEFAULT_TENANT)
const server = app.listen(PORT, HOST, () => {
  const addr = server.address()
  const port = addr && typeof addr === 'object' ? addr.port : PORT
  console.log(`[restora] api on http://${HOST}:${port} (tenant=${DEFAULT_TENANT} seq=${bootRuntime.seq})`)
})
