// ─── Deployment brand (super admin only) ─────────────────────────────
// One brand for the whole Restora instance: the sign-in screen, the boot
// screen, the workspace sidebar, and the browser tab (title, favicon,
// phone home-screen icon). Stored server-side in SQLite kv — never in the
// synced tenant state, because the sign-in screen has no tenant and the
// brand is public to every visitor (read-only without a session).
//
// Two images with different jobs: the wide logo goes where there is room
// (sign-in screen, boot screen, previews), the square icon is the mark for
// the sidebar badge, the browser tab, and the home screen. Empty fields
// fall back to the built-in mark and the localized tagline. Restaurants
// keep their own name/logo in Business profile for documents and the
// guest menu.

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { fetchBrandingConfig, saveBrandingConfig } from '../../../lib/branding'
import { useI18n } from '../../../lib/i18n'
import { Card, Field, inputCls } from '../primitives'

const EMPTY = { name: '', tagline: '', logoUrl: '', iconUrl: '' }
// Client guards mirror the server caps (logo 400k chars, icon 160k chars
// of data URL) so an oversized file is caught here with a friendly message.
const MAX_LOGO_KB = 280
const MAX_ICON_KB = 110

function BrandSection() {
  const { dict } = useI18n()
  const [brand, setBrand] = useState(EMPTY)
  const [meta, setMeta] = useState({ updatedBy: null })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [logoError, setLogoError] = useState('')
  const [iconError, setIconError] = useState('')
  const logoRef = useRef(null)
  const iconRef = useRef(null)

  useEffect(() => {
    let alive = true
    fetchBrandingConfig().then((result) => {
      if (!alive) return
      setLoading(false)
      if (!result.ok) {
        setError(
          result.status === 401 || result.status === 403
            ? 'Only the super admin can change the app brand.'
            : result.error,
        )
        return
      }
      const stored = result.branding || {}
      setBrand({
        name: stored.name || '',
        tagline: stored.tagline || '',
        logoUrl: stored.logoUrl || '',
        iconUrl: stored.iconUrl || '',
      })
      setMeta({ updatedBy: stored.updatedBy || null })
    })
    return () => { alive = false }
  }, [])

  function edit(field, value) {
    setStatus('')
    setBrand((current) => ({ ...current, [field]: value }))
  }

  function pickImage(field, maxKb, setFieldError) {
    return (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      if (!file.type.startsWith('image/')) {
        setFieldError('Choose a PNG, JPG, SVG, or WebP image.')
        return
      }
      if (file.size > maxKb * 1024) {
        setFieldError(`Keep this image under ${maxKb}KB — it loads on every device, including phones.`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        setFieldError('')
        edit(field, String(reader.result || ''))
      }
      reader.readAsDataURL(file)
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    setStatus('')
    const result = await saveBrandingConfig({
      name: brand.name.trim(),
      tagline: brand.tagline.trim(),
      logoUrl: brand.logoUrl,
      iconUrl: brand.iconUrl,
    })
    setBusy(false)
    if (!result.ok) {
      setError(
        result.status === 401 || result.status === 403
          ? 'Only the super admin can change the app brand.'
          : result.error,
      )
      return
    }
    setBrand({
      name: result.branding.name || '',
      tagline: result.branding.tagline || '',
      logoUrl: result.branding.logoUrl || '',
      iconUrl: result.branding.iconUrl || '',
    })
    setMeta((current) => ({ ...current, updatedBy: current.updatedBy || null }))
    setStatus('Saved — the new brand is live on every screen of this terminal.')
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="brand-error">
          {error}
        </div>
      )}

      <Card
        title="App identity"
        sub="One brand for this whole Restora server — the sign-in screen, the boot screen, the workspace sidebar, and the browser tab."
      >
        {loading ? (
          <p className="text-sm text-zinc-500">Loading brand…</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="App name" hint="Leave blank to keep “Restora”.">
                <input
                  value={brand.name}
                  onChange={(event) => edit('name', event.target.value)}
                  maxLength={60}
                  placeholder="Restora"
                  className={inputCls}
                  data-testid="brand-name"
                />
              </Field>
              <Field label="Tagline" hint="Leave blank to keep the translated default.">
                <input
                  value={brand.tagline}
                  onChange={(event) => edit('tagline', event.target.value)}
                  maxLength={160}
                  placeholder={dict.brandSubtitle}
                  className={inputCls}
                  data-testid="brand-tagline"
                />
              </Field>
            </div>
            <div className="mt-4 rounded-2xl bg-[var(--color-ink-900)] p-4 text-zinc-100">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Sidebar preview</div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20">
                  {brand.iconUrl
                    ? <img src={brand.iconUrl} alt="" className="h-full w-full object-contain p-1" />
                    : <Icon name="settings" size={20} />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[23px] font-bold leading-none tracking-tight">{brand.name.trim() || 'Restora'}</div>
                  <div className="mt-1 truncate text-[10px] tracking-wide text-zinc-500">{brand.tagline.trim() || dict.brandSubtitle}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card
        title="Logo & icon"
        sub="The logo is the wide mark used where there is room; the icon is the square mark for badges, the browser tab, and the home screen."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Logo (wide)</span>
              {brand.logoUrl && (
                <button
                  type="button"
                  onClick={() => edit('logoUrl', '')}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Remove logo
                </button>
              )}
            </div>
            <div className="flex h-20 w-full max-w-[260px] items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
              {brand.logoUrl
                ? <img src={brand.logoUrl} alt="Logo preview" className="max-h-full max-w-full object-contain" data-testid="brand-logo-preview" />
                : <span className="px-3 text-center text-[11px] text-zinc-400">No logo — the built-in mark is used.</span>}
            </div>
            <div className="mt-2.5 space-y-2">
              <button
                type="button"
                onClick={() => logoRef.current?.click()}
                className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
              >
                Upload logo
              </button>
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                onChange={pickImage('logoUrl', MAX_LOGO_KB, setLogoError)}
                className="hidden"
                aria-label="Upload logo"
                data-testid="brand-logo-upload"
              />
              <p className="text-[11px] text-zinc-500">PNG/SVG under {MAX_LOGO_KB}KB, shown on the sign-in and boot screens.</p>
              {logoError && <p className="text-xs text-red-600">{logoError}</p>}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Icon (square)</span>
              {brand.iconUrl && (
                <button
                  type="button"
                  onClick={() => edit('iconUrl', '')}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Remove icon
                </button>
              )}
            </div>
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
              {brand.iconUrl
                ? <img src={brand.iconUrl} alt="Icon preview" className="max-h-full max-w-full object-contain" data-testid="brand-icon-preview" />
                : <span className="text-[10px] text-zinc-400">Built-in</span>}
            </div>
            <div className="mt-2.5 space-y-2">
              <button
                type="button"
                onClick={() => iconRef.current?.click()}
                className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
              >
                Upload icon
              </button>
              <input
                ref={iconRef}
                type="file"
                accept="image/*"
                onChange={pickImage('iconUrl', MAX_ICON_KB, setIconError)}
                className="hidden"
                aria-label="Upload icon"
                data-testid="brand-icon-upload"
              />
              <p className="text-[11px] text-zinc-500">Square PNG/SVG under {MAX_ICON_KB}KB — it becomes the browser tab and home-screen icon.</p>
              {iconError && <p className="text-xs text-red-600">{iconError}</p>}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <span className="text-xs text-zinc-500" data-testid="brand-status">
          {status || (meta.updatedBy
            ? `Last saved by ${meta.updatedBy}.`
            : 'Never customized — the built-in Restora brand is in use.')}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={busy || loading || Boolean(error)}
          data-testid="save-brand"
          className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save brand'}
        </button>
      </div>
    </div>
  )
}

export { BrandSection }
