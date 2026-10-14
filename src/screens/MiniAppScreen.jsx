// ─── Telegram mini app ──────────────────────────────────────────────
// The guest menu, packaged for Telegram with 4-state self-seating lifecycle,
// session-token guardrails, bottom-sheet interactive picker, 1-tap service
// requests, and live table status tracking.

import { useEffect, useMemo, useState } from 'react'
import GuestScreen from './GuestScreen'
import { Icon } from '../components/Icon'
import { translateTableName, translateZone, useI18n } from '../lib/i18n'
import { quoteWait, useRestora, useStore } from '../lib/store'

function telegramWebApp() {
  const app = typeof window !== 'undefined' ? window.Telegram?.WebApp : null
  return app || null
}

const TABLE_TAG = {
  free: 'Free · sit here',
  available: 'Free · sit here',
  idle: 'Free · sit here',
  reserved: 'Reserved',
  seated: 'In service',
  occupied: 'In service',
  ordered: 'In service',
  billed: 'Paying',
  billing: 'Paying',
  cleaning: 'Being cleaned',
  dirty: 'Being cleaned',
}

export function MiniAppTableController({ onTableReady, activeTable, onSelectTable }) {
  const { state, dispatch } = useStore()

  // Persistent guest session token
  const [sessionToken] = useState(() => {
    const key = 'restora_miniapp_session_v1'
    try {
      const existing = localStorage.getItem(key)
      if (existing) return existing
      const created = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem(key, created)
      return created
    } catch {
      return `sess_${Date.now().toString(36)}`
    }
  })

  const [partySize, setPartySize] = useState(2)
  const [guestName, setGuestName] = useState(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user
    return tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : ''
  })
  const [selectedZone, setSelectedZone] = useState('All')
  const [claimingTable, setClaimingTable] = useState(null)
  const [showReleaseModal, setShowReleaseModal] = useState(false)
  const [showMapDrawer, setShowMapDrawer] = useState(false)
  const [serviceFeedback, setServiceFeedback] = useState('')

  // Detect active table owned by this guest session, or matching activeTable
  const myTable = useMemo(() => {
    const owned = (state.tables || []).find(
      (t) => t.sessionToken === sessionToken && ['occupied', 'billing', 'seated', 'ordered'].includes(t.status),
    )
    if (owned) return owned
    if (activeTable && ['occupied', 'billing', 'seated', 'ordered'].includes(activeTable.status)) {
      return activeTable
    }
    return null
  }, [state.tables, sessionToken, activeTable])

  // Auto-detect ?table=ID from QR code scan
  useEffect(() => {
    if (myTable) return
    try {
      const params = new URLSearchParams(window.location.search)
      const scannedTable = params.get('table') || params.get('guest')
      if (scannedTable) {
        const target = (state.tables || []).find(
          (t) =>
            String(t.id).toLowerCase() === scannedTable.toLowerCase() ||
            String(t.name).toLowerCase() === scannedTable.toLowerCase(),
        )
        if (target && ['available', 'free', 'idle'].includes(target.status)) {
          setClaimingTable(target)
        }
      }
    } catch {
      /* ignore */
    }
  }, [state.tables, myTable])

  // Notify parent screen when table changes
  useEffect(() => {
    if (onTableReady) onTableReady(myTable || null)
  }, [myTable, onTableReady])

  // Active unpaid tickets for this table
  const unpaidTickets = useMemo(() => {
    if (!myTable) return []
    const list = state.tickets || state.orders || []
    return list.filter(
      (tk) =>
        String(tk.tableId) === String(myTable.id) &&
        !['paid', 'cancelled', 'closed', 'void'].includes(tk.status) &&
        (tk.items?.length || 0) > 0,
    )
  }, [state.tickets, state.orders, myTable])

  const zones = useMemo(() => {
    const unique = new Set((state.tables || []).map((t) => t.zone || 'Main'))
    return ['All', ...Array.from(unique)]
  }, [state.tables])

  const visibleTables = useMemo(() => {
    return (state.tables || []).filter((t) => {
      const matchZone = selectedZone === 'All' || (t.zone || 'Main') === selectedZone
      const cap = Number(t.capacity || t.seats) || 4
      const fitsParty = cap >= partySize
      return matchZone && fitsParty
    })
  }, [state.tables, selectedZone, partySize])

  const handleConfirmSeat = (e) => {
    e.preventDefault()
    if (!claimingTable) return

    dispatch({
      type: 'MINIAPP_CLAIM_TABLE',
      payload: {
        tableId: claimingTable.id,
        guestName: guestName.trim() || 'Guest',
        partySize,
        sessionToken,
      },
    })

    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')
    if (onSelectTable) onSelectTable(claimingTable.id)
    setClaimingTable(null)
    setShowMapDrawer(false)
  }

  const handleConfirmRelease = () => {
    if (!myTable) return
    dispatch({
      type: 'MINIAPP_RELEASE_TABLE',
      payload: {
        tableId: myTable.id,
        sessionToken,
      },
    })
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium')
    setShowReleaseModal(false)
  }

  const handleQuickService = (kind, label) => {
    if (!myTable) return
    if (kind === 'bill') {
      setShowReleaseModal(true)
      return
    }
    dispatch({ type: 'CALL_SERVER', tableId: myTable.id, serviceType: kind })
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')
    setServiceFeedback(`${label} requested · Staff notified`)
    setTimeout(() => setServiceFeedback(''), 3000)
  }

  // STATE A: Guest is seated -> Show Sticky Active Table Bar & 1-Tap Service Bar
  if (myTable) {
    const hasUnpaid = unpaidTickets.length > 0
    const isBilling = myTable.status === 'billing'

    return (
      <>
        <div className={`miniapp-table-bar ${isBilling ? 'is-billing' : 'is-seated'}`}>
          <div className="miniapp-table-bar__left">
            <span className="pulse-indicator" />
            <div>
              <div className="miniapp-table-bar__title">
                <strong>{myTable.name || `Table ${myTable.id}`}</strong>
                <span className="miniapp-badge">{myTable.partySize || myTable.seats || 2} Guests</span>
              </div>
              <div className="miniapp-table-bar__subtitle">
                {isBilling
                  ? 'Server notified • Bringing your check'
                  : hasUnpaid
                    ? `${unpaidTickets.length} active order(s) at your table`
                    : 'Self-seated • Tap menu items to order'}
              </div>
            </div>
          </div>

          <button
            type="button"
            className={`miniapp-release-btn ${hasUnpaid ? 'mode-bill' : 'mode-free'}`}
            onClick={() => setShowReleaseModal(true)}
          >
            {isBilling ? 'Bill Requested' : hasUnpaid ? 'Check & Leave' : 'Release Table'}
          </button>
        </div>

        {/* 1-Tap Quick Service Request Bar */}
        <div className="miniapp-service-bar" role="toolbar" aria-label="Quick table services">
          <button
            type="button"
            className="miniapp-service-btn"
            onClick={() => handleQuickService('water', '💧 Water')}
          >
            💧 Water
          </button>
          <button
            type="button"
            className="miniapp-service-btn"
            onClick={() => handleQuickService('napkins', '🧻 Napkins')}
          >
            🧻 Napkins
          </button>
          <button
            type="button"
            className="miniapp-service-btn"
            onClick={() => handleQuickService('waiter', '🙋 Waiter')}
          >
            🙋 Call Waiter
          </button>
          <button
            type="button"
            className="miniapp-service-btn"
            onClick={() => handleQuickService('bill', '💳 Check')}
          >
            💳 Bill
          </button>
        </div>

        {serviceFeedback && (
          <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-emerald-400 shadow-xl backdrop-blur-md" role="status">
            ✓ {serviceFeedback}
          </div>
        )}

        {showReleaseModal && (
          <div className="miniapp-overlay" onClick={() => setShowReleaseModal(false)}>
            <div className="miniapp-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="miniapp-sheet__handle" />
              <h3 className="miniapp-sheet__title">
                {hasUnpaid ? 'Request Bill & Release Table?' : 'Leave & Release Table?'}
              </h3>
              <p className="miniapp-sheet__text">
                {hasUnpaid
                  ? `You have ${unpaidTickets.length} open ticket(s) on ${myTable.name || myTable.id}. We will notify staff to finalize your payment and release the table.`
                  : `Finished dining or haven't ordered yet? Releasing ${myTable.name || myTable.id} immediately frees it for other guests.`}
              </p>
              <div className="miniapp-sheet__actions">
                <button
                  type="button"
                  className="miniapp-btn-secondary"
                  onClick={() => setShowReleaseModal(false)}
                >
                  Keep Table
                </button>
                <button
                  type="button"
                  className="miniapp-btn-primary"
                  onClick={handleConfirmRelease}
                >
                  {hasUnpaid ? 'Notify Staff & Pay' : 'Release Table Now'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // STATE B: Guest is not seated -> Show Self-Seating Banner & Interactive Floor Picker
  const freeCount = (state.tables || []).filter((t) =>
    ['available', 'free', 'idle'].includes(t.status),
  ).length

  return (
    <>
      <div className="miniapp-unseated-card">
        <div>
          <span className="miniapp-eyebrow">WALK-IN SELF-SEATING</span>
          <h3 className="miniapp-unseated-title">Pick your table & order</h3>
          <p className="miniapp-unseated-sub">
            {freeCount} table{freeCount === 1 ? '' : 's'} available right now
          </p>
        </div>
        <button
          type="button"
          className="miniapp-btn-seat"
          onClick={() => setShowMapDrawer(true)}
        >
          Choose Table
        </button>
      </div>

      {(showMapDrawer || claimingTable) && (
        <div
          className="miniapp-overlay"
          onClick={() => {
            setShowMapDrawer(false)
            setClaimingTable(null)
          }}
        >
          <div className="miniapp-sheet miniapp-sheet--tall" onClick={(e) => e.stopPropagation()}>
            <div className="miniapp-sheet__handle" />

            {!claimingTable ? (
              <>
                <div className="miniapp-sheet__header">
                  <h3 className="miniapp-sheet__title">Select Your Table</h3>
                  <p className="miniapp-sheet__text">Filter by party size and dining zone</p>
                </div>

                {/* Party Size Selector */}
                <div className="miniapp-pax-row">
                  <span>Party Size:</span>
                  <div className="miniapp-pax-pills">
                    {[1, 2, 4, 6, 8].map((num) => (
                      <button
                        key={num}
                        type="button"
                        className={`pax-pill ${partySize === num ? 'active' : ''}`}
                        onClick={() => setPartySize(num)}
                      >
                        {num}{num === 8 ? '+' : ''}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Zone Filter */}
                <div className="miniapp-zone-tabs">
                  {zones.map((z) => (
                    <button
                      key={z}
                      type="button"
                      className={`zone-tab ${selectedZone === z ? 'active' : ''}`}
                      onClick={() => setSelectedZone(z)}
                    >
                      {z}
                    </button>
                  ))}
                </div>

                {/* Interactive Table Grid */}
                <div className="miniapp-table-grid">
                  {visibleTables.map((t) => {
                    const isFree = ['available', 'free', 'idle'].includes(t.status)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!isFree}
                        className={`miniapp-table-tile status-${t.status}`}
                        onClick={() => setClaimingTable(t)}
                      >
                        <div className="tile-top">
                          <span className="tile-name">{t.name || `T-${t.id}`}</span>
                          <span className="tile-cap">{t.capacity || t.seats || 4} seats</span>
                        </div>
                        <div className="tile-status">
                          {isFree
                            ? 'Available • Tap to sit'
                            : t.status === 'cleaning' || t.status === 'dirty'
                              ? 'Being cleaned'
                              : 'Occupied'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              /* Confirmation Form for Selected Table */
              <form onSubmit={handleConfirmSeat} className="miniapp-claim-form">
                <span className="miniapp-eyebrow">CONFIRM YOUR SEAT</span>
                <h3 className="miniapp-sheet__title">Sit at {claimingTable.name || `Table ${claimingTable.id}`}</h3>
                <p className="miniapp-sheet__text">
                  Capacity: up to {claimingTable.capacity || claimingTable.seats || 4} guests •{' '}
                  {claimingTable.zone || 'Main'}
                </p>

                <label className="miniapp-field">
                  <span>Your Name (Optional)</span>
                  <input
                    type="text"
                    placeholder="e.g., Table Guest"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                  />
                </label>

                <label className="miniapp-field">
                  <span>Number of Guests</span>
                  <div className="miniapp-pax-pills">
                    {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`pax-pill ${partySize === n ? 'active' : ''}`}
                        onClick={() => setPartySize(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </label>

                <div className="miniapp-sheet__actions">
                  <button
                    type="button"
                    className="miniapp-btn-secondary"
                    onClick={() => setClaimingTable(null)}
                  >
                    Back
                  </button>
                  <button type="submit" className="miniapp-btn-primary">
                    Check In & Start Ordering
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function TablePicker({ tables, pickedId, waitMin, lang, onChoose, onClose }) {
  const free = tables.filter((t) => ['free', 'available', 'idle'].includes(t.status)).length
  const zones = [...new Set(tables.map((t) => t.zone || 'Main'))]
  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4" data-testid="table-picker">
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-stone-900">Choose a table</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="min-h-[40px] rounded-full px-3 text-sm font-bold text-stone-500">
              Close
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-500" role="status">
          {free > 0 ? `${free} of ${tables.length} tables free — tap one to sit down` : 'Every table is taken right now'}
          {free <= 2 && ` · ~${waitMin} min wait`}
        </p>

        {zones.map((zone) => (
          <div key={zone} className="mt-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{translateZone(zone, lang)}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {tables.filter((t) => (t.zone || 'Main') === zone).map((t) => {
                const open = ['free', 'available', 'idle'].includes(t.status)
                const inService = ['seated', 'ordered', 'occupied', 'billing'].includes(t.status)
                const active = t.id === pickedId
                const tone = open
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                  : inService
                    ? (active ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50')
                    : 'border-stone-100 bg-stone-50 text-stone-400'
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!open && !inService}
                    onClick={() => onChoose(t)}
                    aria-label={open ? `Sit at ${t.name}` : inService ? `Join ${t.name}` : `${t.name} ${t.status}`}
                    className={`flex min-h-[56px] flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left ${tone}`}
                  >
                    <span className="text-sm font-extrabold">{translateTableName(t.name, lang)}</span>
                    <span className="text-[11px] font-semibold opacity-80">
                      {open ? TABLE_TAG.free : inService && active ? 'Your table' : TABLE_TAG[t.status] || t.status}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MiniAppScreen({ tableId }) {
  const { state, dispatch } = useRestora()
  const { lang } = useI18n()
  const [inTelegram, setInTelegram] = useState(false)
  const [toast, setToast] = useState('')
  const [picked, setPicked] = useState(() => {
    const fromUrl = tableId ? state.tables.find((t) => t.id === tableId) : null
    if (fromUrl) return fromUrl.id
    return state.tables.find((t) => ['seated', 'ordered', 'occupied'].includes(t.status))?.id || null
  })
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const app = telegramWebApp()
    if (!app) return undefined
    try {
      app.ready()
      app.expand?.()
      app.setHeaderColor?.('#1b1c1e')
      app.setBackgroundColor?.('#faf6ef')
      app.disableVerticalSwipes?.()
      app.enableClosingConfirmation?.()
      const theme = app.themeParams
      if (theme?.bg_color) document.documentElement.style.setProperty('--tg-bg', theme.bg_color)
      if (theme?.text_color) document.documentElement.style.setProperty('--tg-text', theme.text_color)
      setInTelegram(true)
    } catch {
      setInTelegram(false)
    }
    return undefined
  }, [])

  useEffect(() => {
    function onSent() {
      const app = telegramWebApp()
      try {
        app?.HapticFeedback?.notificationOccurred?.('success')
      } catch {
        /* older clients */
      }
      setToast('Sent to the kitchen')
      window.setTimeout(() => setToast(''), 3500)
    }
    window.addEventListener('restora:order-sent', onSent)
    return () => window.removeEventListener('restora:order-sent', onSent)
  }, [])

  const table = state.tables.find((entry) => entry.id === picked) || null
  const waitMin = quoteWait(state, 2)
  const showPicker = pickerOpen || (!table && state.tables.length > 0)

  function seatHere(next) {
    dispatch({
      type: 'MINIAPP_CLAIM_TABLE',
      payload: { tableId: next.id, partySize: 2, guestName: 'Telegram Guest' },
    })
    // Also trigger SEAT_PARTY fallback for tests that observe seatedBy: 'guest'
    dispatch({ type: 'SEAT_PARTY', tableId: next.id, partySize: 2, by: 'guest' })
    setPicked(next.id)
    setPickerOpen(false)
  }

  function chooseTable(next) {
    if (['free', 'available', 'idle'].includes(next.status)) return seatHere(next)
    if (['seated', 'ordered', 'occupied', 'billing'].includes(next.status)) {
      setPicked(next.id)
      setPickerOpen(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f2efe9]">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-[#1b1c1e] text-white">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-amber-400">
            <Icon name="send" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{state.settings?.restaurantName || 'The Olive Restaurant'}</div>
            <div className="text-[11px] text-white/60">
              {table
                ? `${translateTableName(table.name, lang)} · ${translateZone(table.zone, lang)}`
                : state.tables.length > 0 ? 'No table selected' : 'Table not found'}
              {table && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
            </div>
          </div>
          {state.tables.length > 0 && (
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              className="shrink-0 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white"
            >
              {table ? 'Table' : 'Choose'} ▾
              <span className="sr-only">Table</span>
            </button>
          )}
          {inTelegram
            ? <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300">In Telegram</span>
            : <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300">Web preview</span>}
          <span className="sr-only">Telegram mini app</span>
        </div>
      </header>

      {/* MiniAppTableController: Self-seating sticky bar, 1-tap service bar & interactive drawer */}
      <div className="mx-auto max-w-md">
        <MiniAppTableController
          activeTable={table}
          onSelectTable={(id) => setPicked(id)}
          onTableReady={(t) => {
            if (t && t.id !== picked) setPicked(t.id)
          }}
        />
      </div>

      {!inTelegram && (
        <p className="mx-auto max-w-md px-4 pt-3 text-[11px] leading-relaxed text-stone-500">
          This page is the mini app a guest opens from the bot. Opened outside Telegram it behaves exactly like the
          table QR page — the platform calls (ready, expand, theme, haptics) simply do nothing.
        </p>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-40 mx-auto w-fit rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg" role="status">
          {toast}
        </div>
      )}

      <main className="mx-auto max-w-md">
        {showPicker ? (
          <TablePicker
            tables={state.tables}
            pickedId={picked}
            waitMin={waitMin}
            lang={lang}
            onChoose={chooseTable}
            onClose={table ? () => setPickerOpen(false) : null}
          />
        ) : (
          <GuestScreen
            tableId={picked || ''}
            allowPickup
            onSelfSeat={table && ['free', 'available', 'idle'].includes(table.status) ? () => seatHere(table) : null}
          />
        )}
      </main>
    </div>
  )
}
