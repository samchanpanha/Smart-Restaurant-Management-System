// ─── AI provider adapters (pure) ─────────────────────────────────────
// One small translation layer over the four wire shapes we care about:
//
//   openai     — /chat/completions, bearer token  (most vendors speak this)
//   anthropic  — /v1/messages, x-api-key
//   gemini     — :generateContent?key=
//   ollama     — /api/chat, no key
//
// Every entry in PROVIDERS declares which wire it speaks plus the practical
// extras the Settings screen needs (suggested model ids, where to get a key,
// whether there is a free tier). Adding a vendor is therefore a data change,
// not a code change — that is the point.
//
// This module is transport-free: it only builds the request and reads the
// reply, so it can be unit-tested with a canned JSON body and no network. The
// server (server/ai.js) owns fetch + timeouts + the API key, and the key pool
// (several keys per vendor, with failover) also lives there.
//
// No `process` or browser globals are referenced at module scope, so this
// file is safe to import on either side of the wire.

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    wire: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    docs: 'https://platform.openai.com/docs/api-reference/chat',
    keysUrl: 'https://platform.openai.com/api-keys',
    tier: 'paid',
  },
  anthropic: {
    label: 'Anthropic',
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-haiku-latest',
    models: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-5', 'claude-opus-4-1'],
    docs: 'https://docs.anthropic.com/en/api/messages',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    tier: 'paid',
  },
  gemini: {
    label: 'Google Gemini',
    wire: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    docs: 'https://ai.google.dev/api/generate-content',
    keysUrl: 'https://aistudio.google.com/apikey',
    tier: 'free',
    note: 'AI Studio keys include a free daily quota, which is usually enough for a single restaurant.',
  },
  deepseek: {
    label: 'DeepSeek',
    wire: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docs: 'https://api-docs.deepseek.com/',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    tier: 'cheap',
    note: 'OpenAI-compatible and very cheap. deepseek-reasoner answers slower but reasons better on menu/cost questions.',
  },
  qwen: {
    label: 'Qwen (Alibaba DashScope, international)',
    wire: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen2.5-72b-instruct', 'qwen2.5-7b-instruct'],
    docs: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
    keysUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1',
    tier: 'free',
    note: 'Use the main-land endpoint for a China account.',
    alternates: [
      { label: 'Mainland China (dashscope.aliyuncs.com)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    ],
  },
  groq: {
    label: 'Groq',
    wire: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
    docs: 'https://console.groq.com/docs/openai',
    keysUrl: 'https://console.groq.com/keys',
    tier: 'free',
    note: 'Generous free tier and the fastest replies of the hosted options — good default for the guest concierge.',
  },
  openrouter: {
    label: 'OpenRouter',
    wire: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
    models: [
      'deepseek/deepseek-chat-v3-0324:free',
      'qwen/qwen3-8b:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
    ],
    docs: 'https://openrouter.ai/docs/quickstart',
    keysUrl: 'https://openrouter.ai/settings/keys',
    tier: 'free',
    note: 'One key reaches many vendors; the `:free` models need no credit. Free models are slow and rate-limited — fine for a briefing, not for a rush.',
  },
  mistral: {
    label: 'Mistral AI',
    wire: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'open-mistral-nemo'],
    docs: 'https://docs.mistral.ai/api/',
    keysUrl: 'https://console.mistral.ai/api-keys/',
    tier: 'free',
    note: 'The free "Experiment" plan covers light assistant use.',
  },
  cerebras: {
    label: 'Cerebras',
    wire: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama3.1-8b',
    models: ['llama3.1-8b', 'llama-3.3-70b', 'qwen-3-32b'],
    docs: 'https://inference-docs.cerebras.ai/',
    keysUrl: 'https://cloud.cerebras.ai/',
    tier: 'free',
  },
  zhipu: {
    label: 'Zhipu GLM (Z.ai)',
    wire: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    docs: 'https://docs.z.ai/guides/develop/openai/introduction',
    keysUrl: 'https://z.ai/manage-apikey/apikey-list',
    tier: 'free',
    note: 'glm-4-flash is free and OpenAI-compatible.',
  },
  moonshot: {
    label: 'Moonshot Kimi',
    wire: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'],
    docs: 'https://platform.moonshot.cn/docs/api/chat',
    keysUrl: 'https://platform.moonshot.cn/console/api-keys',
    tier: 'cheap',
  },
  xai: {
    label: 'xAI Grok',
    wire: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    models: ['grok-3-mini', 'grok-3', 'grok-4'],
    docs: 'https://docs.x.ai/docs/overview',
    keysUrl: 'https://console.x.ai/',
    tier: 'paid',
  },
  together: {
    label: 'Together AI',
    wire: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
    docs: 'https://docs.together.ai/docs/openai-api-compatibility',
    keysUrl: 'https://api.together.ai/settings/api-keys',
    tier: 'paid',
  },
  perplexity: {
    label: 'Perplexity',
    wire: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar',
    models: ['sonar', 'sonar-pro'],
    docs: 'https://docs.perplexity.ai/api-reference/chat-completions',
    keysUrl: 'https://www.perplexity.ai/settings/api',
    tier: 'paid',
  },
  ollama: {
    label: 'Ollama (local)',
    wire: 'ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5', 'qwen3', 'llama3.2', 'mistral', 'gemma3'],
    docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    tier: 'local',
    local: true,
    note: 'Runs on the restaurant’s own hardware: no key, no per-request cost, no data leaving the building.',
  },
  lmstudio: {
    label: 'LM Studio (local)',
    wire: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'qwen2.5-7b-instruct',
    models: ['qwen2.5-7b-instruct', 'llama-3.2-3b-instruct', 'gemma-3-4b'],
    docs: 'https://lmstudio.ai/docs/app/api',
    tier: 'local',
    local: true,
    note: 'Start the local server in LM Studio, leave the key blank.',
  },
}

