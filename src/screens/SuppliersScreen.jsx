// ─── Suppliers ──────────────────────────────────────────────────────
// The other half of stock control: who you buy from, on what terms, and
// what is owed to them. A supplier owns a slice of the ingredient list,
// carries the lead time that turns a low-stock alert into an order, and
// receives deliveries straight into the inventory ledger.

import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import { Field, Modal, btnGhost, btnPrimary } from '../components/ui'
import { translateInventoryName, useI18n } from '../lib/i18n'
import { money, reorderPointFor, stockStatusFor, suggestedOrderQty, uid } from '../lib/models'
import { CURRENCIES } from '../lib/currency'
import { PAYMENT_TERMS, SUPPLIER_STATUSES, paymentTermsLabel } from '../lib/settings'
import { useRestora } from '../lib/store'

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white shadow-sm'
const smallInput = 'w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

const STATUS_TONE = { active: 'ok', paused: 'warn', archived: 'muted' }

function supplierSpend(state, supplier) {
  const invoices = (state.invoiceLog || []).filter(
    (invoice) => invoice.supplierId === supplier.id || invoice.vendor === supplier.name,
  )
  const total = invoices.reduce(
    (sum, invoice) => sum + (invoice.lines || []).reduce((lineSum, line) => lineSum + (line.qty || 0) * (line.unitCost || 0), 0),
    0,
  )
  const last = invoices.length ? invoices[invoices.length - 1] : null
  const onOrder = state.inventory.filter((item) => item.supplierId === supplier.id && item.incoming > 0)
  return { invoices, total, last, onOrder }
}

// ─── Supplier editor ───────────────────────────────────────────────

