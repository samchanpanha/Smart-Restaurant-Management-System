import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Card, StatTile } from '../../components/ui'
import { useConfirm } from '../../components/ui/confirm-context'
import { useToast } from '../../components/ui/toast-context'
import { TABLE_STATUS_META } from '../../lib/constants'
import { translateTableStatus, translateZone, useI18n } from '../../lib/i18n'
import { useRestora } from '../../lib/store'
import { SeatDialog } from './sections/SeatDialog.jsx'
import { TableCard } from './sections/TableCard.jsx'
import { TableDetail } from './sections/TableDetail.jsx'
import { ReservationsPanel } from './sections/ReservationsPanel.jsx'
import { WaitlistPanel } from './sections/WaitlistPanel.jsx'
import { TableEditorModal } from './sections/TableEditorModal.jsx'
import { ZoneEditorModal } from './sections/ZoneEditorModal.jsx'
import { FloorMap } from './sections/FloorMap.jsx'

const VIEW_LABEL = {
  map: { en: 'Map', km: 'ប្លង់តុ', zh: '平面图' },
  list: { en: 'List', km: 'បញ្ជី', zh: '列表' },
}

function FloorScreen() {
  const confirm = useConfirm()
  const { notify } = useToast()
  const { state, dispatch, selectedTableId, setSelectedTableId, tabCtx, setTabCtx } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const [detailTableId, setDetailTableId] = useState(tabCtx.floorTable || null)
  const [seatCtx, setSeatCtx] = useState(null) // { tableId, party, name, reservationId, waitlistId }
  const [view, setView] = useState('map')
  const [managing, setManaging] = useState(false)
  const [editor, setEditor] = useState(null) // { table } to edit, {} to add
  const [zoneEditor, setZoneEditor] = useState(null) // 'create' | zone record | null
  const [selectedTableIds, setSelectedTableIds] = useState([])
  // Map filter: 'all' | 'attention' | 'occupied' | 'z:<zone>' | 's:<status>'.
  // The KPI cards and the map's own chip strip write the same value.
  const [mapFilter, setMapFilter] = useState('all')

  const label = (key) => VIEW_LABEL[key][lang] || VIEW_LABEL[key].en

  function toggleSelectTable(id) {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  // Feedback lives in the app-wide toast stack (role="status", never a modal):
  // a host mid-service reads it at a glance and keeps walking.
  function flash(message, tone = 'info') {
    notify(message, tone)
  }

  const occupied = state.tables.filter((t) => ['seated', 'ordered', 'billed'].includes(t.status)).length
  const freeCount = state.tables.filter((t) => t.status === 'free').length
  const dirtyCount = state.tables.filter((t) => t.status === 'dirty').length
  const reservedCount = state.tables.filter((table) => table.status === 'reserved').length
  // Zones are real records now; falls back per-table text for snapshots
  // seen before the normalize pass runs.
  const zoneRecords = Array.isArray(state.floorZones) ? state.floorZones : []
  const zones = zoneRecords.length
    ? zoneRecords.map((zone) => zone.name)
    : [...new Set(state.tables.map((t) => t.zone))]
  const pendingTransfers = state.tables.filter((t) => t.pendingTransfer && t.pendingTransfer.status === 'pending')

  const floorPct = state.tables.length ? Math.round((occupied / state.tables.length) * 100) : 0
  // Each KPI card doubles as a map filter — tap "Needs cleaning" and the plan
  // dims everything else (it never hides a table, the geography stays put).
  const stats = useMemo(() => ([
    {
      key: 'occupied',
      icon: 'tables',
      tone: 'accent',
      filter: 'occupied',
      label: f.occupied || 'Occupied',
      value: occupied,
      foot: typeof f.ofFloor === 'function' ? f.ofFloor(floorPct) : `${floorPct}% of floor`,
    },
    {
      key: 'free',
      icon: 'check',
      tone: 'success',
      filter: 's:free',
      label: f.free || 'Available',
      value: freeCount,
      foot: f.readyToSeat || translateTableStatus('free', lang),
    },
    {
      key: 'reserved',
      icon: 'calendar',
      tone: 'info',
      filter: 's:reserved',
      label: f.reserved || translateTableStatus('reserved', lang),
      value: reservedCount,
      foot: f.heldForGuests || f.booked || 'Booked',
    },
    {
      key: 'dirty',
      icon: 'sparkles',
      tone: 'danger',
      filter: 's:dirty',
      label: f.dirty || 'Needs cleaning',
      value: dirtyCount,
      foot: f.cleanTable || 'Bus & reset',
    },
  ]), [occupied, freeCount, reservedCount, dirtyCount, floorPct, f, lang])

  async function removeTable(table) {
    const hasOpenCheck = state.orders.some(
      (o) => o.tableId === table.id && !['paid', 'void'].includes(o.status),
    )
    if (hasOpenCheck || ['seated', 'ordered', 'billed'].includes(table.status)) {
      flash(`${table.name} still has an open check or party — clear it before deleting.`, 'warning')
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
          <div className="mb-1 flex items-center gap-1.5 text-[var(--fs-label)] font-semibold text-[var(--accent)]">
            <Icon name="tables" size={14} />
            {f.kicker || 'Floor operations'}
            {lang !== 'en' && <span className="sr-only"> Floor operations</span>}
          </div>
          <h1 className="text-[var(--fs-display)] font-bold tracking-tight text-[var(--text-strong)]">
            {f.title || 'Tables'}
            {lang !== 'en' && <span className="sr-only"> Restaurant floor Tables</span>}
          </h1>
          <p className="mt-1 text-[var(--fs-body)] text-[var(--text-muted)]">
            {f.subtitle || 'Manage table status, guests, and the live floor.'}
            {lang !== 'en' && <span className="sr-only"> Manage table status, guests, and the live floor.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-sm)]" role="group" aria-label="Floor display">
            <Button
              variant={view === 'map' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setView('map')}
              aria-pressed={view === 'map'}
            >
              <Icon name="map" size={14} />
              {label('map')}
            </Button>
            <Button
              variant={view === 'list' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
            >
              <Icon name="catalog" size={14} />
              {label('list')}
            </Button>
          </div>
          <Button
            variant={managing ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setManaging((v) => { const next = !v; if (next) setView('list'); return next })}
            aria-pressed={managing}
            aria-label="Manage tables"
          >
            {managing
              ? (lang === 'km' ? 'រួចរាល់' : lang === 'zh' ? '完成' : 'Done')
              : (lang === 'km' ? 'គ្រប់គ្រងតុ' : lang === 'zh' ? '管理餐桌' : 'Manage tables')}
            {lang !== 'en' && <span className="sr-only"> {managing ? 'Done' : 'Manage tables'}</span>}
          </Button>
        </div>
      </header>

      {pendingTransfers.length > 0 && (
        <div className="space-y-2">
          {pendingTransfers.map((tbl) => {
            const targetTbl = state.tables.find((x) => String(x.id) === String(tbl.pendingTransfer?.targetTableId))
            const targetLabel = targetTbl ? targetTbl.name : `Table #${tbl.pendingTransfer?.targetTableId}`
            return (
              <div
                key={tbl.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-xl)] border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-4 shadow-[var(--shadow-sm)]"
                role="alert"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--warning-soft)] text-[var(--warning)]">
                    <Icon name="swap" size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-bold text-[var(--text-strong)]">
                      Move Request: {tbl.name} ➔ {targetLabel}
                    </div>
                    <div className="text-[var(--fs-label)] text-[var(--text-muted)]">
                      {tbl.guestName ? `${tbl.guestName} · ` : ''}{tbl.pendingTransfer?.reason || 'Guest requested table change'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      dispatch({
                        type: 'APPROVE_TABLE_TRANSFER',
                        payload: { currentTableId: tbl.id, targetTableId: tbl.pendingTransfer?.targetTableId },
                      })
                      flash(`Approved move: ${tbl.name} ➔ ${targetLabel}`, 'success')
                    }}
                  >
                    {f.approveMove || 'Approve Move'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      dispatch({
                        type: 'REJECT_TABLE_TRANSFER',
                        payload: { currentTableId: tbl.id, reason: 'Staff declined request' },
                      })
                      flash(`Declined move request for ${tbl.name}`, 'warning')
                    }}
                  >
                    {f.declineMove || 'Decline'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((item) => {
          const active = mapFilter === item.filter
          return (
            <StatTile
              key={item.key}
              icon={item.icon}
              tone={item.tone}
              label={item.label}
              value={item.value}
              foot={item.foot}
              aria-pressed={active}
              title={`${item.label} — ${active ? 'clear this filter' : 'filter the map'}`}
              className={active ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)]' : undefined}
              onClick={() => {
                setView('map')
                setMapFilter(active ? 'all' : item.filter)
              }}
            />
          )
        })}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {view === 'map' ? (
            <FloorMap
              tables={state.tables}
              orders={state.orders}
              onOpen={openTable}
              floorZones={zoneRecords}
              floor={state.floor || {}}
              reservations={state.reservations || []}
              filter={mapFilter}
              onFilterChange={setMapFilter}
              onAddTable={() => { setView('list'); setManaging(true); setEditor({}) }}
            />
          ) : (
            <div className="space-y-4">
              {managing && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setEditor({})}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-xl)] border-2 border-dashed border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3 text-[var(--fs-body)] font-bold text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
                    aria-label="Add table"
                  >
                    <Icon name="plus" size={16} />
                    {lang === 'km' ? 'បន្ថែមតុ' : lang === 'zh' ? '添加餐桌' : 'Add table'}
                    {lang !== 'en' && <span className="sr-only"> Add table</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoneEditor('create')}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-xl)] border-2 border-dashed border-[var(--info)]/40 bg-[var(--info-soft)] px-4 py-3 text-[var(--fs-body)] font-bold text-[var(--info)] transition-colors hover:bg-[var(--info-soft)]"
                    aria-label="Add zone"
                  >
                    <Icon name="layers" size={16} />
                    {lang === 'km' ? 'បន្ថែមតំបន់' : lang === 'zh' ? '添加区域' : 'Add zone'}
                    {lang !== 'en' && <span className="sr-only"> Add zone</span>}
                  </button>
                </div>
              )}
              {zones.map((zone) => {
                const tables = state.tables.filter((table) => table.zone === zone)
                return (
                  <Card key={zone} inset>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 text-[var(--fs-label)] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                        <Icon name="layers" size={14} />
                        {translateZone(zone, lang)}
                        <span className="rounded-full bg-[var(--surface-hover)] px-1.5 text-[var(--fs-caption)] font-bold text-[var(--text-subtle)]">{tables.length}</span>
                      </h2>
                      {managing && zoneRecords.length > 0 && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setZoneEditor(zoneRecords.find((z) => z.name === zone))}
                          >
                            {lang === 'km' ? 'ប្ដូរឈ្មោះ' : lang === 'zh' ? '重命名' : 'Rename'}
                          </Button>
                          <Button
                            size="sm"
                            variant="dangerGhost"
                            onClick={() => removeZone(zoneRecords.find((z) => z.name === zone))}
                          >
                            {lang === 'km' ? 'លុប' : lang === 'zh' ? '删除' : 'Delete'}
                          </Button>
                        </div>
                      )}
                    </div>
                    {managing ? (
                      <ul className="space-y-2">
                        {tables.map((table) => (
                          <li key={table.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-lg)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
                            <div className="min-w-0">
                              <div className="truncate text-[var(--fs-body)] font-semibold text-[var(--text-strong)]">{table.name}</div>
                              <div className="text-[var(--fs-caption)] text-[var(--text-muted)]">{table.seats} seats · {TABLE_STATUS_META[table.status].label}</div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <Button size="sm" variant="secondary" onClick={() => setEditor({ table })}>
                                {lang === 'km' ? 'កែ' : lang === 'zh' ? '编辑' : 'Edit'}
                                {lang !== 'en' && <span className="sr-only"> Edit</span>}
                              </Button>
                              <Button size="sm" variant="dangerGhost" onClick={() => removeTable(table)}>
                                {lang === 'km' ? 'លុប' : lang === 'zh' ? '删除' : 'Delete'}
                                {lang !== 'en' && <span className="sr-only"> Delete</span>}
                              </Button>
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
                  </Card>
                )
              })}
              {managing && zones.length === 0 && (
                <p className="text-[var(--fs-body)] text-[var(--text-muted)]">
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
        <div className="surface-dark fixed left-1/2 bottom-6 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-[var(--radius-xl)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 text-[var(--text)] shadow-[var(--shadow-lg)]">
          <span className="text-[var(--fs-label)] font-bold text-[var(--accent)]">
            {selectedTableIds.length} {selectedTableIds.length === 1 ? 'table' : 'tables'} selected
          </span>
          <span className="mx-1 h-4 w-px bg-[var(--border-strong)]" />
          {selectedTableIds.length === 1 && (
            <Button
              size="sm"
              onClick={() => {
                const t = state.tables.find((tbl) => tbl.id === selectedTableIds[0])
                if (t) openTable(t)
                setSelectedTableIds([])
              }}
            >
              Open / Seat
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="bg-[var(--success-soft)] text-[var(--success)] hover:bg-[var(--success-soft)] hover:opacity-90"
            onClick={() => {
              for (const tid of selectedTableIds) {
                dispatch({ type: 'FLOOR_MARK_TABLE_AVAILABLE', payload: { tableId: tid } })
              }
              flash(`${selectedTableIds.length} table(s) marked clean & available`, 'success')
              setSelectedTableIds([])
            }}
          >
            Mark Clean
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              for (const tid of selectedTableIds) {
                dispatch({ type: 'SET_TABLE_STATUS', tableId: tid, to: 'dirty', force: true })
              }
              flash(`${selectedTableIds.length} table(s) marked dirty`, 'warning')
              setSelectedTableIds([])
            }}
          >
            Mark Dirty
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedTableIds([])}>
            Clear (✕)
          </Button>
        </div>
      )}
    </div>
  )
}

export default FloorScreen