export const DEFAULT_PROVIDER = 'openai'

// Friendly spellings people actually type (or set in AI_PROVIDER). Aliases
// keep an existing deployment working after a vendor is renamed.
export const PROVIDER_ALIASES = {
  claude: 'anthropic',
  google: 'gemini',
  'google-gemini': 'gemini',
  deepseekai: 'deepseek',
  'deepseek-ai': 'deepseek',
  dashscope: 'qwen',
  aliyun: 'qwen',
  alibaba: 'qwen',
  'qwen-intl': 'qwen',
  tongyi: 'qwen',
  'lm-studio': 'lmstudio',
  'lm_studio': 'lmstudio',
  local: 'ollama',
  glm: 'zhipu',
  zai: 'zhipu',
  'z.ai': 'zhipu',
  kimi: 'moonshot',
  grok: 'xai',
  'open-router': 'openrouter',
  'together-ai': 'together',
}

export function normalizeProvider(name) {
  const key = String(name || '').trim().toLowerCase()
  if (PROVIDERS[key]) return key
  const alias = PROVIDER_ALIASES[key]
  if (alias && PROVIDERS[alias]) return alias
  return DEFAULT_PROVIDER
}

/** Is this a provider that runs without an API key (local inference)? */
export function providerNeedsKey(name) {
  return !PROVIDERS[normalizeProvider(name)].local
}

export function providerDefaults(name) {
  const key = normalizeProvider(name)
  const meta = PROVIDERS[key]
  return { provider: key, baseUrl: meta.baseUrl, model: meta.defaultModel, label: meta.label }
}

/** Catalogue for the Settings screen — no secrets, safe to send anywhere. */
export function listProviders() {
  return Object.entries(PROVIDERS).map(([id, meta]) => ({
    id,
    label: meta.label,
    wire: meta.wire,
    baseUrl: meta.baseUrl,
    defaultModel: meta.defaultModel,
    models: meta.models || [meta.defaultModel],
    docs: meta.docs || '',
    keysUrl: meta.keysUrl || '',
    tier: meta.tier || 'paid',
    local: Boolean(meta.local),
    note: meta.note || '',
    alternates: meta.alternates || [],
  }))
}

/** Metadata for one provider (normalized id). */
export function providerMeta(name) {
  return PROVIDERS[normalizeProvider(name)]
}

// Chat history is shared by every provider; only user/assistant turns are
// legal, and empty content is dropped.
function cleanTurns(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim())
    .map((msg) => ({ role: msg.role, content: msg.content }))
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '')
}

/**
 * Build the provider-specific HTTP request for one completion.
 * Returns { url, headers, body } — still no network.
 */
