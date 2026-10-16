// ─── The confirm context ──────────────────────────────────────────────
// Kept apart from the component so the provider file only exports
// components, and so a screen can ask a question without importing a
// piece of UI it does not otherwise need.

import { createContext, useContext } from 'react'

export const ConfirmContext = createContext(null)

/**
 * Ask the operator to confirm something that cannot be undone.
 *
 * Returns a promise that resolves to true when they agree. Outside a
 * ConfirmProvider it resolves to false, so a screen rendered on its own
 * never acts without an answer.
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) return async () => false
  return ctx
}
