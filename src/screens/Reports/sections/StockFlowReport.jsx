import { useMemo, useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { money } from '../../../lib/models'
import { MOVEMENT_KINDS } from '../../../lib/reducer'
import { buildReports } from '../../../lib/reports'
import { useRestora } from '../../../lib/store'
import { signedQty, KIND_LABEL } from '../shared.js'
import { Card, NextAction, ReportShell } from './Common.jsx'

function StockFlowReport({ range }) {
  const { state, setScreen } = useRestora()
  const [search, setSearch] = useState('')
  const [filterHealth, setFilterHealth] = useState('all')

  const reports = useMemo(() => buildReports(state, range), [state, range])
  const { movements, flow } = reports

  const inventoryById = useMemo(() => Object.fromEntries((state.inventory || []).map((i) => [i.id, i])), [state.inventory])

  const endingBookValue = useMemo(() => {
    return (state.inventory || []).reduce((sum, item) => sum + (Number(item.onHand) || 0) * (Number(item.lastCost) || 0), 0)
  }, [state.inventory])

  const kindRows = useMemo(() => {
    return movements.byKind
      .filter((row) => row.count > 0)
      .sort((a, b) => (b.inValue + b.outValue) - (a.inValue + a.outValue))
  }, [movements.byKind])

  const filteredFlow = useMemo(() => {
    return flow.filter((row) => {
      const invItem = inventoryById[row.itemId]
      const par = Number(invItem?.par) || 0
      const isNegative = row.onHand < 0
      const isLow = par > 0 && row.onHand < par

      if (filterHealth === 'negative' && !isNegative) return false
      if (filterHealth === 'low' && (!isLow || isNegative)) return false
      if (filterHealth === 'healthy' && (isNegative || isLow)) return false

      if (search.trim()) {
        const q = search.toLowerCase()
        return (row.name || '').toLowerCase().includes(q) || (row.unit || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [flow, inventoryById, search, filterHealth])

  const negatives = useMemo(() => (state.inventory || []).filter((i) => i.onHand < 0), [state.inventory])

  return (
    <ReportShell
      title="Stock Flow & Movements"
      source={`Complete stock reconciliation and signed ledger movements for ${reports.bounds.label}.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-emerald-300">+{money(movements.inValue)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Stock Inflow
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            {movements.inUnits} units · {movements.inCount} ledger row(s)
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-red-300">−{money(movements.outValue)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Stock Outflow
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            {movements.outUnits} units · {movements.outCount} depletion/waste
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className={`tnum text-3xl font-bold ${movements.netValue >= 0 ? 'text-zinc-100' : 'text-amber-300'}`}>
            {movements.netValue < 0 ? '−' : '+'}{money(Math.abs(movements.netValue))}
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Net Valuation Flow
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            net inventory change
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-zinc-300">{money(movements.openingValue)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Opening Baseline
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            at start of period
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-zinc-100">{money(endingBookValue)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Current Book Value
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            on-hand × last cost
          </div>
        </div>
      </div>

      {negatives.length > 0 && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-red-200">Negative Stock Warning ({negatives.length} SKU)</h3>
              <p className="text-xs text-red-300/80">Stock cannot physically be negative. Run an inventory count to reconcile theoretical vs counted.</p>
            </div>
            <button
              type="button"
              onClick={() => setScreen('inventory')}
              className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-200 ring-1 ring-inset ring-red-500/40 hover:bg-red-500/30"
            >
              Open Count Sheet →
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {negatives.map((n) => (
              <StatusPill key={n.id} tone="bad" size="sm">
                {n.name}: {n.onHand} {n.unit}
              </StatusPill>
            ))}
          </div>
        </div>
      )}

      <Card title="Movement Ledger by Reason">
        <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-[var(--color-ink-700)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/30">
              <tr>
                <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Movement Reason</th>
                <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Direction</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Ledger Rows</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Units</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Net Valuation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {kindRows.map((row) => (
                <tr key={row.kind}>
                  <td className="px-3 py-2 text-zinc-200">
                    <span className="font-medium">{KIND_LABEL[row.kind] || row.kind}</span>
                    {row.baseline && <span className="ml-2 text-[10px] text-zinc-500">(baseline)</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {row.baseline ? (
                      <span className="text-zinc-500">baseline</span>
                    ) : MOVEMENT_KINDS.find((k) => k.id === row.kind)?.direction === 'out' ? (
                      <span className="text-red-400">Outflow</span>
                    ) : (
                      <span className="text-emerald-400">Inflow</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-zinc-300">{row.count}</td>
                  <td className="tnum px-3 py-2 text-right text-zinc-300">{signedQty(row.units)}</td>
                  <td className={`tnum px-3 py-2 text-right font-semibold ${row.value < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {signedQty(row.value) === '0' ? money(0) : `${row.value < 0 ? '−' : '+'}${money(Math.abs(row.value))}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Item Stock Reconciliation (Opening → In → Out → Closing)">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredient or SKU…"
              className="min-h-[38px] w-full max-w-xs rounded-xl border border-[var(--color-ink-700)] bg-black/40 px-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-1 rounded-xl bg-black/40 p-1 ring-1 ring-inset ring-[var(--color-ink-700)]">
            {[
              { id: 'all', label: 'All Items' },
              { id: 'low', label: 'Under Par' },
              { id: 'negative', label: 'Negative' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterHealth(tab.id)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                  filterHealth === tab.id
                    ? 'bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredFlow.length > 0 ? (
          <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-[var(--color-ink-700)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/30">
                <tr>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Ingredient / SKU</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Opened</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">In (+)</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Out (−)</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">On Hand</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Book Value</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Net Flow</th>
                  <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-ink-800)]">
                {filteredFlow.map((row) => {
                  const invItem = inventoryById[row.itemId]
                  const par = Number(invItem?.par) || 0
                  const isNegative = row.onHand < 0
                  const isLow = par > 0 && row.onHand < par

                  return (
                    <tr key={row.itemId}>
                      <td className="px-3 py-2 font-medium text-zinc-200">
                        {row.name}
                        <span className="ml-1 text-xs text-zinc-500">({row.unit})</span>
                      </td>
                      <td className="tnum px-3 py-2 text-right text-zinc-400">{signedQty(row.opening)}</td>
                      <td className="tnum px-3 py-2 text-right text-emerald-300">{signedQty(row.inQty)}</td>
                      <td className="tnum px-3 py-2 text-right text-red-300">{signedQty(-(row.outQty || 0))}</td>
                      <td className="tnum px-3 py-2 text-right font-bold text-zinc-100">{signedQty(row.onHand)}</td>
                      <td className="tnum px-3 py-2 text-right text-zinc-300">{money(row.bookValue)}</td>
                      <td className={`tnum px-3 py-2 text-right font-semibold ${row.netValue < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                        {signedQty(row.netValue) === '0' ? money(0) : `${row.netValue < 0 ? '−' : '+'}${money(Math.abs(row.netValue))}`}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isNegative ? (
                          <StatusPill tone="bad" size="sm">Negative</StatusPill>
                        ) : isLow ? (
                          <StatusPill tone="warn" size="sm">Under Par</StatusPill>
                        ) : (
                          <StatusPill tone="ok" size="sm">Healthy</StatusPill>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No stock items match your search or filter.</p>
        )}

        <NextAction onGo={() => setScreen('movements')} goLabel="Movements →">
          View full timestamped audit log of every receipt, count adjustment, and kitchen depletion.
        </NextAction>
      </Card>
    </ReportShell>
  )
}

export { StockFlowReport }
