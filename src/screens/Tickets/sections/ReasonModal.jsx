import { useState } from 'react'
import { Field, Modal, btnPrimary, inputCls } from '../../../components/ui'

const QUICK_REASONS = ['Kitchen error', 'Guest unhappy', 'Long wait', 'Manager comp']

function ReasonModal({ title, sub, manager = false, confirmLabel, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [mgr, setMgr] = useState(false)
  const ok = reason.trim().length > 0 && (!manager || mgr)
  return (
    <Modal title={title} sub={sub} onClose={onClose}>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`min-h-[44px] rounded-lg px-3 text-xs font-semibold ring-1 ring-inset ${
                reason === r ? 'bg-white/10 text-zinc-100 ring-white/30' : 'text-zinc-400 ring-[var(--color-ink-600)] hover:bg-white/5'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <Field label="Reason (required)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" className={inputCls} maxLength={80} />
        </Field>
        {manager && (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl bg-red-500/10 px-3 text-sm text-red-200 ring-1 ring-inset ring-red-500/40">
            <input type="checkbox" checked={mgr} onChange={(e) => setMgr(e.target.checked)} className="h-5 w-5 accent-red-500" />
            Manager override — I approve this void
          </label>
        )}
        <button type="button" disabled={!ok} onClick={() => onConfirm(reason.trim())} className={btnPrimary}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

// ─── Pay modal ──────────────────────────────────────────────────


export { ReasonModal }
