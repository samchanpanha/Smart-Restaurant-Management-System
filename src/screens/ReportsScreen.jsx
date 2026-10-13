// ─── Step 8: Reports & Analytics ────────────────────────────────────
// After-the-fact truth that still leads to an action. Every report
// ends in a next action with a deep link — never a chart for its
// own sake. Order detail is tonight's (live); history is daily
// totals, labeled wherever the two meet.

import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import { buildReportDocument, printHtml, renderDocumentHtml } from '../lib/documents'
import { money, orderSubtotal, plateCostFor, theoreticalDecrementFor } from '../lib/models'
import { sanitizeSettings } from '../lib/settings'
import { useRestora } from '../lib/store'

const TABS = [
  { id: 'sales', label: 'Sales' },
  { id: 'service', label: 'Service' },
  { id: 'voids', label: 'Voids & comps' },
  { id: 'variance', label: 'Variance' },
  { id: 'pnl', label: 'P&L-lite' },
]

const RANGES = [
  { id: 'tonight', label: 'Tonight' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
]

function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
      <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function NextAction({ children, onGo, goLabel }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 ring-1 ring-inset ring-emerald-500/30">
      <div className="text-sm text-emerald-200">
        <span className="font-bold">Next action: </span>
        {children}
      </div>
      {onGo && (
        <button
          type="button"
          onClick={onGo}
          className="min-h-[36px] shrink-0 rounded-lg bg-emerald-500/20 px-3 text-xs font-bold text-emerald-200 ring-1 ring-inset ring-emerald-500/40 hover:bg-emerald-500/30"
        >
          {goLabel || 'Go →'}
        </button>
      )}
    </div>
  )
}

