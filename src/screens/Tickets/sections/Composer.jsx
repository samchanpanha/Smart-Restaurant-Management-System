import { useMemo, useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { inputCls } from '../../../components/ui'
import { translateCategory, translateCourse, translateDishName, useI18n } from '../../../lib/i18n'
import { money } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { COURSES } from '../shared.js'
import { ModifierModal } from './ModifierModal.jsx'

function Composer({ order }) {
  const { state, dispatch } = useRestora()
  const [category, setCategory] = useState('Mains')
  const [query, setQuery] = useState('')
  const [course, setCourse] = useState('main')
  const [modFor, setModFor] = useState(null)

  const activeMenu = useMemo(() => state.menu.filter((m) => m.active !== false), [state.menu])
  const categories = useMemo(() => [...new Set(activeMenu.map((m) => m.category))], [activeMenu])
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])

  // Quick-add: the bestsellers across the night plus what the last few tickets
  // ordered, so a server can build the common ticket without hunting the menu.
  const quickAdds = useMemo(() => {
    const counts = new Map()
    const orders = [...state.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    for (const o of orders) {
      for (const item of o.items) counts.set(item.menuItemId, (counts.get(item.menuItemId) || 0) + 1)
    }
    const sellable = (id) => {
      const m = menuById[id]
      return m && m.active !== false && m.available
    }
    const favorites = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .filter(sellable)
      .slice(0, 6)
    const recent = []
    const seen = new Set(favorites)
    for (const o of orders.slice(0, 3)) {
      for (const item of [...o.items].reverse()) {
        const id = item.menuItemId
        if (seen.has(id) || !sellable(id)) continue
        seen.add(id)
        recent.push(id)
        if (recent.length >= 4) break
      }
      if (recent.length >= 4) break
    }
    return { favorites: favorites.map((id) => menuById[id]), recent: recent.map((id) => menuById[id]) }
  }, [state.orders, menuById])

  const { lang, dict } = useI18n()
  const tk = dict.tickets || {}
  const items = activeMenu.filter((m) => {
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      return m.name.toLowerCase().includes(q) || translateDishName(m, lang).toLowerCase().includes(q)
    }
    return m.category === category
  })

  function addDirect(menuItem, extra = {}) {
    dispatch({
      type: 'ADD_ITEM',
      orderId: order.id,
      menuItemId: menuItem.id,
      qty: 1,
      modifiers: [],
      course,
      notes: '',
      ...extra,
    })
  }

  function tap(menuItem) {
    if (!menuItem.available) return // blocked card handles substitute
    if ((menuItem.modifiers || []).length) {
      setModFor(menuItem)
    } else {
      addDirect(menuItem)
    }
  }

  function onSearchKey(event) {
    if (event.key === 'Escape') {
      setQuery('')
      return
    }
    if (event.key === 'Enter' && items.length) {
      event.preventDefault()
      tap(items[0])
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">{tk.addItems || 'Add items'}</h3>
        <div className="flex gap-1 rounded-lg bg-black/30 p-1" role="group" aria-label="Course for new items">
          {COURSES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCourse(c.id)}
              aria-pressed={course === c.id}
              className={`min-h-[36px] rounded-md px-3 text-xs font-bold transition-colors ${
                course === c.id ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {translateCourse(c.id, lang)}
            </button>
          ))}
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onSearchKey}
        autoFocus
        placeholder={tk.searchMenu || 'Search menu…'}
        aria-label="Search menu"
        className={`${inputCls} mt-3`}
      />

      {!query.trim() && (
        <>
          {(quickAdds.favorites.length > 0 || quickAdds.recent.length > 0) && (
            <div className="mt-3" data-testid="quick-add">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {tk.quickAdd || 'Quick add'}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  ...quickAdds.favorites.map((m) => ({ m, tag: '★' })),
                  ...quickAdds.recent.map((m) => ({ m, tag: '↺' })),
                ].map(({ m, tag }) => (
                  <button
                    key={`${tag}-${m.id}`}
                    type="button"
                    data-testid="quick-add-chip"
                    data-dish={m.id}
                    onClick={() => tap(m)}
                    title={tag === '★' ? 'Bestseller' : 'Recent'}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-500/20"
                  >
                    <span aria-hidden className="text-amber-400">{tag}</span>
                    <span className="truncate">{translateDishName(m, lang)}</span>
                    <span className="tnum text-xs text-amber-300/80">{money(m.price)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Menu categories">
            {categories.map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                type="button"
                onClick={() => setCategory(c)}
                className={`min-h-[44px] shrink-0 rounded-lg px-3.5 text-sm font-semibold transition-colors ${
                  category === c ? 'bg-white/10 text-zinc-100 ring-1 ring-inset ring-white/20' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {translateCategory(c, lang)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((m) => {
          const sub = m.substituteId ? menuById[m.substituteId] : null
          const localName = translateDishName(m, lang)
          if (!m.available) {
            return (
              <div
                key={m.id}
                className="rounded-xl border border-red-500/30 bg-red-500/5 p-3"
                aria-label={`${m.name}, 86'd, unavailable`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold text-zinc-400 line-through">{localName}</span>
                  <StatusPill tone="bad" size="sm">
                    86
                  </StatusPill>
                </div>
                <div className="tnum mt-0.5 text-xs text-zinc-500">{money(m.price)}</div>
                {sub && sub.available && sub.active !== false ? (
                  <button
                    type="button"
                    onClick={() => tap(sub)}
                    className="mt-2 min-h-[36px] w-full rounded-lg bg-white/5 px-2 text-xs font-semibold text-sky-300 ring-1 ring-inset ring-sky-500/30 hover:bg-white/10"
                  >
                    Suggest {translateDishName(sub, lang)} →
                  </button>
                ) : (
                  <div className="mt-2 text-[11px] text-zinc-600">No substitute mapped</div>
                )}
              </div>
            )
          }
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => tap(m)}
              className="min-h-[72px] rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] p-3 text-left transition-all hover:border-amber-500/50 active:scale-[0.98]"
            >
              <div className="text-sm font-semibold leading-tight text-zinc-100">{localName}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="tnum text-sm font-bold text-amber-300">{money(m.price)}</span>
                {(m.modifiers || []).some((g) => g.required) && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">mods*</span>
                )}
              </div>
            </button>
          )
        })}
        {items.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[var(--color-ink-600)] p-4 text-center text-sm text-zinc-500">
            No dishes match “{query}”.
          </div>
        )}
      </div>

      {modFor && (
        <ModifierModal
          item={modFor}
          course={course}
          onClose={() => setModFor(null)}
          onAdd={(extra) => {
            addDirect(modFor, extra)
            setModFor(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Reason modal (comp / void) ──────────────────────────────────


export { Composer }
