import { useMemo, useState } from 'react'
import { Field, Modal, Stepper, inputCls } from '../../../components/ui'
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
            <input
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Assign table (optional)">
          <select
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            className={inputCls}
          >
            <option value="">Auto-assign or Unassigned</option>
            {availableTables.map((t) => (
              <option key={t.id} value={t.id}>
                {translateTableName(t.name, lang)} · {t.seats} {f.seats || 'seats'}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-inset ring-red-500/30" role="alert">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="min-h-[44px] w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
        >
          Save Changes
        </button>
      </div>
    </Modal>
  )
}


export { RescheduleModal }
