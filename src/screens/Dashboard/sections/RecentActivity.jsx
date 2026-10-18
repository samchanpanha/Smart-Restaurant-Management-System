import { Card, EmptyState, SectionHeader } from '../../../components/ui'
import { Icon } from '../../../components/Icon'

const TONE_ICON = {
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
}

export default function RecentActivity({ copy, items, onViewAll, relTime }) {
  return (
    <Card>
      <SectionHeader
        title={copy.recentActivity}
        actions={<button type="button" onClick={onViewAll} className="text-[var(--fs-label)] font-semibold text-[var(--accent-text)] hover:text-[var(--accent-text)]">{copy.viewAll}</button>}
      />
      {items.length ? (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] ${TONE_ICON[item.tone] || TONE_ICON.accent}`}>
                <Icon name={item.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--fs-label)] font-semibold text-[var(--text)]">{item.title}</span>
                <span className="mt-0.5 block truncate text-[var(--fs-caption)] text-[var(--text-subtle)]">{item.detail}</span>
              </span>
              <span className="shrink-0 text-[var(--fs-caption)] text-[var(--text-subtle)]">{relTime(item.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={copy.noActivityYet} />
      )}
    </Card>
  )
}
