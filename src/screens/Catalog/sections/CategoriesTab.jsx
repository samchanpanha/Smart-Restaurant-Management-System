import { useMemo, useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { Modal, btnPrimary } from '../../../components/ui'
import { STATION_META } from '../../../lib/constants'
import { CATEGORY_KINDS, categoryOptions, categoryTotalCount, categoryTree } from '../../../lib/settings'
import { useRestora } from '../../../lib/store'
import { cardCls, smallInput } from '../shared.js'
import { CategoryEditor } from './CategoryEditor.jsx'

function CategoriesTab({ banner }) {
  const { state, dispatch } = useRestora()
  const [kind, setKind] = useState('menu')
  const [editing, setEditing] = useState(null)
  const [moving, setMoving] = useState(null) // { sourceNode, parentNode }
  const [moveTargetId, setMoveTargetId] = useState('')
  const [draggingCatId, setDraggingCatId] = useState(null)
  const [dropHoverId, setDropHoverId] = useState(null)

  const tree = useMemo(() => categoryTree(state.categories, kind), [state.categories, kind])
  const options = categoryOptions(state.categories, kind)
  const items = kind === 'menu' ? state.menu : state.inventory

  function directItemCount(category) {
    if (kind === 'menu') {
      return state.menu.filter((item) => {
        if (category.parentId) {
          const parent = state.categories.find((c) => c.id === category.parentId)
          return item.category?.toLowerCase() === parent?.name?.toLowerCase() && item.subCategory?.toLowerCase() === category.name.toLowerCase()
        }
        return item.category?.toLowerCase() === category.name.toLowerCase() && !item.subCategory
      }).length
    }
    return state.inventory.filter((item) => {
      if (category.parentId) {
        return item.subCategory?.toLowerCase() === category.name.toLowerCase()
      }
      return item.category?.toLowerCase() === category.name.toLowerCase() && !item.subCategory
    }).length
  }

  function totalItemCount(category) {
    return categoryTotalCount(state.categories, category.id, items, kind)
  }

  function reorderNodes(sourceId, targetId, siblingList) {
    const fromIdx = siblingList.findIndex((n) => n.id === sourceId)
    const toIdx = siblingList.findIndex((n) => n.id === targetId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const reordered = [...siblingList]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    dispatch({ type: 'REORDER_CATEGORIES', categoryIds: reordered.map((n) => n.id) })
  }

  function moveStep(node, direction, siblingList) {
    const idx = siblingList.findIndex((n) => n.id === node.id)
    if (idx === -1) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= siblingList.length) return
    const reordered = [...siblingList]
    const [moved] = reordered.splice(idx, 1)
    reordered.splice(targetIdx, 0, moved)
    dispatch({ type: 'REORDER_CATEGORIES', categoryIds: reordered.map((n) => n.id) })
  }

  function handleMoveItems() {
    if (!moving || !moveTargetId) return
    const target = options.find((opt) => opt.id === moveTargetId)
    if (!target) return
    const source = moving.sourceNode
    const sourceParent = moving.parentNode

    const fromCategory = sourceParent ? sourceParent.name : source.name
    const fromSubCategory = sourceParent ? source.name : ''
    const toCategory = target.depth === 1 ? target.parentName : target.name
    const toSubCategory = target.depth === 1 ? target.name : ''

    dispatch({
      type: 'MOVE_CATEGORY_ITEMS',
      fromCategory,
      fromSubCategory,
      toCategory,
      toSubCategory,
    })
    setMoving(null)
    setMoveTargetId('')
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

        <ul className="space-y-2.5">
          {tree.map((root, rootIdx) => {
            const total = totalItemCount(root)
            const direct = directItemCount(root)
            const isHovered = dropHoverId === root.id

            return (
              <li
                key={root.id}
                draggable
                onDragStart={(e) => {
                  setDraggingCatId(root.id)
                  e.dataTransfer.setData('text/plain', root.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (draggingCatId && draggingCatId !== root.id) {
                    setDropHoverId(root.id)
                  }
                }}
                onDragLeave={() => {
                  if (dropHoverId === root.id) setDropHoverId(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (draggingCatId && draggingCatId !== root.id) {
                    reorderNodes(draggingCatId, root.id, tree)
                  }
                  setDraggingCatId(null)
                  setDropHoverId(null)
                }}
                className={`rounded-xl border transition-all ${
                  isHovered ? 'border-orange-500 bg-orange-50/20 ring-2 ring-orange-200' : 'border-zinc-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="cursor-grab text-zinc-400 hover:text-zinc-700 active:cursor-grabbing p-1"
                      title="Drag to reorder category"
                    >
                      ⋮⋮
                    </div>
                    <span className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-inset ring-black/5" style={{ background: root.color || '#f6f7f9' }} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-zinc-800">{root.name}</span>
                        {!root.active && <StatusPill tone="muted" size="sm">Hidden</StatusPill>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {STATION_META[root.station]?.label || root.station} · <strong className="text-zinc-700">{total} item{total === 1 ? '' : 's'} total</strong>
                        {root.children.length > 0 && ` (${direct} direct · ${total - direct} in ${root.children.length} sub-categor${root.children.length === 1 ? 'y' : 'ies'})`}
                        {root.description ? ` · ${root.description}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {tree.length > 1 && (
                      <div className="mr-1 flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={rootIdx === 0}
                          title="Move up"
                          onClick={() => moveStep(root, 'up', tree)}
                          className="rounded p-1 text-xs text-zinc-400 hover:bg-zinc-100 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          disabled={rootIdx === tree.length - 1}
                          title="Move down"
                          onClick={() => moveStep(root, 'down', tree)}
                          className="rounded p-1 text-xs text-zinc-400 hover:bg-zinc-100 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                    )}
                    {total > 0 && (
                      <button
                        type="button"
                        onClick={() => setMoving({ sourceNode: root, parentNode: null })}
                        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                        title="Move all items from this category to another"
                      >
                        Move items…
                      </button>
                    )}
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
                  <ul className="space-y-1 border-t border-zinc-100 px-3.5 py-2.5 bg-zinc-50/50">
                    {root.children.map((child, childIdx) => {
                      const childCount = directItemCount(child)
                      const isChildHovered = dropHoverId === child.id

                      return (
                        <li
                          key={child.id}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation()
                            setDraggingCatId(child.id)
                            e.dataTransfer.setData('text/plain', child.id)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (draggingCatId && draggingCatId !== child.id) {
                              setDropHoverId(child.id)
                            }
                          }}
                          onDragLeave={(e) => {
                            e.stopPropagation()
                            if (dropHoverId === child.id) setDropHoverId(null)
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (draggingCatId && draggingCatId !== child.id) {
                              reorderNodes(draggingCatId, child.id, root.children)
                            }
                            setDraggingCatId(null)
                            setDropHoverId(null)
                          }}
                          className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-all ${
                            isChildHovered ? 'bg-orange-100 ring-1 ring-orange-300' : 'hover:bg-white'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="cursor-grab text-zinc-300 hover:text-zinc-600 active:cursor-grabbing text-xs" title="Drag to reorder sub-category">
                              ⋮⋮
                            </span>
                            <span className="text-zinc-300 font-mono text-sm" aria-hidden>└─</span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-sm text-zinc-700">
                                <span className="truncate font-semibold">{child.name}</span>
                                {!child.active && <StatusPill tone="muted" size="sm">Hidden</StatusPill>}
                              </div>
                              <div className="text-[11px] text-zinc-500">
                                {STATION_META[child.station]?.label || child.station} · {childCount} item{childCount === 1 ? '' : 's'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {root.children.length > 1 && (
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  disabled={childIdx === 0}
                                  title="Move up"
                                  onClick={() => moveStep(child, 'up', root.children)}
                                  className="rounded p-0.5 text-[10px] text-zinc-400 hover:bg-zinc-200 disabled:opacity-30"
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  disabled={childIdx === root.children.length - 1}
                                  title="Move down"
                                  onClick={() => moveStep(child, 'down', root.children)}
                                  className="rounded p-0.5 text-[10px] text-zinc-400 hover:bg-zinc-200 disabled:opacity-30"
                                >
                                  ▼
                                </button>
                              </div>
                            )}
                            {childCount > 0 && (
                              <button
                                type="button"
                                onClick={() => setMoving({ sourceNode: child, parentNode: root })}
                                className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-50"
                                title="Move items from this sub-category"
                              >
                                Move…
                              </button>
                            )}
                            <button type="button" onClick={() => setEditing({ kind, node: child })} className="rounded-lg border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-600 hover:bg-white">Edit</button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-4">
        <div className={cardCls}>
          <h2 className="text-sm font-bold text-zinc-900">How categories are used</h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-zinc-600">
            <li>• Menu items store a <strong>category</strong> and an optional <strong>sub-category</strong> name.</li>
            <li>• The SQLite projection keeps the same tree, so <code className="rounded bg-zinc-100 px-1">/api/categories</code> answers with the nesting.</li>
            <li>• Reports group sales by top-level category; the guest QR menu groups by the same names.</li>
            <li>• Renaming a category re-labels its items everywhere. Drag to reorder categories within each tier.</li>
            <li>• Use &quot;Move items…&quot; to migrate products between categories cleanly.</li>
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

      {/* Bulk Move Items Modal */}
      {moving && (
        <Modal
          title={`Move items from "${moving.sourceNode.name}"`}
          onClose={() => { setMoving(null); setMoveTargetId('') }}
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">
              Select which category all products currently in <strong>{moving.sourceNode.name}</strong> should be transferred to:
            </p>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
                Target Category
              </label>
              <select
                value={moveTargetId}
                onChange={(e) => setMoveTargetId(e.target.value)}
                className={`${smallInput} w-full`}
                aria-label="Target Category"
              >
                <option value="">Select destination…</option>
                {options
                  .filter((opt) => opt.id !== moving.sourceNode.id)
                  .map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.depth ? `— ${opt.parentName} › ${opt.name}` : opt.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setMoving(null); setMoveTargetId('') }}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!moveTargetId}
                onClick={handleMoveItems}
                className={`${btnPrimary} disabled:opacity-40`}
              >
                Move all items
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export { CategoriesTab }
