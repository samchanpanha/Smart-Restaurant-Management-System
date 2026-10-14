// ─── Settings & Documents ───────────────────────────────────────────
// Everything a store is configured with lives here: identity and logo,
// multi-currency, tax and service, the four document templates (invoice,
// receipt, kitchen ticket, shift report) with live print preview,
// numbering, stock policy, POS rules, and alert routing.
//
// Editing is draft-first: the whole screen is one form, the save bar
// applies it as a single UPDATE_SETTINGS action (optionally to every
// store), and every value is sanitized by the shared reducer.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import DocumentPreview from '../components/DocumentPreview'
import { CURRENCIES, ROUNDING_RULES, currencyMeta, formatMoney, normalizeCurrencyEntry } from '../lib/currency'
import {
  buildInvoiceDocument, buildReceiptDocument, buildReportDocument, buildTicketDocument,
  documentFileName, downloadHtml, printHtml, renderDocumentHtml,
} from '../lib/documents'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/models'
import {
  DOC_KINDS, DOC_KIND_META, NOTIFICATION_CHANNELS, PAPER_SIZES, REORDER_POLICIES, STORAGE_LOCATIONS,
  VALUATION_METHODS, configurationAudit, documentNumber, sanitizeSettings, templateFor,
} from '../lib/settings'
import { DEFAULT_UNITS, UNIT_FAMILIES, itemUnitChoices, slugUnitId } from '../lib/units'
import { migrateToEmpire } from '../lib/reducer'
import { useRestora } from '../lib/store'

const SECTIONS = [
  { id: 'business', label: 'Business profile', blurb: 'Name, address, logo, tax ID' },
  { id: 'money', label: 'Currency & tax', blurb: 'Base currency, rates, tax, service' },
  { id: 'documents', label: 'Documents', blurb: 'Invoice, receipt, ticket, report' },
  { id: 'stock', label: 'Stock rules', blurb: 'Valuation, reorder, auto-86' },
  { id: 'food', label: 'Food & menu', blurb: 'Tags, allergens, courses, photos, service windows' },
  { id: 'pos', label: 'Service & POS', blurb: 'Tips, splits, printers, QR' },
  { id: 'alerts', label: 'Alerts', blurb: 'What pings whom, and when' },
  { id: 'data', label: 'Data & backup', blurb: 'Registry, export, reset' },
]

// ─── Small form atoms ──────────────────────────────────────────────

const inputCls =
  'w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500'

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-zinc-500">{hint}</span>}
      </span>
    </label>
  )
}

