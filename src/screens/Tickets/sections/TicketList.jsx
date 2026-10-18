import { useMemo } from 'react'
import StatusPill from '../../../components/StatusPill'
import FilterPresetsBar from '../../../components/FilterPresetsBar'
import { btnGhost, inputCls } from '../../../components/ui'
import { DELIVERY_STATUS_META, TICKET_STATUS_META } from '../../../lib/constants'
import { translateTableName, translateTicketStatus, useI18n } from '../../../lib/i18n'
import { minutesBetween, money, orderTotals } from '../../../lib/models'
import { useNow, useRestora } from '../../../lib/store'
import { ORDER_TYPE_LABEL, ORDER_TYPES, TABS, serverName, orderLabel } from '../shared.js'

function TicketList({ tab, setTab, tableFilter, setTableFilter, serverFilter, setServerFilter, typeFilter, setTypeFilter, selectedId, onSelect, onNew }) {
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
    .filter((o) => !typeFilter || o.type === typeFilter)
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
            aria-label={t.label}
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

      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={inputCls} aria-label="Filter by order type">
        <option value="">All order types</option>
        {ORDER_TYPES.map((type) => (
          <option key={type.id} value={type.id}>{ORDER_TYPE_LABEL[type.id] || type.label}</option>
        ))}
      </select>

      <FilterPresetsBar
        screenKey="tickets"
        currentFilters={{ tab, tableFilter, serverFilter, typeFilter }}
        onApply={(f) => {
          if (f.tab) setTab(f.tab)
          if (f.tableFilter !== undefined) setTableFilter(f.tableFilter)
          if (f.serverFilter !== undefined) setServerFilter(f.serverFilter)
          if (f.typeFilter !== undefined) setTypeFilter(f.typeFilter)
        }}
      />

      <button type="button" onClick={onNew} className={btnGhost} aria-label="New check">
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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold">{orderLabel(o, tableById[o.tableId])}</span>
                    {o.transferredFromTableId && (
                      <StatusPill tone="info" size="sm">
                        🔄 Moved: {tableById[o.transferredFromTableId]?.name ? translateTableName(tableById[o.transferredFromTableId].name, lang) : o.transferredFromTableId}
                      </StatusPill>
                    )}
                    {o.type === 'delivery' && (
                      <StatusPill tone={DELIVERY_STATUS_META[o.deliveryStatus]?.tone || 'muted'} size="sm">
                        {DELIVERY_STATUS_META[o.deliveryStatus]?.label || 'Untracked'}
                      </StatusPill>
                    )}
                    {o.paymentClaim && (
                      <StatusPill tone="warn" size="sm">
                        QR claim
                      </StatusPill>
                    )}
                  </div>
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


export { TicketList }
