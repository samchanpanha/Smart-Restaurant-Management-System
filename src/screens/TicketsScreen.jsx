// ─── Step 3: Tickets — order management ─────────────────────────────
// Jordan (server) builds, sends, modifies, and closes tickets without
// leaving table context. Send is the commit: 15s undo, then the
// kitchen owns the item. 86 blocked with substitute. Required mods
// enforced. Theoretical stock drops on fire (store), not on draft.

import { useCallback, useEffect, useMemo, useState } from 'react'
import StatusPill from '../components/StatusPill'
import { Field, Modal, Stepper, btnGhost, btnPrimary, inputCls } from '../components/ui'
import { TICKET_STATUS_META } from '../lib/constants'
import {
  buildInvoiceDocument, buildReceiptDocument, buildTicketDocument, documentFileName, downloadHtml,
  printHtml, renderDocumentHtml,
} from '../lib/documents'
import {
  translateCategory,
  translateCourse,
  translateDishName,
  translateModifier,
  translateTableName,
  translateTicketStatus,
  useI18n,
} from '../lib/i18n'
import { formatClock, minutesBetween, money, orderTotals } from '../lib/models'
import { documentNumber, sanitizeSettings } from '../lib/settings'
import { useNow, useRestora } from '../lib/store'

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

function openOrderForTable(orders, tableId) {
  return orders.find((o) => o.tableId === tableId && !['paid', 'void'].includes(o.status))
}

// ─── 15-second undo banner ──────────────────────────────────────

function UndoBanner({ orderId }) {
  const { state, dispatch } = useRestora()
  const now = useNow(250)
  const pu = state.pendingUndo
  if (!pu || pu.orderId !== orderId) return null
  const left = Math.max(0, Math.ceil((pu.expiresAt - now) / 1000))
  if (left <= 0) return null
  return (
    <div
      className="animate-status-in flex items-center justify-between gap-3 rounded-xl bg-sky-500/10 px-4 py-2.5 ring-1 ring-inset ring-sky-500/40"
      role="alert"
    >
      <div className="text-sm text-sky-200">
        Sent to kitchen — <strong>undo for {left}s</strong>, then the kitchen owns it.
      </div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'UNDO_SEND', orderId })}
        className="min-h-[44px] shrink-0 rounded-lg bg-sky-500 px-4 text-sm font-bold text-black hover:bg-sky-400"
      >
        Undo send
      </button>
    </div>
  )
}

// ─── Ticket list ────────────────────────────────────────────────

