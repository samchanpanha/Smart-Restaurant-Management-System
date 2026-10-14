// ─── Roles ──────────────────────────────────────────────────────────
// A role is a named set of screens. System roles ship with Restora and
// cannot be edited; owners add their own (Shift lead, Bar, …).

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { ALL_SCREENS } from '../lib/auth'
import { NAV_SECTIONS } from '../lib/constants'

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white shadow-sm'
const input = 'min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'
const btnPrimary = 'min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50'

const SCREEN_LABELS = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, item.label])),
)

async function getJson(route) {
  const res = await fetch(route)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed')
  return res.json()
}

async function send(method, route, body) {
  const res = await fetch(route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed')
  return res.json().catch(() => ({}))
}

export default function RolesScreen() {
  const [roles, setRoles] = useState([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState({ key: '', label: '', screens: [] })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await getJson('/api/roles')
      setRoles(list.roles || [])
      setError('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggleScreen(id) {
    setDraft((current) => ({
      ...current,
      screens: current.screens.includes(id)
        ? current.screens.filter((entry) => entry !== id)
        : [...current.screens, id],
    }))
  }

  async function create(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await send('POST', '/api/roles', draft)
      setDraft({ key: '', label: '', screens: [] })
      await load()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this role?')) return
    try { await send('DELETE', `/api/roles/${id}`); await load() } catch (failure) { setError(failure.message) }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Roles</h1>
        <p className="mt-1 text-sm text-zinc-500">Each role is a set of screens. System roles are fixed; add your own for house jobs.</p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className={`${cardCls} overflow-hidden`}>
          {!ready ? (
            <p className="px-5 py-8 text-sm text-zinc-400">Loading…</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {roles.map((role) => (
                <li key={role.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                      <Icon name="shield" size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-800">{role.label}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-400">{role.key}</span>
                    </span>
                    {role.isSystem && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">System</span>}
                    {!role.isSystem && (
                      <button type="button" onClick={() => remove(role.id)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${role.label}`}>
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                    {(role.screens.includes('*') ? ALL_SCREENS : role.screens).map((id) => (
                      <span key={id} className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-inset ring-orange-100">
                        {SCREEN_LABELS[id] || id}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardCls} p-5`}>
          <h2 className="text-sm font-bold text-zinc-800">New role</h2>
          <form className="mt-3 space-y-3" onSubmit={create}>
            <input required placeholder="Name (Shift lead)" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className={input} />
            <input required placeholder="Key (shift_lead)" value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} className={input} />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2">
              {ALL_SCREENS.map((id) => (
                <label key={id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                  <input type="checkbox" checked={draft.screens.includes(id)} onChange={() => toggleScreen(id)} className="h-4 w-4 accent-orange-500" />
                  {SCREEN_LABELS[id] || id}
                </label>
              ))}
            </div>
            <button type="submit" disabled={busy} className={btnPrimary}>Create role</button>
          </form>
        </section>
      </div>
    </div>
  )
}
