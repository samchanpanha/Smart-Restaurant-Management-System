// ─── Stock movements ────────────────────────────────────────────────
// Every way stock can move, in one list: receipts in, sales and waste
// out, counts that correct the book, and the baseline the book opened
// with. This is the audit trail behind every inventory number — if a
// figure on a report looks wrong, the reason is a row on this screen.

import { useMemo, useState } from 'react'
import StatusPill from '../components/StatusPill'
import { Modal, Field, btnGhost, btnPrimary, inputCls } from '../components/ui'
import { translateInventoryName, useI18n } from '../lib/i18n'
import { money } from '../lib/models'
import { MOVEMENT_KINDS } from '../lib/reducer'
import { RANGES, movementSummary, rangeBounds, stockFlow } from '../lib/reports'
import { useRestora } from '../lib/store'

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white shadow-sm'
const thCls = 'px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-zinc-500'
const tdCls = 'px-3 py-2.5 text-sm text-zinc-700'

const KIND_META = Object.fromEntries(MOVEMENT_KINDS.map((kind) => [kind.id, kind]))

const signed = (value, digits = 2) => {
  const n = Number(value) || 0
  if (!n) return '0'
  return `${n > 0 ? '+' : '−'}${Math.abs(Math.round(n * 10 ** digits) / 10 ** digits)}`
}

const VIEWS = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'summary', label: 'By item' },
  { id: 'kinds', label: 'By reason' },
]

const TONE_BY_KIND = {
  buy: 'ok',
  opening: 'muted',
  return: 'info',
  sale: 'info',
  waste: 'bad',
  count: 'warn',
  adjust: 'warn',
}

