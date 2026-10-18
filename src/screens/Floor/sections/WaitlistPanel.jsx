import { useMemo, useState } from 'react'
import { Button, Card, Field, Input, SectionHeader, Stepper } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
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
    <Card inset>
      <SectionHeader
        title={`${f.waitlist || 'Waitlist'} · ${state.waitlist.length}`}
        actions={(
          <Button size="sm" variant={adding ? 'secondary' : 'primary'} onClick={() => setAdding((v) => !v)}>
            {adding ? (f.cancel || 'Cancel') : (lang === 'km' ? '+ ភ្ញៀវមកផ្ទាល់' : lang === 'zh' ? '+ 现场候位' : '+ Walk-in')}
          </Button>
        )}
      />

      <p className="mb-3 flex items-center gap-1.5 text-[var(--fs-caption)] text-[var(--text-muted)]">
        <Icon name="clock" size={12} />
        {nextFree.table
          ? <>Next free: <strong className="text-[var(--text)]">{translateTableName(nextFree.table.name, lang)}</strong> in ~{nextFree.mins}m (from today&apos;s turns)</>
          : 'Floor is clear — seat straight away.'}
      </p>

      {adding && (
        <div className="mb-3 space-y-3 rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
          <Field label={f.guestName || 'Name'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Walk-in · Kim" maxLength={40} />
          </Field>
          <Field label={f.partySize || 'Party'}>
            <Stepper value={party} onChange={setParty} />
          </Field>
          <div className="rounded-[var(--radius-lg)] bg-[var(--info-soft)] px-3 py-2 text-[var(--fs-label)] text-[var(--info)] ring-1 ring-inset ring-[var(--info)]/30">
            Honest quote: <strong>~{quoted} min</strong> — today&apos;s average turn for a party of {party}.
          </div>
          <Button block onClick={add}>
            {f.addWaitlist || 'Add to waitlist'}
          </Button>
        </div>
      )}

      <ul className="max-h-56 space-y-2 overflow-y-auto">
        {state.waitlist.length === 0 && <li className="text-[var(--fs-body)] text-[var(--text-muted)]">{f.noWaitlist || 'Nobody waiting.'}</li>}
        {state.waitlist.map((w) => (
          <li key={w.id} className="rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[var(--fs-body)] font-semibold text-[var(--text-strong)]">{w.name}</div>
                <div className="text-[var(--fs-label)] text-[var(--text-muted)]">
                  {f.partySize || 'Party'} · {w.partySize} · ~{w.quotedWaitMin}m · {minutesBetween(w.addedAt)}m
                </div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => onSeatWl(w)}>
                {f.seat || 'Seat'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => dispatch({ type: 'REMOVE_WAITLIST', id: w.id })}
              >
                {f.remove || 'Remove'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}


export { WaitlistPanel }
