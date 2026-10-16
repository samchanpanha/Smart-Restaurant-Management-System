// ─── Restora store + terminal sync ──────────────────────────────────
// Multi-location empire, one shared brain. State shape v2:
//   { version: 2, locations: { downtown: shop, riverside: shop } }
// Screens keep reading `state` — the provider points it at the active
// shop — so every module is location-scoped with zero screen changes.
// Actions travel wrapped ({ type:'LOC', locId, action }) to the server,
// which runs the SAME empire reducer. Owner sees the switcher + compare;
// staff terminals stay pinned (?loc= kiosk param or the first branch).

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ClockProvider } from './clock'
import { ROLE_NAV, TARGETS } from './constants'
import { baseCurrencyConfig, setActiveCurrency } from './currency'
import { uid } from './models'
import { buildEmpire, getAlerts, migrateToEmpire, reducer } from './reducer'
import { DOC_KINDS, documentNumber, templateFor } from './settings'
import {
  MAX_TABS, activeWorkspaceTab, createWorkspace, normalizeWorkspace, tabIdForScreen,
  workspaceReducer,
} from './workspace'

// Re-exported so screens keep importing from one place.
export { getAlerts, getDashboard, quoteWait, tableName } from './reducer'

// Branch helpers read the live empire — a location created at runtime is a
// first-class citizen, so nothing may hard-code the seed list. The fallback
// only covers a malformed empire (the reducer always keeps at least one shop).
function firstLocationId(empire) {
  return Object.keys(empire?.locations || {})[0] || 'downtown'
}

const STORAGE_KEY = 'restora-v1'
const WORKSPACE_KEY = 'restora-workspace-v1'
const VALID_SCREENS = new Set(Object.values(ROLE_NAV).flat())
const LOCAL_ONLY = new Set(['HYDRATE', 'EXPIRE_UNDO', 'DISMISS_ALERT'])
const BOOT_TIMEOUT_MS = 2500

const RestoraContext = createContext(null)
const EMPTY_CTX = {}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return migrateToEmpire(JSON.parse(raw))
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

// Kiosk mode: /?role=kitchen&screen=kitchen&loc=riverside, /?guest=t14.
// `loc` is validated against the empire this terminal booted with, so a kiosk
// can pin itself to any branch — not just the seeded two.
function kioskParams(empire) {
  try {
    const q = new URLSearchParams(window.location.search)
    const role = q.get('role')
    const loc = q.get('loc')
    const known = new Set(Object.keys(empire?.locations || {}))
    return {
      role: role && ROLE_NAV[role] ? role : null,
      screen: q.get('screen') || null,
      loc: loc && known.has(loc) ? loc : null,
      guest: q.get('guest') || null,
    }
  } catch {
    return { role: null, screen: null, loc: null, guest: null }
  }
}

function locOfTable(empire, tableId) {
  if (!tableId) return null
  for (const [id, shop] of Object.entries(empire.locations || {})) {
    if (shop?.tables?.some((t) => t.id === tableId)) return id
  }
  return null
}

function initialScreen(kiosk) {
  if (kiosk.role && kiosk.screen && !ROLE_NAV[kiosk.role].includes(kiosk.screen)) {
    return ROLE_NAV[kiosk.role][0]
  }
  return kiosk.screen || (kiosk.role ? ROLE_NAV[kiosk.role][0] : 'floor')
}

// Tabs survive a reload (session-only storage); kiosk terminals always boot
// fresh so a shared tablet never inherits the last operator's workspace.
// Tabs parked on a branch that no longer exists land on the first live one.
function loadWorkspace(kiosk, empire) {
  if (kiosk.role) return null
  try {
    const raw = sessionStorage.getItem(WORKSPACE_KEY)
    if (!raw) return null
    const restored = normalizeWorkspace(JSON.parse(raw))
    if (!restored) return null
    const known = new Set(Object.keys(empire?.locations || {}))
    const fallback = firstLocationId(empire)
    const tabs = restored.tabs
      .filter((tab) => !tab.screen || VALID_SCREENS.has(tab.screen))
      .map((tab) => (known.has(tab.locId) ? tab : { ...tab, locId: fallback }))
    if (!tabs.length) return null
    return { ...restored, tabs }
  } catch {
    return null
  }
}

async function fetchState(signal) {
  const res = await fetch(withOwner('/api/state'), { signal })
  if (!res.ok) throw new Error(`state ${res.status}`)
  const json = await res.json()
  const empire = migrateToEmpire(json?.state)
  if (!empire) throw new Error('bad snapshot')
  return { empire, seq: json.seq || 0 }
}

