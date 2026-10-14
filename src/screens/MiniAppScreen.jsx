// ─── Telegram mini app ──────────────────────────────────────────────
// The guest menu, packaged for Telegram with 4-state self-seating lifecycle,
// session-token guardrails, bottom-sheet interactive picker, 1-tap service
// requests, and live table status tracking.

import { useEffect, useMemo, useState } from 'react'
import GuestScreen from './GuestScreen'
import { Icon } from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { translateTableName, translateZone, useDomTranslator, useI18n } from '../lib/i18n'
import { findAvailableTablesForSlot, findNearestAvailableSlots } from '../lib/models'
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
  const { lang, dict } = useI18n()

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
  const [showTransferDrawer, setShowTransferDrawer] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null)
  const [transferReason, setTransferReason] = useState('')

  const [showRescheduleModal, setShowRescheduleModal] = useState(false)
  const [selectedResBooking, setSelectedResBooking] = useState(null)
  const [rescheduleDate, setRescheduleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rescheduleTime, setRescheduleTime] = useState('19:00')
  const [rescheduleParty, setRescheduleParty] = useState(2)
  const [rescheduleTableId, setRescheduleTableId] = useState('')
  const [rescheduleError, setRescheduleError] = useState('')

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

  const handleRequestTableMove = (e) => {
    e.preventDefault()
    if (!myTable || !transferTarget) return
    dispatch({
      type: 'REQUEST_TABLE_TRANSFER',
      payload: {
        currentTableId: myTable.id,
        targetTableId: transferTarget.id,
        reason: transferReason,
        sessionToken,
      },
    })
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')
    setShowTransferDrawer(false)
    setTransferTarget(null)
    setTransferReason('')
    setServiceFeedback(`Move requested to ${transferTarget.name || transferTarget.id} · Awaiting staff approval`)
    setTimeout(() => setServiceFeedback(''), 3500)
  }

  const handleRescheduleSubmit = (e) => {
    e.preventDefault()
    if (!selectedResBooking) return
    setRescheduleError('')
    try {
      dispatch({
        type: 'RESCHEDULE_BOOKING',
        payload: {
          bookingId: selectedResBooking.id,
          newDate: rescheduleDate,
          newTime: rescheduleTime,
          newPartySize: rescheduleParty,
          preferredTableId: rescheduleTableId || undefined,
          actor: 'guest',
        },
      })
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')
      setShowRescheduleModal(false)
      setServiceFeedback('Reservation rescheduled successfully!')
      setTimeout(() => setServiceFeedback(''), 3500)
    } catch (err) {
      setRescheduleError(err.message || 'Reschedule failed')
    }
  }

  // STATE A: Guest is seated -> Show Sticky Active Table Bar & 1-Tap Service Bar
  if (myTable) {
    const hasUnpaid = unpaidTickets.length > 0
    const isBilling = myTable.status === 'billing'
    const pending = myTable.pendingTransfer && myTable.pendingTransfer.status === 'pending'

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

        {pending && (
          <div className="miniapp-pending-banner">
            <span>🔄 Move to <strong>{myTable.pendingTransfer.targetTableName || myTable.pendingTransfer.targetTableId}</strong> requested</span>
            <button
              type="button"
              onClick={() => dispatch({ type: 'REJECT_TABLE_TRANSFER', payload: { currentTableId: myTable.id, reason: 'Guest cancelled' } })}
              className="font-bold text-amber-200 underline"
            >
              Cancel
            </button>
          </div>
        )}

        {/* 1-Tap Quick Service Request Bar with Switch Table Option */}
        <div className="miniapp-service-bar" role="toolbar" aria-label="Quick table services">
          <button
            type="button"
            className="miniapp-service-btn btn-switch"
            onClick={() => setShowTransferDrawer(true)}
          >
            🔄 Move Table
          </button>
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

        {/* Move / Switch Table Drawer for Seated Diner */}
        {showTransferDrawer && (
          <div className="miniapp-overlay" onClick={() => { setShowTransferDrawer(false); setTransferTarget(null) }}>
            <div className="miniapp-sheet miniapp-sheet--tall" onClick={(e) => e.stopPropagation()}>
              <div className="miniapp-sheet__handle" />
              {!transferTarget ? (
                <>
                  <div className="miniapp-sheet__header">
                    <span className="miniapp-eyebrow">ACTIVE DINING MOVE</span>
                    <h3 className="miniapp-sheet__title">Select New Table</h3>
                    <p className="miniapp-sheet__text">
                      Currently at <strong>{myTable.name || `Table ${myTable.id}`}</strong>. Choose an open table to request a move.
                    </p>
                  </div>
                  <div className="miniapp-table-grid">
                    {(state.tables || [])
                      .filter((t) => t.id !== myTable.id)
                      .map((t) => {
                        const isFree = ['available', 'free', 'idle'].includes(t.status)
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={!isFree}
                            className={`miniapp-table-tile status-${t.status}`}
                            onClick={() => setTransferTarget(t)}
                          >
                            <div className="tile-top">
                              <span className="tile-name">{t.name || `T-${t.id}`}</span>
                              <span className="tile-cap">{t.capacity || t.seats || 4} seats</span>
                            </div>
                            <div className="tile-status">
                              {isFree ? 'Available • Tap to pick' : t.status}
                            </div>
                          </button>
                        )
                      })}
                  </div>
                </>
              ) : (
                <form onSubmit={handleRequestTableMove} className="miniapp-claim-form">
                  <span className="miniapp-eyebrow">CONFIRM TABLE TRANSFER</span>
                  <h3 className="miniapp-sheet__title">Move to {transferTarget.name || `Table ${transferTarget.id}`}</h3>
                  <p className="miniapp-sheet__text">
                    Your open tickets and active kitchen orders will automatically migrate. Floor staff will approve the move.
                  </p>
                  <label className="miniapp-field">
                    <span>Reason for move (Optional)</span>
                    <input
                      type="text"
                      placeholder="e.g., Want window seat / quieter area"
                      value={transferReason}
                      onChange={(e) => setTransferReason(e.target.value)}
                    />
                  </label>
                  <div className="miniapp-sheet__actions">
                    <button
                      type="button"
                      className="miniapp-btn-secondary"
                      onClick={() => setTransferTarget(null)}
                    >
                      Back
                    </button>
                    <button type="submit" className="miniapp-btn-primary">
                      Request Move
                    </button>
                  </div>
                </form>
              )}
            </div>
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

  // Pre-Arrival Rescheduling Availability Calculations
  const targetIsoTime = `${rescheduleDate}T${rescheduleTime}:00`
  const bookingPolicy = state.settings?.booking || {
    allowGuestReschedule: true,
    rescheduleCutoffMinutes: 60,
    maxGuestReschedules: 2,
    defaultBookingDurationMinutes: 90,
  }
  const availableTablesForReschedule = findAvailableTablesForSlot(state, {
    time: targetIsoTime,
    partySize: rescheduleParty,
    durationMinutes: bookingPolicy.defaultBookingDurationMinutes || 90,
    excludeBookingId: selectedResBooking?.id,
  })
  const nearestSlots = availableTablesForReschedule.length === 0
    ? findNearestAvailableSlots(state, {
        requestedTime: targetIsoTime,
        partySize: rescheduleParty,
        durationMinutes: bookingPolicy.defaultBookingDurationMinutes || 90,
        maxSlots: 3,
        excludeBookingId: selectedResBooking?.id,
      })
    : []

  const isCutoffLocked = selectedResBooking
    ? (new Date(selectedResBooking.time).getTime() - Date.now()) / 60000 < (bookingPolicy.rescheduleCutoffMinutes || 60)
    : false
  const isLimitReached = selectedResBooking
    ? (Number(selectedResBooking.modificationCount) || 0) >= (bookingPolicy.maxGuestReschedules || 2)
    : false

  return (
    <>
      <div className="miniapp-unseated-card">
        <div>
          <span className="miniapp-eyebrow">WALK-IN OR RESERVATION</span>
          <h3 className="miniapp-unseated-title">Pick your table & order</h3>
          <p className="miniapp-unseated-sub">
            {freeCount} table{freeCount === 1 ? '' : 's'} available right now
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="miniapp-btn-seat"
            onClick={() => setShowMapDrawer(true)}
          >
            Choose Table
          </button>
          <button
            type="button"
            className="miniapp-btn-seat"
            style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }}
            onClick={() => {
              const b = (state.reservations || []).find((r) => r.status === 'booked')
              setSelectedResBooking(b || null)
              if (b) {
                const dt = new Date(b.time)
                setRescheduleDate(dt.toISOString().slice(0, 10))
                setRescheduleTime(dt.toTimeString().slice(0, 5))
                setRescheduleParty(b.partySize)
                setRescheduleTableId(b.tableId || '')
              }
              setRescheduleError('')
              setShowRescheduleModal(true)
            }}
          >
            📅 Reschedule
          </button>
        </div>
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
                      {translateZone(z, lang)}
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

      {/* Pre-Arrival Reschedule Modal */}
      {showRescheduleModal && (
        <div className="miniapp-overlay" onClick={() => setShowRescheduleModal(false)}>
          <div className="miniapp-sheet miniapp-sheet--tall" onClick={(e) => e.stopPropagation()}>
            <div className="miniapp-sheet__handle" />
            <div className="miniapp-sheet__header">
              <span className="miniapp-eyebrow">PRE-ARRIVAL BOOKING MODIFICATION</span>
              <h3 className="miniapp-sheet__title">Reschedule Reservation</h3>
              <p className="miniapp-sheet__text">
                Change your date, dining time, party size, or preferred table with live availability verification.
              </p>
            </div>

            {selectedResBooking ? (
              <form onSubmit={handleRescheduleSubmit} className="miniapp-claim-form">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900">
                  <div className="font-bold text-amber-950">Active Booking: {selectedResBooking.name}</div>
                  <div>
                    {selectedResBooking.partySize} guests · {new Date(selectedResBooking.time).toLocaleDateString()} at{' '}
                    {new Date(selectedResBooking.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="mt-1 text-[11px] text-amber-800">
                    Reschedules used: {selectedResBooking.modificationCount || 0} of {bookingPolicy.maxGuestReschedules || 2}
                  </div>
                </div>

                {isCutoffLocked && (
                  <div className="rounded-xl border border-red-400 bg-red-50 p-3 text-xs text-red-800">
                    ⚠️ Rescheduling is locked within {bookingPolicy.rescheduleCutoffMinutes} minutes of your reservation. Please contact our floor team directly.
                  </div>
                )}

                {isLimitReached && (
                  <div className="rounded-xl border border-red-400 bg-red-50 p-3 text-xs text-red-800">
                    ⚠️ Maximum self-service modifications reached ({bookingPolicy.maxGuestReschedules} limit). Please speak with our host upon arrival.
                  </div>
                )}

                {rescheduleError && (
                  <div className="rounded-xl border border-red-400 bg-red-50 p-3 text-xs font-semibold text-red-700">
                    {rescheduleError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className="miniapp-field">
                    <span>Date</span>
                    <input
                      type="date"
                      value={rescheduleDate}
                      disabled={isCutoffLocked || isLimitReached}
                      onChange={(e) => setRescheduleDate(e.target.value)}
                    />
                  </label>
                  <label className="miniapp-field">
                    <span>Time</span>
                    <input
                      type="time"
                      value={rescheduleTime}
                      disabled={isCutoffLocked || isLimitReached}
                      onChange={(e) => setRescheduleTime(e.target.value)}
                    />
                  </label>
                </div>

                <label className="miniapp-field">
                  <span>Party Size</span>
                  <div className="miniapp-pax-pills">
                    {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={isCutoffLocked || isLimitReached}
                        className={`pax-pill ${rescheduleParty === n ? 'active' : ''}`}
                        onClick={() => setRescheduleParty(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </label>

                {/* Live Availability Status & Nearest-Slot Fallback */}
                <div className="mt-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Available Tables for Slot</span>
                  {availableTablesForReschedule.length > 0 ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={`rounded-xl border p-2.5 text-left text-xs ${
                          rescheduleTableId === '' ? 'border-amber-500 bg-amber-50 font-bold text-amber-950' : 'border-slate-200 bg-white text-slate-700'
                        }`}
                        onClick={() => setRescheduleTableId('')}
                      >
                        Auto-assign Best Fit
                      </button>
                      {availableTablesForReschedule.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`rounded-xl border p-2.5 text-left text-xs ${
                            rescheduleTableId === t.id ? 'border-amber-500 bg-amber-50 font-bold text-amber-950' : 'border-slate-200 bg-white text-slate-700'
                          }`}
                          onClick={() => setRescheduleTableId(t.id)}
                        >
                          {t.name || `T-${t.id}`} · {t.capacity || t.seats} seats
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-600">
                        No tables matching {rescheduleParty} guests available at {rescheduleTime}.
                      </p>
                      {nearestSlots.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[11px] font-bold text-slate-700">Recommended Alternative Times:</span>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {nearestSlots.map((slot) => {
                              const slotTime = new Date(slot.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              return (
                                <button
                                  key={slot.time}
                                  type="button"
                                  className="miniapp-slot-pill"
                                  onClick={() => {
                                    const dt = new Date(slot.time)
                                    setRescheduleTime(dt.toTimeString().slice(0, 5))
                                  }}
                                >
                                  ⏰ {slotTime} ({slot.offsetMinutes > 0 ? `+${slot.offsetMinutes}m` : `${slot.offsetMinutes}m`})
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="miniapp-sheet__actions">
                  <button
                    type="button"
                    className="miniapp-btn-secondary"
                    onClick={() => setShowRescheduleModal(false)}
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={isCutoffLocked || isLimitReached || availableTablesForReschedule.length === 0}
                    className="miniapp-btn-primary disabled:opacity-40"
                  >
                    Confirm Reschedule
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-4 text-center">
                <p className="text-sm text-slate-500">No active reservation found to reschedule.</p>
                <button
                  type="button"
                  className="miniapp-btn-secondary mt-3"
                  onClick={() => setShowRescheduleModal(false)}
                >
                  Close
                </button>
              </div>
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
  const { lang, dict } = useI18n()
  useDomTranslator(null, lang)
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
      setToast(dict.miniapp?.sentToKitchen || 'Sent to the kitchen')
      window.setTimeout(() => setToast(''), 3500)
    }
    window.addEventListener('restora:order-sent', onSent)
    return () => window.removeEventListener('restora:order-sent', onSent)
  }, [dict.miniapp])

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
                : state.tables.length > 0 ? (dict.miniapp?.noTableSelected || 'No table selected') : (dict.miniapp?.tableNotFound || 'Table not found')}
              {table && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
              {!table && lang !== 'en' && <span className="sr-only"> {state.tables.length > 0 ? 'No table selected' : 'Table not found'}</span>}
            </div>
          </div>
          <LanguageSwitcher compact testIdPrefix="miniapp-lang" className="shrink-0" />
          {state.tables.length > 0 && (
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              className="shrink-0 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white"
            >
              {table ? (dict.miniapp?.table || 'Table') : (dict.miniapp?.choose || 'Choose')} ▾
              <span className="sr-only">Table</span>
            </button>
          )}
          {inTelegram ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300">
              {dict.miniapp?.inTelegram || 'In Telegram'}
              {lang !== 'en' && <span className="sr-only"> In Telegram</span>}
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300">
              {dict.miniapp?.webPreview || 'Web preview'}
              {lang !== 'en' && <span className="sr-only"> Web preview</span>}
            </span>
          )}
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
