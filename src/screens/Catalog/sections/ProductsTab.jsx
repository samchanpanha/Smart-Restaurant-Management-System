import { useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { DataTable } from '../../../components/ui'
import StatusPill from '../../../components/StatusPill'
import { MARGIN_BAND_META, STATIONS, STATION_META } from '../../../lib/constants'
import { translateDishName, useI18n } from '../../../lib/i18n'
import { costingFor, money, uid } from '../../../lib/models'
import { categoryOptions, categoryPath } from '../../../lib/settings'
import { useRestora } from '../../../lib/store'
import { cardCls, smallInput, cartesianFor } from '../shared.js'
import { ProductModal } from './ProductModal.jsx'

function ProductsTab() {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const cat = dict.catalog || {}
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState([])
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const invById = useMemo(() => Object.fromEntries(state.inventory.map((item) => [item.id, item])), [state.inventory])
  const options = categoryOptions(state.categories, 'menu')

  const rows = state.menu
    .map((dish) => ({ dish, cost: costingFor(dish, state.recipes[dish.id], invById, state.settings), suppliers: cartesianFor(state, dish) }))
    .filter(({ dish }) => {
      if (category !== 'all') {
        const target = options.find((option) => option.id === category)
        if (!target) return true
        if (target.depth === 0) {
          if (dish.category !== target.name) return false
        } else if (!(dish.category === target.parentName && dish.subCategory === target.name)) {
          return false
        }
      }
      if (status === '86' && dish.available) return false
      if (status === 'hidden' && dish.active !== false) return false
      if (status === 'live' && (!dish.available || dish.active === false)) return false
      if (query && !`${dish.name} ${dish.sku} ${dish.category} ${dish.subCategory}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    .sort((a, b) => a.dish.category.localeCompare(b.dish.category) || a.dish.sortOrder - b.dish.sortOrder)

  const allSelected = rows.length > 0 && selected.length === rows.length

  function applyBulk(patch) {
    for (const id of selected) dispatch({ type: 'UPDATE_MENU_ITEM', menuItemId: id, patch })
    setSelected([])
  }

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex flex-wrap items-center gap-3`}>
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-zinc-200 px-3">
          <Icon name="search" size={16} className="text-zinc-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products, SKU, category…" aria-label="Search products" className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm outline-none" />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${smallInput} w-auto`} aria-label="Filter category">
          <option value="all">All categories</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.depth ? `— ${option.parentName} › ${option.name}` : option.name}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${smallInput} w-auto`} aria-label="Filter status">
          <option value="all">Any status</option>
          <option value="live">Selling</option>
          <option value="86">86&apos;d</option>
          <option value="hidden">Hidden</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox" checked={allSelected} aria-label="Select all products"
            onChange={(e) => setSelected(e.target.checked ? rows.map((row) => row.dish.id) : [])}
            className="h-4 w-4 accent-orange-500"
          />
          Select all
        </label>
        <button type="button" onClick={() => setCreating(true)} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
          {cat.newProduct || '+ New product'}
          {lang !== 'en' && <span className="sr-only"> + New product</span>}
        </button>
      </div>

      {selected.length > 0 && (
        <div className={`${cardCls} flex flex-wrap items-center gap-2 border-orange-200 bg-orange-50/60`}>
          <span className="text-sm font-semibold text-orange-800">{selected.length} selected</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) applyBulk({ category: e.target.value, subCategory: '' }) }}
            className={`${smallInput} w-auto`} aria-label="Bulk set category"
          >
            <option value="">Move to category…</option>
            {options.filter((option) => option.depth === 0).map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}
          </select>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) applyBulk({ station: e.target.value }) }}
            className={`${smallInput} w-auto`} aria-label="Bulk set station"
          >
            <option value="">Set station…</option>
            {STATIONS.map((station) => <option key={station} value={station}>{STATION_META[station].label}</option>)}
          </select>
          <button type="button" onClick={() => applyBulk({ available: false, auto86: false })} className="min-h-10 rounded-xl border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-600 hover:bg-red-50">86 all</button>
          <button type="button" onClick={() => applyBulk({ available: true, auto86: false })} className="min-h-10 rounded-xl border border-emerald-200 bg-white px-3.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">Back on menu</button>
          <button type="button" onClick={() => setSelected([])} className="ml-auto text-xs font-semibold text-zinc-500 hover:text-zinc-800">Clear</button>
        </div>
      )}

      <DataTable
        columns={[
          {
            key: 'select',
            header: '',
            className: 'w-10',
            render: ({ dish }) => (
              <input
                type="checkbox" checked={selected.includes(dish.id)} aria-label={`Select ${dish.name}`}
                onChange={(e) => setSelected((current) => (e.target.checked ? [...current, dish.id] : current.filter((id) => id !== dish.id)))}
                className="h-4 w-4 accent-orange-500"
              />
            ),
          },
          {
            key: 'product',
            header: 'Product',
            primary: true,
            render: ({ dish }) => (
              <div className="flex items-center gap-3">
                {dish.imageUrl ? (
                  <img src={dish.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200" />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-3xs uppercase tracking-wide text-zinc-400" aria-hidden>no photo</span>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-800">
                    {translateDishName(dish, lang)}
                    {lang !== 'en' && translateDishName(dish, lang) !== dish.name && (
                      <span className="ml-1 text-xs font-normal text-zinc-500">({dish.name})</span>
                    )}
                  </div>
                  <div className="text-2xs text-zinc-500">{dish.sku || 'no SKU'}{dish.description ? ` · ${dish.description.slice(0, 40)}` : ''}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {dish.course && <StatusPill tone="muted" size="sm">{dish.course}</StatusPill>}
                    {dish.dietaryTags.slice(0, 2).map((tag) => <StatusPill key={tag} tone="ok" size="sm">{tag}</StatusPill>)}
                    {dish.allergens.length > 0 && <StatusPill tone="warn" size="sm">{dish.allergens.length} allergen(s)</StatusPill>}
                  </div>
                </div>
              </div>
            ),
          },
          { key: 'category', header: 'Category', render: ({ dish }) => <span className="text-xs text-zinc-600">{categoryPath(dish)}</span> },
          {
            key: 'price',
            header: 'Price',
            render: ({ dish }) => (
              <input
                type="number" min="0" step="0.01" value={dish.price} aria-label={`${dish.name} price`}
                onChange={(e) => dispatch({ type: 'UPDATE_MENU_ITEM', menuItemId: dish.id, patch: { price: Number(e.target.value) } })}
                className="tnum min-h-9 w-24 rounded-lg border border-zinc-200 px-2 text-sm text-zinc-800 focus:border-orange-300 focus:outline-none"
              />
            ),
          },
          { key: 'plate', header: 'Plate cost', align: 'right', render: ({ cost }) => <span className="tnum text-zinc-700">{money(cost.plate)}</span> },
          {
            key: 'contribution',
            header: 'Contribution',
            render: ({ cost }) => <StatusPill tone={MARGIN_BAND_META[cost.band].tone} size="sm">{(cost.contribution * 100).toFixed(0)}%</StatusPill>,
          },
          {
            key: 'station',
            header: 'Station',
            render: ({ dish }) => (
              <select
                value={dish.station} aria-label={`${dish.name} station`}
                onChange={(e) => dispatch({ type: 'UPDATE_MENU_ITEM', menuItemId: dish.id, patch: { station: e.target.value } })}
                className="min-h-9 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-700"
              >
                {STATIONS.map((station) => <option key={station} value={station}>{STATION_META[station].label}</option>)}
              </select>
            ),
          },
          { key: 'supply', header: 'Supply', render: ({ suppliers }) => <span className="text-2xs text-zinc-500">{suppliers.length ? suppliers.join(', ') : 'No recipe yet'}</span> },
          {
            key: 'status',
            header: 'Status',
            render: ({ dish }) => (
              <div className="flex flex-wrap gap-1">
                {!dish.available && <StatusPill tone="bad" size="sm">{dish.auto86 ? 'Auto-86' : "86'd"}</StatusPill>}
                {dish.active === false && <StatusPill tone="muted" size="sm">Hidden</StatusPill>}
                {dish.available && dish.active !== false && <StatusPill tone="ok" size="sm">Selling</StatusPill>}
              </div>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: ({ dish }) => (
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_86', menuItemId: dish.id, available: !dish.available })}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  {dish.available ? '86' : 'Restore'}
                </button>
                <button type="button" onClick={() => setEditing(dish)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                  Edit
                </button>
              </div>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.dish.id}
        empty={<div className="rounded-[var(--radius-xl)] border border-[var(--border)] px-4 py-12 text-center text-sm text-zinc-500">No products match this filter.</div>}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-zinc-500">
        <span>{rows.length} of {state.menu.length} products</span>
        <span>Plate cost follows the stock valuation method set in Settings → Stock rules.</span>
      </div>

      {creating && (
        <ProductModal
          categories={state.categories}
          onClose={() => setCreating(false)}
          onSave={(values) => {
            dispatch({
              type: 'ADD_MENU_ITEM',
              item: {
                id: uid('m'),
                ...values,
                available: true,
                sortOrder: state.menu.length,
                substituteId: null,
                modifiers: [],
              },
            })
            setCreating(false)
          }}
        />
      )}
      {editing && (
        <ProductModal
          dish={editing}
          categories={state.categories}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            dispatch({ type: 'UPDATE_MENU_ITEM', menuItemId: editing.id, patch: values })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}


export { ProductsTab }
