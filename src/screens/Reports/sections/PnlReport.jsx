import { useMemo } from 'react'
import StatusPill from '../../../components/StatusPill'
import { money, orderSubtotal, plateCostFor } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { paidLines } from '../shared.js'
import { Card, NextAction, ReportShell } from './Common.jsx'

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
    <ReportShell title="P&L-lite" source="Tonight's kitchen truth: sales versus food cost and logged waste — no labour or rent.">
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
    </ReportShell>
  )
}


export { PnlReport }
