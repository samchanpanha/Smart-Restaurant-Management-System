import { cn } from '../../lib/cn'

export function Field({ label, hint, error, htmlFor, children, className }) {
  return (
    <label className={cn('block', className)} htmlFor={htmlFor}>
      {label && (
        <span className="mb-1 block text-[var(--fs-caption)] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
          {label}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-[var(--fs-label)] text-[var(--danger)]">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[var(--fs-label)] text-[var(--text-subtle)]">{hint}</span>
      ) : null}
    </label>
  )
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--fs-body)] text-[var(--text)] transition-colors placeholder:text-[var(--text-subtle)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        'min-h-[88px] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--fs-body)] text-[var(--text)] transition-colors placeholder:text-[var(--text-subtle)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        'min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--fs-body)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Toggle({ checked, onChange, label, id, className, disabled }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-40',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
        className,
      )}
    >
      <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}

// Legacy-compatible stepper (value / onChange / min / max).
export function Stepper({ value, onChange, min = 1, max = 12, className }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] text-xl text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
      >
        −
      </button>
      <div className="tnum min-w-14 text-center text-2xl font-bold text-[var(--text-strong)]" aria-live="polite">
        {value}
      </div>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] text-xl text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
      >
        +
      </button>
    </div>
  )
}
