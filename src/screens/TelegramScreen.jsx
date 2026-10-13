// ─── Telegram & Mini App ────────────────────────────────────────────
// One screen that answers three questions: is the bot wired up, what can
// it do, and what does the mini app look like to a guest?
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
import { btnGhost, btnPrimary, inputCls } from '../components/ui'
import { runTelegramCommand, TELEGRAM_COMMANDS, commandsFor } from '../lib/telegram'
import { dailyDigest } from '../lib/telegram-digest'
import { useRestora } from '../lib/store'

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white shadow-sm'

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

export default function TelegramScreen() {
  const { state, role, locId, link, dispatch } = useRestora()
  const [status, setStatus] = useState(null)
  const [botRole, setBotRole] = useState(role === 'owner' ? 'manager' : 'staff')
  const [apply, setApply] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [tableId, setTableId] = useState(state.tables[0]?.id || '')
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
  const miniAppUrl = `${origin}/?tg=1&guest=${encodeURIComponent(tableId || state.tables[0]?.id || '')}`
  const commands = useMemo(() => commandsFor(botRole), [botRole])

  useEffect(() => {
    if (link.status !== 'live') return undefined
    let alive = true
    fetch('/api/telegram/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (alive && json) setStatus(json) })
      .catch(() => { if (alive) setStatus(null) })
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

  const configured = Boolean(status?.configured)
  const stats = status?.stats
  const push = status?.push
  const telegramSettings = state.settings?.telegram || {}
  const pushChats = push?.lastTargets?.length
    ? push.lastTargets
    : (telegramSettings.chatId ? [telegramSettings.chatId] : [])

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Telegram bot & mini app</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">
            The bot reads and writes the same book as the terminals — a 86 from a phone lands on the KDS,
            the composer, and the guest menu at once. The mini app is the guest menu inside Telegram.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={link.status === 'live' ? 'ok' : 'muted'} size="sm">
            {link.status === 'live' ? 'API live' : 'Local demo'}
          </StatusPill>
          <StatusPill tone={configured ? 'ok' : 'warn'} size="sm">
            {configured ? 'Bot token configured' : 'No bot token yet'}
          </StatusPill>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── wiring ─────────────────────────────────────────── */}
        <section className={`${cardCls} p-5`}>
          <h2 className="text-sm font-bold text-zinc-900">Wire the bot up</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Three steps, no code: the server does the rest.</p>
          <ol className="mt-3 space-y-2.5 text-sm text-zinc-700">
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-xs font-bold text-orange-600">1</span>
              <span>
                Talk to <span className="font-semibold">@BotFather</span> in Telegram, create a bot, and copy its token
                into <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px]">TELEGRAM_BOT_TOKEN</code>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-xs font-bold text-orange-600">2</span>
              <span>
                Point Telegram at the webhook:
                <div className="mt-1.5 break-all rounded-lg bg-zinc-50 px-3 py-2 font-mono text-[11px] text-zinc-600">
                  https://api.telegram.org/bot&lt;token&gt;/setWebhook?url={webhookUrl}
                </div>
                <span className="mt-1 block text-[11px] text-zinc-500">
                  Add <code className="rounded bg-zinc-100 px-1 py-0.5">TELEGRAM_WEBHOOK_SECRET</code> and Telegram will
                  echo it back on every update.
                </span>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-xs font-bold text-orange-600">3</span>
              <span>
                Map chats to a role with{' '}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px]">TELEGRAM_CHAT_ROLES=12345:manager,67890:staff</code>.
                Unmapped chats get staff access: look-ups only.
              </span>
            </li>
          </ol>
          <div className="mt-4 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
            <div className="rounded-xl bg-zinc-50 px-3 py-2">
              <div className="font-semibold text-zinc-700">Webhook path</div>
              <div className="mt-0.5 break-all font-mono text-[11px]">{webhookUrl}</div>
            </div>
            <div className="rounded-xl bg-zinc-50 px-3 py-2">
              <div className="font-semibold text-zinc-700">Updates seen</div>
              <div className="mt-0.5 font-mono text-[11px]">
                {stats ? `${stats.updates} updates · ${stats.commands} commands · ${stats.actions} actions · ${stats.skipped} undelivered` : 'API offline — the console below still answers locally'}
              </div>
            </div>
          </div>
        </section>

        {/* ── command list ───────────────────────────────────── */}
        <section className={`${cardCls} p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Command list</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {commands.length} of {TELEGRAM_COMMANDS.length} commands for {botRole} access.
              </p>
            </div>
            <div className="flex rounded-xl border border-zinc-200 p-0.5">
              {['staff', 'manager'].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setBotRole(option)}
                  className={`min-h-8 rounded-lg px-3 text-xs font-semibold capitalize ${botRole === option ? 'bg-orange-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <ul className="mt-3 divide-y divide-zinc-100">
            {commands.map((entry) => (
              <li key={entry.command} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <code className="text-xs font-bold text-zinc-800">
                    {entry.command}{entry.args ? ` ${entry.args}` : ''}
                  </code>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{entry.blurb}</div>
                </div>
                <button
                  type="button"
                  onClick={() => run(entry.command + (entry.args ? ' ' : ''))}
                  className="shrink-0 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:border-orange-300 hover:text-orange-700"
                >
                  Try
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── notifications ────────────────────────────────────── */}
      <section className={`${cardCls} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">What the bot tells you</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-zinc-500">
              The bot does not wait to be asked. Switch on the events worth a ping and it pushes them to every chat it
              can reach — the ones that message it, and the id below.
            </p>
          </div>
          <StatusPill tone={pushChats.length ? 'ok' : 'muted'} size="sm">
            {pushChats.length ? `${pushChats.length} chat${pushChats.length === 1 ? '' : 's'} reachable` : 'no chat yet'}
          </StatusPill>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {NOTIFY_TOGGLES.map(([key, label, blurb, fallback]) => (
              <label key={key} className="flex items-start gap-3 rounded-xl border border-zinc-200 px-3 py-2 hover:border-orange-200">
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={telegramSettings[key] === undefined ? fallback : telegramSettings[key] !== false}
                  onChange={(event) => patchTelegram({ [key]: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-zinc-800">{label}</span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">{blurb}</span>
                </span>
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500" htmlFor="tg-digest-hour">
                Digest hour
              </label>
              <select
                id="tg-digest-hour"
                value={Number(telegramSettings.digestHour ?? 22)}
                onChange={(event) => patchTelegram({ digestHour: Number(event.target.value) })}
                className={`${inputCls} w-28`}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
                ))}
              </select>
              <span className="text-[11px] text-zinc-500">One digest per day, once this hour has passed.</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-200 px-3 py-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500" htmlFor="tg-chat">
                Chat to report to
              </label>
              <input
                id="tg-chat"
                value={telegramSettings.chatId || ''}
                onChange={(event) => patchTelegram({ chatId: event.target.value.trim() })}
                placeholder="-1001234567890"
                className={`${inputCls} mt-1 font-mono text-xs`}
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Any chat that messages the bot is remembered automatically — send it <code className="rounded bg-zinc-100 px-1">/start</code> once.
              </p>
              {push?.lastText ? (
                <div className="mt-2 rounded-lg bg-zinc-50 px-2.5 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Last push · {push.lastTargets?.join(', ') || 'no targets'}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-zinc-600">{push.lastText}</pre>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Close-of-day digest</div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => digestRun(true)} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => digestRun(false)}
                    disabled={digestBusy}
                    className={`${btnPrimary} px-2.5 py-1 text-[11px]`}
                  >
                    <Icon name="send" size={13} /> Send now
                  </button>
                </div>
              </div>
              {digest ? (
                <pre data-testid="digest-preview" className="mt-2 whitespace-pre-wrap font-sans text-[11px] text-zinc-700">{digest.text}</pre>
              ) : (
                <p className="mt-1 text-[11px] text-zinc-500">Preview what tonight looked like, then send it to the chats above.</p>
              )}
              {digestNote ? <p className="mt-1.5 text-[11px] text-zinc-500">{digestNote}</p> : null}
            </div>
          </div>
        </div>
      </section>

      {/* ── console ──────────────────────────────────────────── */}
      <section className={`${cardCls} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Bot console</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {apply
                ? 'Apply mode — commands change this book through the same reducer the webhook uses.'
                : 'Preview mode — commands answer without touching the book.'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
            <input
              type="checkbox"
              checked={apply}
              onChange={(event) => setApply(event.target.checked)}
              className="h-4 w-4 accent-orange-500"
            />
            Apply actions
          </label>
        </div>

        <div
          ref={logRef}
          data-testid="telegram-transcript"
          className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-zinc-50 p-3"
        >
          {transcript.map((row) => (
            <div key={row.id} className={`flex ${row.from === 'me' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                row.from === 'me' ? 'bg-sky-500 text-white' : 'bg-white text-zinc-800'
              }`}
              >
                <pre className="whitespace-pre-wrap font-sans">{row.text}</pre>
                {row.actions && (
                  <div className="mt-2 border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-500">
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
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="/today"
            aria-label="Bot command"
            className={inputCls}
          />
          <button type="submit" className={btnPrimary} disabled={busy}>
            <Icon name="send" size={16} /> Send
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['/today', '/low', '/stock salmon', '/orders', '/pnl', '/po', '/help'].map((shortcut) => (
            <button
              key={shortcut}
              type="button"
              onClick={() => run(shortcut)}
              className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 hover:border-orange-300 hover:text-orange-700"
            >
              {shortcut}
            </button>
          ))}
        </div>
      </section>

      {/* ── mini app ─────────────────────────────────────────── */}
      <section className={`${cardCls} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Telegram mini app</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-zinc-500">
              The guest menu packaged for Telegram: the same QR surface, opened from the chat instead of the table tent.
              Open it from a bot reply, a menu button, or the link below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500" htmlFor="tg-table">Table</label>
            <select
              id="tg-table"
              value={tableId}
              onChange={(event) => setTableId(event.target.value)}
              className={`${inputCls} w-40`}
            >
              {state.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-2xl bg-white p-4 text-center ring-1 ring-zinc-200">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Restora · mini app</div>
            <div className="mx-auto mt-3 w-fit rounded-xl border-4 border-zinc-900 p-2">
              <QRCodeSVG value={miniAppUrl} size={168} level="M" />
            </div>
            <div className="mt-3 break-all font-mono text-[10px] text-zinc-400">{miniAppUrl}</div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <a href={miniAppUrl} target="_blank" rel="noreferrer" className={btnGhost}>
                Open mini app ↗
              </a>
            </div>
          </div>

          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-zinc-200">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-600">
                <span>Live preview · {miniAppUrl.replace(origin, '')}</span>
                <a href={miniAppUrl} target="_blank" rel="noreferrer" className="text-orange-600 hover:underline">reload ↗</a>
              </div>
              <iframe
                title="Telegram mini app preview"
                src={miniAppUrl}
                className="h-[420px] w-full bg-stone-100"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBAPP_APIS.map(([api, blurb]) => (
                <div key={api} className="rounded-xl bg-zinc-50 px-3 py-2">
                  <div className="font-mono text-[11px] font-semibold text-zinc-700">{api}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{blurb}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              Outside Telegram the mini app still runs as an ordinary web page — the Telegram APIs are feature-detected,
              so a plain browser shows the same menu without the platform chrome.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
