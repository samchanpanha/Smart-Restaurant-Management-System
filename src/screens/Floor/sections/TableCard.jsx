import { useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Badge, Button, Progress } from '../../../components/ui'
import { TABLE_STATUS_META, TARGETS } from '../../../lib/constants'
import { formatClock, minutesBetween } from '../../../lib/models'
import { quoteWait, useNow, useRestora } from '../../../lib/store'
import { badgeToneFor } from '../shared.js'

function TableCard({ table, onOpen, isSelected, onToggleSelect }) {
  const { state, dispatch } = useRestora()
  const [pointerStart, setPointerStart] = useState(null)
  useNow(15000)
  const meta = TABLE_STATUS_META[table.status] || { label: table.status, tone: 'muted' }
  const occupied = table.status === 'seated' || table.status === 'ordered' || table.status === 'occupied'
  const mins = table.seatedAt ? minutesBetween(table.seatedAt) : 0
  const turnRatio = occupied ? mins / table.targetTurnMinutes : 0
  const longTurn = turnRatio >= TARGETS.turnAlertRatio

  function handlePointerDown(e) {
    setPointerStart({ x: e.clientX, y: e.clientY, time: Date.now() })
  }

  function handlePointerUp(e) {
    if (!pointerStart) return
    const dx = e.clientX - pointerStart.x
    const dy = e.clientY - pointerStart.y
    const dt = Date.now() - pointerStart.time
    setPointerStart(null)
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600) {
      if (dx > 0) {
        // Swipe right: open / seat table
        onOpen(table)
      } else {
        // Swipe left: mark clean / dirty toggle
        if (table.status === 'dirty' || table.status === 'cleaning') {
          dispatch({ type: 'FLOOR_MARK_TABLE_AVAILABLE', payload: { tableId: table.id } })
        } else if (table.status === 'free' || table.status === 'available') {
          dispatch({ type: 'SET_TABLE_STATUS', tableId: table.id, to: 'dirty', force: true })
        }
      }
    }
  }

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
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      aria-label={`${table.name}, ${table.seats} seats, ${meta.label}${occupied ? `, party of ${table.partySize}, seated ${mins} minutes` : ''}`}
      className={`relative min-h-[118px] select-none touch-pan-y rounded-[var(--radius-xl)] border p-3 text-left transition-transform active:scale-[0.98] ${
        isSelected
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]'
          : longTurn
            ? 'border-[var(--warning)]/60 bg-[var(--surface-raised)] ring-2 ring-[var(--warning-soft)]'
            : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]'
      } ${sizeCls}`}
    >
      {onToggleSelect && (
        <span
          role="checkbox"
          aria-checked={isSelected}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(table.id)
          }}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.stopPropagation()
              e.preventDefault()
              onToggleSelect(table.id)
            }
          }}
          className={`absolute top-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border text-xs font-bold transition-all ${
            isSelected
              ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--text-on-accent)]'
              : 'border-[var(--border-strong)] bg-[var(--surface)] text-transparent hover:border-[var(--text-subtle)]'
          }`}
          title="Select table"
        >
          <Icon name="check" size={13} />
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[var(--fs-h3)] font-bold leading-tight text-[var(--text-strong)]">{table.name}</div>
          <div className="text-[var(--fs-caption)] text-[var(--text-muted)]">
            {table.seats} seats · {table.zone}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={badgeToneFor(table.status)} dot>{meta.label}</Badge>
          {table.selfSeated && (
            <Badge tone="info">📱 Self-seated ({table.partySize}p)</Badge>
          )}
        </div>
      </div>

      <div className="mt-2 min-h-10 text-[var(--fs-label)]">
        {occupied ? (
          <>
            <div className="tnum text-[var(--fs-body)] font-semibold text-[var(--text)]">
              Party of {table.partySize || table.seats} · {mins}m
            </div>
            {predictedFree && (
              <div className="mt-0.5 text-[var(--fs-caption)] text-[var(--text-subtle)]">
                free ~{formatClock(predictedFree.at)} ({predictedFree.avg}m avg turn)
              </div>
            )}
          </>
        ) : table.status === 'billing' ? (
          <div className="mt-1 flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--warning-soft)] px-2 py-1.5 ring-1 ring-inset ring-[var(--warning)]/30">
            <span className="text-[var(--fs-caption)] font-semibold text-[var(--warning)]">💳 Guest requested bill &amp; release</span>
            <Button
              size="sm"
              className="min-h-8 px-2 text-[var(--fs-caption)]"
              onClick={(e) => {
                e.stopPropagation()
                dispatch({
                  type: 'MINIAPP_RELEASE_TABLE',
                  payload: { tableId: table.id, forceByStaff: true },
                })
              }}
            >
              Settle &amp; Release
            </Button>
          </div>
        ) : table.status === 'cleaning' ? (
          <div className="mt-1">
            <Button
              size="sm"
              variant="ghost"
              className="w-full bg-[var(--success-soft)] text-[var(--success)] hover:bg-[var(--success-soft)] hover:opacity-90"
              onClick={(e) => {
                e.stopPropagation()
                dispatch({
                  type: 'FLOOR_MARK_TABLE_AVAILABLE',
                  payload: { tableId: table.id },
                })
              }}
            >
              ✨ Mark Clean &amp; Available
            </Button>
          </div>
        ) : table.status === 'billed' ? (
          <div className="text-[var(--text-muted)]">Check paid — needs bussing</div>
        ) : table.status === 'dirty' ? (
          <div className="text-[var(--text-muted)]">Needs bussing + reset</div>
        ) : table.status === 'reserved' ? (
          <div className="text-[var(--text-muted)]">Held for reservation</div>
        ) : (
          <div className="text-[var(--text-subtle)]">Tap to seat</div>
        )}
      </div>

      {occupied && (
        <div className="mt-2">
          <Progress value={Math.min(100, turnRatio * 100)} size="sm" tone={longTurn ? 'warning' : 'success'} label={`${mins}m of ${table.targetTurnMinutes}m target`} />
          {longTurn && (
            <div className="mt-1 flex items-center gap-1 text-[var(--fs-caption)] font-semibold text-[var(--warning)]">
              <Icon name="warning" size={12} />
              Long turn · {mins}m of {table.targetTurnMinutes}m target
            </div>
          )}
        </div>
      )}
    </button>
  )
}


export { TableCard }
