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
  const [section, setSection] = useState('overview')

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
  const historySales = state.salesHistory.reduce((sum, day) => sum + day.sales, 0)
  const foodSales = historySales + dash.sales
  const totalFoodCost = state.salesHistory.reduce((sum, day) => sum + day.sales * day.foodCostPct, 0) + dash.sales * dash.tonightCostPct
  const blendedFoodCost = foodSales ? totalFoodCost / foodSales : dash.foodCost7d
  const wasteValue = state.wasteLog.reduce((sum, item) => sum + item.qty * (skuById[item.inventoryItemId]?.lastCost || 0), 0)
  const stockValue = state.inventory.reduce((sum, item) => sum + Math.max(0, item.onHand) * item.lastCost, 0)
  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'menu-items', label: 'Menu items' },
    { id: 'ingredients', label: 'Ingredients' },
    { id: 'cost-analysis', label: 'Cost analysis' },
  ]

  function exportPerformance() {
    const rows = [['Menu item', 'Category', 'Units sold', 'Menu price', 'Plate cost', 'Contribution', 'Margin band'], ...perf.map((item) => [item.menu.name, item.menu.category, item.qty, item.menu.price, item.plate, `${(item.contribution * 100).toFixed(1)}%`, item.band])]
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'restora-food-cost-report.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">Menu performance</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Food Cost &amp; Profit</h1>
          <p className="mt-1 text-sm text-zinc-500">Track plate cost, analyze margins, and make smarter menu decisions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">Tonight · {(dash.tonightCostPct * 100).toFixed(1)}%</span>
          <span className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">7-day · {(dash.foodCost7d * 100).toFixed(1)}%</span>
          <button type="button" onClick={exportPerformance} className="min-h-9 rounded-xl bg-orange-500 px-4 text-xs font-bold text-white shadow-sm hover:bg-orange-600">↓ Export report</button>
        </div>
      </header>

      {banner && (
        <div className="animate-status-in rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-500/30" role="status">
          {banner}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[
          { label: 'Total food sales', value: money(foodSales), note: 'History + tonight', icon: '◇', tone: 'orange' },
          { label: 'Estimated food cost', value: money(totalFoodCost), note: 'Plate costs from recipes', icon: '◉', tone: 'green' },
          { label: 'Food cost ratio', value: `${(blendedFoodCost * 100).toFixed(1)}%`, note: `Target ${(foodCap * 100).toFixed(0)}%`, icon: '%', tone: 'blue' },
          { label: 'Contribution margin', value: `${((1 - blendedFoodCost) * 100).toFixed(1)}%`, note: 'Before labor & overhead', icon: '↗', tone: 'violet' },
          { label: 'Waste logged', value: money(wasteValue), note: 'This location', icon: '♧', tone: 'red' },
        ].map((item) => <div key={item.label} className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-base font-bold ${item.tone === 'green' ? 'bg-emerald-50 text-emerald-700' : item.tone === 'blue' ? 'bg-sky-50 text-sky-700' : item.tone === 'violet' ? 'bg-violet-50 text-violet-700' : item.tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'}`}>{item.icon}</span><span className="text-[11px] font-medium text-zinc-500">{item.label}</span></div><div className="tnum mt-3 text-xl font-bold text-zinc-900">{item.value}</div><div className="mt-1 text-[10px] text-zinc-500">{item.note}</div></div>)}
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Food cost sections">
        {sections.map((item) => <button key={item.id} role="tab" aria-selected={section === item.id} type="button" onClick={() => setSection(item.id)} className={`min-h-10 shrink-0 rounded-lg px-4 text-xs font-semibold transition-colors ${section === item.id ? 'bg-orange-500 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'}`}>{item.label}</button>)}
      </div>

      {(section === 'overview' || section === 'cost-analysis') && (
        <div className="grid items-stretch gap-4 xl:grid-cols-12">
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm xl:col-span-8">
            <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-zinc-900">Sales vs. food cost</h2><p className="mt-0.5 text-xs text-zinc-500">Recorded daily sales with theoretical food cost</p></div><span className="text-[10px] text-zinc-400">7-day history</span></div>
            <div className="space-y-3">
              {state.salesHistory.slice(-7).map((day) => <div key={day.day} className="grid grid-cols-[52px_1fr_84px] items-center gap-3"><span className="text-[10px] font-medium text-zinc-500">{day.day}</span><div className="space-y-1"><div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(3, (day.sales / Math.max(1, ...state.salesHistory.map((entry) => entry.sales))) * 100)}%` }} /></div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(3, (day.foodCostPct / Math.max(foodCap, 0.01)) * 100)}%` }} /></div></div><span className="tnum text-right text-[10px] font-semibold text-zinc-600">{money(day.sales)}</span></div>)}
              <div className="grid grid-cols-[52px_1fr_84px] items-center gap-3 border-t border-zinc-100 pt-3"><span className="text-[10px] font-bold text-orange-600">Tonight</span><div className="space-y-1"><div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(3, (dash.sales / Math.max(1, historySales, dash.sales)) * 100)}%` }} /></div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(3, (dash.tonightCostPct / Math.max(foodCap, 0.01)) * 100)}%` }} /></div></div><span className="tnum text-right text-[10px] font-bold text-zinc-700">{money(dash.sales)}</span></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-zinc-500"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-orange-500" />Food sales</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-500" />Food cost ratio vs cap</span></div>
          </section>
          <section className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-5 shadow-sm xl:col-span-4">
            <div className="flex items-center gap-2 text-orange-700"><span className="text-xl">♧</span><h2 className="text-sm font-bold">Smart insights</h2></div>
            {shocks.length ? <ul className="mt-3 space-y-2">{shocks.slice(0, 3).map((shock) => <li key={shock.sku.id} className="rounded-xl border border-orange-100 bg-white/80 p-3"><div className="text-xs font-bold text-zinc-800">{shock.sku.name} cost {shock.delta > 0 ? 'increased' : 'decreased'}</div><div className={`mt-1 text-xs font-semibold ${shock.delta > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{shock.delta > 0 ? '+' : ''}{(shock.delta * 100).toFixed(1)}% vs previous invoice</div></li>)}</ul> : <p className="mt-3 text-xs leading-relaxed text-zinc-600">No recent ingredient cost shocks. Update invoice prices in Inventory and the impact will appear here.</p>}
            <button type="button" onClick={() => setScreen('inventory')} className="mt-4 min-h-9 rounded-lg border border-orange-200 bg-white px-3 text-xs font-semibold text-orange-700 hover:bg-orange-100">Review ingredients →</button>
          </section>
        </div>
      )}

      {(section === 'overview' || section === 'ingredients') && (
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
      )}

      {(section === 'overview' || section === 'menu-items') && (
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
      )}

      {section === 'cost-analysis' && (
        <div className="grid items-start gap-4 xl:grid-cols-12">
          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm xl:col-span-8">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4"><div><h2 className="text-base font-bold text-zinc-900">Inventory value by ingredient</h2><p className="mt-0.5 text-xs text-zinc-500">On-hand quantity × last recorded invoice cost · total {money(stockValue)}</p></div><button type="button" onClick={() => setScreen('inventory')} className="text-xs font-semibold text-orange-600">View stock →</button></div>
            <div className="divide-y divide-zinc-100">
              {[...state.inventory].sort((a, b) => b.onHand * b.lastCost - a.onHand * a.lastCost).slice(0, 8).map((item) => {
                const value = Math.max(0, item.onHand) * item.lastCost
                return <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-4 px-5 py-3"><div className="min-w-0"><div className="truncate text-sm font-semibold text-zinc-800">{item.name}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(2, stockValue ? (value / stockValue) * 100 : 2)}%` }} /></div></div><div className="text-right"><div className="tnum text-sm font-bold text-zinc-800">{money(value)}</div><div className="text-[10px] text-zinc-500">{item.onHand} {item.unit} · {money(item.lastCost)} ea</div></div></div>
              })}
            </div>
          </section>
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm xl:col-span-4"><h2 className="text-base font-bold text-zinc-900">Cost controls</h2><div className="mt-4 space-y-3"><div className="flex justify-between text-xs text-zinc-500"><span>Target food cost</span><strong className="text-zinc-800">{(foodCap * 100).toFixed(0)}%</strong></div><div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, (blendedFoodCost / Math.max(foodCap, 0.01)) * 100)}%` }} /></div><div className="flex justify-between border-t border-zinc-100 pt-3 text-xs text-zinc-500"><span>Blended cost</span><strong className="tnum text-zinc-800">{(blendedFoodCost * 100).toFixed(1)}%</strong></div><div className="flex justify-between text-xs text-zinc-500"><span>Recorded waste</span><strong className="tnum text-zinc-800">{money(wasteValue)}</strong></div><button type="button" onClick={() => setScreen('inventory')} className="mt-2 min-h-10 w-full rounded-lg bg-orange-500 text-xs font-bold text-white hover:bg-orange-600">Open inventory →</button></div></section>
        </div>
      )}
    </div>
  )
}
