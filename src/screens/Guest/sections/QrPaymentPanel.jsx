// ─── Static merchant QR ─────────────────────────────────────────────
// The guest scans the owner's uploaded bank QR and enters the exact
// amount. One checkbox is the only "proof": nothing here talks to a bank.
// With staff confirmation on, "I have paid" becomes a claim the counter
// confirms. With it off, the same tap settles the order immediately.

import { useState } from 'react'
import { Icon } from '../../../components/Icon'
import { money, paymentReference } from '../../../lib/models'
import { useRestora } from '../../../lib/store'

export function QrPaymentPanel({ order, amount, tip = 0, guestToken = null, onDone = null }) {
  const { state, dispatch } = useRestora()
  const payments = state.settings?.payments || {}
  const [confirmed, setConfirmed] = useState(false)
  if (!payments.qrImageUrl) return null

  const paid = order.status === 'paid'
  const claim = order.paymentClaim
  const requireConfirmation = payments.requireQrConfirmation !== false
  const total = Math.round((Number(amount) || 0) * 100) / 100
  const tipAmount = Math.round((Number(tip) || 0) * 100) / 100

  function submit() {
    if (!confirmed || paid || claim) return
    if (requireConfirmation) {
      dispatch({
        type: 'CLAIM_QR_PAYMENT',
        orderId: order.id,
        guestToken,
        tip: tipAmount,
      })
    } else {
      dispatch({
        type: 'PAY_ORDER',
        orderId: order.id,
        method: 'qr',
        tip: tipAmount,
        split: { kind: 'full', by: 'guest' },
        freeTable: false,
        tenderDetails: {
          method: 'qr',
          tip: tipAmount,
          total: total - tipAmount,
          amount: total,
        },
      })
    }
    onDone?.()
  }

  return (
    <section
      className="rounded-3xl border border-amber-200 bg-white p-4 text-left shadow-sm"
      data-testid="qr-payment-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">Scan to pay</p>
          <h3 className="mt-0.5 text-base font-extrabold text-stone-900">
            {payments.qrLabel || 'Restaurant QR'}
          </h3>
        </div>
        <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-stone-500">
          QR
        </span>
      </div>

      <div className="mt-3 flex flex-col items-center gap-3 rounded-2xl bg-amber-50/70 p-3 ring-1 ring-inset ring-amber-200">
        <img
          src={payments.qrImageUrl}
          alt="Payment QR code"
          className="max-h-[248px] w-auto max-w-full rounded-xl bg-white object-contain p-2 shadow-sm"
        />
        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Amount to transfer</p>
          <p className="tnum mt-0.5 text-2xl font-black text-stone-900">{money(total)}</p>
          <p className="mt-0.5 font-mono text-[11px] font-bold text-stone-500">
            Ref {paymentReference(order.id)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-stone-500">
        {payments.qrNote || 'Scan with your banking app, enter the exact amount, then confirm below.'}
      </p>
      {tipAmount > 0 && (
        <p className="tnum mt-1 text-[11px] font-semibold text-amber-700">Includes a {money(tipAmount)} tip.</p>
      )}

      {paid ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-800" data-testid="qr-paid">
          <Icon name="check" size={17} /> Payment received · thank you
        </div>
      ) : claim ? (
        <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900" data-testid="qr-claim-pending">
          <div className="flex items-center gap-2 font-bold">
            <Icon name="clock" size={15} /> Payment sent · waiting for staff
          </div>
          <p className="mt-1 leading-relaxed text-amber-800">
            We told the counter you transferred {money(claim.amount)}. Keep this page handy in case they ask.
          </p>
          <p className="mt-1 font-mono text-[10px] font-bold text-amber-700">Ref {claim.reference || paymentReference(order.id)}</p>
        </div>
      ) : (
        <>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl bg-stone-50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-500"
              data-testid="qr-payment-check"
            />
            <span className="text-xs font-semibold leading-relaxed text-stone-700">
              I have completed the transfer for {money(total)}.
              <span className="mt-0.5 block font-normal text-stone-500">
                {requireConfirmation
                  ? 'The counter will confirm it before closing the order.'
                  : 'This marks the order paid right away.'}
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={!confirmed}
            data-testid="qr-payment-confirm"
            className="tnum mt-2 min-h-[50px] w-full rounded-2xl bg-stone-900 text-sm font-extrabold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {requireConfirmation ? `I've paid ${money(total)}` : `Confirm payment · ${money(total)}`}
          </button>
        </>
      )}
    </section>
  )
}
