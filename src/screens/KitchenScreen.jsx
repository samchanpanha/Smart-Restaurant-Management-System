// ─── Step 4: Kitchen — KDS ──────────────────────────────────────────
// Kim (kitchen lead) cooks from tickets, not paper. Station columns
// show only their items; expo sees the whole table. Age is color +
// word against the 18-min SLA. Bump is final except 60s recall.
// The 86 board writes through to the floor composer instantly.
//
// Every line carries the dish's photo; a tap opens all of its photos,
// large, with the modifiers, allergens and prep notes beside them. The
// screen speaks Khmer by default, with English and Chinese one tap away
// (remembered per terminal). Dish names come from each item's own
// translations; notes typed by staff are shown exactly as written.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import LanguageSwitch from '../components/LanguageSwitch'
import PhotoCarousel from '../components/PhotoCarousel'
import StatusPill from '../components/StatusPill'
import { STATIONS, STATION_META, TARGETS } from '../lib/constants'
import { createTranslator, formatClockIn, languageMeta, localizeTableName, localizeTerm, localizedName } from '../lib/i18n'
import { itemPhotos } from '../lib/images'
import { KITCHEN_STRINGS } from '../lib/kitchen-strings'
import { formatElapsed, secondsBetween, ticketAgeState } from '../lib/models'
import { useNow, useRestora } from '../lib/store'
import { useLanguage } from '../lib/useLanguage'

const AGE_TONE = { 'on-time': 'ok', warning: 'warn', late: 'bad' }
const AGE_KEY = { 'on-time': 'ageOnTime', warning: 'ageWarning', late: 'ageLate' }
const LIST_SEPARATOR = { en: ', ', km: ', ', zh: '、' }

function ageOf(firedAt, now) {
  return { secs: secondsBetween(firedAt, now), state: ticketAgeState(firedAt, now) }
}

function stationName(station, lang) {
  return localizeTerm(STATION_META[station]?.label || station, lang, 'station')
}

// Order lines store courses in lower case ("main"); show them like a label.
function courseName(course, lang) {
  const text = localizeTerm(course, lang, 'course')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

// ─── Dish thumbnail ─────────────────────────────────────────────
// The first photo, square, with a "+2" when there are more. It is a
// button: the photos and the dish details are one tap away. A dish with
// no photo still gets a tile, so every line lines up the same way.

function DishThumb({ photos, label, onOpen, size = 'md' }) {
  const [failed, setFailed] = useState(false)
  const src = photos[0]
  const box = size === 'sm' ? 'h-9 w-9 rounded-md' : 'h-14 w-14 rounded-lg'
  const body = src && !failed ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  ) : (
    <span className="flex h-full w-full items-center justify-center text-zinc-400">
      <Icon name="photo" size={size === 'sm' ? 16 : 20} />
    </span>
  )
  const frame = `relative shrink-0 overflow-hidden bg-[var(--color-ink-800)] ring-1 ring-inset ring-[var(--color-ink-700)] ${box}`
  if (!onOpen) return <span className={frame} aria-hidden="true">{body}</span>
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={`${frame} transition hover:ring-2 hover:ring-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500`}
    >
      {body}
      {photos.length > 1 && (
        <span aria-hidden="true" className="tnum absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] font-bold leading-4 text-white">
          +{photos.length - 1}
        </span>
      )}
    </button>
  )
}

// ─── Dish dialog: every photo + what the ticket says ───────────────
// Opened from a ticket line. It reads the line live from state, so a
// bump on another terminal shows here at once.

function DetailRow({ label, children }) {
  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] px-3 py-2.5 ring-1 ring-inset ring-[var(--color-ink-700)]">
      <dt className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-100">{children}</dd>
    </div>
  )
}

