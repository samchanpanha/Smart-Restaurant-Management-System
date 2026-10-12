// ─── Shared operational UI ──────────────────────────────────────────
// Big tap targets (44px), short labels, no decoration on Live screens.

export const inputCls =
  'w-full rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-800)] px-3 py-2.5 text-sm text-zinc-100 min-h-[44px]'

export const btnPrimary =
  'w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 min-h-[44px]'

export const btnGhost =
  'w-full rounded-lg border border-[var(--color-ink-600)] py-2.5 text-sm font-semibold text-zinc-200 hover:bg-white/5 min-h-[44px] transition-colors'

export function Modal({ title, sub, onClose, children, wide }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`max-h-[92vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-2xl border border-[var(--color-ink-600)] bg-[var(--color-ink-900)] p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  )
}

export function Stepper({ value, onChange, min = 1, max = 12 }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-xl text-zinc-200 hover:bg-white/5"
      >
        −
      </button>
      <div className="tnum min-w-14 text-center text-2xl font-bold" aria-live="polite">
        {value}
      </div>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-ink-600)] text-xl text-zinc-200 hover:bg-white/5"
      >
        +
      </button>
    </div>
  )
}
