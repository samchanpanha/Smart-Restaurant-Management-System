// ─── Step 1 hero: the object model, live ────────────────────────────
// Proves the spine before any module UI exists: status machines,
// timing rules, and the seed data every later step will operate on.

import { useState } from 'react'
import StatusPill from '../components/StatusPill'
import {
  MARGIN_BAND_META,
  TABLE_STATUS_META,
  TABLE_TRANSITIONS,
  TARGETS,
  TICKET_STATUS_META,
  TICKET_TRANSITIONS,
} from '../lib/constants'
import { useI18n } from '../lib/i18n'
import {
  canTableTransition,
  canTicketTransition,
  nextTableStatuses,
  reorderPointFor,
  stockStatusFor,
} from '../lib/models'
import { getAlerts, useRestora } from '../lib/store'

function Card({ title, sub, children }) {
  return (
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
      <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">{title}</h2>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function MachineDiagram({ transitions, meta }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Object.entries(transitions).map(([from, tos]) => (
        <div key={from} className="flex items-center gap-2">
          <StatusPill tone={meta[from]?.tone || 'muted'} size="sm">
            {meta[from]?.label || from}
          </StatusPill>
          {tos.length > 0 && (
            <span className="text-zinc-600" aria-hidden>
              →
            </span>
          )}
          {tos.map((to) => (
            <StatusPill key={`${from}-${to}`} tone={meta[to]?.tone || 'muted'} size="sm">
              {meta[to]?.label || to}
            </StatusPill>
          ))}
          <span className="mx-1 text-zinc-700" aria-hidden>
            ·
          </span>
        </div>
      ))}
    </div>
  )
}

function TableTester() {
  const statuses = Object.keys(TABLE_TRANSITIONS)
  const [from, setFrom] = useState('free')
  const [to, setTo] = useState('seated')
  const legal = canTableTransition(from, to)
  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4 ring-1 ring-inset ring-[var(--color-ink-600)]">
      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Transition tester
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-2.5 py-2 text-sm"
          aria-label="From status"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {TABLE_STATUS_META[s].label}
            </option>
          ))}
        </select>
        <span className="text-zinc-500">→</span>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-2.5 py-2 text-sm"
          aria-label="To status"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {TABLE_STATUS_META[s].label}
            </option>
          ))}
        </select>
        <StatusPill tone={legal ? 'ok' : 'bad'}>{legal ? 'Legal' : 'Blocked'}</StatusPill>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        From <strong className="text-zinc-300">{TABLE_STATUS_META[from].label}</strong> you may go
        to:{' '}
        {nextTableStatuses(from).length
          ? nextTableStatuses(from).map((s) => TABLE_STATUS_META[s].label).join(', ')
          : 'nowhere (terminal)'}
        . <span className="text-zinc-400">Reserved overlays free only.</span>
      </p>
    </div>
  )
}

