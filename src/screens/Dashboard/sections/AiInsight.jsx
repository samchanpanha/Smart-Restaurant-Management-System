// ─── AI advisor card ────────────────────────────────────────────────
// One read-only surface for every dashboard advisor: the alert explainer, the
// menu-engineering advisor, and the prep forecast. When a key is configured it
// asks /api/ai/insight for a short suggestion list and renders it; when AI is
// off it renders nothing at all, so the dashboard is unchanged. The model sees
// only the redacted digest and returns text — it never dispatches an action.

import { useEffect, useState } from 'react'
import { Badge, Button, Card, SectionHeader, Skeleton } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
import { aiInsight } from '../../../lib/ai-client'

// The model sometimes wraps bullets in "1." / "- " / "• " prefixes. Strip the
// marker so the list renders as our own, then keep only real lines.
function toLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

export default function AiInsight({
  copy,
  configured,
  lang,
  locId,
  kind = 'alert',
  title,
  sub,
  runLabel,
  autoRun = false,
  provider = '',
  testId = 'dashboard-ai-insight',
}) {
  const [state, setState] = useState({ loading: false, reply: '', error: '' })

  async function run() {
    if (state.loading) return
    setState({ loading: true, reply: '', error: '' })
    const res = await aiInsight({ kind, lang, scope: 'ops', locId })
    if (res.ok && res.reply) setState({ loading: false, reply: res.reply, error: '' })
    else {
      // A provider overload reads badly verbatim, so soften it; other
      // failures keep their own text (a bad key, a dead endpoint).
      const error = res.kind === 'busy'
        ? (copy.aiBusy || 'The assistant is busy right now — try again in a moment.')
        : (res.error || copy.aiUnavailable)
      setState({ loading: false, reply: '', error })
    }
  }

  // Auto-run only when the caller has data worth explaining; otherwise a click
  // is required so we never spend a token on a quiet shift by surprise.
  useEffect(() => {
    if (configured && autoRun) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, lang, autoRun, kind, locId])

  if (!configured) return null

  const lines = toLines(state.reply)

  return (
    <Card data-testid={testId}>
      <SectionHeader
        title={title || copy.aiExplainTitle}
        sub={sub || copy.aiExplainSub}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {provider && <Badge tone="accent" dot>{provider}</Badge>}
            <Button size="sm" variant="secondary" onClick={run} disabled={state.loading}>
              <Icon name="sparkles" size={14} />
              {state.loading ? copy.aiThinking : (runLabel || copy.aiExplainRun)}
            </Button>
          </div>
        }
      />

      {state.loading && (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {!state.loading && state.error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-lg)] bg-[var(--danger-soft)] px-3 py-2 text-[var(--fs-label)] text-[var(--danger)]" role="status">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {!state.loading && !state.error && lines.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {lines.map((line, index) => (
            <li key={`${index}-${line.slice(0, 24)}`} className="flex gap-2 text-[var(--fs-label)] text-[var(--text)]">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {!state.loading && !state.error && !lines.length && (
        <p className="text-[var(--fs-label)] text-[var(--text-muted)]" data-testid={`${testId}-empty`}>
          {copy.aiEmpty || 'No suggestions right now — try again in a moment.'}
        </p>
      )}
    </Card>
  )
}
