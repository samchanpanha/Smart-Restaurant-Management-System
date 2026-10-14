// ─── Step 7a: Menu & Recipes ────────────────────────────────────────
// Cost is a first-class object. Every dish carries a live plate cost
// from last invoice cost. Editing a recipe writes a NEW snapshot —
// already-fired lines keep their old cost. 86 writes through to
// the floor composer and KDS instantly.

import { useEffect, useMemo, useState } from 'react'
import { NameTranslationsField, PhotoGalleryField } from '../components/ItemPhotoField'
import StatusPill from '../components/StatusPill'
import { Field, Modal, btnPrimary, inputCls } from '../components/ui'
import { MARGIN_BAND_META, STATIONS, STATION_META } from '../lib/constants'
import { translationDraft, translationPatch } from '../lib/i18n'
import { contributionFor, costingFor, money, plateCostFor, uid } from '../lib/models'
import { useMenuCatalog } from '../lib/useMenuCatalog'
import { useRestora } from '../lib/store'

function snapshotCount(state, menuItemId) {
  return state.orders
    .flatMap((o) => o.items)
    .filter((i) => i.menuItemId === menuItemId && i.recipeSnapshot).length
}

function isSafeImageUrl(value) {
  // Uploaded photos arrive as data URLs; the settings sanitizer already
  // caps their size, this only rejects schemes we would never render.
  const url = String(value || '').trim()
  if (!url) return true
  if (url.startsWith('/') && !url.startsWith('//')) return true
  if (url.startsWith('data:image/')) return true
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

function Coster({ dishId, onDone }) {
  const { state, dispatch } = useRestora()
  const dish = state.menu.find((m) => m.id === dishId)
  const recipe = dish ? state.recipes[dish.id] : null
  const invById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])

  const [draft, setDraft] = useState(null)

  useEffect(() => {
    if (!dish || !recipe) {
      setDraft(null)
      return
    }
    setDraft({
      name: dish.name,
      description: dish.description || '',
      category: dish.category,
      station: dish.station,
      active: dish.active !== false,
      dietaryTagsText: (dish.dietaryTags || []).join(', '),
      allergensText: (dish.allergens || []).join(', '),
      imageUrl: dish.imageUrl || '',
      images: dish.images || [],
      names: translationDraft(dish),
      price: String(dish.price),
      yieldPortions: recipe.yieldPortions,
      prepNotes: recipe.prepNotes || '',
      ingredients: recipe.ingredients.map((ing) => ({ ...ing })),
    })
  }, [dishId]) // eslint-disable-line react-hooks/exhaustive-deps

  const live = useMemo(() => {
    if (!draft) return null
    const r = { yieldPortions: Number(draft.yieldPortions) || 1, ingredients: draft.ingredients }
    const plate = plateCostFor(r, invById)
    const price = Number(draft.price) || 0
    return { plate, contribution: contributionFor(price, plate) }
  }, [draft, invById])

  if (!dish || !recipe || !draft || !live) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-ink-600)] p-10 text-center">
        <div className="text-lg font-bold">Pick a dish</div>
        <p className="mt-1 text-sm text-zinc-500">The coster opens here with live invoice costs.</p>
      </div>
    )
  }

  const saved = costingFor(dish, recipe, invById)
  const toLabels = (value) => [...new Set(String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 12)
  const catalogDirty =
    draft.name.trim() !== dish.name ||
    draft.description.trim() !== (dish.description || '') ||
    draft.category.trim() !== dish.category ||
    draft.station !== dish.station ||
    draft.active !== (dish.active !== false) ||
    JSON.stringify(toLabels(draft.dietaryTagsText)) !== JSON.stringify(dish.dietaryTags || []) ||
    JSON.stringify(toLabels(draft.allergensText)) !== JSON.stringify(dish.allergens || []) ||
    draft.imageUrl.trim() !== (dish.imageUrl || '') ||
    JSON.stringify(draft.images) !== JSON.stringify(dish.images || []) ||
    JSON.stringify(translationPatch(draft.names)) !== JSON.stringify(translationPatch(translationDraft(dish))) ||
    Number(draft.price) !== dish.price
  const recipeDirty =
    Number(draft.yieldPortions) !== recipe.yieldPortions ||
    draft.prepNotes !== (recipe.prepNotes || '') ||
    JSON.stringify(draft.ingredients) !== JSON.stringify(recipe.ingredients)
  const dirty = catalogDirty || recipeDirty

  function setIng(idx, patch) {
    setDraft((d) => ({
      ...d,
      ingredients: d.ingredients.map((ing, i) => (i === idx ? { ...ing, ...patch } : ing)),
    }))
  }

  function addIngredient() {
    const used = new Set(draft.ingredients.map((i) => i.inventoryItemId))
    const next = state.inventory.find((s) => !used.has(s.id)) || state.inventory[0]
    if (!next) return
    setDraft((d) => ({
      ...d,
      ingredients: [...d.ingredients, { inventoryItemId: next.id, qty: 1, unit: next.unit, wastePct: 0 }],
    }))
  }

  function save() {
    const name = draft.name.trim()
    const category = draft.category.trim()
    const priceInput = Number(draft.price)
    if (!name || !category) {
      onDone('Item name and category are required.')
      return
    }
    if (!Number.isFinite(priceInput) || priceInput < 0 || priceInput > 999999.99) {
      onDone('Enter a valid menu price between $0 and $999,999.99.')
      return
    }
    if (state.menu.some((item) => item.id !== dish.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      onDone('Another menu item already uses that name.')
      return
    }
    const price = Math.round(priceInput * 100) / 100
    if (![draft.imageUrl, ...draft.images].every(isSafeImageUrl)) {
      onDone('Use an HTTPS image URL or a site-local path beginning with /.')
      return
    }
    const dietaryTags = toLabels(draft.dietaryTagsText)
    const allergens = toLabels(draft.allergensText)
    if (catalogDirty) {
      dispatch({
        type: 'UPDATE_MENU_ITEM',
        menuItemId: dish.id,
        patch: {
          name,
          description: draft.description.trim(),
          category,
          station: draft.station,
          active: draft.active,
          dietaryTags,
          allergens,
          imageUrl: draft.imageUrl.trim(),
          images: draft.images,
          translations: translationPatch(draft.names),
          price,
        },
      })
    }
    if (recipeDirty) dispatch({
      type: 'UPDATE_RECIPE',
      menuItemId: dish.id,
      recipe: {
        ...recipe,
        yieldPortions: Math.max(1, Number(draft.yieldPortions) || 1),
        prepNotes: draft.prepNotes,
        ingredients: draft.ingredients
          .filter((ing) => ing.inventoryItemId && Number(ing.qty) > 0)
          .map((ing) => ({
            inventoryItemId: ing.inventoryItemId,
            qty: Number(ing.qty),
            unit: invById[ing.inventoryItemId]?.unit || ing.unit,
            wastePct: Math.min(0.9, Math.max(0, Number(ing.wastePct) || 0)),
          })),
      },
    })
    setDraft((current) => ({
      ...current,
      name,
      category,
      description: current.description.trim(),
      dietaryTagsText: dietaryTags.join(', '),
      allergensText: allergens.join(', '),
      imageUrl: current.imageUrl.trim(),
      price: String(Math.round(price * 100) / 100),
    }))
    onDone(`${name} saved — new cost snapshot live; past tickets keep theirs.`)
  }

  const snaps = snapshotCount(state, dish.id)

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">{dish.name}</h2>
            {!dish.available && <StatusPill tone="bad">86&apos;d</StatusPill>}
            {dish.active === false && <StatusPill tone="muted">Hidden</StatusPill>}
            <StatusPill tone={MARGIN_BAND_META[saved.band].tone}>{saved.band} · {(saved.contribution * 100).toFixed(1)}%</StatusPill>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {dish.category} · {dish.station} station
            {dish.modifiers?.length ? ` · mods: ${dish.modifiers.map((g) => `${g.label}${g.required ? '*' : ''}`).join(', ')}` : ' · no modifiers'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'SET_86', menuItemId: dish.id, available: !dish.available })}
          className={`min-h-[44px] rounded-lg px-4 text-sm font-bold transition-colors ${
            dish.available
              ? 'border border-red-500/50 text-red-300 hover:bg-red-500/10'
              : 'bg-emerald-500 text-black hover:bg-emerald-400'
          }`}
        >
          {dish.available ? '86 this dish' : 'Back on menu'}
        </button>
      </div>

      {/* Price / yield / plate strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Menu price $">
          <input
            type="number" min="0" step="any" value={draft.price}
            onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
            className={`${inputCls} tnum`} aria-label="Menu price"
          />
        </Field>
        <Field label="Yield (portions)">
          <input
            type="number" min="1" step="1" value={draft.yieldPortions}
            onChange={(e) => setDraft((d) => ({ ...d, yieldPortions: e.target.value }))}
            className={`${inputCls} tnum`} aria-label="Yield portions"
          />
        </Field>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Plate cost</div>
          <div className="tnum rounded-lg bg-black/30 px-3 py-2.5 text-lg font-bold ring-1 ring-inset ring-[var(--color-ink-700)]">
            {money(live.plate)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Contribution</div>
          <div className="tnum rounded-lg bg-black/30 px-3 py-2.5 text-lg font-bold ring-1 ring-inset ring-[var(--color-ink-700)]">
            {(live.contribution * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item name">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            maxLength={60}
            className={inputCls}
          />
        </Field>
        <Field label="Menu category">
          <input
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            placeholder="Starters, Mains, Desserts…"
            maxLength={40}
            className={inputCls}
          />
        </Field>
        <Field label="Kitchen station">
          <select value={draft.station} onChange={(e) => setDraft((d) => ({ ...d, station: e.target.value }))} className={inputCls}>
            {STATIONS.map((station) => (
              <option key={station} value={station}>{STATION_META[station]?.label || station}</option>
            ))}
          </select>
        </Field>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 self-end rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-800)] px-3 py-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
            className="h-4 w-4 accent-amber-500"
          />
          Show on guest and order menus
        </label>
      </div>

      <Field label="Guest-facing description">
        <textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="A short, useful description shown on the QR menu."
          maxLength={240}
          rows={3}
          className={`${inputCls} min-h-[90px] resize-y`}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dietary labels · comma-separated">
          <input
            value={draft.dietaryTagsText}
            onChange={(e) => setDraft((d) => ({ ...d, dietaryTagsText: e.target.value }))}
            placeholder="Vegetarian, Vegan…"
            className={inputCls}
          />
        </Field>
        <Field label="Allergen notes · comma-separated">
          <input
            value={draft.allergensText}
            onChange={(e) => setDraft((d) => ({ ...d, allergensText: e.target.value }))}
            placeholder="Wheat, milk, eggs…"
            className={inputCls}
          />
        </Field>
      </div>
      <div className="-mt-2 text-[11px] leading-relaxed text-amber-200/80">
        Demo allergen labels must be checked against your kitchen&apos;s recipes and cross-contact practices before use.
      </div>

      <NameTranslationsField
        value={draft.names}
        onChange={(names) => setDraft((d) => ({ ...d, names }))}
        englishName={draft.name.trim()}
      />

      <PhotoGalleryField
        cover={draft.imageUrl}
        images={draft.images}
        onChange={({ imageUrl, images }) => setDraft((d) => ({ ...d, imageUrl, images }))}
        maxKb={state.settings.food.imageMaxKb}
        hint="The cover shows on the menu screen and the guest QR menu (when photos are on in Settings → Food & menu); the kitchen display shows every photo."
      />

      {/* Ingredients */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
            Ingredients · {draft.ingredients.length}
          </h3>
          <button
            type="button"
            onClick={addIngredient}
            className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-300 hover:bg-white/5"
          >
            + Add
          </button>
        </div>
        <ul className="space-y-2">
          {draft.ingredients.map((ing, i) => {
            const sku = invById[ing.inventoryItemId]
            const line = Number(ing.qty || 0) * (sku?.lastCost || 0) * (1 + Number(ing.wastePct || 0))
            return (
              <li key={i} className="grid grid-cols-12 items-end gap-2 rounded-xl bg-[var(--color-ink-800)] p-2.5 ring-1 ring-inset ring-[var(--color-ink-600)]">
                <div className="col-span-12 sm:col-span-5">
                  <Field label="SKU">
                    <select value={ing.inventoryItemId} onChange={(e) => setIng(i, { inventoryItemId: e.target.value })} className={inputCls}>
                      {state.inventory.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} · {money(s.lastCost)}/{s.unit}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Field label={`Qty${sku ? ` (${sku.unit})` : ''}`}>
                    <input type="number" min="0" step="any" value={ing.qty} onChange={(e) => setIng(i, { qty: e.target.value })} className={`${inputCls} tnum`} />
                  </Field>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Field label="Waste %">
                    <input
                      type="number" min="0" max="90" step="any"
                      value={Math.round(Number(ing.wastePct || 0) * 100)}
                      onChange={(e) => setIng(i, { wastePct: (Number(e.target.value) || 0) / 100 })}
                      className={`${inputCls} tnum`}
                    />
                  </Field>
                </div>
                <div className="col-span-3 sm:col-span-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Line</div>
                  <div className="tnum min-h-[44px] rounded-lg bg-black/30 px-2 py-2.5 text-sm font-bold ring-1 ring-inset ring-[var(--color-ink-700)]">
                    {money(line)}
                  </div>
                </div>
                <div className="col-span-1">
                  <button
                    type="button" aria-label="Remove ingredient"
                    onClick={() => setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((_, j) => j !== i) }))}
                    className="flex h-[44px] w-full items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-lg text-zinc-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              </li>
            )
          })}
          {draft.ingredients.length === 0 && (
            <li className="text-sm text-zinc-500">No ingredients — plate cost is $0.00. Suspicious for anything but water.</li>
          )}
        </ul>
      </div>

      <Field label="Prep notes">
        <input value={draft.prepNotes} onChange={(e) => setDraft((d) => ({ ...d, prepNotes: e.target.value }))} placeholder="Smash, rest 2 min" className={inputCls} maxLength={120} />
      </Field>

      <div className="rounded-xl bg-sky-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-sky-200/90 ring-1 ring-inset ring-sky-500/30">
        Saving writes a <strong>new cost snapshot</strong> — {snaps} already-fired line{snaps === 1 ? '' : 's'} keep
        {snaps === 1 ? 's' : ''} the old plate cost for honest history. Costs use last invoice, never a static card.
      </div>

      <button type="button" disabled={!dirty} onClick={save} className={btnPrimary}>
        {dirty ? `Save ${dish.name} · plate ${money(live.plate)} · ${(live.contribution * 100).toFixed(1)}%` : 'No changes to save'}
      </button>
    </div>
  )
}

