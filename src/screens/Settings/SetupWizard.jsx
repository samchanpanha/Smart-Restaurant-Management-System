// ─── First-run setup wizard ─────────────────────────────────────────
// A guided pass over the sections a brand-new store must fill in before
// it can print honest documents: identity, money, numbering, stock
// policy, the menu vocabulary, and POS rules. It edits the same draft as
// the main screen (one UPDATE_SETTINGS on finish), so it is never a
// second source of truth — just a friendlier order to fill the first one.

import { useEffect, useRef } from 'react'
import { Icon } from '../../components/Icon'

export function SetupWizard({ open, step, steps, labels, audit, ready, dirty, onStep, onClose, onFinish, renderSection }) {
  const panelRef = useRef(null)
  useEffect(() => {
    if (open) panelRef.current?.focus?.()
  }, [open, step])
  if (!open) return null
  const current = steps[step]
  const last = step === steps.length - 1
  const doneChecks = audit.checks.filter((check) => check.ok).length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 backdrop-blur-sm" data-testid="setup-wizard">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Store setup wizard"
        tabIndex={-1}
        ref={panelRef}
        className="my-6 w-full max-w-3xl rounded-3xl border border-zinc-200 bg-white shadow-xl outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-orange-600">
              <Icon name="settings" size={14} />
              {ready ? 'Guided setup' : 'Finish setting up your store'}
            </div>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-900">Store setup wizard</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {doneChecks}/{audit.total} checks ready · nothing is published until you finish
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup wizard"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
          >
            ×
          </button>
        </header>

        <div className="grid gap-4 p-5 md:grid-cols-[200px_1fr]">
          <ol className="space-y-1 self-start" aria-label="Setup steps">
            {steps.map((entry, index) => {
              const active = index === step
              const complete = index < step
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onStep(index)}
                    aria-current={active}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition ${active ? 'bg-orange-50 font-semibold text-orange-700 ring-1 ring-inset ring-orange-200' : 'text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-emerald-500 text-white' : active ? 'bg-orange-500 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                      {complete ? '✓' : index + 1}
                    </span>
                    <span className="min-w-0 truncate">{labels[entry.id] || entry.label}</span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="min-w-0">
            <p className="mb-3 text-xs text-zinc-500">{current.blurb}</p>
            <div className="max-h-[52vh] overflow-y-auto pr-1">{renderSection(current.id)}</div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 p-5">
          <span className="text-xs text-zinc-500">
            {dirty ? 'Unsaved edits — finish to publish' : 'No edits yet in this pass'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
            >
              Back
            </button>
            {last ? (
              <button
                type="button"
                onClick={onFinish}
                className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600"
              >
                Finish setup
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStep(step + 1)}
                className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600"
              >
                Next
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
