import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { useRestora } from '../../lib/store'
import { TABS, openOrderForTable } from './shared.js'
import { TicketList } from './sections/TicketList.jsx'
import { TicketWorkspace } from './sections/TicketWorkspace.jsx'
import { NewCheckModal } from './sections/NewCheckModal.jsx'

function TicketsScreen() {
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

export default TicketsScreen
