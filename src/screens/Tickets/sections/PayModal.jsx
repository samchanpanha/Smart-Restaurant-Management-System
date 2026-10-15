import { useMemo, useState } from 'react'
import { Field, Modal, Stepper, btnPrimary } from '../../../components/ui'
import { money, orderTotals } from '../../../lib/models'
import { useRestora } from '../../../lib/store'

function PayModal({ order, onClose }) {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const t = orderTotals(order, menuById, state.settings.taxPct)
  const [method, setMethod] = useState('card')
  const [split, setSplit] = useState('full')
  const [ways, setWays] = useState(2)
  const [seats, setSeats] = useState(2)
  const [curSeat, setCurSeat] = useState(0)
  const [assign, setAssign] = useState({}) // itemId -> seat idx

  const seatNames = useMemo(() => Array.from({ length: seats }, (_, i) => `Seat ${String.fromCharCode(65 + i)}`), [seats])
  const unassigned = t.lines.filter((l) => assign[l.id] == null || assign[l.id] >= seats)
  const seatTotals = useMemo(() => {
    const subs = Array.from({ length: seats }, () => 0)
    for (const l of t.lines) {
      const s = assign[l.id]
      if (s != null && s < seats) subs[s] += l.lineTotal
    }
    return subs.map((sub) => ({ sub, tax: sub * state.settings.taxPct, total: sub * (1 + state.settings.taxPct) }))
  }, [t.lines, assign, seats, state.settings.taxPct])

  const canClose = split !== 'byitem' || unassigned.length === 0

  function close() {
    const summary =
      split === 'full'
        ? { kind: 'full' }
        : split === 'even'
          ? { kind: 'even', ways, each: Math.round((t.total / ways) * 100) / 100 }
          : { kind: 'byitem', seats, totals: seatTotals.map((s) => Math.round(s.total * 100) / 100) }
    dispatch({ type: 'PAY_ORDER', orderId: order.id, method, split: summary })
    onClose()
  }

  return (
    <Modal title="Close check" sub={`${order.items.length} lines · tax ${(state.settings.taxPct * 100).toFixed(2)}%`} onClose={onClose} wide>
      <ul className="mt-3 max-h-44 space-y-1 overflow-y-auto text-sm">
        {t.lines.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              disabled={split !== 'byitem'}
              onClick={() => setAssign((a) => ({ ...a, [l.id]: curSeat }))}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 ${
                split === 'byitem' ? 'hover:bg-white/5 ring-1 ring-inset ring-transparent hover:ring-[var(--color-ink-600)]' : ''
              }`}
            >
              <span className="text-zinc-200">
                {l.qty}× {l.name}
                {split === 'byitem' && (
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-3xs font-bold ${assign[l.id] != null && assign[l.id] < seats ? 'bg-sky-500/20 text-sky-300' : 'bg-red-500/15 text-red-300'}`}>
                    {assign[l.id] != null && assign[l.id] < seats ? seatNames[assign[l.id]] : 'tap to assign'}
                  </span>
                )}
              </span>
              <span className="tnum text-zinc-300">{money(l.lineTotal)}</span>
            </button>
          </li>
        ))}
        {order.items.filter((i) => i.comped && !i.voided).length > 0 && (
          <li className="px-2.5 py-1 text-xs text-zinc-500">
            Comped {money(t.compTotal)} — removed from bill, kept for audit.
          </li>
        )}
      </ul>

      <div className="mt-3 flex gap-1.5 rounded-xl bg-black/30 p-1.5" role="tablist" aria-label="Split mode">
        {[
          ['full', 'Pay full'],
          ['even', 'Split even'],
          ['byitem', 'Split by item'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={split === id}
            type="button"
            onClick={() => setSplit(id)}
            className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold ${split === id ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {split === 'even' && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <Field label="Split ways">
            <Stepper value={ways} onChange={setWays} min={2} max={8} />
          </Field>
          <div className="text-right">
            <div className="text-2xs uppercase tracking-widest text-zinc-500">each pays</div>
            <div className="tnum text-2xl font-bold text-amber-300">{money(t.total / ways)}</div>
          </div>
        </div>
      )}

      {split === 'byitem' && (
        <div className="mt-3 space-y-2 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <div className="flex items-center justify-between gap-3">
            <Field label="Seats">
              <Stepper value={seats} onChange={(v) => { setSeats(v); setCurSeat(0) }} min={2} max={6} />
            </Field>
            <div className="flex flex-wrap justify-end gap-1.5">
              {seatNames.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCurSeat(i)}
                  aria-pressed={curSeat === i}
                  className={`min-h-[44px] rounded-lg px-3 text-xs font-bold ring-1 ring-inset ${curSeat === i ? 'bg-sky-500 text-black ring-sky-500' : 'text-zinc-300 ring-[var(--color-ink-600)] hover:bg-white/5'}`}
                >
                  {n}
                  <span className="tnum ml-1 opacity-80">{money(seatTotals[i].total)}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Pick a seat, then tap lines above to assign. {unassigned.length > 0 ? <strong className="text-red-300">{unassigned.length} unassigned.</strong> : <strong className="text-emerald-300">All assigned.</strong>}
          </p>
        </div>
      )}

      <div className="mt-3 space-y-1 rounded-xl bg-[var(--color-ink-800)] p-3 text-sm ring-1 ring-inset ring-[var(--color-ink-600)]">
        <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span className="tnum">{money(t.subtotal)}</span></div>
        <div className="flex justify-between text-zinc-400"><span>Tax</span><span className="tnum">{money(t.tax)}</span></div>
        <div className="flex justify-between border-t border-white/10 pt-1.5 text-base font-bold"><span>Total due</span><span className="tnum text-amber-300">{money(t.total)}</span></div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Payment method">
        {['card', 'cash'].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            aria-pressed={method === m}
            className={`min-h-[44px] rounded-lg text-sm font-bold capitalize ring-1 ring-inset ${method === m ? 'bg-white/10 text-zinc-100 ring-white/30' : 'text-zinc-500 ring-[var(--color-ink-600)] hover:bg-white/5'}`}
          >
            {m}
          </button>
        ))}
      </div>

      <button type="button" disabled={!canClose || t.lines.length === 0} onClick={close} className={`${btnPrimary} mt-3`}>
        {t.lines.length === 0
          ? 'Nothing billable on this check'
          : canClose
            ? `Collect ${money(t.total)} · Close check`
            : `Assign all items to close (${unassigned.length} left)`}
      </button>
    </Modal>
  )
}

// ─── Ticket workspace ───────────────────────────────────────────


export { PayModal }
