import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import { Field, Modal, btnGhost, btnPrimary, inputCls } from '../components/ui'
import { translateInventoryName, useI18n } from '../lib/i18n'
import { money } from '../lib/models'
import { useRestora } from '../lib/store'

const REASON_META = {
  prep: { label: 'Prep loss / Trimming', tone: 'warn' },
  spoil: { label: 'Spoilage / Expired', tone: 'bad' },
  comp: { label: 'Comped / Kitchen remake', tone: 'info' },
  error: { label: 'Cook error / Burnt', tone: 'muted' },
  overproduction: { label: 'Overproduction / Leftover', tone: 'warn' },
}

function LogWasteModal({ inventory, onClose, onSave }) {
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('prep')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const selectedItem = inventory.find((i) => i.id === itemId)

  function handleSubmit(e) {
    e.preventDefault()
    if (!itemId) {
      setError('Please select an inventory item.')
      return
    }
    const num = Number(qty)
    if (!(num > 0)) {
      setError('Quantity must be greater than zero.')
      return
    }
    onSave({
      inventoryItemId: itemId,
      qty: num,
      reason,
      note: note.trim(),
    })
  }

  return (
    <Modal
      title="Log Kitchen Waste"
      subtitle="Record lost, spoiled, or trimmed inventory. Stock and cost ledgers update instantly."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-inset ring-rose-500/30">
            {error}
          </div>
        )}

        <Field label="Inventory item">
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className={inputCls}
            required
          >
            <option value="">Select item…</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.unit}) · on hand {item.onHand}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Quantity (${selectedItem ? selectedItem.unit : 'units'})`}>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="e.g. 2.5"
              className={inputCls}
            />
          </Field>
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              {Object.entries(REASON_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </Field>
        </div>

        {selectedItem && (
          <div className="text-xs text-zinc-400">
            Estimated cost loss:{' '}
            <strong className="text-rose-400">
              {money((Number(qty) || 0) * (Number(selectedItem.lastCost) || 0))}
            </strong>{' '}
            (@ {money(Number(selectedItem.lastCost) || 0)}/{selectedItem.unit})
          </div>
        )}

        <Field label="Notes (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Prep trim on salmon collars, dropped tray"
            className={inputCls}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" className={btnPrimary}>Log waste</button>
        </div>
      </form>
    </Modal>
  )
}

export default function WasteScreen() {
  const { state, dispatch, role } = useRestora()
  const { lang } = useI18n()
  const [logging, setLogging] = useState(false)
  const [filterReason, setFilterReason] = useState('all')
  const [flash, setFlash] = useState('')

  const inventory = state.inventory || []
  const invById = useMemo(() => Object.fromEntries(inventory.map((i) => [i.id, i])), [inventory])

  // Aggregate waste entries from wasteLog or movements
  const wasteEntries = useMemo(() => {
    const list = Array.isArray(state.wasteLog) ? state.wasteLog : []
    return list
      .map((entry) => {
        const item = invById[entry.inventoryItemId]
        const unitCost = Number(item?.lastCost) || 0
        const totalValue = entry.value != null ? entry.value : Math.round((Number(entry.qty) || 0) * unitCost * 100) / 100
        return {
          ...entry,
          itemName: item?.name || entry.inventoryItemId,
          unit: item?.unit || 'each',
          unitCost,
          totalValue,
        }
      })
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
  }, [state.wasteLog, invById])

  const filteredEntries = useMemo(() => {
    if (filterReason === 'all') return wasteEntries
    return wasteEntries.filter((w) => w.reason === filterReason)
  }, [wasteEntries, filterReason])

  const totalWasteCost = useMemo(() => {
    return wasteEntries.reduce((sum, w) => sum + (Number(w.totalValue) || 0), 0)
  }, [wasteEntries])

  // Worst offender item
  const worstOffender = useMemo(() => {
    const byItem = {}
    for (const w of wasteEntries) {
      byItem[w.itemName] = (byItem[w.itemName] || 0) + (Number(w.totalValue) || 0)
    }
    const entries = Object.entries(byItem).sort((a, b) => b[1] - a[1])
    return entries[0] ? { name: entries[0][0], cost: entries[0][1] } : null
  }, [wasteEntries])

  function handleLogWaste(data) {
    dispatch({
      type: 'LOG_WASTE',
      inventoryItemId: data.inventoryItemId,
      qty: data.qty,
      reason: data.reason,
      by: role,
    })
    setLogging(false)
    setFlash(`Logged waste for ${invById[data.inventoryItemId]?.name || 'item'}.`)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">
            Control · Kitchen integrity
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Waste tracking
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track spoilage, trimming loss, and kitchen comps. Keep variance in check and food costs tight.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLogging(true)}
            className={btnPrimary}
          >
            <Icon name="trash" className="mr-1.5 h-4 w-4" />
            + Log waste
          </button>
        </div>
      </header>

      {flash && (
        <div className="rounded-xl bg-teal-50 dark:bg-teal-950/40 px-4 py-2.5 text-sm text-teal-900 dark:text-teal-200 ring-1 ring-inset ring-teal-200 dark:ring-teal-800" role="status">
          {flash}
        </div>
      )}

      {/* KPI Tiles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Total waste loss</div>
          <div className="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400">{money(totalWasteCost)}</div>
          <div className="text-xs text-zinc-500">{wasteEntries.length} recorded events</div>
        </div>
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Top cost offender</div>
          <div className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100 truncate">
            {worstOffender ? worstOffender.name : '—'}
          </div>
          <div className="text-xs text-zinc-500">
            {worstOffender ? `${money(worstOffender.cost)} total waste` : 'No waste logged yet'}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Primary reason</div>
          <div className="mt-1 text-2xl font-bold text-amber-500 capitalize">
            {wasteEntries[0]?.reason || 'None'}
          </div>
          <div className="text-xs text-zinc-500">most recent log</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-zinc-100 dark:bg-[var(--color-ink-850)] p-3">
        <span className="text-xs font-bold text-zinc-400 mr-2">Filter reason:</span>
        <button
          type="button"
          onClick={() => setFilterReason('all')}
          className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${filterReason === 'all' ? 'bg-zinc-900 text-white dark:bg-white dark:text-black' : 'text-zinc-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
        >
          All ({wasteEntries.length})
        </button>
        {Object.entries(REASON_META).map(([key, meta]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilterReason(key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${filterReason === key ? 'bg-orange-500 text-white' : 'text-zinc-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
          >
            {meta.label} ({wasteEntries.filter((w) => w.reason === key).length})
          </button>
        ))}
      </div>

      {/* Waste Ledger Table */}
      <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] shadow-sm overflow-hidden">
        {filteredEntries.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            No waste logs recorded for this view.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-white/5 text-[11px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-white/5">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Logged By</th>
                  <th className="px-4 py-3 text-right">Cost Loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5 text-zinc-700 dark:text-zinc-300">
                {filteredEntries.map((entry) => {
                  const meta = REASON_META[entry.reason] || { label: entry.reason, tone: 'muted' }
                  const timeStr = entry.at ? new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
                  const item = invById[entry.inventoryItemId]
                  return (
                    <tr key={entry.id} className="hover:bg-zinc-50/50 dark:hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-xs text-zinc-400">{timeStr}</td>
                      <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                        {translateInventoryName(item, lang) || entry.itemName}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {entry.qty} {entry.unit}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill tone={meta.tone} size="sm">{meta.label}</StatusPill>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400 capitalize">{entry.by || 'staff'}</td>
                      <td className="px-4 py-3 text-right font-bold text-rose-500">
                        {money(entry.totalValue)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {logging && (
        <LogWasteModal
          inventory={inventory}
          onClose={() => setLogging(false)}
          onSave={handleLogWaste}
        />
      )}
    </div>
  )
}
