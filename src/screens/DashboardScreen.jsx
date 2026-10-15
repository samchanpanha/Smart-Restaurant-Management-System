// ─── Operations dashboard ──────────────────────────────────────────
// A fast shift overview: real live KPIs, sales history, actionable alerts,
// recent activity, and one-tap routes to the operational screens.

import { useMemo } from 'react'
import heroPhoto from '../assets/restora-hero.jpg'
import StatusPill from '../components/StatusPill'
import { TARGETS, ROLE_NAV } from '../lib/constants'
import { translateTableName, translateTicketStatus, useI18n } from '../lib/i18n'
import { money } from '../lib/models'
import { LOCATIONS, getAlerts, getDashboard, useNow, useRestora } from '../lib/store'

const QUICK_ACTIONS = [
  { id: 'newOrder', label: 'New order', detail: 'Start a check', icon: '+', screen: 'tickets', color: 'orange' },
  { id: 'viewTables', label: 'View tables', detail: 'Open the floor', icon: '▦', screen: 'floor', color: 'green' },
  { id: 'checkInventory', label: 'Check inventory', detail: 'Review stock', icon: '▧', screen: 'inventory', color: 'blue' },
  { id: 'viewReports', label: 'View reports', detail: 'Sales & service', icon: '▥', screen: 'reports', color: 'violet' },
  { id: 'kitchen', label: 'Kitchen', detail: 'Monitor tickets', icon: '♨', screen: 'kitchen', color: 'orange' },
  { id: 'foodCost', label: 'Food cost', detail: 'Review margins', icon: '◈', screen: 'costing', color: 'green' },
]

