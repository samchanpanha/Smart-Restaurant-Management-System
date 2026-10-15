// ─── AI provider adapters (pure) ─────────────────────────────────────
// One small translation layer over the four shapes we care about. This
// module is transport-free: it only builds the request and reads the reply,
// so it can be unit-tested with a canned JSON body and no network. The
// server (server/ai.js) owns fetch + timeouts + the API key.
//
// No `process` or browser globals are referenced at module scope, so this
// file is safe to import on either side of the wire.

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    docs: 'https://platform.openai.com/docs/api-reference/chat',
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-haiku-latest',
    docs: 'https://docs.anthropic.com/en/api/messages',
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-1.5-flash',
    docs: 'https://ai.google.dev/api/generate-content',
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
  },
}

export const DEFAULT_PROVIDER = 'openai'

export function normalizeProvider(name) {
  const key = String(name || '').trim().toLowerCase()
  return PROVIDERS[key] ? key : DEFAULT_PROVIDER
}

export function providerDefaults(name) {
  const key = normalizeProvider(name)
  const meta = PROVIDERS[key]
  return { provider: key, baseUrl: meta.baseUrl, model: meta.defaultModel, label: meta.label }
}

export function listProviders() {
  return Object.entries(PROVIDERS).map(([id, meta]) => ({ id, label: meta.label, defaultModel: meta.defaultModel }))
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
  const defaults = PROVIDERS[key]
  const base = trimSlash(baseUrl || defaults.baseUrl)
  const chosenModel = model || defaults.defaultModel
  const turns = cleanTurns(messages)
  const sys = typeof system === 'string' ? system : ''

  if (key === 'anthropic') {
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

  if (key === 'gemini') {
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
  if (key === 'ollama') {
    return {
      url: `${base}/api/chat`,
      headers: { 'content-type': 'application/json' },
      body: { ...body, stream: false, options: { temperature } },
    }
  }
  return {
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey || ''}` },
    body: { ...body, temperature, max_tokens: maxTokens },
  }
}

/**
 * Read the assistant text (or an error) out of a provider response body.
 * Returns { text, error } — one of them is always set.
 */
export function providerResult({ provider, json } = {}) {
  const key = normalizeProvider(provider)
  const body = json && typeof json === 'object' ? json : {}
  const providerError = body.error?.message || body.error?.status || body.error || null
  if (providerError && typeof providerError === 'string') return { text: null, error: providerError }

  if (key === 'anthropic') {
    const text = Array.isArray(body.content)
      ? body.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim()
      : ''
    return text ? { text, error: null } : { text: null, error: 'empty response' }
  }

  if (key === 'gemini') {
    const parts = body.candidates?.[0]?.content?.parts
    const text = Array.isArray(parts) ? parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim() : ''
    if (text) return { text, error: null }
    const blocked = body.promptFeedback?.blockReason
    return { text: null, error: blocked ? `blocked: ${blocked}` : 'empty response' }
  }

  if (key === 'ollama') {
    const text = typeof body.message?.content === 'string' ? body.message.content.trim() : ''
    return text ? { text, error: null } : { text: null, error: 'empty response' }
  }

  const text = typeof body.choices?.[0]?.message?.content === 'string' ? body.choices[0].message.content.trim() : ''
  return text ? { text, error: null } : { text: null, error: 'empty response' }
}
