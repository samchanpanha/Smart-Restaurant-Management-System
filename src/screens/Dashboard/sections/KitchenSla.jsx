import { Badge, Card, Progress } from '../../../components/ui'
import { TARGETS } from '../../../lib/constants'

// Kitchen SLA: average fire-to-bump time against the KDS target.
export default function KitchenSla({ copy, avgTicketMin }) {
  const target = TARGETS.ticketMinutes
  const has = avgTicketMin > 0
  const onTrack = avgTicketMin <= target
  const ratio = has ? Math.min(100, (avgTicketMin / target) * 100) : 0

  return (
    <Card data-testid="dashboard-kitchen-sla">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[var(--fs-h3)] font-bold text-[var(--text-strong)]">{copy.kitchenSla}</h2>
        {has && <Badge tone={onTrack ? 'success' : 'warning'} dot>{onTrack ? copy.slaOnTrack : copy.slaBehind}</Badge>}
      </div>
      <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">{copy.kitchenSlaSub}</p>

      <div className="mt-4 flex items-end justify-between">
        <span className="tnum text-[27px] font-bold leading-none tracking-tight text-[var(--text-strong)]">
          {has ? `${Math.round(avgTicketMin)} min` : '—'}
        </span>
        <span className="text-[var(--fs-label)] text-[var(--text-subtle)]">{copy.slaTarget(target)}</span>
      </div>

      {has ? (
        <Progress value={ratio} tone={onTrack ? 'success' : 'warning'} className="mt-3" />
      ) : (
        <p className="mt-3 text-[var(--fs-label)] text-[var(--text-subtle)]">{copy.slaEmpty}</p>
      )}
    </Card>
  )
}