function TicketList({ tab, setTab, tableFilter, setTableFilter, serverFilter, setServerFilter, selectedId, onSelect, onNew }) {
  const { state } = useRestora()
  const { lang, dict } = useI18n()
  const tk = dict.tickets || {}
  useNow(30000)
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const tableById = useMemo(() => Object.fromEntries(state.tables.map((t) => [t.id, t])), [state.tables])

  const counts = useMemo(() => {
    const c = {}
    for (const t of TABS) c[t.id] = state.orders.filter((o) => t.match(o.status)).length
    return c
  }, [state.orders])

  const activeTab = TABS.find((t) => t.id === tab)
  const list = state.orders
    .filter((o) => activeTab.match(o.status))
    .filter((o) => !tableFilter || o.tableId === tableFilter)
    .filter((o) => !serverFilter || o.serverId === serverFilter)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const tablesWithTickets = useMemo(
    () => [...new Set(state.orders.map((o) => o.tableId).filter(Boolean))],
    [state.orders],
  )

  const tabLabels = {
    active: tk.activeTab || 'Active',
    ready: tk.readyTab || 'Ready',
    paid: tk.paidTab || 'Paid',
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 rounded-xl bg-[var(--color-ink-900)] p-1.5 ring-1 ring-inset ring-[var(--color-ink-700)]" role="tablist" aria-label="Ticket status">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] flex-1 rounded-lg px-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/40' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tabLabels[t.id] || t.label} · {counts[t.id]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} className={inputCls} aria-label="Filter by table">
          <option value="">{tk.allTables || 'All tables'}</option>
          {tablesWithTickets.map((tid) => (
            <option key={tid} value={tid}>
              {translateTableName(tableById[tid]?.name || tid, lang)}
            </option>
          ))}
        </select>
        <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} className={inputCls} aria-label="Filter by server">
          <option value="">{tk.allServers || 'All servers'}</option>
          <option value="server">Jordan</option>
        </select>
      </div>

      <button type="button" onClick={onNew} className={btnGhost}>
        + {tk.newOrder || 'New check'}
      </button>

      <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
        {list.length === 0 && (
          <li className="rounded-xl border border-dashed border-[var(--color-ink-600)] p-4 text-center text-sm text-zinc-500">
            No {activeTab.label.toLowerCase()} tickets.
          </li>
        )}
        {list.map((o) => {
          const t = orderTotals(o, menuById, 0)
          const held = o.items.filter((i) => i.status === 'held' && !i.voided).length
          const meta = TICKET_STATUS_META[o.status]
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onSelect(o.id)}
                aria-current={selectedId === o.id}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  selectedId === o.id
                    ? 'border-amber-500/60 bg-[var(--color-ink-850)] ring-1 ring-amber-500/40'
                    : 'border-[var(--color-ink-700)] bg-[var(--color-ink-900)] hover:border-[var(--color-ink-600)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{translateTableName(tableById[o.tableId]?.name || o.type, lang)}</span>
                  <StatusPill tone={meta.tone} size="sm">
                    {translateTicketStatus(o.status, lang)}
                  </StatusPill>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    {o.items.length} item{o.items.length === 1 ? '' : 's'}
                    {held > 0 && <span className="font-semibold text-amber-300"> · {held} held</span>}
                    {' · '}{serverName(o.serverId)} · {minutesBetween(o.createdAt)}m
                  </span>
                  <span className="tnum font-bold text-zinc-200">{money(t.subtotal)}</span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Modifier picker ────────────────────────────────────────────

function ModifierModal({ item, course, onAdd, onClose }) {
  const [picks, setPicks] = useState({})
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')
  const required = (item.modifiers || []).filter((g) => g.required)
  const ready = required.every((g) => picks[g.id])

  return (
    <Modal title={item.name} sub={`${money(item.price)} · pick required modifiers`} onClose={onClose}>
      <div className="mt-3 space-y-4">
        {(item.modifiers || []).map((g) => (
          <Field key={g.id} label={`${g.label}${g.required ? ' · required' : ''}`}>
            <div className="flex flex-wrap gap-2">
              {g.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setPicks((p) => ({ ...p, [g.id]: opt }))}
                  className={`min-h-[44px] rounded-lg px-3.5 text-sm font-semibold ring-1 ring-inset transition-colors ${
                    picks[g.id] === opt
                      ? 'bg-amber-500 text-black ring-amber-500'
                      : 'bg-[var(--color-ink-800)] text-zinc-200 ring-[var(--color-ink-600)] hover:bg-white/5'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </Field>
        ))}
        <div className="flex items-end justify-between gap-4">
          <Field label="Qty">
            <Stepper value={qty} onChange={setQty} max={12} />
          </Field>
          <span className="pb-3 text-xs text-zinc-500">
            Course: <strong className="text-zinc-200">{courseLabel(course)}</strong>
          </span>
        </div>
        <Field label="Note (optional)">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergy, extra sauce…" className={inputCls} maxLength={80} />
        </Field>
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            onAdd({
              modifiers: Object.entries(picks).map(([id, value]) => ({ id, value })),
              qty,
              notes,
            })
          }
          className={btnPrimary}
        >
          {ready ? `Add ${qty} × ${item.name}` : 'Pick required modifiers to add'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Composer ───────────────────────────────────────────────────

function Composer({ order, onError }) {
  const { state, dispatch } = useRestora()
  const [category, setCategory] = useState('Mains')
  const [query, setQuery] = useState('')
  const [course, setCourse] = useState('main')
  const [modFor, setModFor] = useState(null)

  const activeMenu = useMemo(() => state.menu.filter((m) => m.active !== false), [state.menu])
  const categories = useMemo(() => [...new Set(activeMenu.map((m) => m.category))], [activeMenu])
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])

  const { lang, dict } = useI18n()
  const tk = dict.tickets || {}
  const items = activeMenu.filter((m) => {
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      return m.name.toLowerCase().includes(q) || translateDishName(m, lang).toLowerCase().includes(q)
    }
    return m.category === category
  })

  function addDirect(menuItem, extra = {}) {
    dispatch({
      type: 'ADD_ITEM',
      orderId: order.id,
      menuItemId: menuItem.id,
      qty: 1,
      modifiers: [],
      course,
      notes: '',
      ...extra,
    })
  }

  function tap(menuItem) {
    if (!menuItem.available) return // blocked card handles substitute
    if ((menuItem.modifiers || []).length) {
      setModFor(menuItem)
    } else {
      addDirect(menuItem)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">{tk.addItems || 'Add items'}</h3>
        <div className="flex gap-1 rounded-lg bg-black/30 p-1" role="group" aria-label="Course for new items">
          {COURSES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCourse(c.id)}
              aria-pressed={course === c.id}
              className={`min-h-[36px] rounded-md px-3 text-xs font-bold transition-colors ${
                course === c.id ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {translateCourse(c.id, lang)}
            </button>
          ))}
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tk.searchMenu || 'Search menu…'}
        aria-label="Search menu"
        className={`${inputCls} mt-3`}
      />

      {!query.trim() && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Menu categories">
          {categories.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={category === c}
              type="button"
              onClick={() => setCategory(c)}
              className={`min-h-[44px] shrink-0 rounded-lg px-3.5 text-sm font-semibold transition-colors ${
                category === c ? 'bg-white/10 text-zinc-100 ring-1 ring-inset ring-white/20' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {translateCategory(c, lang)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((m) => {
          const sub = m.substituteId ? menuById[m.substituteId] : null
          const localName = translateDishName(m, lang)
          if (!m.available) {
            return (
              <div
                key={m.id}
                className="rounded-xl border border-red-500/30 bg-red-500/5 p-3"
                aria-label={`${m.name}, 86'd, unavailable`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold text-zinc-400 line-through">{localName}</span>
                  <StatusPill tone="bad" size="sm">
                    86
                  </StatusPill>
                </div>
                <div className="tnum mt-0.5 text-xs text-zinc-500">{money(m.price)}</div>
                {sub && sub.available && sub.active !== false ? (
                  <button
                    type="button"
                    onClick={() => tap(sub)}
                    className="mt-2 min-h-[36px] w-full rounded-lg bg-white/5 px-2 text-xs font-semibold text-sky-300 ring-1 ring-inset ring-sky-500/30 hover:bg-white/10"
                  >
                    Suggest {translateDishName(sub, lang)} →
                  </button>
                ) : (
                  <div className="mt-2 text-[11px] text-zinc-600">No substitute mapped</div>
                )}
              </div>
            )
          }
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => tap(m)}
              className="min-h-[72px] rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] p-3 text-left transition-all hover:border-amber-500/50 active:scale-[0.98]"
            >
              <div className="text-sm font-semibold leading-tight text-zinc-100">{localName}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="tnum text-sm font-bold text-amber-300">{money(m.price)}</span>
                {(m.modifiers || []).some((g) => g.required) && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">mods*</span>
                )}
              </div>
            </button>
          )
        })}
        {items.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[var(--color-ink-600)] p-4 text-center text-sm text-zinc-500">
            No dishes match “{query}”.
          </div>
        )}
      </div>

      {modFor && (
        <ModifierModal
          item={modFor}
          course={course}
          onClose={() => setModFor(null)}
          onAdd={(extra) => {
            addDirect(modFor, extra)
            setModFor(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Reason modal (comp / void) ──────────────────────────────────

const QUICK_REASONS = ['Kitchen error', 'Guest unhappy', 'Long wait', 'Manager comp']

function ReasonModal({ title, sub, manager = false, confirmLabel, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [mgr, setMgr] = useState(false)
  const ok = reason.trim().length > 0 && (!manager || mgr)
  return (
    <Modal title={title} sub={sub} onClose={onClose}>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`min-h-[44px] rounded-lg px-3 text-xs font-semibold ring-1 ring-inset ${
                reason === r ? 'bg-white/10 text-zinc-100 ring-white/30' : 'text-zinc-400 ring-[var(--color-ink-600)] hover:bg-white/5'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <Field label="Reason (required)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" className={inputCls} maxLength={80} />
        </Field>
        {manager && (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl bg-red-500/10 px-3 text-sm text-red-200 ring-1 ring-inset ring-red-500/40">
            <input type="checkbox" checked={mgr} onChange={(e) => setMgr(e.target.checked)} className="h-5 w-5 accent-red-500" />
            Manager override — I approve this void
          </label>
        )}
        <button type="button" disabled={!ok} onClick={() => onConfirm(reason.trim())} className={btnPrimary}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

// ─── Pay modal ──────────────────────────────────────────────────

function PayModal({ order, onClose }) {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const t = orderTotals(order, menuById, state.settings.taxPct)
  const [method, setMethod] = useState('card')
  const [split, setSplit] = useState('full')
  const [ways, setWays] = useState(2)
  const [seats, setSeats] = useState(2)
  const [curSeat, setCurSeat] = useState(0)
  const [assign, setAssign] = useState({}) // itemId -> seat idx

  const seatNames = useMemo(() => Array.from({ length: seats }, (_, i) => `Seat ${String.fromCharCode(65 + i)}`), [seats])
  const unassigned = t.lines.filter((l) => assign[l.id] == null || assign[l.id] >= seats)
  const seatTotals = useMemo(() => {
    const subs = Array.from({ length: seats }, () => 0)
    for (const l of t.lines) {
      const s = assign[l.id]
      if (s != null && s < seats) subs[s] += l.lineTotal
    }
    return subs.map((sub) => ({ sub, tax: sub * state.settings.taxPct, total: sub * (1 + state.settings.taxPct) }))
  }, [t.lines, assign, seats, state.settings.taxPct])

  const canClose = split !== 'byitem' || unassigned.length === 0

  function close() {
    const summary =
      split === 'full'
        ? { kind: 'full' }
        : split === 'even'
          ? { kind: 'even', ways, each: Math.round((t.total / ways) * 100) / 100 }
          : { kind: 'byitem', seats, totals: seatTotals.map((s) => Math.round(s.total * 100) / 100) }
    dispatch({ type: 'PAY_ORDER', orderId: order.id, method, split: summary })
    onClose()
  }

  return (
    <Modal title="Close check" sub={`${order.items.length} lines · tax ${(state.settings.taxPct * 100).toFixed(2)}%`} onClose={onClose} wide>
      <ul className="mt-3 max-h-44 space-y-1 overflow-y-auto text-sm">
        {t.lines.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              disabled={split !== 'byitem'}
              onClick={() => setAssign((a) => ({ ...a, [l.id]: curSeat }))}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 ${
                split === 'byitem' ? 'hover:bg-white/5 ring-1 ring-inset ring-transparent hover:ring-[var(--color-ink-600)]' : ''
              }`}
            >
              <span className="text-zinc-200">
                {l.qty}× {l.name}
                {split === 'byitem' && (
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${assign[l.id] != null && assign[l.id] < seats ? 'bg-sky-500/20 text-sky-300' : 'bg-red-500/15 text-red-300'}`}>
                    {assign[l.id] != null && assign[l.id] < seats ? seatNames[assign[l.id]] : 'tap to assign'}
                  </span>
                )}
              </span>
              <span className="tnum text-zinc-300">{money(l.lineTotal)}</span>
            </button>
          </li>
        ))}
        {order.items.filter((i) => i.comped && !i.voided).length > 0 && (
          <li className="px-2.5 py-1 text-xs text-zinc-500">
            Comped {money(t.compTotal)} — removed from bill, kept for audit.
          </li>
        )}
      </ul>

      <div className="mt-3 flex gap-1.5 rounded-xl bg-black/30 p-1.5" role="tablist" aria-label="Split mode">
        {[
          ['full', 'Pay full'],
          ['even', 'Split even'],
          ['byitem', 'Split by item'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={split === id}
            type="button"
            onClick={() => setSplit(id)}
            className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold ${split === id ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {split === 'even' && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <Field label="Split ways">
            <Stepper value={ways} onChange={setWays} min={2} max={8} />
          </Field>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500">each pays</div>
            <div className="tnum text-2xl font-bold text-amber-300">{money(t.total / ways)}</div>
          </div>
        </div>
      )}

      {split === 'byitem' && (
        <div className="mt-3 space-y-2 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <div className="flex items-center justify-between gap-3">
            <Field label="Seats">
              <Stepper value={seats} onChange={(v) => { setSeats(v); setCurSeat(0) }} min={2} max={6} />
            </Field>
            <div className="flex flex-wrap justify-end gap-1.5">
              {seatNames.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCurSeat(i)}
                  aria-pressed={curSeat === i}
                  className={`min-h-[44px] rounded-lg px-3 text-xs font-bold ring-1 ring-inset ${curSeat === i ? 'bg-sky-500 text-black ring-sky-500' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'}`}
                >
                  {n}
                  <span className="tnum ml-1 opacity-80">{money(seatTotals[i].total)}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Pick a seat, then tap lines above to assign. {unassigned.length > 0 ? <strong className="text-red-300">{unassigned.length} unassigned.</strong> : <strong className="text-emerald-300">All assigned.</strong>}
          </p>
        </div>
      )}

      <div className="mt-3 space-y-1 rounded-xl bg-[var(--color-ink-800)] p-3 text-sm ring-1 ring-inset ring-[var(--color-ink-600)]">
        <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span className="tnum">{money(t.subtotal)}</span></div>
        <div className="flex justify-between text-zinc-400"><span>Tax</span><span className="tnum">{money(t.tax)}</span></div>
        <div className="flex justify-between border-t border-white/10 pt-1.5 text-base font-bold"><span>Total due</span><span className="tnum text-amber-300">{money(t.total)}</span></div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Payment method">
        {['card', 'cash'].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            aria-pressed={method === m}
            className={`min-h-[44px] rounded-lg text-sm font-bold capitalize ring-1 ring-inset ${method === m ? 'bg-white/10 text-zinc-100 ring-white/30' : 'text-zinc-500 ring-[var(--color-ink-600)] hover:bg-white/5'}`}
          >
            {m}
          </button>
        ))}
      </div>

      <button type="button" disabled={!canClose || t.lines.length === 0} onClick={close} className={`${btnPrimary} mt-3`}>
        {t.lines.length === 0
          ? 'Nothing billable on this check'
          : canClose
            ? `Collect ${money(t.total)} · Close check`
            : `Assign all items to close (${unassigned.length} left)`}
      </button>
    </Modal>
  )
}

// ─── Ticket workspace ───────────────────────────────────────────

function HeldLine({ order, item }) {
  const { dispatch } = useRestora()
  const { state } = useRestora()
  const { lang } = useI18n()
  const menu = state.menu.find((m) => m.id === item.menuItemId)
  return (
    <li className="rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">
            {translateDishName(menu, lang)}
            {item.by === 'guest' && (
              <span className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-violet-300 ring-1 ring-inset ring-violet-500/40">
                QR{item.guest ? ` · ${item.guest}` : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="rounded bg-black/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide">{translateCourse(item.course, lang)}</span>
            {item.modifiers?.map((m) => (
              <span key={m.id} className="rounded bg-black/40 px-1.5 py-0.5">{translateModifier(m.value, lang)}</span>
            ))}
            {item.notes && <span className="italic">“{item.notes}”</span>}
          </div>
        </div>
        <span className="tnum shrink-0 text-sm font-bold text-zinc-200">{money((menu?.price ?? 0) * item.qty)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`Decrease ${menu?.name} quantity`}
            onClick={() => (item.qty <= 1
              ? dispatch({ type: 'REMOVE_ITEM', orderId: order.id, itemId: item.id })
              : dispatch({ type: 'UPDATE_ITEM', orderId: order.id, itemId: item.id, patch: { qty: item.qty - 1 } }))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-lg hover:bg-white/5"
          >
            −
          </button>
          <span className="tnum w-6 text-center text-sm font-bold" aria-live="polite">{item.qty}</span>
          <button
            type="button"
            aria-label={`Increase ${menu?.name} quantity`}
            onClick={() => dispatch({ type: 'UPDATE_ITEM', orderId: order.id, itemId: item.id, patch: { qty: item.qty + 1 } })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-lg hover:bg-white/5"
          >
            +
          </button>
          <select
            value={item.course}
            onChange={(e) => dispatch({ type: 'UPDATE_ITEM', orderId: order.id, itemId: item.id, patch: { course: e.target.value } })}
            className="ml-1 h-9 rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-2 text-xs"
            aria-label="Course"
          >
            {COURSES.map((c) => <option key={c.id} value={c.id}>{translateCourse(c.id, lang)}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'REMOVE_ITEM', orderId: order.id, itemId: item.id })}
          className="min-h-[36px] rounded-lg px-3 text-xs text-zinc-500 hover:bg-white/5 hover:text-red-300"
        >
          Remove
        </button>
      </div>
    </li>
  )
}

function FiredLine({ order, item, onComp, onVoid }) {
  const { state } = useRestora()
  const { lang } = useI18n()
  const menu = state.menu.find((m) => m.id === item.menuItemId)
  const bumped = item.status === 'bump'
  return (
    <li className={`rounded-xl p-3 ring-1 ring-inset ${item.voided ? 'bg-black/30 opacity-70 ring-[var(--color-ink-700)]' : 'bg-[var(--color-ink-800)] ring-[var(--color-ink-600)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${item.voided ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>
            {item.qty}× {translateDishName(menu, lang)}
            {item.by === 'guest' && (
              <span className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-violet-300 ring-1 ring-inset ring-violet-500/40">
                QR{item.guest ? ` · ${item.guest}` : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="rounded bg-black/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide">{translateCourse(item.course, lang)}</span>
            {item.modifiers?.map((m) => (
              <span key={m.id} className="rounded bg-black/40 px-1.5 py-0.5">{translateModifier(m.value, lang)}</span>
            ))}
            {item.firedAt && !item.voided && <span>fired {formatClock(item.firedAt)}</span>}
            {item.comped && <span className="text-amber-300">comped · {item.compReason}</span>}
            {item.voided && <span className="text-red-300">void · {item.voidReason}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!item.voided && !item.comped && (
            <StatusPill tone={bumped ? 'ok' : 'warn'} size="sm">
              {bumped ? 'Bumped' : 'Fired'}
            </StatusPill>
          )}
          {item.comped && !item.voided && <StatusPill tone="warn" size="sm">Comped</StatusPill>}
          <span className="tnum text-sm font-bold text-zinc-200">{money((menu?.price ?? 0) * item.qty)}</span>
        </div>
      </div>
      {!item.voided && !item.comped && !['paid', 'void'].includes(order.status) && (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => onComp(item)} className="min-h-[36px] flex-1 rounded-lg border border-[var(--color-ink-600)] text-xs text-zinc-300 hover:bg-white/5">
            Comp (reason)
          </button>
          <button type="button" onClick={() => onVoid(item)} className="min-h-[36px] flex-1 rounded-lg border border-red-500/40 text-xs text-red-300 hover:bg-red-500/10">
            Void (manager)
          </button>
        </div>
      )}
    </li>
  )
}

function TicketWorkspace({ orderId, onError }) {
  const { state, dispatch, issueDocument, link, locId } = useRestora()
  useNow(15000)
  const [paying, setPaying] = useState(false)
  const [banner, setBanner] = useState(null)
  const [reasonCtx, setReasonCtx] = useState(null) // { kind: 'comp'|'voidItem'|'voidOrder', item? }

  const order = state.orders.find((o) => o.id === orderId)
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const table = order ? state.tables.find((t) => t.id === order.tableId) : null

  if (!order) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-ink-600)] p-10 text-center">
        <div className="text-lg font-bold">No ticket selected</div>
        <p className="mt-1 text-sm text-zinc-500">Pick a ticket on the left, or start a new check. Floor handoffs land here automatically.</p>
      </div>
    )
  }

  const t = orderTotals(order, menuById, state.settings.taxPct)
  const meta = TICKET_STATUS_META[order.status]
  const held = order.items.filter((i) => i.status === 'held' && !i.voided)
  const fired = order.items.filter((i) => i.status !== 'held' || i.voided)
  const closed = ['paid', 'void'].includes(order.status)
  const heldByCourse = COURSES.map((c) => ({ ...c, lines: held.filter((i) => i.course === c.id) })).filter((c) => c.lines.length)

  function send(courses) {
    const before = held.length
    dispatch({ type: 'SEND_ORDER', orderId: order.id, courses })
    if (before === 0) onError('Nothing held to send.')
  }

  function flash(message) {
    setBanner(message)
    window.setTimeout(() => setBanner(null), 4200)
  }

  // Documents come straight from the ticket of record and print with the
  // location's configured template. Filing records the number; a plain
  // print leaves the sequence untouched.
  function documentFor(kind) {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    const shop = { ...state, settings }
    if (kind === 'invoice') return buildInvoiceDocument({ shop, order, settings })
    if (kind === 'receipt') return buildReceiptDocument({ shop, order, settings })
    return buildTicketDocument({ shop, order, settings })
  }

  function printDocument(kind, { file = false } = {}) {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    let doc = documentFor(kind)
    if (!doc) return
    if (file) {
      const saved = issueDocument(kind, { document: doc })
      if (saved) doc = { ...doc, number: saved.number }
    } else {
      // Same formatter the reducer uses when filing — preview matches the
      // number the document will actually get.
      doc = { ...doc, number: `${documentNumber(settings, kind, settings.numbering[kind].next)} (preview)` }
    }
    printHtml(renderDocumentHtml(doc, settings, {}), { title: `${doc.title} ${doc.number}` })
    flash(`${doc.title} sent to the printer${file ? ` — filed as ${doc.number}` : ''}.`)
  }

  function downloadDocument(kind) {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    const doc = documentFor(kind)
    if (!doc) return
    downloadHtml(renderDocumentHtml(doc, settings, {}), documentFileName(doc, settings))
    flash(`${doc.title} downloaded as HTML.`)
  }

  return (
    <div className="space-y-4">
      <UndoBanner orderId={order.id} />
      {(order.billRequested || table?.serverCalledAt) && !closed && (
        <div className="animate-status-in flex flex-wrap items-center justify-between gap-2 rounded-xl bg-violet-500/10 px-4 py-2.5 ring-1 ring-inset ring-violet-500/40" role="alert">
          <div className="text-sm text-violet-200">
            {order.billRequested && <><strong>Guest requested the bill</strong> · </>}
            {table?.serverCalledAt && <><strong>Guest is calling you</strong> · </>}
            <span className="text-violet-200/70">from QR ordering</span>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'ACK_REQUESTS', orderId: order.id, tableId: order.tableId })}
            className="min-h-[44px] shrink-0 rounded-lg bg-violet-500 px-4 text-sm font-bold text-white hover:bg-violet-400"
          >
            On my way
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{table?.name || order.type}</h2>
            <div className="mt-0.5 text-xs text-zinc-400">
              {serverName(order.serverId)} · opened {formatClock(order.createdAt)} · {minutesBetween(order.createdAt)}m ago
              {order.sentAt && <> · sent {formatClock(order.sentAt)}</>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            <span className="tnum text-xl font-bold">{money(t.subtotal)}</span>
          </div>
        </div>

        {!closed && (
          <div className="mt-3 flex flex-wrap gap-2">
            {order.status === 'ready' && (
              <button type="button" onClick={() => dispatch({ type: 'SERVE_ORDER', orderId: order.id })} className="min-h-[44px] flex-1 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-black hover:bg-emerald-400">
                Mark served
              </button>
            )}
            <button
              type="button"
              onClick={() => (held.length ? onError('Send held items before payment — the kitchen must see the whole ticket.') : setPaying(true))}
              className="min-h-[44px] flex-1 rounded-lg bg-amber-500 px-3 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40"
              disabled={t.lines.length === 0 || order.status === 'open'}
            >
              Pay · {money(t.total)}
            </button>
            <button
              type="button"
              onClick={() => setReasonCtx({ kind: 'voidOrder' })}
              className="min-h-[44px] rounded-lg border border-red-500/40 px-4 text-sm font-semibold text-red-300 hover:bg-red-500/10"
            >
              Void check
            </button>
          </div>
        )}
        {order.status === 'paid' && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-500/30">
            <span>
              Paid {order.paidAt && formatClock(order.paidAt)} · {order.payMethod}
              {order.split ? ` · ${order.split.kind === 'full' ? 'full' : order.split.kind === 'even' ? `split ${order.split.ways} ways` : `split by item (${order.split.seats} seats)`}` : ''} · {money(order.total ?? t.subtotal)}
            </span>
            <button
              type="button"
              onClick={() => printDocument('receipt', { file: true })}
              className="min-h-[36px] shrink-0 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-black hover:bg-emerald-400"
            >
              Print &amp; file receipt
            </button>
          </div>
        )}
      </div>

      {banner && (
        <div className="animate-status-in rounded-xl bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200 ring-1 ring-inset ring-sky-500/30" role="status">
          {banner}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Documents</span>
        <button
          type="button"
          onClick={() => printDocument('receipt', { file: order.status === 'paid' })}
          className="min-h-[36px] rounded-lg bg-amber-500 px-3 text-xs font-bold text-black hover:bg-amber-400"
        >
          Print receipt
        </button>
        <button type="button" onClick={() => printDocument('invoice')} className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5">
          Print invoice
        </button>
        <button type="button" onClick={() => printDocument('ticket')} className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5">
          Kitchen ticket
        </button>
        <button type="button" onClick={() => downloadDocument('invoice')} className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5">
          Download
        </button>
        <span className="ml-auto text-[11px] text-zinc-500">
          Template set in Settings → Documents {link.status === 'live' ? `· ${locId}` : '· offline terminal'}
        </span>
      </div>

      {!closed && held.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-amber-200/80">
              Held · not yet sent ({held.length})
            </h3>
          </div>
          <ul className="mt-3 space-y-2">
            {held.map((i) => <HeldLine key={i.id} order={order} item={i} />)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {heldByCourse.length > 1 && heldByCourse.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => send([c.id])}
                className="min-h-[44px] flex-1 rounded-lg border border-amber-500/50 px-3 text-sm font-bold text-amber-200 hover:bg-amber-500/10"
              >
                Fire {c.label} ({c.lines.reduce((s, l) => s + l.qty, 0)})
              </button>
            ))}
            <button type="button" onClick={() => send()} className="min-h-[44px] flex-[2] rounded-lg bg-amber-500 px-3 text-sm font-bold text-black hover:bg-amber-400">
              Send {heldByCourse.length > 1 ? 'all held' : `${heldByCourse[0]?.label || ''} `}({held.reduce((s, l) => s + l.qty, 0)}) → kitchen
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">Sending is the commit — 15s undo, then the kitchen owns it. Stock drops on fire.</p>
        </div>
      )}

      {fired.length > 0 && (
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
            In kitchen / served ({fired.length})
          </h3>
          <ul className="mt-3 space-y-2">
            {fired.map((i) => (
              <FiredLine
                key={i.id}
                order={order}
                item={i}
                onComp={(item) => setReasonCtx({ kind: 'comp', item })}
                onVoid={(item) => setReasonCtx({ kind: 'voidItem', item })}
              />
            ))}
          </ul>
        </div>
      )}

      {!closed && <Composer order={order} onError={onError} />}

      {paying && <PayModal order={order} onClose={() => setPaying(false)} />}

      {reasonCtx?.kind === 'comp' && (
        <ReasonModal
          title={`Comp ${state.menu.find((m) => m.id === reasonCtx.item.menuItemId)?.name}`}
          sub="Comped lines leave the bill but stay on the record."
          confirmLabel="Comp with reason"
          onClose={() => setReasonCtx(null)}
          onConfirm={(reason) => {
            dispatch({ type: 'COMP_ITEM', orderId: order.id, itemId: reasonCtx.item.id, reason })
            setReasonCtx(null)
          }}
        />
      )}
      {reasonCtx?.kind === 'voidItem' && (
        <ReasonModal
          title="Void line (manager)"
          sub="Fired food already left stock — the void removes the charge, not the history."
          manager
          confirmLabel="Void line"
          onClose={() => setReasonCtx(null)}
          onConfirm={(reason) => {
            dispatch({ type: 'VOID_ITEM', orderId: order.id, itemId: reasonCtx.item.id, reason })
            setReasonCtx(null)
          }}
        />
      )}
      {reasonCtx?.kind === 'voidOrder' && (
        <ReasonModal
          title="Void entire check (manager)"
          sub="The table returns through the bus flow. Paid checks cannot be voided."
          manager
          confirmLabel="Void check"
          onClose={() => setReasonCtx(null)}
          onConfirm={(reason) => {
            dispatch({ type: 'VOID_ORDER', orderId: order.id, reason })
            setReasonCtx(null)
          }}
        />
      )}
    </div>
  )
}

// ─── New check ──────────────────────────────────────────────────

function NewCheckModal({ onClose, onCreated }) {
  const { state, dispatch } = useRestora()
  const candidates = state.tables.filter(
    (t) => (t.status === 'seated' || t.status === 'ordered') && !openOrderForTable(state.orders, t.id),
  )
  const [tableId, setTableId] = useState(candidates[0]?.id || '')

  if (!candidates.length) {
    return (
      <Modal title="New check" sub="No tables are waiting for a check." onClose={onClose}>
        <p className="mt-2 text-sm text-zinc-400">Seat a party on the Floor first — checks attach to seated tables.</p>
        <button type="button" onClick={onClose} className={`${btnGhost} mt-4`}>Back</button>
      </Modal>
    )
  }

  return (
    <Modal title="New check" sub="Attach a ticket to a seated table." onClose={onClose}>
      <div className="mt-3 space-y-3">
        <Field label="Table">
          <select value={tableId} onChange={(e) => setTableId(e.target.value)} className={inputCls}>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · party of {t.partySize} · {t.status}</option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            dispatch({ type: 'CREATE_ORDER', tableId })
            onCreated(tableId)
          }}
        >
          Start check
        </button>
      </div>
    </Modal>
  )
}

// ─── Screen ─────────────────────────────────────────────────────

export default function TicketsScreen() {
  const { state, dispatch, selectedTableId, setSelectedTableId, selectedOrderId, setSelectedOrderId, tabCtx, setTabCtx } = useRestora()
  const { lang, dict } = useI18n()
  const tk = dict.tickets || {}
  const [tab, setTab] = useState('active')
  const [tableFilter, setTableFilter] = useState('')
  const [serverFilter, setServerFilter] = useState('')
  const [selectedId, setSelectedId] = useState(tabCtx.ticketOrder || null)
  const [newOpen, setNewOpen] = useState(false)
  const [pendingTable, setPendingTable] = useState(null)
  const [banner, setBanner] = useState(null)

  function flash(msg) {
    setBanner(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setBanner(null), 4200)
  }

  // The open check lives on the tab, so switching tabs and back keeps it.
  const selectOrder = useCallback((id) => {
    setSelectedId(id)
    setTabCtx({ ticketOrder: id || null })
  }, [setTabCtx])

  // Search/Floor handoff opens the exact order or starts a check for a selected table.
  useEffect(() => {
    if (selectedOrderId) {
      const order = state.orders.find((item) => item.id === selectedOrderId)
      if (order) {
        selectOrder(order.id)
        setTab(TABS.find((item) => item.match(order.status))?.id || 'active')
      }
      setSelectedOrderId(null)
      return
    }
    if (!selectedTableId) return
    const table = state.tables.find((item) => item.id === selectedTableId)
    if (!table) return
    const existing = openOrderForTable(state.orders, selectedTableId)
    if (existing) {
      selectOrder(existing.id)
      setTab(TABS.find((item) => item.match(existing.status))?.id || 'active')
    } else if (table.status === 'seated' || table.status === 'ordered') {
      setPendingTable(selectedTableId)
      dispatch({ type: 'CREATE_ORDER', tableId: selectedTableId })
    }
    setSelectedTableId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableId, selectedOrderId])

  // Select a freshly created check once the reducer commits it.
  useEffect(() => {
    if (!pendingTable) return
    const created = openOrderForTable(state.orders, pendingTable)
    if (created) {
      selectOrder(created.id)
      setTab('active')
      setPendingTable(null)
    }
  }, [state.orders, pendingTable, selectOrder])

  // Keep selection valid as tickets pay/void
  useEffect(() => {
    if (selectedId && !state.orders.some((o) => o.id === selectedId)) selectOrder(null)
  }, [state.orders, selectedId, selectOrder])

  const activeOrders = state.orders.filter((order) => ['open', 'sent', 'in_prep'].includes(order.status)).length
  const readyOrders = state.orders.filter((order) => ['ready', 'served'].includes(order.status)).length
  const completedOrders = state.orders.filter((order) => order.status === 'paid').length

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">
            {tk.kicker || 'Live service'}
            {lang !== 'en' && <span className="sr-only"> Live service</span>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            {tk.title || 'Orders'}
            {lang !== 'en' && <span className="sr-only"> Orders</span>}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {tk.subtitle || 'Track and manage every order in real time.'}
            {lang !== 'en' && <span className="sr-only"> Track and manage every order in real time.</span>}
          </p>
        </div>
        <button type="button" onClick={() => setNewOpen(true)} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-orange-600">
          ＋ {tk.newOrder || 'New order'}
        </button>
      </header>

      {banner && (
        <div className="animate-status-in rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-inset ring-amber-500/40" role="alert">
          {banner}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: tk.activeOrders || 'Active orders', value: activeOrders, note: tk.activeTab || 'In progress', tone: 'orange' },
          { label: tk.readyOrders || 'Ready to serve', value: readyOrders, note: tk.readyTab || 'Kitchen complete', tone: 'green' },
          { label: tk.completedChecks || 'Completed checks', value: completedOrders, note: tk.paidTab || 'Paid tonight', tone: 'blue' },
        ].map((item) => <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm"><span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold ${item.tone === 'green' ? 'bg-emerald-50 text-emerald-700' : item.tone === 'blue' ? 'bg-sky-50 text-sky-700' : 'bg-orange-50 text-orange-600'}`}>{item.tone === 'green' ? '✓' : item.tone === 'blue' ? '$' : '▤'}</span><span><span className="tnum block text-xl font-bold text-zinc-900">{item.value}</span><span className="mt-0.5 block text-xs font-semibold text-zinc-700">{item.label}</span><span className="block text-[10px] text-zinc-500">{item.note}</span></span></div>)}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <TicketList
          tab={tab}
          setTab={setTab}
          tableFilter={tableFilter}
          setTableFilter={setTableFilter}
          serverFilter={serverFilter}
          setServerFilter={setServerFilter}
          selectedId={selectedId}
          onSelect={selectOrder}
          onNew={() => setNewOpen(true)}
        />
        <div className="xl:col-span-2">
          <TicketWorkspace orderId={selectedId} onError={flash} />
        </div>
      </div>

      {newOpen && (
        <NewCheckModal
          onClose={() => setNewOpen(false)}
          onCreated={(tableId) => {
            setNewOpen(false)
            setTableFilter('')
            setPendingTable(tableId)
          }}
        />
      )}
    </div>
  )
}
