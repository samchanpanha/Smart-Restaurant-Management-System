import { useRef } from 'react'
import { cn } from '../../lib/cn'

// Accessible tab strip with roving focus + arrow-key navigation.
// Items: [{ id, label, count?, icon? }]. Purely presentational — the owner
// decides what each id means.
export function Tabs({ items, value, onChange, className, ariaLabel = 'Tabs', size = 'md' }) {
  const ref = useRef(null)

  function onKeyDown(event) {
    const list = items || []
    const index = list.findIndex((item) => item.id === value)
    if (index < 0) return
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % list.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + list.length) % list.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = list.length - 1
    else return
    event.preventDefault()
    const target = list[next]
    onChange?.(target.id)
    ref.current?.querySelector(`[data-tab-id="${target.id}"]`)?.focus()
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-1 overflow-x-auto', className)}
    >
      {(items || []).map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-tab-id={item.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(item.id)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] font-semibold transition-colors',
              size === 'sm' ? 'min-h-9 px-3 text-[var(--fs-label)]' : 'min-h-10 px-3.5 text-[var(--fs-body)]',
              active
                ? 'bg-[var(--surface)] text-[var(--text-strong)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
            )}
          >
            {item.icon}
            {item.label}
            {item.count != null && (
              <span className="rounded-full bg-[var(--surface-hover)] px-1.5 text-[var(--fs-caption)] font-bold">{item.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
