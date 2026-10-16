import { MOVEMENT_KINDS } from '../../lib/reducer'

const TABS = [
  { id: 'sales', label: 'Sales' },
  { id: 'branches', label: 'All branches' },
  { id: 'buying', label: 'Buying' },
  { id: 'stockflow', label: 'Stock flow' },
  { id: 'pl', label: 'Profit & loss' },
  { id: 'sellbuy', label: 'Sell & buy in/out' },
  { id: 'toplow', label: 'Top & bottom' },
  { id: 'service', label: 'Service' },
  { id: 'voids', label: 'Voids & comps' },
  { id: 'variance', label: 'Variance' },
  { id: 'pnl', label: 'P&L-lite' },
  { id: 'delivery', label: 'Delivery performance' },
]

const RANGES = [
  { id: 'tonight', label: 'Tonight' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
]

function paidLines(state) {
  const rows = []
  for (const o of state.orders) {
    if (o.status !== 'paid') continue
    for (const it of o.items) {
      if (it.voided || it.comped) continue
      rows.push({ order: o, item: it })
    }
  }
  return rows
}

const pct = (value) => `${(value * 100).toFixed(1)}%`
const signedQty = (value) => {
  const n = Number(value) || 0
  if (!n) return '0'
  return `${n > 0 ? '+' : '−'}${Math.abs(Math.round(n * 1000) / 1000)}`
}
const KIND_LABEL = Object.fromEntries(MOVEMENT_KINDS.map((kind) => [kind.id, kind.label]))

export { TABS, RANGES, paidLines, pct, signedQty, KIND_LABEL }
