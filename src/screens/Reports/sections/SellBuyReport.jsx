import { useMemo } from 'react'
import { money } from '../../../lib/models'
import { MOVEMENT_KINDS } from '../../../lib/reducer'
import { buildReports } from '../../../lib/reports'
import { useRestora } from '../../../lib/store'
import { signedQty, KIND_LABEL } from '../shared.js'
import { Card, NextAction, Bars, ReportShell } from './Common.jsx'

function SellBuyReport({ range }) {
  const { state, setScreen } = useRestora()
  const reports = useMemo(() => buildReports(state, range), [state, range])
  const { sales, purchases, movements } = reports

  const methodRows = Object.entries(sales.byMethod).map(([method, value]) => ({ label: method, value }))
  const supplierRows = purchases.bySupplier.slice(0, 6).map((row) => ({ label: row.name, value: row.value, sub: `${row.orders} order(s)` }))
  const kindRows = movements.byKind
    .filter((row) => row.count > 0)
    .sort((a, b) => (b.inValue + b.outValue) - (a.inValue + a.outValue))
  const flowRows = reports.flow.slice(0, 8)

  return (
    <ReportShell title="Sell & buy in/out" source={`Movement ledger for ${reports.bounds.label} — what sold, what was bought, and the net flow.`}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title={`Selling · ${reports.bounds.label}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: 'Takings', value: money(sales.takings), sub: 'incl. tax + tips' },
              { label: 'Net sales', value: money(sales.netSales), sub: 'what the P&L counts' },
              { label: 'Tax collected', value: money(sales.tax), sub: 'pass-through' },
              { label: 'Tips', value: money(sales.tips), sub: 'to the floor' },
              { label: 'Paid checks', value: String(sales.checks), sub: `${sales.covers} cover(s)` },
              { label: 'Avg check', value: money(sales.avgCheck), sub: `${money(sales.avgCover)}/cover` },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl bg-black/30 px-3 py-2.5 ring-1 ring-inset ring-[var(--color-ink-700)]">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{kpi.label}</div>
                <div className="tnum mt-0.5 text-lg font-bold text-zinc-100">{kpi.value}</div>
                <div className="text-[11px] text-zinc-500">{kpi.sub}</div>
              </div>
            ))}
          </div>
          {methodRows.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Tender mix</h3>
              <div className="mt-2"><Bars rows={methodRows} /></div>
            </div>
          )}
          <NextAction onGo={() => setScreen('tickets')} goLabel="Tickets →">
            {sales.checks
              ? `Best seller this window: ${reports.rankings.sell.byRevenue[0]?.name || '—'} — keep it on the specials board.`
              : 'No paid checks in this window yet.'}
          </NextAction>
        </Card>

        <Card title={`Buying · ${reports.bounds.label}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: 'Spend', value: money(purchases.spend), sub: `${purchases.orders} receipt(s)` },
              { label: 'Still on order', value: money(purchases.openValue), sub: `${purchases.openOrders.length} open` },
              { label: 'Units bought', value: String(Math.round(purchases.units * 10) / 10), sub: 'across all lines' },
              { label: 'Suppliers paid', value: String(purchases.bySupplier.length), sub: 'in this window' },
              { label: 'Quick receipts', value: String(purchases.quickReceipts), sub: 'booked at the door' },
              { label: 'Cash out', value: money(reports.pnl.cashOut), sub: 'purchases only' },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl bg-black/30 px-3 py-2.5 ring-1 ring-inset ring-[var(--color-ink-700)]">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{kpi.label}</div>
                <div className="tnum mt-0.5 text-lg font-bold text-zinc-100">{kpi.value}</div>
                <div className="text-[11px] text-zinc-500">{kpi.sub}</div>
              </div>
            ))}
          </div>
          {supplierRows.length > 0
            ? <div className="mt-4"><h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Spend by supplier</h3><div className="mt-2"><Bars rows={supplierRows} /></div></div>
            : <p className="mt-4 text-sm text-zinc-500">Nothing was received in this window.</p>}
          <NextAction onGo={() => setScreen('purchases')} goLabel="Purchases →">
            {purchases.openOrders.length
              ? `${purchases.openOrders.length} order(s) still coming — check the delivery dates on ${money(purchases.openValue)}.`
              : 'Nothing on order. Fill the low-stock list before the rush.'}
          </NextAction>
        </Card>
      </div>

      <Card title="Stock in / out">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'In', value: money(movements.inValue), sub: `${movements.inUnits} units · ${movements.inCount} rows`, tone: 'text-emerald-300' },
            { label: 'Out', value: money(movements.outValue), sub: `${movements.outUnits} units · ${movements.outCount} rows`, tone: 'text-red-300' },
            { label: 'Net', value: money(movements.netValue), sub: 'in minus out', tone: 'text-zinc-100' },
            { label: 'Opening baseline', value: money(movements.openingValue), sub: 'not counted as spend', tone: 'text-zinc-400' },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl bg-black/30 px-3 py-2.5 ring-1 ring-inset ring-[var(--color-ink-700)]">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{kpi.label}</div>
              <div className={`tnum mt-0.5 text-xl font-bold ${kpi.tone}`}>{kpi.value}</div>
              <div className="text-[11px] text-zinc-500">{kpi.sub}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-inset ring-[var(--color-ink-700)]">
          <table className="w-full">
            <thead className="bg-black/30">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Reason</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Direction</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Rows</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Units</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {kindRows.map((row) => (
                <tr key={row.kind}>
                  <td className="px-3 py-2 text-sm text-zinc-300">
                    {KIND_LABEL[row.kind] || row.kind}
                    {row.baseline && <span className="ml-2 text-[11px] text-zinc-500">baseline</span>}
                  </td>
                  <td className="px-3 py-2 text-sm text-zinc-400">
                    {row.baseline ? 'baseline' : MOVEMENT_KINDS.find((kind) => kind.id === row.kind)?.direction === 'out' ? 'out' : 'in'}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-sm text-zinc-300">{row.count}</td>
                  <td className="tnum px-3 py-2 text-right text-sm text-zinc-300">{signedQty(row.units)}</td>
                  <td className={`tnum px-3 py-2 text-right text-sm ${row.value < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{signedQty(row.value) === '0' ? money(0) : `${row.value < 0 ? '−' : '+'}${money(Math.abs(row.value))}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {flowRows.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-inset ring-[var(--color-ink-700)]">
            <table className="w-full">
              <thead className="bg-black/30">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Item</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Opened</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">In</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Out</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">On hand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-ink-800)]">
                {flowRows.map((row) => (
                  <tr key={row.itemId}>
                    <td className="px-3 py-2 text-sm text-zinc-300">{row.name}</td>
                    <td className="tnum px-3 py-2 text-right text-sm text-zinc-400">{signedQty(row.opening)}</td>
                    <td className="tnum px-3 py-2 text-right text-sm text-emerald-300">{signedQty(row.inQty)}</td>
                    <td className="tnum px-3 py-2 text-right text-sm text-red-300">{signedQty(-(row.outQty || 0))}</td>
                    <td className="tnum px-3 py-2 text-right text-sm font-semibold text-zinc-100">{signedQty(row.onHand)} {row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <NextAction onGo={() => setScreen('movements')} goLabel="Ledger →">
          Every number here traces to a signed row in the movement ledger.
        </NextAction>
      </Card>
    </ReportShell>
  )
}


export { SellBuyReport }
