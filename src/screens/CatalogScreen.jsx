// ─── Catalog: categories, sub-categories, products, ingredients ─────
// The merchandising back office. One tree owns the naming (category →
// sub-category) and everything else points at it: menu items, stock
// items, and the documents that print their labels.
//
//   Categories  · the tree, both for the menu and for stock
//   Products    · menu items: price, station, category, supplier line-up
//   Ingredients · stock items: par, reorder point, supplier, storage

import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import { Field, Modal, btnGhost, btnPrimary } from '../components/ui'
import { MARGIN_BAND_META, STATIONS, STATION_META } from '../lib/constants'
import { costingFor, money, reorderPointFor, stockStatusFor, uid } from '../lib/models'
import { CATEGORY_KINDS, categoryOptions, categoryPath, categoryTree } from '../lib/settings'
import { describeQty, itemUnitChoices, slugUnitId } from '../lib/units'
import { ChipPicker, PhotoField } from '../components/ItemPhotoField'
import { useRestora } from '../lib/store'

const TABS = [
  { id: 'categories', label: 'Categories' },
  { id: 'products', label: 'Products' },
  { id: 'ingredients', label: 'Ingredients' },
]

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm'
const smallInput = 'w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'

function cartesianFor(state, dish) {
  const recipe = state.recipes[dish.id]
  const suppliers = new Set()
  for (const ingredient of recipe?.ingredients || []) {
    const sku = state.inventory.find((item) => item.id === ingredient.inventoryItemId)
    const supplier = state.suppliers.find((entry) => entry.id === sku?.supplierId)
    if (supplier) suppliers.add(supplier.name)
  }
  return [...suppliers]
}

// ─── Categories ────────────────────────────────────────────────────

function CategoryEditor({ kind, node, categories, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(() => ({
    id: node?.id || '',
    kind,
    name: node?.name || '',
    parentId: node?.parentId || '',
    description: node?.description || '',
    station: node?.station || 'pantry',
    color: node?.color || '',
    sortOrder: node?.sortOrder ?? 0,
    active: node?.active !== false,
  }))
  const [error, setError] = useState('')
  const [moveTo, setMoveTo] = useState('')

  const parents = categoryOptions(categories, kind).filter((option) => option.depth === 0 && option.id !== node?.id)
  const hasChildren = (categories || []).some((category) => category.parentId === node?.id)

  function save() {
    if (!draft.name.trim()) {
      setError('Give the category a name.')
      return
    }
    onSave({ ...draft, id: draft.id || `cat_${kind}_${Date.now().toString(36)}`, parentId: draft.parentId || null, sortOrder: Number(draft.sortOrder) || 0 })
  }

  return (
    <Modal title={node ? `Edit ${node.name}` : `New ${kind === 'menu' ? 'menu' : 'stock'} category`} sub="Sub-categories nest one level: Mains › Pasta." onClose={onClose} wide>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Name · required">
          <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={40} className={smallInput} />
        </Field>
        <Field label="Parent category" hint="Leave empty for a top-level category.">
          <select value={draft.parentId} onChange={(e) => setDraft((d) => ({ ...d, parentId: e.target.value }))} className={smallInput} disabled={hasChildren}>
            <option value="">— Top level —</option>
            {parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
          </select>
        </Field>
        <Field label="Default station" hint="Where dishes in this category fire by default.">
          <select value={draft.station} onChange={(e) => setDraft((d) => ({ ...d, station: e.target.value }))} className={smallInput}>
            {STATIONS.map((station) => <option key={station} value={station}>{STATION_META[station].label}</option>)}
          </select>
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-2">
            <input type="color" value={draft.color || '#f36a21'} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))} className="h-10 w-12 rounded-lg border border-zinc-200 bg-white p-1" aria-label="Category color" />
            <input value={draft.color} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))} maxLength={7} className={smallInput} placeholder="#f36a21" />
          </div>
        </Field>
        <Field label="Sort order">
          <input type="number" min="0" value={draft.sortOrder} onChange={(e) => setDraft((d) => ({ ...d, sortOrder: Number(e.target.value) }))} className={smallInput} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-zinc-700">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} className="h-4 w-4 accent-orange-500" />
          Visible in pickers
        </label>
      </div>
      <Field label="Description">
        <textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={2} maxLength={200} className={`${smallInput} mt-3 min-h-[70px] resize-y`} />
      </Field>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {node ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Move items to</span>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`${smallInput} min-w-[180px]`}>
                <option value="">— none (blocked) —</option>
                {categoryOptions(categories, kind).filter((option) => option.id !== node.id && option.depth <= 1).map((option) => (
                  <option key={option.id} value={option.id}>{option.depth ? `${option.parentName} › ` : ''}{option.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => onDelete(node.id, moveTo || null)}
              className="min-h-10 rounded-xl border border-red-200 px-3.5 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              Delete category
            </button>
          </div>
        ) : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`${btnGhost} w-auto px-4`}>Cancel</button>
          <button type="button" onClick={save} className={`${btnPrimary} w-auto px-5`}>{node ? 'Save category' : 'Create category'}</button>
        </div>
      </div>
    </Modal>
  )
}

