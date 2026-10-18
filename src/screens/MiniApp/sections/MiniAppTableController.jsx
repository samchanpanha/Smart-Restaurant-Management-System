// ─── Mini app guest controller ────────────────────────────────────────
// Two states, one journey:
//
//   • Not seated → a warm welcome card ("Where are you eating?") with
//     Sit now / Pickup / Delivery and the wait quote. Sit now opens the
//     shared TablePicker (sections/TablePicker.jsx) — the same picker the
//     header switcher uses. A free table is seated in one tap.
//   • Seated → a slim dark bar under the chrome with the live status and
//     the 1-tap service chips, plus the move/release/reschedule sheets.
//
// Everything dispatches through the shared reducer; the sheets are the
// kit's Sheet (focus trap, Esc, scroll lock) rather than a bespoke overlay.

import { useEffect, useMemo, useState } from 'react'
import { translateTableName, useI18n } from '../../../lib/i18n'
import { isFreeTableStatus, isTableInServiceStatus } from '../../../lib/constants'
import { findAvailableTablesForSlot, findNearestAvailableSlots } from '../../../lib/models'
import { useNow, useStore } from '../../../lib/store'
import { Button, Input, Sheet } from '../../../components/ui'
import { useToast } from '../../../components/ui/toast-context'
import { guestSessionToken } from '../shared.js'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2'
const FOCUS_DARK = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80'