function NewMenuItemModal({ existingItems, onClose, onCreate }) {
  const [draft, setDraft] = useState({ name: '', category: 'Mains', price: '', station: 'grill', description: '' })
  const [error, setError] = useState('')

  function create() {
    const name = draft.name.trim()
    const category = draft.category.trim()
    const price = Number(draft.price)
    if (!name || !category || !String(draft.price).trim() || !Number.isFinite(price) || price < 0) {
      setError('Add an item name, category, and valid non-negative price.')
      return
    }
    if (existingItems.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError('An item with that name already exists at this location.')
      return
    }
    onCreate({
      id: uid('m'),
      name,
      description: draft.description.trim(),
      category,
      price,
      station: draft.station,
      available: true,
      active: true,
      dietaryTags: [],
      allergens: [],
      imageUrl: '',
      sortOrder: existingItems.length,
      substituteId: null,
      modifiers: [],
    })
  }

  return (
    <Modal title="Add a menu item" sub="Saved to this location's SQLite catalog when the server is connected." onClose={onClose} wide>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Item name · required">
          <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={60} className={inputCls} />
        </Field>
        <Field label="Category · required">
          <input value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} maxLength={40} className={inputCls} />
        </Field>
        <Field label="Price $ · required">
          <input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} className={`${inputCls} tnum`} />
        </Field>
        <Field label="Kitchen station">
          <select value={draft.station} onChange={(e) => setDraft((d) => ({ ...d, station: e.target.value }))} className={inputCls}>
            {STATIONS.map((station) => <option key={station} value={station}>{STATION_META[station]?.label || station}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Guest-facing description">
        <textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          maxLength={240}
          rows={3}
          placeholder="A short description for the QR menu."
          className={`${inputCls} mt-3 min-h-[90px] resize-y`}
        />
      </Field>
      {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
      <div className="mt-4 rounded-xl bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-100 ring-1 ring-inset ring-amber-500/20">
        New dishes start with an empty recipe. Add ingredients in the coster before relying on plate-cost or stock tracking.
      </div>
      <button type="button" onClick={create} className={`${btnPrimary} mt-4`}>Add item</button>
    </Modal>
  )
}

export default function MenuScreen() {
  const { state, dispatch, selectedDishId, setSelectedDishId, locId, link } = useRestora()
  const { items: catalogMenu, source: catalogSource } = useMenuCatalog(state.menu, locId, link.status)
  const [dishId, setDishId] = useState(selectedDishId || 'm_burger')
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('All')
  const [banner, setBanner] = useState(null)
  const [newItemOpen, setNewItemOpen] = useState(false)

  function pickDish(id) {
    setDishId(id)
    setSelectedDishId(id)
  }

  function flash(msg) {
    setBanner(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setBanner(null), 4200)
  }

  const skuById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])
  const cats = useMemo(() => ['All', ...new Set(catalogMenu.map((m) => m.category))], [catalogMenu])

  const list = catalogMenu
    .filter((m) => (cat === 'All' || m.category === cat))
    .filter((m) => !query.trim() || m.name.toLowerCase().includes(query.trim().toLowerCase()))
    .map((m) => ({ m, c: costingFor(m, state.recipes[m.id], skuById) }))
    .sort((a, b) => a.c.contribution - b.c.contribution)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
            Control · step 7 · owner: Maya
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Menu &amp; Recipes</h1>
          <p className="mt-1 text-xs text-zinc-500">
            {catalogSource === 'sqlite' ? 'SQLite catalog · synced for this location' : 'Local demo catalog · SQLite sync is available when the server is running'}
          </p>
        </div>
        <button type="button" onClick={() => setNewItemOpen(true)} className="min-h-[44px] rounded-lg bg-amber-500 px-4 text-sm font-bold text-black hover:bg-amber-400">
          + Add menu item
        </button>
      </header>

      {banner && (
        <div className="animate-status-in rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-500/30" role="status">
          {banner}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-3">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes…" aria-label="Search dishes" className={inputCls}
          />
          <div className="flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button
                key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c}
                className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ring-1 ring-inset ${cat === c ? 'bg-amber-500/15 text-amber-200 ring-amber-500/40' : 'text-zinc-500 ring-[var(--color-ink-600)] hover:bg-white/5'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <ul className="max-h-[62vh] space-y-2 overflow-y-auto">
            {list.length === 0 && (
              <li className="rounded-xl border border-dashed border-[var(--color-ink-600)] p-4 text-center text-sm text-zinc-500">
                No menu items match this search.
              </li>
            )}
            {list.map(({ m, c }) => (
              <li key={m.id}>
                <button
                  type="button" onClick={() => pickDish(m.id)} aria-current={dishId === m.id}
                  className={`w-full rounded-xl border p-3 text-left ${dishId === m.id ? 'border-amber-500/60 bg-[var(--color-ink-850)] ring-1 ring-amber-500/40' : 'border-[var(--color-ink-700)] bg-[var(--color-ink-900)] hover:border-[var(--color-ink-600)]'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-bold ${m.available && m.active !== false ? '' : 'text-zinc-500 line-through'}`}>{m.name}</span>
                    <span className="tnum text-sm font-bold text-amber-300">{money(m.price)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="tnum text-[11px] text-zinc-500">plate {money(c.plate)}</span>
                    <span className="flex gap-1">
                      {!m.available && <StatusPill tone="bad" size="sm">86</StatusPill>}
                      {m.active === false && <StatusPill tone="muted" size="sm">Hidden</StatusPill>}
                      <StatusPill tone={MARGIN_BAND_META[c.band].tone} size="sm">{c.band} {(c.contribution * 100).toFixed(0)}%</StatusPill>
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="xl:col-span-2">
          <Coster dishId={dishId} onDone={flash} />
        </div>
      </div>
      {newItemOpen && (
        <NewMenuItemModal
          existingItems={state.menu}
          onClose={() => setNewItemOpen(false)}
          onCreate={(item) => {
            dispatch({ type: 'ADD_MENU_ITEM', item })
            pickDish(item.id)
            setCat('All')
            setQuery('')
            setNewItemOpen(false)
            flash(`${item.name} added. Add ingredients in the recipe below.`)
          }}
        />
      )}
    </div>
  )
}
