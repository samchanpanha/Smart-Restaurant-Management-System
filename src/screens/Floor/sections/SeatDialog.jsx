import { useState } from 'react'
import { Field, Modal, Stepper, inputCls } from '../../../components/ui'
import { TABLE_STATUS_META } from '../../../lib/constants'
import { isSeatBlocked, needsOverSeatConfirm } from '../../../lib/models'
import { useRestora } from '../../../lib/store'

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


export { SeatDialog }