function MiniAppTableController({ onTableReady, activeTable, waitMin = 15, onOpenPicker, onSeatActive }) {
  const { state, dispatch } = useStore()
  const { lang, dict } = useI18n()
  const copy = dict.miniapp || {}
  const { notify } = useToast()
  const now = useNow(15000)
  const posSettings = state.settings?.pos || {}
  const pickupOn = posSettings.pickupEnabled !== false
  const deliveryOn = posSettings.deliveryEnabled !== false

  // Persistent guest session token (shared with the picker and the claim).
  const [sessionToken] = useState(guestSessionToken)
  const [showReleaseModal, setShowReleaseModal] = useState(false)
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

  // Detect an active table owned by this guest session, or the table the
  // screen is already showing.
  const myTable = useMemo(() => {
    const owned = (state.tables || []).find(
      (t) => t.sessionToken === sessionToken && isTableInServiceStatus(t.status),
    )
    if (owned) return owned
    if (activeTable && isTableInServiceStatus(activeTable.status)) return activeTable
    return null
  }, [state.tables, sessionToken, activeTable])

  // Notify the parent screen when the table changes.
  useEffect(() => {
    if (onTableReady) onTableReady(myTable || null)
  }, [myTable, onTableReady])

  // Active unpaid tickets for this table.
  const unpaidTickets = useMemo(() => {
    if (!myTable) return []
    const list = state.tickets || state.orders || []
    return list.filter(
      (ticket) =>
        String(ticket.tableId) === String(myTable.id) &&
        !['paid', 'cancelled', 'closed', 'void'].includes(ticket.status) &&
        (ticket.items?.length || 0) > 0,
    )
  }, [state.tickets, state.orders, myTable])

  const freeCount = (state.tables || []).filter((t) => isFreeTableStatus(t.status)).length
  const activeIsFree = Boolean(activeTable && isFreeTableStatus(activeTable.status))

  const bookingPolicy = state.settings?.booking || {
    allowGuestReschedule: true,
    rescheduleCutoffMinutes: 60,
    maxGuestReschedules: 2,
    defaultBookingDurationMinutes: 90,
  }
  const rescheduleDuration = bookingPolicy.defaultBookingDurationMinutes || 90
  const rescheduleSlotTime = `${rescheduleDate}T${rescheduleTime}:00`

  // Availability is only worth scanning while the reschedule sheet is open:
  // every store tick re-renders this screen, and walking the whole booking
  // book on each of those is what made the mini app feel slow. The hook sits
  // above the seated/unseated split so both paths run the same hooks.
  const { availableTablesForReschedule, nearestSlots } = useMemo(() => {
    if (!showRescheduleModal || !selectedResBooking) return { availableTablesForReschedule: [], nearestSlots: [] }
    const available = findAvailableTablesForSlot(state, {
      time: rescheduleSlotTime,
      partySize: rescheduleParty,
      durationMinutes: rescheduleDuration,
      excludeBookingId: selectedResBooking.id,
    })
    const nearest = available.length === 0
      ? findNearestAvailableSlots(state, {
          requestedTime: rescheduleSlotTime,
          partySize: rescheduleParty,
          durationMinutes: rescheduleDuration,
          maxSlots: 3,
          excludeBookingId: selectedResBooking.id,
        })
      : []
    return { availableTablesForReschedule: available, nearestSlots: nearest }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showRescheduleModal, selectedResBooking?.id, rescheduleSlotTime, rescheduleParty,
    rescheduleDuration, state.tables, state.reservations, state.settings?.booking,
    state.orders,
  ])

  const isCutoffLocked = selectedResBooking
    ? (new Date(selectedResBooking.time).getTime() - Date.now()) / 60000 < (bookingPolicy.rescheduleCutoffMinutes || 60)
    : false
  const isLimitReached = selectedResBooking
    ? (Number(selectedResBooking.modificationCount) || 0) >= (bookingPolicy.maxGuestReschedules || 2)
    : false

  function handleConfirmRelease() {
    if (!myTable) return
    const willBill = unpaidTickets.length > 0
    dispatch({
      type: 'MINIAPP_RELEASE_TABLE',
      payload: { tableId: myTable.id, sessionToken },
    })
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium')
    setShowReleaseModal(false)
    notify(willBill ? (copy.billOnTheWay || 'Bill requested — staff are on the way.') : (copy.released || 'Table released — thank you!'), 'success')
  }

  function handleQuickService(kind, label) {
    if (!myTable) return
    if (kind === 'bill') {
      setShowReleaseModal(true)
      return
    }
    dispatch({ type: 'CALL_SERVER', tableId: myTable.id, serviceType: kind })
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')
    const message = kind === 'waiter'
      ? (copy.serverNotified || 'Server notified')
      : (copy.serviceRequested ? copy.serviceRequested(label) : `${label} · Staff notified`)
    notify(message, 'success')
  }

  function handleRequestTableMove(event) {
    event.preventDefault()
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
    const targetName = translateTableName(transferTarget.name || `Table ${transferTarget.id}`, lang)
    setShowTransferDrawer(false)
    setTransferTarget(null)
    setTransferReason('')
    notify(copy.moveRequested ? copy.moveRequested(targetName) : `Move requested to ${targetName}`, 'success')
  }

  function handleRescheduleSubmit(event) {
    event.preventDefault()
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
      notify(copy.rescheduled || 'Reservation rescheduled successfully!', 'success')
    } catch (err) {
      setRescheduleError(err.message || 'Reschedule failed')
    }
  }

  function openReschedule() {
    const booking = (state.reservations || []).find((r) => r.status === 'booked')
    setSelectedResBooking(booking || null)
    if (booking) {
      const dt = new Date(booking.time)
      setRescheduleDate(dt.toISOString().slice(0, 10))
      setRescheduleTime(dt.toTimeString().slice(0, 5))
      setRescheduleParty(booking.partySize)
      setRescheduleTableId(booking.tableId || '')
    }
    setRescheduleError('')
    setShowRescheduleModal(true)
  }

  function pickMode(mode) {
    window.dispatchEvent(new CustomEvent('restora:order-mode', { detail: { mode } }))
  }

  // ── STATE A: seated ─────────────────────────────────────────────────
  if (myTable) {
    const hasUnpaid = unpaidTickets.length > 0
    const isBilling = myTable.status === 'billing'
    const pending = myTable.pendingTransfer && myTable.pendingTransfer.status === 'pending'
    const tableName = translateTableName(myTable.name || `Table ${myTable.id}`, lang)
    const party = myTable.partySize || myTable.seats || 2
    const serviceActions = [
      { kind: 'transfer', glyph: '🔄', label: copy.moveTable || 'Move Table', accent: true },
      { kind: 'water', glyph: '💧', label: copy.water || 'Water' },
      { kind: 'napkins', glyph: '🧻', label: copy.napkins || 'Napkins' },
      { kind: 'waiter', glyph: '🙋', label: copy.callWaiter || 'Call server' },
      { kind: 'bill', glyph: '💳', label: copy.bill || 'Bill' },
    ]
    const calledAt = myTable.serverCalledAt ? new Date(myTable.serverCalledAt).getTime() : 0
    const serverCalled = Boolean(calledAt && now - calledAt < 4 * 60 * 1000)

    return (
      <>
        <div
          className="sticky z-30 border-b border-white/10 bg-[var(--guest-chrome)]/95 text-white backdrop-blur"
          style={{ top: 'var(--miniapp-top-offset, 3.75rem)' }}
        >
          <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${isBilling ? 'bg-amber-400' : 'animate-pulse bg-emerald-400 motion-reduce:animate-none'}`}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <strong className="truncate text-sm">{tableName}</strong>
                  <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
                    {copy.guests ? copy.guests(party) : `${party} guests`}
                  </span>
                </div>
                <p className="truncate text-[11px] text-white/60">
                  {isBilling
                    ? (copy.billOnTheWayShort || 'Server notified · Bringing your check')
                    : hasUnpaid
                      ? (copy.activeOrders ? copy.activeOrders(unpaidTickets.length) : `${unpaidTickets.length} active order(s) at your table`)
                      : (
                        <>
                          {copy.seatedHint || 'Seated · tap the menu to order'}
                          {lang !== 'en' && <span className="sr-only"> Seated</span>}
                        </>
                      )}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowReleaseModal(true)}
              className={`min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold transition-colors ${FOCUS_DARK} ${
                hasUnpaid
                  ? 'bg-[var(--guest-accent)] text-[var(--guest-ink)] hover:brightness-105'
                  : 'border border-red-400/40 bg-red-500/15 text-red-200 hover:bg-red-500/25'
              }`}
            >
              {isBilling
                ? (copy.billRequestedShort || 'Bill requested')
                : hasUnpaid
                  ? 'Check & Leave'
                  : 'Release table'}
            </button>
          </div>

          {/* 1-tap service chips — guest emoji glyphs, 44px targets. */}
          <div
            className="mx-auto flex max-w-md gap-2 overflow-x-auto px-4 pb-2.5"
            role="toolbar"
            aria-label={copy.quickServices || 'Quick table services'}
          >
            {serviceActions.map((action) => {
              if (action.kind === 'waiter' && serverCalled) {
                return (
                  <span
                    key={action.kind}
                    role="status"
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-3.5 text-xs font-semibold text-emerald-200"
                  >
                    <span aria-hidden="true">✓</span>
                    {copy.serverNotified || 'Server notified'}
                    {lang !== 'en' && <span className="sr-only"> Server notified</span>}
                  </span>
                )
              }
              return (
                <button
                  key={action.kind}
                  type="button"
                  onClick={() => {
                    if (action.kind === 'transfer') setShowTransferDrawer(true)
                    else handleQuickService(action.kind, `${action.glyph} ${action.label}`)
                  }}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors ${FOCUS_DARK} ${
                    action.accent
                      ? 'border-sky-400/45 bg-sky-400/15 text-sky-200 hover:bg-sky-400/25'
                      : 'border-white/15 bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <span aria-hidden="true">{action.glyph}</span>
                  {action.label}
                  {action.kind === 'waiter' && lang !== 'en' && <span className="sr-only"> Call server</span>}
                </button>
              )
            })}
          </div>
        </div>

        {pending && (
          <div className="mx-auto mt-2 flex max-w-md items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-amber-400/35 bg-amber-400/15 px-3 py-2 text-[11px] text-amber-100">
            <span className="min-w-0">
              🔄 Move requested to{' '}
              <strong>{translateTableName(pending.targetTableName || pending.targetTableId, lang)}</strong>
              {' · '}Awaiting staff approval
            </span>
            <button
              type="button"
              onClick={() => dispatch({ type: 'REJECT_TABLE_TRANSFER', payload: { currentTableId: myTable.id, reason: 'Guest cancelled' } })}
              className={`min-h-11 shrink-0 font-bold text-amber-200 underline ${FOCUS_DARK}`}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Move / switch table drawer for a seated diner. */}
        {showTransferDrawer && (
          <Sheet tall label="Move table" onClose={() => { setShowTransferDrawer(false); setTransferTarget(null) }}>
            {!transferTarget ? (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">Active dining move</p>
                  <h3 className="mt-1 text-lg font-extrabold text-[var(--guest-ink)]">Select a new table</h3>
                  <p className="mt-1 text-sm text-stone-500">
                    Currently at <strong>{tableName}</strong>.{' '}
                    <span>Choose an open table to request a move.</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(state.tables || [])
                    .filter((table) => table.id !== myTable.id)
                    .map((table) => {
                      const free = isFreeTableStatus(table.status)
                      const seats = Number(table.capacity || table.seats) || 4
                      return (
                        <button
                          key={table.id}
                          type="button"
                          disabled={!free}
                          onClick={() => setTransferTarget(table)}
                          className={`flex min-h-[64px] flex-col items-start justify-center rounded-[var(--radius-lg)] border px-3 py-2 text-left transition-colors ${FOCUS} ${
                            free
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                              : 'border-stone-100 bg-stone-50 text-stone-400'
                          }`}
                        >
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="truncate text-sm font-extrabold">
                              {translateTableName(table.name || `Table ${table.id}`, lang)}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold opacity-70">
                              {copy.seats ? copy.seats(seats) : `${seats} seats`}
                            </span>
                          </span>
                          <span className={`mt-0.5 text-[11px] font-semibold ${free ? 'text-emerald-700' : ''}`}>
                            {free
                              ? 'Available · Tap to pick'
                              : isTableInServiceStatus(table.status)
                                ? 'In service'
                                : table.status}
                          </span>
                        </button>
                      )
                    })}
                </div>
              </div>
            ) : (
              <form onSubmit={handleRequestTableMove} className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">Confirm table transfer</p>
                  <h3 className="mt-1 text-lg font-extrabold text-[var(--guest-ink)]">
                    Move to {translateTableName(transferTarget.name || `Table ${transferTarget.id}`, lang)}
                  </h3>
                  <p className="mt-1 text-sm text-stone-500">
                    Your open tickets and active kitchen orders will automatically migrate. Floor staff will approve the move.
                  </p>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-stone-400">
                    Reason for move (optional)
                  </span>
                  <Input
                    type="text"
                    placeholder="e.g. Want a window seat"
                    value={transferReason}
                    onChange={(event) => setTransferReason(event.target.value)}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button type="button" variant="secondary" onClick={() => setTransferTarget(null)}>
                    Back
                  </Button>
                  <Button type="submit">Request move</Button>
                </div>
              </form>
            )}
          </Sheet>
        )}

        {showReleaseModal && (
          <Sheet label={hasUnpaid ? 'Request bill and release table' : 'Leave and release table'} onClose={() => setShowReleaseModal(false)}>
            <h3 className="text-lg font-extrabold text-[var(--guest-ink)]">
              {hasUnpaid ? 'Request bill & release table?' : 'Leave & release table?'}
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              {hasUnpaid
                ? (copy.releaseUnpaid
                  ? copy.releaseUnpaid(unpaidTickets.length, tableName)
                  : `You have ${unpaidTickets.length} open ticket(s) on ${tableName}. We will notify staff to finalize your payment and release the table.`)
                : (copy.releaseFree
                  ? copy.releaseFree(tableName)
                  : `Finished dining or haven't ordered yet? Releasing ${tableName} immediately frees it for other guests.`)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setShowReleaseModal(false)}>
                Keep table
              </Button>
              <Button type="button" onClick={handleConfirmRelease}>
                {hasUnpaid ? 'Notify staff & pay' : 'Release table now'}
              </Button>
            </div>
          </Sheet>
        )}
      </>
    )
  }

  // ── STATE B: not seated ─────────────────────────────────────────────
  return (
    <>
      <section
        aria-labelledby="miniapp-welcome-title"
        className="mx-4 mt-3 rounded-[var(--radius-xl)] border border-black/5 bg-[var(--guest-surface)] p-4 shadow-sm"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">
          {copy.stepOne || 'Step 1 · Welcome'}
        </p>
        <h2 id="miniapp-welcome-title" className="mt-1 text-lg font-extrabold text-[var(--guest-ink)]">
          {copy.whereEating || 'Where are you eating?'}
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          {state.tables.length === 0
            ? (copy.noTablesYet || 'No tables yet — order pickup or delivery')
            : freeCount === 0
              ? (copy.allBusy || 'All tables are taken right now — order pickup or delivery')
              : (
                <>
                  {copy.tablesFree
                    ? copy.tablesFree(freeCount, state.tables.length)
                    : `${freeCount} of ${state.tables.length} tables free`}
                  {freeCount <= 2 && (
                    <span className="ml-1">
                      · {copy.waitMin ? copy.waitMin(waitMin) : `~${waitMin} min wait`}
                    </span>
                  )}
                </>
              )}
        </p>
        {activeTable && !activeIsFree && !isTableInServiceStatus(activeTable.status) && (
          <p className="mt-2 rounded-[var(--radius-md)] bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            {translateTableName(activeTable.name || `Table ${activeTable.id}`, lang)} isn&apos;t seated yet.
            <span className="font-normal text-amber-800"> Sit now or ask the host to seat you.</span>
            <span className="sr-only"> {activeTable.name} isn&apos;t seated yet.</span>
          </p>
        )}

        <div className="mt-3 space-y-2">
          {activeIsFree ? (
            <button
              type="button"
              onClick={() => onSeatActive?.(activeTable)}
              className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--guest-accent)] px-4 text-sm font-extrabold text-[var(--guest-ink)] shadow-sm transition-[filter] hover:brightness-105 ${FOCUS}`}
            >
              <span aria-hidden="true">🪑</span>
              {copy.sitAt
                ? copy.sitAt(translateTableName(activeTable.name || `Table ${activeTable.id}`, lang))
                : `Sit at ${activeTable.name}`}
            </button>
          ) : freeCount > 0 ? (
            <button
              type="button"
              onClick={onOpenPicker}
              className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--guest-accent)] px-4 text-sm font-extrabold text-[var(--guest-ink)] shadow-sm transition-[filter] hover:brightness-105 ${FOCUS}`}
            >
              <span aria-hidden="true">🪑</span>
              {copy.sitNow || 'Sit now'}
            </button>
          ) : null}

          {(pickupOn || deliveryOn) ? (
            <div className={`grid gap-2 ${pickupOn && deliveryOn ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {pickupOn && (
                <button
                  type="button"
                  onClick={() => pickMode('pickup')}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-stone-200 bg-white px-3 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-50 ${FOCUS}`}
                >
                  <span aria-hidden="true">🍽</span>
                  {copy.orderForPickup || 'Order for pickup'}
                  {lang !== 'en' && <span className="sr-only"> Order for pickup</span>}
                </button>
              )}
              {deliveryOn && (
                <button
                  type="button"
                  onClick={() => pickMode('delivery')}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-stone-200 bg-white px-3 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-50 ${FOCUS}`}
                >
                  <span aria-hidden="true">🛵</span>
                  {copy.orderForDelivery || 'Order for delivery'}
                  {lang !== 'en' && <span className="sr-only"> Order for delivery</span>}
                </button>
              )}
            </div>
          ) : (
            <p className="rounded-[var(--radius-lg)] bg-stone-100 px-4 py-3 text-center text-xs font-semibold leading-relaxed text-stone-500">
              {copy.orderPaused || 'Pickup and delivery are paused right now. Please ask the host.'}
            </p>
          )}

          <button
            type="button"
            onClick={openReschedule}
            className={`min-h-11 w-full rounded-[var(--radius-lg)] px-3 text-xs font-semibold text-stone-500 underline-offset-2 transition-colors hover:bg-stone-50 hover:underline ${FOCUS}`}
          >
            📅 {copy.haveBooking || 'Have a booking? Reschedule'}
          </button>
        </div>
      </section>

      {showRescheduleModal && (
        <Sheet tall label="Reschedule reservation" onClose={() => setShowRescheduleModal(false)}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">
              Pre-arrival booking modification
            </p>
            <h3 className="mt-1 text-lg font-extrabold text-[var(--guest-ink)]">Reschedule reservation</h3>
            <p className="mt-1 text-sm text-stone-500">
              Change your date, dining time, party size, or preferred table with live availability verification.
            </p>
          </div>

          {selectedResBooking ? (
            <form onSubmit={handleRescheduleSubmit} className="mt-3 space-y-3">
              <div className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900">
                <div className="font-bold text-amber-950">Active booking: {selectedResBooking.name}</div>
                <div>
                  {copy.guests ? copy.guests(selectedResBooking.partySize) : `${selectedResBooking.partySize} guests`} ·{' '}
                  {new Date(selectedResBooking.time).toLocaleDateString()} ·{' '}
                  {new Date(selectedResBooking.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="mt-1 text-[11px] text-amber-800">
                  Reschedules used: {selectedResBooking.modificationCount || 0} of {bookingPolicy.maxGuestReschedules || 2}
                </div>
              </div>

              {isCutoffLocked && (
                <div className="rounded-[var(--radius-lg)] border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                  ⚠️ {copy.cutoffLocked ? copy.cutoffLocked(bookingPolicy.rescheduleCutoffMinutes || 60) : `Rescheduling is locked within ${bookingPolicy.rescheduleCutoffMinutes || 60} minutes of your reservation.`}
                </div>
              )}

              {isLimitReached && (
                <div className="rounded-[var(--radius-lg)] border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                  ⚠️ {copy.limitReached ? copy.limitReached(bookingPolicy.maxGuestReschedules || 2) : `Maximum self-service modifications reached (${bookingPolicy.maxGuestReschedules || 2}).`}
                </div>
              )}

              {rescheduleError && (
                <div className="rounded-[var(--radius-lg)] border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-700">
                  {rescheduleError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-stone-400">Date</span>
                  <Input
                    type="date"
                    value={rescheduleDate}
                    disabled={isCutoffLocked || isLimitReached}
                    onChange={(event) => setRescheduleDate(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-stone-400">Time</span>
                  <Input
                    type="time"
                    value={rescheduleTime}
                    disabled={isCutoffLocked || isLimitReached}
                    onChange={(event) => setRescheduleTime(event.target.value)}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400">Party size</span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 8].map((size) => (
                    <button
                      key={size}
                      type="button"
                      disabled={isCutoffLocked || isLimitReached}
                      onClick={() => setRescheduleParty(size)}
                      className={`min-h-11 min-w-11 rounded-full border px-2 text-xs font-bold transition-colors ${
                        rescheduleParty === size
                          ? 'border-[var(--guest-accent)] bg-[var(--guest-accent)] text-[var(--guest-ink)]'
                          : 'border-stone-200 bg-white text-stone-600'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live availability + nearest-slot fallback. */}
              <div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400">
                  Available tables for slot
                </span>
                {availableTablesForReschedule.length > 0 ? (
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRescheduleTableId('')}
                      className={`min-h-11 rounded-[var(--radius-lg)] border p-2.5 text-left text-xs ${
                        rescheduleTableId === ''
                          ? 'border-amber-500 bg-amber-50 font-bold text-amber-950'
                          : 'border-stone-200 bg-white text-stone-700'
                      }`}
                    >
                      Auto-assign best fit
                    </button>
                    {availableTablesForReschedule.map((table) => (
                      <button
                        key={table.id}
                        type="button"
                        onClick={() => setRescheduleTableId(table.id)}
                        className={`min-h-11 rounded-[var(--radius-lg)] border p-2.5 text-left text-xs ${
                          rescheduleTableId === table.id
                            ? 'border-amber-500 bg-amber-50 font-bold text-amber-950'
                            : 'border-stone-200 bg-white text-stone-700'
                        }`}
                      >
                        {translateTableName(table.name || `Table ${table.id}`, lang)}
                        {' · '}
                        {copy.seats ? copy.seats(table.capacity || table.seats) : `${table.capacity || table.seats} seats`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1.5 rounded-[var(--radius-lg)] border border-stone-200 bg-stone-50 p-3">
                    <p className="text-xs text-stone-600">
                      {copy.noTablesFor
                        ? copy.noTablesFor(rescheduleParty, rescheduleTime)
                        : `No tables matching ${rescheduleParty} guests available at ${rescheduleTime}.`}
                    </p>
                    {nearestSlots.length > 0 && (
                      <div className="mt-2">
                        <span className="text-[11px] font-bold text-stone-700">Recommended alternative times:</span>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {nearestSlots.map((slot) => {
                            const slotTime = new Date(slot.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            return (
                              <button
                                key={slot.time}
                                type="button"
                                className="inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-stone-300 bg-stone-50 px-3 text-xs font-bold text-stone-800 transition-colors hover:border-amber-500 hover:bg-amber-50 hover:text-amber-900"
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

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setShowRescheduleModal(false)}>
                  Close
                </Button>
                <Button type="submit" disabled={isCutoffLocked || isLimitReached || availableTablesForReschedule.length === 0}>
                  Confirm reschedule
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-4 rounded-[var(--radius-lg)] bg-stone-50 p-4 text-center">
              <p className="text-sm text-stone-500">No active reservation found to reschedule.</p>
              <Button type="button" variant="secondary" className="mt-3" onClick={() => setShowRescheduleModal(false)}>
                Close
              </Button>
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}

export { MiniAppTableController }
