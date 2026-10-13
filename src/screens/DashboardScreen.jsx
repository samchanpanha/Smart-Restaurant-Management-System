// ─── Operations dashboard ──────────────────────────────────────────
// A fast shift overview: real live KPIs, sales history, actionable alerts,
// recent activity, and one-tap routes to the operational screens.

import { useMemo } from 'react'
import heroPhoto from '../assets/restora-hero.jpg'
import StatusPill from '../components/StatusPill'
import { TARGETS, ROLE_NAV } from '../lib/constants'
import { money } from '../lib/models'
import { LOCATIONS, getAlerts, getDashboard, useNow, useRestora } from '../lib/store'

const QUICK_ACTIONS = [
  { label: 'New order', detail: 'Start a check', icon: '+', screen: 'tickets', color: 'orange' },
  { label: 'View tables', detail: 'Open the floor', icon: '▦', screen: 'floor', color: 'green' },
  { label: 'Check inventory', detail: 'Review stock', icon: '▧', screen: 'inventory', color: 'blue' },
  { label: 'View reports', detail: 'Sales & service', icon: '▥', screen: 'reports', color: 'violet' },
  { label: 'Kitchen', detail: 'Monitor tickets', icon: '♨', screen: 'kitchen', color: 'orange' },
  { label: 'Food cost', detail: 'Review margins', icon: '◈', screen: 'costing', color: 'green' },
]

const ACTION_COLOR = {
  orange: 'bg-orange-50 text-orange-600 ring-orange-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  blue: 'bg-sky-50 text-sky-700 ring-sky-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
}

function MetricCard({ icon, label, value, foot, tone = 'orange', progress }) {
  const tones = {
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700',
    violet: 'bg-violet-50 text-violet-700',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <section className="min-h-[150px] rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold ${tones[tone]}`}>{icon}</span>
        <div className="min-w-0 text-xs font-medium leading-tight text-zinc-500">{label}</div>
      </div>
      <div className="tnum mt-3 text-[27px] font-bold leading-none tracking-tight text-zinc-900">{value}</div>
      {progress != null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>}
      <div className="mt-2 text-[11px] leading-snug text-zinc-500">{foot}</div>
    </section>
  )
}

function SalesBars({ history, today }) {
  const rows = [...history.slice(-7).map((entry) => ({ label: entry.day, value: entry.sales })), { label: 'Today', value: today }]
  const maximum = Math.max(1, ...rows.map((row) => row.value))
  return (
    <div className="flex h-[190px] items-end gap-2 border-b border-zinc-100 px-1 pb-2 sm:gap-3">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
          <div className="flex h-full w-full items-end justify-center">
            <div
              title={`${row.label}: ${money(row.value)}`}
              className={`w-full max-w-8 rounded-t-md transition-all ${index === rows.length - 1 ? 'bg-orange-500' : 'bg-orange-400/80'}`}
              style={{ height: `${Math.max(5, (row.value / maximum) * 100)}%` }}
            />
          </div>
          <span className="max-w-full truncate text-[10px] text-zinc-500">{row.label}</span>
        </div>
      ))}
    </div>
  )
}

