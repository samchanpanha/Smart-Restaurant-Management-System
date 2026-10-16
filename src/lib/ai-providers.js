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
    defaultModel: 'gemini-2.5-flash',
    docs: 'https://ai.google.dev/api/generate-content',
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
    docs: 'https://console.groq.com/docs/api-reference#chat-completions',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    docs: 'https://openrouter.ai/docs/requests',
  },
  mistral: {
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    docs: 'https://docs.mistral.ai/api/#tag/chat/operation/chat_completion_v1_chat_completions_post',
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama3.1-8b',
    docs: 'https://inference-docs.cerebras.ai/api-reference/chat-completions',
  },
  // Alibaba Cloud Qwen (DashScope) - OpenAI-compatible
  dashscope: {
    label: 'Alibaba Cloud Qwen (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    docs: 'https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope',
  },
  // SiliconCloud - Qwen models
  siliconcloud: {
    label: 'SiliconCloud (Qwen)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    docs: 'https://docs.siliconflow.cn/api-reference/chat-completions/chat-completions',
  },
  // Alibaba Cloud Model Studio (market place) - also OpenAI-compatible
  alibaba: {
    label: 'Alibaba Cloud Model Studio',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    docs: 'https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope',
  },
  modelstudio: {
    label: 'Alibaba Cloud Model Studio (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    docs: 'https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope',
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
  const turns = (Array.isArray(messages) ? messages : [])
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim())
    .map((msg) => ({ role: msg.role, content: msg.content }))
  // A failed exchange leaves an unanswered user turn, so the next question
  // can arrive right after it. Anthropic rejects two same-role turns in a
  // row, so collapse a run of the same role into one turn for every provider.
  const merged = []
  for (const turn of turns) {
    const last = merged[merged.length - 1]
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`
    else merged.push({ ...turn })
  }
  return merged
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

  // openai + ollama + any OpenAI-compatible (groq, openrouter, mistral, cerebras, dashscope, siliconcloud, alibaba, modelstudio) share { messages } with an optional system turn.
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
