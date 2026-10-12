// ─── Restora store ────────────────────────────────────────────────
// One ticket, one truth: floor, kitchen, and inventory read the same
// order objects. Persisted to localStorage; Reset demo restores seed.
//
// Timing rules (spec §8):
// - Theoretical inventory drops on FIRE, not on draft, not on pay.
// - Send has a 15s undo; then the kitchen owns the item.
// - Bump recall is allowed for 60s.

import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import { TARGETS, marginBandFor } from './constants'
import {
  assertTableTransition,
  costingFor,
  minutesBetween,
  orderSubtotal,
  plateCostFor,
  quoteWaitMinutes,
  stockStatusFor,
  theoreticalDecrementFor,
  ticketAgeState,
  uid,
} from './models'
import { buildSeed } from './seed'

const STORAGE_KEY = 'restora-v1'

const RestoraContext = createContext(null)

// ─── Reducer ────────────────────────────────────────────────────

function decrementInventory(inventory, decMap, sign = -1) {
  const byId = Object.fromEntries(inventory.map((i) => [i.id, i]))
  const next = inventory.map((item) => {
    const delta = decMap[item.id] || 0
    if (!delta) return item
    const onHand = Math.round((item.onHand + sign * delta) * 100) / 100
    return { ...item, onHand }
  })
  // Auto-86 is derived in selectors (out-of-stock ingredients), not stored —
  // except the manual 86 flag on menu items. Negative on-hand is kept as a
  // visible flag, never silently wrapped.
  void byId
  return next
}

