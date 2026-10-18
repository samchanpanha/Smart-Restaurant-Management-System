// ─── Telegram & Mini App ────────────────────────────────────────────
// Four beats, top to bottom: get the bot live (a three-step checklist
// whose status is read from the server, not guessed), try the commands
// the bot answers, choose what it pushes, and see the guest mini app.
//
// The setup buttons are server-assisted: "Register webhook" calls
// setWebhook with the saved tenant token + Base URL, "Send test message"
// proves the round trip. No hand-built Telegram API URLs, and every
// failure is a sentence, not a stack trace.
//
// The console runs the SAME pure command engine the webhook runs, so a
// command typed here is exactly what a manager would send from a phone.
// Preview mode shows the reply and the actions without touching the book;
// Apply mode commits them through the shared reducer (or the server, when
// the API is live), which is the same path every terminal uses.

import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import { Button, Card, Input, SectionHeader, Select } from '../components/ui'
import { translateTableName, useI18n } from '../lib/i18n'
import { runTelegramCommand, TELEGRAM_COMMANDS, commandsFor } from '../lib/telegram'
import { dailyDigest } from '../lib/telegram-digest'
import { useRestora } from '../lib/store'
import { useAuth } from '../lib/auth'

// Push side: which events are worth a message. The last column is the
// default, because "what should a new restaurant get?" is a real question.
const NOTIFY_TOGGLES = [
  ['notifyOrders', 'A check is fired', 'table, lines, and value as it lands — guest QR orders included', true],
  ['notify86', 'A dish is 86’d — or comes back', 'from any terminal, including the bot itself', true],
  ['notifyLowStock', 'Stock drops under par', 'only on the crossing, not on every sale', true],
  ['notifyPurchases', 'A purchase order is placed or received', 'what was sent to the supplier and what actually landed', true],
  ['notifyDailyDigest', 'Close-of-day digest', 'sales, food cost, buying, and what to order — once a day', false],
]

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

const WEBAPP_APIS = [
  ['Telegram.WebApp.ready()', 'tells Telegram the page loaded — called on mount'],
  ['expand()', 'uses the full height instead of the sheet'],
  ['themeParams', 'paints the mini app in the Telegram theme'],
  ['MainButton', 'the blue “Send to kitchen” button at the bottom'],
  ['HapticFeedback', 'a tap you can feel when an order lands'],
  ['BackButton', 'closes the mini app back into the chat'],
]

const CHECKING = 'Checking…'
const OFFLINE = 'API offline'

// The checklist reads three different payloads — the token from
// /api/telegram/status, the webhook from /api/telegram/webhook/info, the
// reachable chats from the push stats — and turns each into one pill.
function webhookPill(apiLive, webhook) {
  if (!apiLive) return ['muted', OFFLINE]
  if (!webhook) return ['muted', CHECKING]
  if (webhook.configured === false) return ['muted', 'Waiting for a token']
  if (webhook.ok === false) return ['warn', 'Check failed']
  if (webhook.registered && webhook.matches) return ['ok', 'Registered']
  if (webhook.registered) return ['warn', 'Registered elsewhere']
  return ['warn', 'Not registered']
}

