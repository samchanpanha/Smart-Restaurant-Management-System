// Printable-feeling QR tent card: guests scan → order at their table.
// URL rides the current origin so it works on LAN and in previews.

import { QRCodeSVG } from 'qrcode.react'
import { Modal } from './ui'

export default function QrModal({ table, onClose }) {
  const url = `${window.location.origin}/?guest=${table.id}`
  return (
    <Modal title={`QR · ${table.name}`} sub="Print this for the table tent" onClose={onClose}>
      <div className="mt-3 rounded-2xl bg-white p-6 text-center">
        <div className="text-xs font-bold uppercase tracking-widest text-stone-500">Restora · order at table</div>
        <div className="mt-1 text-2xl font-extrabold tracking-tight text-stone-900">{table.name}</div>
        <div className="mx-auto mt-4 w-fit rounded-xl border-4 border-stone-900 p-2">
          <QRCodeSVG value={url} size={200} level="M" />
        </div>
        <div className="mt-3 text-sm font-semibold text-stone-600">Scan to see the menu & order</div>
        <div className="mt-1 break-all font-mono text-[11px] text-stone-400">{url}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[44px] items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-black hover:bg-amber-400"
        >
          Open guest view ↗
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-[44px] rounded-lg border border-[var(--color-ink-600)] text-sm font-semibold text-zinc-200 hover:bg-white/5"
        >
          Print
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-zinc-500">
        Demo routing by table id — production tents would carry unguessable tokens.
      </p>
    </Modal>
  )
}
