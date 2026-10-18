import { useState } from 'react'
import { Badge, Button, Field, Modal, Stepper } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
import { TABLE_STATUS_META } from '../../../lib/constants'
import { translateTableName, useI18n } from '../../../lib/i18n'
import { isSeatBlocked, needsOverSeatConfirm } from '../../../lib/models'
import { statusLabel } from '../shared.js'
import { useRestora } from '../../../lib/store'

// Seat a party at a chosen table. The picker is a grid of real tables, not a
// native select: every option shows its seats, zone and status, and the ones
// that fit the party are marked — a host seating a booking sees the fit at a
// glance instead of reading a dropdown.
function SeatDialog({ tableId, initialParty = 2, reservationId = null, waitlistId = null, onClose, onError }) {
  const { state, dispatch } = useRestora()
  const { lang } = useI18n()
  const seatable = state.tables.filter((table) => table.status === 'free' || table.status === 'reserved')
  const [party, setParty] = useState(initialParty)
  const [chosenTableId, setChosenTableId] = useState(() => {
    if (tableId && seatable.some((table) => table.id === tableId)) return tableId
    // Prefer the first table that actually fits the party.
    const fitting = seatable.find((table) => table.seats >= initialParty)
    return fitting?.id || seatable[0]?.id || ''
  })
  const [source, setSource] = useState(reservationId ? 'phone' : 'walk_in')
  const [overConfirm, setOverConfirm] = useState(false)

  const table = state.tables.find((entry) => entry.id === chosenTableId)
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
      title="Seat party"
      sub={reservationId ? 'Seating from reservation book' : waitlistId ? 'Seating from waitlist' : 'Walk-in seating'}
      onClose={onClose}
    >
      <div className="mt-4 space-y-4">
        <Field label="Table">
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-3" role="group" aria-label="Table">
            {seatable.map((option) => {
              const active = option.id === chosenTableId
              const fits = option.seats >= party
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setChosenTableId(option.id); setOverConfirm(false) }}
                  className={`flex flex-col items-start gap-1 rounded-[var(--radius-lg)] border p-2.5 text-left transition-colors ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-2 ring-[var(--accent-soft)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]'
                  }`}
                >
                  <span className="flex w-full items-center justify-between gap-1">
                    <span className="truncate text-[var(--fs-body)] font-bold text-[var(--text-strong)]">{translateTableName(option.name, lang)}</span>
                    {fits
                      ? <Badge tone="success">Fits</Badge>
                      : <span className="tnum shrink-0 text-[var(--fs-caption)] font-semibold text-[var(--warning)]">{option.seats} seats</span>}
                  </span>
                  <span className="text-[var(--fs-caption)] text-[var(--text-muted)]">
                    {option.seats} seats · {option.zone}
                  </span>
                  <span className="text-[var(--fs-caption)] text-[var(--text-subtle)]">
                    {statusLabel(option.status, lang)}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <Field label="Party size">
            <Stepper value={party} onChange={(value) => { setParty(value); setOverConfirm(false) }} min={1} max={24} />
          </Field>
          <div className="flex items-center gap-2" role="group" aria-label="Party source">
            {(['walk_in', 'phone', 'online']).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={source === option}
                onClick={() => setSource(option)}
                className={`min-h-11 rounded-full border px-3 text-[var(--fs-label)] font-semibold transition-colors ${
                  source === option
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                {option === 'walk_in' ? 'Walk-in' : option === 'phone' ? 'Phone' : 'Online'}
              </button>
            ))}
          </div>
        </div>

        {overSeat && (
          <div className="rounded-[var(--radius-xl)] bg-[var(--warning-soft)] p-3.5 text-[var(--fs-body)] ring-1 ring-inset ring-[var(--warning)]/40">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
              <Icon name="warning" size={15} />
              Over capacity: party of {party} on a {table.seats}-top.
            </div>
            <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">
              Host confirm required. The squeeze is on you, Alex.
            </p>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-[var(--text)]">
              <input
                type="checkbox"
                checked={overConfirm}
                onChange={(event) => setOverConfirm(event.target.checked)}
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
          {`Seat party${table ? ` · ${table.name}` : ''}`}
        </Button>
      </div>
    </Modal>
  )
}

export { SeatDialog }
