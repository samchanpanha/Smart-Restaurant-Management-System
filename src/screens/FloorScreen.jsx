// ─── Step 2: Floor — tables, reservations, waitlist ─────────────────
// The floor as a live map, not a list. Host (Alex) seats parties,
// quotes honest waits from today's actual turns, and sees which
// tables will free next. Strict table machine enforced by the store.

import { useMemo, useState } from 'react'
import StatusPill from '../components/StatusPill'
import { Field, Modal, Stepper, inputCls } from '../components/ui'
import { TABLE_STATUS_META, TARGETS } from '../lib/constants'
import { formatClock, isSeatBlocked, minutesBetween, needsOverSeatConfirm } from '../lib/models'
import { quoteWait, useNow, useRestora } from '../lib/store'

const ZONES = ['Bar', 'Main', 'Patio']

// ─── Seat dialog ────────────────────────────────────────────────
// Seats walk-ins, reservations, or waitlist parties. Over-capacity
// requires explicit confirm; dirty/occupied tables are unpickable.

function SeatDialog({ tableId, initialParty = 2, initialName = '', reservationId = null, waitlistId = null, onClose, onError }) {
  const { state, dispatch } = useRestora()
  const seatable = state.tables.filter((t) => t.status === 'free' || t.status === 'reserved')
  const [chosenTableId, setChosenTableId] = useState(
    tableId && seatable.some((t) => t.id === tableId) ? tableId : (seatable[0]?.id || ''),
  )
  const [party, setParty] = useState(initialParty)
  const [name, setName] = useState(initialName)
  const [source, setSource] = useState(reservationId ? 'phone' : 'walk_in')
  const [overConfirm, setOverConfirm] = useState(false)

  const table = state.tables.find((t) => t.id === chosenTableId)
  const overSeat = table ? needsOverSeatConfirm(table, party) : false

  function seat() {
    if (!table) return
    if (isSeatBlocked(table)) {
      onError(`${table.name} can't be seated while ${TABLE_STATUS_META[table.status].label.toLowerCase()}.`)
      return
    }
    if (overSeat && !overConfirm) return
    dispatch({ type: 'SEAT_PARTY', tableId: table.id, partySize: party, reservationId })
    if (waitlistId) dispatch({ type: 'REMOVE_WAITLIST', id: waitlistId })
    onClose()
  }

  if (!seatable.length) {
    return (
      <Modal title="Seat party" sub="No tables are seatable right now." onClose={onClose}>
        <p className="text-sm text-zinc-400">
          Every table is occupied, billed, or dirty. Bus a dirty table or add the party to the
          waitlist with an honest quoted wait.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-[var(--color-ink-600)] py-2.5 text-sm text-zinc-200 hover:bg-white/5 min-h-[44px]"
        >
          Back to floor
        </button>
      </Modal>
    )
  }

  return (
    <Modal
      title={`Seat party${table ? ` · ${table.name}` : ''}`}
      sub={reservationId ? 'Seating from reservation book' : waitlistId ? 'Seating from waitlist' : 'Walk-in seating'}
      onClose={onClose}
    >
      <div className="mt-4 space-y-4">
        <Field label="Table">
          <select value={chosenTableId} onChange={(e) => { setChosenTableId(e.target.value); setOverConfirm(false) }} className={inputCls}>
            {seatable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.seats} seats · {t.zone} · {TABLE_STATUS_META[t.status].label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end justify-between gap-4">
          <Field label="Party size">
            <Stepper value={party} onChange={(v) => { setParty(v); setOverConfirm(false) }} />
          </Field>
          <Field label="Source">
            <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls} aria-label="Party source">
              <option value="walk_in">Walk-in</option>
              <option value="phone">Phone</option>
              <option value="online">Online</option>
            </select>
          </Field>
        </div>
        <Field label="Name (optional)">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Carter party"
            className={inputCls}
            maxLength={40}
          />
        </Field>

        {overSeat && (
          <div className="rounded-xl bg-amber-500/10 p-3.5 text-sm ring-1 ring-inset ring-amber-500/40">
            <div className="font-semibold text-amber-200">
              Over capacity: party of {party} on a {table.seats}-top.
            </div>
            <p className="mt-0.5 text-xs text-amber-200/70">
              Host confirm required. The squeeze is on you, Alex.
            </p>
            <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-amber-100">
              <input
                type="checkbox"
                checked={overConfirm}
                onChange={(e) => setOverConfirm(e.target.checked)}
                className="h-5 w-5 accent-amber-500"
              />
              Seat anyway — I take responsibility
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={seat}
          disabled={!table || (overSeat && !overConfirm)}
          className="w-full rounded-lg bg-amber-500 py-3 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 min-h-[44px]"
        >
          Seat party{table ? ` · ${table.name}` : ''}
        </button>
      </div>
    </Modal>
  )
}

// ─── Table card ─────────────────────────────────────────────────

function TableCard({ table, onOpen }) {
  const { state } = useRestora()
  useNow(15000)
  const meta = TABLE_STATUS_META[table.status]
  const occupied = table.status === 'seated' || table.status === 'ordered'
  const mins = table.seatedAt ? minutesBetween(table.seatedAt) : 0
  const turnRatio = occupied ? mins / table.targetTurnMinutes : 0
  const longTurn = turnRatio >= TARGETS.turnAlertRatio

  // Predicted next free from today's actual turns for this party size
  const predictedFree = useMemo(() => {
    if (!occupied || !table.seatedAt) return null
    const avg = quoteWait(state, table.partySize || table.seats)
    const freeAt = new Date(new Date(table.seatedAt).getTime() + avg * 60000)
    return { at: freeAt, avg }
  }, [occupied, table.seatedAt, table.partySize, table.seats, state])

  const sizeCls =
    table.seats <= 2 ? 'col-span-1' : table.seats <= 4 ? 'col-span-1 sm:col-span-1' : 'col-span-2'

  return (
    <button
      type="button"
      onClick={() => onOpen(table)}
      aria-label={`${table.name}, ${table.seats} seats, ${meta.label}${occupied ? `, party of ${table.partySize}, seated ${mins} minutes` : ''}`}
      className={`min-h-[118px] rounded-2xl border p-3 text-left transition-transform active:scale-[0.98] ${sizeCls} ${
        longTurn
          ? 'border-amber-500/60 bg-[var(--color-ink-850)] ring-2 ring-amber-500/30'
          : 'border-[var(--color-ink-700)] bg-[var(--color-ink-900)] hover:border-[var(--color-ink-600)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold leading-tight">{table.name}</div>
          <div className="text-[11px] text-zinc-500">
            {table.seats} seats · {table.zone}
          </div>
        </div>
        <StatusPill tone={meta.tone} size="sm">
          {meta.label}
        </StatusPill>
      </div>

      <div className="mt-2 min-h-10 text-xs">
        {occupied ? (
          <>
            <div className="tnum text-sm font-semibold text-zinc-200">
              Party of {table.partySize} · {mins}m
            </div>
            {predictedFree && (
              <div className="mt-0.5 text-[11px] text-zinc-500">
                free ~{formatClock(predictedFree.at)} ({predictedFree.avg}m avg turn)
              </div>
            )}
          </>
        ) : table.status === 'billed' ? (
          <div className="text-zinc-400">Check paid — needs bussing</div>
        ) : table.status === 'dirty' ? (
          <div className="text-zinc-400">Needs bussing + reset</div>
        ) : table.status === 'reserved' ? (
          <div className="text-zinc-400">Held for reservation</div>
        ) : (
          <div className="text-zinc-500">Tap to seat</div>
        )}
      </div>

      {occupied && (
        <div className="mt-2" aria-hidden>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/50">
            <div
              className={`h-full rounded-full transition-all ${longTurn ? 'bg-amber-400' : 'bg-emerald-500/70'}`}
              style={{ width: `${Math.min(100, turnRatio * 100)}%` }}
            />
          </div>
          {longTurn && (
            <div className="mt-1 text-[11px] font-semibold text-amber-300">
              Long turn · {mins}m of {table.targetTurnMinutes}m target
            </div>
          )}
        </div>
      )}
    </button>
  )
}

// ─── Table detail ───────────────────────────────────────────────

function TableDetail({ table, onClose, onSeat, onError }) {
  const { state, dispatch, setScreen, setSelectedTableId } = useRestora()
  useNow(15000)
  const meta = TABLE_STATUS_META[table.status]
  const mins = table.seatedAt ? minutesBetween(table.seatedAt) : 0
  const check = state.orders.find((o) => o.id === table.currentCheckId && !['paid', 'void'].includes(o.status))
  const linkedRes = state.reservations.find(
    (r) => r.tableId === table.id && r.status === 'booked',
  )

  const btn =
    'w-full rounded-lg py-2.5 text-sm font-semibold min-h-[44px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const btnPrimary = `${btn} bg-amber-500 text-black hover:bg-amber-400`
  const btnGhost = `${btn} border border-[var(--color-ink-600)] text-zinc-200 hover:bg-white/5`

  return (
    <Modal
      title={`${table.name} · ${table.seats} seats`}
      sub={`${table.zone} · target turn ${table.targetTurnMinutes}m`}
      onClose={onClose}
    >
      <div className="mt-3 flex items-center gap-2">
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        {(table.status === 'seated' || table.status === 'ordered') && (
          <span className="tnum text-sm text-zinc-300">
            Party of {table.partySize} · {mins}m seated
          </span>
        )}
        {linkedRes && (
          <span className="text-xs text-zinc-400">
            Reserved: {linkedRes.name} · {linkedRes.partySize} · {formatClock(linkedRes.time)}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {(table.status === 'free' || table.status === 'reserved') && (
          <>
            <button type="button" className={btnPrimary} onClick={() => { onClose(); onSeat(table.id) }}>
              Seat party
            </button>
            {table.status === 'free' ? (
              <button
                type="button"
                className={btnGhost}
                onClick={() => { dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'reserved' }); onClose() }}
              >
                Hold as reserved
              </button>
            ) : (
              <button
                type="button"
                className={btnGhost}
                onClick={() => { dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'free' }); onClose() }}
              >
                Release hold → free
              </button>
            )}
          </>
        )}

        {(table.status === 'seated' || table.status === 'ordered') && (
          <>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setSelectedTableId(table.id)
                setScreen('tickets')
                onClose()
              }}
            >
              {check ? `Open check · ${check.items.length} item${check.items.length === 1 ? '' : 's'}` : 'Start check'}
            </button>
            <p className="text-center text-[11px] text-zinc-500">
              Billing happens on Tickets — the table follows the check.
            </p>
          </>
        )}

        {table.status === 'billed' && (
          <button
            type="button"
            className={btnPrimary}
            onClick={() => { dispatch({ type: 'BUS_TABLE', tableId: table.id }); onClose() }}
          >
            Bus table → dirty
          </button>
        )}

        {table.status === 'dirty' && (
          <button
            type="button"
            className={btnPrimary}
            onClick={() => { dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'free' }); onClose() }}
          >
            Mark clean → free
          </button>
        )}

        {(table.status === 'ordered' || table.status === 'billed') && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => onError('Tables turn through the check: pay on Tickets, then bus here.')}
          >
            Why can&apos;t I free this table?
          </button>
        )}
      </div>
    </Modal>
  )
}

// ─── Reservations ───────────────────────────────────────────────

function slotLabel(iso) {
  const d = new Date(iso)
  const m = Math.floor(d.getMinutes() / 15) * 15
  return `${String(d.getHours()).padStart(2, '0')}:${String(m).padStart(2, '0')} slot`
}

function localInputDefault(hoursAhead = 1) {
  const d = new Date(Date.now() + hoursAhead * 3600000)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ReservationsPanel({ onSeatRes, onError }) {
  const { state, dispatch } = useRestora()
  useNow(30000)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [party, setParty] = useState(2)
  const [time, setTime] = useState(localInputDefault(1))
  const [tableId, setTableId] = useState('')
  const [notes, setNotes] = useState('')

  const upcoming = [...state.reservations]
    .filter((r) => r.status === 'booked')
    .sort((a, b) => new Date(a.time) - new Date(b.time))
  const past = state.reservations.filter((r) => r.status !== 'booked')

  function add() {
    if (!name.trim()) {
      onError('Reservation needs a name.')
      return
    }
    dispatch({
      type: 'ADD_RESERVATION',
      reservation: {
        name: name.trim(),
        partySize: party,
        time: new Date(time).toISOString(),
        tableId: tableId || null,
        notes,
        source: 'phone',
      },
    })
    if (tableId) {
      const t = state.tables.find((x) => x.id === tableId)
      if (t && t.status === 'free') dispatch({ type: 'SET_TABLE_STATUS', tableId, to: 'reserved' })
    }
    setAdding(false)
    setName('')
    setParty(2)
    setTime(localInputDefault(1))
    setTableId('')
    setNotes('')
  }

  return (
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          Reservations · {upcoming.length} booked
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="min-h-[44px] rounded-lg border border-[var(--color-ink-600)] px-3 text-sm text-zinc-200 hover:bg-white/5"
        >
          {adding ? 'Cancel' : '+ Book'}
        </button>
      </div>

      {adding && (
        <div className="mt-3 space-y-3 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carter party" className={inputCls} maxLength={40} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Party">
              <Stepper value={party} onChange={setParty} />
            </Field>
            <Field label="Time">
              <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Assign table (optional)">
            <select value={tableId} onChange={(e) => setTableId(e.target.value)} className={inputCls}>
              <option value="">Unassigned</option>
              {state.tables
                .filter((t) => t.status === 'free')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.seats} seats
                  </option>
                ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={add}
            className="min-h-[44px] w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
          >
            Book reservation
          </button>
        </div>
      )}

      <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
        {upcoming.length === 0 && <li className="text-sm text-zinc-500">No upcoming reservations.</li>}
        {upcoming.map((r) => {
          const minsUntil = Math.round((new Date(r.time) - Date.now()) / 60000)
          const overdue = minsUntil < -TARGETS.noShowMinutes
          const assigned = r.tableId ? state.tables.find((t) => t.id === r.tableId) : null
          return (
            <li
              key={r.id}
              className={`rounded-xl p-3 ring-1 ring-inset ${
                overdue
                  ? 'bg-red-500/5 ring-red-500/30'
                  : 'bg-[var(--color-ink-800)] ring-[var(--color-ink-600)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">{r.name}</div>
                  <div className="text-xs text-zinc-400">
                    Party of {r.partySize} · {formatClock(r.time)} · {slotLabel(r.time)}
                  </div>
                  <div className={`text-[11px] ${overdue ? 'font-semibold text-red-300' : 'text-zinc-500'}`}>
                    {minsUntil >= 0 ? `in ${minsUntil}m` : `${-minsUntil}m ago`}
                    {assigned ? ` · ${assigned.name} (${TABLE_STATUS_META[assigned.status].label})` : ' · no table yet'}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onSeatRes(r)}
                  className="min-h-[44px] flex-1 rounded-lg bg-amber-500/90 px-2 py-1.5 text-xs font-bold text-black hover:bg-amber-400"
                >
                  Seat
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: r.id, patch: { status: 'no_show' } })}
                  title={overdue ? 'Overdue — mark no-show' : 'Mark no-show'}
                  className={`min-h-[44px] flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-white/5 ${
                    overdue ? 'border-red-500/50 text-red-300' : 'border-[var(--color-ink-600)] text-zinc-300'
                  }`}
                >
                  No-show
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: r.id, patch: { status: 'cancelled' } })}
                  className="min-h-[44px] flex-1 rounded-lg border border-[var(--color-ink-600)] px-2 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {past.length > 0 && (
        <details className="mt-2 text-xs text-zinc-500">
          <summary className="cursor-pointer py-2">Earlier: {past.length} seated / no-show / cancelled</summary>
          <ul className="space-y-1 pb-1">
            {past.slice(-5).reverse().map((r) => (
              <li key={r.id}>
                {r.name} · {r.partySize} · {formatClock(r.time)} · {r.status.replace('_', ' ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

// ─── Waitlist ───────────────────────────────────────────────────

function WaitlistPanel({ onSeatWl, onError }) {
  const { state, dispatch } = useRestora()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [party, setParty] = useState(2)

  // Next free table prediction: earliest (avgTurn − elapsed) across occupied
  const nextFree = useMemo(() => {
    const occupied = state.tables.filter(
      (t) => (t.status === 'seated' || t.status === 'ordered') && t.seatedAt,
    )
    if (!occupied.length) return { mins: 0, table: null }
    let best = null
    for (const t of occupied) {
      const avg = quoteWait(state, t.partySize || t.seats)
      const remain = Math.max(0, avg - minutesBetween(t.seatedAt))
      if (!best || remain < best.mins) best = { mins: remain, table: t }
    }
    return best
  }, [state])

  const quoted = quoteWait(state, party)

  function add() {
    if (!name.trim()) {
      onError('Waitlist entry needs a name.')
      return
    }
    dispatch({
      type: 'ADD_WAITLIST',
      entry: { name: name.trim(), partySize: party, quotedWaitMin: quoted },
    })
    setAdding(false)
    setName('')
    setParty(2)
  }

  return (
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          Waitlist · {state.waitlist.length}
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="min-h-[44px] rounded-lg border border-[var(--color-ink-600)] px-3 text-sm text-zinc-200 hover:bg-white/5"
        >
          {adding ? 'Cancel' : '+ Walk-in'}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-zinc-500">
        {nextFree.table
          ? <>Next free: <strong className="text-zinc-300">{nextFree.table.name}</strong> in ~{nextFree.mins}m (from today&apos;s turns)</>
          : 'Floor is clear — seat straight away.'}
      </p>

      {adding && (
        <div className="mt-3 space-y-3 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Walk-in · Kim" className={inputCls} maxLength={40} />
          </Field>
          <Field label="Party">
            <Stepper value={party} onChange={setParty} />
          </Field>
          <div className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-200 ring-1 ring-inset ring-sky-500/30">
            Honest quote: <strong>~{quoted} min</strong> — today&apos;s average turn for a party of {party}.
          </div>
          <button
            type="button"
            onClick={add}
            className="min-h-[44px] w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
          >
            Add to waitlist
          </button>
        </div>
      )}

      <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
        {state.waitlist.length === 0 && <li className="text-sm text-zinc-500">Nobody waiting.</li>}
        {state.waitlist.map((w) => (
          <li key={w.id} className="rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-zinc-100">{w.name}</div>
                <div className="text-xs text-zinc-400">
                  Party of {w.partySize} · quoted ~{w.quotedWaitMin}m · waiting {minutesBetween(w.addedAt)}m
                </div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onSeatWl(w)}
                className="min-h-[44px] flex-1 rounded-lg bg-amber-500/90 px-2 py-1.5 text-xs font-bold text-black hover:bg-amber-400"
              >
                Seat
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'REMOVE_WAITLIST', id: w.id })}
                className="min-h-[44px] flex-1 rounded-lg border border-[var(--color-ink-600)] px-2 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function FloorScreen() {
  const { state } = useRestora()
  const [detailTableId, setDetailTableId] = useState(null)
  const [seatCtx, setSeatCtx] = useState(null) // { tableId, party, name, reservationId, waitlistId }
  const [banner, setBanner] = useState(null)

  function flash(msg) {
    setBanner(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setBanner(null), 4200)
  }

  const occupied = state.tables.filter((t) => ['seated', 'ordered', 'billed'].includes(t.status)).length
  const freeCount = state.tables.filter((t) => t.status === 'free').length
  const dirtyCount = state.tables.filter((t) => t.status === 'dirty').length
  const detailTable = detailTableId ? state.tables.find((t) => t.id === detailTableId) : null

  function openTable(table) {
    if (table.status === 'free') {
      // Fast path: tap a free table to seat immediately
      setSeatCtx({ tableId: table.id, party: Math.min(table.seats, 4), name: '' })
    } else {
      setDetailTableId(table.id)
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
            Live · step 2 · host: Alex
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Floor</h1>
        </div>
        <div className="flex gap-2">
          <StatusPill tone="ok">Free · {freeCount}</StatusPill>
          <StatusPill tone="info">Occupied · {occupied}</StatusPill>
          <StatusPill tone={dirtyCount ? 'bad' : 'muted'}>Dirty · {dirtyCount}</StatusPill>
        </div>
      </header>

      {banner && (
        <div className="animate-status-in rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-inset ring-amber-500/40" role="alert">
          {banner}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {ZONES.map((zone) => {
            const tables = state.tables.filter((t) => t.zone === zone)
            return (
              <section key={zone}>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                  {zone} · {tables.length} tables
                </h2>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {tables.map((t) => (
                    <TableCard key={t.id} table={t} onOpen={openTable} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        <div className="space-y-5">
          <ReservationsPanel
            onSeatRes={(r) =>
              setSeatCtx({
                tableId: r.tableId,
                party: r.partySize,
                name: r.name,
                reservationId: r.id,
              })
            }
            onError={flash}
          />
          <WaitlistPanel
            onSeatWl={(w) =>
              setSeatCtx({ tableId: null, party: w.partySize, name: w.name, waitlistId: w.id })
            }
            onError={flash}
          />
        </div>
      </div>

      {detailTable && (
        <TableDetail
          table={detailTable}
          onClose={() => setDetailTableId(null)}
          onSeat={(id) => setSeatCtx({ tableId: id, party: 2, name: '' })}
          onError={flash}
        />
      )}
      {seatCtx && (
        <SeatDialog
          tableId={seatCtx.tableId}
          initialParty={seatCtx.party}
          initialName={seatCtx.name}
          reservationId={seatCtx.reservationId}
          waitlistId={seatCtx.waitlistId}
          onClose={() => setSeatCtx(null)}
          onError={flash}
        />
      )}
    </div>
  )
}
