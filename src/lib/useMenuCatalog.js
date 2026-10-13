// Read the normalized SQLite catalog when the API is online; use the
// reducer snapshot as the offline/demo fallback and for immediate updates.
import { useEffect, useMemo, useState } from 'react'

export function useMenuCatalog(menu, locationId, linkStatus) {
  const [catalog, setCatalog] = useState({ locationId: null, items: null })

  useEffect(() => {
    if (linkStatus !== 'live') return undefined

    const controller = new AbortController()
    fetch(`/api/menu?loc=${encodeURIComponent(locationId)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`menu catalog ${response.status}`)
        return response.json()
      })
      .then((result) => {
        if (Array.isArray(result.items)) {
          setCatalog({ locationId, items: result.items })
        }
      })
      .catch(() => {
        // The app still works from its local state if the read model is offline.
      })

    return () => controller.abort()
  }, [locationId, linkStatus, menu])

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
