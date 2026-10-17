// ─── Roles ──────────────────────────────────────────────────────────
// A role is a named set of screens. System roles ship with Restora and
// cannot be edited; owners add their own (Shift lead, Bar, …).
// Provides a visual permission matrix editor and a card overview.

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useConfirm } from '../components/ui/confirm-context'
import { ALL_SCREENS } from '../lib/auth'
import { NAV_SECTIONS, SCREEN_ICONS } from '../lib/constants'
import { translateScreenLabel, useI18n } from '../lib/i18n'

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white shadow-sm'
const input = 'min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50 transition'
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition'

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
  const confirm = useConfirm()
  const { lang, dict } = useI18n()
  const rl = dict.rolesScreen || {}
  const [roles, setRoles] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [ready, setReady] = useState(false)
  const [viewMode, setViewMode] = useState('matrix') // 'matrix' | 'cards'
  const [showAddModal, setShowAddModal] = useState(false)
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

  function toggleDraftScreen(id) {
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
      setShowAddModal(false)
      setSuccess('Role created successfully')
      setTimeout(() => setSuccess(''), 3000)
      await load()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    const ok = await confirm({
      title: 'Delete this role?',
      body: 'Anyone holding it needs another role before it goes.',
      confirmLabel: 'Delete role',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await send('DELETE', `/api/roles/${id}`)
      await load()
    } catch (failure) {
      setError(failure.message)
    }
  }

  async function togglePermission(role, screenId) {
    if (role.isSystem) return
    const currentScreens = role.screens.includes('*') ? ALL_SCREENS : role.screens
    const newScreens = currentScreens.includes(screenId)
      ? currentScreens.filter((s) => s !== screenId)
      : [...currentScreens, screenId]

    // Optimistic UI update
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, screens: newScreens } : r)))

    try {
      await send('PATCH', `/api/roles/${role.id}`, { screens: newScreens })
      setError('')
    } catch (err) {
      setError(err.message)
      // Revert on failure
      setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, screens: currentScreens } : r)))
    }
  }

  async function bulkRoleSet(role, enable) {
    if (role.isSystem) return
    const currentScreens = role.screens
    const newScreens = enable ? [...ALL_SCREENS] : []
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, screens: newScreens } : r)))

    try {
      await send('PATCH', `/api/roles/${role.id}`, { screens: newScreens })
      setError('')
    } catch (err) {
      setError(err.message)
      setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, screens: currentScreens } : r)))
    }
  }

  async function bulkToggleScreenRow(screenId) {
    const customRoles = roles.filter((r) => !r.isSystem)
    if (!customRoles.length) return
    const anyHas = customRoles.some((r) => (r.screens.includes('*') ? ALL_SCREENS : r.screens).includes(screenId))
    const turnOn = !anyHas

    for (const role of customRoles) {
      const cur = role.screens.includes('*') ? ALL_SCREENS : role.screens
      const has = cur.includes(screenId)
      if ((turnOn && !has) || (!turnOn && has)) {
        await togglePermission(role, screenId)
      }
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {rl.title || 'Roles'}
            {lang !== 'en' && <span className="sr-only"> Roles</span>}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {rl.subtitle || 'Each role is a set of screens. System roles are fixed; add your own for house jobs.'}
            {lang !== 'en' && (
              <span className="sr-only"> Each role is a set of screens. System roles are fixed; add your own for house jobs.</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-zinc-100 p-1 text-xs font-semibold text-zinc-600">
            <button
              type="button"
              onClick={() => setViewMode('matrix')}
              className={`rounded-lg px-3 py-1.5 transition ${viewMode === 'matrix' ? 'bg-white text-zinc-900 shadow-sm' : 'hover:text-zinc-900'}`}
            >
              Permission Matrix
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`rounded-lg px-3 py-1.5 transition ${viewMode === 'cards' ? 'bg-white text-zinc-900 shadow-sm' : 'hover:text-zinc-900'}`}
            >
              Role Cards
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className={btnPrimary}
          >
            <Icon name="plus" size={16} />
            <span>{rl.addRole || 'New role'}</span>
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {error}
        </p>
      )}

      {success && (
        <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
          {success}
        </p>
      )}

      {!ready ? (
        <div className={`${cardCls} px-5 py-12 text-center text-sm text-zinc-400`}>
          Loading roles…
        </div>
      ) : viewMode === 'matrix' ? (
        /* ─── Visual Permission Matrix Grid ─── */
        <div className={`${cardCls} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80">
                  <th className="sticky left-0 z-20 min-w-[240px] bg-zinc-50/95 px-4 py-3.5 font-bold text-zinc-700 backdrop-blur-sm">
                    Screens & Permissions
                  </th>
                  {roles.map((role) => (
                    <th key={role.id} className="min-w-[140px] px-3 py-3.5 text-center font-semibold text-zinc-800">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-zinc-900">{role.label}</span>
                          {role.isSystem ? (
                            <span title="System role (fixed)" className="rounded-md bg-zinc-200/70 p-0.5 text-zinc-500">
                              <Icon name="lock" size={12} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => remove(role.id)}
                              className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete role"
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-zinc-400">{role.key}</span>

                        {!role.isSystem && (
                          <div className="mt-1.5 flex gap-1 text-[10px]">
                            <button
                              type="button"
                              onClick={() => bulkRoleSet(role, true)}
                              className="rounded px-1.5 py-0.5 font-medium text-orange-600 hover:bg-orange-50"
                            >
                              All
                            </button>
                            <span className="text-zinc-300">·</span>
                            <button
                              type="button"
                              onClick={() => bulkRoleSet(role, false)}
                              className="rounded px-1.5 py-0.5 font-medium text-zinc-500 hover:bg-zinc-100"
                            >
                              None
                            </button>
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100">
                {NAV_SECTIONS.map((section) => (
                  <tr key={`section-${section.id}`} className="bg-zinc-100/50">
                    <td
                      colSpan={roles.length + 1}
                      className="px-4 py-1.5 text-xs font-bold tracking-wide text-zinc-500 uppercase"
                    >
                      {section.label}
                    </td>
                  </tr>
                )).flatMap((sectionRow, sIdx) => {
                  const section = NAV_SECTIONS[sIdx]
                  const rows = section.items.map((item) => {
                    const screenId = item.id
                    const screenLabel = translateScreenLabel(screenId, item.label, lang)
                    const iconName = SCREEN_ICONS[screenId] || 'layers'

                    return (
                      <tr key={screenId} className="transition hover:bg-orange-50/20">
                        <td className="sticky left-0 z-10 bg-white/95 px-4 py-2.5 backdrop-blur-sm">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
                                <Icon name={iconName} size={15} />
                              </span>
                              <div className="min-w-0">
                                <span className="block truncate font-medium text-zinc-800">{screenLabel}</span>
                                <span className="block truncate font-mono text-[10px] text-zinc-400">{screenId}</span>
                              </div>
                            </div>

                            {roles.some((r) => !r.isSystem) && (
                              <button
                                type="button"
                                onClick={() => bulkToggleScreenRow(screenId)}
                                title="Toggle for all custom roles"
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                              >
                                Toggle
                              </button>
                            )}
                          </div>
                        </td>

                        {roles.map((role) => {
                          const active = role.screens.includes('*') || role.screens.includes(screenId)
                          return (
                            <td key={role.id} className="px-3 py-2.5 text-center">
                              {role.isSystem ? (
                                <span
                                  className={`inline-flex h-5 w-5 items-center justify-center rounded ${
                                    active ? 'bg-orange-100 text-orange-700' : 'bg-zinc-100 text-zinc-300'
                                  }`}
                                  title={`System role ${role.label}: ${active ? 'Enabled' : 'Disabled'}`}
                                >
                                  {active ? <Icon name="check" size={13} strokeWidth={2.5} /> : '—'}
                                </span>
                              ) : (
                                <label className="inline-flex cursor-pointer items-center justify-center p-1">
                                  <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => togglePermission(role, screenId)}
                                    className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-orange-500 accent-orange-500 focus:ring-orange-200"
                                  />
                                </label>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                  return [sectionRow, ...rows]
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ─── Role Cards View ─── */
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <section className={`${cardCls} overflow-hidden`}>
            <ul className="divide-y divide-zinc-100">
              {roles.map((role) => (
                <li key={role.id} className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                      <Icon name="shield" size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-800">{role.label}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-400">{role.key}</span>
                    </span>
                    {role.isSystem && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                        {rl.systemRole || 'System'}
                      </span>
                    )}
                    {!role.isSystem && (
                      <button
                        type="button"
                        onClick={() => remove(role.id)}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${role.label}`}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 pl-12">
                    {(role.screens.includes('*') ? ALL_SCREENS : role.screens).map((id) => (
                      <span
                        key={id}
                        className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-inset ring-orange-100"
                      >
                        {translateScreenLabel(id, SCREEN_LABELS[id] || id, lang)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className={`${cardCls} p-5 self-start`}>
            <h2 className="text-sm font-bold text-zinc-800">{rl.addRole || 'New role'}</h2>
            <form className="mt-3 space-y-3" onSubmit={create}>
              <input
                required
                placeholder={rl.roleName || 'Name (Shift lead)'}
                value={draft.label}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                className={input}
              />
              <input
                required
                placeholder="Key (shift_lead)"
                value={draft.key}
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                className={input}
              />
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2">
                {ALL_SCREENS.map((id) => (
                  <label key={id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                    <input
                      type="checkbox"
                      checked={draft.screens.includes(id)}
                      onChange={() => toggleDraftScreen(id)}
                      className="h-4 w-4 accent-orange-500"
                    />
                    {translateScreenLabel(id, SCREEN_LABELS[id] || id, lang)}
                  </label>
                ))}
              </div>
              <button type="submit" disabled={busy} className={btnPrimary}>
                {rl.createRole || 'Create role'}
              </button>
            </form>
          </section>
        </div>
      )}

      {/* Modal for New Role (can be opened in matrix view) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-zinc-200">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
              <h2 className="text-lg font-bold text-zinc-900">{rl.addRole || 'New custom role'}</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            <form className="mt-4 space-y-4" onSubmit={create}>
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">Role name</label>
                <input
                  required
                  placeholder={rl.roleName || 'e.g. Sommelier'}
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className={input}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">Key (slug identifier)</label>
                <input
                  required
                  placeholder="e.g. sommelier"
                  value={draft.key}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                  className={input}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">Initial allowed screens</label>
                <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2">
                  {ALL_SCREENS.map((id) => (
                    <label key={id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.screens.includes(id)}
                        onChange={() => toggleDraftScreen(id)}
                        className="h-4 w-4 accent-orange-500"
                      />
                      {translateScreenLabel(id, SCREEN_LABELS[id] || id, lang)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={btnSecondary}
                >
                  Cancel
                </button>
                <button type="submit" disabled={busy} className={btnPrimary}>
                  {rl.createRole || 'Create role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
