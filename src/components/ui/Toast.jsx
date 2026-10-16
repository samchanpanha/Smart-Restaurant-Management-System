// ─── Toasts ──────────────────────────────────────────────────────────
// One quiet place for the app to say "that worked" or "that did not".
// Native alert() blocks the whole terminal and looks like a bug on a
// tablet; a toast sits in the corner, is readable at a glance, and does
// not interrupt the shift.
//
// The wording stays in the screen that raises it (these are staff-facing
// screens), which is the same rule the rest of the app follows: the
// customer surfaces translate, the back office speaks plainly.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { ToastContext } from './toast-context'

const TONES = {
  info: { bar: 'bg-zinc-400', icon: 'message' },
  success: { bar: 'bg-emerald-500', icon: 'check' },
  warning: { bar: 'bg-amber-500', icon: 'warning' },
  error: { bar: 'bg-red-500', icon: 'warning' },
}

const LIFETIME = 4500

let counter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback(
    (message, tone = 'info') => {
      if (!message) return
      counter += 1
      const id = `toast_${counter}`
      setToasts((list) => [...list.slice(-3), { id, message: String(message), tone }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME),
      )
    },
    [dismiss],
  )

  // Timers outlive the screen if it unmounts mid-message.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ notify, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const tone = TONES[toast.tone] || TONES.info
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl bg-zinc-900 py-3 pr-3 pl-4 text-sm text-zinc-100 shadow-xl shadow-black/20"
            >
              <span className={`mt-0.5 h-8 w-1 shrink-0 rounded-full ${tone.bar}`} aria-hidden="true" />
              <Icon name={tone.icon} size={16} className="mt-0.5 shrink-0 text-zinc-400" />
              <p className="min-w-0 flex-1 leading-snug font-medium">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-mr-1 rounded-lg px-1.5 py-0.5 text-base leading-none text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