const DASH_COPY = {
  km: {
    liveShift: 'វេនផ្ទាល់',
    morning: 'អរុណសួស្តី',
    afternoon: 'ទិវាសួស្តី',
    evening: 'សាយណ្ហសួស្តី',
    heroSubtitle: 'នេះគឺជាស្ថានភាពប្រតិបត្តិការភោជនីយដ្ឋានរបស់អ្នកថ្ងៃនេះ។',
    occupiedTables: 'តុមានភ្ញៀវ',
    occupancyPct: (pct) => `អត្រាភ្ញៀវ ${pct}%`,
    activeOrders: 'ការកម្មង់កំពុងដំណើរការ',
    inProgressNow: 'កំពុងរៀបចំឥឡូវនេះ',
    noOpenOrders: 'មិនមានការកម្មង់បើកទេ',
    avgPrepTime: 'រយៈពេលចម្អិនមធ្យម',
    fireToBump: 'ពីបញ្ជូនដល់រួចរាល់ · យប់នេះ',
    noTimingsYet: 'មិនទាន់មានទិន្នន័យពេលវេលាចម្អិន',
    todaysRevenue: 'ចំណូលថ្ងៃនេះ',
    coversChecks: (covers, checks) => `ភ្ញៀវ ${covers} នាក់ · វិក្កយបត្រ ${checks}`,
    delayedOrders: 'ការកម្មង់យឺតពេល',
    needsAttention: 'ត្រូវការការយកចិត្តទុកដាក់',
    kitchenOnTrack: 'ផ្ទះបាយដំណើរការទាន់ពេល',
    todaysSalesOverview: 'ទិដ្ឋភាពការលក់ថ្ងៃនេះ',
    dailyCloseHistory: 'ប្រវត្តិបិទបញ្ជីប្រចាំថ្ងៃ និងចំណូលវេនបច្ចុប្បន្ន',
    viewReportsBtn: 'មើលរបាយការណ៍ ↗',
    salesLast7Days: 'ការលក់ · ៧ ថ្ងៃចុងក្រោយ',
    todayLabel: 'ថ្ងៃនេះ',
    insightForYou: 'ព័ត៌មានសំខាន់សម្រាប់អ្នក',
    openRecommended: 'បើកទំព័រដែលណែនាំ',
    runningSmoothly: 'អ្វីៗដំណើរការដោយរលូន',
    noUrgentAlerts: 'មិនមានការជូនដំណឹងបន្ទាន់អំពីសេវាកម្ម ឬស្តុកទេ។',
    openKitchenView: 'បើកមើលផ្ទះបាយ',
    branchOverview: 'ទិដ្ឋភាពសាខា',
    acrossLocations: 'យប់នេះនៅគ្រប់សាខាភោជនីយដ្ឋានរបស់អ្នក',
    combined: 'សរុបរួម',
    selected: 'បានជ្រើសរើស',
    coversOccupied: (covers, pct) => `ភ្ញៀវ ${covers} នាក់ · មានភ្ញៀវ ${pct}%`,
    quickOverview: 'ទិដ្ឋភាពរហ័ស',
    jumpBack: 'ចូលទៅកាន់ប្រតិបត្តិការប្រចាំថ្ងៃភ្លាមៗ',
    tablesCard: 'តុ',
    tablesDetail: (occ, free) => `មានភ្ញៀវ ${occ} · ទំនេរ ${free}`,
    ordersCard: 'ការកម្មង់',
    ordersDetail: (n) => `សំបុត្រកំពុងដំណើរការ ${n}`,
    kitchenCard: 'ផ្ទះបាយ',
    kitchenDetail: (n) => `ការកម្មង់យឺត ${n}`,
    inventoryCard: 'ស្តុកទំនិញ',
    inventoryDetail: (n) => `${n} មុខទាបជាងកម្រិតកំណត់`,
    quickActions: 'សកម្មភាពរហ័ស',
    shortcuts: 'ផ្លូវកាត់',
    recentActivity: 'សកម្មភាពថ្មីៗ',
    viewAll: 'មើលទាំងអស់ →',
    noActivityYet: 'សកម្មភាពនឹងបង្ហាញនៅទីនេះនៅពេលវេនចាប់ផ្តើម។',
    shiftHealth: 'សុខភាពវេនការងារ',
    onTarget: 'តាមគោលដៅ',
    review: 'ពិនិត្យឡើងវិញ',
    foodCost7d: 'ថ្លៃដើមម្ហូប · ៧ ថ្ងៃ',
    avgCheckBand: 'កម្រិតវិក្កយបត្រមធ្យម',
    orderCompleted: 'ការកម្មង់បានបញ្ចប់',
    newOrderTitle: 'ការកម្មង់ថ្មី',
    itemsCount: (n) => `${n} មុខ`,
    actions: {
      newOrder: { label: 'ការកម្មង់ថ្មី', detail: 'ចាប់ផ្តើមវិក្កយបត្រ' },
      viewTables: { label: 'មើលតុ', detail: 'បើកប្លង់តុ' },
      checkInventory: { label: 'ពិនិត្យស្តុក', detail: 'ពិនិត្យបរិមាណស្តុក' },
      viewReports: { label: 'មើលរបាយការណ៍', detail: 'ការលក់ និងសេវាកម្ម' },
      kitchen: { label: 'ផ្ទះបាយ', detail: 'តាមដានសំបុត្រម្ហូប' },
      foodCost: { label: 'ថ្លៃដើមម្ហូប', detail: 'ពិនិត្យប្រាក់ចំណេញ' },
    },
  },
  en: {
    liveShift: 'LIVE SHIFT',
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
    heroSubtitle: "Here's what's happening at your restaurant today.",
    occupiedTables: 'Occupied tables',
    occupancyPct: (pct) => `${pct}% occupancy`,
    activeOrders: 'Active orders',
    inProgressNow: 'In progress right now',
    noOpenOrders: 'No open orders',
    avgPrepTime: 'Avg. preparation time',
    fireToBump: 'Fire to bump · tonight',
    noTimingsYet: 'No completed kitchen timings yet',
    todaysRevenue: 'Today’s revenue',
    coversChecks: (covers, checks) => `${covers} covers · ${checks} checks`,
    delayedOrders: 'Delayed orders',
    needsAttention: 'Needs attention',
    kitchenOnTrack: 'Kitchen is on track',
    todaysSalesOverview: "Today's sales overview",
    dailyCloseHistory: 'Daily close history and current shift revenue',
    viewReportsBtn: 'View reports ↗',
    salesLast7Days: 'Sales · last 7 days',
    todayLabel: 'Today',
    insightForYou: 'Insight for you',
    openRecommended: 'Open recommended screen',
    runningSmoothly: 'Everything is running smoothly',
    noUrgentAlerts: 'No urgent service or stock alerts at the moment.',
    openKitchenView: 'Open kitchen view',
    branchOverview: 'Branch overview',
    acrossLocations: 'Tonight across your restaurant locations',
    combined: 'combined',
    selected: 'Selected',
    coversOccupied: (covers, pct) => `${covers} covers · ${pct}% occupied`,
    quickOverview: 'Quick overview',
    jumpBack: 'Jump back into the daily operation',
    tablesCard: 'Tables',
    tablesDetail: (occ, free) => `${occ} occupied · ${free} available`,
    ordersCard: 'Orders',
    ordersDetail: (n) => `${n} active tickets`,
    kitchenCard: 'Kitchen',
    kitchenDetail: (n) => `${n} delayed orders`,
    inventoryCard: 'Inventory',
    inventoryDetail: (n) => `${n} items below par`,
    quickActions: 'Quick actions',
    shortcuts: 'Shortcuts',
    recentActivity: 'Recent activity',
    viewAll: 'View all →',
    noActivityYet: 'Activity will appear here as the shift gets moving.',
    shiftHealth: 'Shift health',
    onTarget: 'On target',
    review: 'Review',
    foodCost7d: 'Food cost · 7-day',
    avgCheckBand: 'Average check band',
    orderCompleted: 'Order completed',
    newOrderTitle: 'New order',
    itemsCount: (n) => `${n} items`,
    actions: {
      newOrder: { label: 'New order', detail: 'Start a check' },
      viewTables: { label: 'View tables', detail: 'Open the floor' },
      checkInventory: { label: 'Check inventory', detail: 'Review stock' },
      viewReports: { label: 'View reports', detail: 'Sales & service' },
      kitchen: { label: 'Kitchen', detail: 'Monitor tickets' },
      foodCost: { label: 'Food cost', detail: 'Review margins' },
    },
  },
  zh: {
    liveShift: '实时班次',
    morning: '早上好',
    afternoon: '下午好',
    evening: '晚上好',
    heroSubtitle: '以下是您餐厅今天的实时运营概况。',
    occupiedTables: '使用中餐桌',
    occupancyPct: (pct) => `${pct}% 入座率`,
    activeOrders: '进行中订单',
    inProgressNow: '正在制作与服务中',
    noOpenOrders: '暂无未结订单',
    avgPrepTime: '平均出餐时间',
    fireToBump: '下单至出餐 · 今晚',
    noTimingsYet: '暂无已完成出餐计时',
    todaysRevenue: '今日营业额',
    coversChecks: (covers, checks) => `${covers} 位客人 · ${checks} 笔账单`,
    delayedOrders: '超时订单',
    needsAttention: '需要关注',
    kitchenOnTrack: '后厨运行正常',
    todaysSalesOverview: '今日销售概览',
    dailyCloseHistory: '每日日结历史与当前班次营业额',
    viewReportsBtn: '查看报表 ↗',
    salesLast7Days: '销售额 · 最近 7 天',
    todayLabel: '今日',
    insightForYou: '运营建议',
    openRecommended: '打开建议页面',
    runningSmoothly: '一切运行顺畅',
    noUrgentAlerts: '目前没有紧急服务或库存警报。',
    openKitchenView: '打开后厨视图',
    branchOverview: '分店概览',
    acrossLocations: '今晚各分店实时业绩',
    combined: '合计',
    selected: '当前选择',
    coversOccupied: (covers, pct) => `${covers} 位客人 · ${pct}% 入座`,
    quickOverview: '快速概览',
    jumpBack: '快速进入日常运营模块',
    tablesCard: '餐桌',
    tablesDetail: (occ, free) => `${occ} 桌入座 · ${free} 桌空闲`,
    ordersCard: '订单',
    ordersDetail: (n) => `${n} 张活动账单`,
    kitchenCard: '后厨',
    kitchenDetail: (n) => `${n} 张超时订单`,
    inventoryCard: '库存',
    inventoryDetail: (n) => `${n} 项低于安全库存`,
    quickActions: '快捷操作',
    shortcuts: '快捷方式',
    recentActivity: '最近动态',
    viewAll: '查看全部 →',
    noActivityYet: '班次开始后动态将显示在这里。',
    shiftHealth: '班次健康度',
    onTarget: '达标',
    review: '需关注',
    foodCost7d: '食材成本 · 7天',
    avgCheckBand: '客单价目标区间',
    orderCompleted: '订单已完成',
    newOrderTitle: '新订单',
    itemsCount: (n) => `${n} 项菜品`,
    actions: {
      newOrder: { label: '新建订单', detail: '开启新账单' },
      viewTables: { label: '查看餐桌', detail: '打开堂食平面图' },
      checkInventory: { label: '检查库存', detail: '盘点原料库存' },
      viewReports: { label: '查看报表', detail: '销售与服务分析' },
      kitchen: { label: '后厨监控', detail: '查看KDS出餐单' },
      foodCost: { label: '食材成本', detail: '查看菜品毛利' },
    },
  },
}

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