function CategoriesTab({ banner }) {
  const { state, dispatch } = useRestora()
  const [kind, setKind] = useState('menu')
  const [editing, setEditing] = useState(null)
  const tree = useMemo(() => categoryTree(state.categories, kind), [state.categories, kind])
  const options = categoryOptions(state.categories, kind)

  function itemCount(category) {
    if (kind === 'menu') {
      return state.menu.filter((item) => item.category === category.name
        || (category.parentId && item.category === state.categories.find((c) => c.id === category.parentId)?.name && item.subCategory === category.name)).length
    }
    return state.inventory.filter((item) => item.category === category.name || item.subCategory === category.name).length
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5" role="tablist" aria-label="Category kind">
            {CATEGORY_KINDS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={kind === entry.id}
                onClick={() => setKind(entry.id)}
                className={`min-h-9 rounded-lg px-3.5 text-sm font-semibold ${kind === entry.id ? 'bg-orange-500 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setEditing({ kind, node: null })} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
            + New {kind === 'menu' ? 'menu' : 'stock'} category
          </button>
        </div>

        {!tree.length && (
          <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500">
            No {kind} categories yet. Create a top-level category, then nest sub-categories under it.
          </p>
        )}

        <ul className="space-y-2">
          {tree.map((root) => (
            <li key={root.id} className="rounded-xl border border-zinc-200">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-inset ring-black/5" style={{ background: root.color || '#f6f7f9' }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-zinc-800">{root.name}</span>
                      {!root.active && <StatusPill tone="muted" size="sm">Hidden</StatusPill>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {STATION_META[root.station]?.label || root.station} · {itemCount(root)} item{itemCount(root) === 1 ? '' : 's'}
                      {root.children.length ? ` · ${root.children.length} sub-categor${root.children.length === 1 ? 'y' : 'ies'}` : ''}
                      {root.description ? ` · ${root.description}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setEditing({ kind, node: root })} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">Edit</button>
                  <button
                    type="button"
                    onClick={() => setEditing({ kind, node: { ...root, parentId: root.id, id: '', name: '' } })}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    + Sub
                  </button>
                </div>
              </div>
              {root.children.length > 0 && (
                <ul className="space-y-1 border-t border-zinc-100 px-3.5 py-2.5">
                  {root.children.map((child) => (
                    <li key={child.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-zinc-700">
                          <span className="text-zinc-300" aria-hidden>└</span>
                          <span className="truncate font-semibold">{child.name}</span>
                          {!child.active && <StatusPill tone="muted" size="sm">Hidden</StatusPill>}
                        </div>
                        <div className="mt-0.5 pl-5 text-[11px] text-zinc-500">
                          {STATION_META[child.station]?.label || child.station} · {itemCount(child)} item{itemCount(child) === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button type="button" onClick={() => setEditing({ kind, node: child })} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-white">Edit</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <div className={cardCls}>
          <h2 className="text-sm font-bold text-zinc-900">How categories are used</h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-zinc-600">
            <li>• Menu items store a <strong>category</strong> and an optional <strong>sub-category</strong> name.</li>
            <li>• The SQLite projection keeps the same tree, so <code className="rounded bg-zinc-100 px-1">/api/categories</code> answers with the nesting.</li>
            <li>• Reports group sales by top-level category; the guest QR menu groups by the same names.</li>
            <li>• Renaming a category re-labels its items everywhere. Deleting one asks where its items should move.</li>
          </ul>
        </div>
        <div className={cardCls}>
          <h2 className="text-sm font-bold text-zinc-900">Coverage</h2>
          <div className="mt-3 space-y-2">
            {options.map((option) => (
              <div key={option.id} className="flex items-center justify-between text-xs text-zinc-600">
                <span>{option.depth ? `— ${option.name}` : option.name}</span>
                <span className="tnum font-semibold text-zinc-800">
                  {kind === 'menu'
                    ? state.menu.filter((item) => item.category === option.name || item.subCategory === option.name).length
                    : state.inventory.filter((item) => item.category === option.name || item.subCategory === option.name).length}
                </span>
              </div>
            ))}
          </div>
          {banner}
        </div>
      </div>

      {editing && (
        <CategoryEditor
          kind={editing.kind}
          node={editing.node && editing.node.id ? editing.node : (editing.node?.parentId ? { parentId: editing.node.parentId } : null)}
          categories={state.categories}
          onClose={() => setEditing(null)}
          onSave={(category) => {
            dispatch({ type: 'UPSERT_CATEGORY', category })
            setEditing(null)
          }}
          onDelete={(categoryId, moveTo) => {
            const ok = dispatch({ type: 'DELETE_CATEGORY', categoryId, moveTo })
            setEditing(null)
            return ok
          }}
        />
      )}
    </div>
  )
}

// ─── Products (menu items) ─────────────────────────────────────────

function ProductModal({ dish, categories, onClose, onSave }) {
  const { state } = useRestora()
  const food = state.settings.food
  const [draft, setDraft] = useState(() => ({
    name: dish?.name || '',
    description: dish?.description || '',
    category: dish?.category || 'Mains',
    subCategory: dish?.subCategory || '',
    price: dish ? String(dish.price) : '',
    station: dish?.station || food.stations[0] || 'grill',
    sku: dish?.sku || '',
    active: dish?.active !== false,
    imageUrl: dish?.imageUrl || '',
    dietaryTags: dish?.dietaryTags || [],
    allergens: dish?.allergens || [],
    course: dish?.course || food.defaultCourse,
    menuWindow: dish?.menuWindow || '',
    spiceLevel: dish?.spiceLevel || '',
  }))
  const [error, setError] = useState('')
  const options = categoryOptions(categories, 'menu')
  const toggleIn = (key, value) => setDraft((current) => ({
    ...current,
    [key]: current[key].includes(value) ? current[key].filter((entry) => entry !== value) : [...current[key], value],
  }))
  const parents = options.filter((option) => option.depth === 0)
  const subs = options.filter((option) => option.depth === 1 && option.parentName === draft.category)
  const subOptions = subs.length
    ? subs
    : categoryTree(categories, 'menu').filter((root) => root.name === draft.category).flatMap((root) => root.children).map((child) => ({ id: child.id, name: child.name }))

  function save() {
    const price = Number(draft.price)
    if (!draft.name.trim() || !draft.category) {
      setError('Name and category are required.')
      return
    }
    if (!Number.isFinite(price) || price < 0 || price > 999999.99) {
      setError('Enter a valid price between 0 and 999,999.99.')
      return
    }
    onSave({
      name: draft.name.trim(),
      description: draft.description.trim(),
      category: draft.category,
      subCategory: draft.subCategory,
      price,
      station: draft.station,
      sku: draft.sku.trim(),
      active: draft.active,
      imageUrl: draft.imageUrl.trim(),
      dietaryTags: draft.dietaryTags,
      allergens: draft.allergens,
      course: draft.course,
      menuWindow: draft.menuWindow,
      spiceLevel: draft.spiceLevel,
    })
  }

  return (
    <Modal
      title={dish ? `Edit ${dish.name}` : 'New product'}
      sub={dish ? 'Changes apply to the ticket composer, QR menu, and documents.' : 'New dishes start with an empty recipe — add ingredients in Menu & Recipes.'}
      onClose={onClose}
      wide
    >
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Product name · required">
          <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={60} className={smallInput} />
        </Field>
        <Field label="SKU / PLU">
          <input value={draft.sku} onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))} maxLength={40} className={smallInput} />
        </Field>
        <Field label="Category · required">
          <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value, subCategory: '' }))} className={smallInput}>
            {parents.map((parent) => <option key={parent.id} value={parent.name}>{parent.name}</option>)}
            {!parents.length && <option value="Mains">Mains</option>}
          </select>
        </Field>
        <Field label="Sub-category">
          <select value={draft.subCategory} onChange={(e) => setDraft((d) => ({ ...d, subCategory: e.target.value }))} className={smallInput}>
            <option value="">— none —</option>
            {subOptions.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}
          </select>
        </Field>
        <Field label="Price">
          <input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Kitchen station">
          <select value={draft.station} onChange={(e) => setDraft((d) => ({ ...d, station: e.target.value }))} className={smallInput}>
            {food.stations.map((station) => <option key={station} value={station}>{STATION_META[station]?.label || station}</option>)}
          </select>
        </Field>
        <Field label="Course">
          <select value={draft.course} onChange={(e) => setDraft((d) => ({ ...d, course: e.target.value }))} className={smallInput}>
            <option value="">— none —</option>
            {food.courses.map((course) => <option key={course} value={course}>{course}</option>)}
          </select>
        </Field>
        <Field label="Served during">
          <select value={draft.menuWindow} onChange={(e) => setDraft((d) => ({ ...d, menuWindow: e.target.value }))} className={smallInput}>
            <option value="">All service</option>
            {food.menuWindows.map((window) => (
              <option key={window.id} value={window.id}>{window.label} · {window.from}–{window.to}</option>
            ))}
          </select>
        </Field>
        <Field label="Spice level">
          <select value={draft.spiceLevel} onChange={(e) => setDraft((d) => ({ ...d, spiceLevel: e.target.value }))} className={smallInput}>
            <option value="">— none —</option>
            {food.spiceLevels.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <PhotoField value={draft.imageUrl} onChange={(value) => setDraft((current) => ({ ...current, imageUrl: value }))} maxKb={food.imageMaxKb} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ChipPicker
          label="Dietary tags"
          options={food.dietaryTags}
          selected={draft.dietaryTags}
          onToggle={(value) => toggleIn('dietaryTags', value)}
          empty="Add tags in Settings → Food & menu."
        />
        <ChipPicker
          label="Allergens"
          options={food.allergens}
          selected={draft.allergens}
          onToggle={(value) => toggleIn('allergens', value)}
          empty="Add allergens in Settings → Food & menu."
        />
      </div>
      <Field label="Guest-facing description">
        <textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={3} maxLength={240} className={`${smallInput} mt-3 min-h-[84px] resize-y`} />
      </Field>
      <label className="mt-3 flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} className="h-4 w-4 accent-orange-500" />
        Sellable (uncheck to hide without 86-ing)
      </label>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button type="button" onClick={save} className={`${btnPrimary} mt-4`}>{dish ? 'Save product' : 'Add product'}</button>
    </Modal>
  )
}

function ProductsTab() {
  const { state, dispatch } = useRestora()
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
        <button type="button" onClick={() => setCreating(true)} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
          + New product
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

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-50 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox" checked={allSelected} aria-label="Select all products"
                    onChange={(e) => setSelected(e.target.checked ? rows.map((row) => row.dish.id) : [])}
                    className="h-4 w-4 accent-orange-500"
                  />
                </th>
                <th className="px-3 py-3">Product</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Price</th>
                <th className="px-3 py-3">Plate cost</th>
                <th className="px-3 py-3">Contribution</th>
                <th className="px-3 py-3">Station</th>
                <th className="px-3 py-3">Supply</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(({ dish, cost, suppliers }) => (
                <tr key={dish.id} className="hover:bg-orange-50/30">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox" checked={selected.includes(dish.id)} aria-label={`Select ${dish.name}`}
                      onChange={(e) => setSelected((current) => (e.target.checked ? [...current, dish.id] : current.filter((id) => id !== dish.id)))}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      {dish.imageUrl ? (
                        <img src={dish.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200" />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-[9px] uppercase tracking-wide text-zinc-400" aria-hidden>no photo</span>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-zinc-800">{dish.name}</div>
                        <div className="text-[11px] text-zinc-500">{dish.sku || 'no SKU'}{dish.description ? ` · ${dish.description.slice(0, 40)}` : ''}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {dish.course && <StatusPill tone="muted" size="sm">{dish.course}</StatusPill>}
                          {dish.dietaryTags.slice(0, 2).map((tag) => <StatusPill key={tag} tone="ok" size="sm">{tag}</StatusPill>)}
                          {dish.allergens.length > 0 && <StatusPill tone="warn" size="sm">{dish.allergens.length} allergen(s)</StatusPill>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-zinc-600">{categoryPath(dish)}</td>
                  <td className="px-3 py-3">
                    <input
                      type="number" min="0" step="0.01" value={dish.price} aria-label={`${dish.name} price`}
                      onChange={(e) => dispatch({ type: 'UPDATE_MENU_ITEM', menuItemId: dish.id, patch: { price: Number(e.target.value) } })}
                      className="tnum min-h-9 w-24 rounded-lg border border-zinc-200 px-2 text-sm text-zinc-800 focus:border-orange-300 focus:outline-none"
                    />
                  </td>
                  <td className="tnum px-3 py-3 text-zinc-700">{money(cost.plate)}</td>
                  <td className="px-3 py-3">
                    <StatusPill tone={MARGIN_BAND_META[cost.band].tone} size="sm">{(cost.contribution * 100).toFixed(0)}%</StatusPill>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={dish.station} aria-label={`${dish.name} station`}
                      onChange={(e) => dispatch({ type: 'UPDATE_MENU_ITEM', menuItemId: dish.id, patch: { station: e.target.value } })}
                      className="min-h-9 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-700"
                    >
                      {STATIONS.map((station) => <option key={station} value={station}>{STATION_META[station].label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-[11px] text-zinc-500">{suppliers.length ? suppliers.join(', ') : 'No recipe yet'}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {!dish.available && <StatusPill tone="bad" size="sm">{dish.auto86 ? 'Auto-86' : "86'd"}</StatusPill>}
                      {dish.active === false && <StatusPill tone="muted" size="sm">Hidden</StatusPill>}
                      {dish.available && dish.active !== false && <StatusPill tone="ok" size="sm">Selling</StatusPill>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
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
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-zinc-500">No products match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-3 text-[11px] text-zinc-500">
          <span>{rows.length} of {state.menu.length} products</span>
          <span>Plate cost follows the stock valuation method set in Settings → Stock rules.</span>
        </div>
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

// ─── Ingredients (stock items) ─────────────────────────────────────

function IngredientModal({ item, onClose, onSave }) {
  const { state } = useRestora()
  const options = categoryOptions(state.categories, 'inventory')
  const [draft, setDraft] = useState(() => ({
    name: item?.name || '',
    sku: item?.sku || '',
    unit: item?.unit || state.settings?.stock?.defaultUnit || 'each',
    packs: item?.packs || [],
    purchaseUnit: item?.purchaseUnit || '',
    onHand: item ? String(item.onHand) : '0',
    par: item ? String(item.par) : '0',
    reorderPoint: item ? String(item.reorderPoint ?? item.par) : '0',
    dailyUse: item ? String(item.dailyUse ?? 0) : '0',
    lastCost: item ? String(item.lastCost) : '0',
    category: item?.category || options.find((option) => option.depth === 0)?.name || 'Dry goods',
    subCategory: item?.subCategory || '',
    supplierId: item?.supplierId || '',
    location: item?.location || 'dry',
    notes: item?.notes || '',
    imageUrl: item?.imageUrl || '',
  }))
  const parents = options.filter((option) => option.depth === 0)
  const subs = options.filter((option) => option.depth === 1 && option.parentName === draft.category)

  const units = state.settings?.units || { list: [], packNames: [] }
  const packNames = units.packNames || []
  const stockShort = (units.list || []).find((unit) => unit.id === draft.unit)?.short || draft.unit
  // The book is counted in this unit: movements freeze it (the reducer
  // refuses the change too, so the screen never lies about what it saved).
  const movements = (state.movements || []).filter((movement) => movement.itemId === item?.id).length
  const frozenUnit = movements > 0

  function patchPack(index, patch) {
    setDraft((current) => ({
      ...current,
      packs: current.packs.map((pack, position) => (position === index ? { ...pack, ...patch } : pack)),
    }))
  }
  function addPack() {
    setDraft((current) => {
      const name = packNames.find((candidate) => !current.packs.some((pack) => pack.name.toLowerCase() === candidate.toLowerCase()))
        || 'Pack'
      const id = slugUnitId(name)
      if (current.packs.some((pack) => pack.id === id)) return current
      return { ...current, packs: [...current.packs, { id, name, qty: 1, of: null }] }
    })
  }
  function removePack(index) {
    setDraft((current) => {
      const removed = current.packs[index]
      return {
        ...current,
        packs: current.packs
          .filter((_, position) => position !== index)
          // A chain that pointed at the removed pack now points at the stock unit.
          .map((pack) => (pack.of === removed?.id ? { ...pack, of: null } : pack)),
        purchaseUnit: current.purchaseUnit === removed?.id ? '' : current.purchaseUnit,
      }
    })
  }
  function packFactorOf(pack) {
    const inner = pack.of ? (draft.packs.find((entry) => entry.id === pack.of)?.qty || 1) : 1
    const factor = (Number(pack.qty) || 1) * inner
    return Math.round(factor * 1000) / 1000
  }

  return (
    <Modal title={item ? `Edit ${item.name}` : 'New ingredient'} sub="Par, reorder point, and supplier drive the reorder alerts." onClose={onClose} wide>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Item name · required">
          <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={60} className={smallInput} />
        </Field>
        <Field label="SKU">
          <input value={draft.sku} onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))} maxLength={40} className={smallInput} />
        </Field>
        <Field label="Category">
          <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value, subCategory: '' }))} className={smallInput}>
            {parents.map((parent) => <option key={parent.id} value={parent.name}>{parent.name}</option>)}
            {!parents.length && <option value="Dry goods">Dry goods</option>}
          </select>
        </Field>
        <Field label="Sub-category">
          <select value={draft.subCategory} onChange={(e) => setDraft((d) => ({ ...d, subCategory: e.target.value }))} className={smallInput}>
            <option value="">— none —</option>
            {subs.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}
          </select>
        </Field>
        <Field
          label="Stock unit"
          hint={frozenUnit
            ? `Frozen at ${draft.unit} — ${movements} movement${movements === 1 ? '' : 's'} and every purchase line are counted in it. Add a new item if you need a different unit.`
            : 'Every quantity in the book is counted in this unit.'}
        >
          <select
            value={draft.unit}
            disabled={frozenUnit}
            onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
            className={`${smallInput}${frozenUnit ? ' bg-zinc-100 text-zinc-500' : ''}`}
          >
            {(units.list || []).map((unit) => <option key={unit.id} value={unit.id}>{unit.label} ({unit.short})</option>)}
          </select>
        </Field>
        <Field label="Supplier">
          <select value={draft.supplierId} onChange={(e) => setDraft((d) => ({ ...d, supplierId: e.target.value }))} className={smallInput}>
            <option value="">— unassigned —</option>
            {state.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </Field>
        <Field label="On hand (counted)">
          <input type="number" step="any" value={draft.onHand} onChange={(e) => setDraft((d) => ({ ...d, onHand: e.target.value }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Last cost per unit">
          <input type="number" step="0.0001" value={draft.lastCost} onChange={(e) => setDraft((d) => ({ ...d, lastCost: e.target.value }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Par level">
          <input type="number" step="any" value={draft.par} onChange={(e) => setDraft((d) => ({ ...d, par: e.target.value }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Reorder point">
          <input type="number" step="any" value={draft.reorderPoint} onChange={(e) => setDraft((d) => ({ ...d, reorderPoint: e.target.value }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Average daily use" hint="Feeds safety stock when the reorder-point policy is active.">
          <input type="number" step="any" value={draft.dailyUse} onChange={(e) => setDraft((d) => ({ ...d, dailyUse: e.target.value }))} className={`${smallInput} tnum`} />
        </Field>
        <Field label="Storage location">
          <select value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} className={smallInput}>
            {(state.settings?.stock?.storageLocations || ['dry']).map((id) => <option key={id} value={id}>{id.replace('_', ' ')}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-4 rounded-xl border border-zinc-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold text-zinc-800">Packaging</div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              How this item is bought and stored: a case of 12, a bottle of 750 {stockShort}, a 5 kg bag.
              Packs can be sized in the stock unit or in another pack.
            </p>
          </div>
          <button type="button" onClick={addPack} className="min-h-8 rounded-lg border border-zinc-200 px-2.5 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-50">
            Add pack
          </button>
        </div>

        {draft.packs.length === 0 && (
          <p className="mt-2 text-[11px] text-zinc-500">No packs — this item is counted and ordered in {draft.unit} only.</p>
        )}

        <div className="mt-2 space-y-2">
          {draft.packs.map((pack, index) => (
            <div key={`${pack.id}-${index}`} className="grid items-end gap-2 sm:grid-cols-[1fr_5rem_1fr_auto]">
              <Field label="Pack">
                <select
                  value={pack.name}
                  aria-label={`Pack ${index + 1} name`}
                  onChange={(e) => {
                    const name = e.target.value
                    patchPack(index, { name, id: slugUnitId(name) })
                  }}
                  className={smallInput}
                >
                  {[...new Set([pack.name, ...packNames])].map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="Holds">
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={pack.qty}
                  aria-label={`Pack ${index + 1} size`}
                  onChange={(e) => patchPack(index, { qty: Number(e.target.value) })}
                  className={`${smallInput} tnum`}
                />
              </Field>
              <Field label="…of">
                <select
                  value={pack.of || ''}
                  aria-label={`Pack ${index + 1} inner unit`}
                  onChange={(e) => patchPack(index, { of: e.target.value || null })}
                  className={smallInput}
                >
                  <option value="">{draft.unit} (stock unit)</option>
                  {draft.packs.filter((_, position) => position !== index).map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </Field>
              <div className="flex items-center gap-1 pb-1">
                <span className="tnum text-[11px] text-zinc-500">= {packFactorOf(pack)} {stockShort}</span>
                <button
                  type="button"
                  onClick={() => removePack(index)}
                  aria-label={`Remove pack ${index + 1}`}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {draft.packs.length > 0 && (
          <div className="mt-3 max-w-xs">
            <Field label="Default purchase unit" hint="What a new order line starts on.">
              <select
                value={draft.purchaseUnit || ''}
                aria-label="Default purchase unit"
                onChange={(e) => setDraft((d) => ({ ...d, purchaseUnit: e.target.value }))}
                className={smallInput}
              >
                <option value="">{draft.unit} (stock unit)</option>
                {draft.packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>

      <Field label="Notes">
        <textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={2} maxLength={240} className={`${smallInput} mt-3 resize-y`} />
      </Field>
      <div className="mt-3">
        <PhotoField
          value={draft.imageUrl}
          onChange={(value) => setDraft((current) => ({ ...current, imageUrl: value }))}
          maxKb={state.settings.food.imageMaxKb}
          hint="Useful for spotting the right pack in a walk-in photo — resized and stored with the item."
        />
      </div>
      <button
        type="button"
        onClick={() => onSave({
          name: draft.name.trim(),
          sku: draft.sku.trim(),
          unit: draft.unit,
          packs: draft.packs,
          purchaseUnit: draft.purchaseUnit || null,
          onHand: Number(draft.onHand) || 0,
          par: Number(draft.par) || 0,
          reorderPoint: Number(draft.reorderPoint) || 0,
          dailyUse: Number(draft.dailyUse) || 0,
          lastCost: Number(draft.lastCost) || 0,
          category: draft.category,
          subCategory: draft.subCategory,
          supplierId: draft.supplierId || null,
          location: draft.location,
          notes: draft.notes.trim(),
          imageUrl: draft.imageUrl.trim(),
        })}
        className={`${btnPrimary} mt-4`}
      >
        {item ? 'Save ingredient' : 'Add ingredient'}
      </button>
    </Modal>
  )
}

function IngredientsTab() {
  const { state, dispatch } = useRestora()
  const [query, setQuery] = useState('')
  const [supplierId, setSupplierId] = useState('all')
  const [exceptionsOnly, setExceptionsOnly] = useState(false)
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)

  const rows = state.inventory
    .map((item) => ({ item, status: stockStatusFor(item, state.settings) }))
    .filter(({ item, status }) => {
      if (supplierId !== 'all' && (item.supplierId || '') !== supplierId) return false
      if (exceptionsOnly && status === 'ok') return false
      if (query && !`${item.name} ${item.sku} ${item.vendor}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })

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
        <button type="button" onClick={() => setCreating(true)} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
          + New ingredient
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-zinc-50 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Ingredient</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">On hand</th>
                <th className="px-3 py-3">Par / reorder</th>
                <th className="px-3 py-3">Last cost</th>
                <th className="px-3 py-3">Supplier</th>
                <th className="px-3 py-3">Storage</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(({ item, status }) => {
                const supplier = state.suppliers.find((entry) => entry.id === item.supplierId)
                return (
                  <tr key={item.id} className="hover:bg-orange-50/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200" />
                        ) : (
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-[9px] uppercase tracking-wide text-zinc-400" aria-hidden>no photo</span>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-800">{item.name}</div>
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
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-600">{categoryPath(item)}</td>
                    <td className="tnum px-3 py-3 font-semibold text-zinc-800">
                      {(item.packs || []).length && state.settings?.units?.showPackBreakdown !== false
                        ? describeQty(item, item.onHand, state.settings)
                        : <>{item.onHand} <span className="text-[10px] font-normal text-zinc-500">{item.unit}</span></>}
                    </td>
                    <td className="tnum px-3 py-3 text-xs text-zinc-600">
                      {item.par} / {reorderPointFor(item, state.settings)}
                    </td>
                    <td className="tnum px-3 py-3 text-zinc-700">{money(item.lastCost)}</td>
                    <td className="px-3 py-3 text-xs text-zinc-600">
                      <select
                        value={item.supplierId || ''} aria-label={`${item.name} supplier`}
                        onChange={(e) => dispatch({ type: 'UPDATE_INVENTORY_ITEM', inventoryItemId: item.id, patch: { supplierId: e.target.value || null } })}
                        className="min-h-9 max-w-[150px] rounded-lg border border-zinc-200 px-2 text-xs text-zinc-700"
                      >
                        <option value="">— unassigned —</option>
                        {state.suppliers.map((supplierOption) => <option key={supplierOption.id} value={supplierOption.id}>{supplierOption.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-xs capitalize text-zinc-600">{String(item.location).replace('_', ' ')}</td>
                    <td className="px-3 py-3">
                      <StatusPill tone={status === 'ok' ? 'ok' : status === 'low' ? 'warn' : 'bad'} size="sm">
                        {status === 'ok' ? 'In stock' : status === 'low' ? 'Low' : 'Out'}
                      </StatusPill>
                      {item.onHand < 0 && <span className="ml-1 text-[10px] font-semibold text-red-600">Recount</span>}
                      {supplier && status !== 'ok' && <div className="mt-1 text-[10px] text-zinc-500">order from {supplier.name}</div>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" onClick={() => setEditing(item)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-zinc-500">No ingredients match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-3 text-[11px] text-zinc-500">
          <span>{rows.length} of {state.inventory.length} ingredients</span>
          <span>Counted truth is written by receiving, waste, and the count sheet — this table edits the record itself.</span>
        </div>
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

// ─── Screen ────────────────────────────────────────────────────────

export default function CatalogScreen({ initialTab = 'categories' }) {
  const { state } = useRestora()
  const [tab, setTab] = useState(initialTab)

  const counts = {
    categories: state.categories.length,
    products: state.menu.length,
    ingredients: state.inventory.length,
  }
  const subCategories = state.categories.filter((category) => category.parentId).length

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">Control</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Catalog</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Categories, sub-categories, products, and ingredients — one naming tree, projected into SQLite.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
          <StatusPill tone="muted" size="sm">{state.categories.length} categories · {subCategories} sub</StatusPill>
          <StatusPill tone="muted" size="sm">{state.menu.length} products</StatusPill>
          <StatusPill tone="muted" size="sm">{state.inventory.length} ingredients</StatusPill>
        </div>
      </header>

      <div className="flex gap-1.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Catalog sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition ${tab === entry.id ? 'bg-orange-500 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'}`}
          >
            {entry.label}
            <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${tab === entry.id ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{counts[entry.id]}</span>
          </button>
        ))}
      </div>

      {tab === 'categories' && <CategoriesTab banner={null} />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'ingredients' && <IngredientsTab />}
    </div>
  )
}