export default function SystemScreen() {
  const { state } = useRestora()
  const { lang, dict } = useI18n()
  const sys = dict.system || {}
  const alerts = getAlerts(state)
  const openOrders = state.orders.filter((o) => !['paid', 'void'].includes(o.status))
  const outItems = state.inventory.filter((i) => stockStatusFor(i, state.settings) !== 'ok')
  const eightSix = state.menu.filter((m) => !m.available)

  const census = [
    { label: 'Tables', value: state.tables.length, note: '12–24 house · 16 seeded' },
    { label: 'Open tickets', value: openOrders.length, note: `${state.orders.length} total orders` },
    { label: 'Menu items', value: state.menu.length, note: `${eightSix.length} 86'd` },
    { label: 'Inventory SKUs', value: state.inventory.length, note: `${outItems.length} low/out` },
    { label: 'Reservations', value: state.reservations.length, note: `${state.waitlist.length} waiting` },
    { label: 'Live alerts', value: alerts.length, note: 'exceptions over averages' },
  ]

  return (
    <div className="space-y-6">
      <header>
        <div className="text-2xs font-semibold uppercase tracking-widest text-amber-300">
          {sys.kicker || 'Build step 1 · object model + status machines'}
          {lang !== 'en' && <span className="sr-only"> Build step 1 · object model + status machines</span>}
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {sys.title || 'System & Model'} · {state.settings.restaurantName}
          {lang !== 'en' && <span className="sr-only"> System &amp; Model</span>}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          {sys.subtitle || 'The ticket is the system of record — floor, kitchen, and inventory read the same order object.'}
        </p>
      </header>

      {/* Census */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {census.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4"
          >
            <div className="tnum text-3xl font-bold">{c.value}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              {c.label}
            </div>
            <div className="mt-0.5 text-2xs text-zinc-500">{c.note}</div>
          </div>
        ))}
      </div>

      {/* Machines */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Table status machine (strict)"
          sub="free → seated → ordered → billed → dirty → free · reserved overlays free"
        >
          <MachineDiagram transitions={TABLE_TRANSITIONS} meta={TABLE_STATUS_META} />
          <div className="mt-4">
            <TableTester />
          </div>
        </Card>
        <Card
          title="Ticket status machine"
          sub="open → sent → in_prep → ready → served → paid · void branches anywhere (manager)"
        >
          <MachineDiagram transitions={TICKET_TRANSITIONS} meta={TICKET_STATUS_META} />
          <div className="mt-4 rounded-xl bg-[var(--color-ink-800)] p-4 text-xs leading-relaxed text-zinc-400 ring-1 ring-inset ring-[var(--color-ink-600)]">
            <span className="font-semibold text-zinc-200">Item states</span> ride inside the
            ticket: <StatusPill tone="muted" size="sm">Held</StatusPill>{' '}
            <StatusPill tone="warn" size="sm">Fired</StatusPill>{' '}
            <StatusPill tone="ok" size="sm">Bumped</StatusPill>
            <p className="mt-2">
              Sending is the commit — 15-second undo, then the kitchen owns the item.{' '}
              <code className="rounded bg-black/40 px-1 font-mono text-2xs">
                canTicketTransition({'"sent", "paid"'})
              </code>{' '}
              →{' '}
              <strong className={canTicketTransition('sent', 'paid') ? 'text-emerald-300' : 'text-red-300'}>
                {String(canTicketTransition('sent', 'paid'))}
              </strong>{' '}
              (no skipping the pass).
            </p>
          </div>
        </Card>
      </div>

      {/* Timing rules + margin bands */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Timing rules" sub="Written on every inventory + KDS frame">
          <ul className="space-y-2.5 text-sm">
            {[
              ['Theoretical stock drops on FIRE', 'not on draft, not on pay'],
              [`Send undo window: ${TARGETS.undoSendSeconds}s`, 'kitchen owns the item after'],
              [`Bump recall: ${TARGETS.recallBumpSeconds}s`, 'then irreversible'],
              [`KDS target: ${TARGETS.ticketMinutes}:00`, `warn at ${TARGETS.ticketWarnRatio * 100}% · late at 100%`],
              [`Turn alert at ${TARGETS.turnAlertRatio * 100}% of target`, `default ${TARGETS.targetTurnMinutes}m 4-top`],
              [`No-show after ${TARGETS.noShowMinutes}m`, 'releases the reservation'],
            ].map(([a, b]) => (
              <li key={a} className="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-0">
                <span className="text-zinc-200">{a}</span>
                <span className="text-right text-xs text-zinc-500">{b}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Margin bands" sub="Contribution = (price − plate) ÷ price · food-cost target 28–32%">
          <div className="flex flex-wrap gap-2">
            {Object.entries(MARGIN_BAND_META).map(([band, meta]) => (
              <StatusPill key={band} tone={meta.tone}>
                {band} · {meta.label}
              </StatusPill>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">
            Plate cost uses <strong className="text-zinc-200">last invoice cost</strong>, never a
            static card. Spec check: Restora Burger $16.00 / plate $4.10 → 74.4% →{' '}
            <StatusPill tone="ok" size="sm">high</StatusPill>
          </p>
        </Card>
      </div>

      {/* Live seed browser */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`Floor now · ${state.tables.length} tables`} sub="Status color + word, always">
          <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
            {state.tables.map((t) => (
              <span
                key={t.id}
                title={`${t.name} · ${t.seats} seats · ${t.zone}`}
                className="inline-flex"
              >
                <StatusPill tone={TABLE_STATUS_META[t.status].tone} size="sm">
                  {t.name.replace('Table ', 'T')} · {TABLE_STATUS_META[t.status].label}
                </StatusPill>
              </span>
            ))}
          </div>
        </Card>
        <Card title={`Stock exceptions · ${outItems.length}`} sub="ok items hidden — exceptions over averages">
          {outItems.length === 0 ? (
            <p className="text-sm text-zinc-500">All SKUs at or above par.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {outItems.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">{i.name}</span>
                  <StatusPill tone={stockStatusFor(i, state.settings) === 'out' ? 'bad' : 'warn'} size="sm">
                    {stockStatusFor(i, state.settings)} · {i.onHand}/{reorderPointFor(i, state.settings)}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Live alerts · ${alerts.length}`} sub="Derived every render, never stored">
          {alerts.length === 0 ? (
            <p className="text-sm text-zinc-500">Quiet shift. No exceptions.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {alerts.slice(0, 12).map((a) => (
                <li key={a.key} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-zinc-200">{a.label}</div>
                    <div className="text-2xs text-zinc-500">{a.detail}</div>
                  </div>
                  <StatusPill tone={a.severity === 'high' ? 'bad' : 'warn'} size="sm">
                    {a.severity}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Spine */}
      <Card
        title="Friday-night spine — build complete"
        sub="All eight steps delivered. Every module hitches to one of these beats."
      >
        <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['1 · Model', 'Objects + machines (this screen)', true],
            ['2 · Floor', 'Seat parties, turn tables', true],
            ['3 · Tickets', 'Compose, send, undo, pay', true],
            ['4 · Kitchen', 'Fire, bump, 86 board', true],
            ['5 · Inventory', 'Receive, count, waste', true],
            ['6 · Dashboard', 'Shift health + alerts', true],
            ['7 · Costing', 'Recipes + menu matrix', true],
            ['8 · Reports', 'Sales, voids, P&L-lite', true],
          ].map(([step, label, done]) => (
            <li
              key={step}
              className={`rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset ${
                done
                  ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/30'
                  : 'bg-[var(--color-ink-800)] text-zinc-300 ring-[var(--color-ink-600)]'
              }`}
            >
              <div className="font-bold">{step}</div>
              <div className="text-xs opacity-80">{label}</div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}