function reducer(state, action) {
  switch (action.type) {
    // ── Floor ──────────────────────────────────────────────
    case 'SEAT_PARTY': {
      const { tableId, partySize, reservationId } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      assertTableTransition(table.status, 'seated')
      const tables = state.tables.map((t) =>
        t.id === tableId
          ? { ...t, status: 'seated', seatedAt: new Date().toISOString(), partySize }
          : t,
      )
      let { reservations, waitlist } = state
      if (reservationId) {
        reservations = reservations.map((r) =>
          r.id === reservationId ? { ...r, status: 'seated', tableId } : r,
        )
        waitlist = waitlist.filter((w) => w.id !== reservationId)
      }
      return { ...state, tables, reservations, waitlist }
    }

    case 'SET_TABLE_STATUS': {
      const { tableId, to, force } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table) return state
      if (!force) assertTableTransition(table.status, to)
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        const clearing = to === 'free'
        return {
          ...t,
          status: to,
          ...(clearing ? { currentCheckId: null, seatedAt: null, partySize: null } : {}),
        }
      })
      return { ...state, tables }
    }

    case 'BUS_TABLE': {
      // billed -> dirty (server/host clears after pay)
      const { tableId } = action
      const table = state.tables.find((t) => t.id === tableId)
      if (!table || table.status !== 'billed') return state
      return reducer(state, { type: 'SET_TABLE_STATUS', tableId, to: 'dirty' })
    }

    // ── Orders / tickets ───────────────────────────────────
    case 'CREATE_ORDER': {
      const { tableId, orderType = 'dine_in' } = action
      const existing = state.orders.find(
        (o) => o.tableId === tableId && !['paid', 'void'].includes(o.status),
      )
      if (existing) return state
      const order = {
        id: uid('o'),
        tableId,
        type: orderType,
        serverId: 'server',
        status: 'open',
        createdAt: new Date().toISOString(),
        sentAt: null,
        paidAt: null,
        voidReason: null,
        compTotal: 0,
        items: [],
      }
      const tables = state.tables.map((t) =>
        t.id === tableId && t.currentCheckId == null ? { ...t, currentCheckId: order.id } : t,
      )
      return { ...state, orders: [...state.orders, order], tables }
    }

    case 'ADD_ITEM': {
      const { orderId, menuItemId, qty = 1, modifiers = [], course = 'main', notes = '' } = action
      const menuItem = state.menu.find((m) => m.id === menuItemId)
      if (!menuItem || !menuItem.available) return state // 86 blocked
      const item = {
        id: uid('it'),
        menuItemId,
        qty,
        modifiers,
        station: menuItem.station,
        status: 'held',
        course,
        notes,
        firedAt: null,
        recipeSnapshot: null,
      }
      const orders = state.orders.map((o) =>
        o.id === orderId ? { ...o, items: [...o.items, item] } : o,
      )
      return { ...state, orders }
    }

    case 'UPDATE_ITEM': {
      const { orderId, itemId, patch } = action
      const orders = state.orders.map((o) =>
        o.id === orderId
          ? { ...o, items: o.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }
          : o,
      )
      return { ...state, orders }
    }

    case 'REMOVE_ITEM': {
      const { orderId, itemId } = action
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const item = o.items.find((i) => i.id === itemId)
        if (!item || item.status !== 'held') return o // kitchen owns fired items
        return { ...o, items: o.items.filter((i) => i.id !== itemId) }
      })
      return { ...state, orders }
    }

    case 'SEND_ORDER': {
      const { orderId, courses } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order) return state
      // Fire held items — optionally only the given courses (hold desserts,
      // send starters/mains). Theoretical stock drops here, on fire.
      const heldItems = order.items.filter(
        (i) => i.status === 'held' && !i.voided && (!courses || courses.includes(i.course)),
      )
      if (!heldItems.length) return state
      const nowIso = new Date().toISOString()
      const inventoryById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))

      // Fire held items + snapshot recipe cost at send time
      const firedIds = new Set(heldItems.map((i) => i.id))
      const totalDec = {}
      for (const item of heldItems) {
        const recipe = state.recipes[item.menuItemId]
        const dec = theoreticalDecrementFor(recipe, item.qty)
        for (const [k, v] of Object.entries(dec)) totalDec[k] = (totalDec[k] || 0) + v
      }
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) => {
          if (!firedIds.has(i.id)) return i
          const recipe = state.recipes[i.menuItemId]
          return {
            ...i,
            status: 'fired',
            firedAt: nowIso,
            recipeSnapshot: recipe
              ? { ...recipe, plateCost: plateCostFor(recipe, inventoryById) }
              : null,
          }
        })
        const status = o.status === 'open' ? 'sent' : o.status === 'sent' ? 'in_prep' : o.status
        return { ...o, items, status, sentAt: o.sentAt || nowIso }
      })
      const inventory = decrementInventory(state.inventory, totalDec, -1)
      // Floor follows the ticket: first send moves seated -> ordered
      let tables = state.tables
      const table = state.tables.find((t) => t.id === order.tableId)
      if (table && table.status === 'seated') {
        tables = tables.map((t) =>
          t.id === table.id ? { ...t, status: 'ordered', currentCheckId: order.id } : t,
        )
      } else if (table && !table.currentCheckId) {
        tables = tables.map((t) =>
          t.id === table.id ? { ...t, currentCheckId: order.id } : t,
        )
      }
      const pendingUndo = {
        orderId,
        sentAt: nowIso,
        expiresAt: Date.now() + TARGETS.undoSendSeconds * 1000,
        itemIds: [...firedIds],
        restore: totalDec,
      }
      return { ...state, orders, inventory, tables, pendingUndo }
    }

    case 'UNDO_SEND': {
      const { orderId } = action
      const pu = state.pendingUndo
      if (!pu || pu.orderId !== orderId || Date.now() > pu.expiresAt) return state
      const ids = new Set(pu.itemIds)
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          ids.has(i.id) ? { ...i, status: 'held', firedAt: null, recipeSnapshot: null } : i,
        )
        const anyFired = items.some((i) => i.status === 'fired')
        return { ...o, items, status: anyFired ? o.status : 'open', sentAt: anyFired ? o.sentAt : null }
      })
      const inventory = decrementInventory(state.inventory, pu.restore, +1)
      // If nothing fired anymore, table drops back ordered -> seated (undo path)
      let tables = state.tables
      const order = state.orders.find((o) => o.id === orderId)
      const stillFired = orders
        .find((o) => o.id === orderId)
        ?.items.some((i) => i.status !== 'held')
      if (order && !stillFired) {
        tables = tables.map((t) =>
          t.id === order.tableId && t.status === 'ordered' ? { ...t, status: 'seated' } : t,
        )
      }
      return { ...state, orders, inventory, tables, pendingUndo: null }
    }

    case 'EXPIRE_UNDO':
      return state.pendingUndo ? { ...state, pendingUndo: null } : state

    // ── Kitchen ────────────────────────────────────────────
    case 'BUMP_ITEM': {
      const { orderId, itemId } = action
      const nowIso = new Date().toISOString()
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          i.id === itemId && i.status === 'fired'
            ? { ...i, status: 'bump', bumpedAt: nowIso }
            : i,
        )
        // Derive order progress
        let status = o.status
        if (items.length && items.every((i) => i.status === 'bump')) status = 'ready'
        else if (items.some((i) => i.status === 'fired')) status = o.status === 'sent' ? 'in_prep' : o.status
        return { ...o, items, status }
      })
      const recalls = {
        ...state.recalls,
        [`${orderId}:${itemId}`]: Date.now() + TARGETS.recallBumpSeconds * 1000,
      }
      return { ...state, orders, recalls }
    }

    case 'RECALL_ITEM': {
      const { orderId, itemId } = action
      const key = `${orderId}:${itemId}`
      if (!state.recalls[key] || Date.now() > state.recalls[key]) return state
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          i.id === itemId && i.status === 'bump' ? { ...i, status: 'fired', bumpedAt: null } : i,
        )
        return { ...o, items, status: 'in_prep' }
      })
      const recalls = { ...state.recalls }
      delete recalls[key]
      return { ...state, orders, recalls }
    }

    case 'SET_86': {
      const { menuItemId, available } = action
      const menu = state.menu.map((m) => (m.id === menuItemId ? { ...m, available } : m))
      return { ...state, menu }
    }

    // ── Pay / void / comp ──────────────────────────────────
    case 'SERVE_ORDER': {
      const { orderId } = action
      const orders = state.orders.map((o) =>
        o.id === orderId && o.status === 'ready' ? { ...o, status: 'served' } : o,
      )
      return { ...state, orders }
    }

    case 'VOID_ITEM': {
      // Manager void of one line (fired or held). The line stays for audit;
      // comps/voids are excluded from the bill. Held voids never touched stock.
      const { orderId, itemId, reason } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || ['paid', 'void'].includes(order.status)) return state
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        return {
          ...o,
          items: o.items.map((i) =>
            i.id === itemId ? { ...i, voided: true, voidReason: reason || 'manager void' } : i,
          ),
        }
      })
      return { ...state, orders }
    }

    case 'PAY_ORDER': {
      const { orderId, method = 'card', split = null } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || !['ready', 'served', 'in_prep', 'sent'].includes(order.status)) return state
      const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
      const total = orderSubtotal(order, menuById)
      const orders = state.orders.map((o) =>
        o.id === orderId
          ? { ...o, status: 'paid', paidAt: new Date().toISOString(), payMethod: method, split, total }
          : o,
      )
      // Table ordered -> billed; record the turn for host wait quotes
      let tables = state.tables
      let turnHistory = state.turnHistory
      const table = state.tables.find((t) => t.id === order.tableId)
      if (table) {
        const seatedMin = table.seatedAt ? minutesBetween(table.seatedAt) : table.targetTurnMinutes
        turnHistory = [...turnHistory.slice(-40), { partySize: table.partySize || 2, minutes: seatedMin }]
        tables = tables.map((t) => {
          if (t.id !== table.id) return t
          if (t.status === 'ordered' || t.status === 'seated') return { ...t, status: 'billed' }
          return t
        })
      }
      return { ...state, orders, tables, turnHistory }
    }

    case 'VOID_ORDER': {
      const { orderId, reason } = action
      const order = state.orders.find((o) => o.id === orderId)
      if (!order || ['paid', 'void'].includes(order.status)) return state
      const orders = state.orders.map((o) =>
        o.id === orderId ? { ...o, status: 'void', voidReason: reason || 'manager void' } : o,
      )
      // Manager override: voided check sends the table back through bus flow
      const tables = state.tables.map((t) =>
        t.id === order.tableId ? { ...t, status: 'dirty', currentCheckId: null } : t,
      )
      return { ...state, orders, tables }
    }

    case 'COMP_ITEM': {
      const { orderId, itemId, reason } = action
      const orders = state.orders.map((o) => {
        if (o.id !== orderId) return o
        const items = o.items.map((i) =>
          i.id === itemId ? { ...i, comped: true, compReason: reason || 'comp' } : i,
        )
        return { ...o, items }
      })
      return { ...state, orders }
    }

    // ── Host: reservations + waitlist ──────────────────────
    case 'ADD_RESERVATION': {
      const res = {
        id: uid('res'),
        status: 'booked',
        source: 'phone',
        tableId: null,
        notes: '',
        ...action.reservation,
      }
      return { ...state, reservations: [...state.reservations, res] }
    }

    case 'SET_RESERVATION': {
      const { id, patch } = action
      const reservations = state.reservations.map((r) => (r.id === id ? { ...r, ...patch } : r))
      return { ...state, reservations }
    }

    case 'ADD_WAITLIST': {
      const entry = { id: uid('wl'), addedAt: new Date().toISOString(), ...action.entry }
      return { ...state, waitlist: [...state.waitlist, entry] }
    }

    case 'REMOVE_WAITLIST': {
      return { ...state, waitlist: state.waitlist.filter((w) => w.id !== action.id) }
    }

    // ── Inventory ──────────────────────────────────────────
    case 'RECEIVE_INVOICE': {
      const { vendor, lines } = action // lines: [{inventoryItemId, qty, unitCost}]
      const inventory = state.inventory.map((item) => {
        const line = lines.find((l) => l.inventoryItemId === item.id)
        if (!line) return item
        return {
          ...item,
          onHand: Math.round((item.onHand + Number(line.qty || 0)) * 100) / 100,
          lastCost: Number(line.unitCost ?? item.lastCost),
          vendor: vendor || item.vendor,
        }
      })
      const invoiceLog = [
        ...state.invoiceLog,
        { id: uid('invlog'), vendor, at: new Date().toISOString(), lines },
      ]
      // Receiving stock may un-86 dishes — recompute availability for items
      // that were auto-blocked? Manual 86 flags stay until cleared by hand.
      return { ...state, inventory, invoiceLog }
    }

    case 'LOG_WASTE': {
      const { inventoryItemId, qty, reason } = action
      const inventory = state.inventory.map((i) =>
        i.id === inventoryItemId ? { ...i, onHand: Math.round((i.onHand - qty) * 100) / 100 } : i,
      )
      const wasteLog = [
        ...state.wasteLog,
        { id: uid('w'), inventoryItemId, qty, reason, at: new Date().toISOString(), by: 'staff' },
      ]
      return { ...state, inventory, wasteLog }
    }

    case 'COUNT_STOCK': {
      // Close count sets counted on-hand directly (variance is derived)
      const { counts } = action // { inventoryItemId: qty }
      const inventory = state.inventory.map((i) =>
        counts[i.id] != null ? { ...i, onHand: Number(counts[i.id]) } : i,
      )
      return { ...state, inventory }
    }

    // ── Menu / costing ─────────────────────────────────────
    case 'UPDATE_RECIPE': {
      const { menuItemId, recipe } = action
      return { ...state, recipes: { ...state.recipes, [menuItemId]: recipe } }
    }

    case 'UPDATE_PRICE': {
      const { menuItemId, price } = action
      const menu = state.menu.map((m) => (m.id === menuItemId ? { ...m, price: Number(price) } : m))
      return { ...state, menu }
    }

    // ── Misc ───────────────────────────────────────────────
    case 'DISMISS_ALERT':
      return state.dismissedAlerts.includes(action.key)
        ? state
        : { ...state, dismissedAlerts: [...state.dismissedAlerts, action.key] }

    case 'RESET_ALL':
      return buildSeed()

    case 'HYDRATE':
      return action.state

    default:
      return state
  }
}

