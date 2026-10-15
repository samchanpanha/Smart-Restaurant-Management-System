import StatusPill from '../../../components/StatusPill'
import { translateCourse, translateDishName, translateModifier, useI18n } from '../../../lib/i18n'
import { formatClock, money } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { COURSES } from '../shared.js'

function HeldLine({ order, item }) {
  const { dispatch } = useRestora()
  const { state } = useRestora()
  const { lang } = useI18n()
  const menu = state.menu.find((m) => m.id === item.menuItemId)
  return (
    <li className="rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">
            {translateDishName(menu, lang)}
            {item.by === 'guest' && (
              <span className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-violet-300 ring-1 ring-inset ring-violet-500/40">
                QR{item.guest ? ` · ${item.guest}` : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="rounded bg-black/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide">{translateCourse(item.course, lang)}</span>
            {item.modifiers?.map((m) => (
              <span key={m.id} className="rounded bg-black/40 px-1.5 py-0.5">{translateModifier(m.value, lang)}</span>
            ))}
            {item.notes && <span className="italic">“{item.notes}”</span>}
          </div>
        </div>
        <span className="tnum shrink-0 text-sm font-bold text-zinc-200">{money((menu?.price ?? 0) * item.qty)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`Decrease ${menu?.name} quantity`}
            onClick={() => (item.qty <= 1
              ? dispatch({ type: 'REMOVE_ITEM', orderId: order.id, itemId: item.id })
              : dispatch({ type: 'UPDATE_ITEM', orderId: order.id, itemId: item.id, patch: { qty: item.qty - 1 } }))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-lg hover:bg-white/5"
          >
            −
          </button>
          <span className="tnum w-6 text-center text-sm font-bold" aria-live="polite">{item.qty}</span>
          <button
            type="button"
            aria-label={`Increase ${menu?.name} quantity`}
            onClick={() => dispatch({ type: 'UPDATE_ITEM', orderId: order.id, itemId: item.id, patch: { qty: item.qty + 1 } })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-lg hover:bg-white/5"
          >
            +
          </button>
          <select
            value={item.course}
            onChange={(e) => dispatch({ type: 'UPDATE_ITEM', orderId: order.id, itemId: item.id, patch: { course: e.target.value } })}
            className="ml-1 h-9 rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] px-2 text-xs"
            aria-label="Course"
          >
            {COURSES.map((c) => <option key={c.id} value={c.id}>{translateCourse(c.id, lang)}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'REMOVE_ITEM', orderId: order.id, itemId: item.id })}
          className="min-h-[36px] rounded-lg px-3 text-xs text-zinc-500 hover:bg-white/5 hover:text-red-300"
        >
          Remove
        </button>
      </div>
    </li>
  )
}

function FiredLine({ order, item, onComp, onVoid }) {
  const { state } = useRestora()
  const { lang } = useI18n()
  const menu = state.menu.find((m) => m.id === item.menuItemId)
  const bumped = item.status === 'bump'
  return (
    <li className={`rounded-xl p-3 ring-1 ring-inset ${item.voided ? 'bg-black/30 opacity-70 ring-[var(--color-ink-700)]' : 'bg-[var(--color-ink-800)] ring-[var(--color-ink-600)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${item.voided ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>
            {item.qty}× {translateDishName(menu, lang)}
            {item.by === 'guest' && (
              <span className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-violet-300 ring-1 ring-inset ring-violet-500/40">
                QR{item.guest ? ` · ${item.guest}` : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="rounded bg-black/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide">{translateCourse(item.course, lang)}</span>
            {item.modifiers?.map((m) => (
              <span key={m.id} className="rounded bg-black/40 px-1.5 py-0.5">{translateModifier(m.value, lang)}</span>
            ))}
            {item.firedAt && !item.voided && <span>fired {formatClock(item.firedAt)}</span>}
            {item.comped && <span className="text-amber-300">comped · {item.compReason}</span>}
            {item.voided && <span className="text-red-300">void · {item.voidReason}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!item.voided && !item.comped && (
            <StatusPill tone={bumped ? 'ok' : 'warn'} size="sm">
              {bumped ? 'Bumped' : 'Fired'}
            </StatusPill>
          )}
          {item.comped && !item.voided && <StatusPill tone="warn" size="sm">Comped</StatusPill>}
          <span className="tnum text-sm font-bold text-zinc-200">{money((menu?.price ?? 0) * item.qty)}</span>
        </div>
      </div>
      {!item.voided && !item.comped && !['paid', 'void'].includes(order.status) && (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => onComp(item)} className="min-h-[36px] flex-1 rounded-lg border border-[var(--color-ink-600)] text-xs text-zinc-300 hover:bg-white/5">
            Comp (reason)
          </button>
          <button type="button" onClick={() => onVoid(item)} className="min-h-[36px] flex-1 rounded-lg border border-red-500/40 text-xs text-red-300 hover:bg-red-500/10">
            Void (manager)
          </button>
        </div>
      )}
    </li>
  )
}


export { HeldLine, FiredLine }
