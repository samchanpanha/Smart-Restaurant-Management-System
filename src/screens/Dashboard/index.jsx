// ─── Operations dashboard ──────────────────────────────────────────
// A fast shift overview built from the design-system primitives and semantic
// tokens: the spec §9.1 KPI row, the alerts rail, sales trend vs last week,
// menu engineering, kitchen SLA, a floor snapshot, and the operational
// shortcuts. All numbers come from `getDashboard`/`getAlerts` — this screen
// never recomputes business logic.

import { useMemo } from 'react'
import { ROLE_NAV } from '../../lib/constants'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/models'
import { getAlerts, getDashboard, useNow, useRestora } from '../../lib/store'
import { OVERVIEW_SCREENS, QUICK_ACTIONS, activityRows, alertScreenFor, relativeTime } from './shared'
import Hero from './sections/Hero'
import KpiRow from './sections/KpiRow'
import SalesTrend from './sections/SalesTrend'
import AlertsRail from './sections/AlertsRail'
import MenuEngineering from './sections/MenuEngineering'
import KitchenSla from './sections/KitchenSla'
import FloorSnapshot from './sections/FloorSnapshot'
import QuickOverview from './sections/QuickOverview'
import QuickActions from './sections/QuickActions'
import RecentActivity from './sections/RecentActivity'
import ShiftHealth from './sections/ShiftHealth'
import BranchOverview from './sections/BranchOverview'
import AiInsight from './sections/AiInsight'
import ShiftBriefing from './sections/ShiftBriefing'
import { useAiStatus } from './useAiStatus'

