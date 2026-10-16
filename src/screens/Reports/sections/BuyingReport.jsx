import { useMemo, useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { money } from '../../../lib/models'
import { buildReports } from '../../../lib/reports'
import { useRestora } from '../../../lib/store'
import { Card, NextAction, Bars, ReportShell } from './Common.jsx'

function BuyingReport({ range }) {
  const { state, setScreen } = useRestora()
  const [filterStatus, setFilterStatus] = useState('all')
  const reports = useMemo(() => buildReports(state, range), [state, range])
  const { purchases } = reports

  const inventoryById = useMemo(() => Object.fromEntries((state.inventory || []).map((i) => [i.id, i])), [state.inventory])

  const supplierBars = useMemo(() => {
    return purchases.bySupplier.slice(0, 8).map((row) => ({
      label: row.name,
      value: row.value,
      sub: `${row.orders} order(s) · ${row.lines} line(s)`,
    }))
  }, [purchases.bySupplier])

  const topItems = useMemo(() => {
    return purchases.byItem.slice(0, 10).map((row) => {
      const invItem = inventoryById[row.itemId]
      const currentCost = Number(invItem?.lastCost) || row.unitCost
      const costDiff = row.unitCost && currentCost ? (row.unitCost - currentCost) / currentCost : 0
      return {
        ...row,
        unit: invItem?.unit || 'units',
        costDiff,
      }
    })
  }, [purchases.byItem, inventoryById])

  const allOrders = useMemo(() => {
    const list = []
    for (const po of state.purchases || []) {
      const isReceived = po.status === 'received'
      const isPending = ['ordered', 'draft'].includes(po.status)
      list.push({
        id: po.id,
        number: po.number || po.id,
        vendor: po.vendor || (state.suppliers || []).find((s) => s.id === po.supplierId)?.name || 'Unknown vendor',
        status: po.status,
        date: po.receivedAt || po.expectedAt || po.createdAt,
        total: Number(po.totals?.total) || 0,
        linesCount: po.lines?.length || 0,
        isPending,
        isReceived,
      })
    }
    return list.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
  }, [state.purchases, state.suppliers])

  const filteredOrders = useMemo(() => {
    if (filterStatus === 'received') return allOrders.filter((o) => o.status === 'received')
    if (filterStatus === 'pending') return allOrders.filter((o) => ['ordered', 'draft'].includes(o.status))
    return allOrders.slice(0, 12)
  }, [allOrders, filterStatus])

  return (
    <ReportShell
      title="Buying & Purchases"
      source={`Vendor spend, purchase orders, and cost variance for ${reports.bounds.label}.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-zinc-100">{money(purchases.spend)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Total Spend · {reports.bounds.label}
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            {purchases.orders} received PO(s) + {purchases.quickReceipts} quick receipt(s)
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-amber-300">{money(purchases.openValue)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Still on Order
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            {purchases.openOrders.length} pending purchase orders in pipeline
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-zinc-100">
            {Math.round(purchases.units * 10) / 10}
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Units Received
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">across all inventory lines</div>
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold text-zinc-100">
            {purchases.bySupplier.length}
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Suppliers Paid
          </div>
          <div className="mt-1.5 text-xs text-zinc-400">
            active vendor partnerships
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title="Spend by Supplier">
          {supplierBars.length > 0 ? (
            <Bars rows={supplierBars} />
          ) : (
            <p className="text-sm text-zinc-500">No purchase receipts in this window.</p>
          )}
          <NextAction onGo={() => setScreen('suppliers')} goLabel="Suppliers →">
            {purchases.bySupplier.length
              ? `Top vendor: ${purchases.bySupplier[0]?.name} (${money(purchases.bySupplier[0]?.value)})`
              : 'Add suppliers and payment terms to track purchasing.'}
          </NextAction>
        </Card>

        <Card title="Top Purchased Items & Ingredient Cost">
          {topItems.length > 0 ? (
            <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-[var(--color-ink-700)]">
              <table className="w-full">
                <thead className="bg-black/30">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Item</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Qty</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Unit Cost</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-ink-800)] text-sm">
                  {topItems.map((item) => (
                    <tr key={item.itemId}>
                      <td className="px-3 py-2 text-zinc-200">
                        <div className="font-medium">{item.name}</div>
                        {Math.abs(item.costDiff) > 0.05 && (
                          <div className={`text-[10px] ${item.costDiff > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {item.costDiff > 0 ? '▲ +' : '▼ '}{Math.round(item.costDiff * 100)}% vs last cost
                          </div>
                        )}
                      </td>
                      <td className="tnum px-3 py-2 text-right text-zinc-400">
                        {Math.round(item.qty * 10) / 10} {item.unit}
                      </td>
                      <td className="tnum px-3 py-2 text-right text-zinc-300">
                        {money(item.unitCost)}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-semibold text-zinc-100">
                        {money(item.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No item line data for this range.</p>
          )}
          <NextAction onGo={() => setScreen('costing')} goLabel="Costing →">
            Keep plate recipe costs synced with incoming supplier invoice pricing.
          </NextAction>
        </Card>
      </div>

      <Card title="Purchase Orders Ledger">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-xl bg-black/40 p-1 ring-1 ring-inset ring-[var(--color-ink-700)]">
            {[
              { id: 'all', label: 'All Orders' },
              { id: 'received', label: 'Received' },
              { id: 'pending', label: 'In Transit / Draft' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterStatus(tab.id)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                  filterStatus === tab.id
                    ? 'bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setScreen('purchases')}
            className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-500/40 hover:bg-amber-500/25"
          >
            + New PO in Purchases
          </button>
        </div>

        {filteredOrders.length > 0 ? (
          <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-[var(--color-ink-700)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/30">
                <tr>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">PO Number</th>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Vendor</th>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Lines</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-ink-800)]">
                {filteredOrders.map((po) => (
                  <tr key={po.id}>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-200">{po.number}</td>
                    <td className="px-3 py-2 text-zinc-300">{po.vendor}</td>
                    <td className="px-3 py-2">
                      <StatusPill
                        tone={po.status === 'received' ? 'ok' : po.status === 'ordered' ? 'warn' : 'muted'}
                        size="sm"
                      >
                        {po.status}
                      </StatusPill>
                    </td>
                    <td className="tnum px-3 py-2 text-right text-zinc-400">{po.linesCount}</td>
                    <td className="tnum px-3 py-2 text-right font-semibold text-zinc-100">{money(po.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No purchase orders matching this filter.</p>
        )}
      </Card>
    </ReportShell>
  )
}

export { BuyingReport }
