import { useState } from 'react'
import QrModal from '../../../components/QrModal'
import StatusPill from '../../../components/StatusPill'
import { Modal } from '../../../components/ui'
import { TABLE_STATUS_META } from '../../../lib/constants'
import { formatClock, minutesBetween } from '../../../lib/models'
import { useNow, useRestora } from '../../../lib/store'
import { TransferTableModal } from './TransferTableModal.jsx'

function TableDetail({ table, onClose, onSeat, onError, onFlash }) {
  const { state, dispatch, setScreen, setSelectedTableId } = useRestora()
  const [qrOpen, setQrOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  useNow(15000)
  const meta = TABLE_STATUS_META[table.status]
  const mins = table.seatedAt ? minutesBetween(table.seatedAt) : 0
  const check = state.orders.find((o) => o.id === table.currentCheckId && !['paid', 'void'].includes(o.status))
  const linkedRes = state.reservations.find(
    (r) => r.tableId === table.id && r.status === 'booked',
  )

  const btn =
    'w-full rounded-lg py-2.5 text-sm font-semibold min-h-[44px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const btnPrimary = `${btn} bg-amber-500 text-black hover:bg-amber-400`
  const btnGhost = `${btn} border border-[var(--color-ink-600)] text-zinc-200 hover:bg-white/5`

  return (
    <Modal
      title={`${table.name} · ${table.seats} seats`}
      sub={`${table.zone} · target turn ${table.targetTurnMinutes}m`}
      onClose={onClose}
    >
      <div className="mt-3 flex items-center gap-2">
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        {(table.status === 'seated' || table.status === 'ordered') && (
          <span className="tnum text-sm text-zinc-300">
            Party of {table.partySize} · {mins}m seated
          </span>
        )}
        {linkedRes && (
          <span className="text-xs text-zinc-400">
            Reserved: {linkedRes.name} · {linkedRes.partySize} · {formatClock(linkedRes.time)}
          </span>
        )}
      </div>

      {table.pendingTransfer && table.pendingTransfer.status === 'pending' && (
        <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 text-amber-200">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-100">
            <span>🔄</span> Move requested to Table {table.pendingTransfer.targetTableName || table.pendingTransfer.targetTableId}
          </div>
          <div className="mt-1 text-xs text-amber-300/80">
            Reason: {table.pendingTransfer.reason}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-bold text-black hover:bg-amber-400"
              onClick={() => {
                dispatch({
                  type: 'APPROVE_TABLE_TRANSFER',
                  payload: { currentTableId: table.id, targetTableId: table.pendingTransfer.targetTableId },
                })
                onFlash?.(`Approved move to ${table.pendingTransfer.targetTableName || table.pendingTransfer.targetTableId}`)
                onClose()
              }}
            >
              Approve move
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg border border-amber-500/40 py-2 text-xs font-semibold text-amber-200 hover:bg-white/5"
              onClick={() => {
                dispatch({
                  type: 'REJECT_TABLE_TRANSFER',
                  payload: { currentTableId: table.id, reason: 'Declined by floor host' },
                })
                onFlash?.(`Declined move request for ${table.name}`)
                onClose()
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {(table.status === 'free' || table.status === 'reserved') && (
          <>
            <button type="button" className={btnPrimary} onClick={() => { onClose(); onSeat(table.id) }}>
              Seat party
            </button>
            {table.status === 'free' ? (
              <button
                type="button"
                className={btnGhost}
                onClick={() => { dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'reserved' }); onClose() }}
              >
                Hold as reserved
              </button>
            ) : (
              <button
                type="button"
                className={btnGhost}
                onClick={() => { dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'free' }); onClose() }}
              >
                Release hold → free
              </button>
            )}
          </>
        )}

        {(table.status === 'seated' || table.status === 'ordered') && (
          <>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setSelectedTableId(table.id)
                setScreen('tickets')
                onClose()
              }}
            >
              {check ? `Open check · ${check.items.length} item${check.items.length === 1 ? '' : 's'}` : 'Start check'}
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => setTransferOpen(true)}
            >
              🔄 Move / Transfer Table
            </button>
            <p className="text-center text-[11px] text-zinc-500">
              Billing happens on Tickets — the table follows the check.
            </p>
          </>
        )}

        {table.status === 'billed' && (
        <button
          type="button"
          className={btnPrimary}
          onClick={() => { dispatch({ type: 'BUS_TABLE', tableId: table.id }); onClose() }}
        >
            Bus table → dirty
          </button>
        )}

        {table.status === 'billing' && (
          <button
            type="button"
            className={btnPrimary}
            onClick={() => {
              dispatch({
                type: 'MINIAPP_RELEASE_TABLE',
                payload: { tableId: table.id, forceByStaff: true },
              })
              onClose()
            }}
          >
            💳 Settle & Release Table
          </button>
        )}

        {(table.status === 'cleaning' || table.status === 'dirty') && (
          <button
            type="button"
            className={btnPrimary}
            onClick={() => {
              dispatch({ type: 'FLOOR_MARK_TABLE_AVAILABLE', payload: { tableId: table.id } })
              onClose()
            }}
          >
            ✨ Mark Clean & Available
          </button>
        )}

        {(table.status === 'ordered' || table.status === 'billed') && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => onError('Tables turn through the check: pay on Tickets, then bus here.')}
          >
            Why can&apos;t I free this table?
          </button>
        )}

        <button type="button" className={btnGhost} onClick={() => setQrOpen(true)}>
          📱 Table QR code
        </button>
      </div>
      {qrOpen && <QrModal table={table} onClose={() => setQrOpen(false)} />}
      {transferOpen && (
        <TransferTableModal
          table={table}
          onClose={() => setTransferOpen(false)}
          onTransferred={(targetName) => {
            onFlash?.(`Transferred ${table.name} ➔ ${targetName}`)
            onClose()
          }}
        />
      )}
    </Modal>
  )
}


export { TableDetail }
