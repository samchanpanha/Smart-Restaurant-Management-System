import { useMemo, useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { STATION_META } from '../../../lib/constants'
import { CATEGORY_KINDS, categoryOptions, categoryTree } from '../../../lib/settings'
import { useRestora } from '../../../lib/store'
import { cardCls } from '../shared.js'
import { CategoryEditor } from './CategoryEditor.jsx'

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


export { CategoriesTab }
