import { Badge, Card, EmptyState } from '../../../components/ui'
import { BAND_TONE } from '../shared'

function Row({ item, copy, trailing }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="flex min-w-0 items-center gap-2">
        <Badge tone={BAND_TONE[item.band] || 'neutral'} dot>{copy.bands?.[item.band] || item.band}</Badge>
        <span className="truncate text-[var(--fs-body)] font-semibold text-[var(--text)]">{item.menu?.name || '—'}</span>
      </span>
      <span className="tnum shrink-0 text-[var(--fs-label)] font-semibold text-[var(--text-muted)]">{trailing}</span>
    </li>
  )
}

// Spec §9.1: top-5 sellers and bottom-5 contribution, computed by
// `getDashboard` so the model never recomputes margin bands here.
export default function MenuEngineering({ copy, topSellers, bottomContribution }) {
  const empty = !topSellers.length && !bottomContribution.length
  if (empty) {
    return (
      <Card>
        <EmptyState title={copy.noSalesYet} sub={copy.topSellersSub} />
      </Card>
    )
  }

  return (
    <div data-testid="dashboard-menu-engineering" className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="text-[var(--fs-h3)] font-bold text-[var(--text-strong)]">{copy.topSellers}</h2>
        <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">{copy.topSellersSub}</p>
        <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
          {topSellers.map((item) => (
            <Row key={item.menu?.id || item.menu?.name} item={item} copy={copy} trailing={copy.unitsSold(item.qty)} />
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-[var(--fs-h3)] font-bold text-[var(--text-strong)]">{copy.bottomContribution}</h2>
        <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">{copy.bottomContributionSub}</p>
        <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
          {bottomContribution.map((item) => (
            <Row
              key={item.menu?.id || item.menu?.name}
              item={item}
              copy={copy}
              trailing={copy.contributionPct(Math.round(item.contribution * 100))}
            />
          ))}
        </ul>
      </Card>
    </div>
  )
}
