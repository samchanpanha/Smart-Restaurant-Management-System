// ─── Restora app shell cache ────────────────────────────────────────
// Registered only in production builds. Caches the built app assets so a
// terminal can reload with no network (the React app then runs read-only on
// its cached localStorage snapshot: nothing is saved while the API is
// unreachable). The API is never cached: /api state, actions and SSE stay
// live-only.
//
// Strategy: cache-first for same-origin GETs with a stale-while-revalidate
// refresh, network-first fallthrough, and an index.html fallback for
// navigations so a cold reload still boots the SPA.

const CACHE = 'restora-shell-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.allSettled(SHELL.map((url) => cache.add(url)))
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(req)
    if (cached) {
      // Refresh silently; the terminal keeps running on the stale copy
      // until this resolves, which is exactly what an offline room wants.
      fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone())
      }).catch(() => {})
      return cached
    }
    try {
      const res = await fetch(req)
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone())
      return res
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('/index.html')
        if (shell) return shell
      }
      throw err
    }
  })())
})