function Chips({ items, tone = 'plain' }) {
  const cls = tone === 'warn'
    ? 'bg-red-500/10 text-red-300 ring-red-500/30'
    : 'bg-black/40 text-zinc-200 ring-[var(--color-ink-700)]'
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className={`rounded-md px-2 py-0.5 text-sm font-semibold ring-1 ring-inset ${cls}`}>{item}</span>
      ))}
    </span>
  )
}

function DishDialog({ target, lang, t, onClose }) {
  const { state, dispatch } = useRestora()
  const titleId = useId()
  const closeRef = useRef(null)
  const [photoIndex, setPhotoIndex] = useState(0)

  const order = state.orders.find((entry) => entry.id === target.orderId)
  const line = order?.items.find((entry) => entry.id === target.lineId)
  const table = state.tables.find((entry) => entry.id === order?.tableId)
  const tableName = table ? localizeTableName(table.name, lang) : localizeTerm(order?.type, lang, 'orderType')
  const dish = state.menu.find((entry) => entry.id === (line?.menuItemId || target.menuItemId))
  const photos = itemPhotos(dish)
  const name = dish ? localizedName(dish, lang) : t('unknownItem')
  const englishName = dish?.name || ''
  const recipe = dish ? state.recipes?.[dish.id] : null
  const station = line?.station || dish?.station
  const course = line?.course || dish?.course
  const modifiers = (line?.modifiers || []).map((modifier) => localizeTerm(modifier.value, lang, 'modifier')).filter(Boolean)
  const allergens = (dish?.allergens || []).map((allergen) => localizeTerm(allergen, lang, 'allergen'))
  const diet = [
    ...(dish?.dietaryTags || []).map((tag) => localizeTerm(tag, lang, 'diet')),
    ...(dish?.spiceLevel ? [`${t('spice')}: ${localizeTerm(dish.spiceLevel, lang, 'spice')}`] : []),
  ]
  const fired = line?.status === 'fired' && !line?.voided

  // Focus the dialog on open, hand focus back to the thumbnail on close.
  // The opener comes from the click itself: Safari never focuses a button
  // it clicks, so document.activeElement would just be <body>.
  useEffect(() => {
    const opener = target.opener || document.activeElement
    closeRef.current?.focus()
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once per opening

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function bump() {
    if (!order || !line) return
    dispatch({ type: 'BUMP_ITEM', orderId: order.id, itemId: line.id })
    onClose()
  }

  const where = [tableName, station && stationName(station, lang), course && courseName(course, lang)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        lang={languageMeta(lang).htmlLang}
        className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] p-4 shadow-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-bold leading-snug text-zinc-100">
              {line ? `${line.qty}× ` : ''}{name}
            </h2>
            {englishName && englishName !== name && (
              <p lang="en" className="text-sm font-medium text-zinc-500">{englishName}</p>
            )}
            {where && <p className="mt-0.5 text-sm text-zinc-400">{where}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-2xl text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          >
            ×
          </button>
        </div>

        {photos.length > 0 ? (
          <PhotoCarousel
            photos={photos}
            index={photoIndex}
            onIndexChange={setPhotoIndex}
            altFor={(position) => t('photoAlt', { name, index: position + 1, count: photos.length })}
            labels={{
              prev: t('prevPhoto'),
              next: t('nextPhoto'),
              missing: t('photoMissing'),
              show: (position) => t('showPhoto', { index: position + 1 }),
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-ink-600)] px-4 py-10 text-center text-sm text-zinc-500">
            <Icon name="photo" size={30} />
            {t('noPhotos')}
          </div>
        )}

        <dl className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {modifiers.length > 0 && <DetailRow label={t('options')}><Chips items={modifiers} /></DetailRow>}
          {line?.notes && <DetailRow label={t('note')}><span className="italic">“{line.notes}”</span></DetailRow>}
          {allergens.length > 0 && <DetailRow label={t('allergens')}><Chips items={allergens} tone="warn" /></DetailRow>}
          {diet.length > 0 && <DetailRow label={t('diet')}><Chips items={diet} /></DetailRow>}
          {recipe?.prepNotes && <DetailRow label={t('prepNotes')}>{recipe.prepNotes}</DetailRow>}
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {fired ? (
            <button
              type="button"
              onClick={bump}
              className="min-h-[48px] flex-1 rounded-lg bg-emerald-500/90 px-4 text-base font-bold text-black transition-colors hover:bg-emerald-400"
            >
              {t('bump', { name })}
            </button>
          ) : (
            line && <StatusPill tone="ok">{t('bumpedState')}</StatusPill>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] rounded-lg px-5 text-sm font-bold text-zinc-300 ring-1 ring-inset ring-[var(--color-ink-600)] hover:bg-white/5"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Ticket card ────────────────────────────────────────────────
// One card = one order's fired lines for this column. Oldest first.

function TicketCard({ order, tableName, server, lines, now, lang, t, showPhotos, onOpenDish }) {
  const { dispatch } = useRestora()
  const oldest = lines.reduce((a, b) => (new Date(a.firedAt) < new Date(b.firedAt) ? a : b))
  const cardAge = ageOf(oldest.firedAt, now)
  const firedLines = lines.filter((l) => l.status === 'fired')

  function bumpAll() {
    for (const l of firedLines) dispatch({ type: 'BUMP_ITEM', orderId: order.id, itemId: l.id })
  }

  return (
    <article
      className={`rounded-xl border bg-[var(--color-ink-900)] ${
        cardAge.state === 'late'
          ? 'border-red-500/60 ring-1 ring-red-500/40'
          : cardAge.state === 'warning'
            ? 'border-amber-500/50'
            : 'border-[var(--color-ink-700)]'
      }`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">
            {tableName} <span className="font-normal text-zinc-500">· {server}</span>
          </div>
          <div className="text-[11px] text-zinc-500">{t('firedAt', { time: formatClockIn(oldest.firedAt, lang) })}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`tnum text-lg font-bold leading-none ${cardAge.state === 'late' ? 'text-red-300' : cardAge.state === 'warning' ? 'text-amber-300' : 'text-zinc-100'}`}>
            {formatElapsed(cardAge.secs)}
          </span>
          <StatusPill tone={AGE_TONE[cardAge.state]} size="sm">
            {t(AGE_KEY[cardAge.state])}
          </StatusPill>
        </div>
      </header>

      <ul className="divide-y divide-white/5">
        {lines.map((l) => {
          const a = ageOf(l.firedAt, now)
          const isNew = a.secs < 45
          const photoLabel = l.photos.length > 1
            ? t('viewPhotos', { count: l.photos.length, name: l.name })
            : l.photos.length === 1 ? t('viewPhoto', { name: l.name }) : t('noPhotoDetails', { name: l.name })
          return (
            <li key={l.id} className="px-3 py-2" data-line={l.id}>
              <div className="flex items-start gap-2.5">
                {showPhotos && (
                  <DishThumb
                    key={l.photos[0] || 'none'}
                    photos={l.photos}
                    label={photoLabel}
                    onOpen={(event) => onOpenDish({ orderId: order.id, lineId: l.id, menuItemId: l.menuItemId, opener: event.currentTarget })}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-sm font-semibold leading-snug text-zinc-100">
                      {l.qty}× {l.name}
                      {l.by === 'guest' && (
                        <span className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-violet-300 ring-1 ring-inset ring-violet-500/40">
                          {t('badgeQr')}{l.guest ? ` · ${l.guest}` : ''}
                        </span>
                      )}
                      {isNew && (
                        <span className="animate-status-in ml-1.5 rounded bg-sky-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-sky-300 ring-1 ring-inset ring-sky-500/40">
                          {t('badgeNew')}
                        </span>
                      )}
                    </div>
                    <span className={`tnum shrink-0 text-xs ${a.state === 'late' ? 'font-bold text-red-300' : 'text-zinc-500'}`}>
                      {formatElapsed(a.secs)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-zinc-400">
                    {l.course && (
                      <span className="rounded bg-black/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide">{localizeTerm(l.course, lang, 'course')}</span>
                    )}
                    {(l.modifiers || []).map((m) => (
                      <span key={m.id} className="rounded bg-black/40 px-1.5 py-0.5">{localizeTerm(m.value, lang, 'modifier')}</span>
                    ))}
                    {l.notes && <span className="italic">“{l.notes}”</span>}
                    {l.comped && <span className="font-semibold text-amber-300">{t('comp')}</span>}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: 'BUMP_ITEM', orderId: order.id, itemId: l.id })}
                className="mt-2 min-h-[44px] w-full rounded-lg bg-emerald-500/90 px-2 text-sm font-bold text-black transition-colors hover:bg-emerald-400 active:scale-[0.99]"
              >
                {t('bump', { name: l.name })}
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
            className="min-h-[44px] w-full rounded-lg border border-emerald-500/50 text-sm font-bold text-emerald-300 hover:bg-emerald-500/10"
          >
            {t('bumpAll', { count: firedLines.length })}
          </button>
        </div>
      )}
    </article>
  )
}

// ─── 86 board ───────────────────────────────────────────────────

function EightySixBoard({ lang, t, showPhotos }) {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const off = state.menu.filter((m) => m.active !== false && !m.available)
  const on = state.menu.filter((m) => m.active !== false && m.available)
  const outStock = state.inventory.filter((i) => i.onHand <= 0)
  const separator = LIST_SEPARATOR[lang] || ', '

  return (
    <div className="grid gap-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-red-300">
          {t('board86Now', { count: off.length })}
        </h3>
        {off.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">{t('fullMenu')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {off.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-ink-900)] p-2.5 ring-1 ring-inset ring-red-500/20">
                <div className="flex min-w-0 items-center gap-2.5">
                  {showPhotos && <DishThumb photos={itemPhotos(m)} size="sm" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-100">{localizedName(m, lang)}</div>
                    <div className="text-[11px] text-zinc-500">
                      {m.substituteId && menuById[m.substituteId]
                        ? t('floorSuggests', { name: localizedName(menuById[m.substituteId], lang) })
                        : t('noSubstitute')}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_86', menuItemId: m.id, available: true })}
                  className="min-h-[44px] shrink-0 rounded-lg bg-emerald-500/90 px-4 text-sm font-bold text-black hover:bg-emerald-400"
                >
                  {t('backOn')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {outStock.length > 0 && (
          <div className="mt-3 rounded-xl bg-black/30 p-2.5 text-xs text-zinc-400 ring-1 ring-inset ring-[var(--color-ink-700)]">
            <span className="font-semibold text-zinc-200">{t('stockOuts')} </span>
            {outStock.map((i) => {
              const dishes = state.menu.filter((m) =>
                state.recipes[m.id]?.ingredients.some((ing) => ing.inventoryItemId === i.id),
              )
              return `${localizedName(i, lang)} → ${dishes.map((d) => localizedName(d, lang)).join(separator) || '—'}`
            }).join(' · ')}
            <span className="text-zinc-500"> {t('stockOutsHint')}</span>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          {t('mark86')}
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {on.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => dispatch({ type: 'SET_86', menuItemId: m.id, available: false })}
              className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-2.5 py-2 text-left transition-colors hover:border-red-500/50"
            >
              {showPhotos && <DishThumb photos={itemPhotos(m)} size="sm" />}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-zinc-200">{localizedName(m, lang)}</span>
                <span className="block text-[11px] text-zinc-500">{t('tapTo86')}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function KitchenScreen() {
  const { state, dispatch } = useRestora()
  const now = useNow(1000)
  const [lang, setLang] = useLanguage()
  const t = useMemo(() => createTranslator(KITCHEN_STRINGS, lang), [lang])
  const [lateOnly, setLateOnly] = useState(false)
  const offCount = state.menu.filter((m) => m.active !== false && !m.available).length
  const [boardOpen, setBoardOpen] = useState(offCount > 0)
  const [dishTarget, setDishTarget] = useState(null)
  const closeDish = useCallback(() => setDishTarget(null), [])
  const showPhotos = state.settings?.food?.imagesOnKitchen !== false

  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const tableById = useMemo(() => Object.fromEntries(state.tables.map((table) => [table.id, table])), [state.tables])

  // All fired, un-bumped, un-voided lines across open tickets
  const fired = useMemo(() => {
    const rows = []
    for (const order of state.orders) {
      if (['paid', 'void'].includes(order.status)) continue
      for (const item of order.items) {
        if (item.status !== 'fired' || item.voided || !item.firedAt) continue
        const dish = menuById[item.menuItemId]
        const table = tableById[order.tableId]
        rows.push({
          order,
          tableName: table ? localizeTableName(table.name, lang) : localizeTerm(order.type, lang, 'orderType'),
          server: order.serverId === 'server' ? 'Jordan' : order.serverId,
          item,
          name: dish ? localizedName(dish, lang) : t('unknownItem'),
          photos: itemPhotos(dish),
        })
      }
    }
    return rows
  }, [state.orders, tableById, menuById, lang, t])

  const lateCount = fired.filter((r) => ticketAgeState(r.item.firedAt, now) === 'late').length
  const avgAge = fired.length
    ? Math.round(fired.reduce((s, r) => s + secondsBetween(r.item.firedAt, now), 0) / fired.length)
    : 0
  const bumpedToday = state.orders.flatMap((o) => o.items).filter((i) => i.status === 'bump').length

  // Columns: stations see own items; expo sees the whole table
  const columns = useMemo(() => {
    const match = lateOnly
      ? (r) => ticketAgeState(r.item.firedAt, now) === 'late'
      : () => true
    return STATIONS.map((station) => {
      const rows = fired.filter((r) =>
        station === 'expo' ? match(r) : r.item.station === station && match(r),
      )
      // Group by order, oldest card first
      const byOrder = new Map()
      for (const r of rows) {
        if (!byOrder.has(r.order.id)) byOrder.set(r.order.id, { order: r.order, tableName: r.tableName, server: r.server, lines: [] })
        byOrder.get(r.order.id).lines.push({ ...r.item, name: r.name, photos: r.photos })
      }
      const cards = [...byOrder.values()]
        .map((c) => ({ ...c, lines: c.lines.sort((a, b) => new Date(a.firedAt) - new Date(b.firedAt)) }))
        .sort((a, b) => new Date(a.lines[0].firedAt) - new Date(b.lines[0].firedAt))
      return { station, cards, count: rows.length }
    })
  }, [fired, lateOnly, now])

  // Recall strip: bumped within the 60s window
  const recallable = useMemo(() => {
    const rows = []
    for (const order of state.orders) {
      if (['paid', 'void'].includes(order.status)) continue
      for (const item of order.items) {
        const key = `${order.id}:${item.id}`
        if (item.status === 'bump' && state.recalls[key] && state.recalls[key] > now) {
          const dish = menuById[item.menuItemId]
          rows.push({ order, item, name: dish ? localizedName(dish, lang) : t('unknownItem'), left: Math.ceil((state.recalls[key] - now) / 1000) })
        }
      }
    }
    return rows.sort((a, b) => a.left - b.left)
  }, [state.orders, state.recalls, menuById, now, lang, t])

  const latePct = fired.length ? Math.round((lateCount / fired.length) * 100) : 0

  return (
    <div className="kds space-y-4" lang={languageMeta(lang).htmlLang}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">{t('eyebrow', { sla: `${TARGETS.ticketMinutes}:00` })}</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitch value={lang} onChange={setLang} label={t('language')} />
          <button
            type="button"
            onClick={() => setLateOnly((v) => !v)}
            aria-pressed={lateOnly}
            className={`min-h-[44px] rounded-lg px-3.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              lateOnly ? 'bg-red-500 text-black ring-red-500' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'
            }`}
          >
            {lateOnly ? t('showingLateOnly') : t('lateOnly')}
          </button>
          <button
            type="button"
            onClick={() => setBoardOpen((v) => !v)}
            aria-expanded={boardOpen}
            className={`min-h-[44px] rounded-lg px-3.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              boardOpen ? 'bg-red-500/20 text-red-200 ring-red-500/50' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'
            }`}
          >
            {t('board86', { count: offCount })}
          </button>
        </div>
      </header>

      {/* SLA strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { id: 'fired', label: t('statFired'), value: String(fired.length) },
          { id: 'late', label: t('statLate', { pct: latePct }), value: String(lateCount) },
          { id: 'age', label: t('statAvgAge'), value: formatElapsed(avgAge) },
          { id: 'bumped', label: t('statBumped'), value: String(bumpedToday) },
        ].map((s) => (
          <div key={s.id} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3">
            <div className="tnum text-2xl font-bold">{s.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>

      {recallable.length > 0 && (
        <div className="animate-status-in rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-sky-300">
            {t('recallTitle', { secs: TARGETS.recallBumpSeconds })}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {recallable.map((r) => (
              <button
                key={`${r.order.id}:${r.item.id}`}
                type="button"
                onClick={() => dispatch({ type: 'RECALL_ITEM', orderId: r.order.id, itemId: r.item.id })}
                aria-label={t('recallLabel', { qty: r.item.qty, name: r.name, n: r.left })}
                className="min-h-[44px] rounded-lg bg-sky-500/15 px-3.5 text-sm font-semibold text-sky-200 ring-1 ring-inset ring-sky-500/40 hover:bg-sky-500/25"
              >
                ↩ {r.item.qty}× {r.name} · {t('secondsLeft', { n: r.left })}
              </button>
            ))}
          </div>
        </div>
      )}

      {boardOpen && <EightySixBoard lang={lang} t={t} showPhotos={showPhotos} />}

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-4" role="region" aria-label={t('columnsLabel')}>
        {columns.map(({ station, cards, count }) => {
          const hasLate = cards.some((c) => c.lines.some((l) => ticketAgeState(l.firedAt, now) === 'late'))
          const label = stationName(station, lang)
          return (
            <section key={station} className="w-[300px] min-w-[300px] flex-1" aria-label={t('stationLabel', { station: label })}>
              <div className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 ring-1 ring-inset ${hasLate ? 'bg-red-500/10 ring-red-500/40' : 'bg-[var(--color-ink-900)] ring-[var(--color-ink-700)]'}`}>
                <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">
                  {label}
                  {station === 'expo' && <span className="ml-1.5 font-normal normal-case text-zinc-500">{t('wholeTable')}</span>}
                </h2>
                <span className={`tnum rounded-full px-2 py-0.5 text-xs font-bold ${hasLate ? 'bg-red-500/20 text-red-200' : 'bg-black/40 text-zinc-400'}`}>
                  {count}
                </span>
              </div>
              <div className="max-h-[62vh] space-y-2.5 overflow-y-auto pr-0.5">
                {cards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[var(--color-ink-600)] p-5 text-center text-sm text-zinc-600">
                    {lateOnly ? t('emptyLate') : t('emptyAll')}
                  </div>
                )}
                {cards.map((c) => (
                  <TicketCard
                    key={`${station}-${c.order.id}`}
                    order={c.order}
                    tableName={c.tableName}
                    server={c.server}
                    lines={c.lines}
                    now={now}
                    lang={lang}
                    t={t}
                    showPhotos={showPhotos}
                    onOpenDish={setDishTarget}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {dishTarget && <DishDialog target={dishTarget} lang={lang} t={t} onClose={closeDish} />}
    </div>
  )
}
