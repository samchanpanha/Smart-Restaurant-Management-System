import { useState } from 'react'
import StatusPill from '../../../components/StatusPill'
import { CURRENCIES, ROUNDING_RULES, currencyMeta, formatMoney, normalizeCurrencyEntry } from '../../../lib/currency'
import { money } from '../../../lib/models'
import { Field, Toggle, Card, inputCls } from '../primitives'
import { useConfirm } from '../../../components/ui/confirm-context'

function MoneySection({ draft, patch, dispatch, settings, state, locationLabel }) {
  const confirm = useConfirm()
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
            onClick={async () => {
              const confirmed = await confirm({
                title: `Re-base the ledger on ${draft.baseCurrency}?`,
                body: 'Every rate is recomputed relative to it. Catalog prices stay as entered — use "Revalue the catalog" separately if the numbers themselves must change.',
                confirmLabel: 'Re-base the ledger',
              })
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
  const confirm = useConfirm()
  const [factor, setFactor] = useState('')
  const [armed, setArmed] = useState(false)
  const [info, setInfo] = useState('')
  const value = Number(factor)
  const valid = Number.isFinite(value) && value > 0 && value <= 1000 && value !== 1
  const and = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })

  const sample = state.menu.slice(0, 3)
  const stockValueNow = state.inventory.filter((item) => item.counted !== false).reduce((sum, item) => sum + Math.max(0, item.onHand) * (item.lastCost || 0), 0)

  async function apply() {
    const confirmed = await confirm({
      title: `Revalue the catalog by ×${value}?`,
      body: `${state.menu.length} menu prices and ${state.inventory.length} stock costs on ${locationLabel} change. This is not a conversion — use it when the numbers themselves change (new price list, re-denomination, bulk inflation).`,
      confirmLabel: 'Revalue the catalog',
      tone: 'danger',
    })
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

export { MoneySection }
