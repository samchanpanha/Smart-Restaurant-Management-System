import { Icon } from '../../../components/Icon'
import { TABLE_STATUS_META } from '../../../lib/constants'
import { translateZone, useI18n } from '../../../lib/i18n'
import { statusLabel, toneClass } from '../shared.js'

// The floor plan's filter strip: zones on the first row, the status legend on
// the second. Both act like filters — a chip dims every table that does not
// match instead of removing it, so the room keeps its geography while the eye
// narrows. `filter` is a string: 'all' | 'attention' | 'z:<zone>' | 's:<status>'.
const LEGEND_STATUSES = ['free', 'reserved', 'seated', 'ordered', 'billed', 'dirty']

const chipBase =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[var(--fs-label)] font-semibold transition-colors'
const chipIdle =
  'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
const chipActive = 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
const chipWarn = 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]'
const pill = 'tnum rounded-full bg-[var(--surface-hover)] px-1.5 text-[var(--fs-caption)] font-bold'

function FloorToolbar({ zones, counts, filter, onFilter }) {
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  // Tapping the active chip clears the filter — the map always has a way back.
  const toggle = (next) => onFilter(filter === next ? 'all' : next)

  return (
    <div className="space-y-2 border-b border-[var(--border-subtle)] px-5 py-3">
      {/* Screen readers get the count the dimming shows at a glance. */}
      {filter !== 'all' && counts.dimmed > 0 && (
        <span role="status" aria-live="polite" className="sr-only">
          {counts.total - counts.dimmed} of {counts.total} tables match this filter
        </span>
      )}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        <span className="flex shrink-0 items-center gap-1 pr-1 text-[var(--fs-caption)] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
          <Icon name="layers" size={12} />
          Zones
        </span>
        <button
          type="button"
          aria-pressed={filter === 'all'}
          onClick={() => onFilter('all')}
          className={`${chipBase} ${filter === 'all' ? chipActive : chipIdle}`}
        >
          {f.allTables || 'All tables'}
          <span className={pill}>{counts.total}</span>
        </button>
        <button
          type="button"
          aria-pressed={filter === 'attention'}
          onClick={() => toggle('attention')}
          className={`${chipBase} ${filter === 'attention' ? chipWarn : chipIdle}`}
        >
          <Icon name="warning" size={12} />
          {f.needsAttention || 'Needs attention'}
          {counts.attention > 0 && (
            <span className="tnum rounded-full bg-[var(--warning-soft)] px-1.5 text-[var(--fs-caption)] font-bold text-[var(--warning)]">
              {counts.attention}
            </span>
          )}
        </button>
        {zones.map((zone) => {
          const active = filter === `z:${zone.name}`
          return (
            <button
              key={zone.id || zone.name}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(`z:${zone.name}`)}
              className={`${chipBase} ${active ? chipActive : chipIdle}`}
            >
              {translateZone(zone.name, lang)}
              <span className={pill}>{zone.count}</span>
            </button>
          )
        })}
      </div>

      <div
        className="flex items-center gap-2 overflow-x-auto pb-0.5"
        role="group"
        aria-label="Table status filter"
      >
        <span className="shrink-0 pr-1 text-[var(--fs-caption)] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
          {f.status || 'Status'}
        </span>
        {LEGEND_STATUSES.map((status) => {
          const meta = TABLE_STATUS_META[status]
          const active = filter === `s:${status}`
          const count = counts.byStatus[status] || 0
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              disabled={count === 0}
              onClick={() => toggle(`s:${status}`)}
              className={`${chipBase} ${active ? chipActive : chipIdle} disabled:opacity-40`}
            >
              <i className={`h-2.5 w-2.5 rounded-full ${toneClass(status).split(' ')[0]}`} aria-hidden="true" />
              {statusLabel(status, lang)}
              <span className={`${pill} opacity-70`}>{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { FloorToolbar }
