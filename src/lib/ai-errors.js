// ─── AI failure classification (pure) ───────────────────────────────
// One shared reading of an /api/ai/* failure so every surface reacts the
// same way. A provider that is momentarily out of capacity — Gemini's
// "experiencing high demand", OpenAI's "overloaded", a 429/503 — is
// transient: worth one quick silent retry and a calm, localized message.
// A missing or rejected key is not. Dependency-free, so both the browser
// and node import it (server/ai.js folds it into its own error handling).

// Phrases a provider uses when the model is momentarily out of capacity.
const TRANSIENT_PATTERNS = [
  /high demand/i,
  /overload/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /try again later/i,
  /timed? ?out/i,
  /rate.?limit/i,
  /too many requests/i,
  /\bat capacity\b/i,
]

// Phrases that mean the credential itself is the problem, not capacity.
const AUTH_PATTERNS = [
  /unauthori[sz]ed/i,
  /(?:incorrect|invalid|expired|revoked)[^.]*\b(?:api\s*)?key\b/i,
  /\b(?:api\s*)?key\b[^.]*(?:incorrect|invalid|expired|revoked)/i,
]

export const AI_FAILURE_KINDS = ['busy', 'limited', 'offline', 'config', 'auth', 'error']

/**
 * Read a client result ({ status, error, configured }) into one kind:
 *   busy     provider overload / high demand (retryable)
 *   limited  our own rate limiter answered 429
 *   offline  the request never reached a server (fetch threw)
 *   config   no API key is set anywhere
 *   auth     the provider rejected the key
 *   error    anything else
 */
export function classifyAiFailure(res) {
  const status = Number(res?.status) || 0
  const message = String(res?.error || '')
  if (status === 401 || status === 403) return 'auth'
  if (AUTH_PATTERNS.some((pattern) => pattern.test(message))) return 'auth'
  if (res?.configured === false || /api[\s_-]?key/i.test(message)) return 'config'
  if (status === 429) return 'limited'
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) return 'busy'
  // An upstream gateway error with no readable body is still capacity, not a
  // bad request — treat 502/503/504 as transient.
  if (status === 502 || status === 503 || status === 504) return 'busy'
  if (!status) return 'offline'
  return 'error'
}

// A busy provider or a dropped connection is worth trying again; a bad key is not.
export function isRetryable(kind) {
  return kind === 'busy' || kind === 'offline'
}
