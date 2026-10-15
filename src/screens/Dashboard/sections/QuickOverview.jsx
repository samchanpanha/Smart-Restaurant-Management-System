import { Card, SectionHeader } from '../../../components/ui'
import { Icon } from '../../../components/Icon'

// Live counters that double as deep links into the four operational screens.
export default function QuickOverview({ copy, items, onOpen }) {
  return (
    <Card>
      <SectionHeader title={copy.quickOverview} sub={copy.quickOverviewSub} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Icon name={item.icon} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[var(--fs-body)] font-bold text-[var(--text)]">{item.label}</span>
              <span className="mt-0.5 block truncate text-[var(--fs-caption)] text-[var(--text-subtle)]">{item.detail}</span>
            </span>
            <span aria-hidden="true" className="text-[var(--accent)]">›</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
