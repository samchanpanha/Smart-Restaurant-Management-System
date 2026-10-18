import { useState } from 'react'
import { Button, Field, Input, Select, Stepper } from '../../../components/ui'
import { TARGETS } from '../../../lib/constants'
import { translateTableName, translateTableStatus, useI18n } from '../../../lib/i18n'
import { formatClock } from '../../../lib/models'
import { useNow, useRestora } from '../../../lib/store'
import { slotLabel, localInputDefault } from '../shared.js'
import { RescheduleModal } from './RescheduleModal.jsx'

// The reservation book, list only — the tab strip, count and card live in
// HostDesk so both host tools share one card.
function ReservationsPanel({ onSeatRes, onError }) {
  const { state, dispatch } = useRestora()
  useNow(30000)
  const [adding, setAdding] = useState(false)
  const [reschedulingRes, setReschedulingRes] = useState(null)
  const [name, setName] = useState('')
  const [party, setParty] = useState(2)
  const [time, setTime] = useState(localInputDefault(1))
  const [tableId, setTableId] = useState('')
  const [notes, setNotes] = useState('')

  const { lang, dict } = useI18n()
  const f = dict.floor || {}
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
      const table = state.tables.find((entry) => entry.id === tableId)
      if (table && table.status === 'free') dispatch({ type: 'SET_TABLE_STATUS', tableId, to: 'reserved' })
    }
    setAdding(false)
    setName('')
    setParty(2)
    setTime(localInputDefault(1))
    setTableId('')
    setNotes('')
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant={adding ? 'secondary' : 'primary'} onClick={() => setAdding((value) => !value)}>
          {adding
            ? (f.cancel || 'Cancel')
            : (lang === 'km' ? '+ កក់តុ' : lang === 'zh' ? '+ 预订' : '+ Book')}
          {lang !== 'en' && <span className="sr-only"> {adding ? 'Cancel' : '+ Book'}</span>}
        </Button>
      </div>

      {adding && (
        <div className="mb-3 space-y-3 rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
          <Field label={f.guestName || 'Guest name'}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Carter party" maxLength={40} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={f.partySize || 'Party'}>
              <Stepper value={party} onChange={setParty} />
            </Field>
            <Field label={f.time || 'Time'}>
              <Input type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} />
            </Field>
          </div>
          <Field label="Assign table (optional)">
            <Select value={tableId} onChange={(event) => setTableId(event.target.value)}>
              <option value="">Unassigned</option>
              {state.tables
                .filter((table) => table.status === 'free')
                .map((table) => (
                  <option key={table.id} value={table.id}>
                    {translateTableName(table.name, lang)} · {table.seats} {f.seats || 'seats'}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Notes (optional)">
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Window seat, birthday" maxLength={80} />
          </Field>
          <Button block onClick={add}>
            {f.saveReservation || 'Book reservation'}
          </Button>
        </div>
      )}

      <ul className="max-h-72 space-y-2 overflow-y-auto">
        {upcoming.length === 0 && (
          <li className="rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] px-4 py-6 text-center text-[var(--fs-body)] text-[var(--text-muted)]">
            {f.noReservations || 'No upcoming reservations.'}
          </li>
        )}
        {upcoming.map((reservation) => {
          const minsUntil = Math.round((new Date(reservation.time) - Date.now()) / 60000)
          const overdue = minsUntil < -TARGETS.noShowMinutes
          const assigned = reservation.tableId ? state.tables.find((table) => table.id === reservation.tableId) : null
          return (
            <li
              key={reservation.id}
              className={`rounded-[var(--radius-xl)] p-3 ring-1 ring-inset ${
                overdue
                  ? 'bg-[var(--danger-soft)] ring-[var(--danger)]/30'
                  : 'bg-[var(--surface-raised)] ring-[var(--border-subtle)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[var(--fs-body)] font-semibold text-[var(--text-strong)]">{reservation.name}</div>
                  <div className="tnum text-[var(--fs-label)] text-[var(--text-muted)]">
                    {f.partySize || 'Party'} · {reservation.partySize} · {formatClock(reservation.time)} · {slotLabel(reservation.time)}
                  </div>
                  <div className={`text-[var(--fs-caption)] ${overdue ? 'font-semibold text-[var(--danger)]' : 'text-[var(--text-subtle)]'}`}>
                    {minsUntil >= 0 ? `in ${minsUntil}m` : `${-minsUntil}m ago`}
                    {assigned
                      ? ` · ${translateTableName(assigned.name, lang)} (${translateTableStatus(assigned.status, lang)})`
                      : ' · no table yet'}
                    {reservation.notes ? ` · ${reservation.notes}` : ''}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" className="flex-1" onClick={() => onSeatRes(reservation)}>
                  {f.seat || 'Seat'}
                </Button>
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => setReschedulingRes(reservation)}>
                  {f.reschedule || 'Reschedule'}
                </Button>
                <Button
                  size="sm"
                  variant={overdue ? 'dangerGhost' : 'secondary'}
                  className="flex-1"
                  title={overdue ? 'Overdue — mark no-show' : 'Mark no-show'}
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: reservation.id, patch: { status: 'no_show' } })}
                >
                  {f.noShow || 'No-show'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: reservation.id, patch: { status: 'cancelled' } })}
                >
                  {f.cancel || 'Cancel'}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {reschedulingRes && (
        <RescheduleModal
          reservation={reschedulingRes}
          onClose={() => setReschedulingRes(null)}
          onSaved={() => {}}
        />
      )}

      {past.length > 0 && (
        <details className="mt-2 text-[var(--fs-label)] text-[var(--text-subtle)]">
          <summary className="cursor-pointer py-2">
            Earlier: {past.length} seated / no-show / cancelled
          </summary>
          <ul className="space-y-1 pb-1">
            {past.slice(-5).reverse().map((reservation) => (
              <li key={reservation.id}>
                {reservation.name} · {reservation.partySize} · {formatClock(reservation.time)} · {reservation.status.replace('_', ' ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

export { ReservationsPanel }
