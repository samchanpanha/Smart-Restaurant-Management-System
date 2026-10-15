import { translateTableName, translateZone } from '../../../lib/i18n'
import { isFreeTableStatus, isTableInServiceStatus } from '../../../lib/constants'
import { TABLE_TAG } from '../shared.js'

function TablePicker({ tables, pickedId, waitMin, lang, onChoose, onClose }) {
  const free = tables.filter((t) => isFreeTableStatus(t.status)).length
  const zones = [...new Set(tables.map((t) => t.zone || 'Main'))]
  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4" data-testid="table-picker">
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-stone-900">Choose a table</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="min-h-[40px] rounded-full px-3 text-sm font-bold text-stone-500">
              Close
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-500" role="status">
          {free > 0 ? `${free} of ${tables.length} tables free — tap one to sit down` : 'Every table is taken right now'}
          {free <= 2 && ` · ~${waitMin} min wait`}
          {lang !== 'en' && (
            <span className="sr-only">
              {' '}
              {free > 0 ? `${free} of ${tables.length} tables free — tap one to sit down` : 'Every table is taken right now'}
            </span>
          )}
        </p>

        {zones.map((zone) => (
          <div key={zone} className="mt-4">
            <div className="text-2xs font-bold uppercase tracking-widest text-stone-400">{translateZone(zone, lang)}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {tables.filter((t) => (t.zone || 'Main') === zone).map((t) => {
                const open = isFreeTableStatus(t.status)
                const inService = isTableInServiceStatus(t.status)
                const active = t.id === pickedId
                const tone = open
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                  : inService
                    ? (active ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50')
                    : 'border-stone-100 bg-stone-50 text-stone-400'
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!open && !inService}
                    onClick={() => onChoose(t)}
                    aria-label={open ? `Sit at ${t.name}` : inService ? `Join ${t.name}` : `${t.name} ${t.status}`}
                    className={`flex min-h-[56px] flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left ${tone}`}
                  >
                    <span className="text-sm font-extrabold">{translateTableName(t.name, lang)}</span>
                    <span className="text-2xs font-semibold opacity-80">
                      {open ? TABLE_TAG.free : inService && active ? 'Your table' : TABLE_TAG[t.status] || t.status}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export { TablePicker }
