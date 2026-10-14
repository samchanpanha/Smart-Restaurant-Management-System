// ─── Users ──────────────────────────────────────────────────────────
// The people who can sign in to this restaurant. An owner creates staff,
// gives each one a role, and can disable or remove them.

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white shadow-sm'
const input = 'min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'
const btnPrimary = 'min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50'

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

export default function UsersScreen() {
  const { user: me } = useAuth()
  const { lang, dict } = useI18n()
  const us = dict.users || {}
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState({ name: '', email: '', password: '', roleId: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [userList, roleList] = await Promise.all([getJson('/api/users'), getJson('/api/roles')])
      setUsers(userList.users || [])
      setRoles(roleList.roles || [])
      setError('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function create(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await send('POST', '/api/users', draft)
      setDraft({ name: '', email: '', password: '', roleId: '' })
      await load()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function patch(id, body) {
    try { await send('PATCH', `/api/users/${id}`, body); await load() } catch (failure) { setError(failure.message) }
  }

  async function remove(id) {
    if (typeof window !== 'undefined' && !window.confirm('Remove this user?')) return
    try { await send('DELETE', `/api/users/${id}`); await load() } catch (failure) { setError(failure.message) }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          {us.title || 'Users'}
          {lang !== 'en' && <span className="sr-only"> Users</span>}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {us.subtitle || 'Who can sign in to this restaurant, and which role they hold.'}
          {lang !== 'en' && <span className="sr-only"> Who can sign in to this restaurant, and which role they hold.</span>}
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className={`${cardCls} overflow-hidden`}>
          <div className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-700">
            {users.length} {users.length === 1 ? 'person' : 'people'}
          </div>
          {!ready ? (
            <p className="px-5 py-8 text-sm text-zinc-400">Loading…</p>
          ) : users.length === 0 ? (
            <p className="px-5 py-8 text-sm text-zinc-400">No users yet. Add the first one on the right.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {users.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600">
                    {(entry.name || entry.email || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-800">
                      {entry.name}
                      {entry.id === me?.id && <span className="ml-2 text-[11px] font-medium text-zinc-400">you</span>}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">{entry.email}</span>
                  </span>
                  <span className="text-xs font-medium text-zinc-600">{entry.role?.label || entry.roleId}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${entry.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {entry.status === 'active' ? (us.active || 'active') : (us.disabled || entry.status)}
                  </span>
                  <select
                    aria-label={`Role for ${entry.name}`}
                    value={entry.roleId || ''}
                    onChange={(event) => patch(entry.id, { roleId: event.target.value })}
                    className="min-h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700"
                  >
                    {roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => patch(entry.id, { status: entry.status === 'active' ? 'disabled' : 'active' })}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                  >
                    {entry.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" onClick={() => remove(entry.id)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${entry.name}`}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardCls} p-5`}>
          <h2 className="text-sm font-bold text-zinc-800">{us.addUser || 'Add a user'}</h2>
          <form className="mt-3 space-y-3" onSubmit={create}>
            <input required placeholder={us.name || 'Full name'} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={input} />
            <input required type="email" placeholder={us.email || 'Email'} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className={input} />
            <input required type="password" minLength={8} placeholder={us.password || 'Temporary password'} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} className={input} />
            <select required value={draft.roleId} onChange={(event) => setDraft({ ...draft, roleId: event.target.value })} className={input}>
              <option value="">{us.role || 'Choose a role…'}</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
            </select>
            <button type="submit" disabled={busy || roles.length === 0} className={`${btnPrimary} w-full`}>
              {busy ? 'Adding…' : (us.createUser || 'Add user')}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