export function providerRequest({ provider, model, baseUrl, apiKey, system, messages, maxTokens = 700, temperature = 0.2 } = {}) {
  const key = normalizeProvider(provider)
  const meta = PROVIDERS[key]
  const wire = meta.wire
  const base = trimSlash(baseUrl || meta.baseUrl)
  const chosenModel = model || meta.defaultModel
  const turns = cleanTurns(messages)
  const sys = typeof system === 'string' ? system : ''

  if (wire === 'anthropic') {
    return {
      url: `${base}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: chosenModel,
        max_tokens: maxTokens,
        temperature,
        ...(sys ? { system: sys } : {}),
        messages: turns,
      },
    }
  }

  if (wire === 'gemini') {
    const contents = turns.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))
    return {
      url: `${base}/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent?key=${encodeURIComponent(apiKey || '')}`,
      headers: { 'content-type': 'application/json' },
      body: {
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
        contents,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      },
    }
  }

  // openai + ollama share { messages } with an optional system turn.
  const body = {
    model: chosenModel,
    messages: sys ? [{ role: 'system', content: sys }, ...turns] : turns,
  }
  if (wire === 'ollama') {
    return {
      url: `${base}/api/chat`,
      headers: { 'content-type': 'application/json' },
      body: { ...body, stream: false, options: { temperature } },
    }
  }

  const headers = {
    'content-type': 'application/json',
    Authorization: `Bearer ${apiKey || ''}`,
  }
  // OpenRouter attributes traffic by header; without it the free tier is
  // stingier and the dashboard shows an unknown app.
  if (key === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/samchanpanha/Smart-Restaurant-Management-System'
    headers['X-Title'] = 'Restora'
  }
  return {
    url: `${base}/chat/completions`,
    headers,
    body: { ...body, temperature, max_tokens: maxTokens },
  }
}

/**
 * Build the (GET) request that lists the models a key can reach. Model ids
 * change constantly across sixteen vendors, so the Settings screen can ask the
 * provider instead of guessing. Same contract as providerRequest: no network,
 * just { url, headers }.
 */
export function providerModelsRequest({ provider, baseUrl, apiKey } = {}) {
  const key = normalizeProvider(provider)
  const meta = PROVIDERS[key]
  const base = trimSlash(baseUrl || meta.baseUrl)
  if (meta.wire === 'anthropic') {
    return { url: `${base}/v1/models?limit=100`, headers: { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' } }
  }
  if (meta.wire === 'gemini') {
    return { url: `${base}/v1beta/models?key=${encodeURIComponent(apiKey || '')}`, headers: {} }
  }
  if (meta.wire === 'ollama') {
    return { url: `${base}/api/tags`, headers: {} }
  }
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey || ''}` } }
}

/**
 * Read a model list out of a provider response body.
 * Returns { models: string[], error } — sorted, de-duplicated, capped.
 */
export function providerModelsResult({ provider, json } = {}) {
  const wire = PROVIDERS[normalizeProvider(provider)].wire
  const body = json && typeof json === 'object' ? json : {}
  const providerError = body.error?.message || body.error?.status || body.error || null
  if (providerError && typeof providerError === 'string') return { models: [], error: providerError }

  let ids = []
  if (wire === 'gemini') {
    ids = (body.models || []).map((entry) => String(entry?.name || '').replace(/^models\//, ''))
  } else if (wire === 'ollama') {
    ids = (body.models || []).map((entry) => String(entry?.name || entry?.model || ''))
  } else {
    const list = Array.isArray(body.data) ? body.data : (Array.isArray(body.models) ? body.models : [])
    ids = list.map((entry) => (typeof entry === 'string' ? entry : String(entry?.id || entry?.name || '')))
  }
  const models = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 200)
  return models.length ? { models, error: null } : { models: [], error: 'no models returned' }
}

/**
 * Read the assistant text (or an error) out of a provider response body.
 * Returns { text, error } — one of them is always set.
 */
export function providerResult({ provider, json } = {}) {
  const wire = PROVIDERS[normalizeProvider(provider)].wire
  const body = json && typeof json === 'object' ? json : {}
  const providerError = body.error?.message || body.error?.status || body.error || null
  if (providerError && typeof providerError === 'string') return { text: null, error: providerError }

  if (wire === 'anthropic') {
    const text = Array.isArray(body.content)
      ? body.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim()
      : ''
    return text ? { text, error: null } : { text: null, error: 'empty response' }
  }

  if (wire === 'gemini') {
    const parts = body.candidates?.[0]?.content?.parts
    const text = Array.isArray(parts) ? parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim() : ''
    if (text) return { text, error: null }
    const blocked = body.promptFeedback?.blockReason
    return { text: null, error: blocked ? `blocked: ${blocked}` : 'empty response' }
  }

  if (wire === 'ollama') {
    const text = typeof body.message?.content === 'string' ? body.message.content.trim() : ''
    return text ? { text, error: null } : { text: null, error: 'empty response' }
  }

  const text = typeof body.choices?.[0]?.message?.content === 'string' ? body.choices[0].message.content.trim() : ''
  return text ? { text, error: null } : { text: null, error: 'empty response' }
}