function SupplierModal({ supplier, onClose, onSave }) {
  const [draft, setDraft] = useState(() => ({
    name: supplier?.name || '',
    contactName: supplier?.contactName || '',
    contactRole: supplier?.contactRole || '',
    email: supplier?.email || '',
    phone: supplier?.phone || '',
    website: supplier?.website || '',
    addressLine1: supplier?.addressLine1 || '',
    city: supplier?.city || '',
    state: supplier?.state || '',
    postalCode: supplier?.postalCode || '',
    country: supplier?.country || '',
    taxId: supplier?.taxId || '',
    accountNumber: supplier?.accountNumber || '',
    paymentTerms: supplier?.paymentTerms || 'net_30',
    leadTimeDays: supplier?.leadTimeDays ?? 2,
    minOrderValue: supplier?.minOrderValue ?? 0,
    currency: supplier?.currency || '',
    deliveryDays: supplier?.deliveryDays || [],
    status: supplier?.status || 'active',
    rating: supplier?.rating ?? 0,
    notes: supplier?.notes || '',
  }))
  const [error, setError] = useState('')

  function toggleDay(day) {
    setDraft((current) => ({
      ...current,
      deliveryDays: current.deliveryDays.includes(day)
        ? current.deliveryDays.filter((entry) => entry !== day)
        : [...current.deliveryDays, day],
    }))
  }

  return (
    <Modal
      title={supplier ? `Edit ${supplier.name}` : 'New supplier'}
      sub="Lead time and delivery days power the reorder list; terms and tax ID print on purchase paperwork."
      onClose={onClose}
      wide
    >
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Company name · required">
          <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={60} className={smallInput} />
        </Field>
        <Field label="Account number">
          <input value={draft.accountNumber} onChange={(e) => setDraft((d) => ({ ...d, accountNumber: e.target.value }))} maxLength={40} className={smallInput} />
        </Field>
        <Field label="Contact name">
          <input value={draft.contactName} onChange={(e) => setDraft((d) => ({ ...d, contactName: e.target.value }))} maxLength={60} className={smallInput} />
        </Field>
        <Field label="Contact role">
          <input value={draft.contactRole} onChange={(e) => setDraft((d) => ({ ...d, contactRole: e.target.value }))} maxLength={40} className={smallInput} />
        </Field>
        <Field label="Email">
          <input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} maxLength={80} className={smallInput} />
        </Field>
        <Field label="Phone">
          <input value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} maxLength={32} className={smallInput} />
        </Field>
        <Field label="Street address">
          <input value={draft.addressLine1} onChange={(e) => setDraft((d) => ({ ...d, addressLine1: e.target.value }))} maxLength={80} className={smallInput} />
        </Field>
        <Field label="City">
          <input value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} maxLength={48} className={smallInput} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <input value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))} maxLength={48} className={smallInput} />
          </Field>
          <Field label="Postal code">
            <input value={draft.postalCode} onChange={(e) => setDraft((d) => ({ ...d, postalCode: e.target.value }))} maxLength={16} className={smallInput} />
          </Field>
        </div>
        <Field label="Country">
          <input value={draft.country} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))} maxLength={48} className={smallInput} />
        </Field>
        <Field label="Tax / VAT ID">
          <input value={draft.taxId} onChange={(e) => setDraft((d) => ({ ...d, taxId: e.target.value }))} maxLength={40} className={smallInput} />
        </Field>
        <Field label="Invoicing currency" hint="Leave blank to use the store base currency.">
          <select value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))} className={smallInput}>
            <option value="">Store base currency</option>
            {CURRENCIES.map((meta) => <option key={meta.code} value={meta.code}>{meta.code} · {meta.name}</option>)}
          </select>
        </Field>
        <Field label="Payment terms">
          <select value={draft.paymentTerms} onChange={(e) => setDraft((d) => ({ ...d, paymentTerms: e.target.value }))} className={smallInput}>
            {PAYMENT_TERMS.map((term) => <option key={term.id} value={term.id}>{term.label}</option>)}
          </select>
        </Field>
        <Field label="Lead time (days)">
          <input type="number" min="0" max="120" value={draft.leadTimeDays} onChange={(e) => setDraft((d) => ({ ...d, leadTimeDays: Number(e.target.value) }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Minimum order value">
          <input type="number" min="0" step="1" value={draft.minOrderValue} onChange={(e) => setDraft((d) => ({ ...d, minOrderValue: Number(e.target.value) }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Status">
          <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className={smallInput}>
            {SUPPLIER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </Field>
        <Field label="Rating (0–5)">
          <input type="number" min="0" max="5" value={draft.rating} onChange={(e) => setDraft((d) => ({ ...d, rating: Number(e.target.value) }))} className={`${smallInput} tnum`} />
        </Field>
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Delivery days</span>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              aria-pressed={draft.deliveryDays.includes(day)}
              className={`min-h-9 rounded-lg px-3 text-xs font-bold ring-1 ring-inset transition ${draft.deliveryDays.includes(day) ? 'bg-orange-500 text-white ring-orange-500' : 'bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50'}`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      <Field label="Notes">
        <textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} maxLength={400} className={`${smallInput} mt-3 resize-y`} />
      </Field>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => {
          if (!draft.name.trim()) {
            setError('A supplier needs a name.')
            return
          }
          onSave({ ...draft, id: supplier?.id || uid('sup') })
        }}
        className={`${btnPrimary} mt-4`}
      >
        {supplier ? 'Save supplier' : 'Add supplier'}
      </button>
    </Modal>
  )
}

// ─── Delivery intake ───────────────────────────────────────────────

function ReceiveModal({ supplier, onClose }) {
  const { state, dispatch } = useRestora()
  const items = state.inventory.filter((item) => item.supplierId === supplier.id)
  const [lines, setLines] = useState(() => items.slice(0, 3).map((item) => ({ inventoryItemId: item.id, qty: '', unitCost: String(item.lastCost) })))
  const [error, setError] = useState('')

  function setLine(index, patch) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  function submit() {
    const valid = lines
      .filter((line) => line.inventoryItemId && Number(line.qty) > 0)
      .map((line) => ({ inventoryItemId: line.inventoryItemId, qty: Number(line.qty), unitCost: Number(line.unitCost) }))
    if (!valid.length) {
      setError('Add at least one line with a quantity.')
      return
    }
    dispatch({
      type: 'RECEIVE_INVOICE',
      vendor: supplier.name,
      supplierId: supplier.id,
      lines: valid,
    })
    onClose()
  }

  return (
    <Modal title={`Receive delivery · ${supplier.name}`} sub="Updates on-hand, last cost, and the weighted average used by recipe costing." onClose={onClose} wide>
      <ul className="mt-4 space-y-2">
        {lines.map((line, index) => {
          const sku = state.inventory.find((item) => item.id === line.inventoryItemId)
          return (
            <li key={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-2.5">
              <select
                value={line.inventoryItemId}
                onChange={(e) => setLine(index, { inventoryItemId: e.target.value, unitCost: String(state.inventory.find((item) => item.id === e.target.value)?.lastCost ?? '') })}
                className={`${smallInput} min-w-[180px] flex-1`}
                aria-label="Stock item"
              >
                <option value="">Pick an ingredient…</option>
                {items.map((item) => <option key={item.id} value={item.id}>{item.name} · on hand {item.onHand} {item.unit}</option>)}
                {state.inventory.filter((item) => item.supplierId !== supplier.id).length > 0 && (
                  <optgroup label="Other suppliers">
                    {state.inventory.filter((item) => item.supplierId !== supplier.id).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <input
                type="number" min="0" step="any" value={line.qty} placeholder="Qty"
                onChange={(e) => setLine(index, { qty: e.target.value })}
                className={`${smallInput} tnum w-24`} aria-label="Quantity"
              />
              <input
                type="number" min="0" step="0.0001" value={line.unitCost}
                onChange={(e) => setLine(index, { unitCost: e.target.value })}
                className={`${smallInput} tnum w-28`} aria-label="Unit cost"
              />
              <span className="text-[11px] text-zinc-500">{sku ? `/${sku.unit}` : ''}</span>
              <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="rounded-lg px-2 py-1 text-zinc-400 hover:text-red-600" aria-label="Remove line">
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={() => setLines((current) => [...current, { inventoryItemId: '', qty: '', unitCost: '0' }])}
        className={`${btnGhost} mt-2`}
      >
        + Add line
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button type="button" onClick={submit} className={`${btnPrimary} mt-4`}>Post delivery to inventory</button>
    </Modal>
  )
}

// ─── Supplier detail ───────────────────────────────────────────────

function SupplierDetail({ supplier, onEdit, onDelete }) {
  const { state } = useRestora()
  const [receiving, setReceiving] = useState(false)
  const [copied, setCopied] = useState(false)
  const { invoices, total, last } = useMemo(() => supplierSpend(state, supplier), [state, supplier])

  const supplied = state.inventory.filter((item) => item.supplierId === supplier.id)
  const belowPar = supplied.filter((item) => stockStatusFor(item, state.settings) !== 'ok')

  const reorderLines = belowPar.map((item) => ({
    item,
    qty: suggestedOrderQty(item, state.settings),
    cost: suggestedOrderQty(item, state.settings) * (item.lastCost || 0),
  }))
  const reorderTotal = reorderLines.reduce((sum, line) => sum + line.cost, 0)

  function copyOrder() {
    const text = [
      `${state.settings.restaurantName} · order for ${supplier.name}`,
      `Delivery: ${supplier.deliveryDays.join(', ') || 'any'} · lead time ${supplier.leadTimeDays}d · terms ${paymentTermsLabel(supplier.paymentTerms)}`,
      '',
      ...reorderLines.map((line) => `${String(line.qty).padStart(4)} ${line.item.unit.padEnd(8)} ${line.item.name}  (last ${money(line.item.lastCost)})`),
      '',
      `Minimum order: ${money(supplier.minOrderValue)}`,
    ].join('\n')
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2500)
  }

  const mailto = `mailto:${supplier.email || ''}?subject=${encodeURIComponent(`Order · ${state.settings.restaurantName}`)}&body=${encodeURIComponent(
    reorderLines.map((line) => `${line.qty} ${line.item.unit} ${line.item.name}`).join('\n'),
  )}`

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-zinc-900">{supplier.name}</h2>
              <StatusPill tone={STATUS_TONE[supplier.status] || 'muted'} size="sm">{supplier.status}</StatusPill>
              {supplier.rating > 0 && <StatusPill tone="info" size="sm">{'★'.repeat(supplier.rating)}</StatusPill>}
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {[supplier.contactName, supplier.contactRole].filter(Boolean).join(' · ') || 'No contact on file'}
              {supplier.accountNumber ? ` · acct ${supplier.accountNumber}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setReceiving(true)} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
              Receive delivery
            </button>
            <button type="button" onClick={onEdit} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Edit</button>
            <button type="button" onClick={onDelete} className="min-h-10 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50">Delete</button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Supplied SKUs', value: supplied.length, note: `${belowPar.length} need attention` },
            { label: 'Spend on record', value: money(total), note: `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}` },
            { label: 'Payment terms', value: paymentTermsLabel(supplier.paymentTerms), note: `lead time ${supplier.leadTimeDays} day${supplier.leadTimeDays === 1 ? '' : 's'}` },
            { label: 'Delivery days', value: supplier.deliveryDays.join(' ') || 'Any', note: last ? `last drop ${new Date(last.at).toLocaleDateString()}` : 'no deliveries yet' },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-zinc-200 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{metric.label}</div>
              <div className="tnum mt-1 text-lg font-bold text-zinc-900">{metric.value}</div>
              <div className="text-[11px] text-zinc-500">{metric.note}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 text-sm text-zinc-600 sm:grid-cols-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Contact</div>
            <div className="mt-1 space-y-0.5">
              <div>{supplier.email || '—'}</div>
              <div>{supplier.phone || '—'}</div>
              <div>{supplier.website || '—'}</div>
              <div className="text-xs text-zinc-500">
                {[supplier.addressLine1, supplier.city, supplier.state, supplier.postalCode, supplier.country].filter(Boolean).join(', ') || 'No address'}
              </div>
              {supplier.taxId && <div className="text-xs text-zinc-500">Tax ID {supplier.taxId}</div>}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Notes</div>
            <p className="mt-1 text-sm leading-relaxed text-zinc-600">{supplier.notes || 'No notes yet.'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardCls} p-5`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-zinc-900">Reorder list · {reorderLines.length}</h3>
            <span className="tnum text-sm font-bold text-zinc-700">{money(reorderTotal)}</span>
          </div>
          {reorderLines.length ? (
            <>
              <ul className="mt-3 divide-y divide-zinc-100 text-sm">
                {reorderLines.map((line) => (
                  <li key={line.item.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-zinc-800">{line.item.name}</div>
                      <div className="text-[11px] text-zinc-500">
                        on hand {line.item.onHand} {line.item.unit} · reorder at {reorderPointFor(line.item, state.settings)} · par {line.item.par}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tnum font-bold text-zinc-800">{line.qty} {line.item.unit}</div>
                      <div className="tnum text-[11px] text-zinc-500">{money(line.cost)}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={copyOrder} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
                  {copied ? 'Copied ✓' : 'Copy order'}
                </button>
                <a href={mailto} className="flex min-h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
                  Email order
                </a>
                {supplier.minOrderValue > reorderTotal && (
                  <span className="self-center text-[11px] text-amber-700">
                    {money(supplier.minOrderValue - reorderTotal)} below the {money(supplier.minOrderValue)} minimum
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Everything from {supplier.name} is at or above its reorder point.</p>
          )}
        </div>

        <div className={`${cardCls} p-5`}>
          <h3 className="text-sm font-bold text-zinc-900">Delivery history · {invoices.length}</h3>
          {invoices.length ? (
            <ul className="mt-3 divide-y divide-zinc-100 text-sm">
              {[...invoices].reverse().slice(0, 8).map((invoice) => {
                const value = (invoice.lines || []).reduce((sum, line) => sum + (line.qty || 0) * (line.unitCost || 0), 0)
                return (
                  <li key={invoice.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-zinc-800">{new Date(invoice.at).toLocaleString()}</span>
                      <span className="tnum font-bold text-zinc-700">{money(value)}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {(invoice.lines || []).map((line) => {
                        const sku = state.inventory.find((item) => item.id === line.inventoryItemId)
                        return `${line.qty} × ${sku?.name || line.inventoryItemId} @ ${money(line.unitCost)}`
                      }).join(' · ')}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No deliveries recorded yet. Use <strong>Receive delivery</strong> to post one.</p>
          )}
        </div>
      </div>

      {receiving && <ReceiveModal supplier={supplier} onClose={() => setReceiving(false)} />}
    </div>
  )
}

// ─── Screen ────────────────────────────────────────────────────────

export default function SuppliersScreen() {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const sup = dict.suppliers || {}
  const [selectedId, setSelectedId] = useState(() => state.suppliers[0]?.id || null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)

  const suppliers = state.suppliers.filter((supplier) => {
    if (status !== 'all' && supplier.status !== status) return false
    if (query && !`${supplier.name} ${supplier.contactName} ${supplier.email}`.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })
  const selected = state.suppliers.find((supplier) => supplier.id === selectedId) || suppliers[0] || null

  const totals = state.inventory.reduce((acc, item) => {
    const key = item.supplierId || 'unassigned'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">{sup.kicker || 'Control'}</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{sup.title || 'Suppliers'}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {sup.subtitle || 'Vendors, terms, lead times, deliveries, and the reorder list each one owes you.'}
            {lang !== 'en' && <span className="sr-only"> Vendors, terms, lead times</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="muted" size="sm">{state.suppliers.length} {sup.title || 'suppliers'}</StatusPill>
          <StatusPill tone={(totals.unassigned || 0) > 0 ? 'warn' : 'ok'} size="sm">
            {totals.unassigned || 0} unassigned SKUs
          </StatusPill>
          <button type="button" onClick={() => setCreating(true)} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
            {sup.addSupplier || '+ New supplier'}
            {lang !== 'en' && <span className="sr-only"> + New supplier</span>}
          </button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className={`${cardCls} p-3`}>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3">
            <Icon name="search" size={16} className="text-zinc-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={sup.searchSuppliers || 'Search suppliers…'} aria-label="Search suppliers" className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm outline-none" />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${smallInput} mt-2`} aria-label="Filter status">
            <option value="all">{sup.allStatuses || 'All statuses'}</option>
            {SUPPLIER_STATUSES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          <ul className="mt-2 max-h-[62vh] space-y-1 overflow-y-auto">
            {suppliers.map((supplier) => {
              const spend = supplierSpend(state, supplier)
              return (
                <li key={supplier.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(supplier.id)}
                    aria-current={selected?.id === supplier.id}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${selected?.id === supplier.id ? 'bg-orange-50 ring-1 ring-inset ring-orange-200' : 'hover:bg-zinc-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-zinc-800">{supplier.name}</span>
                      <StatusPill tone={STATUS_TONE[supplier.status] || 'muted'} size="sm">{supplier.status}</StatusPill>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                      <span>{totals[supplier.id] || 0} SKUs · {paymentTermsLabel(supplier.paymentTerms)}</span>
                      <span className="tnum">{money(spend.total)}</span>
                    </div>
                  </button>
                </li>
              )
            })}
            {!suppliers.length && <li className="px-3 py-8 text-center text-sm text-zinc-500">No suppliers match.</li>}
          </ul>
          {(totals.unassigned || 0) > 0 && (
            <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
              {totals.unassigned} stock items have no supplier. Assign them in <strong>Catalog → Ingredients</strong> so
              reorder alerts name a vendor.
            </div>
          )}
        </div>

        <div>
          {selected ? (
            <SupplierDetail
              supplier={selected}
              onEdit={() => setEditing(true)}
              onDelete={() => {
                const used = state.inventory.filter((item) => item.supplierId === selected.id)
                const others = state.suppliers.filter((supplier) => supplier.id !== selected.id)
                if (used.length && !others.length) {
                  window.alert('This is the only supplier and it still owns stock items. Reassign them first.')
                  return
                }
                const target = used.length
                  ? window.prompt(`Move ${used.length} SKU(s) to which supplier? Enter a name:\n${others.map((s) => s.name).join(', ')}`, others[0]?.name || '')
                  : null
                if (used.length && !target) return
                const match = others.find((supplier) => supplier.name.toLowerCase() === String(target).toLowerCase())
                if (used.length && !match) {
                  window.alert('No supplier by that name — nothing changed.')
                  return
                }
                if (!window.confirm(`Delete ${selected.name}?`)) return
                dispatch({ type: 'DELETE_SUPPLIER', supplierId: selected.id, reassignTo: match?.id || null })
                setSelectedId(others[0]?.id || null)
              }}
            />
          ) : (
            <div className={`${cardCls} p-10 text-center`}>
              <h2 className="text-lg font-bold text-zinc-900">No suppliers yet</h2>
              <p className="mt-1 text-sm text-zinc-500">Add the vendors you order from to unlock reorder lists and delivery intake.</p>
            </div>
          )}
        </div>
      </div>

      {creating && (
        <SupplierModal
          onClose={() => setCreating(false)}
          onSave={(supplier) => {
            dispatch({ type: 'UPSERT_SUPPLIER', supplier })
            setSelectedId(supplier.id)
            setCreating(false)
          }}
        />
      )}
      {editing && selected && (
        <SupplierModal
          supplier={selected}
          onClose={() => setEditing(false)}
          onSave={(supplier) => {
            dispatch({ type: 'UPSERT_SUPPLIER', supplier })
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}
