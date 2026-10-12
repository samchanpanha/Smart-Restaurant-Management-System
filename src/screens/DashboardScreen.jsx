// ─── Step 6: Dashboard ────────────────────────────────────────────
// Maya's one screen: shift health in under 15 seconds. KPIs, alert
// rail with tappable sources, sales trend, sellers vs losers,
// kitchen SLA, and a live floor snapshot. Quiet when the shift
// hasn't started — last close summary instead of blank charts.

import { useMemo } from 'react'
import StatusPill from '../components/StatusPill'
import { MARGIN_BAND_META, TABLE_STATUS_META, TARGETS } from '../lib/constants'
import { money } from '../lib/models'
import { LOCATIONS, getAlerts, getDashboard, useNow, useRestora } from '../lib/store'

function Card({ title, action, children }) {
  return (
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function GoButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[36px] shrink-0 rounded-lg border border-[var(--color-ink-600)] px-2.5 text-xs font-semibold text-zinc-300 hover:bg-white/5"
    >
      {children || 'Open →'}
    </button>
  )
}

// ─── Sparkline (hand-rolled SVG, no chart lib) ────────────────────

function SalesSpark({ history, tonight }) {
  const points = [...history.map((d) => ({ label: d.day, value: d.sales })), { label: 'Tonight', value: tonight }]
  const max = Math.max(...points.map((p) => p.value), 1)
  const min = Math.min(...points.map((p) => p.value), 0)
  const W = 560
  const H = 120
  const P = 8
  const x = (i) => P + (i * (W - 2 * P)) / (points.length - 1)
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P - 14)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Sales trend, tonight ${money(tonight)}`}>
        <path d={`${path} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`} fill="rgba(245,158,11,0.12)" />
        <path d={path} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r={i === points.length - 1 ? 4.5 : 3}
              fill={i === points.length - 1 ? '#f59e0b' : '#3a4256'}
              stroke={i === points.length - 1 ? '#0b0d12' : 'none'}
            />
            <text x={x(i)} y={H - 1} textAnchor="middle" fontSize="10" fill={i === points.length - 1 ? '#fbbf24' : '#71717a'}>
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
        <span>7-day history</span>
        <span className="tnum">tonight <strong className="text-amber-300">{money(tonight)}</strong></span>
      </div>
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { state, empire, dispatch, setScreen, role, locId, setLocId } = useRestora()
  useNow(15000) // late-ticket + turn alerts are time-derived

  const dash = useMemo(() => getDashboard(state), [state])
  const alerts = useMemo(() => getAlerts(state), [state])
  const empireDash = useMemo(
    () => LOCATIONS.map((l) => ({ ...l, dash: getDashboard(empire.locations[l.id]) })),
    [empire],
  )

  const paidCount = state.orders.filter((o) => o.status === 'paid').length
  const openCount = state.orders.filter((o) => !['paid', 'void'].includes(o.status)).length
  const notStarted = paidCount === 0 && openCount === 0
  const lastClose = state.salesHistory[state.salesHistory.length - 1]

  // Rush watch: 2h before configured rush, par exceptions get loud
  const hour = new Date().getHours()
  const rush = state.settings.rushHour
  const inRushWindow = hour >= rush - TARGETS.parAlertHoursBeforeRush && hour < rush + 4
  const parWatch = state.inventory.filter((i) => i.onHand < i.par)

  const avg7 = state.salesHistory.reduce((s, d) => s + d.sales, 0) / Math.max(1, state.salesHistory.length)
  const salesDelta = avg7 ? (dash.sales - avg7) / avg7 : 0

  const foodCap = state.settings.foodCostCap
  const foodTone = dash.foodCost7d <= foodCap ? 'ok' : dash.foodCost7d <= foodCap + 0.03 ? 'warn' : 'bad'
  const checkInBand = dash.avgCheck >= TARGETS.avgCheckLow && dash.avgCheck <= TARGETS.avgCheckHigh

  const occupiedTables = state.tables.filter((t) => ['seated', 'ordered', 'billed'].includes(t.status))

  function alertTarget(a) {
    if (a.type === 'late_ticket') return 'kitchen'
    if (a.type === 'long_turn') return 'floor'
    if (a.type === 'low_stock') return 'inventory'
    if (a.type === '86') return a.key.startsWith('out_') ? 'inventory' : 'kitchen'
    if (a.type === 'negative_margin') return 'costing'
    if (a.type === 'bill_request') return 'tickets'
    if (a.type === 'call_server') return 'floor'
    return 'system'
  }

  const kpis = [
    {
      label: "Today's sales",
      value: money(dash.sales),
      sub: `${paidCount} checks · ${salesDelta >= 0 ? '+' : ''}${Math.round(salesDelta * 100)}% vs 7-day avg`,
      tone: salesDelta >= 0 ? 'ok' : 'warn',
    },
    {
      label: 'Covers',
      value: String(dash.covers),
      sub: openCount ? `${openCount} open ticket${openCount === 1 ? '' : 's'} on the floor` : 'floor clear',
      tone: 'muted',
    },
    {
      label: 'Average check',
      value: paidCount ? money(dash.avgCheck) : '—',
      sub: `house band $${TARGETS.avgCheckLow}–$${TARGETS.avgCheckHigh}${paidCount ? (checkInBand ? ' · in band' : ' · off band') : ''}`,
      tone: !paidCount ? 'muted' : checkInBand ? 'ok' : 'warn',
    },
    {
      label: 'Food cost · 7-day',
      value: `${(dash.foodCost7d * 100).toFixed(1)}%`,
      sub: `tonight ${(dash.tonightCostPct * 100).toFixed(1)}% · cap ${(foodCap * 100).toFixed(0)}%`,
      tone: foodTone,
    },
    {
      label: 'Occupancy',
      value: `${Math.round(dash.occupancy * 100)}%`,
      sub: `${occupiedTables.length} of ${state.tables.length} tables turning`,
      tone: dash.occupancy > 0.85 ? 'warn' : 'muted',
    },
  ]

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
            Live · step 6 · owner: Maya
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <div className="text-xs text-zinc-500">
          {new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
          {' · '}rush watch from {rush - TARGETS.parAlertHoursBeforeRush}:00
        </div>
      </header>

      {notStarted ? (
        <Card title="Shift not started">
          <div className="py-6 text-center">
            <div className="text-xl font-bold">No sales yet today.</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
              Last close ({lastClose?.day}): {money(lastClose?.sales || 0)} at{' '}
              {((lastClose?.foodCostPct || 0) * 100).toFixed(1)}% food cost. Seat the first party on
              the Floor and this screen comes alive.
            </p>
            <button
              type="button"
              onClick={() => setScreen('floor')}
              className="mx-auto mt-4 block min-h-[44px] rounded-lg bg-amber-500 px-6 text-sm font-bold text-black hover:bg-amber-400"
            >
              Go to Floor
            </button>
          </div>
        </Card>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
                <div className="tnum text-[28px] font-bold leading-none tracking-tight">{k.value}</div>
                <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{k.label}</div>
                <div className="mt-1">
                  <StatusPill tone={k.tone} size="sm">{k.sub}</StatusPill>
                </div>
              </div>
            ))}
          </div>

          {role === 'owner' && (
            <Card
              title="Across locations · tonight"
              action={
                <span className="tnum text-sm font-bold text-amber-300">
                  {money(empireDash.reduce((s, r) => s + r.dash.sales, 0))} combined
                </span>
              }
            >
              <ul className="space-y-2">
                {empireDash.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setLocId(r.id)}
                      aria-current={locId === r.id}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left ring-1 ring-inset transition-colors ${
                        locId === r.id
                          ? 'bg-amber-500/10 ring-amber-500/40'
                          : 'bg-[var(--color-ink-800)] ring-[var(--color-ink-600)] hover:bg-white/5'
                      }`}
                    >
                      <span className="text-sm font-bold text-zinc-100">
                        {r.short}
                        {locId === r.id && <span className="ml-2 text-[11px] font-normal text-amber-300">viewing</span>}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <StatusPill tone="muted" size="sm">{money(r.dash.sales)} sales</StatusPill>
                        <StatusPill tone="muted" size="sm">{r.dash.covers} covers</StatusPill>
                        <StatusPill tone={r.dash.foodCost7d <= foodCap ? 'ok' : 'warn'} size="sm">
                          FC {(r.dash.foodCost7d * 100).toFixed(1)}%
                        </StatusPill>
                        <StatusPill tone="info" size="sm">{Math.round(r.dash.occupancy * 100)}% occ</StatusPill>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {inRushWindow && parWatch.length > 0 && (
            <div className="animate-status-in rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-amber-200">
                  Rush watch · {parWatch.length} SKU{parWatch.length === 1 ? '' : 's'} below par before the {rush}:00 rush
                </div>
                <GoButton onClick={() => setScreen('inventory')}>Inventory →</GoButton>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parWatch.slice(0, 10).map((i) => (
                  <StatusPill key={i.id} tone={i.onHand <= 0 ? 'bad' : 'warn'} size="sm">
                    {i.name} · {i.onHand}/{i.par}
                  </StatusPill>
                ))}
              </div>
            </div>
          )}

          <div className="grid items-start gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <Card title="Sales vs last 7 days">
                <SalesSpark history={state.salesHistory} tonight={dash.sales} />
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Top 5 sellers" action={<GoButton onClick={() => setScreen('reports')}>Reports →</GoButton>}>
                  {dash.topSellers.length === 0 ? (
                    <p className="text-sm text-zinc-500">Nothing sold yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {dash.topSellers.map((r, i) => (
                        <li key={r.menu.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-zinc-200">
                            <span className="tnum mr-2 text-zinc-500">{i + 1}.</span>
                            {r.menu.name}
                          </span>
                          <span className="tnum shrink-0 font-bold">×{r.qty}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Bottom 5 contribution" action={<GoButton onClick={() => setScreen('costing')}>Costing →</GoButton>}>
                  {dash.bottomContribution.length === 0 ? (
                    <p className="text-sm text-zinc-500">Nothing sold yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {dash.bottomContribution.map((r) => (
                        <li key={r.menu.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-zinc-200">{r.menu.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="tnum text-zinc-400">{(r.contribution * 100).toFixed(0)}%</span>
                            <StatusPill tone={MARGIN_BAND_META[r.band].tone} size="sm">{r.band}</StatusPill>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card title={`Kitchen SLA · target ${TARGETS.ticketMinutes}:00`} action={<GoButton onClick={() => setScreen('kitchen')}>KDS →</GoButton>}>
                  <div className="tnum text-3xl font-bold">
                    {dash.avgTicketMin ? `${Math.floor(dash.avgTicketMin)}:${String(Math.round((dash.avgTicketMin % 1) * 60)).padStart(2, '0')}` : '—'}
                    <span className="ml-2 text-sm font-normal text-zinc-500">avg fire→bump</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/50">
                    <div
                      className={`h-full rounded-full ${dash.avgTicketMin > TARGETS.ticketMinutes ? 'bg-red-400' : dash.avgTicketMin > TARGETS.ticketMinutes * TARGETS.ticketWarnRatio ? 'bg-amber-400' : 'bg-emerald-500/80'}`}
                      style={{ width: `${Math.min(100, (dash.avgTicketMin / TARGETS.ticketMinutes) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2">
                    <StatusPill tone={dash.openTickets ? 'info' : 'muted'} size="sm">
                      {dash.openTickets} open ticket{dash.openTickets === 1 ? '' : 's'}
                    </StatusPill>
                  </div>
                </Card>
                <Card title="Floor snapshot" action={<GoButton onClick={() => setScreen('floor')}>Floor →</GoButton>}>
                  <button
                    type="button"
                    onClick={() => setScreen('floor')}
                    className="grid w-full grid-cols-8 gap-1"
                    aria-label="Open floor map"
                  >
                    {state.tables.map((t) => (
                      <span
                        key={t.id}
                        title={`${t.name} · ${TABLE_STATUS_META[t.status].label}`}
                        className={`tnum flex aspect-square items-center justify-center rounded-md text-[10px] font-bold ring-1 ring-inset ${
                          t.status === 'free'
                            ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                            : t.status === 'dirty'
                              ? 'bg-red-500/15 text-red-300 ring-red-500/40'
                              : t.status === 'billed'
                                ? 'bg-amber-500/15 text-amber-300 ring-amber-500/40'
                                : t.status === 'reserved'
                                  ? 'bg-sky-500/15 text-sky-300 ring-sky-500/40'
                                  : 'bg-sky-500/10 text-sky-200 ring-sky-500/25'
                        }`}
                      >
                        {t.name.replace('Table ', '')}
                      </span>
                    ))}
                  </button>
                  <div className="mt-2 text-[11px] text-zinc-500">
                    {occupiedTables.length} turning · {state.tables.filter((t) => t.status === 'dirty').length} dirty · {state.tables.filter((t) => t.status === 'free').length} free
                  </div>
                </Card>
              </div>
            </div>

            {/* Alerts rail */}
            <Card title={`Alerts · ${alerts.length}`}>
              {alerts.length === 0 ? (
                <div className="py-6 text-center">
                  <div className="text-lg font-bold text-emerald-300">Quiet shift.</div>
                  <p className="mt-1 text-xs text-zinc-500">No late tickets, no par breaks, no losers. Enjoy it while it lasts.</p>
                </div>
              ) : (
                <ul className="max-h-[72vh] space-y-2 overflow-y-auto">
                  {alerts.map((a) => (
                    <li
                      key={a.key}
                      className={`rounded-xl p-3 ring-1 ring-inset ${a.severity === 'high' ? 'bg-red-500/5 ring-red-500/30' : 'bg-[var(--color-ink-800)] ring-[var(--color-ink-600)]'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold leading-snug text-zinc-100">{a.label}</div>
                          <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">{a.detail}</div>
                        </div>
                        <StatusPill tone={a.severity === 'high' ? 'bad' : 'warn'} size="sm">
                          {a.severity}
                        </StatusPill>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setScreen(alertTarget(a))}
                          className="min-h-[36px] flex-1 rounded-lg bg-white/5 px-2 text-xs font-bold text-zinc-200 ring-1 ring-inset ring-[var(--color-ink-600)] hover:bg-white/10"
                        >
                          Fix it →
                        </button>
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'DISMISS_ALERT', key: a.key })}
                          aria-label={`Dismiss ${a.label}`}
                          className="min-h-[36px] rounded-lg px-3 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
