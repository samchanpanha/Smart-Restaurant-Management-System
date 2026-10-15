import { useMemo } from 'react'
import { money, orderSubtotal } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { Card, NextAction, Bars, ReportShell } from './Common.jsx'

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
    <ReportShell title="Voids & comps" source="Every void, comp, and reason — the leakage number and where it comes from.">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Voided', value: money(voidTotal), sub: `${voidOrders.length} checks · ${voidLines.length} lines` },
          { label: 'Comped', value: money(compTotal), sub: `${compLines.length} lines · ${sales ? ((compTotal / sales) * 100).toFixed(1) : 0}% of sales` },
          { label: 'Leakage', value: money(voidTotal + compTotal), sub: sales ? `${(((voidTotal + compTotal) / sales) * 100).toFixed(1)}% of sales` : 'no sales yet' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
            <div className="tnum text-2xl font-bold">{k.value}</div>
            <div className="mt-1 text-2xs font-semibold uppercase tracking-widest text-zinc-500">{k.label}</div>
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
    </ReportShell>
  )
}


export { VoidsReport }