export default function TelegramScreen() {
  const { state, role, locId, link, dispatch, setScreen } = useRestora()
  const { user } = useAuth()
  const { lang, dict } = useI18n()
  const tg = dict.telegram || {}
  const [status, setStatus] = useState(null)
  const [webhook, setWebhook] = useState(null)
  const [webhookBusy, setWebhookBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [setupNote, setSetupNote] = useState(null)
  const [botRole, setBotRole] = useState(role === 'owner' ? 'manager' : 'staff')
  const [apply, setApply] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [tableId, setTableId] = useState(() => (
    state.tables.find((table) => table.status === 'seated' || table.status === 'ordered')?.id
    || state.tables[0]?.id
    || ''
  ))
  const [digest, setDigest] = useState(null)
  const [digestNote, setDigestNote] = useState('')
  const [digestBusy, setDigestBusy] = useState(false)
  const [transcript, setTranscript] = useState([{
    id: 'hello',
    from: 'bot',
    text: 'Restora bot is listening. Try /today, /low, or /86 <dish>.',
  }])
  const logRef = useRef(null)

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const webhookUrl = `${origin}/api/telegram/webhook`
  const ownerSlug = user?.owner?.slug
  const ownerParam = ownerSlug ? `&owner=${encodeURIComponent(ownerSlug)}` : ''
  const miniAppUrl = `${origin}/?tg=1&guest=${encodeURIComponent(tableId || state.tables[0]?.id || '')}${ownerParam}`
  const commands = useMemo(() => commandsFor(botRole), [botRole])
  const previewTable = state.tables.find((table) => table.id === tableId)
  const previewSeated = previewTable && (previewTable.status === 'seated' || previewTable.status === 'ordered')

  useEffect(() => {
    if (link.status !== 'live') return undefined
    let alive = true
    fetch('/api/telegram/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (alive && json) setStatus(json) })
      .catch(() => { if (alive) setStatus(null) })
    fetch('/api/telegram/webhook/info')
      .then((res) => (res.ok || res.status === 502 ? res.json() : null))
      .then((json) => { if (alive && json) setWebhook(json) })
      .catch(() => { /* the checklist pill already says the API is offline */ })
    return () => { alive = false }
  }, [link.status])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [transcript])

  async function run(text) {
    const command = String(text || '').trim()
    if (!command || busy) return
    setDraft('')
    setBusy(true)
    setTranscript((rows) => [...rows, { id: `me-${rows.length}`, from: 'me', text: command }])

    let reply = ''
    let actions = []
    try {
      if (link.status === 'live') {
        // The server owns the authoritative book when the API is up.
        const res = await fetch('/api/telegram/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: command, role: botRole, locId, dryRun: !apply }),
        })
        const json = await res.json()
        reply = json.reply || 'No reply.'
        actions = json.actions || []
      } else {
        // Offline demo: the same pure engine, against this terminal's shop.
        const json = runTelegramCommand(command, { shop: state, role: botRole, now: Date.now(), miniAppUrl: origin })
        reply = json.reply
        actions = json.actions || []
        if (apply) for (const action of actions) dispatch(action)
      }
    } catch (err) {
      reply = `Could not reach the bot: ${err.message}`
      actions = []
    }

    setTranscript((rows) => [...rows, {
      id: `bot-${rows.length}`,
      from: 'bot',
      text: reply,
      actions: actions.length ? actions : null,
      applied: link.status !== 'live' && apply,
    }])
    setBusy(false)
  }

  /** Re-read the webhook after a register click (also clears a stale error). */
  async function refreshWebhook() {
    try {
      const res = await fetch('/api/telegram/webhook/info')
      if (!res.ok && res.status !== 502) return
      const json = await res.json()
      if (json) setWebhook(json)
    } catch { /* keep the last known state; the pill already explains the API */ }
  }

  /** "Register webhook": setWebhook with the saved token + Base URL. */
  async function registerWebhook() {
    if (webhookBusy || link.status !== 'live') return
    setWebhookBusy(true)
    setSetupNote(null)
    try {
      const res = await fetch('/api/telegram/webhook/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.ok === false) {
        setSetupNote({ tone: 'warn', text: json.error || `Could not register the webhook (HTTP ${res.status}).` })
      } else {
        setSetupNote({ tone: 'ok', text: `Webhook registered — Telegram will call ${json.url}.` })
        await refreshWebhook()
      }
    } catch (err) {
      setSetupNote({ tone: 'warn', text: `Could not reach the API: ${err.message}` })
    }
    setWebhookBusy(false)
  }

  /** "Send test message": prove the round trip to every reachable chat. */
  async function sendTest() {
    if (testBusy || link.status !== 'live') return
    setTestBusy(true)
    setSetupNote(null)
    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const json = await res.json().catch(() => ({}))
      const total = json.targets?.length || 0
      if (!res.ok || json.ok === false) {
        setSetupNote({ tone: 'warn', text: json.error || 'Nothing was sent.' })
      } else if (json.sent === total) {
        setSetupNote({ tone: 'ok', text: `Test message sent to ${json.sent} chat${json.sent === 1 ? '' : 's'}.` })
      } else {
        const reason = (json.results || []).find((row) => !row.ok)?.error
        setSetupNote({ tone: 'warn', text: `Sent to ${json.sent} of ${total} chats.${reason ? ` ${reason}` : ''}` })
      }
    } catch (err) {
      setSetupNote({ tone: 'warn', text: `Could not reach the API: ${err.message}` })
    }
    setTestBusy(false)
  }

  async function copyWebhookAddress() {
    const address = webhook?.expectedUrl || webhookUrl
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setSetupNote({ tone: 'ok', text: 'Webhook address copied.' })
    } catch {
      setSetupNote({ tone: 'warn', text: 'Could not copy — select the address and copy it manually.' })
    }
  }

  /** Hop to Settings → Telegram in this tab (one-shot session handoff). */
  function openSettings() {
    try { sessionStorage.setItem('restora-settings-section', 'telegram') } catch { /* default landing */ }
    setScreen('settings')
  }

  const configured = Boolean(status?.configured)
  const stats = status?.stats
  const push = status?.push
  const telegramSettings = state.settings?.telegram || {}
  const pushChats = push?.lastTargets?.length
    ? push.lastTargets
    : (telegramSettings.chatId ? [telegramSettings.chatId] : [])

  const apiLive = link.status === 'live'
  const webhookAddress = webhook?.expectedUrl || webhookUrl
  const [webhookTone, webhookLabel] = webhookPill(apiLive, webhook)
  const tokenTone = !apiLive ? 'muted' : configured ? 'ok' : status == null ? 'muted' : 'warn'
  const tokenLabel = !apiLive ? OFFLINE : status == null ? CHECKING : configured ? 'Saved' : 'Not set'
  const chatTone = pushChats.length ? 'ok' : 'muted'
  const chatLabel = !apiLive ? OFFLINE : status == null ? CHECKING : 'No chat yet'

  function patchTelegram(patch) {
    dispatch({ type: 'UPDATE_SETTINGS', patch: { telegram: { ...telegramSettings, ...patch } }, by: role })
  }

  /** Preview the digest (never sends), or push it to every reachable chat. */
  async function digestRun(dry) {
    if (digestBusy) return
    setDigestBusy(true)
    setDigestNote('')
    try {
      if (link.status !== 'live') {
        const local = dailyDigest(state, Date.now())
        setDigest(local)
        setDigestNote(dry
          ? 'Local preview — the API is offline, so nothing was sent.'
          : 'Local demo — the API is offline, so the digest stayed on this machine.')
      } else {
        const res = await fetch('/api/telegram/digest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun: dry }),
        })
        const json = await res.json()
        setDigest(json)
        if (dry) setDigestNote(`Preview · would go to ${json.targets?.length || 0} chat${json.targets?.length === 1 ? '' : 's'}.`)
        else if (json.ok) setDigestNote(`Sent to ${json.sent} chat${json.sent === 1 ? '' : 's'} at ${new Date().toLocaleTimeString()}.`)
        else setDigestNote(json.error || 'Nothing was sent.')
      }
    } catch (err) {
      setDigestNote(`Could not reach the API: ${err.message}`)
    }
    setDigestBusy(false)
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[var(--fs-label)] font-semibold text-[var(--accent-text)]">
            <Icon name="message" size={14} />
            {tg.eyebrow || 'Channels · step 9'}
            {lang !== 'en' && <span className="sr-only"> Channels · step 9</span>}
          </div>
          <h1 className="text-[var(--fs-display)] font-bold tracking-tight text-[var(--text-strong)]">
            {tg.title || 'Telegram bot & mini app'}
            {lang !== 'en' && <span className="sr-only"> Telegram bot &amp; mini app</span>}
          </h1>
          <p className="mt-1 max-w-3xl text-[var(--fs-body)] text-[var(--text-muted)]">
            {tg.subtitle || 'The bot reads and writes the same book as the terminals — a 86 from a phone lands on the KDS, the composer, and the guest menu at once. The mini app is the guest menu inside Telegram.'}
            {lang !== 'en' && <span className="sr-only"> The bot reads and writes the same book as the terminals — a 86 from a phone lands on the KDS, the composer, and the guest menu at once. The mini app is the guest menu inside Telegram.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={apiLive ? 'ok' : 'muted'} size="sm">
            {apiLive ? 'API live' : dict.localDemo}
          </StatusPill>
          {apiLive && (
            <StatusPill tone={configured ? 'ok' : 'warn'} size="sm">
              {configured ? 'Bot token configured' : 'No bot token yet'}
            </StatusPill>
          )}
        </div>
      </header>

      {/* ── setup checklist ──────────────────────────────────── */}
      <Card as="section" aria-labelledby="tg-setup-title">
        <SectionHeader
          id="tg-setup-title"
          icon={<Icon name="sparkles" size={16} className="text-[var(--accent-text)]" />}
          title={tg.setupTitle || 'Get the bot live'}
          sub={tg.setupSub || 'Three steps, no code: the server does the rest.'}
        />

        {!apiLive && (
          <p className="mb-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-xs text-[var(--text-muted)]">
            API offline — the setup buttons need the server.
          </p>
        )}

        <ol className="grid gap-3 lg:grid-cols-3">
          <li className="flex flex-col rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-text)]">1</span>
              <StatusPill tone={tokenTone} size="sm">{tokenLabel}</StatusPill>
            </div>
            <h3 className="mt-2.5 text-[var(--fs-body)] font-bold text-[var(--text-strong)]">Save the bot token</h3>
            <p className="mt-1 text-[var(--fs-label)] leading-relaxed text-[var(--text-muted)]">
              Create a bot with <code className="rounded bg-[var(--surface-hover)] px-1 py-0.5 font-mono text-[11px] text-[var(--text)]">@BotFather</code> then
              paste its token in Settings → Telegram bot &amp; mini app.
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-3">
              <Button variant="secondary" size="sm" onClick={openSettings}>
                <Icon name="settings" size={14} />
                Open settings
              </Button>
            </div>
          </li>

          <li className="flex flex-col rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-text)]">2</span>
              <StatusPill tone={webhookTone} size="sm">{webhookLabel}</StatusPill>
            </div>
            <h3 className="mt-2.5 text-[var(--fs-body)] font-bold text-[var(--text-strong)]">Point Telegram at this server</h3>
            <p className="mt-1 text-[var(--fs-label)] leading-relaxed text-[var(--text-muted)]">
              One click calls <code className="rounded bg-[var(--surface-hover)] px-1 py-0.5 font-mono text-[11px] text-[var(--text)]">setWebhook</code> with
              the address below — no hand-built API URL.
            </p>
            <code className="mt-2 block break-all rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-2 font-mono text-[11px] text-[var(--text-muted)]">
              {webhookAddress || '—'}
            </code>
            {webhook?.registered && !webhook.matches && webhook.url ? (
              <p className="mt-1.5 text-[11px] text-[var(--warning)]">
                Currently registered at <code className="break-all">{webhook.url}</code>.
              </p>
            ) : null}
            {webhook?.configured && !webhook.expectedUrl ? (
              <p className="mt-1.5 text-[11px] text-[var(--warning)]">
                Add the Base URL in Settings — Telegram needs a public https address.
              </p>
            ) : null}
            {webhook?.ok === false && webhook.error ? (
              <p className="mt-1.5 text-[11px] text-[var(--danger)]">{webhook.error}</p>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-2 pt-3">
              <Button size="sm" onClick={registerWebhook} disabled={!apiLive || !configured || webhookBusy}>
                {webhookBusy ? 'Registering…' : 'Register webhook'}
              </Button>
              <Button variant="secondary" size="sm" onClick={copyWebhookAddress} disabled={!webhookAddress}>
                Copy address
              </Button>
            </div>
          </li>

          <li className="flex flex-col rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-text)]">3</span>
              <StatusPill tone={chatTone} size="sm">
                {pushChats.length ? (
                  <>
                    <span className="tnum">{pushChats.length}</span>
                    <span>{pushChats.length === 1 ? 'chat reachable' : 'chats reachable'}</span>
                  </>
                ) : chatLabel}
              </StatusPill>
            </div>
            <h3 className="mt-2.5 text-[var(--fs-body)] font-bold text-[var(--text-strong)]">
              Say <code className="rounded bg-[var(--surface-hover)] px-1 py-0.5 font-mono text-[11px] text-[var(--text)]">/start</code> in the chat
            </h3>
            <p className="mt-1 text-[var(--fs-label)] leading-relaxed text-[var(--text-muted)]">
              Every chat that messages the bot is remembered and gets the pushes below.
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-3">
              <Button size="sm" onClick={sendTest} disabled={!apiLive || !configured || testBusy}>
                <Icon name="send" size={14} />
                {testBusy ? 'Sending…' : 'Send test message'}
              </Button>
            </div>
          </li>
        </ol>

        {setupNote && (
          <p
            role="status"
            aria-live="polite"
            className={`mt-3 rounded-[var(--radius-lg)] px-3 py-2 text-xs font-medium ${
              setupNote.tone === 'ok'
                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                : 'bg-[var(--warning-soft)] text-[var(--warning)]'
            }`}
          >
            {setupNote.text}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Updates seen</span>
          <span className="tnum text-[11px] text-[var(--text-muted)]">
            {stats
              ? `${stats.updates} updates · ${stats.commands} commands · ${stats.actions} actions · ${stats.skipped} undelivered`
              : 'API offline — the console below still answers locally'}
          </span>
        </div>

        <details className="mt-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--text)]">
            Prefer the server environment?
          </summary>
          <dl className="mt-2 space-y-1.5 text-[11px] text-[var(--text-muted)]">
            {[
              ['TELEGRAM_BOT_TOKEN', 'Token from BotFather. A token saved above wins.'],
              ['TELEGRAM_WEBHOOK_SECRET', 'Optional. Telegram echoes it back on every update.'],
              ['TELEGRAM_CHAT_ROLES', 'Map chats to roles. Unmapped chats can only look things up.'],
            ].map(([name, blurb]) => (
              <div key={name} className="flex flex-wrap items-baseline gap-x-2">
                <dt>
                  <code className="rounded bg-[var(--surface)] px-1 py-0.5 font-mono text-[10px] text-[var(--text)]">{name}</code>
                </dt>
                <dd className="min-w-0 flex-1">{blurb}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Card>

      {/* ── console + command list ───────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card as="section" className="flex flex-col lg:col-span-3">
          <SectionHeader
            title={tg.botConsole || 'Bot console'}
            sub={apply
              ? 'Apply mode — commands change this book through the same reducer the webhook uses.'
              : 'Preview mode — commands answer without touching the book.'}
            actions={(
              <label className="flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={apply}
                  onChange={(event) => setApply(event.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {tg.applyMode || 'Apply actions'}
                {lang !== 'en' && <span className="sr-only"> Apply actions</span>}
              </label>
            )}
          />

          <div
            ref={logRef}
            data-testid="telegram-transcript"
            className="max-h-80 min-h-[260px] flex-1 space-y-2 overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--surface-hover)] p-3"
          >
            {transcript.map((row) => (
              <div key={row.id} className={`flex ${row.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-[var(--radius-lg)] px-3.5 py-2 text-sm shadow-[var(--shadow-xs)] ${
                  row.from === 'me'
                    ? 'bg-[var(--accent)] text-[var(--text-on-accent)]'
                    : 'bg-[var(--surface)] text-[var(--text)] ring-1 ring-[var(--border)]'
                }`}
                >
                  <pre className="whitespace-pre-wrap font-sans">{row.text}</pre>
                  {row.actions && (
                    <div className="mt-2 border-t border-[var(--border)] pt-1.5 text-[11px] text-[var(--text-subtle)]">
                      {row.applied ? 'Applied: ' : 'Would apply: '}
                      {row.actions.map((action) => action.type).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => { event.preventDefault(); run(draft) }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="/today"
              aria-label="Bot command"
            />
            <Button type="submit" disabled={busy}>
              <Icon name="send" size={16} /> Send
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['/today', '/low', '/stock salmon', '/orders', '/pnl', '/po', '/help'].map((shortcut) => (
              <button
                key={shortcut}
                type="button"
                onClick={() => run(shortcut)}
                className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
              >
                {shortcut}
              </button>
            ))}
          </div>
        </Card>

        <Card as="section" className="lg:col-span-2">
          <SectionHeader
            title={tg.commandRef || 'Command list'}
            sub={<>{commands.length} of {TELEGRAM_COMMANDS.length} commands for {botRole} access.</>}
            actions={(
              <div className="flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-hover)] p-0.5" role="group" aria-label="Command role">
                {['staff', 'manager'].map((option) => {
                  const optionLabel = option === 'staff'
                    ? (lang === 'km' ? 'បុគ្គលិក' : lang === 'zh' ? '员工' : 'staff')
                    : (lang === 'km' ? 'អ្នកគ្រប់គ្រង' : lang === 'zh' ? '经理' : 'manager')
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setBotRole(option)}
                      aria-pressed={botRole === option}
                      className={`min-h-8 rounded-[calc(var(--radius-md)-2px)] px-3 text-xs font-semibold capitalize transition-colors ${
                        botRole === option
                          ? 'bg-[var(--surface)] text-[var(--text-strong)] shadow-[var(--shadow-sm)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      <span data-i18n-tab={optionLabel} className="tab-i18n-label">
                        <span className="sr-only">{option}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          />
          <ul className="max-h-[22rem] divide-y divide-[var(--border)] overflow-y-auto">
            {commands.map((entry) => (
              <li key={entry.command} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <code className="text-xs font-bold text-[var(--text-strong)]">
                    {entry.command}{entry.args ? ` ${entry.args}` : ''}
                  </code>
                  <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{entry.blurb}</div>
                </div>
                <button
                  type="button"
                  onClick={() => run(entry.command + (entry.args ? ' ' : ''))}
                  className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
                >
                  Try
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ── notifications ────────────────────────────────────── */}
      <Card as="section">
        <SectionHeader
          title={tg.notifyTitle || 'What the bot tells you'}
          sub="The bot does not wait to be asked. Switch on the events worth a ping and it pushes them to every chat it can reach — the ones that message it, and the id below."
          actions={(
            <StatusPill tone={pushChats.length ? 'ok' : 'muted'} size="sm">
              {pushChats.length ? (
                <>
                  <span className="tnum">{pushChats.length}</span>
                  <span>{pushChats.length === 1 ? 'chat reachable' : 'chats reachable'}</span>
                </>
              ) : 'no chat yet'}
            </StatusPill>
          )}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {NOTIFY_TOGGLES.map(([key, label, blurb, fallback]) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] px-3 py-2 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
              >
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={telegramSettings[key] === undefined ? fallback : telegramSettings[key] !== false}
                  onChange={(event) => patchTelegram({ [key]: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--text-strong)]">{label}</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{blurb}</span>
                </span>
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--surface-hover)] px-3 py-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]" htmlFor="tg-digest-hour">
                Digest hour
              </label>
              <Select
                id="tg-digest-hour"
                value={Number(telegramSettings.digestHour ?? 22)}
                onChange={(event) => patchTelegram({ digestHour: Number(event.target.value) })}
                className="w-28"
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
                ))}
              </Select>
              <span className="text-[11px] text-[var(--text-muted)]">One digest per day, once this hour has passed.</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[var(--radius-lg)] border border-[var(--border)] px-3 py-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]" htmlFor="tg-chat">
                Chat to report to
              </label>
              <Input
                id="tg-chat"
                value={telegramSettings.chatId || ''}
                onChange={(event) => patchTelegram({ chatId: event.target.value.trim() })}
                placeholder="-1001234567890"
                className="mt-1 font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Any chat that messages the bot is remembered automatically — send it <code className="rounded bg-[var(--surface-hover)] px-1">/start</code> once.
              </p>
              {push?.lastText ? (
                <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--surface-hover)] px-2.5 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-subtle)]">
                    Last push · {push.lastTargets?.join(', ') || 'no targets'}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-[var(--text-muted)]">{push.lastText}</pre>
                </div>
              ) : null}
            </div>

            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-hover)] px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-subtle)]">Close-of-day digest</div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => digestRun(true)}>Preview</Button>
                  <Button size="sm" onClick={() => digestRun(false)} disabled={digestBusy}>
                    <Icon name="send" size={13} /> Send now
                  </Button>
                </div>
              </div>
              {digest ? (
                <pre data-testid="digest-preview" className="mt-2 whitespace-pre-wrap font-sans text-[11px] text-[var(--text)]">{digest.text}</pre>
              ) : (
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">Preview what tonight looked like, then send it to the chats above.</p>
              )}
              {digestNote ? <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{digestNote}</p> : null}
            </div>
          </div>
        </div>
      </Card>

      {/* ── mini app ─────────────────────────────────────────── */}
      <Card as="section">
        <SectionHeader
          title={tg.miniAppPreview || 'Telegram mini app'}
          sub="The guest menu packaged for Telegram: the same QR surface, opened from the chat instead of the table tent. Open it from a bot reply, a menu button, or the link below."
          actions={(
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]" htmlFor="tg-table">Table</label>
              <Select
                id="tg-table"
                value={tableId}
                onChange={(event) => setTableId(event.target.value)}
                className="w-40"
              >
                {state.tables.map((table) => <option key={table.id} value={table.id}>{translateTableName(table.name, lang)}</option>)}
              </Select>
            </div>
          )}
        />

        {previewTable && !previewSeated && (
          <p className="mt-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
            {translateTableName(previewTable.name, lang)} isn&apos;t seated yet — a guest opening this link sees the
            menu locked, with an <strong>Order for pickup</strong> option so they can still order.
          </p>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-4 text-center shadow-[var(--shadow-xs)]">
            <div data-no-i18n className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-subtle)]">Restora · mini app</div>
            <div className="mx-auto mt-3 w-fit rounded-[var(--radius-lg)] border-4 border-[var(--text-strong)] bg-white p-2">
              <QRCodeSVG value={miniAppUrl} size={168} level="M" />
            </div>
            <code className="mt-3 block break-all font-mono text-[10px] text-[var(--text-subtle)]">{miniAppUrl}</code>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <a
                href={miniAppUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
              >
                Open mini app ↗{lang !== 'en' && <span className="sr-only"> Open mini app</span>}
              </a>
            </div>
          </div>

          <div className="space-y-3">
            <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)]">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-[11px] font-semibold text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" aria-hidden />
                  Live preview
                  <code className="font-mono font-normal text-[var(--text-subtle)]"> · {miniAppUrl.replace(origin, '')}</code>
                </span>
                <a href={miniAppUrl} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] hover:underline">reload ↗</a>
              </div>
              <iframe
                title="Telegram mini app preview"
                src={miniAppUrl}
                className="h-[420px] w-full bg-[var(--surface-hover)]"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBAPP_APIS.map(([api, blurb]) => (
                <div key={api} className="rounded-[var(--radius-lg)] bg-[var(--surface-hover)] px-3 py-2">
                  <div className="font-mono text-[11px] font-semibold text-[var(--text)]">{api}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{blurb}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Outside Telegram the mini app still runs as an ordinary web page — the Telegram APIs are feature-detected,
              so a plain browser shows the same menu without the platform chrome.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
