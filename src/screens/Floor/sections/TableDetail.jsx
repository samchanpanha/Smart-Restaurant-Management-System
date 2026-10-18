import { useState } from 'react'
import QrModal from '../../../components/QrModal'
import { Badge, Button, Modal } from '../../../components/ui'
import { formatClock, minutesBetween } from '../../../lib/models'
import { useI18n } from '../../../lib/i18n'
import { useNow, useRestora } from '../../../lib/store'
import { badgeToneFor, statusLabel } from '../shared.js'
import { TransferTableModal } from './TransferTableModal.jsx'

function TableDetail({ table, onClose, onSeat, onError, onFlash }) {
  const { state, dispatch, setScreen, setSelectedTableId } = useRestora()
  const { lang } = useI18n()
  const [qrOpen, setQrOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  useNow(15000)
  const mins = table.seatedAt ? minutesBetween(table.seatedAt) : 0
  const check = state.orders.find((o) => o.id === table.currentCheckId && !['paid', 'void'].includes(o.status))
  const linkedRes = state.reservations.find(
    (r) => r.tableId === table.id && r.status === 'booked',
  )

  return (
    <Modal
      title={`${table.name} · ${table.seats} seats`}
      sub={`${table.zone} · target turn ${table.targetTurnMinutes}m`}
      onClose={onClose}
    >
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={badgeToneFor(table.status)} dot>
          {statusLabel(table.status, lang)}
        </Badge>
        {(table.status === 'seated' || table.status === 'ordered') && (
          <span className="tnum text-[var(--fs-body)] text-[var(--text)]">
            Party of {table.partySize} · {mins}m seated
          </span>
        )}
        {linkedRes && (
          <span className="text-[var(--fs-label)] text-[var(--text-muted)]">
            Reserved: {linkedRes.name} · {linkedRes.partySize} · {formatClock(linkedRes.time)}
          </span>
        )}
      </div>

      {table.pendingTransfer && table.pendingTransfer.status === 'pending' && (
        <div className="mt-3 rounded-[var(--radius-xl)] border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3">
          <div className="flex items-center gap-2 text-[var(--fs-body)] font-bold text-[var(--warning)]">
            <span>🔄</span> Move requested to Table {table.pendingTransfer.targetTableName || table.pendingTransfer.targetTableId}
          </div>
          <div className="mt-1 text-[var(--fs-label)] text-[var(--text-muted)]">
            Reason: {table.pendingTransfer.reason}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                dispatch({
                  type: 'APPROVE_TABLE_TRANSFER',
                  payload: { currentTableId: table.id, targetTableId: table.pendingTransfer.targetTableId },
                })
                onFlash?.(`Approved move to ${table.pendingTransfer.targetTableName || table.pendingTransfer.targetTableId}`, 'success')
                onClose()
              }}
            >
              Approve move
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => {
                dispatch({
                  type: 'REJECT_TABLE_TRANSFER',
                  payload: { currentTableId: table.id, reason: 'Declined by floor host' },
                })
                onFlash?.(`Declined move request for ${table.name}`, 'warning')
                onClose()
              }}
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {(table.status === 'free' || table.status === 'reserved') && (
          <>
            <Button block size="lg" onClick={() => { onClose(); onSeat(table.id) }}>
              Seat party
            </Button>
            {table.status === 'free' ? (
              <Button
                block
                variant="secondary"
                onClick={() => { dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'reserved' }); onClose() }}
              >
                Hold as reserved
              </Button>
            ) : (
              <Button
                block
                variant="secondary"
                onClick={() => { dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'free' }); onClose() }}
              >
                Release hold → free
              </Button>
            )}
          </>
        )}

        {(table.status === 'seated' || table.status === 'ordered') && (
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
              {check ? `Open check · ${check.items.length} item${check.items.length === 1 ? '' : 's'}` : 'Start check'}
            </Button>
            <Button
              block
              variant="secondary"
              onClick={() => setTransferOpen(true)}
            >
              🔄 Move / Transfer Table
            </Button>
            <p className="text-center text-[var(--fs-caption)] text-[var(--text-subtle)]">
              Billing happens on Tickets — the table follows the check.
            </p>
          </>
        )}

        {table.status === 'billed' && (
          <Button
            block
            size="lg"
            onClick={() => { dispatch({ type: 'BUS_TABLE', tableId: table.id }); onClose() }}
          >
            Bus table → dirty
          </Button>
        )}

        {table.status === 'billing' && (
          <Button
            block
            size="lg"
            onClick={() => {
              dispatch({
                type: 'MINIAPP_RELEASE_TABLE',
                payload: { tableId: table.id, forceByStaff: true },
              })
              onClose()
            }}
          >
            💳 Settle &amp; Release Table
          </Button>
        )}

        {(table.status === 'cleaning' || table.status === 'dirty') && (
          <Button
            block
            size="lg"
            onClick={() => {
              dispatch({ type: 'FLOOR_MARK_TABLE_AVAILABLE', payload: { tableId: table.id } })
              onClose()
            }}
          >
            ✨ Mark Clean &amp; Available
          </Button>
        )}

        {(table.status === 'ordered' || table.status === 'billed') && (
          <Button
            block
            variant="secondary"
            onClick={() => onError('Tables turn through the check: pay on Tickets, then bus here.')}
          >
            Why can&apos;t I free this table?
          </Button>
        )}

        <Button block variant="secondary" onClick={() => setQrOpen(true)}>
          📱 Table QR code
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
    </Modal>
  )
}


export { TableDetail }
