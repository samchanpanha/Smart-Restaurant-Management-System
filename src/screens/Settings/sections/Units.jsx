import { useState } from 'react'
import { DEFAULT_UNITS, UNIT_FAMILIES, itemUnitChoices, slugUnitId } from '../../../lib/units'
import { Field, Toggle, Card, LabelListEditor, inputCls } from '../primitives'

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
      <div className="table-scroll">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-3xs uppercase tracking-wider text-zinc-400">
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
      <p className="mt-2 text-2xs text-zinc-500">
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


export { UnitsCard }
