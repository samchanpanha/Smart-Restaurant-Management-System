import { useNow, useRestora } from '../../../lib/store'

function UndoBanner({ orderId }) {
  const { state, dispatch } = useRestora()
  const now = useNow(250)
  const pu = state.pendingUndo
  if (!pu || pu.orderId !== orderId) return null
  const left = Math.max(0, Math.ceil((pu.expiresAt - now) / 1000))
  if (left <= 0) return null
  return (
    <div
      className="animate-status-in flex items-center justify-between gap-3 rounded-xl bg-sky-500/10 px-4 py-2.5 ring-1 ring-inset ring-sky-500/40"
      role="alert"
    >
      <div className="text-sm text-sky-200">
        Sent to kitchen — <strong>undo for {left}s</strong>, then the kitchen owns it.
      </div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'UNDO_SEND', orderId })}
        className="min-h-[44px] shrink-0 rounded-lg bg-sky-500 px-4 text-sm font-bold text-white hover:bg-sky-600"
      >
        Undo send
      </button>
    </div>
  )
}

// ─── Ticket list ────────────────────────────────────────────────


export { UndoBanner }
