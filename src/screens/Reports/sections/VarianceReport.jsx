import { useMemo } from 'react'
import StatusPill from '../../../components/StatusPill'
import { money, theoreticalDecrementFor } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { Card, NextAction, Bars, ReportShell } from './Common.jsx'

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
    <ReportShell title="Variance" source="Theoretical usage from fired lines versus logged waste — where stock leaks.">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Theoretical usage', value: money(usageTotal), sub: 'fired lines × recipes' },
          { label: 'Logged waste', value: money(wasteTotal), sub: `${state.wasteLog.length} entries` },
          { label: 'Negative SKUs', value: String(negatives.length), sub: negatives.length ? 'flags, never silent' : 'none — counts are sane' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
            <div className="tnum text-2xl font-bold">{k.value}</div>
            <div className="mt-1 text-2xs font-semibold uppercase tracking-widest text-zinc-500">{k.label}</div>
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
    </ReportShell>
  )
}


export { VarianceReport }
