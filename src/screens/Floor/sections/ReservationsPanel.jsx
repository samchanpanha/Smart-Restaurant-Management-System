import { useState } from 'react'
import { Field, Stepper, inputCls } from '../../../components/ui'
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
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          {f.reservations || 'Reservations'} · {upcoming.length} {f.booked || 'booked'}
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="min-h-[44px] rounded-lg border border-[var(--color-ink-600)] px-3 text-sm text-zinc-200 hover:bg-white/5"
        >
          {adding ? (f.cancel || 'Cancel') : (lang === 'km' ? '+ កក់តុ' : lang === 'zh' ? '+ 预订' : '+ Book')}
        </button>
      </div>

      {adding && (
        <div className="mt-3 space-y-3 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <Field label={f.guestName || 'Name'}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carter party" className={inputCls} maxLength={40} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={f.partySize || 'Party'}>
              <Stepper value={party} onChange={setParty} />
            </Field>
            <Field label={f.time || 'Time'}>
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
                    {translateTableName(t.name, lang)} · {t.seats} {f.seats || 'seats'}
                  </option>
                ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={add}
            className="min-h-[44px] w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
          >
            {f.saveReservation || 'Book reservation'}
          </button>
        </div>
      )}

      <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
        {upcoming.length === 0 && <li className="text-sm text-zinc-500">{f.noReservations || 'No upcoming reservations.'}</li>}
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
                    {f.partySize || 'Party'} · {r.partySize} · {formatClock(r.time)} · {slotLabel(r.time)}
                  </div>
                  <div className={`text-[11px] ${overdue ? 'font-semibold text-red-300' : 'text-zinc-500'}`}>
                    {minsUntil >= 0 ? `in ${minsUntil}m` : `${-minsUntil}m ago`}
                    {assigned ? ` · ${translateTableName(assigned.name, lang)} (${translateTableStatus(assigned.status, lang)})` : ' · no table yet'}
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
                  {f.seat || 'Seat'}
                </button>
                <button
                  type="button"
                  onClick={() => setReschedulingRes(r)}
                  className="min-h-[44px] flex-1 rounded-lg border border-amber-500/50 px-2 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/10"
                >
                  {dict.common?.reschedule || 'Reschedule'}
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: r.id, patch: { status: 'no_show' } })}
                  title={overdue ? 'Overdue — mark no-show' : 'Mark no-show'}
                  className={`min-h-[44px] flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-white/5 ${
                    overdue ? 'border-red-500/50 text-red-300' : 'border-[var(--color-ink-600)] text-zinc-300'
                  }`}
                >
                  {f.noShow || 'No-show'}
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_RESERVATION', id: r.id, patch: { status: 'cancelled' } })}
                  className="min-h-[44px] flex-1 rounded-lg border border-[var(--color-ink-600)] px-2 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
                >
                  {f.cancel || 'Cancel'}
                </button>
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


export { ReservationsPanel }
