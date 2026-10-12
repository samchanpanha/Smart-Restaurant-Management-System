// ─── Restora store + terminal sync ──────────────────────────────────
// One ticket, one truth — now across terminals. When an API server is
// reachable, this client boots from its snapshot, posts every action
// (optimistic, tagged with a local id), and follows the shared action
// log live over SSE. The server re-runs the SAME reducer, so illegal
// transitions (two hosts, one table) are rejected and the loser resyncs.
// No server? The app runs standalone on localStorage, exactly as before.
//
// Local-only actions (never posted): HYDRATE (bootstrap), EXPIRE_UNDO
// and DISMISS_ALERT (each terminal manages its own timers/dismissals).

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ROLE_NAV } from './constants'
import { uid } from './models'
import { buildSeed, reducer } from './reducer'

// Re-exported so screens keep importing from one place.
export { getAlerts, getDashboard, quoteWait, tableName } from './reducer'

const STORAGE_KEY = 'restora-v1'
const LOCAL_ONLY = new Set(['HYDRATE', 'EXPIRE_UNDO', 'DISMISS_ALERT'])
const BOOT_TIMEOUT_MS = 2500

const RestoraContext = createContext(null)

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return null
    return { ...parsed, pendingUndo: null, recalls: {} }
  } catch {
    return null
  }
}

function getClientId() {
  try {
    let id = sessionStorage.getItem('restora-client')
    if (!id) {
      id = uid('term')
      sessionStorage.setItem('restora-client', id)
    }
    return id
  } catch {
    return uid('term')
  }
}

// Kiosk mode: /?role=kitchen&screen=kitchen boots a terminal straight in.
function kioskParams() {
  try {
    const q = new URLSearchParams(window.location.search)
    const role = q.get('role')
    const screen = q.get('screen')
    return {
      role: role && ROLE_NAV[role] ? role : null,
      screen: screen || null,
    }
  } catch {
    return { role: null, screen: null }
  }
}

async function fetchState(signal) {
  const res = await fetch('/api/state', { signal })
  if (!res.ok) throw new Error(`state ${res.status}`)
  const json = await res.json()
  if (!json?.state || json.state.version !== 1) throw new Error('bad snapshot')
  return json
}

