import { StatTile } from '../../../components/ui'

// The spec §9.1 KPI row: sales, covers, avg check, rolling-7-day food cost,
// occupancy. Each tile can deep-link into the screen that owns the number.
export default function KpiRow({ tiles }) {
  return (
    <div data-testid="dashboard-kpis" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map((tile) => (
        <StatTile key={tile.id} {...tile} />
      ))}
    </div>
  )
}
