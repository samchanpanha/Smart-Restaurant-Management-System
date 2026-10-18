import { useMemo, useState } from 'react'
import { Button, Field, Input, Modal, Select, Stepper } from '../../../components/ui'
import { translateTableName, useI18n } from '../../../lib/i18n'
import { findAvailableTablesForSlot } from '../../../lib/models'
import { useRestora } from '../../../lib/store'

function RescheduleModal({ reservation, onClose, onSaved }) {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const [party, setParty] = useState(reservation.partySize || 2)
  const [time, setTime] = useState(() => {
    const d = new Date(reservation.time)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [tableId, setTableId] = useState(reservation.tableId || '')
  const [error, setError] = useState('')

  const availableTables = useMemo(() => {
    try {
      return findAvailableTablesForSlot(state, {
        date: time ? time.slice(0, 10) : new Date().toISOString().slice(0, 10),
        time: new Date(time).toISOString(),
        partySize: party,
        excludeBookingId: reservation.id,
      })
    } catch {
      return []
    }
  }, [state, time, party, reservation.id])

  function handleSave() {
    try {
      const isoTime = new Date(time).toISOString()
      dispatch({
        type: 'RESCHEDULE_BOOKING',
        payload: {
          bookingId: reservation.id,
          newTime: isoTime,
          newDate: time.slice(0, 10),
          newPartySize: party,
          preferredTableId: tableId || null,
          actor: 'staff',
        },
      })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Could not reschedule reservation.')
    }
  }

  return (
    <Modal
      title={`Reschedule · ${reservation.name}`}
      sub="Update reservation date, time, party size, or assigned table."
      onClose={onClose}
    >
      <div className="mt-3 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.partySize || 'Party'}>
            <Stepper value={party} onChange={setParty} />
          </Field>
          <Field label={f.time || 'Time'}>
            <Input
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Assign table (optional)">
          <Select
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            aria-label="Assign table"
          >
            <option value="">Auto-assign or Unassigned</option>
            {availableTables.map((t) => (
              <option key={t.id} value={t.id}>
                {translateTableName(t.name, lang)} · {t.seats} {f.seats || 'seats'}
              </option>
            ))}
          </Select>
        </Field>

        {error && (
          <div className="rounded-[var(--radius-lg)] bg-[var(--danger-soft)] px-3 py-2 text-[var(--fs-body)] text-[var(--danger)] ring-1 ring-inset ring-[var(--danger)]/30" role="alert">
            {error}
          </div>
        )}

        <Button block size="lg" onClick={handleSave}>
          Save Changes
        </Button>
      </div>
    </Modal>
  )
}


export { RescheduleModal }
