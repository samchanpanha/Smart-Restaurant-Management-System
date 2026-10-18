import { useEffect, useState } from 'react'
import { Icon } from '../../../components/Icon'
import StatusPill from '../../../components/StatusPill'
import { Button, Card, Field, Input, SectionHeader } from '../../../components/ui'
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

/** A numbered caption for a field — "1 · Bot token" reads as a step. */
function StepLabel({ step, children }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">
        {step}
      </span>
      <span>{children}</span>
    </span>
  )
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
      <Card as="section">
        <SectionHeader
          icon={<Icon name="message" size={16} className="text-[var(--accent)]" />}
          title="Step 1 · Connect your bot"
          sub="Paste the bot token BotFather sent you and the public address of this deployment. Owner only — the server enforces it."
          actions={(
            <span data-testid="telegram-config-status">
              <StatusPill tone={configured ? 'ok' : 'warn'} size="sm">{configured ? 'On' : 'Off'}</StatusPill>
            </span>
          )}
        />

        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading configuration…</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={<StepLabel step={1}>Bot token</StepLabel>}
                hint={hasToken
                  ? `A token is already set (${TOKEN_SOURCE_LABEL[tokenSource] || tokenSource}). Type a new one to replace it.`
                  : 'From @BotFather. Stored per restaurant, never shown again after saving.'}
              >
                <Input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                  maxLength={120}
                  placeholder={hasToken ? '•••••••• (unchanged)' : '123456789:AA…'}
                  data-testid="telegram-config-token"
                />
              </Field>
              <Field
                label={<StepLabel step={2}>Base URL</StepLabel>}
                hint="Where guest QR and mini-app links point. Leave blank to use this deployment’s own address."
              >
                <Input
                  type="url"
                  value={publicUrl}
                  onChange={(event) => setPublicUrl(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  maxLength={300}
                  placeholder={publicUrlEffective || 'https://your-restaurant.example.com'}
                  data-testid="telegram-config-url"
                />
              </Field>
            </div>

            <div
              className="mt-3 flex flex-wrap items-center gap-1.5 rounded-[var(--radius-lg)] bg-[var(--surface-hover)] px-3 py-2 text-[11px] text-[var(--text-muted)]"
              data-testid="telegram-config-url-effective"
            >
              <Icon name="send" size={13} className="text-[var(--text-subtle)]" />
              <span>Guest links use</span>
              <span className="font-semibold text-[var(--text)]">
                {publicUrlEffective || 'no address yet'}
              </span>
              <span>({URL_SOURCE_LABEL[publicUrlSource] || publicUrlSource}).</span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                data-testid="telegram-config-save"
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
              >
                <Icon name="check" size={15} />
                {saving ? 'Saving…' : 'Save Telegram settings'}
              </Button>
              {hasToken && (
                <Button
                  type="button"
                  variant="danger"
                  disabled={saving}
                  onClick={() => save({ token: '' }, 'Token removed — the bot stays quiet until one is saved.')}
                >
                  Remove token
                </Button>
              )}
            </div>

            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <Icon name="send" size={13} className="text-[var(--text-subtle)]" />
              <span>Token source:</span>
              <span className="font-semibold text-[var(--text)]">{TOKEN_SOURCE_LABEL[tokenSource] || tokenSource}</span>
            </p>

            {error && (
              <p className="mt-3 rounded-[var(--radius-lg)] bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--danger)]" data-testid="telegram-config-error">
                {error}
              </p>
            )}
            {notice && (
              <p className="mt-3 rounded-[var(--radius-lg)] bg-[var(--success-soft)] px-3 py-2 text-xs font-semibold text-[var(--success)]" role="status">
                {notice}
              </p>
            )}
          </>
        )}
      </Card>

      <Card as="section">
        <SectionHeader
          icon={<Icon name="sparkles" size={16} className="text-[var(--accent)]" />}
          title="What happens next"
          sub="Saved on the server, never in the synced state guests can read."
        />
        <ol className="space-y-2.5">
          {[
            'Register the webhook from the Telegram screen — one click does it.',
            'The token is stored per restaurant and never sent back to the browser.',
            'Chat commands, pushes, and the close-of-day digest all use this token — no restart needed.',
            'Guest QR / mini-app links are built from the Base URL. Blank means this deployment’s own address.',
            'With no token set anywhere, Telegram stays silent and the rest of Restora is unchanged.',
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
                <Icon name="check" size={12} />
              </span>
              <span className="text-xs leading-relaxed text-[var(--text-muted)]">{line}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}

export { TelegramSection }
