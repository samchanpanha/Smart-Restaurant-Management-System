import { Icon } from '../Icon'
import { cn } from '../../lib/cn'
import { Card } from './Card'
import { Progress } from './Progress'
import { Sparkline } from './Sparkline'

// A KPI tile: icon + label, a large tabular value, an optional foot note, and
// optional progress or sparkline embellishments. Renders as a `<button>` when
// `onClick` is given, so tiles can deep-link into the owning screen.
const toneIcon = {
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
}

const progressTone = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
}

export function StatTile({
  icon,
  label,
  value,
  unit,
  foot,
  tone = 'accent',
  progress,
  spark,
  onClick,
  className,
  ...props
}) {
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'

  return (
    <Card
      as={Tag}
      inset
      onClick={onClick}
      type={interactive ? 'button' : undefined}
      className={cn(
        'flex min-h-[136px] flex-col text-left',
        interactive && 'cursor-pointer transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]',
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)]', toneIcon[tone] || toneIcon.accent)}>
            <Icon name={icon} size={18} />
          </span>
        )}
        <span className="min-w-0 pt-0.5 text-[var(--fs-label)] font-medium leading-tight text-[var(--text-muted)]">{label}</span>
      </div>

      {spark && spark.length > 1 && (
        <div className="mt-2 flex justify-end text-[var(--accent)]">
          <Sparkline values={spark} tone={progressTone[tone]} width={120} height={28} />
        </div>
      )}

      <div className="tnum mt-auto pt-3 text-kpi font-bold leading-none tracking-tight text-[var(--text-strong)]">
        {value}
        {unit && <span className="ml-1 text-base font-medium text-[var(--text-subtle)]">{unit}</span>}
      </div>

      {progress != null && (
        <Progress value={progress} tone={progressTone[tone]} size="sm" className="mt-3" />
      )}

      {foot && <div className="mt-2 text-[var(--fs-caption)] leading-snug text-[var(--text-subtle)]">{foot}</div>}
    </Card>
  )
}
