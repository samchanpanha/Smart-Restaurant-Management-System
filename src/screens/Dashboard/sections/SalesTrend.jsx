import { BarChart, Button, Card, EmptyState, SectionHeader, Sparkline } from '../../../components/ui'
import { money } from '../../../lib/models'

// Sales overview: a 7-day + tonight bar chart, a "sales vs last week"
// sparkline, and the honest empty state ("Shift not started" + last close).
export default function SalesTrend({ copy, lang, history, today, lastClose, hasSales, onOpenReports }) {
  const rows = [
    ...history.slice(-7).map((entry) => ({ label: entry.day, value: entry.sales })),
    { label: copy.today, value: today, highlight: true },
  ]
  const avg = history.length ? history.reduce((sum, entry) => sum + entry.sales, 0) / history.length : 0
  const deltaPct = avg > 0 ? Math.round(((today - avg) / avg) * 100) : 0
  const spark = rows.map((row) => row.value)

  return (
    <Card data-testid="dashboard-sales" className="lg:col-span-8">
      <SectionHeader
        title={
          <>
            {copy.salesOverview}
            {lang !== 'en' && <span className="sr-only"> Today&apos;s sales overview</span>}
          </>
        }
        sub={copy.salesOverviewSub}
        actions={<Button variant="secondary" size="sm" onClick={onOpenReports}>{copy.viewReports}</Button>}
      />

      {hasSales ? (
        <>
          <BarChart data={rows} format={(value) => money(value)} />
          <div className="mt-3 flex items-center justify-between text-[var(--fs-label)] text-[var(--text-muted)]">
            <span>{copy.salesLast7Days}</span>
            <span className="tnum font-semibold text-[var(--text-strong)]">{copy.today} {money(today)}</span>
          </div>

          <div data-testid="dashboard-sales-spark" className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-lg)] bg-[var(--surface-sunken)] px-4 py-3">
            <div className="min-w-0">
              <p className="text-[var(--fs-label)] font-medium text-[var(--text-muted)]">{copy.salesVsLastWeek}</p>
              <p className={`tnum text-sm font-bold ${deltaPct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {copy.vsLastWeek(deltaPct)}
              </p>
            </div>
            <Sparkline values={spark} tone={deltaPct >= 0 ? 'success' : 'danger'} width={132} height={40} />
          </div>
        </>
      ) : (
        <EmptyState
          icon={<span aria-hidden="true">◷</span>}
          title={copy.shiftNotStarted}
          sub={copy.shiftNotStartedSub}
          action={lastClose != null && <span className="text-[var(--fs-label)] text-[var(--text-muted)]">{copy.lastClose(money(lastClose))}</span>}
        />
      )}
    </Card>
  )
}
