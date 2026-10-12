// ─── Step 7b: Food Cost & Profit ────────────────────────────────────
// Stop selling dishes that lose money. Popularity × margin matrix
// (star / plowhorse / puzzle / dog), invoice-driven ingredient
// shocks, and one-tap 86 / reprice in the same session.

import { useMemo, useState } from 'react'
import StatusPill from '../components/StatusPill'
import { Field, inputCls } from '../components/ui'
import { MARGIN_BAND_META } from '../lib/constants'
import { contributionFor, costingFor, money, plateCostFor } from '../lib/models'
import { getDashboard, useRestora } from '../lib/store'

const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Ingredient shock: ≥5% move between the last two invoices for a SKU,
// with per-dish contribution before → after.
function detectShocks(state) {
  const skuById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))
  const histBySku = {}
  const sorted = [...state.invoiceLog].sort((a, b) => new Date(a.at) - new Date(b.at))
  for (const inv of sorted) {
    for (const l of inv.lines) {
      ;(histBySku[l.inventoryItemId] ||= []).push(Number(l.unitCost))
    }
  }
  const shocks = []
  for (const [skuId, hist] of Object.entries(histBySku)) {
    if (hist.length < 2) continue
    const prev = hist[hist.length - 2]
    const cur = hist[hist.length - 1]
    if (!prev || prev <= 0) continue
    const delta = (cur - prev) / prev
    if (Math.abs(delta) < 0.05) continue
    const sku = skuById[skuId]
    if (!sku) continue
    const hypoPrev = { ...skuById, [skuId]: { ...sku, lastCost: prev } }
    const dishes = state.menu
      .filter((m) => state.recipes[m.id]?.ingredients.some((ing) => ing.inventoryItemId === skuId))
      .map((m) => {
        const r = state.recipes[m.id]
        const cb = contributionFor(m.price, plateCostFor(r, hypoPrev))
        const ca = contributionFor(m.price, plateCostFor(r, skuById))
        return { menu: m, before: cb, after: ca, crossed: cb >= 0.1 && ca < 0.1 }
      })
    shocks.push({ sku, prev, cur, delta, dishes })
  }
  return shocks.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

const QUADS = [
  { id: 'star', label: 'Stars', hint: 'High profit · high sales — protect them', tone: 'ok' },
  { id: 'puzzle', label: 'Puzzles', hint: 'High profit · low sales — sell harder', tone: 'info' },
  { id: 'plowhorse', label: 'Plowhorses', hint: 'Low profit · high sales — reprice or trim cost', tone: 'warn' },
  { id: 'dog', label: 'Dogs', hint: 'Low profit · low sales — 86 or rework', tone: 'bad' },
]

