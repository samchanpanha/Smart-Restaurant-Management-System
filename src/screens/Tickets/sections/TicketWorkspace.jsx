import { useEffect, useMemo, useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { TICKET_STATUS_META } from '../../../lib/constants'
import { buildInvoiceDocument, buildReceiptDocument, buildTicketDocument, documentFileName, downloadHtml, printHtml, renderDocumentHtml } from '../../../lib/documents'
import { translateTableName, useI18n } from '../../../lib/i18n'
import { formatClock, minutesBetween, money, orderTotals } from '../../../lib/models'
import { documentNumber, sanitizeSettings } from '../../../lib/settings'
import { useNow, useRestora } from '../../../lib/store'
import { COURSES, serverName, ORDER_TYPE_LABEL, orderLabel } from '../shared.js'
import { UndoBanner } from './UndoBanner.jsx'
import { Composer } from './Composer.jsx'
import { ReasonModal } from './ReasonModal.jsx'
import { PayModal } from './PayModal.jsx'
import { HeldLine, FiredLine } from './Lines.jsx'
import { OrderDetailsModal } from './OrderDetailsModal.jsx'

function TicketWorkspace({ orderId, onError }) {
  const { state, dispatch, issueDocument, link, locId } = useRestora()
  const { lang } = useI18n()
  useNow(15000)
  const [paying, setPaying] = useState(false)
  const [banner, setBanner] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [reasonCtx, setReasonCtx] = useState(null) // { kind: 'comp'|'voidItem'|'voidOrder', item? }

  const order = state.orders.find((o) => o.id === orderId)
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const table = order ? state.tables.find((t) => t.id === order.tableId) : null

  // Keyboard fire/hold: with the composer and modals closed, F fires the held
  // lines to the kitchen and S marks a ready ticket served. Ignored while the
  // server is typing (search/customer fields) so keystrokes never misfire.
  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const tag = (event.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) return
      if (paying || detailsOpen || reasonCtx) return
      const current = state.orders.find((o) => o.id === orderId)
      if (!current || ['paid', 'void'].includes(current.status)) return
      if (event.key === 'f' || event.key === 'F') {
        const heldCount = current.items.filter((i) => i.status === 'held' && !i.voided).length
        if (!heldCount) return
        event.preventDefault()
        dispatch({ type: 'SEND_ORDER', orderId: current.id })
      } else if ((event.key === 's' || event.key === 'S') && current.status === 'ready') {
        event.preventDefault()
        dispatch({ type: 'SERVE_ORDER', orderId: current.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.orders, orderId, paying, detailsOpen, reasonCtx, dispatch])

  if (!order) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-ink-600)] p-10 text-center">
        <div className="text-lg font-bold">No ticket selected</div>
        <p className="mt-1 text-sm text-zinc-500">Pick a ticket on the left, or start a new check. Floor handoffs land here automatically.</p>
      </div>
    )
  }

  const t = orderTotals(order, menuById, state.settings.taxPct)
  const meta = TICKET_STATUS_META[order.status]
  const held = order.items.filter((i) => i.status === 'held' && !i.voided)
  const fired = order.items.filter((i) => i.status !== 'held' || i.voided)
  const closed = ['paid', 'void'].includes(order.status)
  const heldByCourse = COURSES.map((c) => ({ ...c, lines: held.filter((i) => i.course === c.id) })).filter((c) => c.lines.length)

  function send(courses) {
    const before = held.length
    dispatch({ type: 'SEND_ORDER', orderId: order.id, courses })
    if (before === 0) onError('Nothing held to send.')
  }

  function flash(message) {
    setBanner(message)
    window.setTimeout(() => setBanner(null), 4200)
  }

  // Documents come straight from the ticket of record and print with the
  // location's configured template. Filing records the number; a plain
  // print leaves the sequence untouched.
  function documentFor(kind) {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    const shop = { ...state, settings }
    if (kind === 'invoice') return buildInvoiceDocument({ shop, order, settings })
    if (kind === 'receipt') return buildReceiptDocument({ shop, order, settings })
    return buildTicketDocument({ shop, order, settings })
  }

  function printDocument(kind, { file = false } = {}) {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    let doc = documentFor(kind)
    if (!doc) return
    if (file) {
      const saved = issueDocument(kind, { document: doc })
      if (saved) doc = { ...doc, number: saved.number }
    } else {
      // Same formatter the reducer uses when filing — preview matches the
      // number the document will actually get.
      doc = { ...doc, number: `${documentNumber(settings, kind, settings.numbering[kind].next)} (preview)` }
    }
    printHtml(renderDocumentHtml(doc, settings, {}), { title: `${doc.title} ${doc.number}` })
    flash(`${doc.title} sent to the printer${file ? ` — filed as ${doc.number}` : ''}.`)
  }

  function downloadDocument(kind) {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    const doc = documentFor(kind)
    if (!doc) return
    downloadHtml(renderDocumentHtml(doc, settings, {}), documentFileName(doc, settings))
    flash(`${doc.title} downloaded as HTML.`)
  }

  return (
    <div className="space-y-4">
      <UndoBanner orderId={order.id} />
      {(order.billRequested || table?.serverCalledAt) && !closed && (
        <div className="animate-status-in flex flex-wrap items-center justify-between gap-2 rounded-xl bg-violet-500/10 px-4 py-2.5 ring-1 ring-inset ring-violet-500/40" role="alert">
          <div className="text-sm text-violet-200">
            {order.billRequested && <><strong>Guest requested the bill</strong> · </>}
            {table?.serverCalledAt && <><strong>Guest is calling you</strong> · </>}
            <span className="text-violet-200/70">from QR ordering</span>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'ACK_REQUESTS', orderId: order.id, tableId: order.tableId })}
            className="min-h-[44px] shrink-0 rounded-lg bg-violet-500 px-4 text-sm font-bold text-white hover:bg-violet-400"
          >
            On my way
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold tracking-tight">{orderLabel(order, table)}</h2>
              {order.transferredFromTableId && (
                <StatusPill tone="info" size="sm">
                  🔄 Moved from {(() => {
                    const prevTbl = state.tables.find((t) => String(t.id) === String(order.transferredFromTableId))
                    return prevTbl ? translateTableName(prevTbl.name, lang) : order.transferredFromTableId
                  })()}
                </StatusPill>
              )}
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              {serverName(order.serverId)} · opened {formatClock(order.createdAt)} · {minutesBetween(order.createdAt)}m ago
              {order.sentAt && <> · sent {formatClock(order.sentAt)}</>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            <span className="tnum text-xl font-bold">{money(t.subtotal)}</span>
          </div>
        </div>

        {!closed && (
          <div className="mt-3 flex flex-wrap gap-2">
            {order.status === 'ready' && (
              <button type="button" onClick={() => dispatch({ type: 'SERVE_ORDER', orderId: order.id })} title="Shortcut: S" className="min-h-[44px] flex-1 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-black hover:bg-emerald-400">
                Mark served
              </button>
            )}
            <button
              type="button"
              onClick={() => (held.length ? onError('Send held items before payment — the kitchen must see the whole ticket.') : setPaying(true))}
              className="min-h-[44px] flex-1 rounded-lg bg-amber-500 px-3 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40"
              disabled={t.lines.length === 0 || order.status === 'open'}
            >
              Pay · {money(t.total)}
            </button>
            <button
              type="button"
              onClick={() => setReasonCtx({ kind: 'voidOrder' })}
              className="min-h-[44px] rounded-lg border border-red-500/40 px-4 text-sm font-semibold text-red-300 hover:bg-red-500/10"
            >
              Void check
            </button>
          </div>
        )}
        {order.status === 'paid' && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-500/30">
            <span>
              Paid {order.paidAt && formatClock(order.paidAt)} · {order.payMethod}
              {order.split ? ` · ${order.split.kind === 'full' ? 'full' : order.split.kind === 'even' ? `split ${order.split.ways} ways` : `split by item (${order.split.seats} seats)`}` : ''} · {money(order.total ?? t.subtotal)}
            </span>
            <button
              type="button"
              onClick={() => printDocument('receipt', { file: true })}
              className="min-h-[36px] shrink-0 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-black hover:bg-emerald-400"
            >
              Print &amp; file receipt
              {lang !== 'en' && <span className="sr-only"> Print &amp; file receipt</span>}
            </button>
          </div>
        )}

        {['takeout', 'delivery'].includes(order.type) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-[var(--color-ink-800)] px-3.5 py-2.5 text-xs text-zinc-300 ring-1 ring-inset ring-[var(--color-ink-600)]">
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-bold uppercase tracking-wider text-amber-200">
              {ORDER_TYPE_LABEL[order.type]}
            </span>
            {order.customer?.phone && <span>📞 {order.customer.phone}</span>}
            {order.customer?.address && <span className="min-w-0 truncate">📍 {order.customer.address}</span>}
            {order.eta && <span>🕑 {formatClock(order.eta)}</span>}
            {order.deliveryFee > 0 && <span className="tnum">Fee {money(order.deliveryFee)}</span>}
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="ml-auto min-h-[32px] shrink-0 rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5"
            >
              Edit details
            </button>
          </div>
        )}
      </div>

      {banner && (
        <div className="animate-status-in rounded-xl bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200 ring-1 ring-inset ring-sky-500/30" role="status">
          {banner}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Documents</span>
        <button
          type="button"
          onClick={() => printDocument('receipt', { file: order.status === 'paid' })}
          className="min-h-[36px] rounded-lg bg-amber-500 px-3 text-xs font-bold text-black hover:bg-amber-400"
        >
          Print receipt
        </button>
        <button type="button" onClick={() => printDocument('invoice')} className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5">
          Print invoice
        </button>
        <button type="button" onClick={() => printDocument('ticket')} className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5">
          Kitchen ticket
        </button>
        <button type="button" onClick={() => downloadDocument('invoice')} className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5">
          Download
        </button>
        <span className="ml-auto text-[11px] text-zinc-500">
          Template set in Settings → Documents {link.status === 'live' ? `· ${locId}` : '· offline terminal'}
        </span>
      </div>

      {!closed && held.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-amber-200/80">
              Held · not yet sent ({held.length})
            </h3>
          </div>
          <ul className="mt-3 space-y-2">
            {held.map((i) => <HeldLine key={i.id} order={order} item={i} />)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {heldByCourse.length > 1 && heldByCourse.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => send([c.id])}
                className="min-h-[44px] flex-1 rounded-lg border border-amber-500/50 px-3 text-sm font-bold text-amber-200 hover:bg-amber-500/10"
              >
                Fire {c.label} ({c.lines.reduce((s, l) => s + l.qty, 0)})
              </button>
            ))}
            <button type="button" onClick={() => send()} className="min-h-[44px] flex-[2] rounded-lg bg-amber-500 px-3 text-sm font-bold text-black hover:bg-amber-400">
              Send {heldByCourse.length > 1 ? 'all held' : `${heldByCourse[0]?.label || ''} `}({held.reduce((s, l) => s + l.qty, 0)}) → kitchen
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">Sending is the commit — 15s undo, then the kitchen owns it. Stock drops on fire. <span className="text-zinc-400">Shortcut: press F.</span></p>
        </div>
      )}

      {fired.length > 0 && (
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
            In kitchen / served ({fired.length})
          </h3>
          <ul className="mt-3 space-y-2">
            {fired.map((i) => (
              <FiredLine
                key={i.id}
                order={order}
                item={i}
                onComp={(item) => setReasonCtx({ kind: 'comp', item })}
                onVoid={(item) => setReasonCtx({ kind: 'voidItem', item })}
              />
            ))}
          </ul>
        </div>
      )}

      {!closed && <Composer order={order} />}

      {paying && <PayModal order={order} onClose={() => setPaying(false)} />}

      {detailsOpen && <OrderDetailsModal order={order} onClose={() => setDetailsOpen(false)} />}

      {reasonCtx?.kind === 'comp' && (
        <ReasonModal
          title={`Comp ${state.menu.find((m) => m.id === reasonCtx.item.menuItemId)?.name}`}
          sub="Comped lines leave the bill but stay on the record."
          confirmLabel="Comp with reason"
          onClose={() => setReasonCtx(null)}
          onConfirm={(reason) => {
            dispatch({ type: 'COMP_ITEM', orderId: order.id, itemId: reasonCtx.item.id, reason })
            setReasonCtx(null)
          }}
        />
      )}
      {reasonCtx?.kind === 'voidItem' && (
        <ReasonModal
          title="Void line (manager)"
          sub="Fired food already left stock — the void removes the charge, not the history."
          manager
          confirmLabel="Void line"
          onClose={() => setReasonCtx(null)}
          onConfirm={(reason) => {
            dispatch({ type: 'VOID_ITEM', orderId: order.id, itemId: reasonCtx.item.id, reason })
            setReasonCtx(null)
          }}
        />
      )}
      {reasonCtx?.kind === 'voidOrder' && (
        <ReasonModal
          title="Void entire check (manager)"
          sub="The table returns through the bus flow. Paid checks cannot be voided."
          manager
          confirmLabel="Void check"
          onClose={() => setReasonCtx(null)}
          onConfirm={(reason) => {
            dispatch({ type: 'VOID_ORDER', orderId: order.id, reason })
            setReasonCtx(null)
          }}
        />
      )}
    </div>
  )
}

// ─── New check ──────────────────────────────────────────────────


export { TicketWorkspace }
