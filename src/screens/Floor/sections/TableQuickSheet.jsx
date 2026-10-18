import { useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Badge, Button, Field, Progress, Sheet, Stepper } from '../../../components/ui'
import QrModal from '../../../components/QrModal'
import { TABLE_STATUS_META } from '../../../lib/constants'
import { translateTableName, translateTableStatus, translateZone, useI18n } from '../../../lib/i18n'
import { formatClock, isSeatBlocked, minutesBetween, needsOverSeatConfirm } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { badgeToneFor } from '../shared.js'
import { TransferTableModal } from './TransferTableModal.jsx'

// One tap on a table opens this sheet: every action that table can take right
// now, ordered by how often a host reaches for it. Nothing dispatches without a
// key press — a free table used to seat itself with a guessed party size.
//
// Copy stays plain English: the phrase walker localises every label below.
function TableQuickSheet({ table, onClose, onDetails, onFlash, onError }) {
  const { state, dispatch, setScreen, setSelectedTableId } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const booked = state.reservations.find((r) => r.tableId === table.id && r.status === 'booked')
  const check = state.orders.find((o) => o.id === table.currentCheckId && !['paid', 'void'].includes(o.status))
  const [party, setParty] = useState(table.partySize || booked?.partySize || Math.min(table.seats, 4))
  const [overConfirm, setOverConfirm] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const meta = TABLE_STATUS_META[table.status] || TABLE_STATUS_META.free
  const occupied = table.status === 'seated' || table.status === 'ordered'
  const seatable = table.status === 'free' || table.status === 'available' || table.status === 'reserved'
  const overSeat = seatable && needsOverSeatConfirm(table, party)
  const mins = table.seatedAt ? minutesBetween(table.seatedAt) : 0
  const turnRatio = occupied && table.targetTurnMinutes ? mins / table.targetTurnMinutes : 0
  const longTurn = turnRatio >= 0.9

  function seat() {
    if (isSeatBlocked(table)) {
      onError?.(`${table.name} can't be seated while ${meta.label.toLowerCase()}.`, 'warning')
      return
    }
    if (overSeat && !overConfirm) return
    dispatch({
      type: 'SEAT_PARTY',
      tableId: table.id,
      partySize: party,
      reservationId: booked?.id || null,
    })
    onFlash?.(`${table.name} seated · party of ${party}`, 'success')
    onClose()
  }

  return (
    <Sheet
      title={`${translateTableName(table.name, lang)} · ${table.seats} ${f.seats || 'seats'}`}
      onClose={onClose}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge tone={badgeToneFor(table.status)} dot>
          {translateTableStatus(table.status, lang) || meta.label}
        </Badge>
        <span className="text-[var(--fs-caption)] text-[var(--text-muted)]">
          {translateZone(table.zone, lang)}
        </span>
        {occupied && (
          <span className="tnum text-[var(--fs-body)] text-[var(--text)]">
            Party of {table.partySize} · {mins}m
          </span>
        )}
        {check && <span className="text-[var(--fs-caption)] text-[var(--text-muted)]">{check.items.length} items</span>}
        {booked && (
          <span className="inline-flex items-center gap-1 text-[var(--fs-caption)] text-[var(--info)]">
            <Icon name="clock" size={12} />
            {booked.name} · {formatClock(booked.time)}
          </span>
        )}
      </div>

      {occupied && table.targetTurnMinutes > 0 && (
        <div className="mt-3">
          <Progress
            value={Math.min(100, turnRatio * 100)}
            size="sm"
            tone={longTurn ? 'warning' : 'success'}
            label={`${mins}m of ${table.targetTurnMinutes}m target turn`}
          />
        </div>
      )}

      <div className="mt-4 space-y-2">
        {seatable && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
              <Field label={f.partySize || 'Party'}>
                <Stepper
                  value={party}
                  onChange={(value) => { setParty(value); setOverConfirm(false) }}
                  min={1}
                  max={24}
                />
              </Field>
              <span className="text-[var(--fs-caption)] text-[var(--text-subtle)]">
                {table.seats} {f.seats || 'seats'}
              </span>
            </div>

            {overSeat && (
              <div className="rounded-[var(--radius-xl)] bg-[var(--warning-soft)] p-3 text-[var(--fs-body)] ring-1 ring-inset ring-[var(--warning)]/40">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
                  <Icon name="warning" size={15} />
                  Over capacity — {party} guests · {table.seats} {f.seats || 'seats'}
                </div>
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

            <Button block size="lg" onClick={seat} disabled={overSeat && !overConfirm}>
              {table.status === 'reserved' ? 'Seat reservation' : 'Seat party'}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const holding = table.status === 'reserved'
                  dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: holding ? 'free' : 'reserved' })
                  onFlash?.(holding ? `${table.name} hold released` : `${table.name} held for the next booking`, 'info')
                  onClose()
                }}
              >
                {table.status === 'reserved' ? 'Release hold' : 'Hold as reserved'}
              </Button>
              <Button variant="secondary" onClick={() => setQrOpen(true)}>
                Table QR
              </Button>
            </div>
          </>
        )}

        {occupied && (
          <>
            <Button
              block
              size="lg"
              onClick={() => {
                setSelectedTableId(table.id)
                setScreen('tickets')
                onClose()
              }}
            >
              {check ? 'Open check' : 'Start check'}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                Transfer
              </Button>
              <Button variant="secondary" onClick={() => setQrOpen(true)}>
                Table QR
              </Button>
            </div>
            <Button
              block
              variant="ghost"
              className="bg-[var(--warning-soft)] text-[var(--warning)] hover:bg-[var(--warning-soft)] hover:opacity-90"
              onClick={() => {
                // A table with an open check turns through the check, never
                // through the floor.
                if (check) {
                  onError?.('Tables turn through the check: pay on Tickets, then bus here.', 'warning')
                  return
                }
                dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'dirty', force: true })
                onClose()
              }}
            >
              Mark clean
            </Button>
          </>
        )}

        {table.status === 'billing' && (
          <Button
            block
            size="lg"
            onClick={() => {
              dispatch({ type: 'MINIAPP_RELEASE_TABLE', payload: { tableId: table.id, forceByStaff: true } })
              onFlash?.(`${table.name} settled & released`, 'success')
              onClose()
            }}
          >
            Settle &amp; release
          </Button>
        )}

        {(table.status === 'billed' || table.status === 'billing') && (
          <Button
            block
            size="lg"
            variant={table.status === 'billing' ? 'secondary' : 'primary'}
            onClick={() => {
              dispatch({ type: 'BUS_TABLE', tableId: table.id })
              onFlash?.(`${table.name} sent to bussing`, 'info')
              onClose()
            }}
          >
            Bus table
          </Button>
        )}

        {(table.status === 'dirty' || table.status === 'cleaning') && (
          <Button
            block
            size="lg"
            onClick={() => {
              dispatch({ type: 'FLOOR_MARK_TABLE_AVAILABLE', payload: { tableId: table.id } })
              onFlash?.(`${table.name} is clean & available`, 'success')
              onClose()
            }}
          >
            ✨ Mark clean &amp; available
          </Button>
        )}

        <Button block variant="secondary" onClick={() => onDetails(table.id)}>
          Details
        </Button>
      </div>

      {qrOpen && <QrModal table={table} onClose={() => setQrOpen(false)} />}
      {transferOpen && (
        <TransferTableModal
          table={table}
          onClose={() => setTransferOpen(false)}
          onTransferred={(targetName) => {
            onFlash?.(`Transferred ${table.name} ➔ ${targetName}`, 'success')
            onClose()
          }}
        />
      )}
    </Sheet>
  )
}

export { TableQuickSheet }
