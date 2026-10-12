// ─── Step 4: Kitchen — KDS ──────────────────────────────────────────
// Kim (kitchen lead) cooks from tickets, not paper. Station columns
// show only their items; expo sees the whole table. Age is color +
// word against the 18-min SLA. Bump is final except 60s recall.
// The 86 board writes through to the floor composer instantly.

import { useMemo, useState } from 'react'
import StatusPill from '../components/StatusPill'
import { STATIONS, STATION_META, TARGETS } from '../lib/constants'
import { formatClock, formatElapsed, secondsBetween, ticketAgeState } from '../lib/models'
import { useNow, useRestora } from '../lib/store'

const AGE_TONE = { 'on-time': 'ok', warning: 'warn', late: 'bad' }
const AGE_LABEL = { 'on-time': 'On time', warning: 'Warning', late: 'Late' }

function ageOf(firedAt, now) {
  return { secs: secondsBetween(firedAt, now), state: ticketAgeState(firedAt, now) }
}

// ─── Ticket card ────────────────────────────────────────────────
// One card = one order's fired lines for this column. Oldest first.

function TicketCard({ order, tableName, server, lines, now }) {
  const { dispatch } = useRestora()
  const oldest = lines.reduce((a, b) => (new Date(a.firedAt) < new Date(b.firedAt) ? a : b))
  const cardAge = ageOf(oldest.firedAt, now)
  const firedLines = lines.filter((l) => l.status === 'fired')

  function bumpAll() {
    for (const l of firedLines) dispatch({ type: 'BUMP_ITEM', orderId: order.id, itemId: l.id })
  }

  return (
    <article
      className={`rounded-xl border bg-[var(--color-ink-900)] ${
        cardAge.state === 'late'
          ? 'border-red-500/60 ring-1 ring-red-500/40'
          : cardAge.state === 'warning'
            ? 'border-amber-500/50'
            : 'border-[var(--color-ink-700)]'
      }`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">
            {tableName} <span className="font-normal text-zinc-500">· {server}</span>
          </div>
          <div className="text-[11px] text-zinc-500">fired {formatClock(oldest.firedAt)}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`tnum text-lg font-bold leading-none ${cardAge.state === 'late' ? 'text-red-300' : cardAge.state === 'warning' ? 'text-amber-300' : 'text-zinc-100'}`}>
            {formatElapsed(cardAge.secs)}
          </span>
          <StatusPill tone={AGE_TONE[cardAge.state]} size="sm">
            {AGE_LABEL[cardAge.state]}
          </StatusPill>
        </div>
      </header>

      <ul className="divide-y divide-white/5">
        {lines.map((l) => {
          const a = ageOf(l.firedAt, now)
          const isNew = a.secs < 45
          return (
            <li key={l.id} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug text-zinc-100">
                    {l.qty}× {l.name}
                    {isNew && (
                      <span className="animate-status-in ml-1.5 rounded bg-sky-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-sky-300 ring-1 ring-inset ring-sky-500/40">
                        NEW
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-zinc-400">
                    <span className="rounded bg-black/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide">{l.course}</span>
                    {(l.modifiers || []).map((m) => (
                      <span key={m.id} className="rounded bg-black/40 px-1.5 py-0.5">{m.value}</span>
                    ))}
                    {l.notes && <span className="italic">“{l.notes}”</span>}
                    {l.comped && <span className="font-semibold text-amber-300">COMP</span>}
                  </div>
                </div>
                <span className={`tnum shrink-0 text-xs ${a.state === 'late' ? 'font-bold text-red-300' : 'text-zinc-500'}`}>
                  {formatElapsed(a.secs)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: 'BUMP_ITEM', orderId: order.id, itemId: l.id })}
                className="mt-2 min-h-[44px] w-full rounded-lg bg-emerald-500/90 text-sm font-bold text-black transition-colors hover:bg-emerald-400 active:scale-[0.99]"
              >
                Bump {l.name}
              </button>
            </li>
          )
        })}
      </ul>

      {firedLines.length > 1 && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={bumpAll}
            className="min-h-[44px] w-full rounded-lg border border-emerald-500/50 text-sm font-bold text-emerald-300 hover:bg-emerald-500/10"
          >
            Bump all ({firedLines.length})
          </button>
        </div>
      )}
    </article>
  )
}

// ─── 86 board ───────────────────────────────────────────────────

