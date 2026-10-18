// ─── Guest payments ────────────────────────────────────────────────
// The guest QR page and the Telegram mini app offer exactly two ways to
// settle: scan the restaurant's merchant QR, or pay cash. There is no
// card processor woven into this screen — the owner uploads a static QR
// from their bank, and the guest confirms the transfer. Staff can still
// take card in the dashboard.

import { useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { readImageFile } from '../../../lib/images'
import { MAX_IMAGE_CHARS } from '../../../lib/settings'
import { Card, Field, Toggle, inputCls } from '../primitives'

const DEFAULTS = {
  qrEnabled: true,
  cashEnabled: true,
  qrImageUrl: '',
  qrLabel: '',
  qrNote: 'Scan with your banking app, enter the exact amount, then tap “I have paid”.',
  requireQrConfirmation: true,
}

function PaymentsSection({ draft, patch }) {
  const payments = { ...DEFAULTS, ...(draft.payments || {}) }
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reading, setReading] = useState(false)
  const fileRef = useRef(null)

  function setPayment(key, value) {
    patch({ payments: { ...payments, [key]: value } })
  }

  function setMethod(key, value) {
    const next = { ...payments, [key]: value }
    if (!next.cashEnabled && (!next.qrEnabled || !next.qrImageUrl)) {
      setError('Keep cash on until a QR image is uploaded and enabled.')
      return
    }
    setError('')
    setNotice('')
    setPayment(key, value)
  }

  async function upload(file) {
    if (!file) return
    setError('')
    setNotice('')
    setReading(true)
    try {
      const result = await readImageFile(file, { maxKb: 180, maxDim: 900 })
      if (String(result.dataUrl || '').length > MAX_IMAGE_CHARS) {
        throw new Error('That image is still too large after resizing. Try a smaller screenshot.')
      }
      setPayment('qrImageUrl', result.dataUrl)
      setNotice(`QR image ready · ${result.kb} KB`)
    } catch (err) {
      setError(err?.message || 'That image could not be read.')
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="What guests can use"
        sub="The QR page and the Telegram mini app offer these two methods. Card stays available to staff in the dashboard."
      >
        <div className="space-y-2.5">
          <Toggle
            label="QR transfer"
            hint="Guest scans your bank QR, enters the amount, then confirms."
            checked={payments.qrEnabled}
            onChange={(value) => setMethod('qrEnabled', value)}
          />
          <Toggle
            label="Cash"
            hint="Dine-in requests the bill; pickup and delivery pay on collection."
            checked={payments.cashEnabled}
            onChange={(value) => setMethod('cashEnabled', value)}
          />
          <Toggle
            label="Staff confirm QR transfers"
            hint="The guest's “I have paid” becomes a claim in Tickets. Turn this off to mark the order paid immediately."
            checked={payments.requireQrConfirmation !== false}
            onChange={(value) => setPayment('requireQrConfirmation', value)}
          />
          {payments.qrEnabled && !payments.qrImageUrl && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-900" role="status">
              Upload a merchant QR below. Until then, guests only see cash.
            </p>
          )}
        </div>
      </Card>

      <Card
        title="Merchant QR"
        sub="A screenshot from your banking app. The guest scans it and enters the exact total — this app never touches the money."
      >
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-3">
            {payments.qrImageUrl ? (
              <div className="space-y-2" data-testid="payment-qr-preview">
                <img
                  src={payments.qrImageUrl}
                  alt="Merchant payment QR preview"
                  className="mx-auto max-h-48 w-auto rounded-xl bg-white object-contain p-2 shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => { setPayment('qrImageUrl', ''); setNotice(''); setError('') }}
                  className="mx-auto flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-zinc-500 hover:bg-white hover:text-red-600"
                >
                  <Icon name="trash" size={13} /> Remove image
                </button>
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-zinc-400 shadow-sm">
                  <Icon name="photo" size={22} />
                </div>
                <p className="text-xs font-semibold text-zinc-500">No QR uploaded yet</p>
                <p className="px-4 text-[11px] leading-snug text-zinc-400">PNG or JPEG, resized automatically.</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              data-testid="payment-qr-upload"
              onChange={(event) => upload(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              className="min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
            >
              {reading ? 'Reading image…' : payments.qrImageUrl ? 'Replace QR image' : 'Upload QR image'}
            </button>
            <Field label="Or image URL" hint="A hosted image works too. Leave blank after removing a screenshot.">
              <input
                value={payments.qrImageUrl?.startsWith('data:') ? '' : payments.qrImageUrl}
                onChange={(event) => { setError(''); setPayment('qrImageUrl', event.target.value.trim()) }}
                placeholder="https://…/merchant-qr.png"
                className={inputCls}
                maxLength={500}
              />
            </Field>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Keep the amount blank in the bank app if possible — the guest enters the check total. Never upload a
              QR that pays a fixed amount for a different order.
            </p>
          </div>
        </div>
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="mt-3 text-xs font-semibold text-emerald-700">{notice}</p>}
      </Card>

      <Card title="Guest instructions" sub="Shown beside the QR and on the confirmation screen.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Bank / account label" hint="Optional. For example “ABA · Restora Downtown”.">
            <input
              value={payments.qrLabel}
              onChange={(event) => setPayment('qrLabel', event.target.value)}
              placeholder="ABA · Restora Downtown"
              className={inputCls}
              maxLength={60}
            />
          </Field>
          <Field label="Note under the QR" hint="Keep it short on a phone screen.">
            <input
              value={payments.qrNote}
              onChange={(event) => setPayment('qrNote', event.target.value)}
              placeholder="Scan, enter the exact total, then tap I have paid."
              className={inputCls}
              maxLength={180}
            />
          </Field>
        </div>
        <div className="mt-4 rounded-2xl bg-zinc-900 p-4 text-center text-white">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Guest preview</p>
          <p className="mt-2 text-sm font-bold">{payments.qrLabel || 'Scan to pay'}</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{payments.qrNote || DEFAULTS.qrNote}</p>
          <p className="tnum mt-3 text-2xl font-black text-white">$24.50</p>
        </div>
      </Card>
    </div>
  )
}

export { PaymentsSection }