function Bars({ rows, format = money }) {
  const max = Math.max(...rows.map((r) => r.value), 0.001)
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-zinc-300">{r.label}</span>
            <span className="tnum shrink-0 font-bold text-zinc-100">
              {format(r.value)}
              {r.sub && <span className="ml-1.5 font-normal text-zinc-500">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/50">
            <div
              className="h-full rounded-full bg-amber-500/80"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function paidLines(state) {
  const rows = []
  for (const o of state.orders) {
    if (o.status !== 'paid') continue
    for (const it of o.items) {
      if (it.voided || it.comped) continue
      rows.push({ order: o, item: it })
    }
  }
  return rows
}

// ─── Sales ──────────────────────────────────────────────────────

function SalesReport({ range }) {
  const { state, setScreen } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])

  const paid = state.orders.filter((o) => o.status === 'paid')
  const tonightSales = paid.reduce((s, o) => s + (o.total ?? orderSubtotal(o, menuById)), 0)
  const histSum = state.salesHistory.reduce((s, d) => s + d.sales, 0)
  const histAvg = histSum / Math.max(1, state.salesHistory.length)

  const { total, compNote, compDelta } = useMemo(() => {
    if (range === 'tonight') {
      return {
        total: tonightSales,
        compNote: `vs 7-day daily avg ${money(histAvg)}`,
        compDelta: histAvg ? (tonightSales - histAvg) / histAvg : 0,
      }
    }
    // 7d / 30d: daily totals from history + tonight partial. Demo history
    // holds 7 days — labeled, never extrapolated silently.
    return {
      total: histSum + tonightSales,
      compNote: range === '30d' ? 'demo history holds 7 days + tonight' : '7 daily closes + tonight (partial)',
      compDelta: null,
    }
  }, [range, tonightSales, histSum, histAvg])

  const checks = range === 'tonight' ? paid.length : null
  const avgCheck = checks ? total / checks : null

  // By hour (tonight, paid orders)
  const byHour = useMemo(() => {
    const m = new Map()
    for (const o of paid) {
      const h = new Date(o.paidAt || o.createdAt).getHours()
      const v = o.total ?? orderSubtotal(o, menuById)
      m.set(h, (m.get(h) || 0) + v)
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, value]) => ({ label: `${String(h).padStart(2, '0')}:00`, value }))
  }, [paid, menuById])

  // By category (tonight, paid lines)
  const byCat = useMemo(() => {
    const m = new Map()
    for (const { item } of paidLines(state)) {
      const cat = menuById[item.menuItemId]?.category || 'Other'
      m.set(cat, (m.get(cat) || 0) + (menuById[item.menuItemId]?.price || 0) * item.qty)
    }
    const tot = [...m.values()].reduce((a, b) => a + b, 0) || 1
    return [...m.entries()]
      .map(([label, value]) => ({ label, value, sub: `${Math.round((value / tot) * 100)}%` }))
      .sort((a, b) => b.value - a.value)
  }, [state, menuById])

  // By day (history + tonight)
  const byDay = useMemo(
    () => [...state.salesHistory.map((d) => ({ label: d.day, value: d.sales })), { label: 'Tonight', value: tonightSales }],
    [state.salesHistory, tonightSales],
  )

  const weakCat = byCat[byCat.length - 1]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{money(total)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Sales · {RANGES.find((r) => r.id === range).label}
          </div>
          <div className="mt-1.5">
            <StatusPill tone={compDelta == null ? 'muted' : compDelta >= 0 ? 'ok' : 'warn'} size="sm">
              {compDelta == null ? compNote : `${compDelta >= 0 ? '+' : ''}${Math.round(compDelta * 100)}% ${compNote}`}
            </StatusPill>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{checks == null ? '—' : checks}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Checks</div>
          <div className="mt-1.5 text-xs text-zinc-500">{checks == null ? 'check detail is tonight-only' : `${money(avgCheck)} average check`}</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{money(histAvg)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">7-day daily avg</div>
          <div className="mt-1.5 text-xs text-zinc-500">the compare baseline, always on</div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title={range === 'tonight' ? 'Sales by hour · tonight' : 'Sales by day · history + tonight'}>
          <Bars rows={range === 'tonight' ? byHour : byDay} />
          {range === 'tonight' && byHour.length === 0 && <p className="text-sm text-zinc-500">No paid checks yet.</p>}
        </Card>
        <Card title="Sales by category · tonight (paid lines)">
          {byCat.length ? (
            <Bars rows={byCat} />
          ) : (
            <p className="text-sm text-zinc-500">No paid lines yet.</p>
          )}
          {weakCat && (
            <NextAction onGo={() => setScreen('costing')} goLabel="Costing →">
              {weakCat.label} trails at {money(weakCat.value)} — check its dishes in the matrix before pushing them.
            </NextAction>
          )}
        </Card>
      </div>
    </div>
  )
}

// ─── Service ────────────────────────────────────────────────────

