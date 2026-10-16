// ─── AI shift briefing ──────────────────────────────────────────────
// A short manager hand-off: open-of-day or close-of-shift, generated from the
// live digest and cached server-side per context hash. `deliver` pushes the
// same text through the existing Telegram notifier. Read-only — it never
// dispatches an action.

import { useState } from 'react'
import { Badge, Button, Card, SectionHeader, Skeleton } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
import { aiBriefing } from '../../../lib/ai-client'
import { cn } from '../../../lib/cn'

export default function ShiftBriefing({ copy, configured, lang, locId, provider = '' }) {
  const [phase, setPhase] = useState('open')
  const [state, setState] = useState({ loading: false, reply: '', error: '', delivered: false })

  async function run(shouldDeliver = false) {
    if (state.loading) return
    setState({ loading: true, reply: '', error: '', delivered: false })
    const res = await aiBriefing({ phase, lang, locId, deliver: shouldDeliver })
    if (res.ok && res.reply) {
      setState({ loading: false, reply: res.reply, error: '', delivered: Boolean(res.delivered) })
    } else {
      const error = res.kind === 'busy'
        ? (copy.aiBusy || 'The assistant is busy right now — try again in a moment.')
        : (res.error || copy.aiUnavailable)
      setState({ loading: false, reply: '', error, delivered: false })
    }
  }

  if (!configured) return null

  const phases = [
    { id: 'open', label: copy.briefingOpen },
    { id: 'close', label: copy.briefingClose },
  ]

  return (
    <Card data-testid="dashboard-shift-briefing">
      <SectionHeader
        title={copy.briefingTitle}
        sub={copy.briefingSub}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {provider && <Badge tone="accent" dot>{provider}</Badge>}
            <div role="group" aria-label={copy.briefingTitle} className="flex rounded-[var(--radius-md)] border border-[var(--border)] p-0.5">
              {phases.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPhase(item.id)}
                  aria-pressed={phase === item.id}
                  className={cn(
                    'rounded-[var(--radius-sm)] px-3 py-1 text-[var(--fs-caption)] font-semibold transition-colors',
                    phase === item.id ? 'bg-[var(--accent)] text-[var(--text-on-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" onClick={() => run(false)} disabled={state.loading}>
              <Icon name="sparkles" size={14} />
              {state.loading ? copy.aiThinking : copy.briefingRun}
            </Button>
          </div>
        }
      />

      {state.loading && (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {!state.loading && state.error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-lg)] bg-[var(--danger-soft)] px-3 py-2 text-[var(--fs-label)] text-[var(--danger)]" role="status">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {!state.loading && !state.error && state.reply && (
        <div aria-live="polite">
          <p className="whitespace-pre-line text-[var(--fs-body)] leading-relaxed text-[var(--text)]">{state.reply}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => run(true)}>
              <Icon name="message" size={14} />
              {copy.briefingDeliver}
            </Button>
            {state.delivered && (
              <span className="text-[var(--fs-caption)] font-semibold text-[var(--success)]">{copy.briefingSent}</span>
            )}
          </div>
        </div>
      )}

      {!state.loading && !state.error && !state.reply && (
        <p className="text-[var(--fs-label)] text-[var(--text-muted)]">{copy.briefingSub}</p>
      )}
    </Card>
  )
}
