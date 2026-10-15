// ─── Step 5: Inventory ────────────────────────────────────────────
// Prevent 86 and unexplained variance. On-hand is THEORETICAL — it
// drops when the kitchen fires, and only receive / waste / count
// write counted truth. Invoice costs flow straight into plate costs.

import { useMemo, useState } from 'react'
import StatusPill from '../components/StatusPill'
import { DataTable, Field, btnPrimary, inputCls } from '../components/ui'
import { translateInventoryName, useI18n } from '../lib/i18n'
import { money, plateCostFor, stockStatusFor } from '../lib/models'
import { useRestora } from '../lib/store'

const TABS = [
  { id: 'stock', label: 'Stock' },
  { id: 'receive', label: 'Receive' },
  { id: 'count', label: 'Count sheet' },
  { id: 'waste', label: 'Waste log' },
]

const WASTE_META = {
  prep: { label: 'Prep loss', tone: 'warn' },
  spoil: { label: 'Spoilage', tone: 'bad' },
  comp: { label: 'Comped', tone: 'info' },
  error: { label: 'Error', tone: 'muted' },
}

const COUNT_REASONS = ['recount confirms', 'spoilage', 'prep loss', 'unlogged waste', 'over-pour / error']

function dishesUsing(state, skuId) {
  return state.menu.filter((m) =>
    state.recipes[m.id]?.ingredients.some((ing) => ing.inventoryItemId === skuId),
  )
}

// ─── Stock list ─────────────────────────────────────────────────