function ServiceReport() {
  const { state, setScreen } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const tableById = useMemo(() => Object.fromEntries(state.tables.map((t) => [t.id, t])), [state.tables])

  const paid = state.orders.filter((o) => o.status === 'paid')

  // Server performance (single-server demo, still a real table)
  const servers = useMemo(() => {
    const m = new Map()
    for (const o of state.orders) {
      if (o.status === 'void') continue
      const key = o.serverId
      if (!m.has(key)) m.set(key, { checks: 0, sales: 0, comps: 0, voids: 0 })
      const r = m.get(key)
      if (o.status === 'paid') {
        r.checks += 1
        r.sales += o.total ?? orderSubtotal(o, menuById)
      }
      r.comps += o.items.filter((i) => i.comped && !i.voided).length
      r.voids += o.items.filter((i) => i.voided).length
    }
    return [...m.entries()].map(([id, r]) => ({ id, name: id === 'server' ? 'Jordan' : id, ...r, avg: r.checks ? r.sales / r.checks : 0 }))
  }, [state.orders, menuById])

  // Table turns (paid checks by table; seed early-service paid checks are unassigned)
  const tables = useMemo(() => {
    const m = new Map()
    for (const o of paid) {
      const key = o.tableId || 'unassigned'
      if (!m.has(key)) m.set(key, { turns: 0, sales: 0 })
      const r = m.get(key)
      r.turns += 1
      r.sales += o.total ?? orderSubtotal(o, menuById)
    }
    return [...m.entries()]
      .map(([id, r]) => ({ id, name: id === 'unassigned' ? 'Early service (no table)' : tableById[id]?.name || id, ...r, avg: r.sales / r.turns }))
      .sort((a, b) => b.turns - a.turns)
  }, [paid, menuById, tableById])

  const avgTurn = state.turnHistory.length
    ? Math.round(state.turnHistory.reduce((s, t) => s + t.minutes, 0) / state.turnHistory.length)
    : 0

  const liveSlow = state.tables
    .filter((t) => (t.status === 'seated' || t.status === 'ordered') && t.seatedAt)
    .map((t) => ({ t, mins: Math.floor((Date.now() - new Date(t.seatedAt)) / 60000) }))
    .sort((a, b) => b.mins - a.mins)
    .slice(0, 3)

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card title="Server performance · tonight">
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={s.id} className="rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-zinc-100">{s.name}</span>
                <span className="tnum font-bold">{money(s.sales)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                <StatusPill tone="muted" size="sm">{s.checks} checks</StatusPill>
                <StatusPill tone="muted" size="sm">avg {money(s.avg)}</StatusPill>
                <StatusPill tone={s.comps ? 'warn' : 'muted'} size="sm">{s.comps} comps</StatusPill>
                <StatusPill tone={s.voids ? 'bad' : 'muted'} size="sm">{s.voids} voids</StatusPill>
              </div>
            </li>
          ))}
        </ul>
        <NextAction>
          {servers.some((s) => s.voids + s.comps > 2)
            ? 'Comp/void count is climbing — read the Voids tab before the pre-shift.'
            : 'Clean hands so far — keep void reasons honest and specific.'}
        </NextAction>
      </Card>

      <Card title="Table performance · turns & avg check">
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
          {tables.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-ink-800)] px-3 py-2 ring-1 ring-inset ring-[var(--color-ink-600)]">
              <span className="text-zinc-200">{t.name}</span>
              <span className="tnum text-zinc-400">
                {t.turns} turn{t.turns === 1 ? '' : 's'} · avg <strong className="text-zinc-100">{money(t.avg)}</strong>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-zinc-500">
          Average turn tonight: <strong className="tnum text-zinc-300">{avgTurn}m</strong> (drives host wait quotes).
          {liveSlow.length > 0 && (
            <> Slowest live: {liveSlow.map((s) => `${s.t.name} ${s.mins}m`).join(' · ')}.</>
          )}
        </p>
        <NextAction onGo={() => setScreen('floor')} goLabel="Floor →">
          {liveSlow.length && liveSlow[0].mins >= liveSlow[0].t.targetTurnMinutes
            ? `${liveSlow[0].t.name} is past target — check on the check, then bus the moment it pays.`
            : 'Turns are healthy — protect the next seat by bussing dirty tables fast.'}
        </NextAction>
      </Card>
    </div>
  )
}

// ─── Voids & comps ──────────────────────────────────────────────

