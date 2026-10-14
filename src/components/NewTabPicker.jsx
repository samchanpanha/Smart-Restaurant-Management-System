// ─── New-tab picker ─────────────────────────────────────────────────
// Chrome opens a new tab on its own page; the workspace does the same:
// a fresh tab asks which screen it should hold instead of quietly
// cloning the screen that is already open (which made "+" look broken).
// Screens that are already on the strip stay one click away and are
// flagged, so an operator can tell a second view from a duplicate.

import { NAV_SECTIONS, ROLE_NAV, SCREEN_ICONS } from '../lib/constants'
import { useRestora } from '../lib/store'
import { Icon } from './Icon'

export default function NewTabPicker() {
  const { role, tabs, setScreen, reopenClosedTab, canReopenClosed, openScreenInTab } = useRestora()
  const allowed = ROLE_NAV[role] || ROLE_NAV.owner
  const openScreens = new Set(tabs.map((tab) => tab.screen))

  return (
    <div data-testid="new-tab-picker" className="mx-auto max-w-4xl">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-900">New tab</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Pick the screen this tab should hold. Every tab keeps its own screen, table and scroll
              position while the restaurant data stays live and shared.
            </p>
          </div>
          {canReopenClosed && (
            <button
              type="button"
              onClick={reopenClosedTab}
              className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
            >
              Reopen closed tab
            </button>
          )}
        </div>

        <div className="mt-6 space-y-5">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => allowed.includes(item.id))
            if (!items.length) return null
            return (
              <div key={section.id}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{section.label}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item) => {
                    const already = openScreens.has(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => (already ? openScreenInTab(item.id) : setScreen(item.id))}
                        className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-left hover:border-orange-300 hover:bg-orange-50"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600">
                          <Icon name={SCREEN_ICONS[item.id] || 'dashboard'} size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-zinc-800">{item.label}</span>
                          <span className="mt-0.5 block text-[11px] text-zinc-500">
                            {already ? 'Already open — jump to that tab' : item.hint || 'Open in this tab'}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <p className="mt-6 border-t border-zinc-100 pt-4 text-xs text-zinc-500">
          Tip: <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold">Ctrl</kbd>/
          <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold">⌘</kbd>+click a
          sidebar item to open it in a new tab, middle-click for a background tab, and
          <kbd className="ml-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold">Alt</kbd>+
          <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold">T</kbd> for
          another new tab. Clicking a sidebar item opens it in its own tab (or jumps to it if
          it is already open). Chrome keeps Ctrl+T for its own tabs, so the workspace uses Alt+T.
        </p>
      </div>
    </div>
  )
}