function EightySixBoard() {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const off = state.menu.filter((m) => !m.available)
  const on = state.menu.filter((m) => m.available)
  const outStock = state.inventory.filter((i) => i.onHand <= 0)

  return (
    <div className="grid gap-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-red-300">
          86&apos;d now · {off.length}
        </h3>
        {off.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">Full menu available. Floor can sell everything.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {off.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-ink-900)] p-2.5 ring-1 ring-inset ring-red-500/20">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">{m.name}</div>
                  <div className="text-[11px] text-zinc-500">
                    {m.substituteId && menuById[m.substituteId]
                      ? `Floor suggests ${menuById[m.substituteId].name}`
                      : 'No substitute — floor sees 86 with no fallback'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_86', menuItemId: m.id, available: true })}
                  className="min-h-[44px] shrink-0 rounded-lg bg-emerald-500/90 px-4 text-sm font-bold text-black hover:bg-emerald-400"
                >
                  Back on
                </button>
              </li>
            ))}
          </ul>
        )}
        {outStock.length > 0 && (
          <div className="mt-3 rounded-xl bg-black/30 p-2.5 text-xs text-zinc-400 ring-1 ring-inset ring-[var(--color-ink-700)]">
            <span className="font-semibold text-zinc-200">Stock-outs hitting recipes: </span>
            {outStock.map((i) => {
              const dishes = state.menu.filter((m) =>
                state.recipes[m.id]?.ingredients.some((ing) => ing.inventoryItemId === i.id),
              )
              return `${i.name} → ${dishes.map((d) => d.name).join(', ') || '—'}`
            }).join(' · ')}
            <span className="text-zinc-500"> (receiving lands in step 5)</span>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          86 a dish · writes to floor instantly
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {on.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => dispatch({ type: 'SET_86', menuItemId: m.id, available: false })}
              className="min-h-[44px] rounded-xl border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-2.5 py-2 text-left transition-colors hover:border-red-500/50"
            >
              <div className="truncate text-sm font-semibold text-zinc-200">{m.name}</div>
              <div className="text-[11px] text-zinc-500">tap to 86</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function KitchenScreen() {
  const { state, dispatch } = useRestora()
  const now = useNow(1000)
  const [lateOnly, setLateOnly] = useState(false)
  const offCount = state.menu.filter((m) => !m.available).length
  const [boardOpen, setBoardOpen] = useState(offCount > 0)

  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const tableById = useMemo(() => Object.fromEntries(state.tables.map((t) => [t.id, t])), [state.tables])

  // All fired, un-bumped, un-voided lines across open tickets
  const fired = useMemo(() => {
    const rows = []
    for (const order of state.orders) {
      if (['paid', 'void'].includes(order.status)) continue
      for (const item of order.items) {
        if (item.status !== 'fired' || item.voided || !item.firedAt) continue
        rows.push({
          order,
          tableName: tableById[order.tableId]?.name || order.type,
          server: order.serverId === 'server' ? 'Jordan' : order.serverId,
          item,
          name: menuById[item.menuItemId]?.name || 'Unknown',
        })
      }
    }
    return rows
  }, [state.orders, tableById, menuById])

  const lateCount = fired.filter((r) => ticketAgeState(r.item.firedAt, now) === 'late').length
  const avgAge = fired.length
    ? Math.round(fired.reduce((s, r) => s + secondsBetween(r.item.firedAt, now), 0) / fired.length)
    : 0
  const bumpedToday = state.orders.flatMap((o) => o.items).filter((i) => i.status === 'bump').length

  // Columns: stations see own items; expo sees the whole table
  const columns = useMemo(() => {
    const match = lateOnly
      ? (r) => ticketAgeState(r.item.firedAt, now) === 'late'
      : () => true
    return STATIONS.map((station) => {
      const rows = fired.filter((r) =>
        station === 'expo' ? match(r) : r.item.station === station && match(r),
      )
      // Group by order, oldest card first
      const byOrder = new Map()
      for (const r of rows) {
        if (!byOrder.has(r.order.id)) byOrder.set(r.order.id, { order: r.order, tableName: r.tableName, server: r.server, lines: [] })
        byOrder.get(r.order.id).lines.push({ ...r.item, name: r.name })
      }
      const cards = [...byOrder.values()]
        .map((c) => ({ ...c, lines: c.lines.sort((a, b) => new Date(a.firedAt) - new Date(b.firedAt)) }))
        .sort((a, b) => new Date(a.lines[0].firedAt) - new Date(b.lines[0].firedAt))
      return { station, cards, count: rows.length }
    })
  }, [fired, lateOnly, now])

  // Recall strip: bumped within the 60s window
  const recallable = useMemo(() => {
    const rows = []
    for (const order of state.orders) {
      if (['paid', 'void'].includes(order.status)) continue
      for (const item of order.items) {
        const key = `${order.id}:${item.id}`
        if (item.status === 'bump' && state.recalls[key] && state.recalls[key] > now) {
          rows.push({ order, item, name: menuById[item.menuItemId]?.name || 'item', left: Math.ceil((state.recalls[key] - now) / 1000) })
        }
      }
    }
    return rows.sort((a, b) => a.left - b.left)
  }, [state.orders, state.recalls, menuById, now])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
            Live · step 4 · kitchen: Kim · SLA {TARGETS.ticketMinutes}:00
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Kitchen</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLateOnly((v) => !v)}
            aria-pressed={lateOnly}
            className={`min-h-[44px] rounded-lg px-3.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              lateOnly ? 'bg-red-500 text-black ring-red-500' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'
            }`}
          >
            {lateOnly ? 'Showing late only' : 'Late only'}
          </button>
          <button
            type="button"
            onClick={() => setBoardOpen((v) => !v)}
            aria-expanded={boardOpen}
            className={`min-h-[44px] rounded-lg px-3.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              boardOpen ? 'bg-red-500/20 text-red-200 ring-red-500/50' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'
            }`}
          >
            86 board · {offCount}
          </button>
        </div>
      </header>

      {/* SLA strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: 'Fired now', value: String(fired.length), tone: 'info' },
          { label: `Late · ${fired.length ? Math.round((lateCount / fired.length) * 100) : 0}%`, value: String(lateCount), tone: lateCount ? 'bad' : 'ok' },
          { label: 'Avg age', value: formatElapsed(avgAge), tone: 'muted' },
          { label: 'Bumped today', value: String(bumpedToday), tone: 'ok' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3">
            <div className="tnum text-2xl font-bold">{s.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>

      {recallable.length > 0 && (
        <div className="animate-status-in rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-sky-300">
            Just bumped · tap to recall (60s window)
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {recallable.map((r) => (
              <button
                key={`${r.order.id}:${r.item.id}`}
                type="button"
                onClick={() => dispatch({ type: 'RECALL_ITEM', orderId: r.order.id, itemId: r.item.id })}
                className="min-h-[44px] rounded-lg bg-sky-500/15 px-3.5 text-sm font-semibold text-sky-200 ring-1 ring-inset ring-sky-500/40 hover:bg-sky-500/25"
              >
                ↩ {r.item.qty}× {r.name} · {r.left}s
              </button>
            ))}
          </div>
        </div>
      )}

      {boardOpen && <EightySixBoard />}

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-4" role="region" aria-label="Kitchen display columns">
        {columns.map(({ station, cards, count }) => {
          const hasLate = cards.some((c) => c.lines.some((l) => ticketAgeState(l.firedAt, now) === 'late'))
          return (
            <section key={station} className="w-[300px] min-w-[300px] flex-1" aria-label={`${STATION_META[station].label} station`}>
              <div className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 ring-1 ring-inset ${hasLate ? 'bg-red-500/10 ring-red-500/40' : 'bg-[var(--color-ink-900)] ring-[var(--color-ink-700)]'}`}>
                <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">
                  {STATION_META[station].label}
                  {station === 'expo' && <span className="ml-1.5 font-normal normal-case text-zinc-500">whole table</span>}
                </h2>
                <span className={`tnum rounded-full px-2 py-0.5 text-xs font-bold ${hasLate ? 'bg-red-500/20 text-red-200' : 'bg-black/40 text-zinc-400'}`}>
                  {count}
                </span>
              </div>
              <div className="max-h-[62vh] space-y-2.5 overflow-y-auto pr-0.5">
                {cards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[var(--color-ink-600)] p-5 text-center text-sm text-zinc-600">
                    {lateOnly ? 'No late tickets here.' : 'All clear.'}
                  </div>
                )}
                {cards.map((c) => (
                  <TicketCard key={`${station}-${c.order.id}`} order={c.order} tableName={c.tableName} server={c.server} lines={c.lines} now={now} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
