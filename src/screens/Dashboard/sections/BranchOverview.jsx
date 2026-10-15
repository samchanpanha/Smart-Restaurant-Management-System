import { Card, SectionHeader } from '../../../components/ui'
import { money } from '../../../lib/models'

// Owner-only: combined sales across every location, with a "selected" marker
// on the currently scoped branch. Switching locations is a real action.
export default function BranchOverview({ copy, locations, locId, onPick }) {
  const combined = locations.reduce((sum, item) => sum + item.dash.sales, 0)
  return (
    <Card>
      <SectionHeader
        title={copy.branchOverview}
        sub={copy.branchOverviewSub}
        actions={<span className="tnum text-sm font-bold text-[var(--accent)]">{money(combined)} {copy.combined}</span>}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {locations.map((item) => {
          const active = locId === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item.id)}
              className={`flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-left transition-colors ${active ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]'}`}
            >
              <span>
                <span className="block text-[var(--fs-body)] font-bold text-[var(--text)]">
                  {item.short}
                  {active && <span className="ml-2 text-3xs font-semibold uppercase tracking-wide text-[var(--accent)]">{copy.selected}</span>}
                </span>
                <span className="mt-1 block text-[var(--fs-label)] text-[var(--text-muted)]">
                  {copy.coversOccupied(item.dash.covers, Math.round(item.dash.occupancy * 100))}
                </span>
              </span>
              <span className="tnum text-[var(--fs-body)] font-bold text-[var(--text)]">{money(item.dash.sales)}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
