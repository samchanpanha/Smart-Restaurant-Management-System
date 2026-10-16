import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { aiBriefing, aiChat, aiInsight, aiStatus } from '../../lib/ai-client'
import { useI18n } from '../../lib/i18n'
import { useRestora } from '../../lib/store'
import { ChatPanel } from './sections/ChatPanel.jsx'
import { InsightsPanel } from './sections/InsightsPanel.jsx'
import { INSIGHT_KINDS, SUGGESTED_PROMPTS } from './shared.js'

// The staff Ops Copilot. Read-only by design: it reads the live shop through
// the server's redacted context digest and answers questions — it never
// dispatches a reducer action, so it can never mutate the restaurant.
function AssistantScreen() {
  const { state, locId, aiPrompt, clearAiPrompt } = useRestora()
  const { lang, dict } = useI18n()
  const a = dict.assistant || {}
  const copy = {
    eyebrow: a.eyebrow || 'Insight · AI',
    title: a.title || 'Ops Copilot',
    subtitle: a.subtitle || 'Ask about tonight’s shift or run an advisor. Answers are grounded in live data and never change it.',
    assistantName: a.assistantName || 'Ops Copilot',
    readOnly: a.readOnly || 'Read-only — the copilot suggests, you decide.',
    placeholder: a.placeholder || 'Ask about tonight’s shift…',
    send: a.send || 'Ask',
    thinking: a.thinking || 'Thinking…',
    emptyTitle: a.emptyTitle || 'Ask the copilot',
    emptySub: a.emptySub || 'Try a suggestion below, or ask anything about sales, stock, or the menu.',
    prompts: a.prompts || SUGGESTED_PROMPTS,
    insightsTitle: a.insightsTitle || 'Advisors',
    insightsSub: a.insightsSub || 'One-tap analysis of the live shift.',
    kinds: a.kinds || {},
    briefingTitle: a.briefingTitle || 'Shift briefing',
    briefingSub: a.briefingSub || 'A short manager hand-off for open or close.',
    briefingRun: a.briefingRun || 'Generate briefing',
    briefingDeliver: a.briefingDeliver || 'Push to Telegram',
    titles: a.titles || {},
    source: a.source || 'Grounded in your live shift data',
    delivered: a.delivered || 'sent to Telegram',
    notConfigured: a.notConfigured || 'AI is not configured',
    notConfiguredSub: a.notConfiguredSub || 'Add a key in Settings → AI assistant to switch the copilot on. Everything else keeps working while it is off.',
    busy: a.busy || 'The assistant is busy right now — try again in a moment.',
    limited: a.limited || 'Too many questions at once — wait a moment and try again.',
  }

  const [status, setStatus] = useState(null)
  const [messages, setMessages] = useState([])
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState({ kind: null, loading: false, reply: '', error: '', delivered: false })
  const [deliver, setDeliver] = useState(false)
  const nextId = useRef(0)
  const configured = Boolean(status?.configured)

  useEffect(() => {
    let alive = true
    aiStatus().then((next) => { if (alive) setStatus(next) })
    return () => { alive = false }
  }, [])

  function push(role, content, error = false) {
    nextId.current += 1
    setMessages((prev) => [...prev, { id: `m${nextId.current}`, role, content, error }])
  }

  // A provider overload or a dropped connection gets a calm, localized line
  // instead of the raw model text ("This model is currently experiencing
  // high demand…"), which only makes sense to whoever owns the API key.
  function failureText(res) {
    if (res?.kind === 'busy') return copy.busy
    if (res?.kind === 'limited') return copy.limited
    return res?.error || copy.notConfigured
  }

  async function ask(question) {
    if (!question || pending) return
    const history = messages
      .filter((message) => !message.error)
      .map((message) => ({ role: message.role, content: message.content }))
    push('user', question)
    setPending(true)
    const res = await aiChat({ question, history, lang, scope: 'ops', locId })
    setPending(false)
    if (res.ok && res.reply) push('assistant', res.reply)
    else push('assistant', failureText(res), true)
  }

  // A question handed over from the Help center (or any "Ask AI" shortcut):
  // ask it once, then clear so a re-render never repeats it.
  useEffect(() => {
    if (!aiPrompt) return
    clearAiPrompt()
    ask(aiPrompt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPrompt])

  async function runInsight(kind) {
    if (result.loading) return
    setResult({ kind, loading: true, reply: '', error: '', delivered: false })
    const res = await aiInsight({ kind, lang, scope: 'ops', locId })
    if (res.ok && res.reply) setResult({ kind, loading: false, reply: res.reply, error: '', delivered: false })
    else setResult({ kind, loading: false, reply: '', error: failureText(res), delivered: false })
  }

  async function runBriefing() {
    if (result.loading) return
    setResult({ kind: 'briefing', loading: true, reply: '', error: '', delivered: false })
    const res = await aiBriefing({ phase: 'open', lang, locId, deliver })
    if (res.ok && res.reply) setResult({ kind: 'briefing', loading: false, reply: res.reply, error: '', delivered: Boolean(res.delivered) })
    else setResult({ kind: 'briefing', loading: false, reply: '', error: failureText(res), delivered: false })
  }

  return (
    <div className="space-y-4">
      <header>
        <div className="mb-1 text-xs font-semibold text-[var(--accent)]">{copy.eyebrow}</div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-[var(--text-strong)]">
          <Icon name="sparkles" size={26} className="text-[var(--accent)]" />
          {copy.title}
          {lang !== 'en' && <span className="sr-only"> Ops Copilot</span>}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--text-muted)]">{copy.subtitle}</p>
      </header>

      {status && !status.configured && (
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--warning-soft)] text-[var(--warning)]">
              <Icon name="warning" size={18} />
            </span>
            <div>
              <p className="text-[var(--fs-body)] font-semibold text-[var(--text-strong)]">{copy.notConfigured}</p>
              <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">{copy.notConfiguredSub}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ChatPanel
          messages={messages}
          pending={pending}
          onAsk={ask}
          copy={copy}
          configured={configured}
        />
        <InsightsPanel
          kinds={INSIGHT_KINDS}
          copy={copy}
          result={result}
          configured={configured}
          provider={status?.configured ? `${status.provider} · ${status.model}` : ''}
          onInsight={runInsight}
          onBriefing={runBriefing}
          deliver={deliver}
          setDeliver={setDeliver}
        />
      </div>

      {state?.settings?.restaurantName && (
        <p className="text-[var(--fs-caption)] text-[var(--text-subtle)]">
          {copy.source} · {state.settings.restaurantName}
        </p>
      )}
    </div>
  )
}

export default AssistantScreen
