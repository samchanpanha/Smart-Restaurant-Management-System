// ─── Step 4: Kitchen — KDS ──────────────────────────────────────────
// Kim (kitchen lead) cooks from tickets, not paper. Station columns
// show only their items; expo sees the whole table. Age is color +
// word against the 18-min SLA. Bump is final except 60s recall.
// The 86 board writes through to the floor composer instantly.
// Supports Khmer (default), English, and Chinese, plus multi-photo
// visual references for every dish.

import { memo, useCallback, useMemo, useState } from 'react'
import StatusPill from '../components/StatusPill'
import { STATIONS, STATION_META, TARGETS } from '../lib/constants'
import {
  KITCHEN_LANGUAGES,
  getItemImages,
  translateCourse,
  translateDishDesc,
  translateDishName,
  translateInventoryName,
  translateModifier,
  translateTableName,
  useI18n,
} from '../lib/i18n'
import { formatClock, formatElapsed, secondsBetween, ticketAgeState } from '../lib/models'
import { useNow, useRestora } from '../lib/store'

const AGE_TONE = { 'on-time': 'ok', warning: 'warn', late: 'bad' }

// ─── Ticking leaves ─────────────────────────────────────────────
// The board is expensive (every fired line + dish photos). Only these small
// components subscribe to the 1s clock, so a second ticking past repaints the
// elapsed numbers — never the memoized ticket cards around them.

function useAge(firedAt) {
  const now = useNow(1000)
  return { secs: secondsBetween(firedAt, now), state: ticketAgeState(firedAt, now) }
}

function CardAge({ firedAt, dict }) {
  const { secs, state } = useAge(firedAt)
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={`tnum text-lg font-bold leading-none ${state === 'late' ? 'text-red-300' : state === 'warning' ? 'text-amber-300' : 'text-zinc-100'}`}>
        {formatElapsed(secs)}
      </span>
      <StatusPill tone={AGE_TONE[state]} size="sm">
        {dict.ageLabel[state]}
      </StatusPill>
    </div>
  )
}

function AgeRing({ firedAt }) {
  const { state } = useAge(firedAt)
  const ring = state === 'late'
    ? 'border-red-500/60 ring-1 ring-red-500/40'
    : state === 'warning'
      ? 'border-amber-500/50'
      : 'border-[var(--color-ink-700)]'
  return <span aria-hidden className={`pointer-events-none absolute inset-0 rounded-xl border ${ring}`} />
}

function LineAge({ firedAt }) {
  const { secs, state } = useAge(firedAt)
  return (
    <span className={`tnum shrink-0 text-xs ${state === 'late' ? 'font-bold text-red-300' : 'text-zinc-500'}`}>
      {formatElapsed(secs)}
    </span>
  )
}

function NewBadge({ firedAt, dict }) {
  const { secs } = useAge(firedAt)
  if (secs >= 45) return null
  return (
    <span className="animate-status-in ml-1.5 rounded bg-sky-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-sky-300 ring-1 ring-inset ring-sky-500/40">
      {dict.newBadge}
    </span>
  )
}

// ─── Item multi-photo strip ─────────────────────────────────────
// Displays the primary photo alongside additional reference thumbnails
// (plated, prep, ingredient close-up) for a dish.

