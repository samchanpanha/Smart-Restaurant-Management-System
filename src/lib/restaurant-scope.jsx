// ─── Which restaurant is this screen managing? ───────────────────────
// Users and Roles are per-restaurant. A normal owner is pinned to their own
// by the server, so this only matters for a super admin:
//
//   • a host owner (the account registration creates) manages **their own
//     restaurant** — the screen says so and sends ?ownerId= explicitly, so the
//     intent is visible and a future refactor cannot silently widen it;
//   • a platform-only admin has no restaurant, so they get a picker to choose
//     one (writes need a target; reads across everything are still allowed).
//
// Without this the requests went out with no owner at all, and every action
// answered "an owner is required".

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api'
import { useAuth } from './auth'

/** `?ownerId=<id>` (or '') for a call to a per-restaurant route. */
export function ownerQuery(ownerId) {
  return ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ''
}

export function useRestaurantScope() {
  const { user } = useAuth()
  const isSuper = Boolean(user?.isSuperAdmin)
  const ownRestaurant = user?.owner || null
  // Derived, not synced: a super admin starts on their own restaurant and the
  // picker only ever overrides that for the current view.
  const [picked, setPicked] = useState('')
  const [owners, setOwners] = useState(() => (ownRestaurant ? [ownRestaurant] : []))
  const ownerId = isSuper ? (picked || ownRestaurant?.id || '') : ''
  const setOwnerId = setPicked

  // A host owner switches between restaurants; a platform admin needs the list
  // to pick from. Only a super admin may read it.
  useEffect(() => {
    if (!isSuper) return undefined
    let alive = true
    apiFetch('/api/admin/owners')
      .then((res) => (res.ok ? res.json() : { owners: [] }))
      .then((json) => { if (alive && Array.isArray(json.owners)) setOwners(json.owners) })
      .catch(() => {})
    return () => { alive = false }
  }, [isSuper])

  const label = useCallback((id) => {
    const found = owners.find((owner) => owner.id === id)
    return found ? found.name : ''
  }, [owners])

  return {
    isSuper,
    /** '' means "no restaurant named" — only valid for reads. */
    ownerId,
    setOwnerId,
    owners,
    ownsRestaurant: Boolean(ownRestaurant),
    currentName: label(ownerId) || ownRestaurant?.name || '',
  }
}
