import { useMemo, useState } from 'react'
import { translateText, useI18n } from '../../../lib/i18n'
import { money } from '../../../lib/models'
import { buildReports } from '../../../lib/reports'
import { useRestora } from '../../../lib/store'
import { pct } from '../shared.js'
import { Card, NextAction, ReportShell } from './Common.jsx'

function TopLowReport({ range }) {
  const { lang } = useI18n()
  const { state, setScreen } = useRestora()
  const [side, setSide] = useState('sell')
  const reports = useMemo(() => buildReports(state, range), [state, range])
  const { rankings } = reports

  const sellRows = [
    { title: 'Top sellers · revenue', rows: rankings.sell.byRevenue, value: (row) => row.revenue, sub: (row) => `${row.qty} sold` },
    { title: 'Top sellers · units', rows: rankings.sell.byUnits, value: (row) => row.revenue, sub: (row) => `${row.qty} sold` },
    { title: 'Best margin · contribution', rows: rankings.sell.byMargin, value: (row) => row.margin, sub: (row) => pct(row.marginPct) },
    { title: 'Bottom · weakest contribution', rows: rankings.sell.worst, value: (row) => row.margin, sub: (row) => pct(row.marginPct) },
  ]
  const buyRows = [
    { title: 'Biggest buys · spend', rows: rankings.buy.bySpend, value: (row) => row.value, sub: (row) => `${Math.round(row.qty * 10) / 10} units` },
    { title: 'Biggest buys · units', rows: rankings.buy.byQty, value: (row) => row.value, sub: (row) => `${Math.round(row.qty * 10) / 10} units` },
    { title: 'Smallest buys · spend', rows: rankings.buy.least, value: (row) => row.value, sub: (row) => `${Math.round(row.qty * 10) / 10} units` },
  ]
  const blocks = side === 'sell' ? sellRows : buyRows

  return (
    <ReportShell title="Top & bottom" source={`Ranked sellers and buys from the movement ledger · ${reports.bounds.label}.`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5 rounded-xl bg-[var(--color-ink-900)] p-1 ring-1 ring-inset ring-[var(--color-ink-700)]">
          {[
            { id: 'sell', label: 'Selling side' },
            { id: 'buy', label: 'Buying side' },
          ].map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSide(entry.id)}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold ${side === entry.id ? 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/40' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <span className="tab-i18n-label" data-i18n-tab={translateText(entry.label, lang)}>{entry.label}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500">
          {reports.bounds.label} · {rankings.sell.unsoldCount} menu item(s) sold nothing
        </span>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {blocks.map((block) => (
          <Card key={block.title} title={block.title}>
            {block.rows.length ? (
              <ul className="space-y-1.5">
                {block.rows.map((row, index) => (
                  <li key={row.id || row.name} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="tnum w-5 shrink-0 text-xs font-bold text-zinc-500">{index + 1}</span>
                      <span className="min-w-0 truncate text-zinc-200">{row.name}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`tnum font-semibold ${block.value(row) < 0 ? 'text-red-300' : 'text-zinc-100'}`}>
                        {block.value(row) < 0 ? `−${money(-block.value(row))}` : money(block.value(row))}
                      </span>
                      <span className="ml-2 text-[11px] text-zinc-500">{block.sub(row)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Nothing to rank in this window.</p>
            )}
          </Card>
        ))}

        {side === 'sell' && rankings.sell.unsold.length > 0 && (
          <Card title="Sold nothing this window">
            <ul className="space-y-1.5">
              {rankings.sell.unsold.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-200">{row.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{money(row.price)} · {row.category}</span>
                </li>
              ))}
            </ul>
            <NextAction onGo={() => setScreen('menu')} goLabel="Menu →">
              {rankings.sell.unsoldCount} item(s) earned nothing — reprice, re-describe, or take one off the board.
            </NextAction>
          </Card>
        )}
      </div>
    </ReportShell>
  )
}


export { TopLowReport }