function relativeTime(value) {
  if (!value) return 'recently'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} hr ago`
}

function activityRows(state) {
  const tableById = Object.fromEntries(state.tables.map((table) => [table.id, table]))
  return [...state.orders]
    .filter((order) => order.status !== 'void')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map((order) => ({
      id: order.id,
      title: `${order.status === 'paid' ? 'Order completed' : 'New order'} ${String(order.id).replace(/\D/g, '').slice(-4) ? `#${String(order.id).replace(/\D/g, '').slice(-4)}` : ''}`,
      detail: `${tableById[order.tableId]?.name || order.type} · ${order.items.filter((item) => !item.voided).length} items · ${order.status.replace('_', ' ')}`,
      at: order.updatedAt || order.createdAt,
      icon: order.status === 'ready' || order.status === 'paid' ? '✓' : '▤',
      tone: order.status === 'ready' || order.status === 'paid' ? 'green' : 'orange',
    }))
}

export default function DashboardScreen() {
  const { state, empire, setScreen, role, locId, setLocId } = useRestora()
  const now = useNow(15000)
  const dash = useMemo(() => getDashboard(state), [state])
  const alerts = useMemo(() => getAlerts(state), [state])
  const empireDash = useMemo(
    () => LOCATIONS.map((location) => ({ ...location, dash: getDashboard(empire.locations[location.id]) })),
    [empire],
  )

  const totalTables = state.tables.length
  const occupiedTables = state.tables.filter((table) => ['seated', 'ordered', 'billed'].includes(table.status)).length
  const activeOrders = state.orders.filter((order) => !['paid', 'void'].includes(order.status)).length
  const delayedOrders = alerts.filter((alert) => alert.type === 'late_ticket').length
  const averagePrep = dash.avgTicketMin ? `${Math.round(dash.avgTicketMin)} min` : '—'
  const occupancy = totalTables ? Math.round((occupiedTables / totalTables) * 100) : 0
  const date = new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
  const greeting = new Date(now).getHours() < 12 ? 'Good morning' : new Date(now).getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const alert = alerts[0]
  const recent = activityRows(state)
  const availableActions = QUICK_ACTIONS.filter((action) => (ROLE_NAV[role] || ROLE_NAV.owner).includes(action.screen))
  const alertScreen = alert?.type === 'late_ticket' ? 'kitchen'
    : alert?.type === 'low_stock' ? 'inventory'
      : alert?.type === 'negative_margin' ? 'costing'
        : alert?.type === 'bill_request' ? 'tickets'
          : alert?.type === 'long_turn' || alert?.type === 'call_server' ? 'floor'
            : alert?.type === '86' && alert.key.startsWith('out_') ? 'inventory' : 'kitchen'

  function goTo(screen) {
    setScreen(screen)
  }

  return (
    <div className="space-y-5">
      <section
        className="relative isolate flex min-h-[220px] items-center overflow-hidden rounded-2xl bg-zinc-900 bg-cover bg-center px-7 py-8 text-white shadow-sm sm:min-h-[250px] sm:px-9"
        style={{ backgroundImage: `linear-gradient(90deg, rgba(18,17,16,.82) 0%, rgba(18,17,16,.55) 42%, rgba(18,17,16,.05) 100%), url(${heroPhoto})` }}
      >
        <div className="max-w-xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/20 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> LIVE SHIFT · {state.settings.restaurantName || 'RESTORA'}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-[38px]">{greeting}, <span className="text-orange-400">{role === 'owner' ? 'Maya' : role}</span></h1>
          <p className="mt-2 max-w-lg text-sm text-white/85 sm:text-base">Here&apos;s what&apos;s happening at your restaurant today.</p>
          <div className="mt-5 flex items-center gap-2 text-xs font-medium text-white/90"><span aria-hidden="true">▦</span>{date}<span className="mx-1 text-white/50">·</span>{LOCATIONS.find((item) => item.id === locId)?.short}</div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <MetricCard icon="▦" label="Occupied tables" value={<>{occupiedTables}<span className="ml-1 text-base font-medium text-zinc-400">/ {totalTables}</span></>} foot={`${occupancy}% occupancy`} progress={occupancy} tone="orange" />
        <MetricCard icon="▤" label="Active orders" value={activeOrders} foot={activeOrders ? 'In progress right now' : 'No open orders'} tone="green" />
        <MetricCard icon="◷" label="Avg. preparation time" value={averagePrep} foot={dash.avgTicketMin ? 'Fire to bump · tonight' : 'No completed kitchen timings yet'} tone="blue" />
        <MetricCard icon="$" label="Today’s revenue" value={money(dash.sales)} foot={`${dash.covers} covers · ${state.orders.filter((order) => order.status === 'paid').length} checks`} tone="violet" />
        <MetricCard icon="!" label="Delayed orders" value={delayedOrders} foot={delayedOrders ? 'Needs attention' : 'Kitchen is on track'} tone={delayedOrders ? 'red' : 'green'} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <div className="grid items-stretch gap-4 lg:grid-cols-12">
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm lg:col-span-8">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div><h2 className="text-base font-bold text-zinc-900">Today&apos;s sales overview</h2><p className="mt-0.5 text-xs text-zinc-500">Daily close history and current shift revenue</p></div>
                <button type="button" onClick={() => goTo('reports')} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 hover:border-orange-200 hover:text-orange-600">View reports ↗</button>
              </div>
              <SalesBars history={state.salesHistory} today={dash.sales} />
              <div className="mt-3 flex items-center justify-between text-xs text-zinc-500"><span>Sales · last 7 days</span><span className="tnum font-semibold text-zinc-700">Today {money(dash.sales)}</span></div>
            </section>

            <section className="flex flex-col rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-[#fff3e8] p-5 shadow-sm lg:col-span-4">
              <div className="flex items-center gap-2 text-orange-700"><span className="text-xl" aria-hidden="true">♧</span><h2 className="text-sm font-bold">Insight for you</h2></div>
              {alert ? (
                <>
                  <div className="mt-5 flex items-start gap-2"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">!</span><div><div className="text-sm font-bold text-zinc-900">{alert.label}</div><p className="mt-1 text-xs leading-relaxed text-zinc-600">{alert.detail}</p></div></div>
                  <button type="button" onClick={() => goTo(alertScreen)} className="mt-auto min-h-10 rounded-xl bg-orange-500 px-4 text-left text-sm font-bold text-white shadow-sm hover:bg-orange-600">Open recommended screen <span className="float-right">→</span></button>
                </>
              ) : (
                <><div className="mt-5 text-sm font-bold text-zinc-900">Everything is running smoothly</div><p className="mt-1 text-xs leading-relaxed text-zinc-600">No urgent service or stock alerts at the moment.</p><button type="button" onClick={() => goTo('kitchen')} className="mt-auto min-h-10 rounded-xl bg-orange-500 px-4 text-left text-sm font-bold text-white shadow-sm hover:bg-orange-600">Open kitchen view <span className="float-right">→</span></button></>
              )}
            </section>
          </div>

          {role === 'owner' && (
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-bold text-zinc-900">Branch overview</h2><p className="mt-0.5 text-xs text-zinc-500">Tonight across your restaurant locations</p></div><span className="tnum text-sm font-bold text-orange-600">{money(empireDash.reduce((sum, item) => sum + item.dash.sales, 0))} combined</span></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {empireDash.map((item) => <button key={item.id} type="button" onClick={() => setLocId(item.id)} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${locId === item.id ? 'border-orange-300 bg-orange-50' : 'border-zinc-200 hover:border-orange-200 hover:bg-orange-50/40'}`}><span><span className="block text-sm font-bold text-zinc-800">{item.short}{locId === item.id && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-orange-600">Selected</span>}</span><span className="mt-1 block text-xs text-zinc-500">{item.dash.covers} covers · {Math.round(item.dash.occupancy * 100)}% occupied</span></span><span className="tnum text-sm font-bold text-zinc-800">{money(item.dash.sales)}</span></button>)}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-bold text-zinc-900">Quick overview</h2><p className="mt-0.5 text-xs text-zinc-500">Jump back into the daily operation</p></div></div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { id: 'floor', label: 'Tables', detail: `${occupiedTables} occupied · ${state.tables.filter((table) => table.status === 'free').length} available`, icon: '▦' },
                { id: 'tickets', label: 'Orders', detail: `${activeOrders} active tickets`, icon: '▤' },
                { id: 'kitchen', label: 'Kitchen', detail: `${delayedOrders} delayed orders`, icon: '♨' },
                { id: 'inventory', label: 'Inventory', detail: `${state.inventory.filter((item) => item.onHand < item.par).length} items below par`, icon: '▧' },
              ].filter((item) => (ROLE_NAV[role] || ROLE_NAV.owner).includes(item.id)).map((item) => <button key={item.id} type="button" onClick={() => goTo(item.id)} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 text-left transition hover:border-orange-300 hover:bg-orange-50/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-lg font-bold text-orange-600">{item.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-zinc-800">{item.label}</span><span className="mt-0.5 block truncate text-[11px] text-zinc-500">{item.detail}</span></span><span className="text-orange-500">›</span></button>)}
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:col-span-4">
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-bold text-zinc-900">Quick actions</h2><span className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-600">Shortcuts</span></div>
            <div className="grid grid-cols-2 gap-2">
              {availableActions.map((action) => <button key={action.screen} type="button" onClick={() => goTo(action.screen)} className="group flex min-h-[90px] flex-col items-start justify-between rounded-xl border border-zinc-200 p-3 text-left transition hover:border-orange-300 hover:bg-orange-50/50"><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold ring-1 ${ACTION_COLOR[action.color]}`}>{action.icon}</span><span><span className="block text-xs font-bold text-zinc-800">{action.label}</span><span className="mt-0.5 block text-[10px] text-zinc-500">{action.detail}</span></span></button>)}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold text-zinc-900">Recent activity</h2><button type="button" onClick={() => goTo('tickets')} className="text-xs font-semibold text-orange-600 hover:text-orange-700">View all →</button></div>
            {recent.length ? <ul className="divide-y divide-zinc-100">{recent.map((item) => <li key={item.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${item.tone === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-600'}`}>{item.icon}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-zinc-800">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-zinc-500">{item.detail}</span></span><span className="shrink-0 text-[10px] text-zinc-400">{relativeTime(item.at)}</span></li>)}</ul> : <p className="py-5 text-center text-sm text-zinc-500">Activity will appear here as the shift gets moving.</p>}
          </section>

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-zinc-900">Shift health</h2><StatusPill tone={dash.foodCost7d <= state.settings.foodCostCap ? 'ok' : 'warn'} size="sm">{dash.foodCost7d <= state.settings.foodCostCap ? 'On target' : 'Review'}</StatusPill></div>
            <div className="flex items-center justify-between text-xs text-zinc-500"><span>Food cost · 7-day</span><strong className="tnum text-zinc-800">{(dash.foodCost7d * 100).toFixed(1)}% / {(state.settings.foodCostCap * 100).toFixed(0)}%</strong></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"><div className={`h-full rounded-full ${dash.foodCost7d <= state.settings.foodCostCap ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(100, (dash.foodCost7d / Math.max(state.settings.foodCostCap, 0.01)) * 100)}%` }} /></div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500"><span>Average check band</span><strong className="text-zinc-800">${TARGETS.avgCheckLow}–${TARGETS.avgCheckHigh}</strong></div>
          </section>
        </aside>
      </div>

      {alert && <div className="sr-only" aria-live="polite">{alerts.length} alerts. Latest: {alert.label}</div>}
    </div>
  )
}
