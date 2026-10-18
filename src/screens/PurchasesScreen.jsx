// ─── Purchases ──────────────────────────────────────────────────────
// The buy side of the ledger. A purchase order is real paperwork —
// draft → ordered → received — and only a receipt moves stock. That
// split is what lets the owner order next week's salmon today without
// pretending the walk-in is already full.
//
// Everything on this screen ends in one of four actions the reducer
// already understands: UPSERT_PURCHASE, SET_PURCHASE_STATUS,
// RECEIVE_PURCHASE, DELETE_PURCHASE.

import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import { Field, Modal, btnGhost, btnPrimary, inputCls } from '../components/ui'
import FilterPresetsBar from '../components/FilterPresetsBar'
import { translateInventoryName, useI18n } from '../lib/i18n'
import { money, reorderPointFor, stockStatusFor, suggestedOrderQty, uid } from '../lib/models'
import { PURCHASE_STATUS_META, PURCHASE_STATUSES } from '../lib/reducer'
import { documentNumber, sanitizeSettings } from '../lib/settings'
import { basePrice, describeQty, itemUnitChoices, packFactor, packPrice } from '../lib/units'
import {
  buildPurchaseOrderDocument, documentFileName, downloadHtml, printHtml, renderDocumentHtml,
} from '../lib/documents'
import { purchaseSummary, rangeBounds } from '../lib/reports'
import { useConfirm } from '../components/ui/confirm-context'
import { useRestora } from '../lib/store'

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white shadow-sm'
const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500'
const tdCls = 'px-3 py-2.5 text-sm text-zinc-700'
const FILTERS = [
  { id: 'open', label: 'Open', statuses: ['draft', 'ordered'] },
  { id: 'received', label: 'Received', statuses: ['received'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { id: 'all', label: 'All', statuses: PURCHASE_STATUSES },
]

const dateLabel = (value) => (value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—')

const blankLine = (item) => {
  // Order the way the item is really bought: its purchase unit when it has
  // one, otherwise the stock unit. packSize freezes what that unit holds.
  const unit = item?.purchaseUnit || item?.unit || ''
  const factor = item ? packFactor(item, unit) : 1
  return {
    id: uid('pol'),
    inventoryItemId: item?.id || '',
    name: item?.name || '',
    unit,
    qty: item ? suggestedOrderQty(item) : 1,
    unitCost: item ? packPrice(Number(item.lastCost) || 0, factor) : 0,
    receivedQty: 0,
    packSize: factor,
  }
}

function draftFrom(purchase, defaultSupplierId = '') {
  return {
    id: purchase?.id || uid('po'),
    number: purchase?.number || '',
    supplierId: purchase?.supplierId || defaultSupplierId || '',
    reference: purchase?.reference || '',
    note: purchase?.note || '',
    status: purchase?.status || 'draft',
    expectedAt: purchase?.expectedAt ? String(purchase.expectedAt).slice(0, 10) : '',
    lines: purchase?.lines?.length ? purchase.lines.map((line) => ({ ...blankLine(), ...line, id: line.id || uid('pol') })) : [blankLine()],
    tax: purchase?.tax ?? 0,
    shipping: purchase?.shipping ?? 0,
  }
}

const lineTotalOf = (line) => Math.round((Number(line.qty) || 0) * (Number(line.unitCost) || 0) * 100) / 100

// ─── Order editor ───────────────────────────────────────────────────

function PurchaseModal({ purchase, defaultSupplierId, onClose, onSave }) {
  const { state } = useRestora()
  const [draft, setDraft] = useState(() => draftFrom(purchase, defaultSupplierId))
  const [error, setError] = useState('')

  const suppliers = (state.suppliers || []).filter((supplier) => supplier.status !== 'archived' || supplier.id === draft.supplierId)
  const supplier = suppliers.find((entry) => entry.id === draft.supplierId)
  // Only the supplier's own ingredients, with an escape hatch for anything
  // that has no supplier assigned yet.
  const ownItems = (state.inventory || []).filter((item) => !draft.supplierId || item.supplierId === draft.supplierId)
  const looseItems = (state.inventory || []).filter((item) => !item.supplierId)
  const items = [...ownItems, ...looseItems.filter((item) => !ownItems.includes(item))]

  const subtotal = draft.lines.reduce((sum, line) => sum + lineTotalOf(line), 0)
  const total = subtotal + (Number(draft.tax) || 0) + (Number(draft.shipping) || 0)
  const locked = draft.receivedAt || purchase?.status === 'received'

  function patchLine(id, patch) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    }))
  }

  function pickItem(id, itemId) {
    const item = (state.inventory || []).find((entry) => entry.id === itemId)
    const unit = item?.purchaseUnit || item?.unit || ''
    const factor = item ? packFactor(item, unit) : 1
    patchLine(id, {
      inventoryItemId: itemId,
      name: item?.name || '',
      unit,
      packSize: factor,
      unitCost: item ? packPrice(Number(item.lastCost) || 0, factor) : 0,
    })
  }

  function addLine() {
    const used = new Set(draft.lines.map((line) => line.inventoryItemId))
    const next = items.find((item) => !used.has(item.id)) || items[0]
    setDraft((current) => ({ ...current, lines: [...current.lines, blankLine(next)] }))
  }

  // Everything the supplier is short of, in one click.
  function replenish() {
    const short = (state.inventory || [])
      .filter((item) => !draft.supplierId || item.supplierId === draft.supplierId)
      .filter((item) => item.onHand <= reorderPointFor(item, state.settings))
    if (!short.length) {
      setError('Nothing on this supplier is below its reorder point yet.')
      return
    }
    setError('')
    setDraft((current) => ({ ...current, lines: short.map((item) => blankLine(item)) }))
  }

  function save(status) {
    const lines = draft.lines
      .filter((line) => line.inventoryItemId && (Number(line.qty) || 0) > 0)
      .map((line) => {
        const item = (state.inventory || []).find((entry) => entry.id === line.inventoryItemId)
        return { ...line, packSize: item ? packFactor(item, line.unit) : (Number(line.packSize) || 1) }
      })
    if (!draft.supplierId) { setError('Pick the supplier this order goes to.'); return }
    if (!lines.length) { setError('Add at least one line with a quantity above zero.'); return }
    onSave({
      ...draft,
      lines,
      status: status || draft.status,
      tax: Number(draft.tax) || 0,
      shipping: Number(draft.shipping) || 0,
      vendor: supplier?.name || draft.vendor || '',
      expectedAt: draft.expectedAt ? new Date(`${draft.expectedAt}T12:00:00`).toISOString() : null,
    })
  }

  return (
    <Modal
      title={purchase ? `Edit ${purchase.number || 'purchase order'}` : 'New purchase order'}
      sub="Ordering is paper: nothing reaches the walk-in until you receive it. Margins update on receipt, not on order."
      onClose={onClose}
      wide
    >
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Supplier · required">
          <select className={inputCls} value={draft.supplierId} onChange={(e) => setDraft((c) => ({ ...c, supplierId: e.target.value }))} disabled={locked}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </Field>
        <Field label="Their reference">
          <input className={inputCls} value={draft.reference} onChange={(e) => setDraft((c) => ({ ...c, reference: e.target.value }))} placeholder="Invoice or quote no." />
        </Field>
        <Field label="Expected delivery">
          <input type="date" className={inputCls} value={draft.expectedAt} onChange={(e) => setDraft((c) => ({ ...c, expectedAt: e.target.value }))} />
        </Field>
      </div>

      {supplier && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <StatusPill tone="info" size="sm">{supplier.paymentTerms?.replace('_', ' ')}</StatusPill>
          <span>Lead time {supplier.leadTimeDays ?? 0} day(s)</span>
          {supplier.minOrderValue > 0 && <span>· minimum {money(supplier.minOrderValue, state.settings.currency)}</span>}
          {supplier.deliveryDays?.length > 0 && <span>· delivers {supplier.deliveryDays.join(', ')}</span>}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
        <table className="w-full">
          <thead className="bg-zinc-50">
            <tr>
              <th className={thCls}>Item</th>
              <th className={`${thCls} w-40`}>Qty · unit</th>
              <th className={`${thCls} w-32`}>Cost per unit</th>
              <th className={`${thCls} w-24 text-right`}>Amount</th>
              <th className={`${thCls} w-10`} />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {draft.lines.map((line) => {
              const item = (state.inventory || []).find((entry) => entry.id === line.inventoryItemId)
              const status = item ? stockStatusFor(item, state.settings) : null
              return (
                <tr key={line.id}>
                  <td className={tdCls}>
                    <select className={inputCls} value={line.inventoryItemId} onChange={(e) => pickItem(line.id, e.target.value)} disabled={locked}>
                      <option value="">Pick an item…</option>
                      {items.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}{entry.sku ? ` · ${entry.sku}` : ''}
                        </option>
                      ))}
                    </select>
                    {item && (
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                        <span>on hand {item.onHand} {item.unit}</span>
                        <span>· par {item.par}</span>
                        {status && status !== 'ok' && status !== 'not_counted' && <StatusPill tone={status === 'out' ? 'bad' : 'warn'} size="sm">{status === 'out' ? 'Out' : 'Low'}</StatusPill>}
                      </div>
                    )}
                  </td>
                  <td className={tdCls}>
                    <div className="flex gap-1.5">
                      <input type="number" min="0" step="0.01" className={inputCls} value={line.qty} disabled={locked}
                        aria-label={`Quantity for ${line.name || 'line'}`}
                        onChange={(e) => patchLine(line.id, { qty: e.target.value === '' ? '' : Number(e.target.value) })} />
                      <select
                        className={`${inputCls} w-24`}
                        value={line.unit || ''}
                        disabled={locked || !item}
                        aria-label={`Unit for ${line.name || 'line'}`}
                        onChange={(e) => {
                          const unit = e.target.value
                          patchLine(line.id, {
                            unit,
                            packSize: item ? packFactor(item, unit) : 1,
                            unitCost: packPrice(Number(item?.lastCost) || 0, item ? packFactor(item, unit) : 1),
                          })
                        }}
                      >
                        {(item ? itemUnitChoices(item, state.settings) : []).map((choice) => (
                          <option key={choice.id} value={choice.id}>
                            {choice.short}{choice.kind === 'pack' ? ` (${choice.factor})` : ''}
                          </option>
                        ))}
                        {!item && <option value="">—</option>}
                      </select>
                    </div>
                    {item && (Number(line.packSize) || packFactor(item, line.unit)) > 1 && (
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {line.qty || 0} {line.unit} → {describeQty(item, (Number(line.qty) || 0) * (Number(line.packSize) || packFactor(item, line.unit)), state.settings)} of stock
                      </div>
                    )}
                  </td>
                  <td className={tdCls}>
                    <input type="number" min="0" step="0.01" className={inputCls} value={line.unitCost} disabled={locked}
                      aria-label={`Unit cost for ${line.name || 'line'}`}
                      onChange={(e) => patchLine(line.id, { unitCost: e.target.value === '' ? '' : Number(e.target.value) })} />
                    {item && (Number(line.packSize) || 1) > 1 && (
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {money(basePrice(Number(line.unitCost) || 0, Number(line.packSize) || 1), state.settings.currency)} per {item.unit}
                      </div>
                    )}
                  </td>
                  <td className={`${tdCls} text-right font-medium`}>{money(lineTotalOf(line), state.settings.currency)}</td>
                  <td className={tdCls}>
                    <button type="button" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-rose-600" disabled={locked || draft.lines.length === 1}
                      onClick={() => setDraft((c) => ({ ...c, lines: c.lines.filter((entry) => entry.id !== line.id) }))}
                      aria-label="Remove line">
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-3 py-2">
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={addLine} disabled={locked}>Add line</button>
            <button type="button" className={btnGhost} onClick={replenish} disabled={locked}>Fill from low stock</button>
          </div>
          <div className="text-xs text-zinc-500">{draft.lines.length} line(s)</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Tax">
          <input type="number" min="0" step="0.01" className={inputCls} value={draft.tax} disabled={locked}
            onChange={(e) => setDraft((c) => ({ ...c, tax: e.target.value === '' ? '' : Number(e.target.value) }))} />
        </Field>
        <Field label="Delivery charge">
          <input type="number" min="0" step="0.01" className={inputCls} value={draft.shipping} disabled={locked}
            onChange={(e) => setDraft((c) => ({ ...c, shipping: e.target.value === '' ? '' : Number(e.target.value) }))} />
        </Field>
        <Field label="Order note">
          <input className={inputCls} value={draft.note} onChange={(e) => setDraft((c) => ({ ...c, note: e.target.value }))} placeholder="Deliver to the back door" />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3">
        <div className="text-sm text-zinc-600">
          Subtotal {money(subtotal, state.settings.currency)}
          {Number(draft.tax) ? ` · tax ${money(Number(draft.tax), state.settings.currency)}` : ''}
          {Number(draft.shipping) ? ` · delivery ${money(Number(draft.shipping), state.settings.currency)}` : ''}
        </div>
        <div className="text-lg font-semibold text-zinc-900">Total {money(total, state.settings.currency)}</div>
      </div>

      {error && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div>}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={btnGhost} onClick={() => save('draft')}>Save draft</button>
        <button type="button" className={btnPrimary} onClick={() => save('ordered')} disabled={locked}>Save &amp; mark ordered</button>
      </div>
    </Modal>
  )
}

// ─── Receive ────────────────────────────────────────────────────────

function ReceiveModal({ purchase, onClose, onReceive }) {
  const { state } = useRestora()
  const [lines, setLines] = useState(() => (purchase.lines || []).map((line) => ({
    id: line.id,
    qty: Math.max(0, Math.round(((Number(line.qty) || 0) - (Number(line.receivedQty) || 0)) * 1000) / 1000),
    unitCost: Number(line.unitCost) || 0,
  })))

  const outstanding = (purchase.lines || []).map((line) => ({
    line,
    due: Math.max(0, (Number(line.qty) || 0) - (Number(line.receivedQty) || 0)),
  }))
  const arriving = lines.reduce((sum, line) => {
    const cost = purchase.lines.find((entry) => entry.id === line.id)?.unitCost || 0
    return sum + (Number(line.qty) || 0) * (line.unitCost ?? cost ?? 0)
  }, 0)

  return (
    <Modal
      title={`Receive ${purchase.number || 'purchase order'}`}
      sub="Enter what actually arrived — quantities are what the ledger books, so short deliveries stay on the order."
      onClose={onClose}
      wide
    >
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
        <table className="w-full">
          <thead className="bg-zinc-50">
            <tr>
              <th className={thCls}>Item</th>
              <th className={`${thCls} w-24`}>Outstanding</th>
              <th className={`${thCls} w-28`}>Arriving</th>
              <th className={`${thCls} w-28`}>Unit cost</th>
              <th className={`${thCls} w-28 text-right`}>Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {outstanding.map(({ line, due }) => {
              const draft = lines.find((entry) => entry.id === line.id)
              const item = (state.inventory || []).find((entry) => entry.id === line.inventoryItemId)
              const value = (Number(draft?.qty) || 0) * (Number(draft?.unitCost ?? line.unitCost) || 0)
              return (
                <tr key={line.id}>
                  <td className={tdCls}>
                    <div className="font-medium text-zinc-800">{line.name || item?.name}</div>
                    <div className="text-[11px] text-zinc-500">
                      ordered {line.qty} {line.unit || item?.unit || ''} · already in {line.receivedQty || 0}
                      {item && (Number(line.packSize) || packFactor(item, line.unit)) > 1
                        ? ` · lands as ${describeQty(item, (Number(line.qty) || 0) * (Number(line.packSize) || packFactor(item, line.unit)), state.settings)}`
                        : ''}
                      {' '}· on hand {item?.onHand ?? '—'}
                    </div>
                  </td>
                  <td className={tdCls}>{Math.round(due * 1000) / 1000}</td>
                  <td className={tdCls}>
                    <input
                      type="number" min="0" step="0.01" className={inputCls} value={draft?.qty ?? 0}
                      onChange={(e) => setLines((current) => current.map((entry) => (
                        entry.id === line.id ? { ...entry, qty: e.target.value === '' ? '' : Number(e.target.value) } : entry
                      )))}
                    />
                    <button
                      type="button"
                      className="mt-1 text-[11px] font-semibold text-teal-700 hover:underline"
                      onClick={() => setLines((current) => current.map((entry) => (entry.id === line.id ? { ...entry, qty: due } : entry)))}
                    >
                      All {due}
                    </button>
                  </td>
                  <td className={tdCls}>
                    <input
                      type="number" min="0" step="0.01" className={inputCls} value={draft?.unitCost ?? line.unitCost}
                      onChange={(e) => setLines((current) => current.map((entry) => (
                        entry.id === line.id ? { ...entry, unitCost: e.target.value === '' ? '' : Number(e.target.value) } : entry
                      )))}
                    />
                  </td>
                  <td className={`${tdCls} text-right font-medium`}>{money(value, state.settings.currency)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-600">
        <span>Arriving now: <strong>{money(arriving, state.settings.currency)}</strong></span>
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={() => setLines((current) => current.map((entry) => ({ ...entry, qty: 0 })))}>Nothing arrived</button>
          <button type="button" className={btnGhost} onClick={() => setLines((current) => current.map((entry) => ({
            ...entry,
            qty: outstanding.find((row) => row.line.id === entry.id)?.due ?? entry.qty,
          })))}>Receive everything</button>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => onReceive(lines.filter((line) => (Number(line.qty) || 0) > 0))}
        >
          Book delivery into stock
        </button>
      </div>
    </Modal>
  )
}

// ─── Screen ─────────────────────────────────────────────────────────

export default function PurchasesScreen() {
  const confirm = useConfirm()
  const { state, dispatch, issueDocument, role } = useRestora()
  const { lang, dict } = useI18n()
  const pur = dict.purchases || {}
  const [filter, setFilter] = useState('open')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [receiving, setReceiving] = useState(null)
  const [flash, setFlash] = useState('')

  const settings = state.settings
  const purchases = state.purchases || []
  const bounds = rangeBounds('30d')

  const stats = useMemo(() => purchaseSummary(state, bounds), [state, bounds])

  const visible = purchases
    .filter((purchase) => FILTERS.find((entry) => entry.id === filter)?.statuses.includes(purchase.status))
    .filter((purchase) => supplierFilter === 'all' || purchase.supplierId === supplierFilter)
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))

  const lowStock = (state.inventory || [])
    .map((item) => ({ item, status: stockStatusFor(item, settings), point: reorderPointFor(item, settings) }))
    .filter((row) => row.status !== 'not_counted' && row.item.onHand <= row.point)
    .sort((a, b) => (a.item.onHand / (a.point || 1)) - (b.item.onHand / (b.point || 1)))

  function save(draft) {
    dispatch({ type: 'UPSERT_PURCHASE', purchase: draft, by: role })
    setEditing(null)
    setFlash(`${draft.number || 'Purchase order'} saved as ${draft.status}.`)
  }

  function setStatus(purchase, status) {
    dispatch({ type: 'SET_PURCHASE_STATUS', purchaseId: purchase.id, status, by: role })
    setFlash(`${purchase.number || 'Purchase order'} marked ${status}.`)
  }

  function receive(purchase, lines) {
    if (!lines.length) {
      setFlash('Nothing was booked — enter the quantities that arrived first.')
      setReceiving(null)
      return
    }
    dispatch({ type: 'RECEIVE_PURCHASE', purchaseId: purchase.id, lines, by: role })
    const units = lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)
    setFlash(`${units} unit(s) booked into stock from ${purchase.number || 'the order'}.`)
    setReceiving(null)
  }

  async function remove(purchase) {
    if (purchase.status === 'received') {
      const ok = await confirm({
        title: `Delete ${purchase.number}?`,
        body: 'This order was already received. The paperwork goes, but the stock it booked stays in the ledger.',
        confirmLabel: 'Delete the paperwork',
        tone: 'danger',
      })
      if (!ok) return
    }
    dispatch({ type: 'DELETE_PURCHASE', purchaseId: purchase.id, force: purchase.status === 'received' })
    setFlash(`${purchase.number || 'Purchase order'} deleted.`)
  }

  function printDocument(purchase, { file = false } = {}) {
    const clean = sanitizeSettings(settings, settings?.restaurantName)
    let doc = buildPurchaseOrderDocument({ shop: { ...state, settings: clean }, purchase, settings: clean })
    if (file) {
      const saved = issueDocument('purchase', { document: doc })
      if (saved?.number) doc = { ...doc, number: saved.number }
      else doc = { ...doc, number: purchase.number }
    } else {
      const preview = purchase.number || documentNumber(clean, 'purchase', clean.numbering.purchase.next)
      doc = { ...doc, number: `${preview} (preview)` }
    }
    printHtml(renderDocumentHtml(doc, clean, {}), { title: `${doc.title} ${doc.number}` })
    setFlash(`${doc.title} sent to the printer${file ? ' and filed in the number register' : ''}.`)
  }

  function download(purchase) {
    const clean = sanitizeSettings(settings, settings?.restaurantName)
    const doc = buildPurchaseOrderDocument({ shop: { ...state, settings: clean }, purchase, settings: clean })
    downloadHtml(renderDocumentHtml(doc, clean, {}), documentFileName(doc, clean))
    setFlash(`${doc.title} downloaded.`)
  }

  const filterLabels = {
    open: pur.ordered || 'Open',
    received: pur.received || 'Received',
    cancelled: lang === 'km' ? 'បានបោះបង់' : lang === 'zh' ? '已取消' : 'Cancelled',
    all: pur.allOrders || 'All',
  }

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">
            {pur.title || 'Purchases'}
            {lang !== 'en' && <span className="sr-only"> Purchases</span>}
          </h2>
          <p className="text-sm text-zinc-500">
            {pur.subtitle || 'Order from suppliers, receive into stock, and print the paperwork. Receipts are what move the ledger.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={() => { setFlash(''); setEditing({ purchase: null, supplierId: '' }) }}>
            <Icon name="cart" className="mr-1.5 h-4 w-4" />
            {pur.newPurchaseOrder || 'New purchase order'}
            {lang !== 'en' && <span className="sr-only"> New purchase order</span>}
          </button>
        </div>
      </div>

      {flash && (
        <div className="rounded-xl bg-teal-50 px-4 py-2.5 text-sm text-teal-900 ring-1 ring-inset ring-teal-200" role="status">
          {flash}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{pur.ordered || 'On order'}{lang !== 'en' && <span className="sr-only"> On order</span>}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{money(stats.openValue, settings.currency)}</div>
          <div className="text-xs text-zinc-500">{stats.openOrders.length} open order(s)</div>
        </div>
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{pur.received || 'Bought · 30 days'}{lang !== 'en' && <span className="sr-only"> Bought · 30 days</span>}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{money(stats.spend, settings.currency)}</div>
          <div className="text-xs text-zinc-500">{stats.orders} receipt(s) · {stats.quickReceipts} quick receipt(s)</div>
        </div>
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Below par</div>
          <div className={`mt-1 text-2xl font-semibold ${lowStock.length ? 'text-amber-600' : 'text-zinc-900'}`}>{lowStock.length}</div>
          <div className="text-xs text-zinc-500">{lowStock.length ? 'waiting to be ordered' : 'everything is stocked'}</div>
        </div>
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{pur.supplier || 'Top supplier · 30 days'}</div>
          <div className="mt-1 truncate text-lg font-semibold text-zinc-900">{stats.bySupplier[0]?.name || '—'}</div>
          <div className="text-xs text-zinc-500">{stats.bySupplier[0] ? money(stats.bySupplier[0].value, settings.currency) : 'no spend yet'}</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className={`${cardCls} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Reorder suggestions</h3>
              <p className="text-xs text-zinc-500">Everything at or under its reorder point, cheapest cover first. One click starts the order.</p>
            </div>
          </div>
          <ul className="divide-y divide-zinc-100">
            {lowStock.slice(0, 6).map(({ item, status }) => {
              const supplier = (state.suppliers || []).find((entry) => entry.id === item.supplierId)
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                      {translateInventoryName(item, lang)}
                      <StatusPill tone={status.tone} size="sm">{status.label}</StatusPill>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {item.onHand} {item.unit} on hand · par {item.par} · {supplier?.name || 'unassigned supplier'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => { setFlash(''); setEditing({ purchase: { id: uid('po'), supplierId: item.supplierId || '', status: 'draft', lines: [blankLine(item)] }, supplierId: item.supplierId || '' }) }}
                  >
                    Order {suggestedOrderQty(item)} {item.unit}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className={`${cardCls} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((entry) => {
                const count = purchases.filter((purchase) => entry.statuses.includes(purchase.status)).length
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFilter(entry.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === entry.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                  >
                    {filterLabels[entry.id] || entry.label} · {count}
                  </button>
                )
              })}
            </div>
            <FilterPresetsBar
              screenKey="purchases"
              currentFilters={{ filter, supplierFilter }}
              onApply={(f) => {
                if (f.filter) setFilter(f.filter)
                if (f.supplierFilter !== undefined) setSupplierFilter(f.supplierFilter)
              }}
            />
          </div>
          <select className={inputCls} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="all">All suppliers</option>
            {(state.suppliers || []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </div>

        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">
            No purchase orders here yet. <button type="button" className="font-semibold text-teal-700 hover:underline" onClick={() => setEditing({ purchase: null, supplierId: '' })}>Start one</button> or fill a low-stock order from the list above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead className="bg-zinc-50">
                <tr>
                  <th className={thCls}>Order</th>
                  <th className={thCls}>Supplier</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Dates</th>
                  <th className={`${thCls} text-right`}>Total</th>
                  <th className={`${thCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((purchase) => {
                  const meta = PURCHASE_STATUS_META[purchase.status] || PURCHASE_STATUS_META.draft
                  const received = (purchase.lines || []).reduce((sum, line) => sum + (Number(line.receivedQty) || 0), 0)
                  const ordered = (purchase.lines || []).reduce((sum, line) => sum + (Number(line.qty) || 0), 0)
                  return (
                    <tr key={purchase.id} className="align-top">
                      <td className={tdCls}>
                        <div className="font-mono text-xs text-zinc-500">{purchase.number || '—'}</div>
                        <div className="text-xs text-zinc-500">
                          {(purchase.lines || []).length} line(s)
                          {(purchase.lines || []).length > 1 ? ` · ${Math.round(received * 10) / 10}/${Math.round(ordered * 10) / 10} in` : ''}
                        </div>
                        {purchase.note && <div className="mt-0.5 max-w-[220px] truncate text-xs italic text-zinc-400">{purchase.note}</div>}
                      </td>
                      <td className={tdCls}>
                        <div className="font-medium text-zinc-800">{purchase.vendor || 'Unassigned vendor'}</div>
                        {purchase.reference && <div className="text-xs text-zinc-500">ref {purchase.reference}</div>}
                      </td>
                      <td className={tdCls}><StatusPill tone={meta.tone} size="sm">{meta.label}</StatusPill></td>
                      <td className={`${tdCls} text-xs text-zinc-500`}>
                        <div>ordered {dateLabel(purchase.orderedAt || purchase.createdAt)}</div>
                        <div>expected {dateLabel(purchase.expectedAt)}</div>
                        {purchase.receivedAt && <div className="text-teal-700">received {dateLabel(purchase.receivedAt)}</div>}
                      </td>
                      <td className={`${tdCls} text-right font-semibold text-zinc-900`}>{money(purchase.totals?.total || 0, settings.currency)}</td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {purchase.status === 'draft' && (
                            <button type="button" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => setStatus(purchase, 'ordered')}>Mark ordered</button>
                          )}
                          {['draft', 'ordered'].includes(purchase.status) && (
                            <>
                              <button type="button" className="rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800" onClick={() => setReceiving(purchase)}>Receive</button>
                              <button type="button" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => { setFlash(''); setEditing({ purchase }) }}>Edit</button>
                              <button type="button" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => setStatus(purchase, 'cancelled')}>Cancel</button>
                            </>
                          )}
                          <button type="button" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => printDocument(purchase, { file: purchase.status !== 'draft' })}>
                            Print
                          </button>
                          <button type="button" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => download(purchase)}>Download</button>
                          <button type="button" className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50" onClick={() => remove(purchase)}>
                            <Icon name="trash" className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <PurchaseModal
          purchase={editing.purchase}
          defaultSupplierId={editing.supplierId}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      {receiving && (
        <ReceiveModal
          purchase={receiving}
          onClose={() => setReceiving(null)}
          onReceive={(lines) => receive(receiving, lines)}
        />
      )}
    </div>
  )
}