export default function CostingScreen() {
  const { state, dispatch, setScreen, setSelectedDishId } = useRestora()
  const [dishId, setDishId] = useState(null)
  const [priceDraft, setPriceDraft] = useState('')
  const [banner, setBanner] = useState(null)

  function flash(msg) {
    setBanner(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setBanner(null), 4200)
  }

  const skuById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])
  const dash = useMemo(() => getDashboard(state), [state])
  const shocks = useMemo(() => detectShocks(state), [state])

  const perf = useMemo(() => {
    const qtyByMenu = {}
    for (const o of state.orders) {
      if (o.status === 'void') continue
      for (const it of o.items) {
        if (it.voided) continue
        qtyByMenu[it.menuItemId] = (qtyByMenu[it.menuItemId] || 0) + it.qty
      }
    }
    return state.menu.map((m) => {
      const { plate, contribution, band } = costingFor(m, state.recipes[m.id], skuById)
      const qty = qtyByMenu[m.id] || 0
      return { menu: m, qty, plate, contribution, band, revenue: qty * m.price }
    })
  }, [state.orders, state.menu, state.recipes, skuById])

  const popCut = median(perf.map((p) => p.qty))
  const marCut = median(perf.map((p) => p.contribution))

  const quads = useMemo(() => {
    const q = { star: [], plowhorse: [], puzzle: [], dog: [] }
    for (const p of perf) {
      const popHi = p.qty >= popCut
      const marHi = p.contribution >= marCut
      q[popHi && marHi ? 'star' : popHi ? 'plowhorse' : marHi ? 'puzzle' : 'dog'].push(p)
    }
    for (const k of Object.keys(q)) q[k].sort((a, b) => b.revenue - a.revenue)
    return q
  }, [perf, popCut, marCut])

  const selected = perf.find((p) => p.menu.id === dishId)
  const foodCap = state.settings.foodCostCap

  function openPriceEditor(p) {
    setDishId(p.menu.id)
    setPriceDraft(String(p.menu.price))
  }

  function savePrice() {
    const price = Math.max(0, Number(priceDraft) || 0)
    dispatch({ type: 'UPDATE_PRICE', menuItemId: dishId, price })
    flash(`${selected.menu.name} repriced to ${money(price)} — matrix updates live.`)
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
            Insight · step 7 · owner: Maya
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Food Cost &amp; Profit</h1>
        </div>
        <div className="flex gap-2">
          <StatusPill tone={dash.tonightCostPct <= foodCap ? 'ok' : 'warn'}>
            Tonight · {(dash.tonightCostPct * 100).toFixed(1)}%
          </StatusPill>
          <StatusPill tone={dash.foodCost7d <= foodCap ? 'ok' : 'bad'}>
            7-day · {(dash.foodCost7d * 100).toFixed(1)}% · cap {(foodCap * 100).toFixed(0)}%
          </StatusPill>
        </div>
      </header>

      {banner && (
        <div className="animate-status-in rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-500/30" role="status">
          {banner}
        </div>
      )}

      {/* Ingredient shocks */}
      <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          Ingredient shock · from invoices, not vibes
        </h2>
        {shocks.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            No ≥5% cost moves between recent invoices. Receive an invoice at a new unit cost and shocks land here.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {shocks.map((s) => (
              <li key={s.sku.id} className="rounded-xl bg-[var(--color-ink-800)] p-3.5 ring-1 ring-inset ring-[var(--color-ink-600)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <strong className="text-zinc-100">{s.sku.name}</strong>
                    <span className={`tnum ml-2 font-bold ${s.delta > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                      {s.delta > 0 ? '+' : ''}{(s.delta * 100).toFixed(1)}%
                    </span>
                    <span className="tnum ml-2 text-zinc-500">{money(s.prev)} → {money(s.cur)}/{s.sku.unit}</span>
                  </div>
                  {s.dishes.some((d) => d.crossed) && (
                    <StatusPill tone="bad">drops below 10% margin</StatusPill>
                  )}
                </div>
                <ul className="mt-2 space-y-1">
                  {s.dishes.map((d) => (
                    <li key={d.menu.id} className="flex items-center justify-between gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => openPriceEditor(perf.find((p) => p.menu.id === d.menu.id))}
                        className="text-left text-zinc-300 underline decoration-dotted underline-offset-2 hover:text-zinc-100"
                      >
                        {d.menu.name}
                      </button>
                      <span className="tnum text-zinc-400">
                        {(d.before * 100).toFixed(1)}% →{' '}
                        <strong className={d.crossed ? 'text-red-300' : d.after < d.before ? 'text-amber-300' : 'text-emerald-300'}>
                          {(d.after * 100).toFixed(1)}%
                        </strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        {/* Matrix */}
        <div className="space-y-3 xl:col-span-2">
          <p className="text-xs text-zinc-500">
            Split at menu medians — popularity ≥ {popCut} sold · margin ≥ {(marCut * 100).toFixed(1)}%.
            Absolute bands (high ≥70 / ok 55–70 / low 10–55 / loss &lt;10) ride on each dish.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {QUADS.map((q) => (
              <section key={q.id} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-300">
                    {q.label} · {quads[q.id].length}
                  </h3>
                  <StatusPill tone={q.tone} size="sm">{q.id}</StatusPill>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">{q.hint}</p>
                <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
                  {quads[q.id].map((p) => (
                    <li key={p.menu.id}>
                      <button
                        type="button"
                        onClick={() => openPriceEditor(p)}
                        aria-current={dishId === p.menu.id}
                        className={`w-full rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-colors ${
                          dishId === p.menu.id
                            ? 'bg-amber-500/10 ring-amber-500/40'
                            : 'bg-[var(--color-ink-800)] ring-[var(--color-ink-600)] hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm font-semibold ${p.menu.available ? 'text-zinc-100' : 'text-zinc-500 line-through'}`}>
                            {p.menu.name}
                          </span>
                          <span className="tnum shrink-0 text-xs text-zinc-400">×{p.qty} · {(p.contribution * 100).toFixed(0)}%</span>
                        </div>
                        <div className="mt-1 flex gap-1">
                          <StatusPill tone={MARGIN_BAND_META[p.band].tone} size="sm">{p.band}</StatusPill>
                          {!p.menu.available && <StatusPill tone="bad" size="sm">86</StatusPill>}
                          <span className="tnum self-center text-[10px] text-zinc-600">{money(p.revenue)} revenue</span>
                        </div>
                      </button>
                    </li>
                  ))}
                  {quads[q.id].length === 0 && (
                    <li className="text-xs text-zinc-600">None in this quadrant.</li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        </div>

        {/* Dish action panel */}
        <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5 xl:sticky xl:top-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Act on a dish</h2>
          {!selected ? (
            <p className="mt-2 text-sm text-zinc-500">
              Tap any dish in the matrix or a shock — reprice or 86 it right here, no context switch.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-lg font-bold">{selected.menu.name}</div>
                <div className="tnum mt-0.5 text-xs text-zinc-500">
                  plate {money(selected.plate)} · ×{selected.qty} sold · {money(selected.revenue)} revenue
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <StatusPill tone={MARGIN_BAND_META[selected.band].tone}>
                    {selected.band} · {(selected.contribution * 100).toFixed(1)}%
                  </StatusPill>
                  {!selected.menu.available && <StatusPill tone="bad">86&apos;d</StatusPill>}
                </div>
              </div>
              <Field label="Menu price $">
                <div className="flex gap-2">
                  <input
                    type="number" min="0" step="any" value={priceDraft}
                    onChange={(e) => setPriceDraft(e.target.value)}
                    className={`${inputCls} tnum`} aria-label="New menu price"
                  />
                  <button
                    type="button" onClick={savePrice}
                    disabled={Number(priceDraft) === selected.menu.price}
                    className="min-h-[44px] shrink-0 rounded-lg bg-amber-500 px-4 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              </Field>
              {priceDraft !== '' && Number(priceDraft) !== selected.menu.price && (
                <div className="tnum rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-inset ring-[var(--color-ink-700)]">
                  New margin:{' '}
                  <strong className="text-amber-300">
                    {((contributionFor(Number(priceDraft) || 0, selected.plate)) * 100).toFixed(1)}%
                  </strong>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'SET_86', menuItemId: selected.menu.id, available: !selected.menu.available })
                  flash(`${selected.menu.name} ${selected.menu.available ? "86'd — floor + KDS updated" : 'back on the menu'}.`)
                }}
                className={`min-h-[44px] w-full rounded-lg text-sm font-bold transition-colors ${
                  selected.menu.available
                    ? 'border border-red-500/50 text-red-300 hover:bg-red-500/10'
                    : 'bg-emerald-500 text-black hover:bg-emerald-400'
                }`}
              >
                {selected.menu.available ? '86 this dish' : 'Back on menu'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedDishId(selected.menu.id)
                  setScreen('menu')
                }}
                className="min-h-[44px] w-full rounded-lg border border-[var(--color-ink-600)] text-sm font-semibold text-zinc-200 hover:bg-white/5"
              >
                Open in recipe coster →
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