export function RestoraProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, () => loadPersisted() || buildSeed())
  const kiosk = useMemo(kioskParams, [])
  const [role, setRole] = useState(kiosk.role || 'owner')
  const [screen, setScreen] = useState(() => {
    if (kiosk.screen) return kiosk.screen
    if (kiosk.role) return ROLE_NAV[kiosk.role][0]
    return 'floor'
  })
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [selectedDishId, setSelectedDishId] = useState(null)

  // link: { mode: 'local'|'server', status: 'starting'|'live'|'offline'|'local' }
  const [link, setLink] = useState({ mode: 'local', status: 'starting' })
  const [notice, setNotice] = useState(null)
  const linkRef = useRef(link)
  linkRef.current = link
  const seqRef = useRef(0)
  const lidAt = useRef(new Map()) // local action id → seen timestamp (echo guard)
  const clientId = useMemo(getClientId, [])
  const esRef = useRef(null)
  const retryRef = useRef(null)

  function flashNotice(msg) {
    setNotice(msg)
    window.clearTimeout(flashNotice._t)
    flashNotice._t = window.setTimeout(() => setNotice(null), 6000)
  }

  const pruneLids = useCallback(() => {
    const cutoff = Date.now() - 120000
    for (const [lid, at] of lidAt.current) {
      if (at < cutoff) lidAt.current.delete(lid)
    }
    if (lidAt.current.size > 5000) lidAt.current.clear()
  }, [])

  // ── Resync: server snapshot is authoritative ───────────────────
  const resync = useCallback(async () => {
    try {
      const json = await fetchState()
      seqRef.current = json.seq || 0
      rawDispatch({ type: 'HYDRATE', state: json.state })
      setLink({ mode: 'server', status: 'live' })
      return true
    } catch {
      setLink((l) => ({ mode: l.mode, status: 'offline' }))
      return false
    }
  }, [])

  // ── SSE lifecycle (manual reconnect → snapshot, never stale replay)
  const connectStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    window.clearTimeout(retryRef.current)
    let es
    try {
      es = new EventSource(`/api/events?since=${seqRef.current}`)
    } catch {
      setLink((l) => ({ ...l, status: 'offline' }))
      retryRef.current = window.setTimeout(() => connectStream(), 3000)
      return
    }
    esRef.current = es

    es.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.hello) {
        // Gap too big for replay → take the snapshot instead.
        if (msg.seq - seqRef.current > 200) {
          resync().then((ok) => {
            if (ok) connectStream()
          })
        } else {
          seqRef.current = Math.max(seqRef.current, msg.seq || 0)
          setLink({ mode: 'server', status: 'live' })
        }
        return
      }
      if (msg.resync) {
        resync().then((ok) => {
          if (ok) connectStream()
        })
        return
      }
      if (typeof msg.seq === 'number') {
        if (msg.seq <= seqRef.current) return // already applied
        seqRef.current = msg.seq
      }
      const lid = msg.action?._lid
      if (lid && lidAt.current.has(lid)) return // own echo — already applied optimistically
      if (lid) lidAt.current.set(lid, Date.now())
      pruneLids()
      setLink({ mode: 'server', status: 'live' })
      try {
        rawDispatch(msg.action)
      } catch {
        // Remote action illegal against our optimistic state → take truth.
        resync()
      }
    }

    es.onerror = () => {
      es.close()
      if (esRef.current === es) esRef.current = null
      setLink((l) => ({ ...l, status: 'offline' }))
      retryRef.current = window.setTimeout(async () => {
        const ok = await resync()
        if (ok) connectStream()
        else retryRef.current = window.setTimeout(() => connectStream(), 5000)
      }, 2000)
    }
  }, [pruneLids, resync])

  // ── Boot: server snapshot if reachable, else standalone ─────────
  useEffect(() => {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), BOOT_TIMEOUT_MS)
    fetchState(ctrl.signal)
      .then((json) => {
        window.clearTimeout(timer)
        seqRef.current = json.seq || 0
        rawDispatch({ type: 'HYDRATE', state: json.state })
        setLink({ mode: 'server', status: 'live' })
        connectStream()
      })
      .catch(() => {
        window.clearTimeout(timer)
        setLink({ mode: 'local', status: 'local' }) // standalone demo, as before
      })
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
      if (esRef.current) esRef.current.close()
      window.clearTimeout(retryRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Dispatch: optimistic locally, posted when linked ────────────
  const dispatch = useCallback(
    (action) => {
      if (linkRef.current.mode !== 'server' || LOCAL_ONLY.has(action.type)) {
        rawDispatch(action)
        return
      }
      const lid = uid('l')
      const tagged = { ...action, _lid: lid }
      lidAt.current.set(lid, Date.now())
      rawDispatch(tagged)
      fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: tagged, clientId }),
      })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}))
          if (!res.ok) {
            // Server rejected (e.g. lost a race) — take truth, say why.
            flashNotice(json.error ? `Server kept truth (${json.error}). Resynced.` : 'Server hiccup — resynced.')
            resync()
          } else if (typeof json.seq === 'number') {
            seqRef.current = Math.max(seqRef.current, json.seq)
            setLink({ mode: 'server', status: 'live' })
          }
        })
        .catch(() => {
          setLink((l) => ({ ...l, status: 'offline' }))
          flashNotice('Link lost — changes stay on this terminal until reconnect.')
        })
    },
    [clientId, resync],
  )

  // Local cache (offline fallback + instant boot paint next visit)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage full/blocked — app still works in memory */
    }
  }, [state])

  // Expire the 15s undo window without user action (local-only)
  useEffect(() => {
    if (!state.pendingUndo) return
    const ms = state.pendingUndo.expiresAt - Date.now()
    if (ms <= 0) {
      rawDispatch({ type: 'EXPIRE_UNDO' })
      return
    }
    const t = setTimeout(() => rawDispatch({ type: 'EXPIRE_UNDO' }), ms + 50)
    return () => clearTimeout(t)
  }, [state.pendingUndo])

  const value = useMemo(
    () => ({
      state, dispatch, role, setRole, screen, setScreen,
      selectedTableId, setSelectedTableId, selectedDishId, setSelectedDishId,
      link, resync, notice,
    }),
    [state, dispatch, role, screen, selectedTableId, selectedDishId, link, resync, notice],
  )

  if (link.status === 'starting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-ink-950)]">
        <div className="text-center">
          <div className="text-2xl font-bold tracking-tight text-zinc-100">Restora</div>
          <div className="mt-2 text-sm text-zinc-500">Connecting to service…</div>
        </div>
      </div>
    )
  }

  return <RestoraContext.Provider value={value}>{children}</RestoraContext.Provider>
}

export function useRestora() {
  const ctx = useContext(RestoraContext)
  if (!ctx) throw new Error('useRestora must be used inside RestoraProvider')
  return ctx
}

// Tick hook for live timers (KDS clocks, seated minutes, undo countdown)
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export { marginBandFor } from './constants'
