import { useRef, useState } from 'react'
import { Field, Card, inputCls } from '../primitives'

function BusinessSection({ draft, patch }) {
  const fileRef = useRef(null)
  const [logoError, setLogoError] = useState('')

  function onLogo(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLogoError('Choose a PNG, JPG, or SVG image.')
      return
    }
    if (file.size > 400 * 1024) {
      setLogoError('Keep the logo under 400KB so it travels in the snapshot and prints cleanly.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setLogoError('')
      patch({ logoUrl: String(reader.result || '') })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-4">
      <Card title="Identity" sub="Printed on every invoice, receipt, ticket header, and report.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Restaurant name · required">
            <input value={draft.restaurantName} onChange={(e) => patch({ restaurantName: e.target.value })} maxLength={80} className={inputCls} />
          </Field>
          <Field label="Legal / registered name">
            <input value={draft.legalName} onChange={(e) => patch({ legalName: e.target.value })} maxLength={80} className={inputCls} />
          </Field>
          <Field label="Tagline">
            <input value={draft.tagline} onChange={(e) => patch({ tagline: e.target.value })} maxLength={120} className={inputCls} />
          </Field>
          <Field label="Tax / VAT registration number">
            <input value={draft.taxId} onChange={(e) => patch({ taxId: e.target.value })} maxLength={40} className={`${inputCls} tnum`} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Description" hint="Shown on reports and the invoice footer.">
            <textarea value={draft.description} onChange={(e) => patch({ description: e.target.value })} rows={3} maxLength={400} className={`${inputCls} min-h-[84px] resize-y`} />
          </Field>
        </div>
      </Card>

      <Card
        title="Logo"
        sub="Upload a PNG/SVG under 400KB, or keep the initials monogram."
        actions={draft.logoUrl ? (
          <button type="button" onClick={() => patch({ logoUrl: '' })} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
            Remove logo
          </button>
        ) : null}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
            {draft.logoUrl
              ? <img src={draft.logoUrl} alt="Logo preview" className="max-h-full max-w-full object-contain" />
              : <span className="text-xl font-bold" style={{ color: draft.brandColor }}>{draft.logoInitials}</span>}
          </div>
          <div className="space-y-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
              Upload logo
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onLogo} className="hidden" aria-label="Upload logo" />
            <p className="text-2xs text-zinc-500">Stored in the snapshot as a data URL — it prints and syncs with the store.</p>
            {logoError && <p className="text-xs text-red-600">{logoError}</p>}
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <Field label="Monogram initials">
              <input value={draft.logoInitials} onChange={(e) => patch({ logoInitials: e.target.value.toUpperCase().slice(0, 4) })} maxLength={4} className={inputCls} />
            </Field>
            <Field label="Brand color" hint="Accent for document rules and the badge.">
              <div className="flex items-center gap-2">
                <input type="color" value={draft.brandColor} onChange={(e) => patch({ brandColor: e.target.value })} className="h-10 w-12 rounded-lg border border-zinc-200 bg-white p-1" aria-label="Brand color" />
                <input value={draft.brandColor} onChange={(e) => patch({ brandColor: e.target.value })} maxLength={7} className={`${inputCls} tnum`} />
              </div>
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Address & contact" sub="Documents print this block; reports use it for the letterhead.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Street address">
            <input value={draft.addressLine1} onChange={(e) => patch({ addressLine1: e.target.value })} maxLength={80} className={inputCls} />
          </Field>
          <Field label="Suite / building">
            <input value={draft.addressLine2} onChange={(e) => patch({ addressLine2: e.target.value })} maxLength={80} className={inputCls} />
          </Field>
          <Field label="City">
            <input value={draft.city} onChange={(e) => patch({ city: e.target.value })} maxLength={48} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State / province">
              <input value={draft.state} onChange={(e) => patch({ state: e.target.value })} maxLength={48} className={inputCls} />
            </Field>
            <Field label="Postal code">
              <input value={draft.postalCode} onChange={(e) => patch({ postalCode: e.target.value })} maxLength={16} className={inputCls} />
            </Field>
          </div>
          <Field label="Country">
            <input value={draft.country} onChange={(e) => patch({ country: e.target.value })} maxLength={48} className={inputCls} />
          </Field>
          <Field label="Phone">
            <input value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} maxLength={32} className={inputCls} />
          </Field>
          <Field label="Email">
            <input value={draft.email} onChange={(e) => patch({ email: e.target.value })} maxLength={80} className={inputCls} />
          </Field>
          <Field label="Website">
            <input value={draft.website} onChange={(e) => patch({ website: e.target.value })} maxLength={80} className={inputCls} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

export { BusinessSection }
