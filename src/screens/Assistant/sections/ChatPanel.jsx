import { useState } from 'react'
import { Button, Card, EmptyState, Skeleton, Textarea } from '../../../components/ui'
import { Icon } from '../../../components/Icon'

// The conversation surface: transcript, suggested-prompt chips, and the
// composer. Read-only — it asks questions, it never commits an action.
export function ChatPanel({ messages, pending, onAsk, copy, configured }) {
  const [draft, setDraft] = useState('')

  function submit(event) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || pending) return
    setDraft('')
    onAsk(question)
  }

  return (
    <Card className="flex min-h-[62vh] flex-col gap-4">
      <div className="flex-1 space-y-4 overflow-y-auto" data-testid="assistant-transcript" aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState
            title={copy.emptyTitle}
            sub={copy.emptySub}
            icon={<Icon name="message" size={22} />}
          />
        ) : (
          messages.map((message) => {
            const isError = Boolean(message.error)
            return (
              <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    isError
                      ? 'max-w-[90%] rounded-[var(--radius-lg)] bg-[var(--danger-soft)] px-4 py-2.5 text-[var(--fs-body)] text-[var(--danger)]'
                      : message.role === 'user'
                        ? 'max-w-[85%] rounded-[var(--radius-lg)] bg-[var(--accent-soft)] px-4 py-2.5 text-[var(--fs-body)] text-[var(--accent-text)]'
                        : 'max-w-[90%] rounded-[var(--radius-lg)] bg-[var(--surface-hover)] px-4 py-2.5 text-[var(--fs-body)] text-[var(--text)]'
                  }
                  data-testid={isError ? 'assistant-error' : undefined}
                >
                  {message.role === 'assistant' && (
                    <div className={`mb-1 flex items-center gap-1.5 text-[var(--fs-caption)] font-semibold ${isError ? 'text-[var(--danger)]' : 'text-[var(--text-subtle)]'}`}>
                      <Icon name={isError ? 'warning' : 'sparkles'} size={13} />
                      {copy.assistantName}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                </div>
              </div>
            )
          })
        )}
        {pending && (
          <div className="space-y-2" data-testid="assistant-thinking">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {(copy.prompts || []).map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={!configured || pending}
              onClick={() => onAsk(prompt)}
              className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[var(--fs-label)] font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.placeholder}
            aria-label={copy.placeholder}
            rows={2}
            disabled={!configured}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--fs-caption)] text-[var(--text-subtle)]">{copy.readOnly}</span>
            <Button type="submit" disabled={!configured || pending || !draft.trim()}>
              <Icon name="send" size={15} />
              {copy.send}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  )
}
