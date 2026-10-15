import { useMemo } from 'react'
import StatusPill from '../../../components/StatusPill'
import { money } from '../../../lib/models'
import { buildReports } from '../../../lib/reports'
import { useRestora } from '../../../lib/store'
import { pct } from '../shared.js'
import { Card, NextAction, Bars, ReportShell } from './Common.jsx'

function ProfitLossReport({ range }) {
  const { state, setScreen } = useRestora()
  const reports = useMemo(() => buildReports(state, range), [state, range])
  const { pnl } = reports

  const rows = [
    { label: 'Net sales (excl. tax & tips)', value: pnl.revenue, tone: 'text-zinc-100' },
    { label: 'Cost of goods sold (recipe book)', value: -pnl.cogs, tone: 'text-red-300', sub: pct(pnl.foodCostPct) },
    { label: 'Gross profit', value: pnl.grossProfit, tone: 'font-bold text-zinc-100', rule: true, sub: pct(pnl.marginPct) },
    { label: `Waste (${pnl.wasteCount} logged)`, value: -pnl.waste, tone: 'text-red-300' },
    { label: 'Count shrinkage', value: -pnl.shrinkage, tone: 'text-red-300' },
    { label: 'Operating result', value: pnl.operatingResult, tone: 'font-bold text-emerald-300', rule: true, sub: pct(pnl.operatingMarginPct) },
  ]

  const cashRows = [
    { label: 'Cash in (takings incl. tax + tips)', value: pnl.cashIn },
    { label: 'Cash out (purchases received)', value: -pnl.cashOut },
    { label: 'Net cash', value: pnl.netCash },
  ]

  return (
    <ReportShell title="Profit & loss" source="Recipe-book COGS applied to paid checks, plus waste, shrinkage, and cash movement.">
      <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card title={`Profit & loss · ${reports.bounds.label}`}>
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.label} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 ${row.rule ? 'bg-black/30 ring-1 ring-inset ring-[var(--color-ink-700)]' : ''}`}>
              <span className="text-zinc-300">{row.label}</span>
              <span className={`tnum ${row.tone}`}>
                {row.value < 0 ? `−${money(-row.value)}` : money(row.value)}
                {row.sub && <span className="ml-2 text-[11px] font-normal text-zinc-500">{row.sub}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-zinc-500">
          Cost of goods is the recipe book applied to paid checks, frozen at the moment each plate fired — a delivery
          arriving tomorrow cannot rewrite tonight&apos;s margin. Labour, rent and card fees stay out of scope.
        </p>
        <NextAction onGo={() => setScreen('costing')} goLabel="Costing →">
          {pnl.targets.onTarget
            ? `Food cost ${pct(pnl.foodCostPct)} is inside the ${pct(pnl.targets.foodCostCap)} cap — protect it.`
            : `Food cost ${pct(pnl.foodCostPct)} is over the ${pct(pnl.targets.foodCostCap)} cap — reprice or 86 the worst plate.`}
        </NextAction>
      </Card>

      <div className="space-y-4">
        <Card title="Cash movement">
          <ul className="space-y-1 text-sm">
            {cashRows.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5">
                <span className="text-zinc-300">{row.label}</span>
                <span className={`tnum ${row.value < 0 ? 'text-red-300' : 'text-zinc-100'}`}>
                  {row.value < 0 ? `−${money(-row.value)}` : money(row.value)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-zinc-500">
            Suppliers are paid when a receipt is booked, not when the order is raised — ordering alone never moves cash.
          </p>
        </Card>

        <Card title="Where the money is made">
          {pnl.byCategory.length ? (
            <Bars
              rows={pnl.byCategory.slice(0, 6).map((row) => ({
                label: row.category,
                value: row.margin,
                sub: `${pct(row.marginPct)} on ${money(row.revenue)}`,
              }))}
            />
          ) : (
            <p className="text-sm text-zinc-500">No paid sales in this window.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusPill tone={pnl.targets.onTarget ? 'ok' : 'bad'} size="sm">
              food cost {pct(pnl.foodCostPct)} vs cap {pct(pnl.targets.foodCostCap)}
            </StatusPill>
            <StatusPill tone="muted" size="sm">waste {pct(pnl.revenue ? pnl.waste / pnl.revenue : 0)} of sales</StatusPill>
            <StatusPill tone={pnl.shrinkage > 0 ? 'warn' : 'muted'} size="sm">
              shrinkage {money(pnl.shrinkage)}
            </StatusPill>
          </div>
        </Card>
      </div>
      </div>
    </ReportShell>
  )
}


export { ProfitLossReport }
