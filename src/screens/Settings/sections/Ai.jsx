import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { aiGetConfig, aiSaveConfig, aiStatus, aiTestConfig } from '../../../lib/ai-client'
import { Card, Field, inputCls } from '../primitives'

// Tenant AI provider config. Stored server-side (never in the synced state,
// because guests can read /api/state). Owner / super admin only — the server
// enforces this regardless of what this screen renders.
//
// Two levels of configuration:
//   1. the primary provider/model/endpoint/key, and
//   2. a failover pool (`keys`): more keys, for the same vendor or different
//      ones, tried in order when a key is rate-limited, out of quota, or down.
//      With `rotate` on, requests are spread across the whole pool instead.
//
// Every key is write-only: we load `hasKey`/`keySource`, never a key value.
// Leaving a key field blank on save keeps the stored key; typing replaces it;
// "Remove" clears it. The pattern the server follows is documented in
// server/ai-config.js.

const KEY_SOURCE_LABEL = {
  tenant: 'Saved here',
  environment: 'From server environment',
  none: 'Not configured',
}

const TIER_LABEL = {
  free: 'Free tier',
  cheap: 'Low cost',
  paid: 'Paid',
  local: 'Runs locally',
}

const TIER_CLASS = {
  free: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cheap: 'bg-sky-50 text-sky-700 ring-sky-200',
  paid: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
  local: 'bg-violet-50 text-violet-700 ring-violet-200',
}

