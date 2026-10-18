// ─── Guest check-out sheet ──────────────────────────────────────────
// Two methods only: the restaurant's static QR, or cash. There is no
// card processor in the guest surface. The tip rides on the QR amount;
// a cash guest settles (and tips) with the server or rider.

import { useMemo, useState } from 'react'
import { Sheet } from '../../../components/ui'
import { money, orderCharges } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { QrPaymentPanel } from './QrPaymentPanel.jsx'

const cardCls = (active) => [
  'flex min-h-[54px] w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left transition',
  active
    ? 'border-stone-900 bg-stone-900 text-white shadow-sm'
    : 'border-stone-200 bg-white text-stone-900 hover:bg-stone-50',
].join(' ')

export function GuestPaymentSheet({ order, guestToken = null, onClose, onDone = null }) {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const charges = orderCharges(order, menuById, state.settings || {})
  const payments = state.settings?.payments || {}
  const pos = state.settings?.pos || {}
  const qrReady = payments.qrEnabled !== false && Boolean(payments.qrImageUrl)
  const cashReady = payments.cashEnabled !== false
  const isDineIn = !['takeout', 'delivery'].includes(order.type)
  const [method, setMethod] = useState(qrReady ? 'qr' : 'cash')
  const [tipPct, setTipPct] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [done, setDone] = useState(false)

  const presets = (Array.isArray(pos.tipPresets) ? pos.tipPresets : [0.15, 0.18, 0.2, 0.25])
    .map((value) => Math.round(Number(value) * 100))
    .filter((value) => value > 0 && value <= 50)
    .slice(0, 5)
  const tip = method === 'qr' && pos.tipsEnabled !== false
    ? (customTip !== '' ? Math.max(0, Number(customTip) || 0) : Math.round((charges.subtotal * tipPct) / 100 * 100) / 100)
    : 0
  const finalTotal = Math.round((charges.total + tip) * 100) / 100
  const cashLabel = isDineIn
    ? 'Cash at the table'
    : order.type === 'delivery'
      ? (pos.payAtDoor === false ? 'Cash at the counter' : 'Cash at the door')
      : (pos.payAtPickup === false ? 'Cash at the counter' : 'Cash at pickup')

  function chooseCash() {
    if (done) return
    setMethod('cash')
    dispatch({ type: 'SET_PAYMENT_PREFERENCE', orderId: order.id, preference: 'cash', guestToken })
    if (isDineIn) dispatch({ type: 'REQUEST_BILL', orderId: order.id })
    setDone(true)
  }

  if (done) {
    return (
      <Sheet onClose={onClose} label="Payment">
        <div className="py-2 text-center" data-testid="guest-cash-confirmed">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <span className="text-2xl" aria-hidden="true">💵</span>
          </div>
          <h2 className="mt-3 text-xl font-extrabold text-stone-900">
            {isDineIn ? 'Server notified' : 'Pay in cash'}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-stone-500">
            {isDineIn
              ? 'Your server is on the way with the bill. Pay cash at the table when they arrive.'
              : order.type === 'delivery'
                ? (pos.payAtDoor === false
                  ? 'Pay at the counter before the rider leaves.'
                  : 'Pay the rider when your food arrives. The total is shown in Orders.')
                : (pos.payAtPickup === false
                  ? 'Pay at the counter when you arrive.'
                  : 'Pay at the counter when you collect your order.')}
          </p>
          <p className="tnum mt-3 text-2xl font-black text-stone-900">{money(charges.total)}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 min-h-[48px] w-full rounded-2xl bg-stone-900 text-sm font-extrabold text-white"
          >
            Done
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose} label="Payment" tall>
      <div data-testid="guest-payment-sheet">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">Payment</p>
            <h2 className="mt-0.5 text-xl font-extrabold text-stone-900">Settle your check</h2>
          </div>
          <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600">
            {money(charges.total)}
          </span>
        </div>

        <ul className="mt-4 max-h-32 space-y-1 overflow-y-auto text-sm">
          {charges.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-3 text-stone-700">
              <span className="min-w-0">{line.qty}× {line.name}</span>
              <span className="tnum shrink-0 font-bold">{money(line.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between text-stone-500"><span>Subtotal</span><span className="tnum">{money(charges.subtotal)}</span></div>
          {charges.delivery > 0 && <div className="flex justify-between text-stone-500"><span>Delivery fee</span><span className="tnum">{money(charges.delivery)}</span></div>}
          <div className="flex justify-between text-stone-500"><span>Tax</span><span className="tnum">{money(charges.tax)}</span></div>
          {tip > 0 && (
            <div className="flex justify-between font-semibold text-amber-700">
              <span>Tip</span>
              <span className="tnum">+{money(tip)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-black text-stone-900">
            <span>Total due</span>
            <span className="tnum text-amber-600">{money(finalTotal)}</span>
          </div>
        </div>

        <div className="mt-4 text-xs font-bold uppercase tracking-widest text-stone-500">How would you like to pay?</div>
        <div className="mt-1.5 space-y-2">
          {qrReady && (
            <button
              type="button"
              onClick={() => setMethod('qr')}
              aria-pressed={method === 'qr'}
              data-testid="payment-method-qr"
              className={cardCls(method === 'qr')}
            >
              <span className="min-w-0">
                <span className="block text-sm font-extrabold">QR transfer</span>
                <span className={`mt-0.5 block text-[11px] ${method === 'qr' ? 'text-white/65' : 'text-stone-500'}`}>
                  Scan {payments.qrLabel || 'the restaurant QR'} with your bank app
                </span>
              </span>
              <span className="shrink-0 text-lg" aria-hidden="true">▦</span>
            </button>
          )}
          {cashReady && (
            <button
              type="button"
              onClick={() => setMethod('cash')}
              aria-pressed={method === 'cash'}
              data-testid="payment-method-cash"
              className={cardCls(method === 'cash')}
            >
              <span className="min-w-0">
                <span className="block text-sm font-extrabold">{cashLabel}</span>
                <span className={`mt-0.5 block text-[11px] ${method === 'cash' ? 'text-white/65' : 'text-stone-500'}`}>
                  {isDineIn ? 'Ask the server for the bill' : 'Pay when you collect or when it arrives'}
                </span>
              </span>
              <span className="shrink-0 text-lg" aria-hidden="true">💵</span>
            </button>
          )}
        </div>

        {method === 'qr' && pos.tipsEnabled !== false && (
          <>
            <div className="mt-4 text-xs font-bold uppercase tracking-widest text-stone-500">Tip the team</div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {[0, ...presets].map((pct) => {
                const active = customTip === '' && tipPct === pct
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => { setTipPct(pct); setCustomTip('') }}
                    className={`flex min-h-[46px] flex-col items-center justify-center rounded-xl px-1 text-xs font-extrabold transition ${
                      active ? 'bg-stone-900 text-white shadow-sm' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    <span>{pct ? `${pct}%` : 'None'}</span>
                    {pct > 0 && <span className="tnum text-[10px] opacity-75">{money((charges.subtotal * pct) / 100)}</span>}
                  </button>
                )
              })}
            </div>
            <input
              value={customTip}
              onChange={(event) => setCustomTip(event.target.value)}
              type="number"
              min="0"
              step="any"
              placeholder="Custom tip"
              aria-label="Custom tip amount"
              className="tnum mt-2 min-h-[42px] w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs"
            />
          </>
        )}

        {method === 'qr' ? (
          <div className="mt-4">
            <QrPaymentPanel
              order={order}
              amount={finalTotal}
              tip={tip}
              guestToken={guestToken}
              onDone={() => onDone?.({ method: 'qr' })}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={chooseCash}
            data-testid="guest-cash-button"
            className="tnum mt-4 min-h-[52px] w-full rounded-2xl bg-stone-900 text-base font-extrabold text-white shadow-sm"
          >
            {isDineIn ? 'Request the bill' : `Pay ${money(charges.total)} in cash`}
          </button>
        )}

        {method === 'cash' && (
          <p className="mt-2 text-center text-[11px] leading-relaxed text-stone-400">
            {isDineIn
              ? 'The server will bring the check. Cash is settled at the table.'
              : 'Nothing is charged now. The order goes to the kitchen and you pay on collection.'}
          </p>
        )}
      </div>
    </Sheet>
  )
}
