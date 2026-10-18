import { useState } from 'react'
import { Button, Field, Input, Stepper } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
import { translateTableName, useI18n } from '../../../lib/i18n'
import { minutesBetween } from '../../../lib/models'
import { quoteWait, useRestora } from '../../../lib/store'
import { nextFreeTable } from '../shared.js'

// The waitlist, list only — the tab strip, count and card live in HostDesk.
function WaitlistPanel({ onSeatWl, onError }) {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [party, setParty] = useState(2)

  const nextFree = nextFreeTable(state)
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
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[var(--fs-caption)] text-[var(--text-muted)]">
          <Icon name="clock" size={12} />
          {nextFree?.table ? (
            <>
              Next free: <strong className="text-[var(--text)]">{translateTableName(nextFree.table.name, lang)}</strong> in ~{nextFree.mins}m
            </>
          ) : (
            'Floor is clear — seat straight away.'
          )}
        </p>
        <Button size="sm" variant={adding ? 'secondary' : 'primary'} onClick={() => setAdding((value) => !value)}>
          {adding
            ? (f.cancel || 'Cancel')
            : (lang === 'km' ? '+ ភ្ញៀវមកផ្ទាល់' : lang === 'zh' ? '+ 现场候位' : '+ Walk-in')}
          {lang !== 'en' && <span className="sr-only"> {adding ? 'Cancel' : '+ Walk-in'}</span>}
        </Button>
      </div>

      {adding && (
        <div className="mb-3 space-y-3 rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
          <Field label={f.guestName || 'Guest name'}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Walk-in · Kim" maxLength={40} />
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

      <ul className="max-h-72 space-y-2 overflow-y-auto">
        {state.waitlist.length === 0 && (
          <li className="rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] px-4 py-6 text-center text-[var(--fs-body)] text-[var(--text-muted)]">
            {f.noWaitlist || 'Nobody waiting.'}
          </li>
        )}
        {state.waitlist.map((entry) => (
          <li key={entry.id} className="rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-3 ring-1 ring-inset ring-[var(--border-subtle)]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[var(--fs-body)] font-semibold text-[var(--text-strong)]">{entry.name}</div>
                <div className="tnum text-[var(--fs-label)] text-[var(--text-muted)]">
                  {f.partySize || 'Party'} · {entry.partySize} · ~{entry.quotedWaitMin}m · waiting {minutesBetween(entry.addedAt)}m
                </div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => onSeatWl(entry)}>
                {f.seat || 'Seat'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => dispatch({ type: 'REMOVE_WAITLIST', id: entry.id })}
              >
                {f.remove || 'Remove'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export { WaitlistPanel }
