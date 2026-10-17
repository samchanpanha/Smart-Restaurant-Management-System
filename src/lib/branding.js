// ─── Deployment brand (name · tagline · logo · icon) ─────────────────
// One brand for the whole Restora instance, read from the public
// /api/branding endpoint and cached in module scope — the sign-in screen,
// the boot screen, the workspace sidebar, and the browser chrome (title ·
// favicon · touch icon · home-screen manifest) all paint the same brand
// without a React provider.
//
// The server is optional: in the local demo (no backend) the fetch fails
// quietly and the built-in defaults stay in place. Stored values arrive as
// empty strings when the super admin has not customized anything, so
// callers fall back to 'Restora' and the localized brand subtitle.
//
// Writes live in the Settings → App brand section; the server refuses
// anything but a super-admin session regardless of what the UI shows.

import { useSyncExternalStore } from 'react'

export const BRAND_DEFAULTS = { name: 'Restora', tagline: '', logoUrl: '', iconUrl: '' }

let current = { ...BRAND_DEFAULTS }
let loaded = false
let inflight = null
const listeners = new Set()

export function getBrand() {
  return current
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook — re-renders when the super admin saves a new brand. */
export function useBrand() {
  return useSyncExternalStore(subscribe, getBrand, getBrand)
}

function normalize(brand) {
  return {
    name: String(brand?.name || '').trim(),
    tagline: String(brand?.tagline || '').trim(),
    logoUrl: String(brand?.logoUrl || '').trim(),
    iconUrl: String(brand?.iconUrl || '').trim(),
  }
}

function iconType(url) {
  const raw = String(url || '')
  if (raw.startsWith('data:image/svg') || /\.svg(\?|#|$)/i.test(raw)) return 'image/svg+xml'
  if (raw.startsWith('data:image/png') || /\.png(\?|#|$)/i.test(raw)) return 'image/png'
  if (raw.startsWith('data:image/jpeg') || /\.jpe?g(\?|#|$)/i.test(raw)) return 'image/jpeg'
  if (raw.startsWith('data:image/webp') || /\.webp(\?|#|$)/i.test(raw)) return 'image/webp'
  if (raw.startsWith('data:image/gif') || /\.gif(\?|#|$)/i.test(raw)) return 'image/gif'
  if (raw.startsWith('data:image/avif') || /\.avif(\?|#|$)/i.test(raw)) return 'image/avif'
  return 'image/png'
}

function headLink(rel) {
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  return el
}

/** The square icon drives the tab, the phone home screen, and the PWA manifest. */
function syncIcons(iconUrl) {
  const icon = document.head.querySelector('link[rel="icon"]')
  const apple = document.head.querySelector('link[rel="apple-touch-icon"]')
  if (iconUrl) {
    const favicon = icon || headLink('icon')
    favicon.setAttribute('href', iconUrl)
    favicon.setAttribute('type', iconType(iconUrl))
    const touch = apple || headLink('apple-touch-icon')
    touch.setAttribute('href', iconUrl)
  } else {
    if (icon) {
      icon.setAttribute('href', '/favicon.svg')
      icon.setAttribute('type', 'image/svg+xml')
    }
    if (apple) apple.remove()
  }
}

function syncManifest(name, iconUrl) {
  const link = document.head.querySelector('link[rel="manifest"]')
  if (!link) return
  if (!iconUrl) {
    if (link.dataset.dynamic) {
      link.setAttribute('href', '/manifest.webmanifest')
      delete link.dataset.dynamic
    }
    return
  }
  const type = iconType(iconUrl)
  const manifest = {
    name: `${name} — Smart Restaurant Management`,
    short_name: name.slice(0, 24),
    description: 'Tablet-first staff consoles and a phone-first guest menu for the whole restaurant.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0b0d12',
    theme_color: '#0b0d12',
    icons: [
      { src: iconUrl, sizes: 'any', type, purpose: 'any' },
      { src: iconUrl, sizes: 'any', type, purpose: 'maskable' },
    ],
  }
  link.setAttribute('href', `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`)
  link.dataset.dynamic = '1'
}

/** Reflect a brand in the browser chrome. Safe with no document (SSR/tests). */
export function applyChrome(brand = current) {
  if (typeof document === 'undefined' || !document.head) return
  const name = brand.name || BRAND_DEFAULTS.name
  document.title = brand.tagline ? `${name} — ${brand.tagline}` : `${name} — Smart Restaurant Management`
  syncIcons(brand.iconUrl)
  syncManifest(name, brand.iconUrl)
}

/** Replace the cached brand (a save) and repaint chrome + subscribers. */
export function applyBrand(next) {
  current = normalize(next)
  applyChrome(current)
  for (const listener of [...listeners]) listener()
  return current
}

/**
 * Fetch the public brand once at boot. Never throws; if the server is
 * absent the defaults stay. A failed call allows a later retry.
 */
export function loadBrand() {
  if (loaded) return inflight
  loaded = true
  inflight = fetch('/api/branding', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => (json?.branding ? applyBrand(json.branding) : current))
    .catch(() => {
      loaded = false
      return current
    })
  return inflight
}

// ─── Settings → App brand (super admin) ──────────────────────────────

/** GET /api/branding — the stored brand, never throws. */
export async function fetchBrandingConfig() {
  try {
    const res = await fetch('/api/branding', { headers: { Accept: 'application/json' } })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, status: res.status, error: json?.error || `request failed (${res.status})` }
    return { ok: true, branding: json?.branding || { ...BRAND_DEFAULTS } }
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'network error' }
  }
}

/** PUT /api/branding — super-admin only; applies the saved brand on success. */
export async function saveBrandingConfig(patch) {
  try {
    const res = await fetch('/api/branding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch || {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, status: res.status, error: json?.error || `request failed (${res.status})` }
    return { ok: true, branding: applyBrand(json?.branding) }
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'network error' }
  }
}
