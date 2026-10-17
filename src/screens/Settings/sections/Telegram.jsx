import { useEffect, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Card, Field, inputCls } from '../primitives'
import { tgGetConfig, tgSaveConfig } from '../../../lib/telegram-client'

// Telegram bot & mini app — two fields, saved from here. Both are stored
// server-side in the SQLite kv table (never in the synced state, because
// guests read /api/state): the token (write-only — the browser only ever
// sees hasToken/tokenSource) and the Base URL that /qr and mini-app links
// are built from (read back, so the field can show what is stored).
// Owner / super admin only — the server enforces that regardless of this
// screen. A save takes effect on the next message, no restart.

const TOKEN_SOURCE_LABEL = {
  tenant: 'Saved here',
  environment: 'From server environment',
  none: 'Not configured',
}

const URL_SOURCE_LABEL = {
  tenant: 'Saved here',
  environment: 'This deployment',
  none: 'Not set',
}

function TelegramSection() {
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [tokenSource, setTokenSource] = useState('none')
  const [configured, setConfigured] = useState(false)
  // publicUrl is the field's text; savedUrl is what the server currently
  // stores — the difference is what makes the Save button enabled.
  const [publicUrl, setPublicUrl] = useState('')
  const [savedUrl, setSavedUrl] = useState('')
  const [publicUrlEffective, setPublicUrlEffective] = useState('')
  const [publicUrlSource, setPublicUrlSource] = useState('none')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function apply(view) {
    if (!view || view.ok === false) return
    setHasToken(Boolean(view.hasToken))
    setTokenSource(view.tokenSource || 'none')
    setConfigured(Boolean(view.configured))
    const storedUrl = String(view.publicUrl || '')
    setPublicUrl(storedUrl)
    setSavedUrl(storedUrl)
    setPublicUrlEffective(String(view.publicUrlEffective || ''))
    setPublicUrlSource(view.publicUrlSource || 'none')
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

  // Only what actually changed travels: an untouched token field must never
  // erase the stored token (removal is the explicit button), and an untouched
  // URL field must never overwrite it.
  function patch() {
    const next = {}
    if (token.trim()) next.token = token.trim()
    if (publicUrl.trim() !== savedUrl) next.publicUrl = publicUrl.trim()
    return next
  }

  async function save(body, message) {
    if (saving) return
    setSaving(true); setError(''); setNotice('')
    const res = await tgSaveConfig(body)
    setSaving(false)
    if (res.ok === false) { setError(res.error || 'Could not save.'); return }
    apply(res)
    setNotice(typeof message === 'function' ? message() : message)
  }

  const canSave = !saving && (token.trim().length > 0 || publicUrl.trim() !== savedUrl)

  return (
    <div className="space-y-4">
      <Card
        title="Telegram bot & mini app"
        sub="Paste the bot token BotFather sent you and the public address of this deployment: chat commands for the manager, guest QR / mini app ordering for the table."
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
              <Field
                label="Base URL"
                hint="Where guest QR and mini-app links point. Leave blank to use this deployment's own address."
              >
                <input
                  type="url"
                  value={publicUrl}
                  onChange={(event) => setPublicUrl(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  maxLength={300}
                  className={inputCls}
                  placeholder={publicUrlEffective || 'https://your-restaurant.example.com'}
                  data-testid="telegram-config-url"
                />
              </Field>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500" data-testid="telegram-config-url-effective">
              <Icon name="send" size={13} className="text-zinc-400" />
              Guest links use{' '}
              <span className="font-semibold text-zinc-700">
                {publicUrlEffective || 'no address yet'}
              </span>
              {' '}({URL_SOURCE_LABEL[publicUrlSource] || publicUrlSource}).
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canSave}
                onClick={() => {
                  const next = patch()
                  const savedToken = Boolean(next.token)
                  const savedAddress = 'publicUrl' in next
                  save(next, savedToken && savedAddress
                    ? 'Saved — the bot uses the new token and links on its next message.'
                    : savedToken
                      ? 'Saved. The bot uses this token on its next message.'
                      : 'Saved — guest links now use this address.')
                }}
                data-testid="telegram-config-save"
                className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save Telegram settings'}
              </button>
              {hasToken && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({ token: '' }, 'Token removed — the bot stays quiet until one is saved.')}
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

      <Card title="How it works" sub="A short note on where these settings live.">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-zinc-600">
          <li>The token is stored per restaurant and is never sent back to the browser.</li>
          <li>Chat commands, pushes, and the close-of-day digest all use this token — no restart needed.</li>
          <li>Guest QR / mini-app links are built from the Base URL. Blank means the bot uses this deployment&apos;s own address (<code className="rounded bg-zinc-100 px-1">RESTORA_PUBLIC_URL</code>, or Render&apos;s automatic <code className="rounded bg-zinc-100 px-1">RENDER_EXTERNAL_URL</code>).</li>
          <li>With no token set anywhere, Telegram stays silent and the rest of Restora is unchanged.</li>
          <li>Point Telegram&apos;s webhook at <code className="rounded bg-zinc-100 px-1">/api/telegram/webhook</code> to receive commands.</li>
        </ul>
      </Card>
    </div>
  )
}

export { TelegramSection }