function Card({ title, sub, children, actions }) {
  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-zinc-900">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

// ─── Business profile ──────────────────────────────────────────────

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
            <p className="text-[11px] text-zinc-500">Stored in the snapshot as a data URL — it prints and syncs with the store.</p>
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

// ─── Currency & tax ────────────────────────────────────────────────

function MoneySection({ draft, patch, dispatch, settings, state, locationLabel }) {
  const [newCode, setNewCode] = useState('')

  const rows = draft.currencies || []
  const preview = formatMoney(1234.5, { ...currencyMeta(draft.baseCurrency), symbol: currencyMeta(draft.baseCurrency).symbol, decimals: currencyMeta(draft.baseCurrency).decimals })
  const baseMeta = currencyMeta(draft.baseCurrency)

  function setRow(code, key, value) {
    patch({
      currencies: rows.map((row) => (row.code === code ? { ...row, [key]: value, updatedAt: new Date().toISOString() } : row)),
    })
  }

  const available = CURRENCIES.filter((meta) => meta.code !== draft.baseCurrency && !rows.some((row) => row.code === meta.code))

  return (
    <div className="space-y-4">
      <Card
        title="Base currency"
        sub="Every stored price, cost, and total is in the base currency. Documents may print in another one — the ledger never converts."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Base currency" hint="Changing the base re-bases every rate; catalog prices stay as entered.">
            <select value={draft.baseCurrency} onChange={(e) => patch({ baseCurrency: e.target.value })} className={inputCls}>
              {[baseMeta, ...rows].map((meta) => (
                <option key={meta.code} value={meta.code}>{meta.code} · {meta.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Sample">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm font-bold text-zinc-800 tnum">{preview}</div>
          </Field>
          <Field label="Document default" hint="Which currency new documents print in.">
            <select value={draft.documentCurrency} onChange={(e) => patch({ documentCurrency: e.target.value })} className={inputCls}>
              <option value="base">Base ({draft.baseCurrency})</option>
              {rows.filter((row) => row.enabled).map((row) => (
                <option key={row.code} value={row.code}>{row.code} · {row.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={draft.baseCurrency === settings.baseCurrency}
            onClick={() => {
              const confirmed = window.confirm(
                `Re-base the ledger on ${draft.baseCurrency}? Every rate is recomputed relative to it. Catalog prices stay as entered — use "Rescale catalog" separately if the numbers themselves must change.`,
              )
              if (!confirmed) return
              dispatch({ type: 'SET_BASE_CURRENCY', code: draft.baseCurrency })
            }}
            className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Re-base rates on {draft.baseCurrency}
          </button>
          <span className="text-[11px] text-zinc-500">
            Current base: {settings.baseCurrency} · {locationLabel}
          </span>
        </div>
      </Card>

      <RescaleCard dispatch={dispatch} state={state} locationLabel={locationLabel} />

      <Card
        title={`Configured currencies · ${rows.length}`}
        sub="Rate = how many units of that currency one base unit buys. Rates drive document conversion and the receipt footer."
        actions={available.length ? (
          <div className="flex items-center gap-2">
            <select value={newCode} onChange={(e) => setNewCode(e.target.value)} className={`${inputCls} w-40`} aria-label="Add currency">
              <option value="">Add currency…</option>
              {available.map((meta) => <option key={meta.code} value={meta.code}>{meta.code} · {meta.name}</option>)}
            </select>
            <button
              type="button"
              disabled={!newCode}
              onClick={() => {
                const entry = normalizeCurrencyEntry({ code: newCode, rate: 1, enabled: true, updatedAt: new Date().toISOString() }, draft.baseCurrency)
                if (!entry) return
                patch({ currencies: [...rows, entry] })
                setNewCode('')
              }}
              className="min-h-10 rounded-xl bg-orange-500 px-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        ) : null}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-2 py-2">Currency</th>
                <th className="px-2 py-2">Symbol</th>
                <th className="px-2 py-2">Decimals</th>
                <th className="px-2 py-2">Rate per 1 {draft.baseCurrency}</th>
                <th className="px-2 py-2">Sample ($100 converted)</th>
                <th className="px-2 py-2">Enabled</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.code}>
                  <td className="px-2 py-2 font-semibold text-zinc-800">{row.code}<span className="ml-2 text-xs font-normal text-zinc-500">{row.name}</span></td>
                  <td className="px-2 py-2">
                    <input value={row.symbol} onChange={(e) => setRow(row.code, 'symbol', e.target.value.slice(0, 6))} className={`${inputCls} w-20`} aria-label={`${row.code} symbol`} />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number" min="0" max="4" value={row.decimals}
                      onChange={(e) => setRow(row.code, 'decimals', Math.max(0, Math.min(4, Number(e.target.value))))}
                      className={`${inputCls} tnum w-20`} aria-label={`${row.code} decimals`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number" min="0" step="any" value={row.rate}
                      onChange={(e) => setRow(row.code, 'rate', Math.max(0, Number(e.target.value)))}
                      className={`${inputCls} tnum w-32`} aria-label={`${row.code} rate`}
                    />
                  </td>
                  <td className="px-2 py-2 tnum text-zinc-600">{formatMoney(100 * row.rate, { ...row })}</td>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={row.enabled !== false} onChange={(e) => setRow(row.code, 'enabled', e.target.checked)} className="h-4 w-4 accent-orange-500" aria-label={`Enable ${row.code}`} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => patch({ currencies: rows.filter((entry) => entry.code !== row.code) })}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="px-2 py-6 text-center text-sm text-zinc-500">Only the base currency is configured. Add EUR, KHR, or any other to print converted documents.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Tax, service & rounding" sub="Drives every check total, the guest QR bill, and the tax line on documents.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Tax label">
            <input value={draft.taxLabel} onChange={(e) => patch({ taxLabel: e.target.value })} maxLength={32} className={inputCls} />
          </Field>
          <Field label="Tax rate %" hint="Printed on invoices and receipts.">
            <input
              type="number" min="0" max="40" step="0.01" value={(draft.taxPct * 100).toFixed(3)}
              onChange={(e) => patch({ taxPct: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Rounding rule">
            <select value={draft.rounding} onChange={(e) => patch({ rounding: e.target.value })} className={inputCls}>
              {ROUNDING_RULES.map((rule) => <option key={rule.id} value={rule.id}>{rule.label}</option>)}
            </select>
          </Field>
          <Field label="Service charge %" hint="Auto-gratuity for large parties; prints as its own line.">
            <input
              type="number" min="0" max="30" step="0.5" value={(draft.servicePct * 100).toFixed(2)}
              onChange={(e) => patch({ servicePct: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Service charge label">
            <input value={draft.serviceLabel} onChange={(e) => patch({ serviceLabel: e.target.value })} maxLength={32} className={inputCls} />
          </Field>
          <div className="grid content-start gap-2">
            <Toggle label="Prices include tax" hint="Receipts then show the tax portion of the price, not an added line." checked={draft.pricesIncludeTax} onChange={(value) => patch({ pricesIncludeTax: value })} />
            <Toggle label="Service charge is taxable" hint="Most jurisdictions tax the service charge too." checked={draft.serviceTaxable} onChange={(value) => patch({ serviceTaxable: value })} />
          </div>
        </div>
      </Card>

      <Card title="Locale & formats" sub="Dates, times, and number grouping across screens, exports, and documents.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Locale">
            <input value={draft.locale} onChange={(e) => patch({ locale: e.target.value })} maxLength={12} className={inputCls} />
          </Field>
          <Field label="Timezone">
            <input value={draft.timezone} onChange={(e) => patch({ timezone: e.target.value })} maxLength={48} className={inputCls} />
          </Field>
          <Field label="Date format">
            <select value={draft.dateFormat} onChange={(e) => patch({ dateFormat: e.target.value })} className={inputCls}>
              {['MMM d, yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'].map((format) => <option key={format} value={format}>{format}</option>)}
            </select>
          </Field>
          <Field label="Time format">
            <select value={draft.timeFormat} onChange={(e) => patch({ timeFormat: e.target.value })} className={inputCls}>
              <option value="12h">12-hour</option>
              <option value="24h">24-hour</option>
            </select>
          </Field>
          <Field label="Number format">
            <select value={draft.numberFormat} onChange={(e) => patch({ numberFormat: e.target.value })} className={inputCls}>
              <option value="comma_dot">1,234.56</option>
              <option value="dot_comma">1.234,56</option>
              <option value="space_comma">1 234,56</option>
            </select>
          </Field>
          <Field label="Measurement">
            <select value={draft.measurement} onChange={(e) => patch({ measurement: e.target.value })} className={inputCls}>
              <option value="imperial">Imperial (oz, lb)</option>
              <option value="metric">Metric (g, kg)</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Shift targets" sub="Used by the KDS SLA, dashboard, and reports.">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Ticket target (min)">
            <input type="number" min="2" max="90" value={draft.ticketMinutes} onChange={(e) => patch({ ticketMinutes: Number(e.target.value) })} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Table turn target (min)">
            <input type="number" min="10" max="240" value={draft.targetTurnMinutes} onChange={(e) => patch({ targetTurnMinutes: Number(e.target.value) })} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Food cost cap %">
            <input type="number" min="0" max="100" step="0.5" value={(draft.foodCostCap * 100).toFixed(1)} onChange={(e) => patch({ foodCostCap: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Rush hour">
            <select value={draft.rushHour} onChange={(e) => patch({ rushHour: Number(e.target.value) })} className={inputCls}>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </Field>
        </div>
        {state.turnHistory?.length > 0 && (
          <p className="mt-3 text-[11px] text-zinc-500">
            Tonight&apos;s observed turns average{' '}
            {Math.round(state.turnHistory.reduce((sum, turn) => sum + turn.minutes, 0) / state.turnHistory.length)} minutes.
          </p>
        )}
      </Card>
    </div>
  )
}

// ─── Deliberate catalog revaluation ────────────────────────────────

function RescaleCard({ dispatch, state, locationLabel }) {
  const [factor, setFactor] = useState('')
  const [armed, setArmed] = useState(false)
  const [info, setInfo] = useState('')
  const value = Number(factor)
  const valid = Number.isFinite(value) && value > 0 && value <= 1000 && value !== 1
  const and = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })

  const sample = state.menu.slice(0, 3)
  const stockValueNow = state.inventory.reduce((sum, item) => sum + Math.max(0, item.onHand) * (item.lastCost || 0), 0)

  function apply() {
    const confirmed = window.confirm(
      `Revalue ${state.menu.length} menu prices and ${state.inventory.length} stock costs on ${locationLabel} by ×${value}? This is not a conversion — use it when the numbers themselves change (new price list, re-denomination, bulk inflation).`,
    )
    if (!confirmed) return
    dispatch({ type: 'RESCALE_CATALOG', factor: value })
    setInfo(`Catalog revalued ×${value} on ${locationLabel}.`)
    setFactor('')
    setArmed(false)
  }

  return (
    <Card
      title="Revalue the catalog"
      sub="Multiply every menu price, last cost, and weighted average at once. Rates convert documents; this changes the numbers in the book itself."
      actions={<StatusPill tone={info ? 'ok' : 'muted'}>{info || 'one-way, confirm required'}</StatusPill>}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Factor" hint="2 doubles every number · 0.01 divides by 100 (e.g. a currency dropping two zeros).">
          <input
            value={factor}
            onChange={(e) => { setFactor(e.target.value); setArmed(false); setInfo('') }}
            inputMode="decimal"
            placeholder="e.g. 2 or 0.01"
            className={inputCls}
          />
        </Field>
        <Field label="Example" hint={sample.length ? `${sample[0]?.name} and ${sample.length - 1} more` : 'no menu items yet'}>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 tnum">
            {sample.length
              ? <>{money(sample[0].price)} → {valid ? money(sample[0].price * value) : '—'}</>
              : 'Add menu items first.'}
          </div>
        </Field>
        <Field label="Preview across the book">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 tnum">
            {valid
              ? <>Stock value {money(stockValueNow)} → {money(stockValueNow * value)}</>
              : `Stock value ${money(stockValueNow)}`}
          </div>
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {armed ? (
          <>
            <button type="button" onClick={apply} className="min-h-10 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700">
              Revalue everything ×{factor}
            </button>
            <button type="button" onClick={() => setArmed(false)} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!valid}
              onClick={() => setArmed(true)}
              className="min-h-10 rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Revalue catalog…
            </button>
            <span className="text-[11px] text-zinc-500">{and(state.menu.length)} menu prices · {and(state.inventory.length)} stock items · cannot be undone except by reset or import</span>
          </>
        )}
      </div>
    </Card>
  )
}

// ─── Document designer ─────────────────────────────────────────────

function DocumentsSection({ draft, patch, state, locId, issueDocument }) {
  const [kind, setKind] = useState('invoice')
  const [range, setRange] = useState('tonight')
  const [orderId, setOrderId] = useState('')
  const [qrValue, setQrValue] = useState('')
  const template = templateFor({ ...draft }, kind)
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((item) => [item.id, item])), [state.menu])

  const candidates = useMemo(() => {
    if (kind === 'receipt') return state.orders.filter((order) => order.status === 'paid')
    if (kind === 'invoice') return state.orders.filter((order) => !['void'].includes(order.status))
    if (kind === 'ticket') return state.orders.filter((order) => !['paid', 'void'].includes(order.status))
    return []
  }, [kind, state.orders])

  const selected = candidates.find((order) => order.id === orderId) || candidates[0] || null

  const document = useMemo(() => {
    const settings = sanitizeSettings({ ...draft, locationShort: state.settings?.locationShort }, state.settings?.restaurantName)
    if (kind === 'report') {
      return buildReportDocument({ shop: { ...state, settings }, settings, range })
    }
    if (!selected) return null
    if (kind === 'invoice') {
      const days = Number(String(template.termsText).match(/\d+/)?.[0]) || 14
      return buildInvoiceDocument({ shop: { ...state, settings }, order: selected, settings, paymentTermsDays: days })
    }
    if (kind === 'receipt') return buildReceiptDocument({ shop: { ...state, settings }, order: selected, settings })
    return buildTicketDocument({ shop: { ...state, settings }, order: selected, settings })
  }, [kind, selected, state, draft, range, template.termsText])

  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const ref = selected?.id || range
    setQrValue(`${origin}/?loc=${locId}&doc=${kind}&ref=${encodeURIComponent(ref)}`)
  }, [kind, selected, range, locId])

  const numbered = useMemo(() => {
    if (!document) return null
    return { ...document, number: documentNumber(draft, kind, draft.numbering[kind].next) }
  }, [document, draft, kind])

  function updateTemplate(key, value) {
    patch({ templates: { ...draft.templates, [kind]: { ...draft.templates[kind], [key]: value } } })
  }

  const previewSettings = useMemo(
    () => sanitizeSettings({ ...draft, locationShort: state.settings?.locationShort }, state.settings?.restaurantName),
    [draft, state.settings?.locationShort, state.settings?.restaurantName],
  )

  const html = numbered ? renderDocumentHtml(numbered, previewSettings, { qrCaption: qrValue }) : ''

  function fileDocument() {
    if (!numbered) return
    issueDocument(kind, {
      document: {
        ...numbered,
        currency: numbered.currency,
        lines: numbered.lines,
        totals: numbered.totals,
        payments: numbered.payments,
      },
      number: numbered.number,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Document kind">
        {DOC_KINDS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={kind === entry}
            onClick={() => { setKind(entry); setOrderId('') }}
            className={`min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors ${kind === entry ? 'bg-orange-500 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'}`}
          >
            {DOC_KIND_META[entry].label}
          </button>
        ))}
      </div>

      <p className="text-xs text-zinc-500">{DOC_KIND_META[kind].blurb} · audience: {DOC_KIND_META[kind].audience}</p>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,380px)_1fr]">
        <div className="space-y-4">
          <Card title="Design" sub={`Template: ${template.name}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Template name">
                <input value={draft.templates[kind].name} onChange={(e) => updateTemplate('name', e.target.value)} maxLength={48} className={inputCls} />
              </Field>
              <Field label="Document title">
                <input value={draft.templates[kind].title} onChange={(e) => updateTemplate('title', e.target.value)} maxLength={32} className={inputCls} />
              </Field>
              <Field label="Paper">
                <select value={template.paper} onChange={(e) => updateTemplate('paper', e.target.value)} className={inputCls}>
                  {Object.entries(PAPER_SIZES).map(([id, paper]) => <option key={id} value={id}>{paper.label}</option>)}
                </select>
              </Field>
              <Field label="Print in currency">
                <select value={template.currency} onChange={(e) => updateTemplate('currency', e.target.value)} className={inputCls}>
                  <option value="base">Base ({draft.baseCurrency})</option>
                  {(draft.currencies || []).filter((row) => row.enabled).map((row) => (
                    <option key={row.code} value={row.code}>{row.code} · {row.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Accent color">
                <div className="flex items-center gap-2">
                  <input type="color" value={template.accent} onChange={(e) => updateTemplate('accent', e.target.value)} className="h-10 w-12 rounded-lg border border-zinc-200 bg-white p-1" aria-label="Accent color" />
                  <input value={template.accent} onChange={(e) => updateTemplate('accent', e.target.value)} maxLength={7} className={`${inputCls} tnum`} />
                </div>
              </Field>
              <Field label={`Font scale · ${Math.round(template.fontScale * 100)}%`}>
                <input type="range" min="0.8" max="1.6" step="0.05" value={template.fontScale} onChange={(e) => updateTemplate('fontScale', Number(e.target.value))} className="w-full accent-orange-500" />
              </Field>
            </div>
          </Card>

          <Card title="Blocks" sub="Turn sections on or off for this document only.">
            <div className="grid gap-2">
              {[
                ['showLogo', 'Logo / monogram'],
                ['showCompany', 'Company block (address, contact, tax ID)'],
                ['showCustomer', 'Guest / billed-to block'],
                ['showSku', 'Item SKU'],
                ['showUnitPrice', 'Unit price column'],
                ['showModifiers', 'Modifiers & notes'],
                ['showTaxBreakdown', 'Tax breakdown line'],
                ['showServiceCharge', 'Service charge line'],
                ['showDiscount', 'Discount line'],
                ['showPayments', 'Payment lines & change'],
                ['showTipLine', 'Tip line'],
                ['showTable', 'Table & server'],
                ['showCourse', 'Course grouping'],
                ['showGuestNotes', 'Guest names & special notes'],
                ['showFiredTime', 'Fired time'],
                ['groupByStation', 'Group kitchen ticket by station'],
                ['showPrices', 'Print prices (kitchen ticket)'],
                ['showQr', 'QR code (digital copy)'],
                ['showSignature', 'Signature block'],
                ['showNotes', 'Notes section'],
              ].map(([key, label]) => (
                <Toggle key={key} label={label} checked={template[key]} onChange={(value) => updateTemplate(key, value)} />
              ))}
              {kind === 'report' && (
                <>
                  {[
                    ['showHourly', 'Sales by hour'],
                    ['showCategories', 'Sales by category'],
                    ['showComparison', 'Day over day'],
                    ['showService', 'Service metrics'],
                    ['showVoids', 'Voids & comps'],
                    ['showVariance', 'Stock variance'],
                    ['showTopSellers', 'Top sellers'],
                    ['showPnl', 'P&L-lite'],
                    ['showPurchases', 'Purchases & suppliers'],
                    ['showStockFlow', 'Stock in / out'],
                    ['showTopLow', 'Top & bottom on both sides'],
                  ].map(([key, label]) => (
                    <Toggle key={key} label={label} checked={template[key]} onChange={(value) => updateTemplate(key, value)} />
                  ))}
                </>
              )}
              {kind === 'invoice' && (
                <Toggle label="Bank details" checked={template.showBankDetails} onChange={(value) => updateTemplate('showBankDetails', value)} />
              )}
            </div>
          </Card>

          <Card title="Text" sub="Printed exactly as typed — line breaks respected.">
            <div className="space-y-3">
              <Field label="Header note">
                <input value={draft.templates[kind].headerText} onChange={(e) => updateTemplate('headerText', e.target.value)} maxLength={240} className={inputCls} placeholder="Optional line under the letterhead" />
              </Field>
              <Field label="Footer note">
                <input value={draft.templates[kind].footerText} onChange={(e) => updateTemplate('footerText', e.target.value)} maxLength={240} className={inputCls} />
              </Field>
              <Field label="Thank-you line">
                <input value={draft.templates[kind].thankYou} onChange={(e) => updateTemplate('thankYou', e.target.value)} maxLength={160} className={inputCls} />
              </Field>
              {kind === 'invoice' && (
                <>
                  <Field label="Payment terms">
                    <input value={draft.templates[kind].termsText} onChange={(e) => updateTemplate('termsText', e.target.value)} maxLength={240} className={inputCls} />
                  </Field>
                  <Field label="Bank / payment details">
                    <input value={draft.templates[kind].bankDetails} onChange={(e) => updateTemplate('bankDetails', e.target.value)} maxLength={200} className={inputCls} />
                  </Field>
                </>
              )}
              {template.showSignature && (
                <Field label="Signature label">
                  <input value={draft.templates[kind].signatureLabel} onChange={(e) => updateTemplate('signatureLabel', e.target.value)} maxLength={40} className={inputCls} />
                </Field>
              )}
              <Field label="Copies" hint="Kitchen and guest copies print sequentially.">
                <input type="number" min="1" max="4" value={template.copies} onChange={(e) => updateTemplate('copies', Number(e.target.value))} className={`${inputCls} tnum w-24`} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card
            title="Live preview"
            sub={kind === 'report' ? 'Built from tonight\'s live orders.' : 'Pick a real check — the preview uses the same numbers that will print.'}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                {kind === 'report' ? (
                  <select value={range} onChange={(e) => setRange(e.target.value)} className={`${inputCls} w-32`} aria-label="Report range">
                    <option value="tonight">Tonight</option>
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                  </select>
                ) : (
                  <select value={selected?.id || ''} onChange={(e) => setOrderId(e.target.value)} className={`${inputCls} max-w-[260px]`} aria-label="Source check">
                    {!candidates.length && <option value="">No matching tickets tonight</option>}
                    {candidates.map((order) => {
                      const table = state.tables.find((entry) => entry.id === order.tableId)
                      const total = (order.items || []).reduce((sum, item) => sum + (menuById[item.menuItemId]?.price || 0) * item.qty, 0)
                      return (
                        <option key={order.id} value={order.id}>
                          {table ? table.name : 'Counter'} · {order.status} · {formatMoney(total + (order.tip || 0))}
                        </option>
                      )
                    })}
                  </select>
                )}
              </div>
            )}
          >
            <DocumentPreview
              document={numbered}
              settings={previewSettings}
              template={template}
              qrValue={qrValue}
              height={kind === 'ticket' || template.paper.startsWith('thermal') ? 380 : 620}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!numbered}
                onClick={fileDocument}
                className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
              >
                File as {draft.numbering[kind].prefix}-{String(draft.numbering[kind].next).padStart(draft.numbering[kind].pad, '0')}
              </button>
              <button
                type="button"
                disabled={!html}
                onClick={() => printHtml(html, { title: `${numbered?.title || kind} ${numbered?.number || ''}` })}
                className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Print now
              </button>
              <button
                type="button"
                disabled={!html}
                onClick={() => downloadHtml(html, documentFileName(numbered || { kind, number: 'draft' }, previewSettings))}
                className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Download HTML
              </button>
              <span className="self-center text-[11px] text-zinc-500">
                Filing stores the number in the document registry and increments the sequence — reprints reuse it.
              </span>
            </div>
          </Card>

          <Card title="Numbering & sequence" sub="Numbers are assigned when a document is filed, never on preview.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {DOC_KINDS.map((entry) => (
                <div key={entry} className="rounded-xl border border-zinc-200 p-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">{DOC_KIND_META[entry].label}</div>
                  <div className="mt-2 space-y-2">
                    <Field label="Prefix">
                      <input
                        value={draft.numbering[entry].prefix}
                        onChange={(e) => patch({ numbering: { ...draft.numbering, [entry]: { ...draft.numbering[entry], prefix: e.target.value.toUpperCase().slice(0, 8) } } })}
                        className={`${inputCls} tnum`}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Next">
                        <input
                          type="number" min="1" value={draft.numbering[entry].next}
                          onChange={(e) => patch({ numbering: { ...draft.numbering, [entry]: { ...draft.numbering[entry], next: Math.max(1, Number(e.target.value)) } } })}
                          className={`${inputCls} tnum`}
                        />
                      </Field>
                      <Field label="Pad">
                        <input
                          type="number" min="1" max="10" value={draft.numbering[entry].pad}
                          onChange={(e) => patch({ numbering: { ...draft.numbering, [entry]: { ...draft.numbering[entry], pad: Math.max(1, Math.min(10, Number(e.target.value))) } } })}
                          className={`${inputCls} tnum`}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                        <input
                          type="checkbox" checked={draft.numbering[entry].includeYear}
                          onChange={(e) => patch({ numbering: { ...draft.numbering, [entry]: { ...draft.numbering[entry], includeYear: e.target.checked } } })}
                          className="h-3.5 w-3.5 accent-orange-500"
                        />
                        Year
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                        <input
                          type="checkbox" checked={draft.numbering[entry].includeLocation}
                          onChange={(e) => patch({ numbering: { ...draft.numbering, [entry]: { ...draft.numbering[entry], includeLocation: e.target.checked } } })}
                          className="h-3.5 w-3.5 accent-orange-500"
                        />
                        Store code
                      </label>
                    </div>
                    <div className="tnum rounded-lg bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600">
                      {documentNumber(draft, entry, draft.numbering[entry].next)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Stock rules ───────────────────────────────────────────────────

// ─── Food & menu ───────────────────────────────────────────────────

/** A chip list you can type into: the vocabulary items are tagged with. */
function LabelListEditor({ label, hint, values, onChange, placeholder = 'Add…', max = 24 }) {
  const [entry, setEntry] = useState('')
  function add() {
    const value = entry.trim()
    if (!value) return
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setEntry('')
      return
    }
    onChange([...values, value].slice(0, max))
    setEntry('')
  }
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 && <span className="text-xs text-zinc-500">Nothing yet.</span>}
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((existing) => existing !== value))}
              className="text-zinc-400 hover:text-rose-600"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }}
          placeholder={placeholder}
          className={`${inputCls} max-w-[220px]`}
        />
        <button type="button" onClick={add} className="min-h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
          Add
        </button>
      </div>
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </div>
  )
}

function FoodSection({ draft, patch }) {
  const food = draft.food
  const setFood = (key, value) => patch({ food: { ...food, [key]: value } })

  function setWindow(id, patchWindow) {
    setFood('menuWindows', food.menuWindows.map((window) => (window.id === id ? { ...window, ...patchWindow } : window)))
  }
  function addWindow() {
    const n = food.menuWindows.length + 1
    setFood('menuWindows', [...food.menuWindows, { id: `window_${n}`, label: `Window ${n}`, from: '11:00', to: '16:00', enabled: false }].slice(0, 6))
  }

  return (
    <div className="space-y-4">
      <Card title="Menu vocabulary" sub="Items are tagged from these lists, so the guest menu, tickets, and reports speak one language.">
        <div className="grid gap-4 md:grid-cols-2">
          <LabelListEditor
            label="Dietary tags"
            hint="Shown on the guest menu and filterable in the composer."
            values={food.dietaryTags}
            onChange={(value) => setFood('dietaryTags', value)}
            placeholder="Gluten-free…"
          />
          <LabelListEditor
            label="Allergens"
            hint="Allergen alerts on the KDS read this list."
            values={food.allergens}
            onChange={(value) => setFood('allergens', value)}
            placeholder="Sesame…"
          />
          <LabelListEditor
            label="Courses"
            hint="Order of service on the ticket."
            values={food.courses}
            onChange={(value) => setFood('courses', value)}
            placeholder="Amuse…"
          />
          <LabelListEditor
            label="Spice levels"
            hint="Optional strength scale for a dish."
            values={food.spiceLevels}
            onChange={(value) => setFood('spiceLevels', value)}
            placeholder="Extra hot…"
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Default course for new items">
            <select value={food.defaultCourse} onChange={(event) => setFood('defaultCourse', event.target.value)} className={inputCls}>
              {food.courses.map((course) => <option key={course} value={course}>{course}</option>)}
            </select>
          </Field>
          <Field label="Food cost target" hint="Reports flag any period above this ratio (share of sales).">
            <input
              type="number" min="0" max="1" step="0.01"
              value={draft.foodCostCap}
              onChange={(event) => patch({ foodCostCap: Number(event.target.value) })}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
      </Card>

      <Card title="Item photos" sub="Uploaded photos are resized and compressed in the browser before they are stored with the item.">
        <div className="grid gap-2 md:grid-cols-2">
          <Toggle
            label="Show photos on the menu screen"
            hint="Dish cards and the composer show the photo when an item has one."
            checked={food.showImages}
            onChange={(value) => setFood('showImages', value)}
          />
          <Toggle
            label="Show photos on the guest QR menu"
            hint="Off keeps the guest page lean on slow connections."
            checked={food.imagesOnGuestMenu}
            onChange={(value) => setFood('imagesOnGuestMenu', value)}
          />
          <Toggle
            label="Print photos on documents"
            hint="Thermal tickets should stay off; this is for invoice or menu-sheet style prints."
            checked={food.imagesInPrint}
            onChange={(value) => setFood('imagesInPrint', value)}
          />
          <Toggle
            label="Allergen alerts on the kitchen screen"
            hint="A ticket for a dish with allergens is flagged red on the KDS."
            checked={food.allergenAlerts}
            onChange={(value) => setFood('allergenAlerts', value)}
          />
          <Toggle
            label="Auto-86 when a linked ingredient runs out"
            hint="A dish with an empty key ingredient stops selling the moment stock hits zero."
            checked={food.auto86MissingIngredient}
            onChange={(value) => setFood('auto86MissingIngredient', value)}
          />
          <Toggle
            label="Children's menu"
            hint="Adds a kid-friendly section to the guest menu for items tagged Kid-friendly."
            checked={food.childrenMenu}
            onChange={(value) => setFood('childrenMenu', value)}
          />
        </div>
        <div className="mt-4 max-w-xs">
          <Field label="Photo size cap (kB)" hint="Larger caps mean sharper photos and heavier state snapshots.">
            <input
              type="number" min="20" max="600" step="10"
              value={food.imageMaxKb}
              onChange={(event) => setFood('imageMaxKb', Number(event.target.value))}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
      </Card>

      <Card title="Service windows" sub="When each part of the menu is sellable. Assign a window to an item to hide it outside those hours.">
        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Sellable</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {food.menuWindows.map((window) => (
                <tr key={window.id}>
                  <td className="px-3 py-2">
                    <input
                      value={window.label}
                      aria-label={`${window.label} name`}
                      onChange={(event) => setWindow(window.id, { label: event.target.value })}
                      className={`${inputCls} min-h-9`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time" value={window.from} aria-label={`${window.label} from`}
                      onChange={(event) => setWindow(window.id, { from: event.target.value })}
                      className={`${inputCls} min-h-9 tnum`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time" value={window.to} aria-label={`${window.label} to`}
                      onChange={(event) => setWindow(window.id, { to: event.target.value })}
                      className={`${inputCls} min-h-9 tnum`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox" checked={window.enabled} aria-label={`${window.label} enabled`}
                      onChange={(event) => setWindow(window.id, { enabled: event.target.checked })}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Remove ${window.label}`}
                      onClick={() => setFood('menuWindows', food.menuWindows.filter((entry) => entry.id !== window.id))}
                      className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {food.menuWindows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-500">No service windows — the whole menu sells all day.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addWindow}
          disabled={food.menuWindows.length >= 6}
          className="mt-3 min-h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Add window
        </button>
      </Card>
    </div>
  )
}

// The unit vocabulary is the one place units are defined: every stock
// item points at a unit from here, and every pack it is bought in is built
// from this list. Editing it is how "package / bottle / size" stays data.
function UnitsCard({ draft, patch, inventory }) {
  const units = draft.units
  const [entry, setEntry] = useState({ label: '', short: '', family: 'count' })

  function setUnits(next) {
    patch({ units: { ...units, ...next } })
  }
  function updateUnit(index, key, value) {
    const list = units.list.map((unit, position) => (position === index ? { ...unit, [key]: value } : unit))
    setUnits({ list })
  }
  function removeUnit(index) {
    if (units.list.length <= 1) return
    setUnits({ list: units.list.filter((_, position) => position !== index) })
  }
  function addUnit() {
    const label = entry.label.trim()
    const id = slugUnitId(label)
    if (!id || units.list.some((unit) => unit.id === id)) return
    setUnits({
      list: [...units.list, { ...entry, id, label, short: entry.short.trim() || id.slice(0, 6), decimals: 0 }],
    })
    setEntry({ label: '', short: '', family: 'count' })
  }

  const usage = (unitId) => inventory.filter((item) => item.unit === unitId).length

  return (
    <Card
      title="Units of measure"
      sub="The vocabulary every quantity is counted in. Items are stocked in one of these units and bought in packs built from it."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400">
              <th className="pb-2 pr-2 font-bold">Unit</th>
              <th className="pb-2 pr-2 font-bold">Short</th>
              <th className="pb-2 pr-2 font-bold">Family</th>
              <th className="pb-2 pr-2 font-bold">Factor</th>
              <th className="pb-2 pr-2 font-bold">Decimals</th>
              <th className="pb-2 pr-2 font-bold">Used by</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {units.list.map((unit, index) => (
              <tr key={unit.id} className="border-t border-zinc-100">
                <td className="py-2 pr-2">
                  <input
                    value={unit.label}
                    aria-label={`Unit ${index + 1} label`}
                    onChange={(event) => updateUnit(index, 'label', event.target.value)}
                    className={inputCls}
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={unit.short}
                    aria-label={`Unit ${index + 1} short label`}
                    onChange={(event) => updateUnit(index, 'short', event.target.value)}
                    className={`${inputCls} w-20`}
                  />
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={unit.family}
                    aria-label={`Unit ${index + 1} family`}
                    onChange={(event) => updateUnit(index, 'family', event.target.value)}
                    className={inputCls}
                  >
                    {UNIT_FAMILIES.map((family) => <option key={family.id} value={family.id}>{family.label}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value={unit.factor}
                    aria-label={`Unit ${index + 1} factor`}
                    onChange={(event) => updateUnit(index, 'factor', Number(event.target.value))}
                    className={`${inputCls} tnum w-24`}
                  />
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={unit.decimals}
                    aria-label={`Unit ${index + 1} decimals`}
                    onChange={(event) => updateUnit(index, 'decimals', Number(event.target.value))}
                    className={`${inputCls} w-20`}
                  >
                    {[0, 1, 2, 3].map((digit) => <option key={digit} value={digit}>{digit}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-2 text-xs text-zinc-500 tnum">{usage(unit.id) || '—'}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    aria-label={`Remove unit ${unit.label}`}
                    disabled={units.list.length <= 1}
                    onClick={() => removeUnit(index)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-zinc-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 md:grid-cols-4">
        <Field label="New unit">
          <input
            value={entry.label}
            placeholder="Pony keg"
            aria-label="New unit label"
            onChange={(event) => setEntry({ ...entry, label: event.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Short label">
          <input
            value={entry.short}
            placeholder="pk"
            aria-label="New unit short label"
            onChange={(event) => setEntry({ ...entry, short: event.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Family">
          <select
            value={entry.family}
            aria-label="New unit family"
            onChange={(event) => setEntry({ ...entry, family: event.target.value })}
            className={inputCls}
          >
            {UNIT_FAMILIES.map((family) => <option key={family.id} value={family.id}>{family.label}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <button
            type="button"
            onClick={addUnit}
            className="min-h-10 w-full rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
          >
            Add unit
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        Factor converts inside a family: a kilogram is 1000 grams, a litre is 1000 millilitres. Count units stay at 1.
        {units.list.length === DEFAULT_UNITS.length ? ' The shipped list is the starting point — edit it freely.' : ''}
      </p>

      <div className="mt-5 border-t border-zinc-100 pt-4">
        <LabelListEditor
          label="Pack labels"
          hint="Offered when packaging an item: a case, a bottle, a bag…"
          values={units.packNames}
          onChange={(packNames) => setUnits({ packNames })}
          placeholder="Add a pack label…"
          max={12}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Default stock unit" hint="Used for new items until you pick a better one.">
          <select
            value={units.defaultStockUnit}
            onChange={(event) => setUnits({ defaultStockUnit: event.target.value })}
            className={inputCls}
          >
            {units.list.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </Field>
        <Field label="Default purchase unit" hint="The pack an order line starts on.">
          <select
            value={units.defaultPurchaseUnit}
            onChange={(event) => setUnits({ defaultPurchaseUnit: event.target.value })}
            className={inputCls}
          >
            {units.packNames.map((name) => <option key={name} value={slugUnitId(name)}>{name}</option>)}
          </select>
        </Field>
        <Toggle
          label="Convert packs into stock units when receiving"
          hint="A case of 12 bottles of 750 ml lands as 9 000 ml of stock."
          checked={units.convertOnReceive}
          onChange={(value) => setUnits({ convertOnReceive: value })}
        />
        <Toggle
          label="Show the pack breakdown in lists"
          hint="Stock reads as “6 Cases + 4 ptn” instead of a bare number."
          checked={units.showPackBreakdown}
          onChange={(value) => setUnits({ showPackBreakdown: value })}
        />
      </div>

      <div className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
        <div className="font-semibold text-zinc-700">Packaging in use</div>
        <ul className="mt-1 space-y-1">
          {inventory.filter((item) => (item.packs || []).length).map((item) => {
            const choices = itemUnitChoices(item, draft).filter((choice) => choice.kind === 'pack')
            return (
              <li key={item.id}>
                <span className="font-medium text-zinc-700">{item.name}</span> · stocked in {item.unit} ·{' '}
                {choices.map((choice) => `1 ${choice.label} = ${choice.factor} ${item.unit}`).join(' · ')}
                {item.purchaseUnit ? ` · ordered by ${item.purchaseUnit}` : ''}
              </li>
            )
          })}
          {!inventory.some((item) => (item.packs || []).length) && <li>No item has packaging yet — add packs on the item in Catalog.</li>}
        </ul>
      </div>
    </Card>
  )
}

function StockSection({ draft, patch, inventory = [] }) {
  const stock = draft.stock
  function setStock(key, value) {
    patch({ stock: { ...stock, [key]: value } })
  }
  return (
    <div className="space-y-4">
      <Card title="Valuation" sub="How the recipe book prices every SKU — this one choice moves all plate costs.">
        <div className="grid gap-3 md:grid-cols-2">
          {VALUATION_METHODS.map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => setStock('valuationMethod', method.id)}
              className={`rounded-xl border p-3 text-left transition ${stock.valuationMethod === method.id ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-200' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-zinc-800">{method.label}</span>
                {stock.valuationMethod === method.id && <StatusPill tone="ok" size="sm">Active</StatusPill>}
              </div>
              <p className="mt-1 text-xs text-zinc-500">{method.blurb}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Reorder policy" sub="Decides when a SKU shows as low and what the order suggestion says.">
        <div className="grid gap-3 md:grid-cols-2">
          {REORDER_POLICIES.map((policy) => (
            <button
              key={policy.id}
              type="button"
              onClick={() => setStock('reorderPolicy', policy.id)}
              className={`rounded-xl border p-3 text-left transition ${stock.reorderPolicy === policy.id ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-200' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-zinc-800">{policy.label}</span>
                {stock.reorderPolicy === policy.id && <StatusPill tone="ok" size="sm">Active</StatusPill>}
              </div>
              <p className="mt-1 text-xs text-zinc-500">{policy.blurb}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <Field label="Safety stock days" hint="Days of cover added to the reorder point.">
            <input type="number" min="0" max="30" step="0.5" value={stock.safetyStockDays} onChange={(e) => setStock('safetyStockDays', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Cycle count cadence (days)">
            <input type="number" min="1" max="90" value={stock.cycleCountDays} onChange={(e) => setStock('cycleCountDays', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Waste approval above" hint="Waste value that needs a manager in the log.">
            <input type="number" min="0" step="1" value={stock.wasteApprovalAbove} onChange={(e) => setStock('wasteApprovalAbove', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Quantity precision" hint="Decimals accepted when receiving or counting.">
            <select value={stock.autoReceiveThousandths} onChange={(e) => setStock('autoReceiveThousandths', Number(e.target.value))} className={inputCls}>
              {[0, 1, 2, 3, 4].map((digits) => <option key={digits} value={digits}>{digits} decimals</option>)}
            </select>
          </Field>
          <Field label="Default unit" hint="From Settings → Units of measure.">
            <select value={stock.defaultUnit} onChange={(e) => setStock('defaultUnit', e.target.value)} className={inputCls}>
              {(draft.units?.list || []).map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
            </select>
          </Field>
          <Field label="Expiry warning (days)">
            <input type="number" min="0" max="60" value={stock.expiryWarnDays} onChange={(e) => setStock('expiryWarnDays', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Toggle
            label="Auto-86 a dish when its recipe runs out"
            hint="The composer, KDS, and guest QR stop selling it instantly; receiving stock puts it back."
            checked={stock.auto86OnZero}
            onChange={(value) => setStock('auto86OnZero', value)}
          />
          <Toggle
            label="Allow negative stock"
            hint="Off: waste logs and edits cannot drive on-hand below zero. Theoretical fire counts can still go negative as an exception flag."
            checked={stock.allowNegativeStock}
            onChange={(value) => setStock('allowNegativeStock', value)}
          />
          <Toggle
            label="Require a reason on count variances"
            hint="Counted truth beats theory — but the reason is what makes it learnable."
            checked={stock.requireCountReason}
            onChange={(value) => setStock('requireCountReason', value)}
          />
        </div>
      </Card>

      <UnitsCard draft={draft} patch={patch} inventory={inventory} />

      <Card title="Storage locations" sub="Where the stock physically lives — filters on the count sheet and stock list.">
        <div className="flex flex-wrap gap-2">
          {STORAGE_LOCATIONS.map((location) => {
            const active = stock.storageLocations.includes(location.id)
            return (
              <button
                key={location.id}
                type="button"
                onClick={() => setStock('storageLocations', active
                  ? stock.storageLocations.filter((id) => id !== location.id)
                  : [...stock.storageLocations, location.id])}
                className={`min-h-10 rounded-xl px-3.5 text-sm font-semibold ring-1 ring-inset transition ${active ? 'bg-orange-500 text-white ring-orange-500' : 'bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50'}`}
                aria-pressed={active}
              >
                {location.label}
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ─── Service & POS ─────────────────────────────────────────────────

function PosSection({ draft, patch }) {
  const pos = draft.pos
  function setPos(key, value) {
    patch({ pos: { ...pos, [key]: value } })
  }
  const booking = draft.booking || {
    allowGuestTableChange: true,
    allowGuestReschedule: true,
    rescheduleCutoffMinutes: 60,
    defaultBookingDurationMinutes: 90,
    maxGuestReschedules: 2,
  }
  function setBooking(key, value) {
    patch({ booking: { ...booking, [key]: value } })
  }
  return (
    <div className="space-y-4">
      <Card title="Tips & gratuity" sub="Pre-set percentages for the close-check screen and auto-gratuity thresholds.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Tip presets %" hint="Comma-separated, up to six.">
            <input
              value={pos.tipPresets.map((value) => Math.round(value * 100)).join(', ')}
              onChange={(e) => setPos('tipPresets', e.target.value.split(',').map((part) => Math.max(0, Math.min(0.5, Number(part.trim()) / 100))).filter((value) => value > 0).slice(0, 6))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Auto-gratuity %">
            <input type="number" min="0" max="30" step="0.5" value={(pos.autoGratuityPct * 100).toFixed(1)} onChange={(e) => setPos('autoGratuityPct', Math.max(0, Math.min(1, Number(e.target.value) / 100)))} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Auto-gratuity from party size">
            <input type="number" min="1" max="40" value={pos.autoGratuityPartySize} onChange={(e) => setPos('autoGratuityPartySize', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Toggle label="Tips enabled" hint="Shows the tip line on the close-check screen and receipts." checked={pos.tipsEnabled} onChange={(value) => setPos('tipsEnabled', value)} />
          <Toggle label="Allow split checks" hint="Split by seat, even ways, or by item." checked={pos.allowSplit} onChange={(value) => setPos('allowSplit', value)} />
          <Toggle label="Allow discounts" checked={pos.allowDiscounts} onChange={(value) => setPos('allowDiscounts', value)} />
          <Toggle label="Require manager for void/comp" hint="Voids and comps stay in the audit trail either way." checked={pos.requireManagerVoid} onChange={(value) => setPos('requireManagerVoid', value)} />
          <Toggle label="Guest QR ordering" hint="Turns the table QR tent cards on or off for this store." checked={pos.guestQrOrdering} onChange={(value) => setPos('guestQrOrdering', value)} />
        </div>
      </Card>

      <Card title="Reservations & Table Transfers" sub="Self-service rescheduling cutoff windows, modification limits, and table change policies.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Reschedule cutoff (mins)" hint="Minutes before booking when self-service locks.">
            <input
              type="number"
              min="0"
              max="1440"
              value={booking.rescheduleCutoffMinutes ?? 60}
              onChange={(e) => setBooking('rescheduleCutoffMinutes', Math.max(0, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Default duration (mins)" hint="Standard seating slot duration.">
            <input
              type="number"
              min="15"
              max="360"
              value={booking.defaultBookingDurationMinutes ?? 90}
              onChange={(e) => setBooking('defaultBookingDurationMinutes', Math.max(15, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Max guest reschedules" hint="Limit self-service date/time changes per booking.">
            <input
              type="number"
              min="1"
              max="10"
              value={booking.maxGuestReschedules ?? 2}
              onChange={(e) => setBooking('maxGuestReschedules', Math.max(1, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Toggle
            label="Allow guest rescheduling"
            hint="Allow guests to update their booking time & date before the cutoff window."
            checked={booking.allowGuestReschedule !== false}
            onChange={(value) => setBooking('allowGuestReschedule', value)}
          />
          <Toggle
            label="Allow guest table change"
            hint="Allow guests to select preferred tables or request seated table moves."
            checked={booking.allowGuestTableChange !== false}
            onChange={(value) => setBooking('allowGuestTableChange', value)}
          />
        </div>
      </Card>

      <Card title="Printers" sub="Named destinations, printed on the ticket header so runners know where it came from.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Receipt printer">
            <input value={pos.printerReceipt} onChange={(e) => setPos('printerReceipt', e.target.value)} maxLength={60} className={inputCls} placeholder="Front counter · thermal 80mm" />
          </Field>
          <Field label="Kitchen printer">
            <input value={pos.printerKitchen} onChange={(e) => setPos('printerKitchen', e.target.value)} maxLength={60} className={inputCls} placeholder="Expo line · thermal 80mm" />
          </Field>
          <Field label="Kitchen copies">
            <input type="number" min="1" max="4" value={pos.printTicketCopies} onChange={(e) => setPos('printTicketCopies', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

// ─── Alerts ────────────────────────────────────────────────────────

function AlertsSection({ draft, patch }) {
  const notifications = draft.notifications
  function setNotifications(key, value) {
    patch({ notifications: { ...notifications, [key]: value } })
  }
  return (
    <Card title="What pings whom" sub="Alert classes surface in the bell, on tabs, and in the shift rail.">
      <div className="grid gap-2 md:grid-cols-2">
        <Toggle label="Low stock & out-of-stock" checked={notifications.lowStock} onChange={(value) => setNotifications('lowStock', value)} />
        <Toggle label="Late tickets (KDS SLA)" checked={notifications.lateTickets} onChange={(value) => setNotifications('lateTickets', value)} />
        <Toggle label="Guest requests (call server, bill)" checked={notifications.guestRequests} onChange={(value) => setNotifications('guestRequests', value)} />
        <Toggle label="Loss-making dishes" checked={notifications.negativeMargin} onChange={(value) => setNotifications('negativeMargin', value)} />
        <Toggle label="Daily digest" hint="Yesterday's sales, food cost, and exceptions." checked={notifications.dailyDigest} onChange={(value) => setNotifications('dailyDigest', value)} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Digest time">
          <input type="time" value={notifications.digestTime} onChange={(e) => setNotifications('digestTime', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Channel">
          <select value={notifications.channel} onChange={(e) => setNotifications('channel', e.target.value)} className={inputCls}>
            {NOTIFICATION_CHANNELS.map((channel) => <option key={channel} value={channel}>{channel.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Recipients" hint="Comma-separated emails or phone numbers.">
          <input value={notifications.recipients} onChange={(e) => setNotifications('recipients', e.target.value)} maxLength={200} className={inputCls} placeholder="owner@restora.example" />
        </Field>
        <Field label="Webhook URL" hint="Optional — posts alert JSON for Slack or a custom bot.">
          <input value={notifications.webhookUrl} onChange={(e) => setNotifications('webhookUrl', e.target.value)} maxLength={200} className={inputCls} placeholder="https://hooks.example/restora" />
        </Field>
      </div>
    </Card>
  )
}

// ─── Data & backup ─────────────────────────────────────────────────

function DataSection({ state, draft, dispatch, empire, locId, link, resync }) {
  const [importError, setImportError] = useState('')
  const importRef = useRef(null)
  const documents = useMemo(() => [...(state.documents || [])].reverse(), [state.documents])

  function exportState() {
    const blob = new Blob([JSON.stringify(empire, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `restora-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function importState(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'))
        const migrated = migrateToEmpire(parsed)
        if (!migrated) throw new Error('Not a Restora snapshot')
        dispatch({ type: 'HYDRATE', state: migrated })
        setImportError('')
        window.alert('Snapshot restored on this terminal. Use Resync or press Reset on other terminals to align them.')
      } catch (error) {
        setImportError(error.message || 'Could not read that file.')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4">
      <Card
        title={`Issued documents · ${documents.length}`}
        sub="Every filed document keeps its number, totals, and payload — reprint anytime, void without deleting."
      >
        {documents.length ? (
          <ul className="divide-y divide-zinc-100">
            {documents.slice(0, 12).map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-800">{document.number}</span>
                    <StatusPill tone={document.meta?.voided ? 'bad' : 'ok'} size="sm">
                      {document.meta?.voided ? 'Voided' : DOC_KIND_META[document.kind]?.label}
                    </StatusPill>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {new Date(document.issuedAt).toLocaleString()} · {document.currency.code}
                    {document.totals?.grandTotal ? ` · ${formatMoney(document.totals.grandTotal, document.currency)}` : ''}
                    {document.reference ? ` · ${document.reference}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => printHtml(
                      renderDocumentHtml(document, sanitizeSettings(draft, state.settings?.restaurantName)),
                      { title: `${document.kind} ${document.number}` },
                    )}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    Reprint
                  </button>
                  {!document.meta?.voided && (
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'VOID_DOCUMENT', documentId: document.id, reason: 'manager void' })}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Void
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">
            No documents filed yet. Use the Documents section to print an invoice, receipt, ticket, or report — filing assigns the next number.
          </p>
        )}
      </Card>

      <Card title="Snapshot & restore" sub="The whole empire (both stores, menu, stock, settings, and history) as one JSON file.">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportState} className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600">
            Export snapshot
          </button>
          <button type="button" onClick={() => importRef.current?.click()} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
            Import snapshot
          </button>
          <input ref={importRef} type="file" accept="application/json" onChange={importState} className="hidden" aria-label="Import snapshot" />
          {link.mode === 'server' && (
            <button type="button" onClick={() => resync()} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
              Resync from server
            </button>
          )}
        </div>
        {importError && <p className="mt-2 text-sm text-red-600">{importError}</p>}
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          Import restores this terminal only — a linked server keeps the authoritative snapshot. SQLite at{' '}
          <code className="rounded bg-zinc-100 px-1">server/data/restora.sqlite</code> stays the source of truth for
          connected terminals ({locId} is open here).
        </p>
      </Card>

      <Card title="Reset" sub="Every reset is an action in the log, so it is auditable and reversible by import.">
        <div className="flex flex-wrap gap-2">
          {['business', 'money', 'documents', 'stock', 'pos', 'alerts', 'targets'].map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => {
                if (window.confirm(`Reset the ${section} section to the Restora defaults for this store?`)) {
                  dispatch({ type: 'RESET_SETTINGS', section: section === 'alerts' ? 'notifications' : section })
                }
              }}
              className="min-h-10 rounded-xl border border-zinc-200 px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Reset {section}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Reset every setting on this store back to defaults? Retail data is untouched.')) {
                dispatch({ type: 'RESET_SETTINGS', section: 'all' })
              }
            }}
            className="min-h-10 rounded-xl border border-red-200 px-3.5 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Reset all settings
          </button>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          Defaults come from <code className="rounded bg-zinc-100 px-1">src/lib/settings.js</code> — the same object the
          SQLite projection and migrations use, so seed data and live stores never drift apart.
        </p>
      </Card>
    </div>
  )
}

// ─── Screen ────────────────────────────────────────────────────────

export default function SettingsScreen({ initialSection = 'business' }) {
  const { state, settings, dispatch, dispatchEverywhere, empire, locId, link, role, issueDocument, resync } = useRestora()
  const { lang, dict } = useI18n()
  const st = dict.settings || {}
  const [section, setSection] = useState(initialSection)
  const [draft, setDraft] = useState(() => settings)
  const [scopeAll, setScopeAll] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const audit = useMemo(() => configurationAudit(state), [state])
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings])

  const sectionLabels = {
    business: st.identityTab || 'Business profile',
    money: st.currencyTab || 'Currency & tax',
    documents: st.documentsTab || 'Documents',
    stock: st.inventoryTab || 'Stock rules',
    food: st.foodTab || 'Food & menu',
    pos: st.posTab || 'Service & POS',
    alerts: st.notificationsTab || 'Alerts & notifications',
    data: st.dataTab || 'Data & reset',
  }

  // Follow the store when someone else changes settings (another terminal),
  // unless this screen has unsaved edits.
  useEffect(() => {
    if (!dirty) setDraft(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  function patch(partial) {
    setDraft((current) => ({ ...current, ...partial }))
  }

  function save() {
    const action = { type: 'UPDATE_SETTINGS', patch: draft, updatedBy: role }
    if (scopeAll) dispatchEverywhere(action)
    else dispatch(action)
    setSavedAt(Date.now())
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">{st.kicker || 'Configuration'}</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            {st.title || 'Settings & Documents'}
            {lang !== 'en' && <span className="sr-only"> Settings &amp; Documents</span>}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {state.settings.restaurantName} · {locId}
            {link.status === 'live' ? ' · synced to every terminal' : ' · this terminal (offline)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={audit.ready ? 'ok' : audit.done / audit.total >= 0.7 ? 'warn' : 'bad'}>
            {audit.done}/{audit.total} checks ready
          </StatusPill>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600">
            <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} className="h-4 w-4 accent-orange-500" />
            {st.applyAllLocations || 'Apply to all stores'}
          </label>
          <button
            type="button"
            disabled={!dirty}
            onClick={save}
            className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {dirty ? (st.saveSettings || 'Save changes') : savedAt ? (st.saved || 'Saved ✓') : 'No changes'}
          </button>
          {dirty && (
            <button type="button" onClick={() => setDraft(settings)} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50">
              {st.resetDefaults || 'Discard'}
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {audit.checks.slice(0, 5).map((check) => (
          <button
            key={check.id}
            type="button"
            onClick={() => setSection(SECTIONS.some((entry) => entry.id === check.section) ? check.section : 'business')}
            className={`rounded-2xl border p-3.5 text-left shadow-sm transition ${check.ok ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70 hover:border-amber-300'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${check.ok ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                {check.ok ? '✓' : '!'}
              </span>
              <span className="text-xs font-bold text-zinc-800">{check.label}</span>
            </div>
            {!check.ok && <p className="mt-1.5 text-[11px] leading-snug text-amber-800">{check.fix}</p>}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[248px_1fr]">
        <nav className="space-y-1 self-start rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm xl:sticky xl:top-4" aria-label="Settings sections">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              aria-current={section === entry.id}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${section === entry.id ? 'bg-orange-50 ring-1 ring-inset ring-orange-200' : 'hover:bg-zinc-50'}`}
            >
              <Icon name={entry.id === 'documents' ? 'doc' : entry.id === 'money' ? 'costing' : entry.id === 'stock' ? 'inventory' : entry.id === 'data' ? 'layers' : 'settings'} size={16} className={section === entry.id ? 'mt-0.5 text-orange-600' : 'mt-0.5 text-zinc-400'} />
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${section === entry.id ? 'text-orange-700' : 'text-zinc-700'}`}>
                  {sectionLabels[entry.id] || entry.label}
                  {lang !== 'en' && <span className="sr-only"> {entry.label}</span>}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{entry.blurb}</span>
              </span>
            </button>
          ))}
          <div className="mt-1 border-t border-zinc-100 px-3 py-2.5 text-[11px] text-zinc-500">
            {dirty ? <span className="font-semibold text-amber-700">Unsaved edits — save to publish</span> : 'All changes saved'}
          </div>
        </nav>

        <div>
          {section === 'business' && <BusinessSection draft={draft} patch={patch} />}
          {section === 'money' && (
            <MoneySection draft={draft} patch={patch} dispatch={dispatch} settings={settings} state={state} locationLabel={locId} />
          )}
          {section === 'documents' && (
            <DocumentsSection
              draft={draft}
              patch={patch}
              state={state}
              dispatch={dispatch}
              locId={locId}
              issueDocument={issueDocument}
            />
          )}
          {section === 'stock' && <StockSection draft={draft} patch={patch} inventory={state.inventory} />}
          {section === 'food' && <FoodSection draft={draft} patch={patch} />}
          {section === 'pos' && <PosSection draft={draft} patch={patch} />}
          {section === 'alerts' && <AlertsSection draft={draft} patch={patch} />}
          {section === 'data' && (
            <DataSection state={state} draft={draft} dispatch={dispatch} empire={empire} locId={locId} link={link} resync={resync} />
          )}
        </div>
      </div>
    </div>
  )
}
