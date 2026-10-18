import { useState } from 'react'
import { Button, Field, Modal, Stepper, inputCls } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
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
      onError(`${table.name} can't be seated while ${TABLE_STATUS_META[table.status].label.toLowerCase()}.`, 'warning')
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
        <p className="text-[var(--fs-body)] text-[var(--text-muted)]">
          Every table is occupied, billed, or dirty. Bus a dirty table or add the party to the
          waitlist with an honest quoted wait.
        </p>
        <Button block variant="secondary" className="mt-4" onClick={onClose}>
          Back to floor
        </Button>
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
        <div className="flex flex-wrap items-end justify-between gap-4">
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
          <div className="rounded-[var(--radius-xl)] bg-[var(--warning-soft)] p-3.5 text-[var(--fs-body)] ring-1 ring-inset ring-[var(--warning)]/40">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
              <Icon name="warning" size={15} />
              Over capacity: party of {party} on a {table.seats}-top.
            </div>
            <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">
              Host confirm required. The squeeze is on you, Alex.
            </p>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-[var(--fs-body)] text-[var(--text)]">
              <input
                type="checkbox"
                checked={overConfirm}
                onChange={(e) => setOverConfirm(e.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              Seat anyway — I take responsibility
            </label>
          </div>
        )}

        <Button
          block
          size="lg"
          onClick={seat}
          disabled={!table || (overSeat && !overConfirm)}
        >
          Seat party{table ? ` · ${table.name}` : ''}
        </Button>
      </div>
    </Modal>
  )
}


export { SeatDialog }
