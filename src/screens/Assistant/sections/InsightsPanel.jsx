import { Button, Card, ErrorBanner, SectionHeader, Skeleton } from '../../../components/ui'
import { Icon } from '../../../components/Icon'
import { INSIGHT_TITLES } from '../shared.js'

// The right rail: one-tap advisors plus the shift briefing, and the shared
// answer card they all write into. Every button produces a suggestion — none
// of them touch the reducer.
export function InsightsPanel({
  kinds, copy, result, configured, provider,
  onInsight, onBriefing, deliver, setDeliver,
}) {
  const busy = result.loading
  const title = result.kind ? copy.titles[result.kind] || INSIGHT_TITLES[result.kind] : ''

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title={copy.insightsTitle} sub={copy.insightsSub} />
        <div className="grid gap-2 sm:grid-cols-2">
          {kinds.map((kind) => (
            <Button
              key={kind.id}
              variant="secondary"
              disabled={!configured || busy}
              onClick={() => onInsight(kind.id)}
              className="justify-start"
            >
              <Icon name={kind.icon} size={16} />
              {copy.kinds[kind.id] || kind.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeader title={copy.briefingTitle} sub={copy.briefingSub} />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!configured || busy} onClick={onBriefing}>
            <Icon name="sparkles" size={15} />
            {busy && result.kind === 'briefing' ? copy.thinking : copy.briefingRun}
          </Button>
          <label className="flex items-center gap-2 text-[var(--fs-label)] text-[var(--text-muted)]">
            <input type="checkbox" checked={deliver} onChange={(event) => setDeliver(event.target.checked)} />
            {copy.briefingDeliver}
          </label>
        </div>
      </Card>

      {result.error && <ErrorBanner tone="warning">{result.error}</ErrorBanner>}

      {result.reply && !result.error && (
        <Card data-testid="assistant-answer">
          <SectionHeader
            title={title}
            actions={<Icon name="sparkles" size={16} className="text-[var(--accent)]" />}
          />
          <p className="whitespace-pre-wrap break-words text-[var(--fs-body)] text-[var(--text)]">{result.reply}</p>
          <p className="mt-3 border-t border-[var(--border-subtle)] pt-2 text-[var(--fs-caption)] text-[var(--text-subtle)]">
            {copy.source}
            {provider ? ` · ${provider}` : ''}
            {result.delivered ? ` · ${copy.delivered}` : ''}
          </p>
        </Card>
      )}

      {busy && !result.reply && (
        <Card>
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </Card>
      )}
    </div>
  )
}
