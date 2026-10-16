// ─── The toast context ────────────────────────────────────────────────
// Kept apart from the component so the provider file only exports
// components, and so a screen can raise a message without importing a
// piece of UI it does not otherwise need.

import { createContext, useContext } from 'react'

export const ToastContext = createContext(null)

/**
 * Raise a message for the operator.
 *
 * Outside a ToastProvider this is a no-op, so a screen rendered on its own
 * (a test, a print view) never crashes on a missing notification.
 */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) return { notify: () => {}, dismiss: () => {} }
  return ctx
}
