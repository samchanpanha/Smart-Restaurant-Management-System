// ─── Restora API server ───────────────────────────────────────────
// One process, one truth: every terminal (floor tablet, KDS, office)
// posts actions here; the SHARED reducer applies them; SSE carries
// each action back out to all terminals in order.
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
//
// Serves ../dist when built, so `npm run build && npm run server`
// runs the whole restaurant on one port.

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { createTelegramRouter } from './telegram.js'
import { STATE_VERSION, buildEmpire, migrateToEmpire, reducer } from '../src/lib/reducer.js'
import { DOC_KINDS } from '../src/lib/settings.js'
import {
  actionsSince, commitAction, getCategories, getDocumentTotals, getDocuments, getInventory,
  getMenuCatalog, getSettings, getSuppliers, loadSnapshot, logStats, saveSnapshot, syncMenuCatalog,
} from './db.js'

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

// HYDRATE is a local-only bootstrap action — never applied server-side.
const REJECTED = new Set(['HYDRATE'])

// ─── Boot ───────────────────────────────────────────────────────

let persisted = loadSnapshot()
let migrated = migrateToEmpire(persisted?.state)
let state = migrated || buildEmpire()
let seq = persisted?.seq || 0
if (!migrated) {
  saveSnapshot(state, seq)
  console.log('[restora] seeded fresh two-store empire')
} else {
  if (persisted.state.version !== STATE_VERSION) {
    saveSnapshot(state, seq)
    console.log(`[restora] migrated snapshot v${persisted.state.version} → v${STATE_VERSION}`)
  } else {
    console.log(`[restora] restored empire snapshot at seq=${seq}`)
  }
  // Also backfill the relational menu tables when booting an older SQLite file.
  syncMenuCatalog(state)
}

// ─── App ────────────────────────────────────────────────────────

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (req, res) => {
  res.json({ ok: true, seq, terminals: subscribers.size, log: logStats() })
})

app.get('/api/state', (req, res) => {
  res.json({ state, seq })
})

// Relational read model for owner catalog and guest-menu displays.
// Example: GET /api/menu?loc=downtown&q=burger&availableOnly=true
app.get('/api/menu', (req, res) => {
  const locationId = typeof req.query.loc === 'string' ? req.query.loc : 'downtown'
  if (!Object.hasOwn(state.locations || {}, locationId)) {
    return res.status(400).json({ error: 'loc must name a configured restaurant location' })
  }
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : ''
  if (query.length > 80 || category.length > 40) {
    return res.status(400).json({ error: 'search and category values are too long' })
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json(getMenuCatalog(locationId, {
    query,
    category,
    availableOnly: req.query.availableOnly === 'true',
  }))
})

// ─── Configuration read models ──────────────────────────────────
// Every endpoint takes ?loc=<locationId> and answers from the SQLite
// projection, so a terminal can read configuration without the snapshot.

function resolveLocation(req, res) {
  const locationId = typeof req.query.loc === 'string' ? req.query.loc : 'downtown'
  if (!Object.hasOwn(state.locations || {}, locationId)) {
    res.status(400).json({ error: 'loc must name a configured restaurant location' })
    return null
  }
  return locationId
}

function shortQuery(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

app.get('/api/suppliers', (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  res.setHeader('Cache-Control', 'no-store')
  res.json({ locationId, suppliers: getSuppliers(locationId) })
})

app.get('/api/inventory', (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  const supplierId = shortQuery(req.query.supplierId, 60)
  const query = shortQuery(req.query.q, 80)
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    locationId,
    items: getInventory(locationId, {
      supplierId,
      query,
      exceptionsOnly: req.query.exceptionsOnly === 'true',
    }),
  })
})

app.get('/api/categories', (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  res.setHeader('Cache-Control', 'no-store')
  const tree = getCategories(locationId)
  res.json({
    locationId,
    categories: req.query.flat === 'true'
      ? tree.flatMap((root) => [root, ...root.children])
      : tree,
  })
})

app.get('/api/settings', (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  res.setHeader('Cache-Control', 'no-store')
  res.json({ locationId, settings: getSettings(locationId) })
})

app.get('/api/documents', (req, res) => {
  const locationId = resolveLocation(req, res)
  if (!locationId) return
  const kind = shortQuery(req.query.kind, 16)
  if (kind && !DOC_KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of ${DOC_KINDS.join(', ')}` })
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    locationId,
    summary: getDocumentTotals(locationId),
    documents: getDocuments(locationId, { kind, limit: Number(req.query.limit) || 50 }),
  })
})

app.post('/api/actions', (req, res) => {
  const { action, clientId } = req.body || {}
  if (!action || typeof action.type !== 'string') {
    return res.status(400).json({ error: 'body.action.type is required' })
  }
  if (REJECTED.has(action.type)) {
    return res.status(400).json({ error: `${action.type} is local-only` })
  }
  let next
  try {
    next = reducer(state, action)
  } catch (err) {
    // Illegal transition (e.g. two hosts seating the same table):
    // the loser resyncs from the server snapshot.
    return res.status(409).json({ error: err.message || 'illegal transition' })
  }
  if (next === state) return res.json({ seq, noop: true }) // no-op action
  // Keep action log, JSON snapshot, and normalized catalog in one SQLite commit.
  const nextSeq = commitAction(clientId, action, next)
  state = next
  seq = nextSeq
  broadcast({ seq, action, clientId: clientId || 'anon' })
  res.json({ seq })
})

// ─── Telegram bot ───────────────────────────────────────────────
// The bot runs the SAME reducer as the terminals: a /86 from a phone is
// committed, logged, and broadcast exactly like a tap on the KDS.

function applyActionServer(action, locId = 'downtown') {
  if (!action || typeof action.type !== 'string' || REJECTED.has(action.type)) return false
  const wrapped = action.type === 'LOC' ? action : { type: 'LOC', locId, action }
  const next = reducer(state, wrapped)
  if (next === state) return false
  const nextSeq = commitAction('telegram', wrapped, next)
  state = next
  seq = nextSeq
  broadcast({ seq, action: wrapped, clientId: 'telegram' })
  return true
}

const telegram = createTelegramRouter({
  getState: () => state,
  applyAction: applyActionServer,
  publicUrl: process.env.RESTORA_PUBLIC_URL || '',
})
app.use(telegram.router)

// ─── SSE fan-out ────────────────────────────────────────────────

const subscribers = new Set()

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function broadcast(msg) {
  for (const res of subscribers) {
    try {
      sendEvent(res, msg)
    } catch {
      subscribers.delete(res)
    }
  }
}

app.get('/api/events', (req, res) => {
  const since = Number(req.query.since || 0)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  // Replay what the terminal missed; force a snapshot resync if the gap is huge.
  const gap = seq - since
  if (gap > 500) {
    sendEvent(res, { resync: true, seq })
  } else if (gap > 0) {
    for (const row of actionsSince(since)) sendEvent(res, row)
  }
  sendEvent(res, { hello: true, seq })
  subscribers.add(res)

  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      clearInterval(beat)
      subscribers.delete(res)
    }
  }, 25000)

  req.on('close', () => {
    clearInterval(beat)
    subscribers.delete(res)
  })
})

// ─── Static frontend (production single-port mode) ──────────────

const rootDir = path.dirname(path.dirname(new URL(import.meta.url).pathname))
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

app.listen(PORT, HOST, () => {
  console.log(`[restora] api on http://${HOST}:${PORT} (seq=${seq})`)
})
