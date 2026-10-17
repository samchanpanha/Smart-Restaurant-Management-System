// ─── Deployment brand routes (name · tagline · logo · icon) ──────────
// One brand for the whole Restora instance: the sign-in screen, the boot
// screen, the workspace sidebar, and the browser tab (title, favicon,
// phone home-screen icon) all read it. Stored out-of-band in SQLite kv
// (server/db.js) — never in the reducer state, because it is public: the
// sign-in screen is anonymous, so /api/branding answers without a
// session and exposes only what every visitor is meant to see.
//
//   GET /api/branding  → current brand (empty strings = built-in defaults)
//   PUT /api/branding  → save name/tagline/logoUrl/iconUrl ('' clears)
//
// Reads are public; writes are super-admin only. Restaurants keep their
// own name/logo in settings (Settings → Business profile) for documents,
// the guest menu, and the printed surfaces.

import express from 'express'

const MAX_NAME = 60
const MAX_TAGLINE = 160
// A wide logo rides as a data URL (~300KB binary); the square icon stays
// small because it also travels in the manifest and the browser tab.
const MAX_LOGO_CHARS = 400000
const MAX_ICON_CHARS = 160000

function clampText(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

/** data:image/*, /relative, or http(s) — anything else (and oversize) reads as ''. */
function sanitizeImage(value, maxChars) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > maxChars) return ''
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  if (raw.startsWith('data:image/')) return raw
  try {
    const parsed = new URL(raw)
    return ['https:', 'http:'].includes(parsed.protocol) ? raw : ''
  } catch {
    return ''
  }
}

function present(stored) {
  return {
    name: clampText(stored?.name, MAX_NAME),
    tagline: clampText(stored?.tagline, MAX_TAGLINE),
    logoUrl: sanitizeImage(stored?.logoUrl, MAX_LOGO_CHARS),
    iconUrl: sanitizeImage(stored?.iconUrl, MAX_ICON_CHARS),
    updatedAt: stored?.updatedAt || null,
    updatedBy: clampText(stored?.updatedBy, 120) || null,
  }
}

/** Only the super admin brands the deployment. */
export function requireSuperAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'sign in required' })
  if (!req.auth.user.is_super_admin) return res.status(403).json({ error: 'super admin access required' })
  return next()
}

export function createBrandingRouter({ requireAdmin, getBranding, setBranding } = {}) {
  if (typeof getBranding !== 'function' || typeof setBranding !== 'function') {
    throw new Error('createBrandingRouter requires getBranding and setBranding')
  }
  if (typeof requireAdmin !== 'function') {
    throw new Error('createBrandingRouter requires requireAdmin')
  }
  const router = express.Router()

  router.get('/api/branding', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ branding: present(getBranding()) })
  })

  router.put('/api/branding', requireAdmin, (req, res) => {
    const body = req.body || {}
    const next = { ...(getBranding() || {}) }

    if ('name' in body) next.name = clampText(body.name, MAX_NAME)

    if ('tagline' in body) next.tagline = clampText(body.tagline, MAX_TAGLINE)

    if ('logoUrl' in body) {
      const raw = clampText(body.logoUrl, MAX_LOGO_CHARS + 1)
      const clean = raw ? sanitizeImage(raw, MAX_LOGO_CHARS) : ''
      if (raw && !clean) return res.status(400).json({ error: 'logo must be an image under ~300KB' })
      next.logoUrl = clean
    }

    if ('iconUrl' in body) {
      const raw = clampText(body.iconUrl, MAX_ICON_CHARS + 1)
      const clean = raw ? sanitizeImage(raw, MAX_ICON_CHARS) : ''
      if (raw && !clean) return res.status(400).json({ error: 'icon must be a square image under ~120KB' })
      next.iconUrl = clean
    }

    next.updatedAt = new Date().toISOString()
    next.updatedBy = req.auth?.user?.email || null
    setBranding(next)
    res.json({ branding: present(next) })
  })

  return { router }
}
