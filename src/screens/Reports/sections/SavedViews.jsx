import { useEffect, useState } from 'react'

const STORAGE_KEY = 'restora.reports.views.v1'

function loadViews() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function SavedViews({ current, onApply }) {
  const [views, setViews] = useState(loadViews)
  const [picked, setPicked] = useState('')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(views))
    } catch {
      // storage full or unavailable — views simply stay in memory
    }
  }, [views])

  function commit() {
    const label = name.trim()
    if (!label) return
    setViews((list) => [...list.filter((view) => view.name !== label), { name: label, ...current }])
    setPicked(label)
    setName('')
    setNaming(false)
  }

  function apply(viewName) {
    setPicked(viewName)
    const view = views.find((entry) => entry.name === viewName)
    if (view) onApply(view)
  }

  function remove() {
    if (!picked) return
    setViews((list) => list.filter((view) => view.name !== picked))
    setPicked('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={picked}
        onChange={(event) => apply(event.target.value)}
        aria-label="Saved views"
        className="min-h-[44px] rounded-xl border-0 bg-[var(--color-ink-900)] px-3 text-sm text-zinc-300 ring-1 ring-inset ring-[var(--color-ink-700)]"
      >
        <option value="">Saved views…</option>
        {views.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}
      </select>

      {naming ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') { setName(''); setNaming(false) }
            }}
            placeholder="View name…"
            aria-label="View name"
            maxLength={32}
            className="min-h-[44px] w-36 rounded-xl border-0 bg-[var(--color-ink-900)] px-3 text-sm text-zinc-200 ring-1 ring-inset ring-[var(--color-ink-700)] outline-none"
          />
          <button type="button" data-testid="save-view-confirm" onClick={commit} className="min-h-[44px] rounded-xl bg-amber-500/15 px-3 text-sm font-semibold text-amber-200 ring-1 ring-inset ring-amber-500/40 hover:bg-amber-500/25">
            Save
          </button>
        </span>
      ) : (
        <button type="button" data-testid="save-view" onClick={() => setNaming(true)} className="min-h-[44px] rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50">
          ＋ Save view
        </button>
      )}

      {picked && (
        <button type="button" data-testid="delete-view" onClick={remove} className="min-h-[44px] rounded-xl px-3 text-sm font-semibold text-zinc-500 hover:text-red-300">
          Delete
        </button>
      )}
    </div>
  )
}

export { SavedViews }
