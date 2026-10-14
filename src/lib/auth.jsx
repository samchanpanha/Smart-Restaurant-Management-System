// ─── Session + identity for the terminal workspace ──────────────────
// Talks to the server's /api/auth routes. The workspace itself is still
// usable without a provider (tests, guest links), so useAuth() returns a
// safe anonymous shape instead of throwing when no provider is mounted.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { NAV_SECTIONS } from './constants'

const AuthContext = createContext(null)

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
      const json = await res.json().catch(() => ({}))
      setUser(json.user || null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = useCallback(async (email, password) => {
    const json = await call('/api/auth/login', { email, password })
    setUser(json.user || null)
    return json.user
  }, [])

  const register = useCallback(async (fields) => {
    const json = await call('/api/auth/register', fields)
    setUser(json.user || null)
    return json.user
  }, [])

  const logout = useCallback(async () => {
    try { await call('/api/auth/logout') } catch { /* end the local session regardless */ }
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
