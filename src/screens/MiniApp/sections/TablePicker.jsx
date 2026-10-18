// ─── The one table picker ─────────────────────────────────────────────
// Used from the header switcher and from the welcome card's "Sit now".
// A free table seats the party in a single tap (the claim is the seat —
// no second confirmation sheet); a table already in service is treated
// as "join this table" and simply becomes the active menu. The party
// size chosen here travels with the claim.

import { useState } from 'react'
import { translateTableName, translateZone, useI18n } from '../../../lib/i18n'
import { isFreeTableStatus, isTableInServiceStatus } from '../../../lib/constants'
import { TABLE_TAG } from '../shared.js'

const PARTY_SIZES = [1, 2, 3, 4, 6, 8]
// One focus recipe for every control the guest can tap.
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2'

function TablePicker({ tables, pickedId, waitMin, lang, partySize, onPartySize, onChoose, onClose }) {
  const { dict } = useI18n()
  const copy = dict.miniapp || {}
  const [zone, setZone] = useState('All')
  const free = tables.filter((table) => isFreeTableStatus(table.status)).length
  const zones = ['All', ...new Set(tables.map((table) => table.zone || 'Main'))]
  const visible = tables.filter((table) => zone === 'All' || (table.zone || 'Main') === zone)
  const showWait = free > 0 && free <= 2

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4" data-testid="table-picker">
      <div className="rounded-[var(--radius-xl)] border border-black/5 bg-[var(--guest-surface)] p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">
              {copy.stepTwo || 'Step 2 · Pick a table'}
            </p>
            <h2 className="mt-1 text-lg font-extrabold text-[var(--guest-ink)]">Choose a table</h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`min-h-11 rounded-full px-3 text-sm font-semibold text-stone-500 transition-colors hover:bg-stone-100 ${FOCUS}`}
            >
              Close
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-500" role="status">
          {free > 0
            ? (copy.tablesFree
              ? copy.tablesFree(free, tables.length)
              : `${free} of ${tables.length} tables free — tap one to sit down`)
            : 'Every table is taken right now'}
          {lang !== 'en' && (
            <span className="sr-only">
              {free > 0
                ? `${free} of ${tables.length} tables free — tap one to sit down`
                : 'Every table is taken right now'}
            </span>
          )}
          {showWait && (
            <span className="ml-1">
              · {copy.waitMin ? copy.waitMin(waitMin) : `~${waitMin} min wait`}
            </span>
          )}
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-stone-400">
            Party size
          </span>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {PARTY_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onPartySize?.(size)}
                aria-pressed={partySize === size}
                className={`min-h-11 min-w-11 shrink-0 rounded-full border px-2 text-xs font-bold transition-colors ${FOCUS} ${
                  partySize === size
                    ? 'border-[var(--guest-accent)] bg-[var(--guest-accent)] text-[var(--guest-ink)]'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                }`}
              >
                {size}{size === 8 ? '+' : ''}
              </button>
            ))}
          </div>
        </div>

        {zones.length > 2 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
            {zones.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setZone(name)}
                aria-pressed={zone === name}
                className={`min-h-11 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition-colors ${FOCUS} ${
                  zone === name
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                }`}
              >
                {name === 'All' ? 'All' : translateZone(name, lang)}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {visible.map((table) => {
            const open = isFreeTableStatus(table.status)
            const inService = isTableInServiceStatus(table.status)
            const active = table.id === pickedId
            const seats = Number(table.capacity || table.seats) || 4
            return (
              <button
                key={table.id}
                type="button"
                disabled={!open && !inService}
                onClick={() => onChoose(table)}
                aria-label={open ? `Sit at ${table.name}` : inService ? `Join ${table.name}` : `${table.name} ${table.status}`}
                aria-pressed={active}
                className={`flex min-h-[64px] flex-col items-start justify-center rounded-[var(--radius-lg)] border px-3 py-2 text-left transition-colors ${FOCUS} ${
                  open
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                    : inService
                      ? 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                      : 'border-stone-100 bg-stone-50 text-stone-400'
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-extrabold">{translateTableName(table.name, lang)}</span>
                  <span className="shrink-0 text-[10px] font-semibold opacity-70">
                    {copy.seats ? copy.seats(seats) : `${seats} seats`}
                  </span>
                </span>
                <span className={`mt-0.5 text-[11px] font-semibold ${open ? 'text-emerald-700' : ''}`}>
                  {open
                    ? TABLE_TAG.free
                    : inService && active
                      ? 'Your table'
                      : TABLE_TAG[table.status] || table.status}
                </span>
              </button>
            )
          })}
        </div>

        {visible.length === 0 && (
          <p className="mt-4 rounded-[var(--radius-lg)] bg-stone-50 px-3 py-3 text-xs text-stone-500">
            No table matches this filter.
          </p>
        )}
      </div>
    </div>
  )
}

export { TablePicker }
