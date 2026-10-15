import { useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Field, Modal, btnPrimary } from '../../../components/ui'
import { categoryOptions } from '../../../lib/settings'
import { slugUnitId } from '../../../lib/units'
import { PhotoField } from '../../../components/ItemPhotoField'
import { useRestora } from '../../../lib/store'
import { smallInput } from '../shared.js'

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
            <p className="mt-0.5 text-2xs text-zinc-500">
              How this item is bought and stored: a case of 12, a bottle of 750 {stockShort}, a 5 kg bag.
              Packs can be sized in the stock unit or in another pack.
            </p>
          </div>
          <button type="button" onClick={addPack} className="min-h-8 rounded-lg border border-zinc-200 px-2.5 text-2xs font-semibold text-zinc-600 hover:bg-zinc-50">
            Add pack
          </button>
        </div>

        {draft.packs.length === 0 && (
          <p className="mt-2 text-2xs text-zinc-500">No packs — this item is counted and ordered in {draft.unit} only.</p>
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
                <span className="tnum text-2xs text-zinc-500">= {packFactorOf(pack)} {stockShort}</span>
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


export { IngredientModal }
