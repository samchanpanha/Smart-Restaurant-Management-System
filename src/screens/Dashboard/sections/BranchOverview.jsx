import { useMemo, useState } from 'react'
import { Card, SectionHeader } from '../../../components/ui'
import { money } from '../../../lib/models'
import { Icon } from '../../../components/Icon'
import { buildReportDocument, printHtml, renderDocumentHtml } from '../../../lib/documents'

// Owner-only: combined sales across every location, with a "selected" marker
// on the currently scoped branch, side-by-side KPI comparison table,
// branch shift report printing, and inter-branch stock transfers.
export default function BranchOverview({ copy, locations, locId, onPick, empire, dispatch }) {
  const combined = locations.reduce((sum, item) => sum + item.dash.sales, 0)
  const [showTransfer, setShowTransfer] = useState(false)
  const [fromLocId, setFromLocId] = useState(locId || locations[0]?.id || 'downtown')
  const [toLocId, setToLocId] = useState(() => {
    const other = locations.find((l) => l.id !== locId)
    return other ? other.id : locations[1]?.id || 'riverside'
  })
  const [selectedItemId, setSelectedItemId] = useState('')
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState('')
  const [transferSuccess, setTransferSuccess] = useState('')

  const fromShop = empire?.locations?.[fromLocId]
  const toShop = empire?.locations?.[toLocId]

  const fromInventory = useMemo(() => {
    return (fromShop?.inventory || []).filter((i) => i.onHand > 0)
  }, [fromShop])

  const selectedItem = fromInventory.find((i) => i.id === selectedItemId)

  function handlePrintShiftReport(locationId, event) {
    event?.stopPropagation?.()
    const targetShop = empire?.locations?.[locationId]
    if (!targetShop) return
    const settings = targetShop.settings || {}
    const doc = buildReportDocument({ shop: { ...targetShop, settings }, settings, range: 'tonight' })
    const html = renderDocumentHtml(doc, settings)
    printHtml(html, { title: `${targetShop.settings?.locationShort || locationId} - Shift Report` })
  }

  function handleTransferSubmit(e) {
    e.preventDefault()
    if (!selectedItemId || !qty || Number(qty) <= 0 || fromLocId === toLocId) return

    dispatch?.({
      type: 'TRANSFER_STOCK',
      fromLocId,
      toLocId,
      itemId: selectedItemId,
      qty: Number(qty),
      notes: notes || `Transfer from ${fromShop?.settings?.locationShort || fromLocId} to ${toShop?.settings?.locationShort || toLocId}`,
      by: 'owner',
    })

    setTransferSuccess(
      `Transferred ${qty} ${selectedItem?.unit || 'units'} of ${selectedItem?.name} to ${toShop?.settings?.locationShort || toLocId}`,
    )
    setQty('')
    setNotes('')
    setSelectedItemId('')
    setShowTransfer(false)
    setTimeout(() => setTransferSuccess(''), 4000)
  }

  return (
    <Card>
      <SectionHeader
        title={copy.branchOverview || 'Branch Comparison & Operations'}
        sub={copy.branchOverviewSub || 'Side-by-side performance across all locations and inter-branch transfers.'}
        actions={
          <div className="flex items-center gap-2">
            {locations.length > 1 && (
              <button
                type="button"
                onClick={() => setShowTransfer(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 transition shadow-2xs"
              >
                <Icon name="swap" size={13} />
                <span>Transfer Stock</span>
              </button>
            )}
            <span className="tnum text-sm font-bold text-[var(--accent-text)]">
              {money(combined)} {copy.combined || 'Combined'}
            </span>
          </div>
        }
      />

      {transferSuccess && (
        <div className="mb-3 rounded-xl bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
          {transferSuccess}
        </div>
      )}

      {/* Side-by-side KPI comparison grid / table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/80 text-zinc-500 font-semibold">
              <th className="px-3.5 py-2.5">Branch</th>
              <th className="px-3 py-2.5 text-right">Today's Sales</th>
              <th className="px-3 py-2.5 text-right">Covers</th>
              <th className="px-3 py-2.5 text-right">Avg Check</th>
              <th className="px-3 py-2.5 text-right">Food Cost %</th>
              <th className="px-3 py-2.5 text-right">Occupancy</th>
              <th className="px-3.5 py-2.5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {locations.map((item) => {
              const active = locId === item.id
              const occupancyPct = Math.round(item.dash.occupancy * 100)
              const foodCostPct = (item.dash.foodCost7d * 100).toFixed(1)

              return (
                <tr
                  key={item.id}
                  className={`transition-colors ${active ? 'bg-orange-50/30' : 'hover:bg-zinc-50/50'}`}
                >
                  <td className="px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-900">{item.short}</span>
                      {active && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                          Active
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-bold text-zinc-900 tnum">
                    {money(item.dash.sales)}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-zinc-700 tnum">
                    {item.dash.covers}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-zinc-700 tnum">
                    {money(item.dash.avgCheck)}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-zinc-700 tnum">
                    {foodCostPct}%
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-zinc-700 tnum">
                    {occupancyPct}%
                  </td>
                  <td className="px-3.5 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {!active && (
                        <button
                          type="button"
                          onClick={() => onPick(item.id)}
                          className="rounded px-2 py-1 text-[11px] font-semibold text-orange-600 hover:bg-orange-50 transition"
                        >
                          Switch
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handlePrintShiftReport(item.id, e)}
                        title="Print Branch Shift Report"
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition"
                      >
                        <Icon name="printer" size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal for stock transfer between branches */}
      {showTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl ring-1 ring-zinc-200">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                  <Icon name="swap" size={15} />
                </span>
                <h3 className="text-base font-bold text-zinc-900">Transfer Stock Between Branches</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowTransfer(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            <form className="mt-4 space-y-3.5 text-xs" onSubmit={handleTransferSubmit}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-600">From Branch</label>
                  <select
                    value={fromLocId}
                    onChange={(e) => {
                      setFromLocId(e.target.value)
                      setSelectedItemId('')
                    }}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 outline-none focus:border-orange-300"
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.short}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-zinc-600">To Branch</label>
                  <select
                    value={toLocId}
                    onChange={(e) => setToLocId(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 outline-none focus:border-orange-300"
                  >
                    {locations
                      .filter((loc) => loc.id !== fromLocId)
                      .map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.short}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-zinc-600">Select Item</label>
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 outline-none focus:border-orange-300"
                >
                  <option value="">-- Choose inventory item --</option>
                  {fromInventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.onHand} {item.unit} available)
                    </option>
                  ))}
                </select>
              </div>

              {selectedItem && (
                <div className="rounded-lg bg-zinc-50 p-2.5 text-zinc-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Available at {fromShop?.settings?.locationShort || fromLocId}:</span>
                    <span className="font-bold text-zinc-900">
                      {selectedItem.onHand} {selectedItem.unit}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Average cost:</span>
                    <span className="font-medium text-zinc-800">
                      {money(selectedItem.avgCost || selectedItem.lastCost || 0)} / {selectedItem.unit}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block font-semibold text-zinc-600">Transfer Quantity</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    max={selectedItem?.onHand || 9999}
                    required
                    placeholder="e.g. 5"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 outline-none focus:border-orange-300"
                  />
                  <span className="text-xs font-semibold text-zinc-500 min-w-10">
                    {selectedItem?.unit || 'units'}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-zinc-600">Transfer Note (optional)</label>
                <input
                  placeholder="e.g. Rush weekend restock"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 outline-none focus:border-orange-300"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTransfer(false)}
                  className="rounded-xl border border-zinc-200 px-3.5 py-1.5 font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedItemId || !qty || Number(qty) <= 0}
                  className="rounded-xl bg-orange-500 px-4 py-1.5 font-bold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  Complete Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  )
}
