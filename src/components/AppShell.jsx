// ─── Restora app shell ────────────────────────────────────────────
// Role-aware nav: Live / Control / Insight (+ Settings).
// Dark operational surface for Live, per spec §10.

import StatusPill from './StatusPill'
import { NAV_SECTIONS, ROLES, ROLE_NAV } from '../lib/constants'
import { useRestora } from '../lib/store'

export default function AppShell({ children }) {
  const { state, dispatch, role, setRole, screen, setScreen, link, resync, notice } = useRestora()
  const allowed = ROLE_NAV[role] || []

  const linkPill =
    link.status === 'live'
      ? { tone: 'ok', label: 'Live · server' }
      : link.status === 'offline'
        ? { tone: 'warn', label: 'Offline · this terminal' }
        : { tone: 'muted', label: 'Local demo' }

  return (
    <div className="flex h-full min-h-screen bg-[var(--color-ink-950)] text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--color-ink-700)] bg-[var(--color-ink-900)]">
        <div className="border-b border-[var(--color-ink-700)] px-5 py-4">
          <div className="text-xl font-bold tracking-tight">
            Restora
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-amber-300 ring-1 ring-inset ring-amber-500/40">
              Demo
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-400">
            {state.settings.restaurantName}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill tone={linkPill.tone} size="sm">
              {linkPill.label}
            </StatusPill>
            {link.mode === 'server' && (
              <button
                type="button"
                onClick={() => resync()}
                title="Reload authoritative snapshot from server"
                className="min-h-[28px] rounded-md border border-[var(--color-ink-600)] px-2 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                Resync
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((i) => allowed.includes(i.id))
            if (!items.length) return null
            return (
              <div key={section.id} className="mb-4">
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {section.label}
                </div>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setScreen(item.id)}
                    className={`mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      screen === item.id
                        ? 'bg-amber-500/15 font-semibold text-amber-200 ring-1 ring-inset ring-amber-500/40'
                        : 'text-zinc-300 hover:bg-white/5'
                    }`}
                  >
                    {item.label}
                    <span className="text-[10px] text-zinc-600">step {item.step}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-[var(--color-ink-700)] p-3">
          <label htmlFor="role" className="mb-1 block px-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Acting as
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => {
              const r = e.target.value
              setRole(r)
              const nav = ROLE_NAV[r]
              if (!nav.includes(screen)) setScreen(nav[0])
            }}
            className="w-full rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-800)] px-2.5 py-2 text-sm text-zinc-100"
          >
            {Object.entries(ROLES).map(([id, r]) => (
              <option key={id} value={id}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const scope = link.mode === 'server' ? 'ALL terminals' : 'this terminal'
              if (window.confirm(`Reset demo data to the Friday-night seed on ${scope}?`)) {
                dispatch({ type: 'RESET_ALL' })
              }
            }}
            className="mt-2 w-full rounded-lg border border-[var(--color-ink-600)] px-2.5 py-2 text-xs text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-300"
          >
            Reset demo data{link.mode === 'server' ? ' (all terminals)' : ''}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          {notice && (
            <div className="animate-status-in mb-4 rounded-xl bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200 ring-1 ring-inset ring-sky-500/40" role="status">
              {notice}
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  )
}
