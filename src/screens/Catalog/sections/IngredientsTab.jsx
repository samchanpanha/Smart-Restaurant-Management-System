import { useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { DataTable } from '../../../components/ui'
import StatusPill from '../../../components/StatusPill'
import { translateInventoryName, useI18n } from '../../../lib/i18n'
import { money, reorderPointFor, stockStatusFor, uid } from '../../../lib/models'
import { categoryPath } from '../../../lib/settings'
import { describeQty, itemUnitChoices } from '../../../lib/units'
import { useRestora } from '../../../lib/store'
import { cardCls, smallInput } from '../shared.js'
import { IngredientModal } from './IngredientModal.jsx'

function IngredientsTab() {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const cat = dict.catalog || {}
  const [query, setQuery] = useState('')
  const [supplierId, setSupplierId] = useState('all')
  const [exceptionsOnly, setExceptionsOnly] = useState(false)
  const [selected, setSelected] = useState([])
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const locations = useMemo(() => [...new Set(state.inventory.map((item) => item.location))], [state.inventory])

  const rows = state.inventory
    .map((item) => ({ item, status: stockStatusFor(item, state.settings) }))
    .filter(({ item, status }) => {
      if (supplierId !== 'all' && (item.supplierId || '') !== supplierId) return false
      if (exceptionsOnly && (status === 'ok' || status === 'not_counted')) return false
      if (query && !`${item.name} ${item.sku} ${item.vendor}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })

  const allSelected = rows.length > 0 && selected.length === rows.length

  function applyBulk(patch) {
    for (const id of selected) dispatch({ type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: id, patch })
    setSelected([])
  }

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex flex-wrap items-center gap-3`}>
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-zinc-200 px-3">
          <Icon name="search" size={16} className="text-zinc-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ingredients or SKU…" aria-label="Search ingredients" className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm outline-none" />
        </label>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${smallInput} w-auto`} aria-label="Filter supplier">
          <option value="all">All suppliers</option>
          {state.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input type="checkbox" checked={exceptionsOnly} onChange={(e) => setExceptionsOnly(e.target.checked)} className="h-4 w-4 accent-orange-500" />
          Exceptions only
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox" checked={allSelected} aria-label="Select all ingredients"
            onChange={(e) => setSelected(e.target.checked ? rows.map((row) => row.item.id) : [])}
            className="h-4 w-4 accent-orange-500"
          />
          Select all
        </label>
        <button type="button" onClick={() => setCreating(true)} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
          {cat.newIngredient || '+ New ingredient'}
          {lang !== 'en' && <span className="sr-only"> + New ingredient</span>}
        </button>
      </div>

      {selected.length > 0 && (
        <div className={`${cardCls} flex flex-wrap items-center gap-2 border-orange-200 bg-orange-50/60`}>
          <span className="text-sm font-semibold text-orange-800">{selected.length} selected</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) applyBulk({ supplierId: e.target.value === '__none__' ? null : e.target.value }) }}
            className={`${smallInput} w-auto`} aria-label="Bulk set supplier"
          >
            <option value="">Assign supplier…</option>
            <option value="__none__">— unassigned —</option>
            {state.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) applyBulk({ location: e.target.value }) }}
            className={`${smallInput} w-auto`} aria-label="Bulk set storage"
          >
            <option value="">Move storage…</option>
            {locations.map((location) => <option key={location} value={location}>{String(location).replace('_', ' ')}</option>)}
          </select>
          <button type="button" onClick={() => setSelected([])} className="ml-auto text-xs font-semibold text-zinc-500 hover:text-zinc-800">Clear</button>
        </div>
      )}

      <DataTable
        columns={[
          {
            key: 'select',
            header: '',
            className: 'w-10',
            render: ({ item }) => (
              <input
                type="checkbox" checked={selected.includes(item.id)} aria-label={`Select ${item.name}`}
                onChange={(e) => setSelected((current) => (e.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))}
                className="h-4 w-4 accent-orange-500"
              />
            ),
          },
          {
            key: 'ingredient',
            header: 'Ingredient',
            primary: true,
            render: ({ item }) => (
              <div className="flex items-center gap-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200" />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-[9px] uppercase tracking-wide text-zinc-400" aria-hidden>no photo</span>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-800">
                    {translateInventoryName(item, lang)}
                    {lang !== 'en' && translateInventoryName(item, lang) !== item.name && (
                      <span className="ml-1 text-xs font-normal text-zinc-500">({item.name})</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {item.sku || 'no SKU'}
                    {(item.packs || []).length > 0 && (
                      <span className="ml-1 text-zinc-400">
                        · {itemUnitChoices(item, state.settings)
                          .filter((choice) => choice.kind === 'pack')
                          .map((choice) => `1 ${choice.label} = ${choice.factor} ${item.unit}`)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ),
          },
          { key: 'category', header: 'Category', render: ({ item }) => <span className="text-xs text-zinc-600">{categoryPath(item)}</span> },
          {
            key: 'onHand',
            header: 'On hand',
            render: ({ item }) => (
              <span className="tnum font-semibold text-zinc-800">
                {(item.packs || []).length && state.settings?.units?.showPackBreakdown !== false
                  ? describeQty(item, item.onHand, state.settings)
                  : <>{item.onHand} <span className="text-[10px] font-normal text-zinc-500">{item.unit}</span></>}
              </span>
            ),
          },
          {
            key: 'par',
            header: 'Par / reorder',
            render: ({ item }) => <span className="tnum text-xs text-zinc-600">{item.par} / {reorderPointFor(item, state.settings)}</span>,
          },
          { key: 'lastCost', header: 'Last cost', align: 'right', render: ({ item }) => <span className="tnum text-zinc-700">{money(item.lastCost)}</span> },
          {
            key: 'supplier',
            header: 'Supplier',
            render: ({ item }) => (
              <select
                value={item.supplierId || ''} aria-label={`${item.name} supplier`}
                onChange={(e) => dispatch({ type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: item.id, patch: { supplierId: e.target.value || null } })}
                className="min-h-9 max-w-[150px] rounded-lg border border-zinc-200 px-2 text-xs text-zinc-700"
              >
                <option value="">— unassigned —</option>
                {state.suppliers.map((supplierOption) => <option key={supplierOption.id} value={supplierOption.id}>{supplierOption.name}</option>)}
              </select>
            ),
          },
          { key: 'storage', header: 'Storage', render: ({ item }) => <span className="text-xs capitalize text-zinc-600">{String(item.location).replace('_', ' ')}</span> },
          {
            key: 'status',
            header: 'Status',
            render: ({ item, status }) => {
              const supplier = state.suppliers.find((entry) => entry.id === item.supplierId)
              return (
                <div>
                  <StatusPill tone={status === 'ok' ? 'ok' : status === 'low' ? 'warn' : status === 'not_counted' ? 'muted' : 'bad'} size="sm">
                    {status === 'ok' ? 'In stock' : status === 'low' ? 'Low' : status === 'not_counted' ? 'Not counted' : 'Out'}
                  </StatusPill>
                  {item.onHand < 0 && status !== 'not_counted' && <span className="ml-1 text-[10px] font-semibold text-red-600">Recount</span>}
                  {supplier && status !== 'ok' && status !== 'not_counted' && <div className="mt-1 text-[10px] text-zinc-500">order from {supplier.name}</div>}
                </div>
              )
            },
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: ({ item }) => (
              <button type="button" onClick={() => setEditing(item)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                Edit
              </button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.item.id}
        empty={<div className="rounded-[var(--radius-xl)] border border-[var(--border)] px-4 py-12 text-center text-sm text-zinc-500">No ingredients match this filter.</div>}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span>{rows.length} of {state.inventory.length} ingredients</span>
        <span>Counted truth is written by receiving, waste, and the count sheet — this table edits the record itself.</span>
      </div>

      {creating && (
        <IngredientModal
          onClose={() => setCreating(false)}
          onSave={(values) => {
            dispatch({ type: 'ADD_INVENTORY_ITEM', item: { id: uid('inv'), avgCost: values.lastCost, vendor: state.suppliers.find((s) => s.id === values.supplierId)?.name || '', active: true, ...values } })
            setCreating(false)
          }}
        />
      )}
      {editing && (
        <IngredientModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            dispatch({ type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: editing.id, patch: values })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}


export { IngredientsTab }
