import { useEffect, useMemo, useState } from 'react'
import DocumentPreview from '../../../components/DocumentPreview'
import { formatMoney } from '../../../lib/currency'
import { buildInvoiceDocument, buildReceiptDocument, buildReportDocument, buildTicketDocument, documentFileName, downloadHtml, printHtml, renderDocumentHtml } from '../../../lib/documents'
import { DOC_KINDS, DOC_KIND_META, PAPER_SIZES, documentNumber, sanitizeSettings, templateFor } from '../../../lib/settings'
import { Field, Toggle, Card, inputCls } from '../primitives'

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

export { DocumentsSection }
