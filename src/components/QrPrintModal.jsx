import { useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Modal, btnGhost, btnPrimary } from './ui'
import { useAuth } from '../lib/auth'
import { Icon } from './Icon'

export default function QrPrintModal({ table, onClose }) {
  const { user } = useAuth()
  const slug = user?.owner?.slug
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = `${origin}/?guest=${table.id}${slug ? `&owner=${encodeURIComponent(slug)}` : ''}`
  const printAreaRef = useRef(null)

  function handlePrint() {
    window.print()
  }

  return (
    <Modal
      title={`Table QR Tent · ${table.name}`}
      subtitle="Print or display on table tents for table-side self-service ordering."
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Printable tent card */}
        <div
          ref={printAreaRef}
          className="mx-auto max-w-sm rounded-3xl border-2 border-stone-800 bg-white p-6 text-center text-stone-900 shadow-xl"
        >
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-orange-600">
            <span>Restora</span>
            <span>·</span>
            <span>Scan to Order</span>
          </div>

          <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-900">
            {table.name}
          </h2>
          <p className="text-xs text-stone-500">{table.zone || 'Dining Room'} · {table.seats} seats</p>

          <div className="mx-auto my-5 w-fit rounded-2xl border-4 border-stone-900 bg-white p-3 shadow-sm">
            <QRCodeSVG value={url} size={220} level="H" includeMargin={false} />
          </div>

          <div className="text-sm font-bold text-stone-800">
            Open camera & point at QR code
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Browse our full menu, customize your order, and send straight to the kitchen.
          </p>

          <div className="mt-4 rounded-xl bg-stone-50 px-3 py-1.5 font-mono text-[10px] text-stone-400 break-all select-all">
            {url}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-200 hover:bg-zinc-700"
          >
            <span>Open preview</span>
            <Icon name="swap" className="h-3.5 w-3.5" />
          </a>

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className={btnPrimary}
            >
              <Icon name="printer" className="mr-1.5 h-4 w-4" />
              Print tent card
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
