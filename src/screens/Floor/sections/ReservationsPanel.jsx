import { useState } from 'react'
import { Button, Card, Field, Input, SectionHeader, Select, Stepper } from '../../../components/ui'
import { TARGETS } from '../../../lib/constants'
import { translateTableName, translateTableStatus, useI18n } from '../../../lib/i18n'
import { formatClock } from '../../../lib/models'
import { useNow, useRestora } from '../../../lib/store'
import { slotLabel, localInputDefault } from '../shared.js'
import { RescheduleModal } from './RescheduleModal.jsx'

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
    <Card inset>
      <SectionHeader
        title={`${f.reservations || 'Reservations'} · ${upcoming.length} ${f.booked || 'booked'}`}
        actions={(
          <Button size="sm" variant={adding ? 'secondary' : 'primary'} onClick={() => setAdding((v) => !v)}>
            {adding ? (f.cancel || 'Cancel') : (lang === 'km' ? '+ កក់តុ' : lang === 'zh' ? '+ 预订' : '+ Book')}
          </Button>
        )}
      />

      {adding && (
        <div className="mb-3 space-y-3 rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
          <Field label={f.guestName || 'Name'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carter party" maxLength={40} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={f.partySize || 'Party'}>
              <Stepper value={party} onChange={setParty} />
            </Field>
            <Field label={f.time || 'Time'}>
              <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Assign table (optional)">
            <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Unassigned</option>
              {state.tables
                .filter((t) => t.status === 'free')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {translateTableName(t.name, lang)} · {t.seats} {f.seats || 'seats'}
                  </option>
                ))}
            </Select>
          </Field>
          <Button block onClick={add}>
            {f.saveReservation || 'Book reservation'}
          </Button>
        </div>
      )}

      <ul className="max-h-72 space-y-2 overflow-y-auto">
        {upcoming.length === 0 && <li className="text-[var(--fs-body)] text-[var(--text-muted)]">{f.noReservations || 'No upcoming reservations.'}</li>}
        {upcoming.map((r) => {
          const minsUntil = Math.round((new Date(r.time) - Date.now()) / 60000)
          const overdue = minsUntil < -TARGETS.noShowMinutes
          const assigned = r.tableId ? state.tables.find((t) => t.id === r.tableId) : null
          return (
            <li
              key={r.id}
              className={`rounded-[var(--radius-xl)] p-3 ring-1 ring-inset ${
                overdue
                  ? 'bg-[var(--danger-soft)] ring-[var(--danger)]/30'
                  : 'bg-[var(--surface-raised)] ring-[var(--border-subtle)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[var(--fs-body)] font-semibold text-[var(--text-strong)]">{r.name}</div>
                  <div className="text-[var(--fs-label)] text-[var(--text-muted)]">
                    {f.partySize || 'Party'} · {r.partySize} · {formatClock(r.time)} · {slotLabel(r.time)}
                  </div>
                  <div className={`text-[var(--fs-caption)] ${overdue ? 'font-semibold text-[var(--danger)]' : 'text-[var(--text-subtle)]'}`}>
                    {minsUntil >= 0 ? `in ${minsUntil}m` : `${-minsUntil}m ago`}
                    {assigned ? ` · ${translateTableName(assigned.name, lang)} (${translateTableStatus(assigned.status, lang)})` : ' · no table yet'}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" className="flex-1" onClick={() => onSeatRes(r)}>
                  {f.seat || 'Seat'}
                </Button>
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => setReschedulingRes(r)}>
                  {dict.common?.reschedule || 'Reschedule'}
                </Button>
                <Button
                  size="sm"
                  variant={overdue ? 'dangerGhost' : 'secondary'}
                  className="flex-1"
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: r.id, patch: { status: 'no_show' } })}
                  title={overdue ? 'Overdue — mark no-show' : 'Mark no-show'}
                >
                  {f.noShow || 'No-show'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: r.id, patch: { status: 'cancelled' } })}
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
    </Card>
  )
}


export { ReservationsPanel }