export default function DashboardScreen() {
  const { state, empire, setScreen, role, locId, setLocId, locations, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const copy = dict.dashboard || {}
  const now = useNow(15000)
  const dash = useMemo(() => getDashboard(state), [state])
  const alerts = useMemo(() => getAlerts(state), [state])
  const ai = useAiStatus()
  const empireDash = useMemo(
    () => locations.map((location) => ({ ...location, dash: getDashboard(empire.locations[location.id]) })),
    [empire, locations],
  )

  const totalTables = state.tables.length
  const occupiedTables = state.tables.filter((table) => ['seated', 'ordered', 'billed'].includes(table.status)).length
  const freeTables = state.tables.filter((table) => table.status === 'free').length
  const activeOrders = state.orders.filter((order) => !['paid', 'void'].includes(order.status)).length
  const delayedOrders = alerts.filter((alert) => alert.type === 'late_ticket').length
  const lowStock = state.inventory.filter((item) => item.counted !== false && item.onHand < item.par).length
  const occupancy = totalTables ? Math.round((occupiedTables / totalTables) * 100) : 0
  const foodCostOnTarget = dash.foodCost7d <= state.settings.foodCostCap

  const localeTag = lang === 'km' ? 'km-KH' : lang === 'zh' ? 'zh-CN' : 'en-US'
  const date = new Date(now).toLocaleDateString(localeTag, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? copy.morning : hour < 17 ? copy.afternoon : copy.evening
  const roleLabel = role === 'owner' ? 'Maya' : (dict.roles?.[role] || role)
  const locationName = locations.find((item) => item.id === locId)?.short
  const recent = activityRows(state, lang, copy)
  const aiConfigured = Boolean(ai?.configured)
  const aiProvider = aiConfigured ? `${ai.provider} · ${ai.model}` : ''

  const hasSales = dash.checks > 0
  const lastClose = state.salesHistory.length ? state.salesHistory.at(-1).sales : null

  // Dashboard composition is owner-editable (Settings → Dashboard): the
  // sanitizer always ships the full layout, so blank/absent reads as
  // "shown" for any drift from an older snapshot.
  const dashCfg = state.settings.dashboard || {}
  const cardOn = (key) => dashCfg.cards?.[key] !== false
  const sectionOn = (key) => dashCfg.sections?.[key] !== false
  // "Customize" hops to Settings → Dashboard in this same tab (per-tab
  // sessionStorage handoff the settings screen consumes once on mount).
  const openCustomize = () => {
    try { sessionStorage.setItem('restora-settings-section', 'dashboard') } catch { /* default landing */ }
    setScreen('settings')
  }

  const tiles = [
    { id: 'sales', icon: 'wallet', label: copy.todaysRevenue, value: money(dash.sales), foot: copy.coversChecks(dash.covers, dash.checks), tone: 'accent', onClick: () => setScreen('reports') },
    { id: 'covers', icon: 'users', label: copy.coversLabel, value: dash.covers, foot: copy.ordersDetail(activeOrders), tone: 'info', onClick: () => setScreen('tickets') },
    { id: 'avgCheck', icon: 'costing', label: copy.avgCheckLabel, value: money(dash.avgCheck), foot: copy.avgCheckBand, tone: 'success' },
    { id: 'foodCost', icon: 'chart', label: copy.foodCost7d, value: `${(dash.foodCost7d * 100).toFixed(1)}%`, foot: foodCostOnTarget ? copy.onTarget : copy.review, tone: foodCostOnTarget ? 'success' : 'warning', progress: Math.min(100, (dash.foodCost7d / Math.max(state.settings.foodCostCap, 0.01)) * 100), onClick: () => setScreen('costing') },
    { id: 'occupancy', icon: 'tables', label: copy.occupancyLabel, value: `${occupancy}%`, foot: copy.tablesOccupied(occupiedTables, totalTables), tone: 'accent', progress: occupancy, onClick: () => setScreen('floor') },
  ].filter((tile) => cardOn(tile.id))

  const allowed = ROLE_NAV[role] || ROLE_NAV.owner
  const overviewItems = [
    { id: 'floor', label: copy.tablesCard, detail: copy.tablesDetail(occupiedTables, freeTables), icon: 'tables' },
    { id: 'tickets', label: copy.ordersCard, detail: copy.ordersDetail(activeOrders), icon: 'orders' },
    { id: 'kitchen', label: copy.kitchenCard, detail: copy.kitchenDetail(delayedOrders), icon: 'kitchen' },
    { id: 'inventory', label: copy.inventoryCard, detail: copy.inventoryDetail(lowStock), icon: 'inventory' },
  ].filter((item) => allowed.includes(item.id))

  const actions = QUICK_ACTIONS
    .filter((action) => !OVERVIEW_SCREENS.includes(action.screen) && allowed.includes(action.screen))

  const openAlert = (alert) => setScreen(alertScreenFor(alert))

  return (
    <div className="space-y-5">
      {dashCfg.heroEnabled !== false && (
        <Hero
          copy={copy}
          greeting={greeting}
          date={date}
          locationName={locationName}
          restaurantName={state.settings.restaurantName || 'RESTORA'}
          roleLabel={role === 'owner' && dashCfg.greetingName ? dashCfg.greetingName : roleLabel}
          subtitle={dashCfg.subtitle}
          showLivePill={dashCfg.showLivePill !== false}
          showMetaLine={dashCfg.showMetaLine !== false}
          heroImage={dashCfg.heroImage}
          showCustomize={allowed.includes('settings')}
          onCustomize={openCustomize}
        />
      )}

      {tiles.length > 0 && <KpiRow tiles={tiles} />}

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          {(sectionOn('salesTrend') || sectionOn('alertsRail')) && (
            <div className="grid items-stretch gap-4 lg:grid-cols-12">
              {sectionOn('salesTrend') && (
                <SalesTrend
                  copy={copy}
                  lang={lang}
                  history={state.salesHistory}
                  today={dash.sales}
                  lastClose={lastClose}
                  hasSales={hasSales}
                  onOpenReports={() => setScreen('reports')}
                />
              )}
              {sectionOn('alertsRail') && <AlertsRail copy={copy} lang={lang} alerts={alerts} onOpen={openAlert} />}
            </div>
          )}

          {sectionOn('aiAlerts') && (
            <AiInsight
              copy={copy}
              configured={aiConfigured}
              lang={lang}
              locId={locId}
              kind="alert"
              autoRun={alerts.length > 0}
              provider={aiProvider}
            />
          )}

          {sectionOn('menuEngineering') && (
            <MenuEngineering copy={copy} topSellers={dash.topSellers} bottomContribution={dash.bottomContribution} />
          )}

          {sectionOn('aiMenu') && (
            <AiInsight
              copy={copy}
              configured={aiConfigured}
              lang={lang}
              locId={locId}
              kind="menu"
              title={copy.aiMenuTitle}
              sub={copy.aiMenuSub}
              runLabel={copy.aiMenuRun}
              provider={aiProvider}
              testId="dashboard-ai-menu"
            />
          )}

          {(sectionOn('kitchenSla') || sectionOn('floorSnapshot')) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {sectionOn('kitchenSla') && <KitchenSla copy={copy} avgTicketMin={dash.avgTicketMin} />}
              {sectionOn('floorSnapshot') && (
                <FloorSnapshot copy={copy} tables={state.tables} occupied={occupiedTables} onOpenFloor={() => setScreen('floor')} />
              )}
            </div>
          )}

          {role === 'owner' && sectionOn('branchOverview') && (
            <BranchOverview copy={copy} locations={empireDash} locId={locId} onPick={setLocId} empire={empire} dispatch={dispatch} />
          )}

          {sectionOn('quickOverview') && <QuickOverview copy={copy} items={overviewItems} onOpen={setScreen} />}
        </div>

        <aside className="min-w-0 space-y-4 xl:col-span-4">
          {sectionOn('shiftBriefing') && (
            <ShiftBriefing
              copy={copy}
              configured={aiConfigured}
              lang={lang}
              locId={locId}
              provider={aiProvider}
            />
          )}
          {sectionOn('quickActions') && <QuickActions copy={copy} actions={actions} onOpen={setScreen} />}
          {sectionOn('aiForecast') && (
            <AiInsight
              copy={copy}
              configured={aiConfigured}
              lang={lang}
              locId={locId}
              kind="forecast"
              title={copy.aiForecastTitle}
              sub={copy.aiForecastSub}
              runLabel={copy.aiForecastRun}
              provider={aiProvider}
              testId="dashboard-ai-forecast"
            />
          )}
          {sectionOn('recentActivity') && (
            <RecentActivity copy={copy} items={recent} onViewAll={() => setScreen('tickets')} relTime={relativeTime} />
          )}
          {sectionOn('shiftHealth') && (
            <ShiftHealth copy={copy} foodCost7d={dash.foodCost7d} foodCostCap={state.settings.foodCostCap} />
          )}
        </aside>
      </div>

      {alerts[0] && <div className="sr-only" aria-live="polite">{alerts.length} alerts. Latest: {alerts[0].label}</div>}
    </div>
  )
}
