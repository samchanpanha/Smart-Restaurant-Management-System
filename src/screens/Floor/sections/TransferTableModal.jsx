import { useState } from 'react'
import { Field, Modal, inputCls } from '../../../components/ui'
import { translateTableName, useI18n } from '../../../lib/i18n'
import { useRestora } from '../../../lib/store'

function TransferTableModal({ table, onClose, onTransferred }) {
  const { state, dispatch } = useRestora()
  const { lang } = useI18n()
  const availableTables = state.tables.filter(
    (t) => t.id !== table.id && (t.status === 'free' || t.status === 'available'),
  )
  const [targetId, setTargetId] = useState(availableTables[0]?.id || '')
  const [reason, setReason] = useState('')

  function handleTransfer() {
    if (!targetId) return
    const targetTable = state.tables.find((t) => t.id === targetId)
    dispatch({
      type: 'TRANSFER_TABLE',
      payload: {
        currentTableId: table.id,
        targetTableId: targetId,
        reason: reason.trim() || 'Floor staff transfer',
        actor: 'staff',
      },
    })
    onTransferred?.(targetTable ? targetTable.name : targetId)
    onClose()
  }

  return (
    <Modal
      title={`Transfer ${table.name}`}
      sub={`Move party (${table.partySize || table.seats} guests) and active order to another table.`}
      onClose={onClose}
    >
      <div className="mt-3 space-y-4">
        {availableTables.length === 0 ? (
          <div className="rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200">
            No tables are currently free or available to transfer to.
          </div>
        ) : (
          <>
            <Field label="Target Table">
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className={inputCls}
              >
                {availableTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {translateTableName(t.name, lang)} · {t.seats} seats · {t.zone}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason (optional)">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Guest requested quieter booth"
                className={inputCls}
                maxLength={60}
              />
            </Field>
            <button
              type="button"
              onClick={handleTransfer}
              className="min-h-[44px] w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
            >
              Confirm Transfer
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}


export { TransferTableModal }