const FALLBACK_PROVIDERS = [{ id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini', models: [], tier: 'paid' }]

// Health of one key in the failover chain, as reported by /api/ai/status
// (staff only). A key is 'cooldown' right after it failed: Restora is skipping
// it until the cooldown expires, which is exactly what an owner wants to see.
const HEALTH_LABEL = {
  ok: 'Working',
  cooldown: 'Cooling down',
  error: 'Failed',
  idle: 'Not used yet',
}

const HEALTH_CLASS = {
  ok: 'bg-emerald-50 text-emerald-700',
  cooldown: 'bg-amber-50 text-amber-800',
  error: 'bg-red-50 text-red-700',
  idle: 'bg-zinc-100 text-zinc-500',
}

function TierBadge({ tier }) {
  if (!tier) return null
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-4xs font-bold uppercase tracking-wide ring-1 ring-inset ${TIER_CLASS[tier] || TIER_CLASS.paid}`}>
      {TIER_LABEL[tier] || tier}
    </span>
  )
}

function AiSection() {
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [providers, setProviders] = useState([])
  const [keys, setKeys] = useState([])
  const [rotate, setRotate] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keySource, setKeySource] = useState('none')
  const [configured, setConfigured] = useState(false)
  const [keyCount, setKeyCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingKeys, setSavingKeys] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingKey, setTestingKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [test, setTest] = useState(null)
  const [keyTests, setKeyTests] = useState({})
  const [keysDirty, setKeysDirty] = useState(false)
  const [poolHealth, setPoolHealth] = useState([])

  function apply(view) {
    if (!view || view.ok === false) return
    setProvider(view.provider || 'openai')
    setModel(view.model || '')
    setBaseUrl(view.baseUrl || '')
    setProviders(Array.isArray(view.providers) && view.providers.length ? view.providers : FALLBACK_PROVIDERS)
    setKeys(Array.isArray(view.keys)
      ? view.keys.map((entry) => ({
        id: entry.id,
        label: entry.label || '',
        provider: entry.provider || view.provider || 'openai',
        model: entry.model || '',
        baseUrl: entry.baseUrl || '',
        apiKey: '',
        hasKey: Boolean(entry.hasKey),
        enabled: entry.enabled !== false,
      }))
      : [])
    setRotate(Boolean(view.rotate))
    setHasKey(Boolean(view.hasKey))
    setKeySource(view.keySource || 'none')
    setConfigured(Boolean(view.configured))
    setKeyCount(Number(view.keyCount || 0))
    setApiKey('')
    setKeysDirty(false)
  }

  // Health is a separate, staff-only read: it reflects live failures, not the
  // stored configuration.
  async function refreshHealth() {
    const status = await aiStatus()
    setPoolHealth(Array.isArray(status?.pool) ? status.pool : [])
  }

  useEffect(() => {
    let alive = true
    refreshHealth()
    aiGetConfig().then((view) => {
      if (!alive) return
      if (view.ok === false && view.status === 403) setError(view.error || 'Owner access required.')
      else if (view.ok === false && view.status === 401) setError('Sign in to configure the assistant.')
      else apply(view)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const catalogue = providers.length ? providers : FALLBACK_PROVIDERS
  const selectedProvider = useMemo(
    () => catalogue.find((entry) => entry.id === provider),
    [catalogue, provider],
  )

  function metaFor(id) {
    return catalogue.find((entry) => entry.id === id)
  }

  function changeProvider(next) {
    setProvider(next)
    // Swap in the new provider's default model when we're still on a default.
    const meta = metaFor(next)
    if (meta && (!model || catalogue.some((entry) => entry.defaultModel === model))) setModel(meta.defaultModel || '')
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

  async function saveKeys(extra = {}) {
    if (savingKeys) return
    setSavingKeys(true); setError(''); setNotice(''); setTest(null)
    const payload = {
      rotate: extra.rotate ?? rotate,
      keys: keys.map((entry) => ({
        id: entry.id,
        label: entry.label,
        provider: entry.provider,
        model: entry.model,
        baseUrl: entry.baseUrl,
        enabled: entry.enabled,
        // Only send a key when one was typed — otherwise the stored one stays.
        ...(entry.apiKey.trim() ? { apiKey: entry.apiKey.trim() } : {}),
      })),
    }
    const res = await aiSaveConfig(payload)
    setSavingKeys(false)
    if (res.ok === false) { setError(res.error || 'Could not save the keys.'); return }
    apply(res)
    setNotice('Saved. Restora now falls back through these keys.')
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

  async function runKeyTest(entry) {
    if (testingKey) return
    setTestingKey(entry.id); setError(''); setNotice('')
    // An unsaved key is tested directly; a stored one is tested by id so its
    // secret never has to come back to the browser.
    const payload = entry.apiKey.trim()
      ? { provider: entry.provider, model: entry.model, baseUrl: entry.baseUrl, apiKey: entry.apiKey.trim() }
      : { keyId: entry.id }
    const res = await aiTestConfig(payload)
    setTestingKey('')
    setKeyTests((prev) => ({ ...prev, [entry.id]: res }))
  }

  function patchKey(id, patch) {
    setKeys((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
    setKeysDirty(true)
  }

  function addKey() {
    const id = `key-${Date.now().toString(36)}`
    setKeys((prev) => [...prev.slice(0, 11), {
      id,
      label: '',
      provider,
      model: '',
      baseUrl: '',
      apiKey: '',
      hasKey: false,
      enabled: true,
    }])
    setKeysDirty(true)
  }

  function removeKey(id) {
    setKeys((prev) => prev.filter((entry) => entry.id !== id))
    setKeysDirty(true)
  }

  const statusTone = configured ? 'ok' : 'warn'
  const freeOptions = catalogue.filter((entry) => entry.tier === 'free' || entry.tier === 'local')
  const healthById = new Map(poolHealth.map((entry) => [entry.id, entry]))
  const primaryHealth = healthById.get('primary')

  return (
    <div className="space-y-4">
      <Card
        title="AI assistant"
        sub="Connect a language model so the Ops Copilot, dashboard advisors, and guest concierge work. Read-only: the model never changes your data."
        actions={(
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold ${statusTone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} data-testid="ai-config-status">
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {configured ? `On · ${keyCount} key${keyCount === 1 ? '' : 's'}` : 'Off'}
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
                  {catalogue.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}{entry.tier === 'free' ? ' — free tier' : entry.tier === 'local' ? ' — local' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Model" hint={selectedProvider ? `Default: ${selectedProvider.defaultModel}` : undefined}>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  maxLength={120}
                  list="ai-model-suggestions"
                  className={inputCls}
                  placeholder={selectedProvider?.defaultModel || 'model id'}
                  data-testid="ai-config-model"
                />
                <datalist id="ai-model-suggestions">
                  {(selectedProvider?.models || []).map((id) => <option key={id} value={id} />)}
                </datalist>
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
                {(selectedProvider?.alternates || []).length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {selectedProvider.alternates.map((alt) => (
                      <button
                        key={alt.baseUrl}
                        type="button"
                        onClick={() => setBaseUrl(alt.baseUrl)}
                        className="rounded-full bg-zinc-100 px-2.5 py-1 text-2xs font-semibold text-zinc-600 hover:bg-zinc-200"
                      >
                        {alt.label}
                      </button>
                    ))}
                  </span>
                )}
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

            {selectedProvider?.note && (
              <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-zinc-50 px-3 py-2 text-2xs text-zinc-600">
                <Icon name="sparkles" size={13} className="mt-0.5 shrink-0 text-zinc-400" />
                <span>
                  {selectedProvider.note}
                  {selectedProvider.keysUrl && (
                    <>
                      {' '}
                      <a className="font-semibold text-orange-600 hover:underline" href={selectedProvider.keysUrl} target="_blank" rel="noreferrer">
                        Get a key
                      </a>
                    </>
                  )}
                </span>
              </p>
            )}

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
                disabled={testing || (!configured && !apiKey.trim() && provider !== 'ollama' && provider !== 'lmstudio')}
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

            <p className="mt-3 flex items-center gap-1.5 text-2xs text-zinc-500">
              <Icon name="send" size={13} className="text-zinc-400" />
              Key source: <span className="font-semibold text-zinc-700">{KEY_SOURCE_LABEL[keySource] || keySource}</span>
              {keyCount > 1 && <span className="text-zinc-400">· {keyCount} keys in the failover chain</span>}
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

      <Card
        title="Failover keys"
        sub="Add more keys — several DeepSeek keys, Qwen, a free provider, or a local model. Restora tries the primary first and steps down the list when a key is rate-limited, out of quota, or unreachable."
        actions={(
          <span className="flex items-center gap-2">
            {primaryHealth && (
              <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${HEALTH_CLASS[primaryHealth.status] || HEALTH_CLASS.idle}`} title={primaryHealth.lastError || ''}>
                Primary: {HEALTH_LABEL[primaryHealth.status] || primaryHealth.status}
              </span>
            )}
            {keys.length > 0 && <span className="text-2xs font-semibold text-zinc-500">{keys.length} backup key{keys.length === 1 ? '' : 's'}</span>}
            <button type="button" onClick={refreshHealth} className="text-2xs font-semibold text-zinc-500 hover:text-zinc-800">Refresh</button>
          </span>
        )}
      >
        <div className="space-y-3" data-testid="ai-config-pool">
          {primaryHealth && (primaryHealth.failures > 0 || primaryHealth.status !== 'idle') && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-2xs text-zinc-600" data-testid="ai-config-primary-health">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${HEALTH_CLASS[primaryHealth.status] || HEALTH_CLASS.idle}`}>
                Primary key · {HEALTH_LABEL[primaryHealth.status] || primaryHealth.status}
              </span>
              <span>
                {primaryHealth.provider} · {primaryHealth.model}
                {primaryHealth.failures > 0 ? ` · ${primaryHealth.failures} failed attempt(s)` : ''}
                {primaryHealth.lastError ? ` · ${primaryHealth.lastError}` : ''}
              </span>
            </p>
          )}
          {keys.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-xs text-zinc-500">
              No backup keys yet. One key is enough to start — add a second when you want the assistant to keep answering through a rate limit.
            </p>
          )}

          {keys.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3" data-testid="ai-config-key-row">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex items-center gap-2 pb-2 text-2xs font-semibold text-zinc-600">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(event) => patchKey(entry.id, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-orange-500"
                  />
                  Enabled
                </label>
                <div className="min-w-[150px] flex-1">
                  <Field label="Label">
                    <input
                      value={entry.label}
                      onChange={(event) => patchKey(entry.id, { label: event.target.value })}
                      maxLength={60}
                      className={inputCls}
                      placeholder="Kitchen team key"
                    />
                  </Field>
                </div>
                <div className="min-w-[150px] flex-1">
                  <Field label="Provider">
                    <select
                      value={entry.provider}
                      onChange={(event) => patchKey(entry.id, { provider: event.target.value })}
                      className={inputCls}
                    >
                      {catalogue.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="min-w-[130px] flex-1">
                  <Field label="Model">
                    <input
                      value={entry.model}
                      onChange={(event) => patchKey(entry.id, { model: event.target.value })}
                      maxLength={120}
                      className={inputCls}
                      placeholder={metaFor(entry.provider)?.defaultModel || 'default'}
                    />
                  </Field>
                </div>
                <div className="min-w-[170px] flex-[1.2]">
                  <Field label="API key">
                    <input
                      type="password"
                      value={entry.apiKey}
                      onChange={(event) => patchKey(entry.id, { apiKey: event.target.value })}
                      autoComplete="off"
                      className={inputCls}
                      placeholder={entry.hasKey ? '•••••••• (saved)' : 'sk-…'}
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                  <button
                    type="button"
                    disabled={testingKey === entry.id || (!entry.hasKey && !entry.apiKey.trim())}
                    onClick={() => runKeyTest(entry)}
                    className="min-h-10 rounded-xl border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40"
                  >
                    {testingKey === entry.id ? 'Testing…' : 'Test'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeKey(entry.id)}
                    aria-label={`Remove ${entry.label || 'key'}`}
                    className="min-h-10 rounded-xl border border-red-200 bg-white px-3 text-2xs font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {healthById.has(entry.id) && (
                <p className="mt-2 flex items-center gap-2 text-2xs text-zinc-500">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${HEALTH_CLASS[healthById.get(entry.id).status] || HEALTH_CLASS.idle}`}>
                    {HEALTH_LABEL[healthById.get(entry.id).status] || healthById.get(entry.id).status}
                  </span>
                  {healthById.get(entry.id).failures > 0 && <span>{healthById.get(entry.id).failures} failed attempt(s){healthById.get(entry.id).lastError ? ` · ${healthById.get(entry.id).lastError}` : ''}</span>}
                </p>
              )}
              {keyTests[entry.id] && (
                <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-2xs font-semibold ${keyTests[entry.id].ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                  {keyTests[entry.id].ok
                    ? `Key OK — ${keyTests[entry.id].provider} · ${keyTests[entry.id].model} replied.`
                    : `Key failed: ${keyTests[entry.id].error || 'no reply'}`}
                </p>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addKey}
              className="min-h-10 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              data-testid="ai-config-key-add"
            >
              + Add backup key
            </button>
            <button
              type="button"
              disabled={savingKeys || !keysDirty}
              onClick={() => saveKeys()}
              data-testid="ai-config-key-save"
              className="min-h-10 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savingKeys ? 'Saving…' : 'Save keys'}
            </button>
            {keysDirty && <span className="text-2xs font-semibold text-amber-700" data-testid="ai-config-key-dirty">Unsaved changes</span>}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
            <input
              type="checkbox"
              checked={rotate}
              onChange={(event) => { setRotate(event.target.checked); setKeysDirty(true) }}
              className="mt-0.5 h-4 w-4 accent-orange-500"
              data-testid="ai-config-rotate"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-zinc-800">Spread requests across all keys</span>
              <span className="mt-0.5 block text-2xs text-zinc-500">
                Off (default): the primary key answers, and the list is only used when it fails. On: every request takes the next key in turn, which spreads rate limits.
              </span>
            </span>
          </label>
        </div>
      </Card>

      {freeOptions.length > 0 && (
        <Card title="Free and local options" sub="Providers that need no credit card. Pick one, paste a key, done.">
          <ul className="space-y-2">
            {freeOptions.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-800">{entry.label}</span>
                    <TierBadge tier={entry.tier} />
                  </div>
                  <p className="mt-0.5 text-2xs text-zinc-500">
                    {entry.note || `Suggested model: ${entry.defaultModel}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeProvider(entry.id)}
                    className="min-h-9 rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Use this
                  </button>
                  {entry.keysUrl && (
                    <a
                      href={entry.keysUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-9 rounded-lg px-3 py-2 text-2xs font-semibold text-orange-600 hover:bg-orange-50"
                    >
                      Get a key
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="How it works" sub="A short note on data and safety.">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-zinc-600">
          <li>The assistant is <strong>read-only</strong> — it can summarise and advise, but never edits orders, stock, or settings.</li>
          <li>Guests only ever reach the menu scope; staff get the operational view.</li>
          <li>Keys are stored per restaurant, are write-only over the API, and never appear in the synced state guests can read.</li>
          <li>A key that starts failing steps aside for a minute so the next key answers instead of every request paying for the failure.</li>
          <li>With no key set anywhere — primary, backup, or environment — every AI surface stays hidden and the rest of Restora is unchanged.</li>
          <li>Local providers (Ollama, LM Studio) need no key at all: point the base URL at the machine running the model.</li>
        </ul>
      </Card>
    </div>
  )
}

export { AiSection }
