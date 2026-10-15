// ─── Host owners (super admin) ──────────────────────────────────────
// The platform-level console: every restaurant tenant, who runs it, and
// whether the tenant is active. Only a super admin reaches this screen.

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
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

export default function OwnersScreen() {
  const { lang, dict } = useI18n()
  const ow = dict.owners || {}
  const [owners, setOwners] = useState([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState({ ownerName: '', name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await getJson('/api/admin/owners')
      setOwners(list.owners || [])
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
      await send('POST', '/api/admin/owners', {
        ownerName: draft.ownerName.trim(),
        name: draft.name.trim(),
        email: draft.email.trim(),
        password: draft.password,
      })
      setDraft({ ownerName: '', name: '', email: '', password: '' })
      await load()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(id, status) {
    try { await send('PATCH', `/api/admin/owners/${id}`, { status }); await load() } catch (failure) { setError(failure.message) }
  }

  async function remove(id) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this restaurant and all its data?')) return
    try { await send('DELETE', `/api/admin/owners/${id}`); await load() } catch (failure) { setError(failure.message) }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          {ow.title || 'Host owners'}
          {lang !== 'en' && <span className="sr-only"> Host owners</span>}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {ow.subtitle || 'Every restaurant on the platform. Suspend, reactivate, or offboard a tenant.'}
          {lang !== 'en' && <span className="sr-only"> Every restaurant on the platform. Suspend, reactivate, or offboard a tenant.</span>}
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className={`${cardCls} overflow-hidden`}>
          {!ready ? (
            <p className="px-5 py-8 text-sm text-zinc-400">Loading…</p>
          ) : owners.length === 0 ? (
            <p className="px-5 py-8 text-sm text-zinc-400">No restaurants yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {owners.map((owner) => (
                <li key={owner.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                    <Icon name="building" size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-800">{owner.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{owner.slug} · {owner.userCount} user{owner.userCount === 1 ? '' : 's'}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${owner.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {owner.status === 'active' ? (ow.active || 'active') : (ow.suspended || owner.status)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStatus(owner.id, owner.status === 'active' ? 'suspended' : 'active')}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                  >
                    {owner.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                  <button type="button" onClick={() => remove(owner.id)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${owner.name}`}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardCls} p-5`}>
          <h2 className="text-sm font-bold text-zinc-800">{ow.addOwner || 'Onboard a restaurant'}</h2>
          <form className="mt-3 space-y-3" onSubmit={create}>
            <input required placeholder={ow.restaurantName || 'Restaurant name'} value={draft.ownerName} onChange={(event) => setDraft({ ...draft, ownerName: event.target.value })} className={input} />
            <input required placeholder={ow.ownerName || 'Owner name'} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={input} />
            <input required type="email" placeholder={ow.ownerEmail || 'Owner email'} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className={input} />
            <input required type="password" minLength={8} placeholder="Temporary password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} className={input} />
            <button type="submit" disabled={busy} className={btnPrimary}>{ow.createOwner || 'Create restaurant'}</button>
          </form>
        </section>
      </div>
    </div>
  )
}