// ─── Derived: alerts ──────────────────────────────────────────────
// Exceptions over averages: late tickets, 86 risk, long turns, losers.

export function getAlerts(state) {
  const alerts = []
  const nowMs = Date.now()
  const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
  const invById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))

  // Late / warning tickets (KDS SLA)
  for (const order of state.orders) {
    if (['paid', 'void'].includes(order.status)) continue
    for (const item of order.items) {
      if (item.status !== 'fired' || !item.firedAt) continue
      const age = ticketAgeState(item.firedAt, nowMs)
      if (age === 'late') {
        alerts.push({
          key: `late_${order.id}_${item.id}`,
          type: 'late_ticket',
          severity: 'high',
          label: `Late ticket · ${menuById[item.menuItemId]?.name || 'item'}`,
          detail: `Table ${tableName(state, order.tableId)} · fired ${minutesBetween(item.firedAt)}m ago (target ${state.settings.ticketMinutes}m)`,
          entityId: order.id,
        })
      }
    }
  }

  // Low / out stock + 86
  for (const item of state.inventory) {
    const st = stockStatusFor(item)
    if (st === 'out') {
      const dishes = state.menu.filter((m) =>
        state.recipes[m.id]?.ingredients.some((ing) => ing.inventoryItemId === item.id),
      )
      alerts.push({
        key: `out_${item.id}`,
        type: '86',
        severity: 'high',
        label: `86 risk · ${item.name} out`,
        detail: dishes.length ? `Hits: ${dishes.map((d) => d.name).join(', ')}` : 'No recipe impact',
        entityId: item.id,
      })
    } else if (st === 'low') {
      alerts.push({
        key: `low_${item.id}`,
        type: 'low_stock',
        severity: 'med',
        label: `Low stock · ${item.name}`,
        detail: `${item.onHand} ${item.unit} left · par ${item.par}`,
        entityId: item.id,
      })
    }
  }

  // Manual 86 flags
  for (const m of state.menu) {
    if (!m.available) {
      alerts.push({
        key: `86_${m.id}`,
        type: '86',
        severity: 'med',
        label: `86'd · ${m.name}`,
        detail: m.substituteId ? `Suggest ${menuById[m.substituteId]?.name}` : 'No substitute mapped',
        entityId: m.id,
      })
    }
  }

  // Long turns (90% of target)
  for (const t of state.tables) {
    if ((t.status === 'seated' || t.status === 'ordered') && t.seatedAt) {
      const mins = minutesBetween(t.seatedAt)
      if (mins >= t.targetTurnMinutes * TARGETS.turnAlertRatio) {
        alerts.push({
          key: `turn_${t.id}`,
          type: 'long_turn',
          severity: mins >= t.targetTurnMinutes ? 'high' : 'med',
          label: `Long turn · ${t.name}`,
          detail: `${mins}m seated · target ${t.targetTurnMinutes}m`,
          entityId: t.id,
        })
      }
    }
  }

  // Negative-margin dishes (loss band from LIVE invoice costs)
  for (const m of state.menu) {
    const recipe = state.recipes[m.id]
    if (!recipe) continue
    const { contribution, band } = costingFor(m, recipe, invById)
    if (band === 'loss') {
      alerts.push({
        key: `margin_${m.id}`,
        type: 'negative_margin',
        severity: 'med',
        label: `Losing dish · ${m.name}`,
        detail: `${(contribution * 100).toFixed(1)}% contribution — reprice or 86`,
        entityId: m.id,
      })
    }
  }

  return alerts.filter((a) => !state.dismissedAlerts.includes(a.key))
}

