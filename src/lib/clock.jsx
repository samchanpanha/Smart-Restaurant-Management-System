// ─── Shared clock ────────────────────────────────────────────────────
// One master interval drives every "how long ago / live for 12:00" readout
// in the app. Each `useNow(intervalMs)` subscriber still re-renders on its
// own cadence (1s on the kitchen board, 30s in the sidebar) but they all
// share a single timer instead of one setInterval per widget.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

const ClockContext = createContext(null)

// The master tick. 200ms keeps the 250ms undo countdown smooth while costing
// nothing on a tablet — subscribers only notify when their own interval elapses.
const BASE_MS = 200

export function ClockProvider({ children }) {
  const subscribersRef = useRef(new Set())
  const nowRef = useRef(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now()
      nowRef.current = at
      for (const sub of subscribersRef.current) {
        if (at - sub.last >= sub.interval) {
          sub.last = at
          sub.notify(at)
        }
      }
    }, BASE_MS)
    return () => clearInterval(timer)
  }, [])

  const api = useMemo(
    () => ({
      now: () => nowRef.current,
      subscribe(notify, interval) {
        const sub = { notify, interval: Math.max(1, interval), last: Date.now() }
        subscribersRef.current.add(sub)
        return () => subscribersRef.current.delete(sub)
      },
    }),
    [],
  )

  return <ClockContext.Provider value={api}>{children}</ClockContext.Provider>
}

/**
 * Re-renders the calling component roughly every `intervalMs`, reading the
 * shared clock. Falls back to a private interval when no ClockProvider is
 * mounted (unit tests render components in isolation).
 */
export function useNow(intervalMs = 1000) {
  const clock = useContext(ClockContext)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!clock) {
      const timer = setInterval(() => setNow(Date.now()), intervalMs)
      return () => clearInterval(timer)
    }
    setNow(clock.now())
    return clock.subscribe(setNow, intervalMs)
  }, [clock, intervalMs])

  return now
}
