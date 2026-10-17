// ─── Session + identity for the terminal workspace ──────────────────
// Talks to the server's /api/auth routes. The workspace itself is still
// usable without a provider (tests, guest links), so useAuth() returns a
// safe anonymous shape instead of throwing when no provider is mounted.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { NAV_SECTIONS } from './constants'

const AuthContext = createContext(null)

// ─── Cached sign-in for offline terminals ───────────────────────────
// While the link is down, /api/auth/me is unreachable — without a cache,
// a refresh would bounce the operator to the sign-in screen mid-shift.
// The last successful /api/auth/me result is stored with a timestamp;
// offline boot restores it until the TTL lapses (the practical offline
// answer to a revoked device token, which cannot be detected without
// the network). Cleared by explicit sign-out or a server "not signed in".
const SESSION_CACHE_KEY = 'restora-session-cache-v1'
const SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function saveSessionCache(user) {
  if (!user || typeof user !== 'object') return
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      userId: String(user.id || ''),
      email: String(user.email || ''),
      name: String(user.name || ''),
      role: typeof user.role === 'object' ? String(user.role?.id || '') : String(user.role || ''),
      roleLabel: typeof user.role === 'object' ? String(user.role?.label || '') : '',
      isSuperAdmin: Boolean(user.isSuperAdmin),
      screens: Array.isArray(user.screens) ? user.screens : null,
      // The branch pin (auth_users.location_id). Offline actions must
      // stay on this branch — the server rejects anything else.
      scopeLocationId: user.locationId ? String(user.locationId) : null,
      cachedAt: Date.now(),
    }))
  } catch {
    /* storage unavailable — offline gating just cannot run */
  }
}

function readSessionCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_CACHE_KEY) || 'null')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** The cached identity, or null when missing or past its TTL. */
export function usableCachedSession(now = Date.now()) {
  const cached = readSessionCache()
  if (!cached || !cached.cachedAt) return null
  return now - cached.cachedAt < SESSION_CACHE_TTL_MS ? cached : null
}

function clearSessionCache() {
  try { localStorage.removeItem(SESSION_CACHE_KEY) } catch { /* ignore */ }
}

// Every screen a super admin grant ("*") unlocks.
export const ALL_SCREENS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.id))

function normalizeScreens(screens) {
  if (!Array.isArray(screens) || screens.length === 0) return null
  if (screens.includes('*')) return ALL_SCREENS
  return screens
}

const ANONYMOUS = {
  user: null,
  loading: false,
  screens: null,
  login: async () => { throw new Error('Auth is not available here') },
  register: async () => { throw new Error('Auth is not available here') },
  logout: async () => {},
  refresh: async () => {},
}

async function call(route, body) {
  const res = await fetch(route, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong')
  return json
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      // The server answered: its verdict is the truth. Explicit
      // "not signed in" clears the cache; an offline fallback must not
      // resurrect a session the authority just rejected.
      if (!res.ok) { clearSessionCache(); setUser(null); return }
      const json = await res.json().catch(() => ({}))
      setUser(json.user || null)
      if (json.user) saveSessionCache(json.user)
      else clearSessionCache()
    } catch {
      // Network failure (server unreachable): keep the operator working
      // from the cached identity until its TTL runs out.
      const cached = usableCachedSession()
      setUser(cached ? {
        id: cached.userId,
        email: cached.email,
        name: cached.name || cached.email,
        role: cached.roleLabel ? { id: cached.role, label: cached.roleLabel } : cached.role,
        isSuperAdmin: Boolean(cached.isSuperAdmin),
        screens: cached.screens || null,
        locationId: cached.scopeLocationId || null,
      } : null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = useCallback(async (email, password) => {
    const json = await call('/api/auth/login', { email, password })
    setUser(json.user || null)
    if (json.user) saveSessionCache(json.user)
    return json.user
  }, [])

  const register = useCallback(async (fields) => {
    const json = await call('/api/auth/register', fields)
    setUser(json.user || null)
    if (json.user) saveSessionCache(json.user)
    return json.user
  }, [])

  const logout = useCallback(async () => {
    try { await call('/api/auth/logout') } catch { /* end the local session regardless */ }
    // A deliberate sign-out also ends the offline one: the next offline
    // boot must go to the sign-in screen, not resurrect this identity.
    clearSessionCache()
    setUser(null)
  }, [])

  const screens = useMemo(() => normalizeScreens(user?.screens), [user])

  const value = useMemo(
    () => ({ user, loading, screens, login, register, logout, refresh }),
    [user, loading, screens, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext) || ANONYMOUS
}
