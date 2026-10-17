import { useState } from 'react'
import { TABLE_STATUS_META } from '../../lib/constants'
import { translateTableStatus, translateZone, useI18n } from '../../lib/i18n'
import { useConfirm } from '../../components/ui/confirm-context'
import { useRestora } from '../../lib/store'
import { SeatDialog } from './sections/SeatDialog.jsx'
import { TableCard } from './sections/TableCard.jsx'
import { TableDetail } from './sections/TableDetail.jsx'
import { ReservationsPanel } from './sections/ReservationsPanel.jsx'
import { WaitlistPanel } from './sections/WaitlistPanel.jsx'
import { TableEditorModal } from './sections/TableEditorModal.jsx'
import { ZoneEditorModal } from './sections/ZoneEditorModal.jsx'
import { FloorMap } from './sections/FloorMap.jsx'

function FloorScreen() {
  const confirm = useConfirm()
  const { state, dispatch, selectedTableId, setSelectedTableId, tabCtx, setTabCtx } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const [detailTableId, setDetailTableId] = useState(tabCtx.floorTable || null)
  const [seatCtx, setSeatCtx] = useState(null) // { tableId, party, name, reservationId, waitlistId }
  const [banner, setBanner] = useState(null)
  const [view, setView] = useState('map')
  const [managing, setManaging] = useState(false)
  const [editor, setEditor] = useState(null) // { table } to edit, {} to add
  const [zoneEditor, setZoneEditor] = useState(null) // 'create' | zone record | null
  const [selectedTableIds, setSelectedTableIds] = useState([])

  function toggleSelectTable(id) {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }


  function flash(msg) {
    setBanner(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setBanner(null), 4200)
  }

  const occupied = state.tables.filter((t) => ['seated', 'ordered', 'billed'].includes(t.status)).length
  const freeCount = state.tables.filter((t) => t.status === 'free').length
  const dirtyCount = state.tables.filter((t) => t.status === 'dirty').length
  // Zones are real records now; falls back per-table text for snapshots
  // seen before the normalize pass runs.
  const zoneRecords = Array.isArray(state.floorZones) ? state.floorZones : []
  const zones = zoneRecords.length
    ? zoneRecords.map((zone) => zone.name)
    : [...new Set(state.tables.map((t) => t.zone))]
  const pendingTransfers = state.tables.filter((t) => t.pendingTransfer && t.pendingTransfer.status === 'pending')

  async function removeTable(table) {
    const hasOpenCheck = state.orders.some(
      (o) => o.tableId === table.id && !['paid', 'void'].includes(o.status),
    )
    if (hasOpenCheck || ['seated', 'ordered', 'billed'].includes(table.status)) {
      flash(`${table.name} still has an open check or party — clear it before deleting.`)
      return
    }
    const ok = await confirm({
      title: `Delete ${table.name}?`,
      body: 'The table leaves the floor plan. Its seats and history go with it.',
      confirmLabel: 'Delete table',
      tone: 'danger',
    })
    if (!ok) return
    dispatch({ type: 'DELETE_TABLE', tableId: table.id })
  }

  // Removing a zone never removes tables: the reducer falls its tables
  // back to 'Main', and the user pans to the plan to look at them there.
  async function removeZone(zoneRecord) {
    if (!zoneRecord) return
    const ok = await confirm({
      title: `Delete ${zoneRecord.name}?`,
      body: 'Tables in this zone move back to Main on the floor plan.',
      confirmLabel: 'Delete zone',
      tone: 'danger',
    })
    if (!ok) return
    dispatch({ type: 'DELETE_FLOOR_ZONE', zoneId: zoneRecord.id })
    flash(`${zoneRecord.name} removed — its tables are back in Main.`)
  }

  const activeDetailId = detailTableId || selectedTableId
  const detailTable = activeDetailId ? state.tables.find((t) => t.id === activeDetailId) : null

  function openTable(table) {
    if (managing) {
      setEditor({ table })
      return
    }
    if (table.status === 'free') {
      // Fast path: tap a free table to seat immediately
      setSeatCtx({ tableId: table.id, party: Math.min(table.seats, 4), name: '' })
    } else {
      setDetailTableId(table.id)
      setTabCtx({ floorTable: table.id })
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">
            {f.kicker || 'Floor operations'}
            {lang !== 'en' && <span className="sr-only"> Floor operations</span>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            {f.title || 'Tables'}
            {lang !== 'en' && <span className="sr-only"> Restaurant floor Tables</span>}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {f.subtitle || 'Manage table status, guests, and the live floor.'}
            {lang !== 'en' && <span className="sr-only"> Manage table status, guests, and the live floor.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-zinc-200 bg-white p-1 shadow-sm" role="group" aria-label="Floor display">
            <button type="button" onClick={() => setView('map')} aria-pressed={view === 'map'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === 'map' ? 'bg-orange-500 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}>
              {lang === 'km' ? 'ប្លង់តុ' : lang === 'zh' ? '平面图' : 'Map'}
            </button>
            <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === 'list' ? 'bg-orange-500 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}>
              {lang === 'km' ? 'បញ្ជី' : lang === 'zh' ? '列表' : 'List'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setManaging((v) => { const next = !v; if (next) setView('list'); return next })}
            aria-pressed={managing}
            aria-label="Manage tables"
            className={`min-h-10 rounded-xl border px-4 text-sm font-semibold shadow-sm transition-colors ${managing ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            {managing
              ? (lang === 'km' ? 'រួចរាល់' : lang === 'zh' ? '完成' : 'Done')
              : (lang === 'km' ? 'គ្រប់គ្រងតុ' : lang === 'zh' ? '管理餐桌' : 'Manage tables')}
            {lang !== 'en' && <span className="sr-only"> {managing ? 'Done' : 'Manage tables'}</span>}
          </button>
        </div>
      </header>

      {banner && (
        <div className="animate-status-in rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-inset ring-amber-500/40" role="alert">
          {banner}
        </div>
      )}

      {pendingTransfers.length > 0 && (
        <div className="space-y-2">
          {pendingTransfers.map((tbl) => {
            const targetTbl = state.tables.find((x) => String(x.id) === String(tbl.pendingTransfer?.targetTableId))
            const targetLabel = targetTbl ? targetTbl.name : `Table #${tbl.pendingTransfer?.targetTableId}`
            return (
              <div
                key={tbl.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 shadow-sm"
                role="alert"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-lg">
                    🔄
                  </span>
                  <div>
                    <div className="font-bold text-amber-100">
                      Move Request: {tbl.name} ➔ {targetLabel}
                    </div>
                    <div className="text-xs text-amber-300/80">
                      {tbl.guestName ? `${tbl.guestName} · ` : ''}{tbl.pendingTransfer?.reason || 'Guest requested table change'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({
                        type: 'APPROVE_TABLE_TRANSFER',
                        payload: { currentTableId: tbl.id, targetTableId: tbl.pendingTransfer?.targetTableId },
                      })
                      flash(`Approved move: ${tbl.name} ➔ ${targetLabel}`)
                    }}
                    className="min-h-[38px] rounded-lg bg-amber-500 px-4 text-xs font-bold text-black hover:bg-amber-400"
                  >
                    Approve Move
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({
                        type: 'REJECT_TABLE_TRANSFER',
                        payload: { currentTableId: tbl.id, reason: 'Staff declined request' },
                      })
                      flash(`Declined move request for ${tbl.name}`)
                    }}
                    className="min-h-[38px] rounded-lg border border-amber-500/40 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: f.occupied || 'Occupied', value: occupied, note: `${state.tables.length ? Math.round((occupied / state.tables.length) * 100) : 0}%`, tone: 'orange', icon: '▦' },
          { label: f.free || 'Available', value: freeCount, note: translateTableStatus('free', lang), tone: 'green', icon: '✓' },
          { label: translateTableStatus('reserved', lang), value: state.tables.filter((table) => table.status === 'reserved').length, note: f.booked || 'Booked', tone: 'violet', icon: '◷' },
          { label: f.dirty || 'Needs cleaning', value: dirtyCount, note: f.cleanTable || 'Bus & reset', tone: 'red', icon: '!' },
        ].map((item) => <div key={item.label} className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold ${item.tone === 'green' ? 'bg-emerald-50 text-emerald-700' : item.tone === 'violet' ? 'bg-violet-50 text-violet-700' : item.tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'}`}>{item.icon}</span><span className="text-xs font-medium text-zinc-500">{item.label}</span></div><div className="tnum mt-2 text-2xl font-bold text-zinc-900">{item.value}</div><div className="mt-0.5 text-[10px] text-zinc-500">{item.note}</div></div>)}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {view === 'map' ? <FloorMap tables={state.tables} orders={state.orders} onOpen={openTable} floorZones={zoneRecords} floor={state.floor || {}} /> : (
            <div className="space-y-4">
              {managing && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setEditor({})}
                    className="rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/60 px-4 py-3 text-sm font-bold text-orange-600 hover:bg-orange-50"
                    aria-label="Add table"
                  >
                    + {lang === 'km' ? 'បន្ថែមតុ' : lang === 'zh' ? '添加餐桌' : 'Add table'}
                    {lang !== 'en' && <span className="sr-only"> Add table</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoneEditor('create')}
                    className="rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50/60 px-4 py-3 text-sm font-bold text-sky-600 hover:bg-sky-50"
                    aria-label="Add zone"
                  >
                    + {lang === 'km' ? 'បន្ថែមតំបន់' : lang === 'zh' ? '添加区域' : 'Add zone'}
                    {lang !== 'en' && <span className="sr-only"> Add zone</span>}
                  </button>
                </div>
              )}
              {zones.map((zone) => {
                const tables = state.tables.filter((table) => table.zone === zone)
                return (
                  <section key={zone} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">{translateZone(zone, lang)} · {tables.length}</h2>
                      {managing && zoneRecords.length > 0 && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setZoneEditor(zoneRecords.find((z) => z.name === zone))}
                            className="min-h-[32px] rounded-lg border border-zinc-200 px-2.5 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-50"
                          >
                            {lang === 'km' ? 'ប្ដូរឈ្មោះ' : lang === 'zh' ? '重命名' : 'Rename'}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeZone(zoneRecords.find((z) => z.name === zone))}
                            className="min-h-[32px] rounded-lg border border-red-500/40 px-2.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/10"
                          >
                            {lang === 'km' ? 'លុប' : lang === 'zh' ? '删除' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                    {managing ? (
                      <ul className="space-y-2">
                        {tables.map((table) => (
                          <li key={table.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
                            <div>
                              <div className="text-sm font-semibold text-zinc-100">{table.name}</div>
                              <div className="text-[11px] text-zinc-500">{table.seats} seats · {TABLE_STATUS_META[table.status].label}</div>
                            </div>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setEditor({ table })} className="min-h-[36px] rounded-lg border border-[var(--color-ink-600)] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5">
                                {lang === 'km' ? 'កែ' : lang === 'zh' ? '编辑' : 'Edit'}
                                {lang !== 'en' && <span className="sr-only"> Edit</span>}
                              </button>
                              <button type="button" onClick={() => removeTable(table)} className="min-h-[36px] rounded-lg border border-red-500/40 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/10">
                                {lang === 'km' ? 'លុប' : lang === 'zh' ? '删除' : 'Delete'}
                                {lang !== 'en' && <span className="sr-only"> Delete</span>}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {tables.map((table) => (
                          <TableCard
                            key={table.id}
                            table={table}
                            onOpen={openTable}
                            isSelected={selectedTableIds.includes(table.id)}
                            onToggleSelect={toggleSelectTable}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
              {managing && zones.length === 0 && (
                <p className="text-sm text-zinc-500">
                  {lang === 'km'
                    ? 'មិនមានតុនៅឡើយទេ។ បន្ថែមតុដំបូងរបស់អ្នក។'
                    : lang === 'zh'
                      ? '暂无餐桌，请添加第一张餐桌。'
                      : 'No tables yet. Add your first one.'}
                </p>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4 xl:col-span-4">
          <ReservationsPanel
            onSeatRes={(reservation) => setSeatCtx({ tableId: reservation.tableId, party: reservation.partySize, name: reservation.name, reservationId: reservation.id })}
            onError={flash}
          />
          <WaitlistPanel
            onSeatWl={(waitlist) => setSeatCtx({ tableId: null, party: waitlist.partySize, name: waitlist.name, waitlistId: waitlist.id })}
            onError={flash}
          />
        </aside>
      </div>

      {detailTable && (
        <TableDetail
          table={detailTable}
          onClose={() => { setDetailTableId(null); setSelectedTableId(null); setTabCtx({ floorTable: null }) }}
          onSeat={(id) => setSeatCtx({ tableId: id, party: 2, name: '' })}
          onError={flash}
          onFlash={flash}
        />
      )}
      {seatCtx && (
        <SeatDialog
          tableId={seatCtx.tableId}
          initialParty={seatCtx.party}
          initialName={seatCtx.name}
          reservationId={seatCtx.reservationId}
          waitlistId={seatCtx.waitlistId}
          onClose={() => setSeatCtx(null)}
          onError={flash}
        />
      )}
      {editor && (
        <TableEditorModal table={editor.table || null} zones={zones} onClose={() => setEditor(null)} />
      )}

      {zoneEditor && (
        <ZoneEditorModal
          zone={zoneEditor === 'create' ? null : zoneEditor}
          zoneCount={zoneRecords.length}
          onClose={() => setZoneEditor(null)}
        />
      )}

      {selectedTableIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 rounded-2xl bg-zinc-950/95 px-4 py-2.5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <span className="text-xs font-bold text-amber-400">
            {selectedTableIds.length} {selectedTableIds.length === 1 ? 'table' : 'tables'} selected
          </span>
          <div className="h-4 w-px bg-white/20 mx-1" />
          {selectedTableIds.length === 1 && (
            <button
              type="button"
              onClick={() => {
                const t = state.tables.find((tbl) => tbl.id === selectedTableIds[0])
                if (t) openTable(t)
                setSelectedTableIds([])
              }}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-400"
            >
              Open / Seat
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              for (const tid of selectedTableIds) {
                dispatch({ type: 'FLOOR_MARK_TABLE_AVAILABLE', payload: { tableId: tid } })
              }
              flash(`${selectedTableIds.length} table(s) marked clean & available`)
              setSelectedTableIds([])
            }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
          >
            Mark Clean
          </button>
          <button
            type="button"
            onClick={() => {
              for (const tid of selectedTableIds) {
                dispatch({ type: 'SET_TABLE_STATUS', tableId: tid, to: 'dirty', force: true })
              }
              flash(`${selectedTableIds.length} table(s) marked dirty`)
              setSelectedTableIds([])
            }}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-200 hover:bg-zinc-700"
          >
            Mark Dirty
          </button>
          <button
            type="button"
            onClick={() => setSelectedTableIds([])}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1"
          >
            Clear (✕)
          </button>
        </div>
      )}
    </div>
  )
}

export default FloorScreen
