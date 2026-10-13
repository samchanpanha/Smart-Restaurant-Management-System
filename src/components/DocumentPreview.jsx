// ─── Document preview + print ───────────────────────────────────────
// Renders a built document (invoice / receipt / ticket / report) through
// the exact same HTML the printer receives, inside an isolated iframe.
// What the owner sees here is what comes out of the printer — no second
// rendering path to drift out of sync.

import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { Icon } from './Icon'
import StatusPill from './StatusPill'
import {
  documentFileName, downloadHtml, printHtml, renderDocumentHtml,
} from '../lib/documents'
import { DOC_KIND_META, PAPER_SIZES } from '../lib/settings'

export default function DocumentPreview({
  document: doc,
  settings,
  template,
  qrValue = '',
  notes = '',
  height = 520,
  actions = true,
  onRegenerate,
}) {
  const canvasRef = useRef(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [zoom, setZoom] = useState(1)

  const wantsQr = Boolean(doc && (template?.showQr ?? false) && qrValue)

  useEffect(() => {
    if (!wantsQr) {
      setQrDataUrl('')
      return
    }
    // qrcode.react paints to a canvas — lift it into the print HTML.
    const id = window.setTimeout(() => {
      try {
        setQrDataUrl(canvasRef.current?.toDataURL?.('image/png') || '')
      } catch {
        setQrDataUrl('')
      }
    }, 60)
    return () => window.clearTimeout(id)
  }, [wantsQr, qrValue, template?.showQr])

  const html = useMemo(() => (
    doc ? renderDocumentHtml(doc, settings, { qrDataUrl, qrCaption: qrValue, notes }) : ''
  ), [doc, settings, qrDataUrl, qrValue, notes])

  if (!doc || !template) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
        Nothing to preview yet — pick a ticket, check, or range.
      </div>
    )
  }

  const paper = PAPER_SIZES[template.paper] || PAPER_SIZES.a4

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
            <Icon name="doc" size={16} />
          </span>
          <div>
            <div className="text-sm font-bold text-zinc-900">
              {DOC_KIND_META[doc.kind]?.label || doc.kind} · {doc.number || 'draft'}
            </div>
            <div className="text-[11px] text-zinc-500">
              {paper.label} · {template.name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={doc.currency?.fx === 1 ? 'muted' : 'info'} size="sm">
            {doc.currency?.code}
            {doc.currency?.fx && doc.currency.fx !== 1 ? ` @ ${doc.currency.fx}` : ''}
          </StatusPill>
          {actions && (
            <>
              <div className="flex overflow-hidden rounded-lg border border-zinc-200">
                <button type="button" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))} className="px-2.5 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-50" aria-label="Zoom out">−</button>
                <span className="tnum px-2 py-1.5 text-xs text-zinc-500">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((z) => Math.min(1.6, Math.round((z + 0.1) * 10) / 10))} className="px-2.5 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-50" aria-label="Zoom in">+</button>
              </div>
              {onRegenerate && (
                <button type="button" onClick={onRegenerate} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                  Rebuild
                </button>
              )}
              <button type="button" onClick={() => downloadHtml(html, documentFileName(doc, settings))} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                Download
              </button>
              <button
                type="button"
                onClick={() => printHtml(html, { title: `${doc.title || doc.kind} ${doc.number || ''}` })}
                className="flex min-h-9 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-xs font-bold text-white hover:bg-orange-600"
              >
                <Icon name="printer" size={15} /> Print
              </button>
            </>
          )}
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto bg-zinc-100 p-4">
        <iframe
          title={`${doc.kind} preview`}
          srcDoc={html}
          className="mx-auto block rounded-lg border-0 bg-white shadow-lg"
          style={{ width: '100%', maxWidth: 860, height, transform: `scale(${zoom})`, transformOrigin: 'top center' }}
        />
      </div>
      {wantsQr && (
        <div className="hidden" aria-hidden>
          <QRCodeCanvas ref={canvasRef} value={qrValue} size={256} marginSize={2} />
        </div>
      )}
    </div>
  )
}
