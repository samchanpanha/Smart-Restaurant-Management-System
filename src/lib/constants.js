// ─── Restora constants ─────────────────────────────────────────────
// Single source of truth for statuses, bands, and operational targets.
// Mirrors docs/superpowers/specs/2026-10-12-restora-ux-design.md §7.

export const TABLE_STATUSES = ['free', 'reserved', 'seated', 'ordered', 'billed', 'dirty']

// Strict machine: free -> seated -> ordered -> billed -> dirty -> free
// `reserved` overlays `free` only.
export const TABLE_TRANSITIONS = {
  free: ['seated', 'reserved'],
  reserved: ['seated', 'free'], // seated = party arrived; free = release/no-show
  seated: ['ordered', 'dirty'], // dirty = walkout edge case (manager)
  ordered: ['billed'],
  billed: ['dirty'],
  dirty: ['free'],
}

export const TABLE_STATUS_META = {
  free: { label: 'Free', tone: 'ok' },
  reserved: { label: 'Reserved', tone: 'info' },
  seated: { label: 'Seated', tone: 'info' },
  ordered: { label: 'Ordered', tone: 'warn' },
  billed: { label: 'Billed', tone: 'warn' },
  dirty: { label: 'Dirty', tone: 'bad' },
}

export const TICKET_STATUSES = ['open', 'sent', 'in_prep', 'ready', 'served', 'paid', 'void']

export const TICKET_TRANSITIONS = {
  open: ['sent', 'void'],
  sent: ['in_prep', 'void'],
  in_prep: ['ready', 'void'],
  ready: ['served', 'void'],
  served: ['paid', 'void'],
  paid: [],
  void: [],
}

export const TICKET_STATUS_META = {
  open: { label: 'Open', tone: 'muted' },
  sent: { label: 'Sent', tone: 'info' },
  in_prep: { label: 'In prep', tone: 'warn' },
  ready: { label: 'Ready', tone: 'ok' },
  served: { label: 'Served', tone: 'ok' },
  paid: { label: 'Paid', tone: 'muted' },
  void: { label: 'Void', tone: 'bad' },
}

export const TICKET_ITEM_STATUSES = ['held', 'fired', 'bump']

export const TICKET_ITEM_META = {
  held: { label: 'Held', tone: 'muted' },
  fired: { label: 'Fired', tone: 'warn' },
  bump: { label: 'Bumped', tone: 'ok' },
}

export const STATIONS = ['grill', 'saute', 'pantry', 'dessert', 'expo']

export const STATION_META = {
  grill: { label: 'Grill' },
  saute: { label: 'Sauté' },
  pantry: { label: 'Pantry' },
  dessert: { label: 'Dessert' },
  expo: { label: 'Expo' },
}

export const RESERVATION_STATUSES = ['booked', 'seated', 'no_show', 'cancelled']

export const STOCK_STATUSES = ['ok', 'low', 'out']

export const MARGIN_BANDS = ['high', 'ok', 'low', 'loss']
export const MARGIN_BAND_META = {
  high: { label: 'High ≥70%', tone: 'ok' },
  ok: { label: 'OK 55–70%', tone: 'info' },
  low: { label: 'Low 10–55%', tone: 'warn' },
  loss: { label: 'Loss <10%', tone: 'bad' },
}

// Contribution = (price - plateCost) / price
export function marginBandFor(contribution) {
  if (contribution >= 0.7) return 'high'
  if (contribution >= 0.55) return 'ok'
  if (contribution >= 0.1) return 'low'
  return 'loss'
}

// Operational targets (spec §8 sample data / Task 8.5)
export const TARGETS = {
  ticketMinutes: 18, // KDS SLA
  ticketWarnRatio: 0.7, // warning at 70% of target
  undoSendSeconds: 15, // server can undo a send
  recallBumpSeconds: 60, // kitchen can recall a bump
  avgCheckLow: 38,
  avgCheckHigh: 62,
  foodCostLow: 0.28,
  foodCostHigh: 0.32,
  turnAlertRatio: 0.9, // alert at 90% of target turn
  targetTurnMinutes: 45, // default 4-top turn
  noShowMinutes: 15,
  parAlertHoursBeforeRush: 2,
  rushHour: 18, // 6pm dinner rush
}

export const ROLES = {
  owner: { label: 'Maya · Owner/GM', name: 'Maya' },
  server: { label: 'Jordan · Server', name: 'Jordan' },
  kitchen: { label: 'Kim · Kitchen', name: 'Kim' },
  host: { label: 'Alex · Host', name: 'Alex' },
}

// Role-aware nav (spec §6). Owner sees all.
// One icon per screen — the sidebar and the tab strip must never drift.
export const SCREEN_ICONS = {
  dashboard: 'dashboard',
  floor: 'tables',
  tickets: 'orders',
  kitchen: 'kitchen',
  inventory: 'inventory',
  menu: 'menu',
  catalog: 'catalog',
  suppliers: 'supplier',
  purchases: 'cart',
  reports: 'reports',
  costing: 'costing',
  settings: 'settings',
  system: 'layers',
  movements: 'swap',
  telegram: 'send',
}

export const ROLE_NAV = {
  owner: ['dashboard', 'floor', 'tickets', 'kitchen', 'menu', 'catalog', 'inventory', 'movements', 'suppliers', 'purchases', 'reports', 'costing', 'settings', 'system', 'telegram'],
  server: ['floor', 'tickets'],
  kitchen: ['kitchen'],
  host: ['floor', 'dashboard'],
}

export const NAV_SECTIONS = [
  {
    id: 'live',
    label: 'Live',
    items: [
      { id: 'dashboard', label: 'Dashboard', step: 6 },
      { id: 'floor', label: 'Floor', step: 2 },
      { id: 'tickets', label: 'Tickets', step: 3 },
      { id: 'kitchen', label: 'Kitchen', step: 4 },
    ],
  },
  {
    id: 'control',
    label: 'Control',
    items: [
      { id: 'menu', label: 'Menu & Recipes', step: 7 },
      { id: 'catalog', label: 'Catalog', step: 9 },
      { id: 'inventory', label: 'Inventory', step: 5 },
      { id: 'movements', label: 'Stock movements', step: 5 },
      { id: 'purchases', label: 'Purchases', step: 9 },
      { id: 'suppliers', label: 'Suppliers', step: 9 },
    ],
  },
  {
    id: 'insight',
    label: 'Insight',
    items: [
      { id: 'reports', label: 'Reports', step: 8 },
      { id: 'costing', label: 'Food Cost & Profit', step: 7 },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'settings', label: 'Settings & Documents', step: 9 },
      { id: 'telegram', label: 'Telegram & Mini App', step: 9 },
      { id: 'system', label: 'System & Model', step: 1 },
    ],
  },
]

export const TONE_CLASSES = {
  ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  bad: 'bg-red-500/15 text-red-300 ring-red-500/40',
  info: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  muted: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/40',
}

// Which screen owns each alert — drives the notification jump and the
// live badge on each workspace tab.
export function screenForAlert(alert) {
  if (alert.type === 'late_ticket') return 'kitchen'
  if (alert.type === 'long_turn' || alert.type === 'call_server') return 'floor'
  if (alert.type === 'low_stock') return 'inventory'
  if (alert.type === 'negative_margin') return 'costing'
  if (alert.type === 'bill_request') return 'tickets'
  return alert.type === '86' && alert.key.startsWith('out_') ? 'inventory' : 'kitchen'
}

// Alerts that mean "act now" render red on the tab badge; the rest amber.
export const CRITICAL_ALERTS = new Set(['late_ticket', 'bill_request', 'call_server'])
