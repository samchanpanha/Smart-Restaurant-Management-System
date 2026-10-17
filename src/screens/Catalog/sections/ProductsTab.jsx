import { useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { DataTable } from '../../../components/ui'
import StatusPill from '../../../components/StatusPill'
import { MARGIN_BAND_META, STATIONS, STATION_META } from '../../../lib/constants'
import { translateDishName, useI18n } from '../../../lib/i18n'
import { costingFor, money, uid } from '../../../lib/models'
import { categoryOptions, categoryPath, categoryTree } from '../../../lib/settings'
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
  const [viewMode, setViewMode] = useState('grouped') // 'grouped' | 'flat'
  const [selected, setSelected] = useState([])
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false) // boolean or { category, subCategory }
  const [collapsed, setCollapsed] = useState({})
  const [draggingDishId, setDraggingDishId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null) // { category, subCategory }

  const invById = useMemo(() => Object.fromEntries(state.inventory.map((item) => [item.id, item])), [state.inventory])
  const options = categoryOptions(state.categories, 'menu')
  const menuTree = useMemo(() => categoryTree(state.categories, 'menu'), [state.categories])

  const allFilteredRows = useMemo(() => {
    return state.menu
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
      .sort((a, b) => a.dish.category.localeCompare(b.dish.category) || (a.dish.sortOrder ?? 0) - (b.dish.sortOrder ?? 0))
  }, [state, invById, category, options, status, query])

  const allSelected = allFilteredRows.length > 0 && selected.length === allFilteredRows.length

  function toggleCollapse(id) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function applyBulk(patch) {
    for (const id of selected) dispatch({ type: 'UPDATE_MENU_ITEM', menuItemId: id, patch })
    setSelected([])
  }

  function moveItemReorder(dishId, direction, siblingDishes) {
    const idx = siblingDishes.findIndex((d) => d.id === dishId)
    if (idx === -1) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= siblingDishes.length) return
    const nextList = [...siblingDishes]
    const [moved] = nextList.splice(idx, 1)
    nextList.splice(targetIdx, 0, moved)
    dispatch({ type: 'REORDER_MENU_ITEMS', itemIds: nextList.map((d) => d.id) })
  }

  function handleDropOnCategory(targetCat, targetSub = '') {
    if (!draggingDishId) return
    dispatch({
      type: 'UPDATE_MENU_ITEM',
      menuItemId: draggingDishId,
      patch: { category: targetCat, subCategory: targetSub },
    })
    setDraggingDishId(null)
    setDropTarget(null)
  }

  // Build grouped structures for the tree
  const groupedData = useMemo(() => {
    const rowByDishId = new Map(allFilteredRows.map((r) => [r.dish.id, r]))
    const assignedIds = new Set()

    const groups = menuTree.map((root) => {
      // Subcategories
      const subGroups = (root.children || []).map((child) => {
        const rows = allFilteredRows.filter(({ dish }) => {
          const matchesParent = dish.category?.toLowerCase() === root.name.toLowerCase()
          const matchesChild = dish.subCategory?.toLowerCase() === child.name.toLowerCase()
          return matchesParent && matchesChild
        })
        rows.forEach((r) => assignedIds.add(r.dish.id))
        return { child, rows }
      })

      // Direct parent items (no subcategory or subcategory not in child list)
      const directRows = allFilteredRows.filter(({ dish }) => {
        if (assignedIds.has(dish.id)) return false
        return dish.category?.toLowerCase() === root.name.toLowerCase()
      })
      directRows.forEach((r) => assignedIds.add(r.dish.id))

      const totalGroupRows = directRows.length + subGroups.reduce((acc, sg) => acc + sg.rows.length, 0)
      return {
        root,
        directRows,
        subGroups,
        totalRows: totalGroupRows,
      }
    })

    const uncategorizedRows = allFilteredRows.filter(({ dish }) => !assignedIds.has(dish.id))

    return { groups, uncategorizedRows, rowByDishId }
  }, [allFilteredRows, menuTree])

  // Shared columns definition for rendering DataTable
  function getColumns(siblingRows = []) {
    const siblingDishes = siblingRows.map((r) => r.dish)
    return [
      {
        key: 'drag_select',
        header: '',
        className: 'w-16',
        render: ({ dish }) => (
          <div className="flex items-center gap-1.5">
            <div
              draggable
              onDragStart={(e) => {
                setDraggingDishId(dish.id)
                e.dataTransfer.setData('text/plain', dish.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                setDraggingDishId(null)
                setDropTarget(null)
              }}
              className="cursor-grab text-zinc-400 hover:text-zinc-700 active:cursor-grabbing p-1"
              title="Drag to reorder or move across categories"
              aria-label="Drag handle"
            >
              ⋮⋮
            </div>
            <input
              type="checkbox"
              checked={selected.includes(dish.id)}
              aria-label={`Select ${dish.name}`}
              onChange={(e) => setSelected((current) => (e.target.checked ? [...current, dish.id] : current.filter((id) => id !== dish.id)))}
              className="h-4 w-4 accent-orange-500"
            />
          </div>
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
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-[9px] uppercase tracking-wide text-zinc-400" aria-hidden>no photo</span>
            )}
            <div className="min-w-0">
              <div className="font-semibold text-zinc-800">
                {translateDishName(dish, lang)}
                {lang !== 'en' && translateDishName(dish, lang) !== dish.name && (
                  <span className="ml-1 text-xs font-normal text-zinc-500">({dish.name})</span>
                )}
              </div>
              <div className="text-[11px] text-zinc-500">{dish.sku || 'no SKU'}{dish.description ? ` · ${dish.description.slice(0, 40)}` : ''}</div>
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
      { key: 'supply', header: 'Supply', render: ({ suppliers }) => <span className="text-[11px] text-zinc-500">{suppliers.length ? suppliers.join(', ') : 'No recipe yet'}</span> },
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
          <div className="flex items-center justify-end gap-1.5">
            {siblingDishes.length > 1 && (
              <div className="mr-1 flex items-center gap-0.5">
                <button
                  type="button"
                  title="Move up"
                  onClick={() => moveItemReorder(dish.id, 'up', siblingDishes)}
                  className="rounded p-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                >
                  ▲
                </button>
                <button
                  type="button"
                  title="Move down"
                  onClick={() => moveItemReorder(dish.id, 'down', siblingDishes)}
                  className="rounded p-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                >
                  ▼
                </button>
              </div>
            )}
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
    ]
  }

  return (
    <div className="space-y-4">
      {/* Filter and Mode Bar */}
      <div className={`${cardCls} flex flex-wrap items-center gap-3`}>
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-zinc-200 px-3">
          <Icon name="search" size={16} className="text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, SKU, category…"
            aria-label="Search products"
            className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm outline-none"
          />
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

        {/* View Mode Switcher: Grouped vs Flat */}
        <div className="flex rounded-xl border border-zinc-200 p-0.5 bg-zinc-50">
          <button
            type="button"
            onClick={() => setViewMode('grouped')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              viewMode === 'grouped' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Grouped by category hierarchy"
          >
            📁 Grouped
          </button>
          <button
            type="button"
            onClick={() => setViewMode('flat')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              viewMode === 'flat' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Flat list of all items"
          >
            ☰ Flat
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={allSelected}
            aria-label="Select all products"
            onChange={(e) => setSelected(e.target.checked ? allFilteredRows.map((row) => row.dish.id) : [])}
            className="h-4 w-4 accent-orange-500"
          />
          Select all
        </label>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
        >
          {cat.newProduct || '+ New product'}
          {lang !== 'en' && <span className="sr-only"> + New product</span>}
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.length > 0 && (
        <div className={`${cardCls} flex flex-wrap items-center gap-2 border-orange-200 bg-orange-50/60`}>
          <span className="text-sm font-semibold text-orange-800">{selected.length} selected</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) applyBulk({ category: e.target.value, subCategory: '' }) }}
            className={`${smallInput} w-auto`}
            aria-label="Bulk set category"
          >
            <option value="">Move to category…</option>
            {options.filter((option) => option.depth === 0).map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}
          </select>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) applyBulk({ station: e.target.value }) }}
            className={`${smallInput} w-auto`}
            aria-label="Bulk set station"
          >
            <option value="">Set station…</option>
            {STATIONS.map((station) => <option key={station} value={station}>{STATION_META[station].label}</option>)}
          </select>
          <button type="button" onClick={() => applyBulk({ available: false, auto86: false })} className="min-h-10 rounded-xl border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-600 hover:bg-red-50">86 all</button>
          <button type="button" onClick={() => applyBulk({ available: true, auto86: false })} className="min-h-10 rounded-xl border border-emerald-200 bg-white px-3.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">Back on menu</button>
          <button type="button" onClick={() => setSelected([])} className="ml-auto text-xs font-semibold text-zinc-500 hover:text-zinc-800">Clear</button>
        </div>
      )}

      {/* Main Table view */}
      {viewMode === 'flat' ? (
        <DataTable
          columns={getColumns(allFilteredRows)}
          rows={allFilteredRows}
          rowKey={(row) => row.dish.id}
          empty={<div className="rounded-[var(--radius-xl)] border border-[var(--border)] px-4 py-12 text-center text-sm text-zinc-500">No products match this filter.</div>}
        />
      ) : (
        /* Hierarchical Grouped View */
        <div className="space-y-4">
          {groupedData.groups.map(({ root, directRows, subGroups, totalRows }) => {
            const isCollapsed = !!collapsed[root.id]
            const isHoveredTarget = dropTarget?.category === root.name && !dropTarget?.subCategory

            return (
              <div
                key={root.id}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropTarget({ category: root.name, subCategory: '' })
                }}
                onDragLeave={() => {
                  if (dropTarget?.category === root.name && !dropTarget?.subCategory) setDropTarget(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handleDropOnCategory(root.name, '')
                }}
                className={`overflow-hidden rounded-2xl border transition-all ${
                  isHoveredTarget ? 'border-orange-500 bg-orange-50/20 ring-2 ring-orange-300' : 'border-zinc-200 bg-white'
                }`}
              >
                {/* Parent Group Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/80 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(root.id)}
                      className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-200"
                      aria-label={isCollapsed ? `Expand ${root.name}` : `Collapse ${root.name}`}
                    >
                      <span className="inline-block transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                        ▼
                      </span>
                    </button>
                    <span
                      className="h-5 w-5 rounded-md ring-1 ring-black/10 shrink-0"
                      style={{ background: root.color || '#f59e0b' }}
                      aria-hidden="true"
                    />
                    <h3 className="font-bold text-zinc-900">{root.name}</h3>
                    <span className="rounded-full bg-zinc-200/80 px-2.5 py-0.5 text-xs font-semibold text-zinc-700">
                      {totalRows} {totalRows === 1 ? 'item' : 'items'}
                    </span>
                    {subGroups.length > 0 && (
                      <span className="text-xs text-zinc-500">
                        ({subGroups.length} sub-categor{subGroups.length === 1 ? 'y' : 'ies'})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCreating({ category: root.name, subCategory: '' })}
                      className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700 hover:bg-orange-100"
                    >
                      + Add to {root.name}
                    </button>
                  </div>
                </div>

                {/* Parent Content (Direct Items + Sub-categories) */}
                {!isCollapsed && (
                  <div className="space-y-3 p-3">
                    {/* Direct Items under Root */}
                    {directRows.length > 0 && (
                      <div>
                        {subGroups.length > 0 && (
                          <div className="mb-1 text-xs font-semibold text-zinc-500">General / Main items</div>
                        )}
                        <DataTable
                          columns={getColumns(directRows)}
                          rows={directRows}
                          rowKey={(row) => row.dish.id}
                        />
                      </div>
                    )}

                    {/* Sub-categories */}
                    {subGroups.map(({ child, rows }) => {
                      const isSubTarget = dropTarget?.category === root.name && dropTarget?.subCategory === child.name

                      return (
                        <div
                          key={child.id}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            e.dataTransfer.dropEffect = 'move'
                            setDropTarget({ category: root.name, subCategory: child.name })
                          }}
                          onDragLeave={() => {
                            if (dropTarget?.subCategory === child.name) setDropTarget(null)
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleDropOnCategory(root.name, child.name)
                          }}
                          className={`ml-4 rounded-xl border border-dashed transition-all ${
                            isSubTarget ? 'border-orange-500 bg-orange-50/30 ring-2 ring-orange-200' : 'border-zinc-200 bg-zinc-50/40'
                          } p-2.5`}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-400 font-mono text-sm" aria-hidden>└─</span>
                              <span className="text-sm font-bold text-zinc-800">{child.name}</span>
                              <span className="rounded-full bg-zinc-200/70 px-2 py-0.2 text-[11px] font-semibold text-zinc-600">
                                {rows.length} {rows.length === 1 ? 'item' : 'items'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCreating({ category: root.name, subCategory: child.name })}
                              className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100"
                            >
                              + Add to {child.name}
                            </button>
                          </div>
                          {rows.length > 0 ? (
                            <DataTable
                              columns={getColumns(rows)}
                              rows={rows}
                              rowKey={(row) => row.dish.id}
                            />
                          ) : (
                            <div className="py-3 text-center text-xs text-zinc-400">
                              No items in this sub-category yet. Drag items here or tap + Add to {child.name}.
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {totalRows === 0 && (
                      <div className="py-4 text-center text-xs text-zinc-400">
                        No products in {root.name} match your filter.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Uncategorized group if any */}
          {groupedData.uncategorizedRows.length > 0 && (
            <div className="rounded-2xl border border-zinc-200 bg-white">
              <div className="border-b border-zinc-100 bg-zinc-50/80 px-4 py-3">
                <h3 className="font-bold text-zinc-700">Other / Uncategorized</h3>
                <p className="text-xs text-zinc-500">Items not attached to a top-level category.</p>
              </div>
              <div className="p-3">
                <DataTable
                  columns={getColumns(groupedData.uncategorizedRows)}
                  rows={groupedData.uncategorizedRows}
                  rowKey={(row) => row.dish.id}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span>{allFilteredRows.length} of {state.menu.length} products</span>
        <span>Plate cost follows the stock valuation method set in Settings → Stock rules.</span>
      </div>

      {creating && (
        <ProductModal
          categories={state.categories}
          initialCategory={typeof creating === 'object' ? creating.category : ''}
          initialSubCategory={typeof creating === 'object' ? creating.subCategory : ''}
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
