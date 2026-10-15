// ─── Sign in / register gate for the terminal workspace ─────────────
// Registering creates a host owner (tenant) and its owner account.

import { useState } from 'react'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useAuth } from '../lib/auth'
import { useDomTranslator, useI18n } from '../lib/i18n'

const INPUT = 'w-full rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400 focus:outline-none'

export default function AuthScreen() {
  const { login, register, sessionEnded } = useAuth()
  const { lang, dict } = useI18n()
  useDomTranslator(null, lang)
  const au = dict.auth || {}
  const [mode, setMode] = useState('login')
  const [fields, setFields] = useState({ ownerName: '', name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const setField = (key) => (event) => setFields((prev) => ({ ...prev, [key]: event.target.value }))

  async function onSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'register') {
        await register({
          ownerName: fields.ownerName.trim(),
          name: fields.name.trim(),
          email: fields.email.trim(),
          password: fields.password,
        })
      } else {
        await login(fields.email.trim(), fields.password)
      }
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="restora-theme guest-shell flex items-center justify-center bg-[var(--color-ink-950)] px-4 py-10 text-zinc-100">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20">
              <svg aria-hidden="true" width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 19c-2.2-.4-3.5-2-3.5-4.2 0-2.5 1.8-4.4 4.1-4.7A8.8 8.8 0 0 1 16 4a8.8 8.8 0 0 1 8.4 6.1c2.3.3 4.1 2.2 4.1 4.7 0 2.2-1.3 3.8-3.5 4.2v4.5H7V19Z" />
                <path d="M10 16.5c1.4 1.3 3.4 2 6 2s4.6-.7 6-2M12 24v4m8-4v4" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold leading-none tracking-tight">Restora</div>
              <div className="mt-1 text-2xs tracking-wide text-zinc-500">{dict.brandSubtitle}</div>
            </div>
          </div>
          <LanguageSwitcher compact testIdPrefix="auth-lang" />
        </div>

        <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-6">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-[var(--color-ink-850)] p-1">
            {[
              ['login', au.signIn || 'Sign in', 'Sign in'],
              ['register', au.register || 'Create account', 'Create account'],
            ].map(([id, label, enLabel]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setMode(id); setError('') }}
                className={`min-h-10 rounded-lg text-sm font-bold transition-colors ${mode === id ? 'bg-orange-500 text-white' : 'text-zinc-400 hover:bg-white/5'}`}
              >
                {label}
                {lang !== 'en' && <span className="sr-only"> {enLabel}</span>}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === 'register' && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-zinc-400">{au.restaurantName || 'Restaurant name'}</span>
                <input value={fields.ownerName} onChange={(event) => setField('ownerName')(event)} required placeholder="Harbor Bistro" className={INPUT} />
              </label>
            )}
            {mode === 'register' && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-zinc-400">{au.name || 'Your name'}</span>
                <input value={fields.name} onChange={(event) => setField('name')(event)} required placeholder="Nora Owner" className={INPUT} />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-400">{au.email || 'Email'}</span>
              <input type="email" value={fields.email} onChange={(event) => setField('email')(event)} required autoComplete="username" placeholder="you@restaurant.com" className={INPUT} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-400">{au.password || 'Password'}</span>
              <input
                type="password" value={fields.password} onChange={(event) => setField('password')(event)}
                required minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                placeholder="At least 8 characters" className={INPUT}
              />
            </label>

            {/* A session that ended on its own is not the operator's mistake:
                say what happened instead of showing a bare sign-in form. */}
            {sessionEnded && !error && (
              <p role="status" data-testid="session-ended" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-inset ring-amber-500/30">
                {au.sessionEnded || 'Your session ended — sign in again to continue where you left off.'}
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-inset ring-red-500/30">
                {error}
              </p>
            )}

            <button
              type="submit" disabled={busy}
              className="min-h-11 w-full rounded-xl bg-orange-500 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"
            >
              {busy ? 'Working…' : mode === 'register' ? (au.register || 'Create account') : (au.signIn || 'Sign in')}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-zinc-500">
          {au.subtitle || (mode === 'register'
            ? 'Registering creates your restaurant and its owner account.'
            : 'Sign in to open your restaurant workspace.')}
        </p>
      </div>
    </div>
  )
}
