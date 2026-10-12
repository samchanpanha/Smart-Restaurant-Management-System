// ─── Restora persistence ──────────────────────────────────────────
// SQLite holds the authoritative snapshot + an append-only action log.
// Terminals boot from the snapshot, then follow the log live over SSE.

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const dataDir =
  process.env.RESTORA_DATA || path.join(path.dirname(new URL(import.meta.url).pathname), 'data')
fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'restora.sqlite'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS actions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    ts TEXT NOT NULL
  );
`)

const getKv = db.prepare('SELECT v FROM kv WHERE k = ?')
const setKv = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
const insertAction = db.prepare('INSERT INTO actions (client_id, type, action, ts) VALUES (?, ?, ?, ?)')
const selectSince = db.prepare('SELECT seq, client_id AS clientId, action FROM actions WHERE seq > ? ORDER BY seq ASC LIMIT ?')
const countActions = db.prepare('SELECT COUNT(*) AS n, MAX(seq) AS max FROM actions')

export function loadSnapshot() {
  const snap = getKv.get('snapshot')
  const seq = getKv.get('snapshot_seq')
  if (!snap) return null
  try {
    return { state: JSON.parse(snap.v), seq: Number(seq?.v || 0) }
  } catch {
    return null
  }
}

const saveSnapshotTx = db.transaction((stateJson, seq) => {
  setKv.run('snapshot', stateJson)
  setKv.run('snapshot_seq', String(seq))
})

export function saveSnapshot(state, seq) {
  saveSnapshotTx(JSON.stringify(state), seq)
}

export function appendAction(clientId, action) {
  const info = insertAction.run(clientId, action.type, JSON.stringify(action), new Date().toISOString())
  return Number(info.lastInsertRowid)
}

export function actionsSince(seq, limit = 500) {
  return selectSince.all(seq, limit).map((r) => ({ ...r, action: JSON.parse(r.action) }))
}

export function logStats() {
  return countActions.get()
}