function ItemPhotoStrip({ menuItem, dishName, dict, onInspect, compact = false }) {
  const images = useMemo(() => getItemImages(menuItem), [menuItem])
  const [activeIdx, setActiveIdx] = useState(0)

  if (!images.length) return null
  const mainSrc = images[activeIdx] || images[0]
  const viewLabels = dict.photoViews || []

  return (
    <div className="mt-2" data-testid={`item-photos-${menuItem?.id || 'unknown'}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onInspect && onInspect(menuItem, activeIdx)}
          title={dict.viewPhotos}
          className={`group relative shrink-0 overflow-hidden rounded-lg border border-zinc-200/80 bg-zinc-100 shadow-xs transition hover:border-orange-400 ${
            compact ? 'h-12 w-16' : 'h-14 w-20'
          }`}
        >
          <img
            src={mainSrc}
            alt={`${dishName} - ${viewLabels[activeIdx] || 'photo'}`}
            loading="lazy"
            onError={(event) => { event.currentTarget.hidden = true }}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 py-0.2 text-[9px] font-bold text-white">
            {activeIdx + 1}/{images.length}
          </span>
        </button>

        {images.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${dishName} photos`}>
            {images.map((src, idx) => (
              <button
                key={`${src}-${idx}`}
                type="button"
                onClick={() => setActiveIdx(idx)}
                onDoubleClick={() => onInspect && onInspect(menuItem, idx)}
                aria-label={`${dishName} ${viewLabels[idx] || `photo ${idx + 1}`}`}
                aria-pressed={activeIdx === idx}
                className={`relative overflow-hidden rounded-md border transition ${
                  compact ? 'h-9 w-12' : 'h-10 w-13'
                } ${
                  activeIdx === idx
                    ? 'border-orange-500 ring-2 ring-orange-400/50'
                    : 'border-zinc-200/70 opacity-75 hover:opacity-100'
                }`}
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  onError={(event) => { event.currentTarget.hidden = true }}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Dish photo & prep modal ────────────────────────────────────

function DishPhotoModal({ dish, initialIndex = 0, recipe, invById, lang, dict, onClose }) {
  const images = useMemo(() => getItemImages(dish), [dish])
  const [idx, setIdx] = useState(initialIndex)
  if (!dish) return null

  const dishName = translateDishName(dish, lang)
  const dishDesc = translateDishDesc(dish, lang)
  const viewLabels = dict.photoViews || []
  const currentSrc = images[idx] || images[0]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={dishName}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">
              {dict.stations[dish.station] || STATION_META[dish.station]?.label || dish.station} · {translateCourse(dish.course, lang)}
            </div>
            <h2 className="mt-0.5 text-xl font-bold text-zinc-100">{dishName}</h2>
            {lang !== 'en' && <div className="text-xs text-zinc-400">{dish.name}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-bold text-zinc-300 hover:bg-white/5"
          >
            {dict.closeModal} ✕
          </button>
        </div>

        {currentSrc && (
          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-ink-700)] bg-black/20">
            <img
              src={currentSrc}
              alt={dishName}
              className="h-56 w-full object-cover sm:h-64"
            />
            <div className="flex items-center justify-between px-3 py-2 text-xs text-zinc-400">
              <span className="font-semibold text-zinc-200">
                {viewLabels[idx] || `Photo ${idx + 1}`}
              </span>
              <span>
                {idx + 1} / {images.length}
              </span>
            </div>
          </div>
        )}

        {images.length > 1 && (
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {images.map((src, i) => (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={() => setIdx(i)}
                aria-pressed={idx === i}
                className={`overflow-hidden rounded-xl border p-1.5 text-left transition ${
                  idx === i
                    ? 'border-orange-500 bg-orange-500/10 ring-1 ring-orange-500/50'
                    : 'border-[var(--color-ink-700)] bg-[var(--color-ink-850)] hover:border-orange-400/50'
                }`}
              >
                <img src={src} alt="" className="h-20 w-full rounded-lg object-cover" />
                <div className="mt-1 truncate text-[11px] font-semibold text-zinc-200">
                  {viewLabels[i] || `#${i + 1}`}
                </div>
              </button>
            ))}
          </div>
        )}

        {dishDesc && <p className="mt-3 text-sm text-zinc-300">{dishDesc}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-850)] p-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
              {dict.prepNotes}
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">
              {recipe?.prepNotes || '—'}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-850)] p-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
              {dict.ingredientsLabel}
            </div>
            <ul className="mt-1 space-y-1 text-xs text-zinc-300">
              {(recipe?.ingredients || []).map((ing, i) => {
                const inv = invById[ing.inventoryItemId]
                return (
                  <li key={i} className="flex justify-between">
                    <span>{translateInventoryName(inv, lang) || ing.inventoryItemId}</span>
                    <span className="tnum font-semibold text-zinc-400">
                      {ing.qty} {inv?.unit || ing.unit}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Ticket card ────────────────────────────────────────────────
// One card = one order's fired lines for this column. Oldest first.

const TicketCard = memo(function TicketCard({ order, tableName, server, lines, lang, dict, showImages, tables, dispatch, onInspectDish }) {
  const oldest = lines.reduce((a, b) => (new Date(a.firedAt) < new Date(b.firedAt) ? a : b))
  const firedLines = lines.filter((l) => l.status === 'fired')

  function bumpAll() {
    for (const l of firedLines) dispatch({ type: 'BUMP_ITEM', orderId: order.id, itemId: l.id })
  }

  const prevTable = order?.transferredFromTableId
    ? tables?.find((t) => String(t.id) === String(order.transferredFromTableId))
    : null
  const prevTableName = prevTable ? translateTableName(prevTable.name, lang) : order?.transferredFromTableId

  return (
    <article className="relative rounded-xl border border-transparent bg-[var(--color-ink-900)]">
      <AgeRing firedAt={oldest.firedAt} />
      <header className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap truncate text-sm font-bold">
            <span>{translateTableName(tableName, lang)}</span>
            <span className="font-normal text-zinc-500">· {server}</span>
            {order?.transferredFromTableId && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-inset ring-amber-500/40">
                Moved: {prevTableName} ➔ {translateTableName(tableName, lang)}
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-500">{dict.firedAt(formatClock(oldest.firedAt))}</div>
        </div>
        <CardAge firedAt={oldest.firedAt} dict={dict} />
      </header>

      <ul className="divide-y divide-white/5">
        {lines.map((l) => {
          const localName = l.menuItem ? translateDishName(l.menuItem, lang) : l.name
          return (
            <li key={l.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-snug text-zinc-100">
                    {l.qty}× {localName}
                    {lang !== 'en' && l.name && localName !== l.name && (
                      <span className="sr-only"> ({l.name})</span>
                    )}
                    {l.by === 'guest' && (
                      <span className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-violet-300 ring-1 ring-inset ring-violet-500/40">
                        QR{l.guest ? ` · ${l.guest}` : ''}
                      </span>
                    )}
                    <NewBadge firedAt={l.firedAt} dict={dict} />
                    {(l.transferredFromTableId || order?.transferredFromTableId) && (
                      <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-300 ring-1 ring-inset ring-amber-500/40">
                        Moved
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-zinc-400">
                    <span className="rounded bg-black/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide">
                      {translateCourse(l.course, lang)}
                    </span>
                    {(l.modifiers || []).map((m) => (
                      <span key={m.id} className="rounded bg-black/40 px-1.5 py-0.5">
                        {translateModifier(m.value, lang)}
                      </span>
                    ))}
                    {l.notes && <span className="italic">“{l.notes}”</span>}
                    {l.comped && <span className="font-semibold text-amber-300">{dict.compBadge}</span>}
                  </div>
                </div>
                <LineAge firedAt={l.firedAt} />
              </div>

              {showImages && l.menuItem && (
                <ItemPhotoStrip
                  menuItem={l.menuItem}
                  dishName={localName}
                  dict={dict}
                  onInspect={onInspectDish}
                />
              )}

              <button
                type="button"
                onClick={() => dispatch({ type: 'BUMP_ITEM', orderId: order.id, itemId: l.id })}
                className="mt-2 min-h-[48px] w-full rounded-lg bg-emerald-500/90 text-base font-bold text-black transition-colors hover:bg-emerald-400 active:scale-[0.99]"
              >
                {dict.bumpItem(localName)}
              </button>
            </li>
          )
        })}
      </ul>

      {firedLines.length > 1 && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={bumpAll}
            className="min-h-[52px] w-full rounded-lg border-2 border-emerald-500/60 text-base font-bold text-emerald-300 hover:bg-emerald-500/10"
          >
            {dict.bumpAll(firedLines.length)}
          </button>
        </div>
      )}
    </article>
  )
})

// ─── 86 board ───────────────────────────────────────────────────

function EightySixBoard({ lang, dict, showImages, onInspectDish }) {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const off = state.menu.filter((m) => m.active !== false && !m.available)
  const on = state.menu.filter((m) => m.active !== false && m.available)
  const outStock = state.inventory.filter((i) => i.onHand <= 0)

  return (
    <div className="grid gap-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-red-300">
          {dict.eightySixedNow(off.length)}
        </h3>
        {off.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">{dict.fullMenuAvailable}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {off.map((m) => {
              const localName = translateDishName(m, lang)
              const subDish = m.substituteId ? menuById[m.substituteId] : null
              const subName = subDish ? translateDishName(subDish, lang) : ''
              const imgs = getItemImages(m)
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-ink-900)] p-2.5 ring-1 ring-inset ring-red-500/20">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {showImages && imgs.length > 0 && (
                      <div className="flex shrink-0 items-center gap-1">
                        {imgs.slice(0, 2).map((src, idx) => (
                          <button
                            key={`${src}-${idx}`}
                            type="button"
                            onClick={() => onInspectDish && onInspectDish(m, idx)}
                            className="h-11 w-14 overflow-hidden rounded-lg border border-zinc-200/70 bg-zinc-100"
                          >
                            <img src={src} alt={localName} className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-100">{localName}</div>
                      <div className="text-[11px] text-zinc-500">
                        {subDish ? dict.floorSuggests(subName) : dict.noSubstitute}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_86', menuItemId: m.id, available: true })}
                    className="min-h-[44px] shrink-0 rounded-lg bg-emerald-500/90 px-4 text-sm font-bold text-black hover:bg-emerald-400"
                  >
                    {dict.backOn}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {outStock.length > 0 && (
          <div className="mt-3 rounded-xl bg-black/30 p-2.5 text-xs text-zinc-400 ring-1 ring-inset ring-[var(--color-ink-700)]">
            <span className="font-semibold text-zinc-200">{dict.stockOutsHittingRecipes}</span>
            {outStock.map((i) => {
              const dishes = state.menu.filter((m) =>
                state.recipes[m.id]?.ingredients.some((ing) => ing.inventoryItemId === i.id),
              )
              return `${translateInventoryName(i, lang)} → ${dishes.map((d) => translateDishName(d, lang)).join(', ') || '—'}`
            }).join(' · ')}
            <span className="text-zinc-500">{dict.receivingLandsStep5}</span>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          {dict.eightySixADish}
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {on.map((m) => {
            const localName = translateDishName(m, lang)
            const imgs = getItemImages(m)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => dispatch({ type: 'SET_86', menuItemId: m.id, available: false })}
                className="flex min-h-[54px] items-center gap-2.5 rounded-xl border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-2.5 py-2 text-left transition-colors hover:border-red-500/50"
              >
                {showImages && imgs[0] && (
                  <img
                    src={imgs[0]}
                    alt=""
                    loading="lazy"
                    className="h-10 w-12 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200/70"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-zinc-200">{localName}</div>
                  <div className="text-[11px] text-zinc-500">{dict.tapTo86}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Kitchen Dish Multi-Photo Gallery ───────────────────────────
// Displays all menu dishes with their multiple reference photos
// (plated, prep, ingredient close-up) so kitchen staff can see every
// item's visual standard right from the Kitchen screen.

function KitchenDishGallery({ menu, recipes, lang, dict, onInspectDish }) {
  const [stationFilter, setStationFilter] = useState('all')
  const stations = ['all', ...STATIONS.filter((s) => s !== 'expo')]
  const items = useMemo(
    () =>
      menu
        .filter((m) => m.active !== false)
        .filter((m) => stationFilter === 'all' || m.station === stationFilter),
    [menu, stationFilter],
  )
  const viewLabels = dict.photoViews || []

  return (
    <section
      className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4"
      aria-label={dict.galleryTitle}
      data-testid="kitchen-dish-gallery"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{dict.galleryTitle}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{dict.gallerySubtitle}</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Gallery station filter">
          {stations.map((st) => (
            <button
              key={st}
              type="button"
              role="tab"
              aria-selected={stationFilter === st}
              onClick={() => setStationFilter(st)}
              className={`min-h-[36px] rounded-lg px-3 text-xs font-bold transition-colors ${
                stationFilter === st
                  ? 'bg-orange-500 text-white'
                  : 'border border-[var(--color-ink-600)] text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              {dict.stations[st] || STATION_META[st]?.label || st}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((dish) => {
          const imgs = getItemImages(dish)
          const localName = translateDishName(dish, lang)
          const prepNotes = recipes[dish.id]?.prepNotes
          return (
            <div
              key={dish.id}
              data-testid={`gallery-card-${dish.id}`}
              className="flex flex-col justify-between rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-850)] p-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-zinc-100">{localName}</div>
                    {lang !== 'en' && localName !== dish.name && (
                      <div className="sr-only">{dish.name}</div>
                    )}
                  </div>
                  <StatusPill tone={dish.available ? 'ok' : 'bad'} size="sm">
                    {dish.available ? dict.availableStatus : dict.unavailableStatus}
                  </StatusPill>
                </div>

                {/* Multiple images per item: main + secondary angles */}
                <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                  {imgs.map((src, idx) => (
                    <button
                      key={`${src}-${idx}`}
                      type="button"
                      onClick={() => onInspectDish(dish, idx)}
                      title={`${localName} — ${viewLabels[idx] || `#${idx + 1}`}`}
                      className="group relative overflow-hidden rounded-lg border border-zinc-200/80 bg-zinc-100"
                    >
                      <img
                        src={src}
                        alt={`${localName} ${viewLabels[idx] || idx + 1}`}
                        loading="lazy"
                        onError={(event) => { event.currentTarget.hidden = true }}
                        className="h-16 w-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="block truncate bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
                        {viewLabels[idx] || `#${idx + 1}`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/5 pt-2 text-[11px] text-zinc-500">
                <span className="truncate">
                  {dict.stations[dish.station] || STATION_META[dish.station]?.label || dish.station}
                  {prepNotes ? ` · ${prepNotes}` : ''}
                </span>
                <span className="shrink-0 font-semibold text-orange-500">
                  {dict.photosCount(imgs.length)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── SLA strip ──────────────────────────────────────────────────

function SlaStrip({ fired, bumpedToday, dict }) {
  const now = useNow(1000)
  const lateCount = fired.filter((r) => ticketAgeState(r.item.firedAt, now) === 'late').length
  const avgAge = fired.length
    ? Math.round(fired.reduce((s, r) => s + secondsBetween(r.item.firedAt, now), 0) / fired.length)
    : 0
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {[
        { label: dict.firedNow, value: String(fired.length), tone: 'info' },
        { label: dict.latePct(fired.length ? Math.round((lateCount / fired.length) * 100) : 0), value: String(lateCount), tone: lateCount ? 'bad' : 'ok' },
        { label: dict.avgAge, value: formatElapsed(avgAge), tone: 'muted' },
        { label: dict.bumpedToday, value: String(bumpedToday), tone: 'ok' },
      ].map((s) => (
        <div key={s.label} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3">
          <div className="tnum text-2xl font-bold">{s.value}</div>
          <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Recall strip ───────────────────────────────────────────────

function RecallStrip({ menuById, lang, dict, showImages }) {
  const { state, dispatch } = useRestora()
  const now = useNow(1000)
  const recallable = useMemo(() => {
    const rows = []
    for (const order of state.orders) {
      if (['paid', 'void'].includes(order.status)) continue
      for (const item of order.items) {
        const key = `${order.id}:${item.id}`
        if (item.status === 'bump' && state.recalls[key] && state.recalls[key] > now) {
          const menuItem = menuById[item.menuItemId] || null
          rows.push({
            order,
            item,
            menuItem,
            name: menuItem ? translateDishName(menuItem, lang) : 'item',
            left: Math.ceil((state.recalls[key] - now) / 1000),
          })
        }
      }
    }
    return rows.sort((a, b) => a.left - b.left)
  }, [state.orders, state.recalls, menuById, now, lang])

  if (!recallable.length) return null
  return (
    <div className="animate-status-in rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-sky-300">{dict.recallHeader}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {recallable.map((r) => {
          const imgs = getItemImages(r.menuItem)
          return (
            <button
              key={`${r.order.id}:${r.item.id}`}
              type="button"
              onClick={() => dispatch({ type: 'RECALL_ITEM', orderId: r.order.id, itemId: r.item.id })}
              className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-500/15 px-3.5 text-sm font-semibold text-sky-200 ring-1 ring-inset ring-sky-500/40 hover:bg-sky-500/25"
            >
              {showImages && imgs[0] && <img src={imgs[0]} alt="" className="h-7 w-9 rounded object-cover" />}
              <span>↩ {r.item.qty}× {r.name} · {r.left}s</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Board ──────────────────────────────────────────────────────
// Owns the 1s clock for late filtering and column headers. Cards are memoized
// and receive only data props, so a tick repaints the board shell — not cards.

function KitchenBoard({ fired, lateOnly, dict, lang, showImages, tables, dispatch, onInspectDish }) {
  const now = useNow(1000)
  const columns = useMemo(() => STATIONS.map((station) => {
    const rows = station === 'expo' ? fired : fired.filter((r) => r.item.station === station)
    const byOrder = new Map()
    for (const r of rows) {
      if (!byOrder.has(r.order.id)) {
        byOrder.set(r.order.id, { order: r.order, tableName: r.tableName, server: r.server, lines: [] })
      }
      byOrder.get(r.order.id).lines.push({ ...r.item, name: r.name, menuItem: r.menuItem })
    }
    const cards = [...byOrder.values()]
      .map((c) => ({ ...c, lines: c.lines.sort((a, b) => new Date(a.firedAt) - new Date(b.firedAt)) }))
      .sort((a, b) => new Date(a.lines[0].firedAt) - new Date(b.lines[0].firedAt))
    return { station, cards }
  }), [fired])

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" role="region" aria-label="Kitchen display columns">
      {columns.map(({ station, cards }) => {
        const visible = lateOnly
          ? cards
            .map((c) => ({ ...c, lines: c.lines.filter((l) => ticketAgeState(l.firedAt, now) === 'late') }))
            .filter((c) => c.lines.length)
          : cards
        const count = visible.reduce((s, c) => s + c.lines.length, 0)
        const hasLate = cards.some((c) => c.lines.some((l) => ticketAgeState(l.firedAt, now) === 'late'))
        return (
          <section key={station} className="w-[300px] min-w-[300px] flex-1" aria-label={`${STATION_META[station].label} station`}>
            <div className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 ring-1 ring-inset ${hasLate ? 'bg-red-500/10 ring-red-500/40' : 'bg-[var(--color-ink-900)] ring-[var(--color-ink-700)]'}`}>
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">
                {dict.stations[station] || STATION_META[station].label}
                {station === 'expo' && <span className="ml-1.5 font-normal normal-case text-zinc-500">{dict.wholeTable}</span>}
              </h2>
              <span className={`tnum rounded-full px-2 py-0.5 text-xs font-bold ${hasLate ? 'bg-red-500/20 text-red-200' : 'bg-black/40 text-zinc-400'}`}>
                {count}
              </span>
            </div>
            <div className="max-h-[62vh] space-y-2.5 overflow-y-auto pr-0.5">
              {visible.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--color-ink-600)] p-5 text-center text-sm text-zinc-600">
                  {lateOnly ? dict.noLateTickets : dict.allClear}
                </div>
              )}
              {visible.map((c) => (
                <TicketCard
                  key={`${station}-${c.order.id}`}
                  order={c.order}
                  tableName={c.tableName}
                  server={c.server}
                  lines={c.lines}
                  lang={lang}
                  dict={dict}
                  showImages={showImages}
                  tables={tables}
                  dispatch={dispatch}
                  onInspectDish={onInspectDish}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function KitchenScreen() {
  const { state, dispatch } = useRestora()
  const { lang, setLang: switchLanguage, kitchenDict: dict } = useI18n()
  const [lateOnly, setLateOnly] = useState(false)
  const offCount = state.menu.filter((m) => m.active !== false && !m.available).length
  const [boardOpen, setBoardOpen] = useState(offCount > 0)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [inspected, setInspected] = useState(null) // { dish, index }

  const showImages = state.settings?.food?.showImages !== false

  const inspectDish = useCallback((dish, index = 0) => setInspected({ dish, index }), [])

  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const tableById = useMemo(() => Object.fromEntries(state.tables.map((t) => [t.id, t])), [state.tables])
  const invById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])

  // All fired, un-bumped, un-voided lines across open tickets
  const fired = useMemo(() => {
    const rows = []
    for (const order of state.orders) {
      if (['paid', 'void'].includes(order.status)) continue
      for (const item of order.items) {
        if (item.status !== 'fired' || item.voided || !item.firedAt) continue
        const menuItem = menuById[item.menuItemId] || null
        rows.push({
          order,
          tableName: tableById[order.tableId]?.name || order.type,
          server: order.serverId === 'server' ? 'Jordan' : order.serverId,
          item,
          menuItem,
          name: menuItem?.name || 'Unknown',
        })
      }
    }
    return rows
  }, [state.orders, tableById, menuById])

  const bumpedToday = state.orders.flatMap((o) => o.items).filter((i) => i.status === 'bump').length

  const activeDishCount = state.menu.filter((m) => m.active !== false).length

  return (
    <div className="space-y-4" data-lang={lang}>
      {/* Screen-reader & contract marker so workspace/tab tests always recognise Kitchen */}
      <span className="sr-only">Live kitchen display · Kitchen</span>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">
            {dict.liveDisplay(TARGETS.ticketMinutes)}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{dict.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{dict.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Language switcher: Khmer (default), English, Chinese */}
          <div
            className="flex items-center gap-1 rounded-xl border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] p-1 shadow-xs"
            role="group"
            aria-label={dict.languageLabel}
            data-testid="kitchen-language-switcher"
          >
            {KITCHEN_LANGUAGES.map((option) => {
              const active = lang === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => switchLanguage(option.id)}
                  aria-pressed={active}
                  data-testid={`kitchen-lang-${option.id}`}
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-bold transition-colors ${
                    active
                      ? 'bg-orange-500 text-white shadow-xs'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => setGalleryOpen((v) => !v)}
            aria-expanded={galleryOpen}
            data-testid="kitchen-gallery-toggle"
            className={`min-h-[44px] rounded-lg px-3.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              galleryOpen
                ? 'bg-orange-500/15 text-orange-600 ring-orange-500/40'
                : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'
            }`}
          >
            {dict.dishGalleryBtn(activeDishCount)}
          </button>

          <button
            type="button"
            onClick={() => setLateOnly((v) => !v)}
            aria-pressed={lateOnly}
            className={`min-h-[44px] rounded-lg px-3.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              lateOnly ? 'bg-red-500 text-black ring-red-500' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'
            }`}
          >
            {lateOnly ? dict.showingLateOnly : dict.lateOnly}
          </button>

          <button
            type="button"
            onClick={() => setBoardOpen((v) => !v)}
            aria-expanded={boardOpen}
            className={`min-h-[44px] rounded-lg px-3.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              boardOpen ? 'bg-red-500/20 text-red-200 ring-red-500/50' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'
            }`}
          >
            {dict.eightySixBoard(offCount)}
          </button>
        </div>
      </header>

      {/* SLA strip */}
      <SlaStrip fired={fired} bumpedToday={bumpedToday} dict={dict} />

      <RecallStrip menuById={menuById} lang={lang} dict={dict} showImages={showImages} />

      {boardOpen && (
        <EightySixBoard
          lang={lang}
          dict={dict}
          showImages={showImages}
          onInspectDish={inspectDish}
        />
      )}

      {/* Board */}
      <KitchenBoard
        fired={fired}
        lateOnly={lateOnly}
        dict={dict}
        lang={lang}
        showImages={showImages}
        tables={state.tables}
        dispatch={dispatch}
        onInspectDish={inspectDish}
      />

      {/* Multi-photo dish gallery */}
      {showImages && galleryOpen && (
        <KitchenDishGallery
          menu={state.menu}
          recipes={state.recipes}
          lang={lang}
          dict={dict}
          onInspectDish={inspectDish}
        />
      )}

      {inspected?.dish && (
        <DishPhotoModal
          dish={inspected.dish}
          initialIndex={inspected.index}
          recipe={state.recipes[inspected.dish.id]}
          invById={invById}
          lang={lang}
          dict={dict}
          onClose={() => setInspected(null)}
        />
      )}
    </div>
  )
}
