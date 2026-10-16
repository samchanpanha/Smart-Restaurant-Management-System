import { useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Field, Card, inputCls } from '../primitives'
import { useRestora } from '../../../lib/store'

// Branch management for a host owner. The empire already keeps one shop per
// location; this screen creates, renames, removes, and switches between them.
// Creating a branch dispatches an empire-level CREATE_LOCATION action
// (reducer.js) — it is not wrapped in LOC, because the target shop does not
// exist yet — and the server persists the whole snapshot exactly like
// RESET_ALL. Removing is empire-level too, and refuses to drop the last shop.
//
// The second card ties branches together: one branch's menu (items, prices,
// categories) can be pushed to every other branch. Each target gets its own
// REPLACE_MENU shop action, so the server log, SSE terminals and guests all
// agree on the result. Recipes stay per branch.
//
// No native prompt/confirm: destructive actions use inline two-step confirms
// so a tablet stays usable.

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function BranchesSection() {
  const {
    empire, locId, setLocId, locations, createLocation, removeLocation, pushMenuToAllBranches, dispatchTo,
  } = useRestora()
  const [name, setName] = useState('')
  const [locIdInput, setLocIdInput] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { id, draft }
  const [removing, setRemoving] = useState(null) // branch id awaiting confirm
  const [pushing, setPushing] = useState(false) // menu push awaiting confirm
  const [pushStatus, setPushStatus] = useState('')

  const branches = useMemo(
    () => locations.map((location) => {
      const settings = empire.locations?.[location.id]?.settings || {}
      return {
        id: location.id,
        short: location.short,
        name: settings.restaurantName || location.short,
        city: settings.city || '',
        logoUrl: settings.logoUrl || '',
        initials: settings.logoInitials || '',
        brandColor: settings.brandColor || '#f97316',
      }
    }),
    [locations, empire],
  )
  const otherCount = Math.max(0, branches.length - 1)

  function onName(next) {
    setName(next)
    if (!locIdInput || locIdInput === slugify(name)) setLocIdInput(slugify(next))
  }

  function create() {
    setError('')
    const trimmed = name.trim()
    if (!trimmed) { setError('Give the branch a name.'); return }
    const id = (locIdInput.trim() || slugify(trimmed)).toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!id) { setError('Branch ID must contain letters or numbers.'); return }
    if (locations.some((location) => location.id === id)) { setError('That branch ID already exists.'); return }
    createLocation(id, trimmed)
    setName('')
    setLocIdInput('')
  }

  function commitRename() {
    if (!editing) return
    const trimmed = editing.draft.trim()
    if (trimmed) dispatchTo(editing.id, { type: 'UPDATE_SETTINGS', patch: { restaurantName: trimmed } })
    setEditing(null)
  }

  function confirmRemove() {
    if (!removing) return
    removeLocation(removing)
    setRemoving(null)
  }

  function confirmPush() {
    const pushed = pushMenuToAllBranches(locId)
    setPushing(false)
    setPushStatus(pushed
      ? `Menu pushed to ${pushed} branch${pushed === 1 ? '' : 'es'}.`
      : 'Nothing to push — the open branch has no menu items.')
  }

  return (
    <div className="space-y-4">
      <Card
        title="Branches & locations"
        sub="One owner can run several branches. Each branch keeps its own menu, floor, inventory, reports, and settings."
        actions={<span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">{branches.length} branch{branches.length === 1 ? '' : 'es'}</span>}
      >
        <div className="space-y-2.5">
          {branches.map((branch) => (
            <div key={branch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-3" data-testid={`branch-${branch.id}`} aria-current={branch.id === locId ? 'true' : undefined}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
                  {branch.logoUrl
                    ? <img src={branch.logoUrl} alt={branch.name} className="max-h-full max-w-full object-contain" />
                    : <span className="text-sm font-bold" style={{ color: branch.brandColor }}>{branch.initials || branch.name.slice(0, 2).toUpperCase()}</span>}
                </div>
                {editing?.id === branch.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={editing.draft}
                      onChange={(event) => setEditing({ id: branch.id, draft: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename()
                        if (event.key === 'Escape') setEditing(null)
                      }}
                      maxLength={80}
                      className={inputCls}
                      aria-label={`Rename ${branch.name}`}
                    />
                    <button type="button" onClick={commitRename} className="min-h-9 shrink-0 rounded-lg bg-zinc-900 px-3 text-xs font-bold text-white">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className="min-h-9 shrink-0 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-600">Cancel</button>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-zinc-900">{branch.name}</span>
                      {branch.id === locId && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">Open here</span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-zinc-500">
                      <span className="tnum">{branch.id}</span>{branch.city ? ` · ${branch.city}` : ''}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {removing === branch.id ? (
                  <>
                    <span className="text-xs font-semibold text-red-600">Remove branch? Its menu, floor, and history are dropped.</span>
                    <button
                      type="button"
                      onClick={confirmRemove}
                      data-testid={`confirm-remove-${branch.id}`}
                      className="min-h-9 shrink-0 rounded-lg bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(null)}
                      data-testid={`keep-branch-${branch.id}`}
                      className="min-h-9 shrink-0 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={branch.id === locId}
                      onClick={() => setLocId(branch.id)}
                      className="min-h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      {branch.id === locId ? 'Current' : 'Switch to'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: branch.id, draft: branch.name })}
                      className="min-h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={branches.length <= 1}
                      onClick={() => setRemoving(branch.id)}
                      data-testid={`remove-branch-${branch.id}`}
                      title={branches.length <= 1 ? 'The last branch cannot be removed.' : undefined}
                      className="min-h-9 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-zinc-600">
            <Icon name="plus" size={14} /> Add a branch
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Branch name">
              <input value={name} onChange={(event) => onName(event.target.value)} maxLength={80} className={inputCls} placeholder="Downtown, Riverside, Airport…" data-testid="branch-name" />
            </Field>
            <Field label="Branch ID" hint="URL-safe id used in ?loc= and sync. Auto-filled from the name.">
              <input
                value={locIdInput}
                onChange={(event) => setLocIdInput(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                maxLength={32}
                className={`${inputCls} tnum`}
                placeholder="airport"
                data-testid="branch-id"
              />
            </Field>
          </div>
          {error && <p className="mt-2 text-xs font-semibold text-red-600" data-testid="branch-error">{error}</p>}
          <button type="button" onClick={create} className="mt-3 min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600" data-testid="create-branch">
            Create branch
          </button>
          <p className="mt-2 text-[11px] text-zinc-500">
            The new branch starts from the shared demo defaults. Set its identity, logo, and rules from the other sections.
          </p>
        </div>
      </Card>

      <Card
        title="Menu across branches"
        sub="Copies the open branch's items, prices, and categories to every other branch. Availability (86s) stays with each branch."
      >
        {otherCount < 1 ? (
          <p className="text-xs text-zinc-500">Add a branch to push this menu beyond the one you run today.</p>
        ) : pushing ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-3">
            <span className="text-xs font-semibold text-orange-800">
              Push this menu to every other branch? Their current menus are replaced.
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={confirmPush}
                data-testid="confirm-push-menu"
                className="min-h-9 rounded-lg bg-orange-500 px-3 text-xs font-bold text-white hover:bg-orange-600"
              >
                Push menu
              </button>
              <button
                type="button"
                onClick={() => setPushing(false)}
                className="min-h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">The branch open on this terminal becomes the source.</p>
            <button
              type="button"
              onClick={() => { setPushStatus(''); setPushing(true) }}
              data-testid="push-menu"
              className="min-h-9 shrink-0 rounded-lg bg-zinc-900 px-3 text-xs font-bold text-white hover:bg-zinc-800"
            >
              Push menu to all branches
            </button>
          </div>
        )}
        {pushStatus && (
          <p className="mt-2 text-xs font-semibold text-emerald-700" data-testid="push-menu-status" role="status">
            {pushStatus}
          </p>
        )}
      </Card>
    </div>
  )
}

export { BranchesSection }