// Guest QR + Telegram mini app URLs carry ?owner=<slug> so a public client
// reads the right tenant's state. Signed-in terminals rely on their session
// cookie instead and omit the param.
function tenantOwner() {
  try {
    return new URLSearchParams(window.location.search).get('owner') || ''
  } catch {
    return ''
  }
}

function withOwner(path, params = {}) {
  const search = new URLSearchParams(params)
  const owner = tenantOwner()
  if (owner) search.set('owner', owner)
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

// Guests (QR page + Telegram mini app) must never stare at a boot screen:
// they get the cached/demo menu immediately and hydrate when the snapshot
// lands. Terminals pass `waitForServer` (the default) so a shared tablet
// never shows another shift's numbers while it syncs.
export function RestoraProvider({ children, waitForServer = true }) {
  const empireInit = useMemo(() => loadPersisted() || buildEmpire(), [])
  const kiosk = useMemo(() => kioskParams(empireInit), [empireInit])
  const [empire, rawDispatch] = useReducer(reducer, empireInit)
  // A question handed to the Ops Copilot from somewhere else (the Help center,
  // a dashboard card). The Assistant screen consumes it on mount, then clears
  // it — so the bridge works whether or not its tab was already open.
  const [aiPrompt, setAiPrompt] = useState(null)
  const [workspace, workspaceDispatch] = useReducer(
    workspaceReducer,
    null,
    () => loadWorkspace(kiosk, empireInit) || createWorkspace(
      initialScreen(kiosk),
      locOfTable(empireInit, kiosk.guest) || kiosk.loc || firstLocationId(empireInit),
      uid('tab'),
    ),
  )
  const activeTab = activeWorkspaceTab(workspace)
  const { tabs, activeTabId } = workspace
  const locId = activeTab?.locId || firstLocationId(empire)
  // A blank ("New tab") tab keeps its null screen all the way to the router,
  // which is what puts the new-tab picker on screen.
  const screen = activeTab ? (activeTab.screen || null) : 'floor'
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const setScreen = useCallback((nextScreen) => {
    workspaceDispatch({ type: 'SET_SCREEN', screen: nextScreen })
  }, [])
  const setLocId = useCallback((nextLocId) => {
    workspaceDispatch({ type: 'SET_LOCATION', locId: nextLocId })
  }, [])
  // openTab() with no screen opens the new-tab picker; pass a screen to
  // open that screen directly and { activate:false } for a background tab.
  const openTab = useCallback((nextScreen = null, options = {}) => {
    if (tabs.length >= MAX_TABS) {
      flashNotice(`Tab limit reached (${MAX_TABS}) — close a tab to open another.`)
      return
    }
    workspaceDispatch({
      type: 'OPEN_TAB',
      id: uid('tab'),
      screen: nextScreen || null,
      activate: options.activate !== false,
    })
  }, [tabs.length])
  // Ctrl/⌘-click and middle-click on a nav item: focus the tab that already
  // shows the screen, otherwise open one. Never stacks duplicates.
  const openScreenInTab = useCallback((nextScreen, options = {}) => {
    if (!nextScreen) return
    const existing = tabIdForScreen(workspace, nextScreen)
    if (existing) {
      if (options.activate !== false) workspaceDispatch({ type: 'ACTIVATE_TAB', tabId: existing })
      return
    }
    openTab(nextScreen, options)
  }, [openTab, workspace])
  // Send a question to the Ops Copilot: focus (or open) its tab and leave the
  // text for the screen to ask. Read-only like every other AI surface.
  const askAi = useCallback((text) => {
    const question = String(text || '').trim()
    if (!question) return
    setAiPrompt(question)
    openScreenInTab('assistant')
  }, [openScreenInTab])
  const clearAiPrompt = useCallback(() => setAiPrompt(null), [])
  const activateTab = useCallback((tabId) => {
    workspaceDispatch({ type: 'ACTIVATE_TAB', tabId })
  }, [])
  const closeTab = useCallback((tabId, fallbackScreen = 'floor') => {
    workspaceDispatch({
      type: 'CLOSE_TAB',
      tabId,
      replacementId: uid('tab'),
      fallbackScreen,
    })
  }, [])
  const reorderTab = useCallback((tabId, beforeTabId) => {
    workspaceDispatch({ type: 'REORDER_TAB', tabId, beforeTabId })
  }, [])
  const renameTab = useCallback((tabId, title) => {
    workspaceDispatch({ type: 'RENAME_TAB', tabId, title })
  }, [])
  const togglePinTab = useCallback((tabId) => {
    workspaceDispatch({ type: 'TOGGLE_PIN', tabId })
  }, [])
  const duplicateTab = useCallback((tabId) => {
    if (tabs.length >= MAX_TABS) {
      flashNotice(`Tab limit reached (${MAX_TABS}) — close a tab to duplicate.`)
      return
    }
    workspaceDispatch({ type: 'DUPLICATE_TAB', tabId, id: uid('tab') })
  }, [tabs.length])
  const closeOtherTabs = useCallback((tabId) => {
    workspaceDispatch({ type: 'CLOSE_OTHERS', tabId })
  }, [])
  const closeRightTabs = useCallback((tabId) => {
    workspaceDispatch({ type: 'CLOSE_RIGHT', tabId })
  }, [])
  const reopenClosedTab = useCallback(() => {
    workspaceDispatch({ type: 'REOPEN_TAB' })
  }, [])
  const saveTabScroll = useCallback((tabId, scroll) => {
    workspaceDispatch({ type: 'SET_TAB_SCROLL', tabId, scroll })
  }, [])
  const setTabContext = useCallback((patch) => {
    workspaceDispatch({ type: 'SET_TAB_CONTEXT', tabId: activeTabIdRef.current, patch })
  }, [])
  const [role, setRole] = useState(kiosk.role || 'owner')
  // View context lives on the tab, so two Floor tabs keep their own table.
  const activeCtx = activeTab?.ctx || EMPTY_CTX
  const selectedTableId = activeCtx.tableId ?? null
  const selectedDishId = activeCtx.dishId ?? null
  const selectedOrderId = activeCtx.orderId ?? null
  const setSelectedTableId = useCallback((tableId) => setTabContext({ tableId }), [setTabContext])
  const setSelectedDishId = useCallback((dishId) => setTabContext({ dishId }), [setTabContext])
  const setSelectedOrderId = useCallback((orderId) => setTabContext({ orderId }), [setTabContext])

  const state = useMemo(
    () => empire.locations[locId] || empire.locations[firstLocationId(empire)],
    [empire, locId],
  )
  // Alerts are derived once per state change and shared with the shell and
  // tab strip, instead of every chrome component re-running the scan.
  const alerts = useMemo(() => getAlerts(state), [state])
  // The empire's shops, in insertion order, as the UI needs them (switchers,
  // dashboards, branch management). Derived from state so a branch created at
  // runtime shows up everywhere without a hard-coded list.
  const locations = useMemo(
    () => Object.entries(empire.locations || {}).map(([id, shop]) => ({
      id,
      short: shop?.settings?.locationShort || shop?.settings?.restaurantName || id,
    })),
    [empire],
  )
  const locationIdsRef = useRef(locations.map((location) => location.id))
  locationIdsRef.current = locations.map((location) => location.id)
  const emperorRef = useRef(empire)
  emperorRef.current = empire
  const locShopRef = useCallback(
    (targetLocId) => emperorRef.current.locations[targetLocId] || emperorRef.current.locations[firstLocationId(emperorRef.current)],
    [],
  )

  // A branch removed here or on another terminal must not leave a tab
  // pointing at a shop that no longer exists: every stale tab, active or
  // background, lands on the first live branch.
  useEffect(() => {
    if (!tabs.length) return
    const known = new Set(Object.keys(empire.locations || {}))
    const fallback = firstLocationId(empire)
    for (const tab of tabs) {
      if (!known.has(tab.locId)) {
        workspaceDispatch({ type: 'REMAP_LOCATION', from: tab.locId, to: fallback })
        return
      }
    }
  }, [empire, tabs])

  // link: { mode: 'local'|'server', status: 'starting'|'live'|'offline'|'local' }
  const [link, setLinkState] = useState({ mode: 'local', status: 'starting' })
  // Every SSE ping and action reply reports the same { server, live } link.
  // Collapsing equal transitions keeps the provider's context value stable,
  // so live traffic does not re-render every consumer for no change.
  const setLink = useCallback((next) => {
    setLinkState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      return value.mode === prev.mode && value.status === prev.status ? prev : value
    })
  }, [])
  const linkRef = useRef(link)
  linkRef.current = link
  const [notice, setNotice] = useState(null)
  const locRef = useRef(locId)
  locRef.current = locId
  const seqRef = useRef(0)
  const lidAt = useRef(new Map())
  const clientId = useMemo(getClientId, [])
  const esRef = useRef(null)
  const retryRef = useRef(null)
  // Live actions are queued and applied once per frame. A busy room sends
  // several actions a second; without this every one of them re-rendered
  // every terminal and every guest phone on its own.
  const inboundRef = useRef([])
  const flushRef = useRef(false)

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

  // Guests land in whichever store holds their table.
  useEffect(() => {
    if (!kiosk.guest) return
    const found = locOfTable(empire, kiosk.guest)
    if (found && found !== locRef.current) setLocId(found)
  }, [empire, kiosk.guest, setLocId])

  const resync = useCallback(async () => {
    try {
      const json = await fetchState()
      seqRef.current = json.seq || 0
      rawDispatch({ type: 'HYDRATE', state: json.empire })
      setLink({ mode: 'server', status: 'live' })
      return true
    } catch {
      setLink((l) => ({ mode: l.mode, status: 'offline' }))
      return false
    }
  }, [])

  const flushInbound = useCallback(() => {
    flushRef.current = false
    const batch = inboundRef.current
    inboundRef.current = []
    for (const action of batch) {
      try {
        rawDispatch(action)
      } catch {
        resync()
        return
      }
    }
  }, [resync])

  const queueInbound = useCallback((action) => {
    inboundRef.current.push(action)
    if (flushRef.current) return
    flushRef.current = true
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(flushInbound)
    else window.setTimeout(flushInbound, 16)
  }, [flushInbound])

  const connectStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    window.clearTimeout(retryRef.current)
    let es
    try {
      es = new EventSource(withOwner('/api/events', { since: seqRef.current }))
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
        if (msg.seq <= seqRef.current) return
        seqRef.current = msg.seq
      }
      const lid = msg.action?._lid ?? msg.action?.action?._lid
      if (lid && lidAt.current.has(lid)) return
      if (lid) lidAt.current.set(lid, Date.now())
      pruneLids()
      setLink({ mode: 'server', status: 'live' })
      queueInbound(msg.action)
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
  }, [pruneLids, queueInbound, resync])

  useEffect(() => {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), BOOT_TIMEOUT_MS)
    fetchState(ctrl.signal)
      .then((json) => {
        window.clearTimeout(timer)
        seqRef.current = json.seq || 0
        rawDispatch({ type: 'HYDRATE', state: json.empire })
        setLink({ mode: 'server', status: 'live' })
        connectStream()
      })
      .catch(() => {
        window.clearTimeout(timer)
        setLink({ mode: 'local', status: 'local' })
      })
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
      if (esRef.current) esRef.current.close()
      window.clearTimeout(retryRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One location-scoped action: apply locally, then post when linked.
  const sendAction = useCallback(
    (locId, action) => {
      const linked = linkRef.current.mode === 'server'
      const wrapped = { type: 'LOC', locId, action }
      if (!linked || LOCAL_ONLY.has(action.type)) {
        rawDispatch(wrapped)
        return
      }
      const lid = uid('l')
      const tagged = { type: 'LOC', locId, action: { ...action, _lid: lid } }
      lidAt.current.set(lid, Date.now())
      rawDispatch(tagged)
      fetch(withOwner('/api/actions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: tagged, clientId }),
      })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}))
          if (!res.ok) {
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

  // Dispatch: HYDRATE swaps the empire; shop actions wrap in LOC;
  // RESET_ALL reseeds every store (broadcast to all terminals).
  const dispatch = useCallback(
    (action) => {
      if (!action || typeof action.type !== 'string') return
      if (action.type === 'HYDRATE') {
        rawDispatch(action)
        return
      }
      const linked = linkRef.current.mode === 'server'
      if (action.type === 'RESET_ALL') {
        rawDispatch(action)
        if (!linked) return
        const lid = uid('l')
        lidAt.current.set(lid, Date.now())
        fetch(withOwner('/api/actions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: { ...action, _lid: lid }, clientId }),
        })
          .then(async (res) => {
            const json = await res.json().catch(() => ({}))
            if (!res.ok) {
              flashNotice('Server kept truth. Resynced.')
              resync()
            } else if (typeof json.seq === 'number') {
              seqRef.current = Math.max(seqRef.current, json.seq)
            }
          })
          .catch(() => setLink((l) => ({ ...l, status: 'offline' })))
        return
      }
      // Empire-level branch management: apply locally, then sync the whole
      // empire snapshot (no LOC wrapper — the target shop may not exist yet).
      if (action.type === 'CREATE_LOCATION' || action.type === 'REMOVE_LOCATION') {
        rawDispatch(action)
        if (!linked) return
        const lid = uid('l')
        lidAt.current.set(lid, Date.now())
        fetch(withOwner('/api/actions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: { ...action, _lid: lid }, clientId }),
        })
          .then(async (res) => {
            const json = await res.json().catch(() => ({}))
            if (!res.ok) {
              flashNotice('Server kept truth. Resynced.')
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
        return
      }
      sendAction(locRef.current, action)
    },
    [sendAction],
  )

  // Same path as dispatch, but pinned to an explicit location — used to
  // apply one settings patch to every store in the empire.
  const dispatchTo = useCallback(
    (locId, action) => {
      if (!action || typeof action.type !== 'string') return
      sendAction(locId, action)
    },
    [sendAction],
  )

  const dispatchEverywhere = useCallback(
    (action) => {
      if (!action || typeof action.type !== 'string') return
      for (const id of locationIdsRef.current) sendAction(id, action)
    },
    [sendAction],
  )

  // Money prints in the active location's base currency: every existing
  // `money(...)` call site follows settings without a single edit.
  useEffect(() => {
    setActiveCurrency(baseCurrencyConfig(state.settings))
  }, [state.settings])

  /**
   * Issue a document: build it from live state, register it with the
   * reducer (which assigns the next number) and return the printable
   * object. `kind` is invoice · receipt · ticket · report.
   */
  const issueDocument = useCallback(
    (kind, { document, number } = {}) => {
      if (!DOC_KINDS.includes(kind)) return null
      const shop = locShopRef(locRef.current)
      const settings = shop?.settings
      if (!settings) return null
      const counter = settings.numbering?.[kind]
      const nextNumber = number || documentNumber(settings, kind, counter?.next || 1)
      sendAction(locRef.current, {
        type: 'ISSUE_DOCUMENT',
        kind,
        by: role,
        document: { ...document, id: document?.id, number: nextNumber },
      })
      return { ...document, kind, number: nextNumber }
    },
    [role, sendAction, locShopRef],
  )

  /** The template a document prints with right now. */
  const templateForKind = useCallback(
    (kind) => templateFor(state.settings, kind),
    [state.settings],
  )

  useEffect(() => {
    // The full empire is ~150KB of JSON; writing it on every action jankes a
    // busy room. Coalesce writes, and flush once more if the page is hidden.
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(empire))
      } catch {
        /* storage full/blocked — app still works in memory */
      }
    }
    const timer = window.setTimeout(persist, 300)
    const onHide = () => {
      window.clearTimeout(timer)
      persist()
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pagehide', onHide)
    }
  }, [empire])

  useEffect(() => {
    try {
      sessionStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace))
    } catch {
      /* private mode — tabs simply reset on reload */
    }
  }, [workspace])

  // Deep links: keep ?screen=&loc= in step with the active tab so an operator
  // can bookmark or share the room they are looking at. Kiosk, guest and the
  // Telegram mini app carry their own params and are left untouched.
  useEffect(() => {
    if (kiosk.role || kiosk.guest) return
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('tg') !== null) return
      if (screen) url.searchParams.set('screen', screen)
      else url.searchParams.delete('screen')
      url.searchParams.set('loc', locId)
      window.history.replaceState(null, '', url)
    } catch {
      /* history unavailable — sharing links is best-effort */
    }
  }, [screen, locId, kiosk.role, kiosk.guest])

  // Expire the 15s undo window without user action (local-only, this shop)
  const pendingUndo = state.pendingUndo
  useEffect(() => {
    if (!pendingUndo) return
    const ms = pendingUndo.expiresAt - Date.now()
    if (ms <= 0) {
      rawDispatch({ type: 'LOC', locId: locRef.current, action: { type: 'EXPIRE_UNDO' } })
      return
    }
    const t = setTimeout(
      () => rawDispatch({ type: 'LOC', locId: locRef.current, action: { type: 'EXPIRE_UNDO' } }),
      ms + 50,
    )
    return () => clearTimeout(t)
  }, [pendingUndo])

  // Release tables the mini app self-seated where the guest never ordered, so
  // an abandoned session can't squat a table. Any client can run the sweep;
  // a repeat on the server collapses to a no-op.
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch
  useEffect(() => {
    const t = setInterval(() => {
      dispatchRef.current({
        type: 'RELEASE_STALE_TABLES',
        now: Date.now(),
        timeoutMinutes: TARGETS.selfSeatReleaseMinutes,
      })
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // Create a branch (host/owner) and immediately switch this terminal to it.
  const createLocation = useCallback((locId, name) => {
    if (!locId) return
    dispatch({ type: 'CREATE_LOCATION', locId, name })
    setLocId(locId)
  }, [dispatch, setLocId])

  // Remove a branch (host/owner). The reducer refuses to drop the last shop;
  // every tab parked on the branch — here or on another terminal, via the
  // stale-tab effect — lands on the first remaining one.
  const removeLocation = useCallback((targetLocId) => {
    const ids = locationIdsRef.current
    if (!targetLocId || !ids.includes(targetLocId) || ids.length <= 1) return
    dispatch({ type: 'REMOVE_LOCATION', locId: targetLocId })
    const fallback = ids.find((id) => id !== targetLocId)
    if (fallback) workspaceDispatch({ type: 'REMAP_LOCATION', from: targetLocId, to: fallback })
  }, [dispatch])

  // Menu across branches: copy the current branch's menu and category tree to
  // every other branch. Each target travels as its own shop action, so the
  // server log, SSE terminals and guests all agree. Recipes stay per branch —
  // they follow this branch's suppliers and stock, not the menu push.
  const pushMenuToAllBranches = useCallback((sourceLocId) => {
    const source = emperorRef.current.locations?.[sourceLocId]
    if (!source?.menu?.length) return 0
    let pushed = 0
    for (const id of locationIdsRef.current) {
      if (id === sourceLocId) continue
      sendAction(id, {
        type: 'REPLACE_MENU',
        menu: source.menu,
        categories: source.categories || [],
      })
      pushed += 1
    }
    return pushed
  }, [sendAction])

  const value = useMemo(
    () => ({
      state, empire, dispatch, role, setRole, screen, setScreen, alerts,
      tabs, activeTabId, openTab, openScreenInTab, activateTab, closeTab,
      reorderTab, renameTab, togglePinTab, duplicateTab, closeOtherTabs, closeRightTabs,
      reopenClosedTab, canReopenClosed: workspace.closed.length > 0, saveTabScroll,
      tabCtx: activeCtx, setTabCtx: setTabContext,
      selectedTableId, setSelectedTableId, selectedDishId, setSelectedDishId,
      selectedOrderId, setSelectedOrderId, locId, setLocId, link, resync, notice,
      locations, createLocation, removeLocation, pushMenuToAllBranches,
      aiPrompt, askAi, clearAiPrompt,
      settings: state.settings, dispatchTo, dispatchEverywhere, issueDocument, templateForKind,
    }),
    [state, empire, dispatch, role, screen, setScreen, alerts, tabs, activeTabId, openTab, openScreenInTab, activateTab, closeTab, reorderTab, renameTab, togglePinTab, duplicateTab, closeOtherTabs, closeRightTabs, reopenClosedTab, workspace.closed.length, saveTabScroll, activeCtx, setTabContext, selectedTableId, setSelectedTableId, selectedDishId, setSelectedDishId, selectedOrderId, setSelectedOrderId, locId, setLocId, link, resync, notice, locations, createLocation, removeLocation, pushMenuToAllBranches, aiPrompt, askAi, clearAiPrompt, dispatchTo, dispatchEverywhere, issueDocument, templateForKind],
  )

  if (waitForServer && link.status === 'starting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-ink-950)]">
        <div className="text-center">
          <div className="text-2xl font-bold tracking-tight text-zinc-100">Restora</div>
          <div className="mt-2 text-sm text-zinc-500">Connecting to service…</div>
        </div>
      </div>
    )
  }

  return (
    <RestoraContext.Provider value={value}>
      <ClockProvider>{children}</ClockProvider>
    </RestoraContext.Provider>
  )
}

export function useRestora() {
  const ctx = useContext(RestoraContext)
  if (!ctx) throw new Error('useRestora must be used inside RestoraProvider')
  return ctx
}

export const useStore = useRestora

// The shared clock lives in its own module; re-exported so screens keep
// importing `useNow` from the store.
export { useNow } from './clock'

export { marginBandFor } from './constants'
