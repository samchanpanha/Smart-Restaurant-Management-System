import { useMemo } from 'react'
import StatusPill from '../../../components/StatusPill'
import { money, orderSubtotal } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { Card, NextAction, ReportShell } from './Common.jsx'

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
    <ReportShell title="Service" source="Tonight's live orders — server performance, table turns, and the slowest tables.">
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
    </ReportShell>
  )
}


export { ServiceReport }
