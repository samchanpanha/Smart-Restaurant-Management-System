

const COURSES = [
  { id: 'appetizer', label: 'App' },
  { id: 'main', label: 'Main' },
  { id: 'dessert', label: 'Dessert' },
]
const courseLabel = (id) => COURSES.find((c) => c.id === id)?.label || id

const TABS = [
  { id: 'active', label: 'Active', match: (s) => ['open', 'sent', 'in_prep'].includes(s) },
  { id: 'ready', label: 'Ready', match: (s) => ['ready', 'served'].includes(s) },
  { id: 'paid', label: 'Paid', match: (s) => s === 'paid' },
]

const serverName = (id) => (id === 'server' ? 'Jordan' : id)

const ORDER_TYPES = [
  { id: 'dine_in', label: 'Dine-in' },
  { id: 'takeout', label: 'Takeout' },
  { id: 'delivery', label: 'Delivery' },
]
const ORDER_TYPE_LABEL = { takeout: 'Takeout', delivery: 'Delivery' }

/** A ticket's display name: table party, or an off-table customer label. */
function orderLabel(order, table) {
  if (table) return table.name
  const base = ORDER_TYPE_LABEL[order.type] || (order.type === 'dine_in' ? 'Dine-in' : order.type)
  return order.customer?.name ? `${base} · ${order.customer.name}` : base
}

function openOrderForTable(orders, tableId) {
  return orders.find((o) => o.tableId === tableId && !['paid', 'void'].includes(o.status))
}

// ─── 15-second undo banner ──────────────────────────────────────

export { COURSES, courseLabel, TABS, serverName, ORDER_TYPES, ORDER_TYPE_LABEL, orderLabel, openOrderForTable }
