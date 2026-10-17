import { useEffect, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Card, Field, inputCls } from '../primitives'
import { tgGetConfig, tgSaveConfig } from '../../../lib/telegram-client'

// Telegram bot token — one field, saved from here. Stored server-side in
// the SQLite kv table (never in the synced state, because guests read
// /api/state); the browser only ever sees hasToken/tokenSource. Owner /
// super admin only — the server enforces that regardless of this screen.
// A save takes effect on the next message, no restart.

const TOKEN_SOURCE_LABEL = {
  tenant: 'Saved here',
  environment: 'From server environment',
  none: 'Not configured',
}

function TelegramSection() {
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [tokenSource, setTokenSource] = useState('none')
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function apply(view) {
    if (!view || view.ok === false) return
    setHasToken(Boolean(view.hasToken))
    setTokenSource(view.tokenSource || 'none')
    setConfigured(Boolean(view.configured))
    setToken('')
  }

  useEffect(() => {
    let alive = true
    tgGetConfig().then((view) => {
      if (!alive) return
      if (view.ok === false && view.status === 403) setError(view.error || 'Owner access required.')
      else if (view.ok === false && view.status === 401) setError('Sign in to configure the bot.')
      else if (view.ok === false) setError(view.error || 'Could not load the bot configuration.')
      else apply(view)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  async function save(value) {
    if (saving) return
    setSaving(true); setError(''); setNotice('')
    const res = await tgSaveConfig(value)
    setSaving(false)
    if (res.ok === false) { setError(res.error || 'Could not save.'); return }
    apply(res)
    setNotice(value.trim()
      ? 'Saved. The bot uses this token on its next message.'
      : 'Token removed — the bot stays quiet until one is saved.')
  }

  // Saving an empty field must never erase the stored token — removal only
  // happens through the explicit Remove button.
  const canSave = token.trim().length > 0

  return (
    <div className="space-y-4">
      <Card
        title="Telegram bot & mini app"
        sub="Paste the bot token BotFather sent you: chat commands for the manager, guest QR / mini app ordering for the table."
        actions={(
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} data-testid="telegram-config-status">
            <span className={`h-1.5 w-1.5 rounded-full ${configured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {configured ? 'On' : 'Off'}
          </span>
        )}
      >
        {loading ? (
          <p className="text-sm text-zinc-500">Loading configuration…</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Bot token"
                hint={hasToken
                  ? `A token is already set (${TOKEN_SOURCE_LABEL[tokenSource] || tokenSource}). Type a new one to replace it.`
                  : 'From @BotFather. Stored per restaurant, never shown again after saving.'}
              >
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                  maxLength={120}
                  className={inputCls}
                  placeholder={hasToken ? '•••••••• (unchanged)' : '123456789:AA…'}
                  data-testid="telegram-config-token"
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving || !canSave}
                onClick={() => save(token.trim())}
                data-testid="telegram-config-save"
                className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save Telegram settings'}
              </button>
              {hasToken && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save('')}
                  className="min-h-10 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                >
                  Remove token
                </button>
              )}
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Icon name="send" size={13} className="text-zinc-400" />
              Token source: <span className="font-semibold text-zinc-700">{TOKEN_SOURCE_LABEL[tokenSource] || tokenSource}</span>
            </p>

            {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" data-testid="telegram-config-error">{error}</p>}
            {notice && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</p>}
          </>
        )}
      </Card>

      <Card title="How it works" sub="A short note on where the token lives.">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-zinc-600">
          <li>The token is stored per restaurant and is never sent back to the browser.</li>
          <li>Chat commands, pushes, and the close-of-day digest all use this token — no restart needed.</li>
          <li>With no token set anywhere, Telegram stays silent and the rest of Restora is unchanged.</li>
          <li>Point Telegram's webhook at <code className="rounded bg-zinc-100 px-1">/api/telegram/webhook</code> to receive commands.</li>
        </ul>
      </Card>
    </div>
  )
}

export { TelegramSection }
