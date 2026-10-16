import { useState } from 'react'
import { Field, Modal, Stepper, btnPrimary, inputCls } from '../../../components/ui'
import { money } from '../../../lib/models'
import { courseLabel } from '../shared.js'

function ModifierModal({ item, course, onAdd, onClose }) {
  const [picks, setPicks] = useState({})
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')
  const required = (item.modifiers || []).filter((g) => g.required)
  const ready = required.every((g) => picks[g.id])

  return (
    <Modal title={item.name} sub={`${money(item.price)} · pick required modifiers`} onClose={onClose}>
      <div className="mt-3 space-y-4">
        {(item.modifiers || []).map((g) => (
          <Field key={g.id} label={`${g.label}${g.required ? ' · required' : ''}`}>
            <div className="flex flex-wrap gap-2">
              {g.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  data-testid="modifier-option"
                  onClick={() => setPicks((p) => ({ ...p, [g.id]: opt }))}
                  className={`min-h-[44px] rounded-lg px-3.5 text-sm font-semibold ring-1 ring-inset transition-colors ${
                    picks[g.id] === opt
                      ? 'bg-amber-500 text-black ring-amber-500'
                      : 'bg-[var(--color-ink-800)] text-zinc-200 ring-[var(--color-ink-600)] hover:bg-white/5'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </Field>
        ))}
        <div className="flex items-end justify-between gap-4">
          <Field label="Qty">
            <Stepper value={qty} onChange={setQty} max={12} />
          </Field>
          <span className="pb-3 text-xs text-zinc-500">
            Course: <strong className="text-zinc-200">{courseLabel(course)}</strong>
          </span>
        </div>
        <Field label="Note (optional)">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergy, extra sauce…" className={inputCls} maxLength={80} />
        </Field>
        <button
          type="button"
          data-testid="modifier-add"
          disabled={!ready}
          onClick={() =>
            onAdd({
              modifiers: Object.entries(picks).map(([id, value]) => ({ id, value })),
              qty,
              notes,
            })
          }
          className={btnPrimary}
        >
          {ready ? `Add ${qty} × ${item.name}` : 'Pick required modifiers to add'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Composer ───────────────────────────────────────────────────


export { ModifierModal }
