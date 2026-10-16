import { useMemo } from 'react'
import StatusPill from '../../../components/StatusPill'
import { money, orderSubtotal } from '../../../lib/models'
import { buildReports } from '../../../lib/reports'
import { useRestora } from '../../../lib/store'
import { RANGES, paidLines } from '../shared.js'
import { Card, NextAction, Bars, ReportShell } from './Common.jsx'
import { RevenueChart } from './RevenueChart.jsx'

function SalesReport({ range }) {
  const { state, setScreen } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const reports = useMemo(() => buildReports(state, range), [state, range])
  const repSales = reports.sales

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
  const covers = range === 'tonight' ? paid.reduce((sum, o) => sum + (Number(o.covers) || 1), 0) : null
  const avgCover = covers ? total / covers : null

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

  const peakHour = useMemo(() => {
    if (!byHour.length) return null
    const top = [...byHour].sort((a, b) => b.value - a.value)[0]
    return top && top.value > 0 ? top : null
  }, [byHour])

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

  // Tender mix rows
  const tenderRows = useMemo(() => {
    const methods = Object.entries(repSales.byMethod || {})
    const totalTender = methods.reduce((sum, [, val]) => sum + val, 0) || 1
    return methods.map(([method, val]) => {
      const label = method === 'card' ? 'Credit / Debit Card' : method === 'cash' ? 'Cash Tender' : method === 'qr' ? 'QR Mobile Pay' : method === 'split' ? 'Split / Mixed' : method
      return {
        label,
        value: val,
        sub: `${Math.round((val / totalTender) * 100)}% (${money(val)})`,
      }
    }).sort((a, b) => b.value - a.value)
  }, [repSales.byMethod])

  // Order channels (Dine-in vs Takeout vs Delivery)
  const channelRows = useMemo(() => {
    const m = {
      dine_in: { label: 'Dine-in Floor', count: 0, total: 0 },
      takeout: { label: 'Takeout / Counter', count: 0, total: 0 },
      delivery: { label: 'Online Delivery', count: 0, total: 0 },
    }
    for (const o of paid) {
      const type = o.type === 'takeout' ? 'takeout' : o.type === 'delivery' ? 'delivery' : 'dine_in'
      m[type].count += 1
      m[type].total += (o.total ?? orderSubtotal(o, menuById))
    }
    return Object.values(m)
      .filter((c) => c.count > 0)
      .map((c) => ({
        label: c.label,
        value: c.total,
        sub: `${c.count} check(s)`,
      }))
  }, [paid, menuById])

  const weakCat = byCat[byCat.length - 1]

  return (
    <ReportShell title="Sales" source="Paid checks for the selected range, compared against the always-on 7-day baseline.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="tnum text-3xl font-bold">{covers == null ? '—' : covers}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Guests (Covers)</div>
          <div className="mt-1.5 text-xs text-zinc-500">{covers == null ? 'shift covers' : `${money(avgCover)} spend per guest`}</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{money(histAvg)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">7-day daily avg</div>
          <div className="mt-1.5 text-xs text-zinc-500">the compare baseline, always on</div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title={range === 'tonight' ? 'Sales by hour · tonight' : 'Sales by day · history + tonight'}>
          {range === 'tonight' && peakHour && (
            <div className="mb-3 flex items-center justify-between rounded-xl bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/30">
              <span className="font-semibold">Peak Sales Hour: {peakHour.label}</span>
              <span className="tnum font-bold">{money(peakHour.value)}</span>
            </div>
          )}
          <RevenueChart rows={range === 'tonight' ? byHour : byDay} fallback={<Bars rows={range === 'tonight' ? byHour : byDay} />} />
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

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title="Payment & Tender Mix">
          {tenderRows.length > 0 ? (
            <Bars rows={tenderRows} />
          ) : (
            <p className="text-sm text-zinc-500">No payment records in this window yet.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
            <span className="rounded-lg bg-black/30 px-2 py-1 ring-1 ring-inset ring-[var(--color-ink-700)]">
              Tips collected: <strong className="text-zinc-100">{money(repSales.tips)}</strong>
            </span>
            <span className="rounded-lg bg-black/30 px-2 py-1 ring-1 ring-inset ring-[var(--color-ink-700)]">
              Tax collected: <strong className="text-zinc-100">{money(repSales.tax)}</strong>
            </span>
            <span className="rounded-lg bg-black/30 px-2 py-1 ring-1 ring-inset ring-[var(--color-ink-700)]">
              Discounts given: <strong className="text-zinc-100">{money(repSales.discount)}</strong>
            </span>
          </div>
        </Card>

        <Card title="Dining Channels">
          {channelRows.length > 0 ? (
            <Bars rows={channelRows} />
          ) : (
            <p className="text-sm text-zinc-500">No order channel activity yet.</p>
          )}
          <NextAction onGo={() => setScreen('tickets')} goLabel="Tickets →">
            {checks ? `${checks} check(s) processed across ${covers || checks} covers this shift.` : 'No closed orders yet.'}
          </NextAction>
        </Card>
      </div>
    </ReportShell>
  )
}

export { SalesReport }