// ─── Derived: dashboard KPIs ──────────────────────────────────────

export function getDashboard(state) {
  const menuById = Object.fromEntries(state.menu.map((m) => [m.id, m]))
  const paid = state.orders.filter((o) => o.status === 'paid')
  const sales = paid.reduce((s, o) => s + (o.total ?? orderSubtotal(o, menuById)), 0)
  const covers = paid.reduce((s, o) => s + (o.covers ?? 2), 0)
  const avgCheck = paid.length ? sales / paid.length : 0
  const occupied = state.tables.filter((t) => ['seated', 'ordered', 'billed'].includes(t.status)).length
  const occupancy = state.tables.length ? occupied / state.tables.length : 0

  // Rolling 7-day food cost from history + tonight's theoretical
  const invById = Object.fromEntries(state.inventory.map((i) => [i.id, i]))
  let tonightFood = 0
  for (const o of state.orders) {
    if (o.status === 'void') continue
    for (const it of o.items) {
      const snap = it.recipeSnapshot
      const plate = snap?.plateCost ?? plateCostFor(state.recipes[it.menuItemId], invById)
      tonightFood += plate * (it.qty || 0)
    }
  }
  const tonightSales = state.orders
    .filter((o) => o.status !== 'void')
    .reduce((s, o) => s + (o.total ?? orderSubtotal(o, menuById)), 0)
  const tonightCostPct = tonightSales ? tonightFood / tonightSales : 0
  const hist = state.salesHistory.map((d) => d.foodCostPct)
  const foodCost7d = [...hist, tonightCostPct].reduce((a, b) => a + b, 0) / (hist.length + 1)

  // Kitchen SLA: avg fire-to-bump of bumped items tonight
  const bumped = state.orders.flatMap((o) => o.items).filter((i) => i.status === 'bump' && i.firedAt && i.bumpedAt)
  const avgTicketMin = bumped.length
    ? bumped.reduce((s, i) => s + (new Date(i.bumpedAt) - new Date(i.firedAt)) / 60000, 0) / bumped.length
    : 0

  // Top sellers + bottom contribution
  const qtyByMenu = {}
  for (const o of state.orders) {
    if (o.status === 'void') continue
    for (const it of o.items) qtyByMenu[it.menuItemId] = (qtyByMenu[it.menuItemId] || 0) + it.qty
  }
  const sellers = Object.entries(qtyByMenu)
    .map(([id, qty]) => ({ menu: menuById[id], qty }))
    .filter((r) => r.menu)
    .sort((a, b) => b.qty - a.qty)
  const withMargin = sellers.map((r) => {
    const { contribution, band } = costingFor(r.menu, state.recipes[r.menu.id], invById)
    return { ...r, contribution, band }
  })

  return {
    sales, covers, avgCheck, occupancy, foodCost7d, tonightCostPct,
    avgTicketMin, topSellers: sellers.slice(0, 5),
    bottomContribution: [...withMargin].sort((a, b) => a.contribution - b.contribution).slice(0, 5),
    openTickets: state.orders.filter((o) => !['paid', 'void'].includes(o.status)).length,
  }
}

