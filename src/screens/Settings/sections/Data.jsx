import { useMemo, useRef, useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { formatMoney } from '../../../lib/currency'
import { printHtml, renderDocumentHtml } from '../../../lib/documents'
import { DOC_KIND_META, sanitizeSettings } from '../../../lib/settings'
import { migrateToEmpire } from '../../../lib/reducer'
import { useToast } from '../../../components/ui/toast-context'
import { useConfirm } from '../../../components/ui/confirm-context'
import { Card } from '../primitives'

function DataSection({ state, draft, dispatch, empire, locId, link, resync }) {
  const [importError, setImportError] = useState('')
  const importRef = useRef(null)
  const { notify } = useToast()
  const confirm = useConfirm()
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
        notify('Snapshot restored on this terminal. Use Resync or press Reset on other terminals to align them.', 'success')
      } catch (error) {
        const message = error.message || 'Could not read that file.'
        setImportError(message)
        notify(message, 'error')
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
              onClick={async () => {
                const ok = await confirm({
                  title: `Reset the ${section} section?`,
                  body: 'This section goes back to the Restora defaults for this store.',
                  confirmLabel: 'Reset section',
                })
                if (ok) dispatch({ type: 'RESET_SETTINGS', section: section === 'alerts' ? 'notifications' : section })
              }}
              className="min-h-10 rounded-xl border border-zinc-200 px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Reset {section}
            </button>
          ))}
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: 'Reset every setting?',
                body: 'Every setting on this store goes back to the defaults. Retail data is untouched.',
                confirmLabel: 'Reset everything',
                tone: 'danger',
              })
              if (ok) dispatch({ type: 'RESET_SETTINGS', section: 'all' })
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


export { DataSection }
