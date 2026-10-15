import { cn } from '../../lib/cn'

// A slim, token-aware progress bar. `value` is a percentage (clamped 0–100);
// `max` is derived from 100 so callers can pass raw ratios×100. Tone maps to
// the semantic status tokens so bars read the same on every surface.
const toneBar = {
  accent: 'bg-[var(--accent)]',
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--danger)]',
  info: 'bg-[var(--info)]',
}

export function Progress({ value = 0, tone = 'accent', max = 100, size = 'md', className, label, ...props }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const pct = Math.round(ratio * 100)
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        'w-full overflow-hidden rounded-full bg-[var(--surface-hover)]',
        size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-2.5' : 'h-2',
        className,
      )}
      {...props}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-[var(--duration-base)] ease-[var(--ease-standard)]', toneBar[tone] || toneBar.accent)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
