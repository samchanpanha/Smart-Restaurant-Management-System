import { useState } from 'react'
import { Field, Modal, btnGhost, btnPrimary } from '../../../components/ui'
import { STATIONS, STATION_META } from '../../../lib/constants'
import { categoryOptions } from '../../../lib/settings'
import { smallInput } from '../shared.js'

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


export { CategoryEditor }
