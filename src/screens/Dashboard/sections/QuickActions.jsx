import { Card, SectionHeader } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
import { cn } from '../../../lib/cn'

const TONE_ICON = {
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
}

// Shortcut grid — only screens this role may open are passed in.
export default function QuickActions({ copy, actions, onOpen }) {
  return (
    <Card>
      <SectionHeader
        title={copy.quickActions}
        actions={<span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[var(--fs-caption)] font-bold uppercase tracking-wide text-[var(--accent-text)]">{copy.shortcuts}</span>}
      />
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => {
          const label = copy.actions?.[action.id] || action
          return (
            <button
              key={action.screen}
              type="button"
              onClick={() => onOpen(action.screen)}
              className="flex min-h-[90px] flex-col items-start justify-between rounded-[var(--radius-lg)] border border-[var(--border)] p-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
            >
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)]', TONE_ICON[action.tone] || TONE_ICON.accent)}>
                <Icon name={action.icon} size={18} />
              </span>
              <span>
                <span className="block text-[var(--fs-label)] font-bold text-[var(--text)]">{label.label}</span>
                <span className="mt-0.5 block text-[var(--fs-caption)] text-[var(--text-subtle)]">{label.detail}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
