import { useMemo } from 'react'
import { money } from '../../../lib/models'
import { buildEmpireReports } from '../../../lib/reports'
import { useRestora } from '../../../lib/store'
import { Card, ReportShell } from './Common.jsx'

// The cross-branch view: one row per location, then the combined total.
// Every figure comes from the same ticket maths the single-branch reports
// use, so a row here always equals that branch's own Sales report. Clicking a
// row (or its Open button) switches this terminal to that branch — the whole
// workspace follows through setLocId, exactly like the dashboard card.
function BranchReport({ range }) {
  const { empire, locId, setLocId } = useRestora()
  const report = useMemo(() => buildEmpireReports(empire, range), [empire, range])
  const { bounds, branches, combined } = report

  if (branches.length < 2) {
    return (
      <ReportShell title="All branches" source="One row per branch, totalled.">
        <Card title="Only one branch so far">
          <p className="text-sm text-zinc-400">
            Create another branch from Settings → Branches to compare locations here.
          </p>
        </Card>
      </ReportShell>
    )
  }

  return (
    <ReportShell
      title="All branches"
      source={`Same ticket maths as the single-branch reports, totalled per location · ${bounds.label}. Click a branch to open it on this terminal.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{money(combined.netSales)}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Combined net sales · {bounds.label}
          </div>
          <div className="mt-1.5 text-xs text-zinc-500">{money(combined.takings)} collected across every branch</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{combined.checks}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Combined checks</div>
          <div className="mt-1.5 text-xs text-zinc-500">{combined.checks ? `${money(combined.avgCheck)} average check` : 'no checks yet'}</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{combined.covers}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Guests (Covers)</div>
          <div className="mt-1.5 text-xs text-zinc-500">across every branch in the window</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
          <div className="tnum text-3xl font-bold">{Math.round(combined.marginPct * 100)}%</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Gross margin</div>
          <div className="mt-1.5 text-xs text-zinc-500">{money(combined.grossProfit)} gross profit after food cost</div>
        </div>
      </div>

      <Card title="Branch comparison">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                <th className="py-2 pr-3">Branch</th>
                <th className="py-2 pr-3 text-right">Net sales</th>
                <th className="py-2 pr-3 text-right">Checks</th>
                <th className="py-2 pr-3 text-right">Avg check</th>
                <th className="py-2 pr-3 text-right">Covers</th>
                <th className="py-2 pr-3 text-right">Top seller</th>
                <th className="py-2 text-right"><span className="sr-only">Open branch</span></th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => {
                const active = branch.id === locId
                return (
                  <tr
                    key={branch.id}
                    data-testid={`branch-report-${branch.id}`}
                    aria-current={active ? 'true' : undefined}
                    className={`border-t border-[var(--color-ink-700)]/60 ${active ? 'bg-amber-500/10' : 'hover:bg-white/5'}`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-100">{branch.name}</span>
                        {active && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">Open here</span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        <span className="tnum">{branch.id}</span>{branch.city ? ` · ${branch.city}` : ''}
                      </div>
                    </td>
                    <td className="tnum py-2.5 pr-3 text-right font-bold text-zinc-100">{money(branch.sales.netSales)}</td>
                    <td className="tnum py-2.5 pr-3 text-right text-zinc-300">{branch.sales.checks}</td>
                    <td className="tnum py-2.5 pr-3 text-right text-zinc-300">{branch.sales.checks ? money(branch.sales.avgCheck) : '—'}</td>
                    <td className="tnum py-2.5 pr-3 text-right text-zinc-300">{branch.sales.covers}</td>
                    <td className="py-2.5 pr-3 text-right text-zinc-300">
                      {branch.top ? `${branch.top.name} × ${branch.top.qty}` : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        disabled={active}
                        onClick={() => setLocId(branch.id)}
                        className="min-h-8 rounded-lg bg-amber-500/20 px-3 text-xs font-bold text-amber-200 ring-1 ring-inset ring-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40"
                      >
                        {active ? 'Here' : 'Open →'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--color-ink-700)]">
                <td className="py-2.5 pr-3 font-bold uppercase tracking-wide text-zinc-300">Combined</td>
                <td className="tnum py-2.5 pr-3 text-right font-bold text-amber-200">{money(combined.netSales)}</td>
                <td className="tnum py-2.5 pr-3 text-right font-bold text-zinc-100">{combined.checks}</td>
                <td className="tnum py-2.5 pr-3 text-right font-bold text-zinc-100">{combined.checks ? money(combined.avgCheck) : '—'}</td>
                <td className="tnum py-2.5 pr-3 text-right font-bold text-zinc-100">{combined.covers}</td>
                <td className="py-2.5 pr-3" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Reports and stock stay per branch — switches never mix one branch&apos;s numbers into another.
        </p>
      </Card>
    </ReportShell>
  )
}

export { BranchReport }
