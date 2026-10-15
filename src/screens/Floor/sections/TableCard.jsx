import { useMemo } from 'react'
import StatusPill from '../../../components/StatusPill'
import { TABLE_STATUS_META, TARGETS } from '../../../lib/constants'
import { formatClock, minutesBetween } from '../../../lib/models'
import { quoteWait, useNow, useRestora } from '../../../lib/store'

function TableCard({ table, onOpen }) {
  const { state, dispatch } = useRestora()
  useNow(15000)
  const meta = TABLE_STATUS_META[table.status] || { label: table.status, tone: 'muted' }
  const occupied = table.status === 'seated' || table.status === 'ordered' || table.status === 'occupied'
  const mins = table.seatedAt ? minutesBetween(table.seatedAt) : 0
  const turnRatio = occupied ? mins / table.targetTurnMinutes : 0
  const longTurn = turnRatio >= TARGETS.turnAlertRatio

  // Predicted next free from today's actual turns for this party size
  const predictedFree = useMemo(() => {
    if (!occupied || !table.seatedAt) return null
    const avg = quoteWait(state, table.partySize || table.seats)
    const freeAt = new Date(new Date(table.seatedAt).getTime() + avg * 60000)
    return { at: freeAt, avg }
  }, [occupied, table.seatedAt, table.partySize, table.seats, state])

  const sizeCls =
    table.seats <= 2 ? 'col-span-1' : table.seats <= 4 ? 'col-span-1 sm:col-span-1' : 'col-span-2'

  return (
    <button
      type="button"
      onClick={() => onOpen(table)}
      aria-label={`${table.name}, ${table.seats} seats, ${meta.label}${occupied ? `, party of ${table.partySize}, seated ${mins} minutes` : ''}`}
      className={`min-h-[118px] rounded-2xl border p-3 text-left transition-transform active:scale-[0.98] ${sizeCls} ${
        longTurn
          ? 'border-amber-500/60 bg-[var(--color-ink-850)] ring-2 ring-amber-500/30'
          : 'border-[var(--color-ink-700)] bg-[var(--color-ink-900)] hover:border-[var(--color-ink-600)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold leading-tight">{table.name}</div>
          <div className="text-[11px] text-zinc-500">
            {table.seats} seats · {table.zone}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill tone={meta.tone} size="sm">
            {meta.label}
          </StatusPill>
          {table.selfSeated && (
            <span className="floor-badge floor-badge--self">📱 Self-Seated ({table.partySize}p)</span>
          )}
        </div>
      </div>

      <div className="mt-2 min-h-10 text-xs">
        {occupied ? (
          <>
            <div className="tnum text-sm font-semibold text-zinc-200">
              Party of {table.partySize || table.seats} · {mins}m
            </div>
            {predictedFree && (
              <div className="mt-0.5 text-[11px] text-zinc-500">
                free ~{formatClock(predictedFree.at)} ({predictedFree.avg}m avg turn)
              </div>
            )}
          </>
        ) : table.status === 'billing' ? (
          <div className="floor-alert-banner">
            <span>💳 Guest requested bill & release</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                dispatch({
                  type: 'MINIAPP_RELEASE_TABLE',
                  payload: { tableId: table.id, forceByStaff: true },
                })
              }}
            >
              Settle & Release
            </button>
          </div>
        ) : table.status === 'cleaning' ? (
          <div className="mt-1">
            <button
              type="button"
              className="floor-btn-clean"
              onClick={(e) => {
                e.stopPropagation()
                dispatch({
                  type: 'FLOOR_MARK_TABLE_AVAILABLE',
                  payload: { tableId: table.id },
                })
              }}
            >
              ✨ Mark Clean & Available
            </button>
          </div>
        ) : table.status === 'billed' ? (
          <div className="text-zinc-400">Check paid — needs bussing</div>
        ) : table.status === 'dirty' ? (
          <div className="text-zinc-400">Needs bussing + reset</div>
        ) : table.status === 'reserved' ? (
          <div className="text-zinc-400">Held for reservation</div>
        ) : (
          <div className="text-zinc-500">Tap to seat</div>
        )}
      </div>

      {occupied && (
        <div className="mt-2" aria-hidden>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/50">
            <div
              className={`h-full rounded-full transition-all ${longTurn ? 'bg-amber-400' : 'bg-emerald-500/70'}`}
              style={{ width: `${Math.min(100, turnRatio * 100)}%` }}
            />
          </div>
          {longTurn && (
            <div className="mt-1 text-[11px] font-semibold text-amber-300">
              Long turn · {mins}m of {table.targetTurnMinutes}m target
            </div>
          )}
        </div>
      )}
    </button>
  )
}


export { TableCard }
