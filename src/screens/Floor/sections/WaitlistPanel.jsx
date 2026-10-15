import { useMemo, useState } from 'react'
import { Field, Stepper, inputCls } from '../../../components/ui'
import { translateTableName, useI18n } from '../../../lib/i18n'
import { minutesBetween } from '../../../lib/models'
import { quoteWait, useRestora } from '../../../lib/store'

function WaitlistPanel({ onSeatWl, onError }) {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [party, setParty] = useState(2)

  // Next free table prediction: earliest (avgTurn − elapsed) across occupied
  const nextFree = useMemo(() => {
    const occupied = state.tables.filter(
      (t) => (t.status === 'seated' || t.status === 'ordered') && t.seatedAt,
    )
    if (!occupied.length) return { mins: 0, table: null }
    let best = null
    for (const t of occupied) {
      const avg = quoteWait(state, t.partySize || t.seats)
      const remain = Math.max(0, avg - minutesBetween(t.seatedAt))
      if (!best || remain < best.mins) best = { mins: remain, table: t }
    }
    return best
  }, [state])

  const quoted = quoteWait(state, party)

  function add() {
    if (!name.trim()) {
      onError('Waitlist entry needs a name.')
      return
    }
    dispatch({
      type: 'ADD_WAITLIST',
      entry: { name: name.trim(), partySize: party, quotedWaitMin: quoted },
    })
    setAdding(false)
    setName('')
    setParty(2)
  }

  return (
    <section className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
          {f.waitlist || 'Waitlist'} · {state.waitlist.length}
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="min-h-[44px] rounded-lg border border-[var(--color-ink-600)] px-3 text-sm text-zinc-200 hover:bg-white/5"
        >
          {adding ? (f.cancel || 'Cancel') : (lang === 'km' ? '+ ភ្ញៀវមកផ្ទាល់' : lang === 'zh' ? '+ 现场候位' : '+ Walk-in')}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-zinc-500">
        {nextFree.table
          ? <>Next free: <strong className="text-zinc-300">{translateTableName(nextFree.table.name, lang)}</strong> in ~{nextFree.mins}m (from today&apos;s turns)</>
          : 'Floor is clear — seat straight away.'}
      </p>

      {adding && (
        <div className="mt-3 space-y-3 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <Field label={f.guestName || 'Name'}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Walk-in · Kim" className={inputCls} maxLength={40} />
          </Field>
          <Field label={f.partySize || 'Party'}>
            <Stepper value={party} onChange={setParty} />
          </Field>
          <div className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-200 ring-1 ring-inset ring-sky-500/30">
            Honest quote: <strong>~{quoted} min</strong> — today&apos;s average turn for a party of {party}.
          </div>
          <button
            type="button"
            onClick={add}
            className="min-h-[44px] w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
          >
            {f.addWaitlist || 'Add to waitlist'}
          </button>
        </div>
      )}

      <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
        {state.waitlist.length === 0 && <li className="text-sm text-zinc-500">{f.noWaitlist || 'Nobody waiting.'}</li>}
        {state.waitlist.map((w) => (
          <li key={w.id} className="rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-zinc-100">{w.name}</div>
                <div className="text-xs text-zinc-400">
                  {f.partySize || 'Party'} · {w.partySize} · ~{w.quotedWaitMin}m · {minutesBetween(w.addedAt)}m
                </div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onSeatWl(w)}
                className="min-h-[44px] flex-1 rounded-lg bg-amber-500/90 px-2 py-1.5 text-xs font-bold text-black hover:bg-amber-400"
              >
                {f.seat || 'Seat'}
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'REMOVE_WAITLIST', id: w.id })}
                className="min-h-[44px] flex-1 rounded-lg border border-[var(--color-ink-600)] px-2 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
              >
                {f.remove || 'Remove'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}


export { WaitlistPanel }
