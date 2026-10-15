import StatusPill from '../../../components/StatusPill'
import { REORDER_POLICIES, STORAGE_LOCATIONS, VALUATION_METHODS } from '../../../lib/settings'
import { Field, Toggle, Card, inputCls } from '../primitives'
import { UnitsCard } from './Units'

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


export { StockSection }
