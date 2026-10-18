import { Button, Card } from '../../../components/ui'

// Spec §9.1: a floor snapshot thumbnail that links to the live Floor screen.
// Status is color + an accessible title (never color alone).
const STATUS_CLASS = {
  free: 'bg-[var(--surface-hover)] text-[var(--text-subtle)]',
  seated: 'bg-[var(--info-soft)] text-[var(--info)]',
  ordered: 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
  billed: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  dirty: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  reserved: 'bg-[var(--surface-sunken)] text-[var(--text-muted)]',
}

export default function FloorSnapshot({ copy, tables, occupied, onOpenFloor }) {
  return (
    <Card data-testid="dashboard-floor-snapshot">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[var(--fs-h3)] font-bold text-[var(--text-strong)]">{copy.floorSnapshot}</h2>
          <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">{copy.floorSnapshotSub}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onOpenFloor}>{copy.openFloor}</Button>
      </div>

      <div className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-8">
        {tables.map((table) => (
          <button
            key={table.id}
            type="button"
            onClick={onOpenFloor}
            title={`${table.name} · ${table.status}`}
            aria-label={`${table.name} ${table.status}`}
            className={`flex aspect-square items-center justify-center rounded-[var(--radius-md)] text-[var(--fs-caption)] font-bold ${STATUS_CLASS[table.status] || STATUS_CLASS.free}`}
          >
            {String(table.name).replace(/\D/g, '') || '•'}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[var(--fs-label)] text-[var(--text-muted)]">{copy.tablesOccupied(occupied, tables.length)}</p>
    </Card>
  )
}
