import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
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
          <div className="flex items-center gap-2 rounded-[var(--radius-xl)] bg-[var(--warning-soft)] p-4 text-[var(--fs-body)] text-[var(--warning)]">
            <Icon name="warning" size={16} />
            No tables are currently free or available to transfer to.
          </div>
        ) : (
          <>
            <Field label="Target Table">
              <Select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                aria-label="Target table"
              >
                {availableTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {translateTableName(t.name, lang)} · {t.seats} seats · {t.zone}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason (optional)">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Guest requested quieter booth"
                maxLength={60}
              />
            </Field>
            <Button block size="lg" onClick={handleTransfer}>
              Confirm Transfer
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}


export { TransferTableModal }
