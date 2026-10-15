import { cn } from '../../lib/cn'

// A token-aware bar chart built from plain elements — no charting library, so
// it renders in jsdom and costs nothing in the bundle. `data` is
// `[{ label, value, tone?, highlight? }]`; bars are normalized to the largest
// value. Accent/status colors come from semantic tokens, so the same chart
// reads correctly on the light workspace and any dark scope.
const toneBar = {
  accent: 'bg-[var(--accent)]',
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--danger)]',
  info: 'bg-[var(--info)]',
  muted: 'bg-[var(--text-subtle)]',
}

export function BarChart({ data = [], height = 190, format = (value) => value, tone = 'accent', className, ...props }) {
  const rows = data.filter((row) => row && Number.isFinite(row.value))
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(row.value)))

  return (
    <div
      className={cn('flex items-end gap-2 border-b border-[var(--border-subtle)] px-1 pb-2 sm:gap-3', className)}
      style={{ height }}
      {...props}
    >
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
          <div className="flex h-full w-full items-end justify-center">
            <div
              title={`${row.label}: ${format(row.value)}`}
              className={cn(
                'w-full max-w-9 rounded-t-[var(--radius-sm)] transition-[height] duration-[var(--duration-slow)] ease-[var(--ease-standard)]',
                toneBar[row.tone] || toneBar[tone],
                row.highlight ? 'opacity-100' : 'opacity-65',
              )}
              style={{ height: `${Math.max(4, (Math.abs(row.value) / maximum) * 100)}%` }}
            />
          </div>
          <span className="max-w-full truncate text-[var(--fs-caption)] text-[var(--text-subtle)]">{row.label}</span>
        </div>
      ))}
    </div>
  )
}

export default BarChart