function VoidsReport() {
  const { state, setScreen } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const tableById = useMemo(() => Object.fromEntries(state.tables.map((t) => [t.id, t])), [state.tables])

  const voidOrders = state.orders.filter((o) => o.status === 'void')
  const voidLines = []
  const compLines = []
  for (const o of state.orders) {
    for (const it of o.items) {
      const val = (menuById[it.menuItemId]?.price || 0) * it.qty
      if (it.voided) voidLines.push({ order: o, item: it, val })
      else if (it.comped) compLines.push({ order: o, item: it, val })
    }
  }
  const voidTotal = voidOrders.reduce((s, o) => s + orderSubtotal({ ...o, items: o.items.filter((i) => !i.comped) }, menuById), 0)
    + voidLines.reduce((s, l) => s + l.val, 0)
  const compTotal = compLines.reduce((s, l) => s + l.val, 0)
  const paid = state.orders.filter((o) => o.status === 'paid')
  const sales = paid.reduce((s, o) => s + (o.total ?? orderSubtotal(o, menuById)), 0)

  const reasons = useMemo(() => {
    const m = new Map()
    const bump = (r) => m.set(r, (m.get(r) || 0) + 1)
    for (const o of voidOrders) bump(`void check · ${o.voidReason || 'no reason'}`)
    for (const l of voidLines) bump(`void line · ${l.item.voidReason || 'no reason'}`)
    for (const l of compLines) bump(`comp · ${l.item.compReason || 'no reason'}`)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [state.orders]) // eslint-disable-line react-hooks/exhaustive-deps

  const line = (l) => (
    <span>
      {l.item.qty}× {menuById[l.item.menuItemId]?.name || '?'} · {tableById[l.order.tableId]?.name || '—'} ·{' '}
      <span className="text-zinc-500">{l.item.voidReason || l.item.compReason}</span>
    </span>
  )

  const empty = voidOrders.length + voidLines.length + compLines.length === 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Voided', value: money(voidTotal), sub: `${voidOrders.length} checks · ${voidLines.length} lines` },
          { label: 'Comped', value: money(compTotal), sub: `${compLines.length} lines · ${sales ? ((compTotal / sales) * 100).toFixed(1) : 0}% of sales` },
          { label: 'Leakage', value: money(voidTotal + compTotal), sub: sales ? `${(((voidTotal + compTotal) / sales) * 100).toFixed(1)}% of sales` : 'no sales yet' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
            <div className="tnum text-2xl font-bold">{k.value}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{k.label}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{k.sub}</div>
          </div>
        ))}
      </div>

      {empty ? (
        <Card title="Reasons">
          <p className="py-4 text-center text-sm text-zinc-500">
            No voids or comps tonight — clean service. (Reasons land here with counts the moment one happens.)
          </p>
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Card title="Reason breakdown">
            <Bars rows={reasons.map(([label, value]) => ({ label, value }))} format={(v) => `×${v}`} />
            <NextAction onGo={() => setScreen('tickets')} goLabel="Tickets →">
              Top reason is “{reasons[0]?.[0]}” — retrain it at pre-shift, then watch this count fall.
            </NextAction>
          </Card>
          <Card title="Every comp & void · audit">
            <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
              {voidOrders.map((o) => (
                <li key={o.id} className="flex justify-between gap-2 rounded-lg bg-red-500/5 px-3 py-2 text-zinc-300 ring-1 ring-inset ring-red-500/25">
                  <span>Void check · {tableById[o.tableId]?.name || '—'} · <span className="text-zinc-500">{o.voidReason}</span></span>
                  <span className="tnum shrink-0">{money(orderSubtotal(o, menuById))}</span>
                </li>
              ))}
              {voidLines.map((l) => (
                <li key={l.item.id} className="flex justify-between gap-2 rounded-lg bg-red-500/5 px-3 py-2 text-zinc-300 ring-1 ring-inset ring-red-500/25">
                  {line(l)}
                  <span className="tnum shrink-0">{money(l.val)}</span>
                </li>
              ))}
              {compLines.map((l) => (
                <li key={l.item.id} className="flex justify-between gap-2 rounded-lg bg-[var(--color-ink-800)] px-3 py-2 text-zinc-300 ring-1 ring-inset ring-[var(--color-ink-600)]">
                  {line(l)}
                  <span className="tnum shrink-0">{money(l.val)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  )
}

// ─── Variance ───────────────────────────────────────────────────

function VarianceReport() {
  const { state, setScreen } = useRestora()
  const skuById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])

  // Theoretical usage tonight: every fired/bumped line × its recipe
  // (snapshot when fired, live recipe for seed lines).
  const usage = useMemo(() => {
    const qtyBySku = {}
    for (const o of state.orders) {
      if (o.status === 'void') continue
      for (const it of o.items) {
        if (it.voided || it.status === 'held') continue
        const recipe = it.recipeSnapshot || state.recipes[it.menuItemId]
        if (!recipe?.ingredients) continue
        const dec = theoreticalDecrementFor(recipe, it.qty)
        for (const [sku, q] of Object.entries(dec)) qtyBySku[sku] = (qtyBySku[sku] || 0) + q
      }
    }
    return Object.entries(qtyBySku)
      .map(([skuId, qty]) => ({ sku: skuById[skuId], qty, value: qty * (skuById[skuId]?.lastCost || 0) }))
      .filter((r) => r.sku)
      .sort((a, b) => b.value - a.value)
  }, [state.orders, state.recipes, skuById])

  const wasteByReason = useMemo(() => {
    const m = new Map()
    for (const w of state.wasteLog) {
      const v = w.qty * (skuById[w.inventoryItemId]?.lastCost || 0)
      m.set(w.reason, (m.get(w.reason) || 0) + v)
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [state.wasteLog, skuById])

  const wasteTotal = wasteByReason.reduce((s, r) => s + r.value, 0)
  const usageTotal = usage.reduce((s, r) => s + r.value, 0)
  const negatives = state.inventory.filter((i) => i.onHand < 0)
  const topWasteSku = useMemo(() => {
    const m = new Map()
    for (const w of state.wasteLog) m.set(w.inventoryItemId, (m.get(w.inventoryItemId) || 0) + w.qty)
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    return top ? skuById[top[0]] : null
  }, [state.wasteLog, skuById])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Theoretical usage', value: money(usageTotal), sub: 'fired lines × recipes' },
          { label: 'Logged waste', value: money(wasteTotal), sub: `${state.wasteLog.length} entries` },
          { label: 'Negative SKUs', value: String(negatives.length), sub: negatives.length ? 'flags, never silent' : 'none — counts are sane' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
            <div className="tnum text-2xl font-bold">{k.value}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{k.label}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title="Usage by SKU · theoretical, tonight">
          {usage.length ? (
            <Bars rows={usage.slice(0, 10).map((r) => ({ label: `${r.sku.name} · ${Math.round(r.qty * 100) / 100} ${r.sku.unit}`, value: r.value }))} />
          ) : (
            <p className="text-sm text-zinc-500">Nothing fired yet.</p>
          )}
          {negatives.length > 0 && (
            <div className="mt-3 rounded-xl bg-red-500/10 p-3 ring-1 ring-inset ring-red-500/30">
              <div className="text-xs font-bold uppercase tracking-widest text-red-300">Negative on-hand — recount</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {negatives.map((n) => (
                  <StatusPill key={n.id} tone="bad" size="sm">{n.name} · {n.onHand}</StatusPill>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card title="Waste by reason · logged">
          {wasteByReason.length ? (
            <Bars rows={wasteByReason} />
          ) : (
            <p className="text-sm text-zinc-500">No waste logged.</p>
          )}
          <NextAction onGo={() => setScreen('inventory')} goLabel="Inventory →">
            {topWasteSku
              ? `${topWasteSku.name} leads waste — cut its par or prep, then recount to confirm.`
              : 'Run the count sheet at close — theoretical vs counted is where variance hides.'}
          </NextAction>
        </Card>
      </div>
    </div>
  )
}

// ─── P&L-lite ───────────────────────────────────────────────────

function PnlReport() {
  const { state, setScreen } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const skuById = useMemo(() => Object.fromEntries(state.inventory.map((i) => [i.id, i])), [state.inventory])

  // Matching principle: paid sales vs paid lines' food cost (snapshots first).
  const paid = state.orders.filter((o) => o.status === 'paid')
  const sales = paid.reduce((s, o) => s + (o.total ?? orderSubtotal(o, menuById)), 0)
  let food = 0
  for (const { item } of paidLines(state)) {
    const plate = item.recipeSnapshot?.plateCost ?? plateCostFor(state.recipes[item.menuItemId], skuById)
    food += plate * item.qty
  }
  const waste = state.wasteLog.reduce((s, w) => s + w.qty * (skuById[w.inventoryItemId]?.lastCost || 0), 0)
  const gross = sales - food
  const net = gross - waste
  const foodPct = sales ? food / sales : 0

  const histAvgFood = state.salesHistory.reduce((s, d) => s + d.foodCostPct, 0) / Math.max(1, state.salesHistory.length)
  const cap = state.settings.foodCostCap
  const over = foodPct > cap

  const rows = [
    { label: 'Sales (paid checks)', value: sales, tone: 'text-zinc-100' },
    { label: 'Theoretical food cost (paid lines, snapshots)', value: -food, tone: 'text-red-300' },
    { label: 'Gross profit', value: gross, tone: 'font-bold text-zinc-100', rule: true },
    { label: 'Logged waste', value: -waste, tone: 'text-red-300' },
    { label: 'Net (P&L-lite)', value: net, tone: 'font-bold text-emerald-300', rule: true },
  ]

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card title="P&L-lite · tonight (no full accounting)">
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li
              key={r.label}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 ${r.rule ? 'bg-black/30 ring-1 ring-inset ring-[var(--color-ink-700)]' : ''}`}
            >
              <span className="text-zinc-300">{r.label}</span>
              <span className={`tnum ${r.tone}`}>{r.value < 0 ? `−${money(-r.value)}` : money(r.value)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-zinc-500">
          Labor, rent, and card fees are out of scope — this is the kitchen&apos;s truth, not the accountant&apos;s.
        </p>
      </Card>

      <Card title="Food-cost position">
        <div className="tnum text-4xl font-bold">
          {(foodPct * 100).toFixed(1)}%
          <span className="ml-2 align-middle text-sm font-normal text-zinc-500">tonight</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-black/50">
          <div
            className={`h-full rounded-full ${over ? 'bg-red-400' : 'bg-emerald-500/80'}`}
            style={{ width: `${Math.min(100, (foodPct / (cap * 1.5)) * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusPill tone={over ? 'bad' : 'ok'} size="sm">
            cap {(cap * 100).toFixed(0)}% · {over ? 'over' : 'inside'}
          </StatusPill>
          <StatusPill tone="muted" size="sm">7-day avg {(histAvgFood * 100).toFixed(1)}%</StatusPill>
          <StatusPill tone={waste > sales * 0.03 ? 'warn' : 'muted'} size="sm">
            waste {sales ? ((waste / sales) * 100).toFixed(1) : '0.0'}% of sales
          </StatusPill>
        </div>
        <NextAction onGo={() => setScreen('costing')} goLabel="Costing →">
          {over
            ? 'Over cap — open the matrix and reprice one plowhorse before tomorrow.'
            : 'Inside cap — protect it: 86 the worst dog while the night is young.'}
        </NextAction>
      </Card>
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { state } = useRestora()
  const [tab, setTab] = useState('sales')
  const [range, setRange] = useState('tonight')

  // The printed report is the same aggregation the screen shows — just on
  // paper, with the location's report template and currency.
  function printReport() {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    const doc = buildReportDocument({ shop: { ...state, settings }, settings, range })
    printHtml(renderDocumentHtml(doc, settings, {}), { title: `${doc.title} ${range}` })
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">Business overview</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Reports &amp; Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">Turn sales, service, and cost signals into the next best action.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={printReport}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
        >
          <Icon name="printer" size={16} /> Print report
        </button>
        <div className="flex gap-1 rounded-xl bg-[var(--color-ink-900)] p-1 ring-1 ring-inset ring-[var(--color-ink-700)]" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={range === r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold ${range === r.id ? 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/40' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        </div>
      </header>

      <p className="text-xs text-zinc-500">
        Range drives Sales totals; Service, Voids, Variance, and P&L-lite read tonight&apos;s live orders.
        Previous-period compare is always on.
      </p>

      <div className="flex gap-1.5 overflow-x-auto rounded-xl bg-[var(--color-ink-900)] p-1.5 ring-1 ring-inset ring-[var(--color-ink-700)]" role="tablist" aria-label="Reports">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/40' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sales' && <SalesReport range={range} />}
      {tab === 'service' && <ServiceReport />}
      {tab === 'voids' && <VoidsReport />}
      {tab === 'variance' && <VarianceReport />}
      {tab === 'pnl' && <PnlReport />}
    </div>
  )
}
