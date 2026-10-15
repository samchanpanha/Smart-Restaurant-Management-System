import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { aiGetConfig, aiSaveConfig, aiTestConfig } from '../../../lib/ai-client'
import { Card, Field, inputCls } from '../primitives'

// Tenant AI provider config. Stored server-side (never in the synced state,
// because guests can read /api/state). Owner / super admin only — the server
// enforces this regardless of what this screen renders.
//
// The key is write-only: we load `hasKey`/`keySource`, never the key itself.
// Leaving the key field blank on save keeps the stored key; typing replaces
// it; the explicit "Remove" button clears it and falls back to the server env.

const KEY_SOURCE_LABEL = {
  tenant: 'Saved here',
  environment: 'From server environment',
  none: 'Not configured',
}

function AiSection() {
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [providers, setProviders] = useState([])
  const [hasKey, setHasKey] = useState(false)
  const [keySource, setKeySource] = useState('none')
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [test, setTest] = useState(null)

  function apply(view) {
    if (!view || view.ok === false) return
    setProvider(view.provider || 'openai')
    setModel(view.model || '')
    setBaseUrl(view.baseUrl || '')
    setProviders(Array.isArray(view.providers) ? view.providers : [])
    setHasKey(Boolean(view.hasKey))
    setKeySource(view.keySource || 'none')
    setConfigured(Boolean(view.configured))
    setApiKey('')
  }

  useEffect(() => {
    let alive = true
    aiGetConfig().then((view) => {
      if (!alive) return
      if (view.ok === false && view.status === 403) setError(view.error || 'Owner access required.')
      else if (view.ok === false && view.status === 401) setError('Sign in to configure the assistant.')
      else apply(view)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const selectedProvider = useMemo(
    () => providers.find((entry) => entry.id === provider),
    [providers, provider],
  )

  function changeProvider(next) {
    setProvider(next)
    // Swap in the new provider's default model when we're still on a default.
    const meta = providers.find((entry) => entry.id === next)
    if (meta && (!model || providers.some((entry) => entry.defaultModel === model))) setModel(meta.defaultModel || '')
  }

  async function save(extra = {}) {
    if (saving) return
    setSaving(true); setError(''); setNotice(''); setTest(null)
    const payload = { provider, model, baseUrl, ...extra }
    if (!('apiKey' in extra) && apiKey.trim()) payload.apiKey = apiKey.trim()
    const res = await aiSaveConfig(payload)
    setSaving(false)
    if (res.ok === false) { setError(res.error || 'Could not save.'); return }
    apply(res)
    setNotice('Saved. New requests use this configuration.')
  }

  async function runTest() {
    if (testing) return
    setTesting(true); setError(''); setNotice(''); setTest(null)
    const payload = { provider, model, baseUrl }
    if (apiKey.trim()) payload.apiKey = apiKey.trim()
    const res = await aiTestConfig(payload)
    setTesting(false)
    setTest(res)
  }

  const statusTone = configured ? 'ok' : 'warn'

  return (
    <div className="space-y-4">
      <Card
        title="AI assistant"
        sub="Connect a language model so the Ops Copilot, dashboard advisors, and guest concierge work. Read-only: the model never changes your data."
        actions={(
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} data-testid="ai-config-status">
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {configured ? 'On' : 'Off'}
          </span>
        )}
      >
        {loading ? (
          <p className="text-sm text-zinc-500">Loading configuration…</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Provider">
                <select
                  value={provider}
                  onChange={(event) => changeProvider(event.target.value)}
                  className={inputCls}
                  data-testid="ai-config-provider"
                >
                  {providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </select>
              </Field>
              <Field label="Model" hint={selectedProvider ? `Default: ${selectedProvider.defaultModel}` : undefined}>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  maxLength={120}
                  className={inputCls}
                  placeholder={selectedProvider?.defaultModel || 'model id'}
                  data-testid="ai-config-model"
                />
              </Field>
              <Field label="Base URL" hint="Leave blank for the provider default. Use an http(s) URL to self-host or proxy.">
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  maxLength={300}
                  className={inputCls}
                  placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://…'}
                  data-testid="ai-config-base"
                />
              </Field>
              <Field label="API key" hint={hasKey ? `A key is already set (${KEY_SOURCE_LABEL[keySource] || keySource}). Type a new one to replace it.` : 'Stored per restaurant, never shown again after saving.'}>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  className={inputCls}
                  placeholder={hasKey ? '•••••••• (unchanged)' : 'sk-…'}
                  data-testid="ai-config-key"
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => save()}
                data-testid="ai-config-save"
                className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save AI settings'}
              </button>
              <button
                type="button"
                disabled={testing || !configured && !apiKey.trim()}
                onClick={runTest}
                data-testid="ai-config-test"
                className="min-h-10 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              {(keySource === 'tenant' || hasKey) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({ apiKey: '', removeKey: true })}
                  className="min-h-10 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                >
                  Remove key
                </button>
              )}
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Icon name="send" size={13} className="text-zinc-400" />
              Key source: <span className="font-semibold text-zinc-700">{KEY_SOURCE_LABEL[keySource] || keySource}</span>
            </p>

            {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" data-testid="ai-config-error">{error}</p>}
            {notice && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</p>}
            {test && (
              <p
                className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${test.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                data-testid="ai-config-test-result"
              >
                {test.ok ? `Connection OK — ${test.provider} · ${test.model} replied.` : `Test failed: ${test.error || 'no reply'}`}
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="How it works" sub="A short note on data and safety.">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-zinc-600">
          <li>The assistant is <strong>read-only</strong> — it can summarise and advise, but never edits orders, stock, or settings.</li>
          <li>Guests only ever reach the menu scope; staff get the operational view.</li>
          <li>The key is stored per restaurant and is never sent back to the browser.</li>
          <li>With no key set anywhere, every AI surface stays hidden and the rest of Restora is unchanged.</li>
        </ul>
      </Card>
    </div>
  )
}

export { AiSection }
