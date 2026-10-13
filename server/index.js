// ─── Restora API server ───────────────────────────────────────────
// One process, one truth: every terminal (floor tablet, KDS, office)
// posts actions here; the SHARED reducer applies them; SSE carries
// each action back out to all terminals in order.
//
//   GET  /api/health        → { ok, seq, terminals }
//   GET  /api/state         → { state, seq }  (boot snapshot)
//   POST /api/actions       → { seq } | 409 (illegal transition)
//   GET  /api/events?since=N → SSE stream (replay + live)
//
// Serves ../dist when built, so `npm run build && npm run server`
// runs the whole restaurant on one port.

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { buildEmpire, migrateToEmpire, reducer } from '../src/lib/reducer.js'
import { actionsSince, commitAction, getMenuCatalog, loadSnapshot, logStats, saveSnapshot, syncMenuCatalog } from './db.js'

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
  if (persisted.state.version !== 2) {
    saveSnapshot(state, seq)
    console.log('[restora] migrated v1 snapshot → two-store empire')
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