export function tableName(state, tableId) {
  return state.tables.find((t) => t.id === tableId)?.name?.replace('Table ', '') || '—'
}

export function quoteWait(state, partySize) {
  return quoteWaitMinutes(partySize, state.turnHistory)
}

// ─── Provider ─────────────────────────────────────────────────────

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return null
    // Expired transient slots must not survive reload
    return { ...parsed, pendingUndo: null, recalls: {} }
  } catch {
    return null
  }
}

export function RestoraProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadPersisted() || buildSeed())
  const [role, setRole] = useState('owner')
  const [screen, setScreen] = useState('floor')
  // UI-only: which table the next screen should focus (e.g. Floor → Tickets handoff)
  const [selectedTableId, setSelectedTableId] = useState(null)
  // UI-only: which dish the Menu coster should open (Costing → Menu handoff)
  const [selectedDishId, setSelectedDishId] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage full/blocked — app still works in memory */
    }
  }, [state])

  // Expire the 15s undo window without user action
  useEffect(() => {
    if (!state.pendingUndo) return
    const ms = state.pendingUndo.expiresAt - Date.now()
    if (ms <= 0) {
      dispatch({ type: 'EXPIRE_UNDO' })
      return
    }
    const t = setTimeout(() => dispatch({ type: 'EXPIRE_UNDO' }), ms + 50)
    return () => clearTimeout(t)
  }, [state.pendingUndo])

  const value = useMemo(
    () => ({ state, dispatch, role, setRole, screen, setScreen, selectedTableId, setSelectedTableId, selectedDishId, setSelectedDishId }),
    [state, role, screen, selectedTableId, selectedDishId],
  )
  return <RestoraContext.Provider value={value}>{children}</RestoraContext.Provider>
}

export function useRestora() {
  const ctx = useContext(RestoraContext)
  if (!ctx) throw new Error('useRestora must be used inside RestoraProvider')
  return ctx
}

// Tick hook for live timers (KDS clocks, seated minutes, undo countdown)
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export { marginBandFor }