function CountStockModal({ onClose, onSave }) {
  const { state } = useRestora()
  const { lang, dict } = useI18n()
  const mv = dict.movements || {}
  const [counts, setCounts] = useState(() => Object.fromEntries(
    (state.inventory || []).map((item) => [item.id, String(item.onHand ?? '')]),
  ))
  const [query, setQuery] = useState('')

  const rows = (state.inventory || []).filter((item) => (
    !query || item.name.toLowerCase().includes(query.toLowerCase()) || String(item.sku || '').toLowerCase().includes(query.toLowerCase())
  ))
  const changed = (state.inventory || []).filter((item) => {
    const value = Number(counts[item.id])
    return String(counts[item.id] ?? '') !== '' && Number.isFinite(value) && value !== item.onHand
  })
  const variance = changed.reduce((sum, item) => {
    const delta = (Number(counts[item.id]) || 0) - item.onHand
    return sum + delta * (Number(item.lastCost) || 0)
  }, 0)

  const modalTitle = lang === 'km' ? 'រាប់ស្តុកក្នុងឃ្លាំង' : lang === 'zh' ? '盘点库房库存' : 'Count the store room'
  const cancelLabel = lang === 'km' ? 'បោះបង់' : lang === 'zh' ? '取消' : 'Cancel'

  return (
    <Modal
      title={
        <>
          {modalTitle}
          {lang !== 'en' && <span className="sr-only"> Count the store room</span>}
        </>
      }
      sub="Type what you actually counted. Only the differences are written to the ledger — a count that matches changes nothing."
      onClose={onClose}
      wide
    >
      <div className="mt-3 flex items-center gap-2">
        <input className={inputCls} placeholder={mv.searchMovements || 'Search items…'} value={query} onChange={(e) => setQuery(e.target.value)} />
        <StatusPill tone={changed.length ? 'warn' : 'ok'} size="sm">{changed.length} variance(s)</StatusPill>
      </div>
      <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-zinc-200">
        <table className="w-full">
          <thead className="sticky top-0 bg-zinc-50">
            <tr>
              <th className={thCls}>{mv.item || 'Item'}</th>
              <th className={`${thCls} w-24`}>Book</th>
              <th className={`${thCls} w-28`}>Counted</th>
              <th className={`${thCls} w-24 text-right`}>Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((item) => {
              const value = Number(counts[item.id])
              const delta = String(counts[item.id] ?? '') === '' || !Number.isFinite(value) ? 0 : value - item.onHand
              return (
                <tr key={item.id} className={delta ? 'bg-amber-50/60' : ''}>
                  <td className={tdCls}>
                    <div className="font-medium text-zinc-800">{translateInventoryName(item, lang)}</div>
                    <div className="text-2xs text-zinc-500">{item.sku} · {item.unit}</div>
                  </td>
                  <td className={tdCls}>{item.onHand}</td>
                  <td className={tdCls}>
                    <input
                      type="number" step="0.01" className={inputCls} value={counts[item.id] ?? ''}
                      onChange={(e) => setCounts((current) => ({ ...current, [item.id]: e.target.value }))}
                    />
                  </td>
                  <td className={`${tdCls} text-right font-medium ${delta < 0 ? 'text-rose-600' : delta > 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>
                    {delta ? `${signed(delta)} ${item.unit}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          Variance value {money(variance, state.settings.currency)}
          <span className="text-zinc-400"> · booked against the book cost, not the count</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            <span data-i18n-tab={cancelLabel} className="tab-i18n-label">
              <span className="sr-only">Cancel</span>
            </span>
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!changed.length}
            onClick={() => onSave(Object.fromEntries(changed.map((item) => [item.id, Number(counts[item.id])])))}
          >
            Book {changed.length} correction(s)
          </button>
        </div>
      </div>
    </Modal>
  )
}

function WasteModal({ onClose, onSave }) {
  const { state } = useRestora()
  const [form, setForm] = useState({ inventoryItemId: state.inventory?.[0]?.id || '', qty: 1, reason: 'spoil', note: '' })
  const reasons = ['prep', 'spoil', 'comp', 'error']

  return (
    <Modal title="Log waste" sub="Waste is a cost line on the P&L and a negative row in the ledger — book it the moment it happens." onClose={onClose}>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Item">
          <select className={inputCls} value={form.inventoryItemId} onChange={(e) => setForm((c) => ({ ...c, inventoryItemId: e.target.value }))}>
            {(state.inventory || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="Quantity">
          <input type="number" min="0" step="0.01" className={inputCls} value={form.qty} onChange={(e) => setForm((c) => ({ ...c, qty: Number(e.target.value) }))} />
        </Field>
        <Field label="Reason">
          <select className={inputCls} value={form.reason} onChange={(e) => setForm((c) => ({ ...c, reason: e.target.value }))}>
            {reasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
        </Field>
        <Field label="Note">
          <input className={inputCls} value={form.note} onChange={(e) => setForm((c) => ({ ...c, note: e.target.value }))} placeholder="Dropped tray, over-pour…" />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={() => onSave(form)}>Book waste</button>
      </div>
    </Modal>
  )
}

export default function MovementsScreen() {
  const { state, dispatch, role } = useRestora()
  const { lang, dict } = useI18n()
  const mv = dict.movements || {}
  const [range, setRange] = useState('7d')
  const [kind, setKind] = useState('all')
  const [view, setView] = useState('ledger')
  const [query, setQuery] = useState('')
  const [flash, setFlash] = useState('')
  const [counting, setCounting] = useState(false)
  const [wasting, setWasting] = useState(false)

  const bounds = useMemo(() => rangeBounds(range), [range])
  const summary = useMemo(() => movementSummary(state, bounds), [state, bounds])
  const flow = useMemo(() => stockFlow(state, bounds), [state, bounds])
  const currency = state.settings.currency

  const rows = summary.rows
    .filter((movement) => kind === 'all' || movement.kind === kind)
    .filter((movement) => !query || movement.name?.toLowerCase().includes(query.toLowerCase()))
    .slice()
    .reverse()

  const kindRows = summary.byKind
    .filter((row) => row.count > 0)
    .sort((a, b) => (b.inValue + b.outValue) - (a.inValue + a.outValue))

  const viewTranslations = {
    ledger: lang === 'km' ? 'បញ្ជីចលនា' : lang === 'zh' ? '台账' : 'Ledger',
    summary: lang === 'km' ? 'តាមមុខទំនិញ' : lang === 'zh' ? '按商品' : 'By item',
    kinds: lang === 'km' ? 'តាមមូលហេតុ' : lang === 'zh' ? '按原因' : 'By reason',
  }
  const countBtnLabel = lang === 'km' ? 'រាប់ស្តុក' : lang === 'zh' ? '盘点库存' : 'Count stock'
  const logWasteLabel = lang === 'km' ? 'កត់ត្រាការខូចខាត' : lang === 'zh' ? '记录损耗' : 'Log waste'

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">
            {mv.title || 'Stock movements'}
            {lang !== 'en' && <span className="sr-only"> Stock movements</span>}
          </h2>
          <p className="text-sm text-zinc-500">
            {mv.subtitle || 'The full audit trail — receipts in, sales, waste and counts out — with the baseline the book opened with.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGhost} onClick={() => { setFlash(''); setWasting(true) }}>
            {logWasteLabel}
          </button>
          <button type="button" className={btnPrimary} onClick={() => { setFlash(''); setCounting(true) }}>
            <span data-i18n-tab={countBtnLabel} className="tab-i18n-label">
              <span className="sr-only">Count stock</span>
            </span>
          </button>
        </div>
      </div>

      {flash && (
        <div className="rounded-xl bg-teal-50 px-4 py-2.5 text-sm text-teal-900 ring-1 ring-inset ring-teal-200" role="status">{flash}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{mv.received || 'Stock in'}</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">{money(summary.inValue, currency)}</div>
          <div className="text-xs text-zinc-500">{summary.inCount} · {summary.inUnits} units</div>
        </div>
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{mv.consumed || 'Stock out'}</div>
          <div className="mt-1 text-2xl font-semibold text-rose-600">{money(summary.outValue, currency)}</div>
          <div className="text-xs text-zinc-500">{summary.outCount} · {summary.outUnits} units</div>
        </div>
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{mv.totalMovements || 'Net movement'}</div>
          <div className={`mt-1 text-2xl font-semibold ${summary.netValue >= 0 ? 'text-zinc-900' : 'text-rose-600'}`}>{money(summary.netValue, currency)}</div>
          <div className="text-xs text-zinc-500">{bounds.label.toLowerCase()}</div>
        </div>
        <div className={`${cardCls} px-4 py-3`}>
          <div className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{mv.counted || 'Opened with'}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{money(summary.openingValue, currency)}</div>
          <div className="text-xs text-zinc-500">baseline</div>
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setRange(entry.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${range === entry.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className={inputCls} placeholder={mv.searchMovements || 'Filter by item…'} value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 200 }} />
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)} style={{ maxWidth: 190 }}>
              <option value="all">{mv.allTypes || 'Every reason'}</option>
              {MOVEMENT_KINDS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            <div className="flex gap-1">
              {VIEWS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setView(entry.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${view === entry.id ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
                >
                  <span data-i18n-tab={viewTranslations[entry.id] || entry.label} className="tab-i18n-label">
                    <span className="sr-only">{entry.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === 'ledger' && (
          rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">Nothing moved in this window with that filter.</div>
          ) : (
            <div className="table-scroll">
              <table className="w-full min-w-[860px]">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className={thCls}>When</th>
                    <th className={thCls}>Item</th>
                    <th className={thCls}>Reason</th>
                    <th className={`${thCls} text-right`}>Qty</th>
                    <th className={`${thCls} text-right`}>Unit cost</th>
                    <th className={`${thCls} text-right`}>Value</th>
                    <th className={thCls}>Reference</th>
                    <th className={thCls}>By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.slice(0, 300).map((movement) => {
                    const meta = KIND_META[movement.kind] || { label: movement.kind, direction: 'in' }
                    return (
                      <tr key={movement.id} className={movement.baseline ? 'bg-zinc-50/70' : ''}>
                        <td className={`${tdCls} whitespace-nowrap text-xs text-zinc-500`}>
                          {new Date(movement.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className={tdCls}>
                          <div className="font-medium text-zinc-800">{movement.name}</div>
                          <div className="text-2xs text-zinc-500">{movement.unit}</div>
                        </td>
                        <td className={tdCls}>
                          <StatusPill tone={TONE_BY_KIND[movement.kind] || meta.tone || 'muted'} size="sm">
                            {movement.baseline ? `${meta.label} · baseline` : meta.label}
                          </StatusPill>
                        </td>
                        <td className={`${tdCls} text-right font-medium ${movement.qty < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                          {signed(movement.qty, 3)} {movement.unit}
                        </td>
                        <td className={`${tdCls} text-right`}>{money(movement.unitCost || 0, currency)}</td>
                        <td className={`${tdCls} text-right font-medium`}>{money(movement.value || 0, currency)}</td>
                        <td className={`${tdCls} text-xs text-zinc-500`}>{movement.ref || movement.note || '—'}</td>
                        <td className={`${tdCls} text-xs text-zinc-500`}>{movement.by || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.length > 300 && (
                <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
                  Showing the newest 300 of {rows.length} movements — narrow the range or filter by item.
                </div>
              )}
            </div>
          )
        )}

        {view === 'summary' && (
          flow.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">No stock movements in this window.</div>
          ) : (
            <div className="table-scroll">
              <table className="w-full min-w-[820px]">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className={thCls}>Item</th>
                    <th className={`${thCls} text-right`}>Opened</th>
                    <th className={`${thCls} text-right`}>In</th>
                    <th className={`${thCls} text-right`}>Out</th>
                    <th className={`${thCls} text-right`}>On hand</th>
                    <th className={`${thCls} text-right`}>In value</th>
                    <th className={`${thCls} text-right`}>Out value</th>
                    <th className={`${thCls} text-right`}>Book value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {flow.map((row) => (
                    <tr key={row.itemId}>
                      <td className={tdCls}>
                        <div className="font-medium text-zinc-800">{row.name}</div>
                        <div className="text-2xs text-zinc-500">{row.unit}</div>
                      </td>
                      <td className={`${tdCls} text-right text-zinc-500`}>{signed(row.opening, 3)}</td>
                      <td className={`${tdCls} text-right text-emerald-700`}>{signed(row.inQty, 3)}</td>
                      <td className={`${tdCls} text-right text-rose-600`}>{signed(-(row.outQty || 0), 3)}</td>
                      <td className={`${tdCls} text-right font-semibold text-zinc-900`}>{signed(row.onHand, 3)}</td>
                      <td className={`${tdCls} text-right`}>{money(row.inValue, currency)}</td>
                      <td className={`${tdCls} text-right`}>{money(row.outValue, currency)}</td>
                      <td className={`${tdCls} text-right`}>{money(row.bookValue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {view === 'kinds' && (
          <div className="table-scroll">
            <table className="w-full min-w-[720px]">
              <thead className="bg-zinc-50">
                <tr>
                  <th className={thCls}>Reason</th>
                  <th className={thCls}>Direction</th>
                  <th className={`${thCls} text-right`}>Movements</th>
                  <th className={`${thCls} text-right`}>Units</th>
                  <th className={`${thCls} text-right`}>In value</th>
                  <th className={`${thCls} text-right`}>Out value</th>
                  <th className={`${thCls} text-right`}>Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {kindRows.map((row) => {
                  const meta = KIND_META[row.kind] || {}
                  return (
                    <tr key={row.kind}>
                      <td className={tdCls}>
                        <div className="font-medium text-zinc-800">{meta.label || row.kind}</div>
                        <div className="text-2xs text-zinc-500">{meta.blurb || ''}</div>
                      </td>
                      <td className={tdCls}>
                        <StatusPill tone={row.baseline ? 'muted' : TONE_BY_KIND[row.kind] || 'muted'} size="sm">
                          {row.baseline ? 'baseline' : meta.direction === 'out' ? 'out' : 'in'}
                        </StatusPill>
                      </td>
                      <td className={`${tdCls} text-right`}>{row.count}</td>
                      <td className={`${tdCls} text-right`}>{signed(row.units, 3)}</td>
                      <td className={`${tdCls} text-right`}>{money(row.inValue, currency)}</td>
                      <td className={`${tdCls} text-right`}>{money(row.outValue, currency)}</td>
                      <td className={`${tdCls} text-right font-medium`}>{money(row.value, currency)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
              Baseline rows are what the book opened with — they are excluded from the in/out legs so a report never counts opening stock as money spent.
            </div>
          </div>
        )}
      </div>

      {counting && (
        <CountStockModal
          onClose={() => setCounting(false)}
          onSave={(counts) => {
            dispatch({ type: 'COUNT_STOCK', counts, by: role })
            setCounting(false)
            setFlash(`${Object.keys(counts).length} count correction(s) booked.`)
          }}
        />
      )}

      {wasting && (
        <WasteModal
          onClose={() => setWasting(false)}
          onSave={(form) => {
            dispatch({ type: 'LOG_WASTE', ...form, by: role })
            setWasting(false)
            setFlash(`Waste booked for ${form.qty} unit(s).`)
          }}
        />
      )}
    </div>
  )
}