function activityRows(state, lang, copy) {
  const tableById = Object.fromEntries(state.tables.map((table) => [table.id, table]))
  return [...state.orders]
    .filter((order) => order.status !== 'void')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map((order) => {
      const rawTableName = tableById[order.tableId]?.name || order.type
      const tableName = translateTableName(rawTableName, lang)
      const count = order.items.filter((item) => !item.voided).length
      const statusLabel = translateTicketStatus(order.status, lang)
      return {
        id: order.id,
        title: `${order.status === 'paid' ? copy.orderCompleted : copy.newOrderTitle} ${String(order.id).replace(/\D/g, '').slice(-4) ? `#${String(order.id).replace(/\D/g, '').slice(-4)}` : ''}`,
        detail: `${tableName} · ${copy.itemsCount(count)} · ${statusLabel}`,
        at: order.updatedAt || order.createdAt,
        icon: order.status === 'ready' || order.status === 'paid' ? '✓' : '▤',
        tone: order.status === 'ready' || order.status === 'paid' ? 'green' : 'orange',
      }
    })
}

export default function DashboardScreen() {
  const { state, empire, setScreen, role, locId, setLocId } = useRestora()
  const { lang, dict } = useI18n()
  const copy = DASH_COPY[lang] || DASH_COPY.km
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
  const localeTag = lang === 'km' ? 'km-KH' : lang === 'zh' ? 'zh-CN' : 'en-US'
  const date = new Date(now).toLocaleDateString(localeTag, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
  const greeting = new Date(now).getHours() < 12 ? copy.morning : new Date(now).getHours() < 17 ? copy.afternoon : copy.evening
  const alert = alerts[0]
  const recent = activityRows(state, lang, copy)
  const quickOverviewScreens = ['floor', 'tickets', 'kitchen', 'inventory']
  const availableActions = QUICK_ACTIONS.filter((action) => (
    !quickOverviewScreens.includes(action.screen)
    && (ROLE_NAV[role] || ROLE_NAV.owner).includes(action.screen)
  ))
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
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {copy.liveShift} · {state.settings.restaurantName || 'RESTORA'}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-[38px]">
            {greeting}, <span className="text-orange-400">{role === 'owner' ? 'Maya' : (dict.roles?.[role] || role)}</span>
          </h1>
          <p className="mt-2 max-w-lg text-sm text-white/85 sm:text-base">{copy.heroSubtitle}</p>
          <div className="mt-5 flex items-center gap-2 text-xs font-medium text-white/90"><span aria-hidden="true">▦</span>{date}<span className="mx-1 text-white/50">·</span>{LOCATIONS.find((item) => item.id === locId)?.short}</div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          icon="▦"
          label={
            <>
              {copy.occupiedTables}
              {lang !== 'en' && <span className="sr-only"> Occupied tables</span>}
            </>
          }
          value={<>{occupiedTables}<span className="ml-1 text-base font-medium text-zinc-400">/ {totalTables}</span></>}
          foot={copy.occupancyPct(occupancy)}
          progress={occupancy}
          tone="orange"
        />
        <MetricCard icon="▤" label={copy.activeOrders} value={activeOrders} foot={activeOrders ? copy.inProgressNow : copy.noOpenOrders} tone="green" />
        <MetricCard icon="◷" label={copy.avgPrepTime} value={averagePrep} foot={dash.avgTicketMin ? copy.fireToBump : copy.noTimingsYet} tone="blue" />
        <MetricCard icon="$" label={copy.todaysRevenue} value={money(dash.sales)} foot={copy.coversChecks(dash.covers, dash.checks)} tone="violet" />
        <MetricCard icon="!" label={copy.delayedOrders} value={delayedOrders} foot={delayedOrders ? copy.needsAttention : copy.kitchenOnTrack} tone={delayedOrders ? 'red' : 'green'} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <div className="grid items-stretch gap-4 lg:grid-cols-12">
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm lg:col-span-8">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-zinc-900">
                    {copy.todaysSalesOverview}
                    {lang !== 'en' && <span className="sr-only"> Today&apos;s sales overview</span>}
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">{copy.dailyCloseHistory}</p>
                </div>
                <button type="button" onClick={() => goTo('reports')} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 hover:border-orange-200 hover:text-orange-600">{copy.viewReportsBtn}</button>
              </div>
              <SalesBars history={state.salesHistory} today={dash.sales} />
              <div className="mt-3 flex items-center justify-between text-xs text-zinc-500"><span>{copy.salesLast7Days}</span><span className="tnum font-semibold text-zinc-700">{copy.todayLabel} {money(dash.sales)}</span></div>
            </section>

            <section className="flex flex-col rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-[#fff3e8] p-5 shadow-sm lg:col-span-4">
              <div className="flex items-center gap-2 text-orange-700"><span className="text-xl" aria-hidden="true">♧</span><h2 className="text-sm font-bold">{copy.insightForYou}</h2></div>
              {alert ? (
                <>
                  <div className="mt-5 flex items-start gap-2"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">!</span><div><div className="text-sm font-bold text-zinc-900">{alert.label}</div><p className="mt-1 text-xs leading-relaxed text-zinc-600">{alert.detail}</p></div></div>
                  <button type="button" onClick={() => goTo(alertScreen)} className="mt-auto min-h-10 rounded-xl bg-orange-500 px-4 text-left text-sm font-bold text-white shadow-sm hover:bg-orange-600">{copy.openRecommended} <span className="float-right">→</span></button>
                </>
              ) : (
                <><div className="mt-5 text-sm font-bold text-zinc-900">{copy.runningSmoothly}</div><p className="mt-1 text-xs leading-relaxed text-zinc-600">{copy.noUrgentAlerts}</p><button type="button" onClick={() => goTo('kitchen')} className="mt-auto min-h-10 rounded-xl bg-orange-500 px-4 text-left text-sm font-bold text-white shadow-sm hover:bg-orange-600">{copy.openKitchenView} <span className="float-right">→</span></button></>
              )}
            </section>
          </div>

          {role === 'owner' && (
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-bold text-zinc-900">{copy.branchOverview}</h2><p className="mt-0.5 text-xs text-zinc-500">{copy.acrossLocations}</p></div><span className="tnum text-sm font-bold text-orange-600">{money(empireDash.reduce((sum, item) => sum + item.dash.sales, 0))} {copy.combined}</span></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {empireDash.map((item) => <button key={item.id} type="button" onClick={() => setLocId(item.id)} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${locId === item.id ? 'border-orange-300 bg-orange-50' : 'border-zinc-200 hover:border-orange-200 hover:bg-orange-50/40'}`}><span><span className="block text-sm font-bold text-zinc-800">{item.short}{locId === item.id && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-orange-600">{copy.selected}</span>}</span><span className="mt-1 block text-xs text-zinc-500">{copy.coversOccupied(item.dash.covers, Math.round(item.dash.occupancy * 100))}</span></span><span className="tnum text-sm font-bold text-zinc-800">{money(item.dash.sales)}</span></button>)}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-bold text-zinc-900">{copy.quickOverview}</h2><p className="mt-0.5 text-xs text-zinc-500">{copy.jumpBack}</p></div></div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { id: 'floor', label: copy.tablesCard, detail: copy.tablesDetail(occupiedTables, state.tables.filter((table) => table.status === 'free').length), icon: '▦' },
                { id: 'tickets', label: copy.ordersCard, detail: copy.ordersDetail(activeOrders), icon: '▤' },
                { id: 'kitchen', label: copy.kitchenCard, detail: copy.kitchenDetail(delayedOrders), icon: '♨' },
                { id: 'inventory', label: copy.inventoryCard, detail: copy.inventoryDetail(state.inventory.filter((item) => item.onHand < item.par).length), icon: '▧' },
              ].filter((item) => (ROLE_NAV[role] || ROLE_NAV.owner).includes(item.id)).map((item) => <button key={item.id} type="button" onClick={() => goTo(item.id)} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 text-left transition hover:border-orange-300 hover:bg-orange-50/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-lg font-bold text-orange-600">{item.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-zinc-800">{item.label}</span><span className="mt-0.5 block truncate text-[11px] text-zinc-500">{item.detail}</span></span><span className="text-orange-500">›</span></button>)}
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:col-span-4">
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-bold text-zinc-900">{copy.quickActions}</h2><span className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-600">{copy.shortcuts}</span></div>
            <div className="grid grid-cols-2 gap-2">
              {availableActions.map((action) => {
                const actionCopy = copy.actions?.[action.id] || action
                return <button key={action.screen} type="button" onClick={() => goTo(action.screen)} className="group flex min-h-[90px] flex-col items-start justify-between rounded-xl border border-zinc-200 p-3 text-left transition hover:border-orange-300 hover:bg-orange-50/50"><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold ring-1 ${ACTION_COLOR[action.color]}`}>{action.icon}</span><span><span className="block text-xs font-bold text-zinc-800">{actionCopy.label}</span><span className="mt-0.5 block text-[10px] text-zinc-500">{actionCopy.detail}</span></span></button>
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold text-zinc-900">{copy.recentActivity}</h2><button type="button" onClick={() => goTo('tickets')} className="text-xs font-semibold text-orange-600 hover:text-orange-700">{copy.viewAll}</button></div>
            {recent.length ? <ul className="divide-y divide-zinc-100">{recent.map((item) => <li key={item.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${item.tone === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-600'}`}>{item.icon}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-zinc-800">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-zinc-500">{item.detail}</span></span><span className="shrink-0 text-[10px] text-zinc-400">{relativeTime(item.at)}</span></li>)}</ul> : <p className="py-5 text-center text-sm text-zinc-500">{copy.noActivityYet}</p>}
          </section>

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-zinc-900">{copy.shiftHealth}</h2><StatusPill tone={dash.foodCost7d <= state.settings.foodCostCap ? 'ok' : 'warn'} size="sm">{dash.foodCost7d <= state.settings.foodCostCap ? copy.onTarget : copy.review}</StatusPill></div>
            <div className="flex items-center justify-between text-xs text-zinc-500"><span>{copy.foodCost7d}</span><strong className="tnum text-zinc-800">{(dash.foodCost7d * 100).toFixed(1)}% / {(state.settings.foodCostCap * 100).toFixed(0)}%</strong></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"><div className={`h-full rounded-full ${dash.foodCost7d <= state.settings.foodCostCap ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(100, (dash.foodCost7d / Math.max(state.settings.foodCostCap, 0.01)) * 100)}%` }} /></div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500"><span>{copy.avgCheckBand}</span><strong className="text-zinc-800">${TARGETS.avgCheckLow}–${TARGETS.avgCheckHigh}</strong></div>
          </section>
        </aside>
      </div>

      {alert && <div className="sr-only" aria-live="polite">{alerts.length} alerts. Latest: {alert.label}</div>}
    </div>
  )
}
