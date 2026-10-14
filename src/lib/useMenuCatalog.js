// Read the normalized SQLite catalog when the API is online; use the
// reducer snapshot as the offline/demo fallback and for immediate updates.
//
// The guest surfaces are mounted twice on a phone (the mini app wraps the
// guest screen) and every store tick re-runs the effect that asks for the
// catalog, so the read is de-duplicated, cached for a short window, and
// debounced. Without that a busy shift turns one phone into a stream of
// /api/menu requests — each of which re-reads SQLite — which is felt as a
// mini app that "takes forever".
import { useEffect, useMemo, useState } from 'react'

const CACHE_TTL_MS = 30_000
const DEBOUNCE_MS = 350

const catalogCache = new Map() // `${owner}|${locationId}` → { items, at }
const inFlight = new Map() // same key → Promise<items|null>

/** Guest links carry ?owner=<slug>; signed-in terminals use their cookie. */
function tenantOwner() {
  try {
    return new URLSearchParams(window.location.search).get('owner') || ''
  } catch {
    return ''
  }
}

function loadCatalog(key, locationId, owner) {
  const hit = inFlight.get(key)
  if (hit) return hit
  const search = new URLSearchParams({ loc: locationId })
  if (owner) search.set('owner', owner)
  const promise = fetch(`/api/menu?${search.toString()}`)
    .then((response) => {
      if (!response.ok) throw new Error(`menu catalog ${response.status}`)
      return response.json()
    })
    .then((result) => {
      const items = Array.isArray(result.items) ? result.items : null
      if (items) catalogCache.set(key, { items, at: Date.now() })
      return items
    })
    .catch(() => null) // the app still works from its local state
    .finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

export function useMenuCatalog(menu, locationId, linkStatus) {
  const owner = tenantOwner()
  const key = `${owner}|${locationId}`
  const [catalog, setCatalog] = useState(() => {
    const hit = catalogCache.get(key)
    return hit ? { locationId, items: hit.items } : { locationId: null, items: null }
  })

  useEffect(() => {
    if (linkStatus !== 'live') return undefined
    const hit = catalogCache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      setCatalog({ locationId, items: hit.items })
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      loadCatalog(key, locationId, owner).then((items) => {
        if (!cancelled && items) setCatalog({ locationId, items })
      })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `menu` is a trigger, not a payload: any menu mutation may have
    // landed, and the debounce collapses a burst into one read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locationId, owner, linkStatus, menu])

  const items = useMemo(() => {
    const persistedItems = catalog.locationId === locationId ? catalog.items : null
    const persistedById = new Map((persistedItems || []).map((item) => [item.id, item]))

    return menu.map((item) => {
      const persisted = persistedById.get(item.id)
      return {
        ...persisted,
        ...item,
        // New catalog fields are available from SQLite on older snapshots too.
        description: item.description ?? persisted?.description ?? '',
        dietaryTags: item.dietaryTags ?? persisted?.dietaryTags ?? [],
        allergens: item.allergens ?? persisted?.allergens ?? [],
        imageUrl: item.imageUrl ?? persisted?.imageUrl ?? '',
        active: item.active ?? persisted?.active ?? true,
        sortOrder: item.sortOrder ?? persisted?.sortOrder ?? 0,
      }
    })
  }, [catalog, locationId, menu])

  return {
    items,
    source: linkStatus === 'live' && catalog.locationId === locationId && catalog.items ? 'sqlite' : 'local',
  }
}