function StockTab() {
  const { state } = useRestora()
  const { lang, dict } = useI18n()
  const inv = dict.inventory || {}
  const [filter, setFilter] = useState('all')
  const [loc, setLoc] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState([])
  const locs = useMemo(() => [...new Set(state.inventory.map((item) => item.location))], [state.inventory])

  const rows = state.inventory
    .map((sku) => ({ sku, st: stockStatusFor(sku, state.settings) }))
    .filter(({ sku, st }) => {
      if (loc !== 'all' && sku.location !== loc) return false
      if (query) {
        const q = query.toLowerCase()
        const localName = translateInventoryName(sku, lang).toLowerCase()
        if (!`${sku.name} ${localName} ${sku.vendor}`.toLowerCase().includes(q)) return false
      }
      if (filter === 'exceptions') return st !== 'ok' || sku.onHand < 0
      if (filter === 'low') return st === 'low'
      if (filter === 'out') return st === 'out'
      return true
    })
    .sort((a, b) => {
      const rank = (row) => (row.sku.onHand < 0 ? 0 : row.st === 'out' ? 1 : row.st === 'low' ? 2 : 3)
      return rank(a) - rank(b) || a.sku.name.localeCompare(b.sku.name)
    })

  const filters = [
    ['all', `${inv.allItems || 'All items'} (${state.inventory.length})`],
    ['exceptions', inv.exceptions || 'Exceptions'],
    ['low', inv.lowStock || 'Low stock'],
    ['out', inv.outOfStock || 'Out of stock'],
  ]

  const allSelected = rows.length > 0 && selected.length === rows.length

  function exportSelected() {
    const chosen = state.inventory.filter((item) => selected.includes(item.id))
    const header = ['Item', 'Location', 'On hand', 'Unit', 'Par', 'Last cost', 'Vendor', 'Status']
    const lines = chosen.map((item) => [item.name, item.location, item.onHand, item.unit, item.par, item.lastCost, item.vendor, stockStatusFor(item, state.settings)])
    const csv = [header, ...lines].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'restora-inventory-selection.csv'
    anchor.click()
    URL.revokeObjectURL(url)
    setSelected([])
  }

  function itemIcon(name) {
    const value = name.toLowerCase()
    if (value.includes('salmon') || value.includes('fish')) return '🐟'
    if (value.includes('chicken') || value.includes('beef') || value.includes('patty') || value.includes('steak') || value.includes('wing')) return '🥩'
    if (value.includes('tomato') || value.includes('lettuce') || value.includes('salad')) return '🥬'
    if (value.includes('cheese') || value.includes('cream') || value.includes('ice cream')) return '🧀'
    if (value.includes('bun') || value.includes('pasta') || value.includes('fries')) return '🥖'
    if (value.includes('soda') || value.includes('coffee')) return '☕'
    return '📦'
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Stock filter">
          {filters.map(([id, label]) => <button key={id} role="tab" aria-selected={filter === id} type="button" onClick={() => setFilter(id)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${filter === id ? 'bg-orange-500 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'}`}>{label}</button>)}
        </div>
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-200 px-3 lg:w-56">
            <span className="text-zinc-400" aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory..." aria-label="Search inventory" className="min-w-0 border-0 bg-transparent py-2 text-xs outline-none" />
          </label>
          <select value={loc} onChange={(event) => setLoc(event.target.value)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700" aria-label="Filter by storage location">
            <option value="all">All storage</option>
            {locs.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-2.5">
        <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
          <input
            type="checkbox" checked={allSelected} aria-label="Select all inventory items"
            onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.sku.id) : [])}
            className="h-4 w-4 accent-orange-500"
          />
          Select all
        </label>
        {selected.length > 0 && (
          <>
            <span className="text-xs font-semibold text-orange-700">{selected.length} selected</span>
            <button type="button" onClick={exportSelected} className="min-h-8 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50">Export selection</button>
            <button type="button" onClick={() => setSelected([])} className="ml-auto text-xs font-semibold text-zinc-500 hover:text-zinc-800">Clear</button>
          </>
        )}
      </div>

      <div className="px-1 py-3">
        <DataTable
          columns={[
            {
              key: 'select',
              header: '',
              className: 'w-10',
              render: ({ sku }) => (
                <input
                  type="checkbox" checked={selected.includes(sku.id)} aria-label={`Select ${sku.name}`}
                  onChange={(event) => setSelected((current) => (event.target.checked ? [...current, sku.id] : current.filter((id) => id !== sku.id)))}
                  className="h-4 w-4 accent-orange-500"
                />
              ),
            },
            {
              key: 'item',
              header: inv.item || 'Item',
              primary: true,
              render: ({ sku }) => {
                const dishes = dishesUsing(state, sku.id)
                const localName = translateInventoryName(sku, lang)
                return (
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-lg">{itemIcon(sku.name)}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-800">{localName}{lang !== 'en' && localName !== sku.name && <span className="ml-1 text-xs font-normal text-zinc-500">({sku.name})</span>}</span>
                      <span className="mt-0.5 block max-w-[260px] truncate text-3xs text-zinc-500">{sku.vendor}{dishes.length ? ` · ${dishes.length} recipes` : ''}</span>
                    </span>
                  </div>
                )
              },
            },
            { key: 'storage', header: inv.storage || 'Storage', render: ({ sku }) => <span className="text-xs capitalize text-zinc-500">{sku.location.replace('_', ' ')}</span> },
            {
              key: 'onHand',
              header: inv.currentStock || 'Current stock',
              render: ({ sku }) => (
                <span><span className={`tnum text-sm font-bold ${sku.onHand < 0 ? 'text-red-600' : 'text-zinc-800'}`}>{sku.onHand}</span><span className="ml-1 text-3xs text-zinc-500">{sku.unit}</span></span>
              ),
            },
            {
              key: 'par',
              header: inv.parLevel || 'Par level',
              render: ({ sku }) => <span className="tnum text-sm text-zinc-700">{sku.par} <span className="text-3xs text-zinc-400">{sku.unit}</span></span>,
            },
            {
              key: 'status',
              header: inv.status || 'Status',
              render: ({ sku, st }) => (
                <span>
                  <StatusPill tone={st === 'ok' ? 'ok' : st === 'low' ? 'warn' : 'bad'} size="sm">{st === 'ok' ? (inv.inStock || 'In stock') : st === 'low' ? (inv.lowStock || 'Low stock') : (inv.outOfStock || 'Out of stock')}</StatusPill>
                  {sku.onHand < 0 && <span className="ml-1 text-3xs font-semibold text-red-600">Recount</span>}
                </span>
              ),
            },
            {
              key: 'lastCost',
              header: inv.lastCost || 'Last cost',
              align: 'right',
              render: ({ sku }) => <span className="tnum text-xs font-semibold text-zinc-700">{money(sku.lastCost)} <span className="font-normal text-zinc-400">/ {sku.unit}</span></span>,
            },
          ]}
          rows={rows}
          rowKey={(row) => row.sku.id}
          empty={<div className="rounded-[var(--radius-xl)] border border-[var(--border)] px-6 py-14 text-center text-sm text-zinc-500">Nothing matches this filter.</div>}
        />
      </div>
      <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 text-2xs text-zinc-500"><span>Showing {rows.length} of {state.inventory.length} inventory items</span><span>On-hand is theoretical · actions update live</span></div>
    </div>
  )
}

// ─── Receive invoice ────────────────────────────────────────────

function ReceiveTab({ onDone }) {
  const { state, dispatch } = useRestora()
  const [vendor, setVendor] = useState('')
  const [lines, setLines] = useState([{ skuId: state.inventory[0]?.id || '', qty: '', unitCost: '' }])

  const vendors = useMemo(() => [...new Set(state.inventory.map((i) => i.vendor))], [state.inventory])
  const invById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])

  function setLine(idx, patch) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const valid = lines.filter((l) => l.skuId && Number(l.qty) > 0 && Number(l.unitCost) >= 0 && l.unitCost !== '')

  // Cost impact: dishes whose plate cost moves with these new unit costs
  const impact = useMemo(() => {
    const nextCosts = {}
    for (const l of valid) nextCosts[l.skuId] = Number(l.unitCost)
    if (!Object.keys(nextCosts).length) return []
    const out = []
    const hypoById = { ...invById }
    for (const [id, cost] of Object.entries(nextCosts)) {
      hypoById[id] = { ...hypoById[id], lastCost: cost }
    }
    for (const m of state.menu) {
      const recipe = state.recipes[m.id]
      if (!recipe) continue
      const uses = recipe.ingredients.some((ing) => nextCosts[ing.inventoryItemId] != null)
      if (!uses) continue
      const before = plateCostFor(recipe, invById)
      const after = plateCostFor(recipe, hypoById)
      if (Math.abs(before - after) > 0.001) out.push({ menu: m, before, after })
    }
    return out
  }, [valid, invById, state.menu, state.recipes])

  function submit() {
    if (!valid.length) return
    dispatch({
      type: 'RECEIVE_INVOICE',
      vendor: vendor.trim() || invById[valid[0].skuId]?.vendor || 'Vendor',
      lines: valid.map((l) => ({ inventoryItemId: l.skuId, qty: Number(l.qty), unitCost: Number(l.unitCost) })),
    })
    setVendor('')
    setLines([{ skuId: state.inventory[0]?.id || '', qty: '', unitCost: '' }])
    onDone(`Invoice received — ${valid.length} line${valid.length === 1 ? '' : 's'} update stock + live plate costs.`)
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">New invoice</h3>
        <div className="mt-3 space-y-3">
          <Field label="Vendor">
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} list="vendors" placeholder="Harbor Fish" className={inputCls} maxLength={40} />
            <datalist id="vendors">
              {vendors.map((v) => <option key={v} value={v} />)}
            </datalist>
          </Field>
          {lines.map((l, i) => {
            const sku = invById[l.skuId]
            return (
              <div key={i} className="rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 sm:col-span-5">
                    <Field label="SKU">
                      <select value={l.skuId} onChange={(e) => setLine(i, { skuId: e.target.value, unitCost: String(invById[e.target.value]?.lastCost ?? '') })} className={inputCls}>
                        {state.inventory.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <Field label={`Qty (${sku?.unit || ''})`}>
                      <input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="0" className={inputCls} />
                    </Field>
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <Field label={`Unit $ (was ${money(sku?.lastCost ?? 0)})`}>
                      <input type="number" min="0" step="any" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} placeholder="0.00" className={inputCls} />
                    </Field>
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex items-end">
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      disabled={lines.length === 1}
                      className="flex h-[44px] w-full items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-lg text-zinc-400 hover:text-red-300 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, { skuId: state.inventory[0]?.id || '', qty: '', unitCost: '' }])}
              className="min-h-[44px] flex-1 rounded-lg border border-[var(--color-ink-600)] text-sm text-zinc-300 hover:bg-white/5"
            >
              + Add line
            </button>
          </div>

          {impact.length > 0 && (
            <div className="rounded-xl bg-sky-500/10 p-3 ring-1 ring-inset ring-sky-500/30">
              <div className="text-2xs font-bold uppercase tracking-widest text-sky-300">
                Plate-cost impact · live on save
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {impact.map(({ menu, before, after }) => (
                  <li key={menu.id} className="flex justify-between gap-2 text-zinc-300">
                    <span>{menu.name}</span>
                    <span className="tnum">
                      {money(before)} → <strong className={after > before ? 'text-red-300' : 'text-emerald-300'}>{money(after)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" disabled={!valid.length} onClick={submit} className={btnPrimary}>
            {valid.length ? `Receive ${valid.length} line${valid.length === 1 ? '' : 's'}` : 'Add a line to receive'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          Recent invoices · {state.invoiceLog.length}
        </h3>
        <ul className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto">
          {[...state.invoiceLog].reverse().map((inv) => {
            const total = inv.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0)
            return (
              <li key={inv.id} className="rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-zinc-100">{inv.vendor}</span>
                  <span className="tnum font-bold text-zinc-200">{money(total)}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {new Date(inv.at).toLocaleString()} · {inv.lines.map((l) => `${l.qty}× ${invById[l.inventoryItemId]?.name || '?'} @ ${money(l.unitCost)}`).join(' · ')}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ─── Count sheet ────────────────────────────────────────────────

function CountTab({ onDone }) {
  const { state, dispatch } = useRestora()
  const [counts, setCounts] = useState({}) // skuId -> { counted: string, reason: string }
  const [missingReason, setMissingReason] = useState(false)

  function entry(skuId) {
    return counts[skuId] || { counted: '', reason: '' }
  }

  const rows = state.inventory.map((sku) => {
    const e = entry(sku.id)
    const hasCount = e.counted !== '' && !Number.isNaN(Number(e.counted))
    const variance = hasCount ? Number(e.counted) - sku.onHand : 0
    return { sku, e, hasCount, variance, varianceValue: variance * (sku.lastCost || 0) }
  })
  const countedRows = rows.filter((r) => r.hasCount)
  const totalVarianceValue = countedRows.reduce((s, r) => s + r.varianceValue, 0)
  const needsReason = countedRows.filter((r) => Math.abs(r.variance) > 0.001 && !r.e.reason)

  function submit() {
    if (!countedRows.length) return
    if (needsReason.length) {
      setMissingReason(true)
      return
    }
    const payload = {}
    for (const r of countedRows) payload[r.sku.id] = Number(r.e.counted)
    dispatch({ type: 'COUNT_STOCK', counts: payload })
    setCounts({})
    setMissingReason(false)
    onDone(`Count saved — ${countedRows.length} SKUs reconciled (variance ${money(totalVarianceValue)}).`)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3">
        <div className="text-sm text-zinc-400">
          Counted <strong className="text-zinc-100">{countedRows.length}</strong> of {rows.length} SKUs
          {' · '}variance <strong className={`tnum ${totalVarianceValue < 0 ? 'text-red-300' : 'text-zinc-100'}`}>{money(totalVarianceValue)}</strong>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!countedRows.length}
          className="min-h-[44px] rounded-lg bg-amber-500 px-5 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40"
        >
          Save count
        </button>
      </div>

      {missingReason && needsReason.length > 0 && (
        <div className="rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-200 ring-1 ring-inset ring-red-500/40" role="alert">
          {needsReason.length} variance{needsReason.length === 1 ? ' needs' : 's need'} a reason before saving.
        </div>
      )}

      <ul className="space-y-2">
        {rows.map(({ sku, e, hasCount, variance, varianceValue }) => {
          const off = hasCount && Math.abs(variance) > 0.001
          return (
            <li
              key={sku.id}
              className={`rounded-2xl border bg-[var(--color-ink-900)] p-3.5 ${off ? 'border-amber-500/50' : 'border-[var(--color-ink-700)]'}`}
            >
              <div className="grid items-center gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <div className="text-sm font-semibold text-zinc-100">{sku.name}</div>
                  <div className="text-2xs text-zinc-500">{sku.unit} · {money(sku.lastCost)} each</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-3xs font-semibold uppercase tracking-widest text-zinc-500">theoretical</div>
                  <div className="tnum text-lg font-bold">{sku.onHand}</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-3xs font-semibold uppercase tracking-widest text-zinc-500">counted</div>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={e.counted}
                    onChange={(ev) => setCounts((c) => ({ ...c, [sku.id]: { ...entry(sku.id), counted: ev.target.value } }))}
                    placeholder="—"
                    aria-label={`Counted quantity for ${sku.name}`}
                    className={`${inputCls} tnum`}
                  />
                </div>
                <div className="sm:col-span-2">
                  <div className="text-3xs font-semibold uppercase tracking-widest text-zinc-500">variance</div>
                  <div className={`tnum text-lg font-bold ${!hasCount ? 'text-zinc-600' : off ? (variance < 0 ? 'text-red-300' : 'text-sky-300') : 'text-emerald-300'}`}>
                    {hasCount ? `${variance > 0 ? '+' : ''}${Math.round(variance * 100) / 100}` : '—'}
                  </div>
                  {hasCount && off && (
                    <div className="tnum text-2xs text-zinc-500">{money(varianceValue)}</div>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <div className="text-3xs font-semibold uppercase tracking-widest text-zinc-500">reason {off ? '*' : ''}</div>
                  {off ? (
                    <select
                      value={e.reason}
                      onChange={(ev) => setCounts((c) => ({ ...c, [sku.id]: { ...entry(sku.id), reason: ev.target.value } }))}
                      className={`${inputCls} ${missingReason && !e.reason ? 'border-red-500/60' : ''}`}
                      aria-label={`Variance reason for ${sku.name}`}
                    >
                      <option value="">Pick…</option>
                      {COUNT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <div className="py-2.5 text-xs text-zinc-600">{hasCount ? 'matches' : 'skip to leave'}</div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Waste log ──────────────────────────────────────────────────

function WasteTab({ onDone }) {
  const { state, dispatch } = useRestora()
  const [skuId, setSkuId] = useState(state.inventory[0]?.id || '')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('spoil')

  const invById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])
  const wasteValue = (w) => w.qty * (invById[w.inventoryItemId]?.lastCost || 0)
  const total = state.wasteLog.reduce((s, w) => s + wasteValue(w), 0)

  function submit() {
    if (!skuId || !(Number(qty) > 0)) return
    dispatch({ type: 'LOG_WASTE', inventoryItemId: skuId, qty: Number(qty), reason })
    setQty('')
    onDone(`Waste logged — ${qty}× ${invById[skuId]?.name} (${WASTE_META[reason].label}).`)
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-3">
      <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Log waste</h3>
        <div className="mt-3 space-y-3">
          <Field label="SKU">
            <select value={skuId} onChange={(e) => setSkuId(e.target.value)} className={inputCls}>
              {state.inventory.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.onHand} {s.unit} on hand</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Qty">
              <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={inputCls} />
            </Field>
            <Field label="Reason">
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
                {Object.entries(WASTE_META).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          {skuId && Number(qty) > 0 && (
            <div className="tnum rounded-xl bg-black/30 px-3 py-2 text-right text-sm text-zinc-300 ring-1 ring-inset ring-[var(--color-ink-700)]">
              ≈ {money(Number(qty) * (invById[skuId]?.lastCost || 0))} at last cost
            </div>
          )}
          <button type="button" disabled={!(Number(qty) > 0)} onClick={submit} className={btnPrimary}>
            Log waste
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4 xl:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
            Logged waste · {state.wasteLog.length} entries
          </h3>
          <span className="tnum text-lg font-bold text-red-300">{money(total)}</span>
        </div>
        <ul className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto">
          {[...state.wasteLog].reverse().map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-ink-800)] px-3 py-2.5 ring-1 ring-inset ring-[var(--color-ink-600)]">
              <div className="text-sm">
                <span className="font-semibold text-zinc-100">{w.qty}× {invById[w.inventoryItemId]?.name || '?'}</span>
                <span className="ml-2 text-xs text-zinc-500">{new Date(w.at).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="tnum text-sm text-zinc-300">{money(wasteValue(w))}</span>
                <StatusPill tone={WASTE_META[w.reason]?.tone || 'muted'} size="sm">
                  {WASTE_META[w.reason]?.label || w.reason}
                </StatusPill>
              </div>
            </li>
          ))}
          {state.wasteLog.length === 0 && (
            <li className="text-sm text-zinc-500">No waste logged. (Suspiciously clean — the count sheet keeps it honest.)</li>
          )}
        </ul>
      </div>
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function InventoryScreen() {
  const { state } = useRestora()
  const { lang, dict } = useI18n()
  const inv = dict.inventory || {}
  const [tab, setTab] = useState('stock')
  const [banner, setBanner] = useState(null)

  function flash(msg) {
    setBanner(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setBanner(null), 4200)
  }

  const low = state.inventory.filter((item) => stockStatusFor(item, state.settings) === 'low').length
  const out = state.inventory.filter((item) => stockStatusFor(item, state.settings) === 'out').length
  const inventoryValue = state.inventory.reduce((sum, item) => sum + Math.max(0, item.onHand) * item.lastCost, 0)
  const belowPar = state.inventory.filter((item) => item.onHand < item.par).length

  function downloadReport() {
    const header = ['Item', 'Location', 'On hand', 'Unit', 'Par', 'Last cost', 'Vendor', 'Status']
    const lines = state.inventory.map((item) => [item.name, item.location, item.onHand, item.unit, item.par, item.lastCost, item.vendor, stockStatusFor(item, state.settings)])
    const csv = [header, ...lines].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'restora-inventory.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const metrics = [
    { label: inv.totalItems || 'Total items', value: state.inventory.length, note: 'Tracked SKUs', icon: '▧', tone: 'orange' },
    { label: inv.lowStock || 'Low stock', value: low, note: `${belowPar} items below par`, icon: '!', tone: 'amber' },
    { label: inv.outOfStock || 'Out of stock', value: out, note: out ? 'Replenishment needed' : 'Everything available', icon: '◉', tone: 'red' },
    { label: inv.inventoryValue || 'Inventory value', value: money(inventoryValue), note: 'At last invoice cost', icon: '$', tone: 'green' },
  ]

  const tabLabels = {
    stock: inv.stockTab || 'Stock',
    receive: inv.receiveTab || 'Receive',
    count: inv.countTab || 'Count sheet',
    waste: inv.wasteTab || 'Waste log',
  }

  const iconTone = {
    orange: 'bg-orange-50 text-orange-600',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-600',
    green: 'bg-emerald-50 text-emerald-700',
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">
            {inv.kicker || 'Stock control'}
            {lang !== 'en' && <span className="sr-only"> Stock control</span>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{inv.title || 'Inventory'}</h1>
          <p className="mt-1 text-sm text-zinc-500">{inv.subtitle || 'Track stock, monitor usage, and prevent waste.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTab('receive')} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-orange-600">
            {inv.receiveStock || '＋ Receive stock'}
          </button>
          <button type="button" onClick={downloadReport} className="min-h-10 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
            {inv.downloadReport || '↓ Download report'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map((item) => <div key={item.label} className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold ${iconTone[item.tone]}`}>{item.icon}</span><span className="text-xs font-medium text-zinc-500">{item.label}</span></div><div className="tnum mt-3 text-2xl font-bold text-zinc-900">{item.value}</div><div className="mt-1 text-2xs text-zinc-500">{item.note}</div></div>)}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800"><span className="mt-0.5 text-base" aria-hidden="true">ⓘ</span><p>On-hand is <strong>theoretical</strong> — it drops when the kitchen fires. Counted truth is written only by receiving, waste, or the count sheet. Par alerts surface 2 hours before the {state.settings.rushHour}:00 rush.</p></div>

      {banner && <div className="animate-status-in rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{banner}</div>}

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Inventory sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors ${tab === item.id ? 'bg-orange-500 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'}`}
          >
            {tabLabels[item.id] || item.label}
            {lang !== 'en' && <span className="sr-only"> {item.label}</span>}
            {item.id === 'stock' && belowPar > 0 && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-3xs ${tab === item.id ? 'bg-white/20 text-white' : 'bg-orange-50 text-orange-700'}`}>{belowPar}</span>}
          </button>
        ))}
      </div>

      {tab === 'stock' && <StockTab />}
      {tab === 'receive' && <ReceiveTab onDone={flash} />}
      {tab === 'count' && <CountTab onDone={flash} />}
      {tab === 'waste' && <WasteTab onDone={flash} />}
    </div>
  )
}
