// ─── AI availability ────────────────────────────────────────────────
// The dashboard only shows AI widgets when the server actually has a key.
// This runs once per mount and degrades to { configured: false } when the
// server has no AI route, is unreachable, or fetch is unavailable (jsdom
// tests). It never throws and never blocks the dashboard.

import { useEffect, useState } from 'react'
import { aiStatus } from '../../lib/ai-client'

export function useAiStatus() {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let alive = true
    aiStatus().then((next) => {
      if (alive) setStatus(next || { configured: false })
    })
    return () => { alive = false }
  }, [])
  return status
}
