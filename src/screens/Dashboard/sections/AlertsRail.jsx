import { Badge, Button, Card } from '../../../components/ui'
import { Icon } from '../../../components/Icon'

// The actionable alert rail (spec §9.1): late tickets, low stock, the 86 list,
// and below-10%-margin dishes. The top item gets a full recommendation card;
// the rest render as compact chips that deep-link to the owning screen.
const ALERT_TONE = {
  late_ticket: 'warning',
  bill_request: 'info',
  long_turn: 'warning',
  call_server: 'info',
  low_stock: 'warning',
  '86': 'danger',
  negative_margin: 'danger',
}

export default function AlertsRail({ copy, lang, alerts, onOpen }) {
  const [top, ...rest] = alerts
  const shown = rest.slice(0, 4)

  return (
    <Card data-testid="dashboard-alerts" className="flex flex-col border-[var(--warning)]/30 bg-[var(--accent-soft)] lg:col-span-4">
      <div className="flex items-center gap-2 text-[var(--accent)]">
        <Icon name="sparkles" size={18} />
        <h2 className="text-[var(--fs-h3)] font-bold">
          {copy.insightForYou}
          {lang !== 'en' && <span className="sr-only"> Insight for you</span>}
        </h2>
      </div>

      {top ? (
        <div className="mt-4 flex items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--fs-label)] font-bold text-[var(--text-on-accent)]">!</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-[var(--text-strong)]">{top.label}</div>
            <p className="mt-1 text-[var(--fs-label)] leading-relaxed text-[var(--text-muted)]">{top.detail}</p>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="text-sm font-bold text-[var(--text-strong)]">{copy.runningSmoothly}</div>
          <p className="mt-1 text-[var(--fs-label)] leading-relaxed text-[var(--text-muted)]">{copy.noUrgentAlerts}</p>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="mt-4 space-y-2">
          {shown.map((alert) => (
            <li key={alert.id || alert.key || alert.label}>
              <button
                type="button"
                onClick={() => onOpen(alert)}
                className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--surface)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[var(--fs-label)] font-semibold text-[var(--text)]">{alert.label}</span>
                  <span className="block truncate text-[var(--fs-caption)] text-[var(--text-subtle)]">{alert.detail}</span>
                </span>
                <Badge tone={ALERT_TONE[alert.type] || 'neutral'}>{alert.type.replace(/_/g, ' ')}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="primary"
        className="mt-5"
        onClick={() => onOpen(top, true)}
      >
        {top ? copy.openRecommended : copy.openKitchenView}
        <span aria-hidden="true">→</span>
      </Button>
    </Card>
  )
}
