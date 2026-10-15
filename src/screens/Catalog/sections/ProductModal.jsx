import { useState } from 'react'
import { Field, Modal, btnPrimary } from '../../../components/ui'
import { STATION_META } from '../../../lib/constants'
import { categoryOptions, categoryTree } from '../../../lib/settings'
import { ChipPicker, PhotoField } from '../../../components/ItemPhotoField'
import { useRestora } from '../../../lib/store'
import { smallInput } from '../shared.js'

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


export { ProductModal }
