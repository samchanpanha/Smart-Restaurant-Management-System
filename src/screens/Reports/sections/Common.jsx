import { money } from '../../../lib/models'

function ReportShell({ title, source, action, children }) {
  return (
    <div className="space-y-4">
      {(title || source || action) && (
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && <h2 className="text-lg font-bold tracking-tight text-zinc-100">{title}</h2>}
            {source && <p className="mt-0.5 text-[11px] text-zinc-500">{source}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </div>
  )
}

function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
      <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function NextAction({ children, onGo, goLabel }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 ring-1 ring-inset ring-emerald-500/30">
      <div className="text-sm text-emerald-200">
        <span className="font-bold">Next action: </span>
        {children}
      </div>
      {onGo && (
        <button
          type="button"
          onClick={onGo}
          className="min-h-[36px] shrink-0 rounded-lg bg-emerald-500/20 px-3 text-xs font-bold text-emerald-200 ring-1 ring-inset ring-emerald-500/40 hover:bg-emerald-500/30"
        >
          {goLabel || 'Go →'}
        </button>
      )}
    </div>
  )
}

function Bars({ rows, format = money }) {
  const max = Math.max(...rows.map((r) => r.value), 0.001)
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-zinc-300">{r.label}</span>
            <span className="tnum shrink-0 font-bold text-zinc-100">
              {format(r.value)}
              {r.sub && <span className="ml-1.5 font-normal text-zinc-500">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/50">
            <div
              className="h-full rounded-full bg-amber-500/80"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}


export { ReportShell, Card, NextAction, Bars }
