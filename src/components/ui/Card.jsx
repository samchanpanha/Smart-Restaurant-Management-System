import { cn } from '../../lib/cn'

// A neutral surface container. Replaces the ~289 hand-rolled
// "rounded-2xl border ..." cards with one place to change radius/elevation.
export function Card({ as: Tag = 'div', className, inset = false, ...props }) {
  return (
    <Tag
      className={cn(
        'rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]',
        inset ? 'p-4' : 'p-5',
        className,
      )}
      {...props}
    />
  )
}

export function SectionHeader({ title, sub, actions, className, icon, id }) {
  return (
    // The header wraps instead of clipping: when the title block and the
    // actions cannot share one line, the actions drop to their own line. The
    // actions wrapper also lets its own children wrap, so a long row of
    // controls (badge + toggle + button) folds inside a narrow card instead of
    // forcing the card — and the page — into a horizontal scroll.
    <div className={cn('mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2', className)}>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-[var(--fs-h2)] font-bold tracking-tight text-[var(--text-strong)]">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {sub && <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">{sub}</p>}
      </div>
      {actions && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:flex-wrap">
          {actions}
        </div>
      )}
    </div>
  )
}

export function Toolbar({ children, className, ...props }) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      role="toolbar"
      {...props}
    >
      {children}
    </div>
  )
}

export function Divider({ className }) {
  return <hr className={cn('border-0 border-t border-[var(--border-subtle)]', className)} />
}

export function Skeleton({ className, ...props }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-hover)]', className)}
      {...props}
    />
  )
}

export function EmptyState({ title, sub, icon, action, className }) {
  return (
    <div className={cn('rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] px-6 py-10 text-center', className)}>
      {icon && <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[var(--text-muted)]">{icon}</div>}
      <p className="text-[var(--fs-h3)] font-semibold text-[var(--text-strong)]">{title}</p>
      {sub && <p className="mx-auto mt-1 max-w-md text-[var(--fs-body)] text-[var(--text-muted)]">{sub}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

const alertTones = {
  info: 'bg-[var(--info-soft)] text-[var(--info)] ring-[var(--info)]/30',
  success: 'bg-[var(--success-soft)] text-[var(--success)] ring-[var(--success)]/30',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)] ring-[var(--warning)]/30',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)] ring-[var(--danger)]/30',
}

export function ErrorBanner({ tone = 'danger', children, className, onDismiss }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start justify-between gap-3 rounded-[var(--radius-lg)] px-4 py-2.5 text-[var(--fs-body)] ring-1 ring-inset', alertTones[tone], className)}
    >
      <span className="min-w-0">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-current/70 hover:text-current">
          ×
        </button>
      )}
    </div>
  )
}
