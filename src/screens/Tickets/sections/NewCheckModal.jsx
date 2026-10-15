import { useState } from 'react'
import { Field, Modal, btnPrimary, inputCls } from '../../../components/ui'
import { uid } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { ORDER_TYPES, ORDER_TYPE_LABEL, openOrderForTable } from '../shared.js'

function NewCheckModal({ onClose, onCreated }) {
  const { state, dispatch } = useRestora()
  const candidates = state.tables.filter(
    (t) => (t.status === 'seated' || t.status === 'ordered') && !openOrderForTable(state.orders, t.id),
  )
  const [orderType, setOrderType] = useState('dine_in')
  const [tableId, setTableId] = useState(candidates[0]?.id || '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [fee, setFee] = useState('2.00')
  const [eta, setEta] = useState('')
  const [error, setError] = useState('')

  const offTable = orderType !== 'dine_in'

  function start() {
    const orderId = uid('o')
    if (orderType === 'dine_in') {
      if (!tableId) {
        setError('Pick a seated table.')
        return
      }
      dispatch({ type: 'CREATE_ORDER', id: orderId, tableId })
    } else {
      if (!name.trim()) {
        setError('Add a customer name.')
        return
      }
      dispatch({
        type: 'CREATE_ORDER',
        id: orderId,
        orderType,
        customer: { name, phone, address: orderType === 'delivery' ? address : '' },
        deliveryFee: orderType === 'delivery' ? Number(fee) || 0 : 0,
        eta: eta ? new Date(eta).toISOString() : null,
      })
    }
    onCreated(orderId)
  }

  return (
    <Modal
      title="New check"
      sub={offTable ? 'Start a takeout or delivery order — no table needed.' : 'Attach a ticket to a seated table.'}
      onClose={onClose}
    >
      <div className="mt-3 space-y-4">
        <div className="flex gap-1.5 rounded-xl bg-[var(--color-ink-800)] p-1.5 ring-1 ring-inset ring-[var(--color-ink-600)]" role="group" aria-label="Order type">
          {ORDER_TYPES.map((t) => (
            <button
              key={t.id}
              data-testid={`order-type-${t.id}`}
              type="button"
              onClick={() => { setOrderType(t.id); setError('') }}
              aria-pressed={orderType === t.id}
              className={`min-h-[40px] flex-1 rounded-lg text-sm font-semibold transition-colors ${orderType === t.id ? 'bg-amber-500 text-black' : 'text-zinc-300 hover:bg-white/5'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {orderType === 'dine_in' ? (
          candidates.length ? (
            <Field label="Table">
              <select value={tableId} onChange={(e) => setTableId(e.target.value)} className={inputCls}>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · party of {t.partySize} · {t.status}</option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-zinc-400">
              No seated tables are waiting for a check. Seat a party on the Floor, or start a takeout/delivery order.
            </p>
          )
        ) : (
          <>
            <Field label="Customer name">
              <input value={name} onChange={(e) => { setName(e.target.value); setError('') }} placeholder="Ava Chen" className={inputCls} maxLength={60} aria-label="Customer name" autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="012 345 678" className={inputCls} maxLength={30} />
              </Field>
              <Field label="ETA / pickup time">
                <input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} className={inputCls} />
              </Field>
            </div>
            {orderType === 'delivery' && (
              <>
                <Field label="Delivery address">
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 Riverside Rd" className={inputCls} maxLength={160} />
                </Field>
                <Field label="Delivery fee">
                  <input type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} />
                </Field>
              </>
            )}
          </>
        )}

        {error && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-inset ring-red-500/30" role="alert">
            {error}
          </div>
        )}

        <button
          type="button"
          className={btnPrimary}
          onClick={start}
          aria-label="Start check"
          disabled={orderType === 'dine_in' && !candidates.length}
        >
          {orderType === 'dine_in' ? 'Start check' : `Start ${ORDER_TYPE_LABEL[orderType].toLowerCase()} order`}
        </button>
      </div>
    </Modal>
  )
}

// ─── Off-table order details ────────────────────────────────────


export { NewCheckModal }
