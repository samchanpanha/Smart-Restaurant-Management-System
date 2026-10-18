// ─── Telegram webhook ───────────────────────────────────────────────
// Telegram posts updates here; the bot answers from the same book the
// terminals use. The command engine is pure (src/lib/telegram.js) and
// returns the actions it wants applied — this module applies them through
// the shared reducer, commits them like any other action, and sends the
// reply back to Telegram when a token is configured.
//
// Environment:
//   TELEGRAM_BOT_TOKEN    bot token from BotFather — no token, no outbound calls
//   TELEGRAM_CHAT_ROLES   "12345:manager,67890:staff,*:staff" (default *:staff)
//   TELEGRAM_WEBHOOK_SECRET  optional; when set, Telegram must echo it back
//   RESTORA_PUBLIC_URL    base URL for the guest / mini app links in replies
//                         (RENDER_EXTERNAL_URL is used automatically on Render)
//
// The router also owns the two things the push side needs: every chat that
// messages the bot is remembered (so it can be notified later without anyone
// copying ids into env files), and the bot's own notification stats are
// reported through /api/telegram/status.
//
// Settings → Telegram bot & mini app owns two fields (GET/PUT
// /api/telegram/config): the bot token (write-only) and the Base URL that
// guest /qr and mini-app links are built from. Because the bot is a single
// instance-wide webhook, both save to the tenant the bot serves
// (botTenantId), not the caller's; TELEGRAM_BOT_TOKEN / RESTORA_PUBLIC_URL
// remain the fallbacks everywhere.
//
// The Telegram screen's setup checklist gets three owner-gated routes:
// GET /api/telegram/webhook/info (is the webhook registered, and where),
// POST /api/telegram/webhook/register (call setWebhook with the saved
// token + Base URL — the "Register webhook" button) and POST
// /api/telegram/test (send a confirmation message to every reachable
// chat — the "Send test message" button). All three act on the bot's own
// identity and answer with plain English when a step is missing, never
// with a raw network error.

import express from 'express'
import { runTelegramCommand, parseTelegramUpdate, replyKeyboard, TELEGRAM_COMMANDS } from '../src/lib/telegram.js'

const API_BASE = 'https://api.telegram.org'
const SEND_TIMEOUT_MS = 4000

export function parseChatRoles(raw = process.env.TELEGRAM_CHAT_ROLES) {
  const roles = {}
  for (const entry of String(raw || '').split(',')) {
    const [chat, role] = entry.split(':').map((part) => part.trim())
    if (!chat || !role) continue
    roles[chat] = role.toLowerCase() === 'manager' || role.toLowerCase() === 'owner' ? 'manager' : 'staff'
  }
  if (!Object.keys(roles).length) roles['*'] = 'staff'
  return roles
}

/** Send one message. Without a token this is a no-op, so tests stay offline. */
export async function sendTelegramMessage(chatId, text, { token = process.env.TELEGRAM_BOT_TOKEN, keyboard = null, fetchImpl = globalThis.fetch } = {}) {
  if (!token) return { skipped: true, reason: 'no TELEGRAM_BOT_TOKEN configured' }
  if (typeof fetchImpl !== 'function') return { skipped: true, reason: 'no fetch available' }
  const body = { chat_id: chatId, text, disable_web_page_preview: true }
  if (keyboard) body.reply_markup = { keyboard, resize_keyboard: true }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
    const res = await fetchImpl(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const json = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, messageId: json?.result?.message_id ?? null } : { ok: false, error: json?.description || `HTTP ${res.status}` }
  } catch (err) {
    // Never let Telegram being unreachable break the restaurant: the action
    // is already applied, and the reply is reported in the HTTP response.
    return { ok: false, error: err?.message || 'send failed' }
  }
}

const MAX_TOKEN = 120
// BotFather tokens are "<digits>:<secret>"; testnet tokens share the shape.
const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{8,}$/

const MAX_PUBLIC_URL = 300
// Anything we hand to a guest as a link has to be a real http(s) address.
function isHttpUrl(value) {
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(value)
}
// One canonical shape: no trailing slash, no stray spaces (the guest-link
// builder appends "?guest=…" and doubled slashes read as a mistake).
function normalizeBase(value) {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

export function createTelegramRouter({
  getState,
  applyAction,
  publicUrl = '',
  ownerSlug = '',
  onChat = null,
  notifier = null,
  // Settings → Telegram: a tenant may store its own token in kv (write-only,
  // see server/db.js). All four deps arrive together; without them the router
  // keeps its legacy shape (env token only, no config routes).
  getToken = null,
  getConfig = null,
  setConfig = null,
  requireAdmin = null,
  resolveTenant = null,
  // Injected for tests: the setup routes (webhook info / register / test
  // message) call the Telegram Bot API. Production passes nothing and the
  // global fetch is used.
  fetchImpl = null,
  // The bot is one webhook + one token for the whole instance, so the token the
  // Settings field saves must land on the tenant the bot actually reads
  // (DEFAULT_TENANT in server/index.js). Without this, a save by an owner whose
  // tenant is not the bot's is written where the bot never looks — the field
  // looks saved, yet /api/telegram/status still reports "no token".
  botTenantId = null,
}) {
  const router = express.Router()
  const chatRoles = parseChatRoles()
  const stats = { updates: 0, commands: 0, actions: 0, replies: 0, lastUpdateAt: null, lastText: null, lastError: null, sent: 0, skipped: 0 }

  /** The token in force: the tenant's saved token first, then the env. */
  function token() {
    try {
      const stored = getToken?.()
      if (stored) return stored
    } catch { /* fall through to env */ }
    return String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  }

  // Where the bot's guest links point. Order: the tenant's saved Base URL
  // (Settings → Telegram), then an explicitly injected `publicUrl`, then the
  // environment — RESTORA_PUBLIC_URL, or Render's own RENDER_EXTERNAL_URL so
  // a deploy links to itself with zero configuration.
  function envBase() {
    return normalizeBase(publicUrl || process.env.RESTORA_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '')
  }
  function baseFor(ownerId) {
    try {
      const saved = normalizeBase(getConfig?.(ownerId)?.publicUrl)
      if (saved) return saved
    } catch { /* fall through to the environment */ }
    return envBase()
  }
  /** The bot is one webhook: its links come from the tenant it serves. */
  const publicBase = () => baseFor(botTenantId)

  function miniAppUrl() {
    return publicBase()
  }

  /** Run a command against a shop and (optionally) apply what it asks for. */
  function run(text, { role = 'staff', locId = 'downtown', dryRun = true, actor = 'telegram' } = {}) {
    const empire = getState()
    const shop = empire.locations?.[locId] || Object.values(empire.locations || {})[0]
    if (!shop) return { ok: false, reply: 'No location configured.', actions: [], applied: 0 }
    const result = runTelegramCommand(text, {
      shop,
      role,
      now: Date.now(),
      miniAppUrl: miniAppUrl(),
      ownerSlug,
    })
    let applied = 0
    if (!dryRun) {
      for (const action of result.actions) {
        try {
          const changed = applyAction({ ...action, by: actor }, locId)
          if (changed) applied += 1
        } catch (err) {
          result.reply += `\n(could not apply ${action.type}: ${err.message})`
        }
      }
    }
    return { ...result, applied }
  }

  // Telegram → app. Always answers 200 so Telegram does not retry a command
  // that already ran; problems are reported in the body instead.
  router.post('/api/telegram/webhook', async (req, res) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (secret && req.get('x-telegram-bot-api-secret-token') !== secret) {
      return res.status(401).json({ ok: false, error: 'bad webhook secret' })
    }
    const message = parseTelegramUpdate(req.body, chatRoles)
    if (!message) return res.json({ ok: true, ignored: 'no text message' })
    // A chat that talks to the bot may now be pushed to. This is how a new
    // phone is wired up: say /start once, no env file needed.
    try {
      onChat?.(message.chatId, message.role)
    } catch {
      /* remembering a chat must never fail the command */
    }

    stats.updates += 1
    stats.lastUpdateAt = new Date().toISOString()
    stats.lastText = message.text.slice(0, 120)

    const result = run(message.text, { role: message.role, dryRun: false, actor: `telegram:${message.fromId}` })
    stats.commands += 1
    stats.actions += result.applied

    const keyboard = replyKeyboard(message.role)
    const sent = await sendTelegramMessage(message.chatId, result.reply, { token: token(), keyboard })
    if (sent.ok) stats.replies += 1
    else if (sent.skipped) stats.skipped += 1
    else stats.lastError = sent.error || 'send failed'

    res.json({
      ok: true,
      role: message.role,
      command: result.command,
      reply: result.reply,
      actions: result.actions,
      applied: result.applied,
      delivered: sent.ok === true,
      delivery: sent.skipped ? 'skipped' : sent.ok ? 'sent' : 'failed',
    })
  })

  // The Telegram screen uses this to try a command without touching the book.
  router.post('/api/telegram/simulate', (req, res) => {
    const body = req.body || {}
    const text = typeof body.text === 'string' ? body.text.slice(0, 400) : ''
    if (!text.trim()) return res.status(400).json({ error: 'body.text is required' })
    const role = body.role === 'manager' ? 'manager' : (body.role === 'owner' ? 'manager' : 'staff')
    const dryRun = body.dryRun !== false
    const result = run(text, { role, dryRun, locId: body.locId || 'downtown' })
    res.json({
      ok: result.ok,
      command: result.command,
      role,
      reply: result.reply,
      actions: result.actions,
      applied: result.applied,
      dryRun,
    })
  })

  router.get('/api/telegram/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      configured: Boolean(token()),
      hasSecret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
      webhookPath: '/api/telegram/webhook',
      publicUrl: publicBase() || null,
      chatRoles,
      commands: TELEGRAM_COMMANDS,
      stats,
      push: notifier?.()?.stats || null,
    })
  })

  // The Telegram screen's "send the digest now" button. Preview first
  // (dryRun), then send: it goes to every configured chat.
  router.post('/api/telegram/digest', async (req, res) => {
    const active = notifier?.()
    if (!active) return res.status(503).json({ error: 'notifications are not running' })
    const dryRun = (req.body || {}).dryRun !== false
    const digest = dryRun ? active.preview(Date.now()) : await active.tick(Date.now(), { force: true })
    if (!digest) return res.json({ ok: false, error: 'no location configured' })
    if (!dryRun && digest.sent == null) {
      return res.json({ ok: false, error: digest.blocked || 'nothing to send', text: digest.text, targets: digest.targets || [] })
    }
    res.json({
      ok: true,
      dryRun,
      key: digest.key,
      text: digest.text,
      sent: digest.sent ?? 0,
      targets: digest.targets ?? [],
    })
  })

  router.get('/api/telegram/commands', (req, res) => {
    res.json({ commands: TELEGRAM_COMMANDS })
  })

  router.get('/api/telegram/stats', (req, res) => {
    res.json({ stats, chatRoles })
  })

  // ─── Settings → Telegram bot & mini app ────────────────────────
  // Two fields: the bot token (write-only) and the Base URL guest links are
  // built from (readable — it is not a secret, and the field has to show what
  // is stored). Responses report whether a token exists and where it comes
  // from, never the token itself (same contract as the AI config). Saved per
  // tenant in SQLite kv; the webhook, the status route, and the notifier all
  // resolve through getToken/publicBase, so a save takes effect on the next
  // message with no restart. Owner + super admin only.
  if (getConfig && setConfig && requireAdmin && resolveTenant) {
    // Read/write the config on the tenant the bot serves, never the caller's
    // own tenant: the two can differ (a super admin's owner, or any owner who
    // is not the bot's), and writing to the caller is what makes a saved token
    // invisible to the bot.
    const configOwner = (req) => botTenantId || req.tenantId
    // Shape sent to the browser — deliberately omits the token.
    function present(ownerId) {
      const config = getConfig(ownerId) || {}
      const stored = String(config.token || '').trim()
      const env = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
      const savedUrl = normalizeBase(config.publicUrl)
      // What the field shows vs. what the bot actually uses: blank here means
      // the deployment's own address (env) is doing the work.
      const effective = baseFor(ownerId)
      return {
        ok: true,
        configured: Boolean(stored || env),
        hasToken: Boolean(stored),
        tokenSource: stored ? 'tenant' : env ? 'environment' : 'none',
        publicUrl: savedUrl,
        publicUrlEffective: effective,
        publicUrlSource: savedUrl ? 'tenant' : effective ? 'environment' : 'none',
        webhookPath: '/api/telegram/webhook',
      }
    }

    router.get('/api/telegram/config', resolveTenant, requireAdmin, (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.json(present(configOwner(req)))
    })

    router.put('/api/telegram/config', resolveTenant, requireAdmin, (req, res) => {
      const ownerId = configOwner(req)
      const body = req.body || {}
      if (!('token' in body) && !('publicUrl' in body)) {
        return res.status(400).json({ ok: false, error: 'token or publicUrl is required' })
      }
      const next = { ...(getConfig(ownerId) || {}) }
      if ('token' in body) {
        const value = String(body.token ?? '').trim().slice(0, MAX_TOKEN)
        if (value) {
          if (!TOKEN_RE.test(value)) {
            return res.status(400).json({
              ok: false,
              error: 'That does not look like a bot token — BotFather sends one shaped like 123456789:AA…',
            })
          }
          next.token = value
        } else {
          delete next.token
        }
      }
      if ('publicUrl' in body) {
        // Empty clears it: the bot falls back to the deployment's own address.
        const value = normalizeBase(body.publicUrl).slice(0, MAX_PUBLIC_URL)
        if (value) {
          if (!isHttpUrl(value)) {
            return res.status(400).json({ ok: false, error: 'Base URL must start with http:// or https://' })
          }
          next.publicUrl = value
        } else {
          delete next.publicUrl
        }
      }
      setConfig(ownerId, next)
      res.json(present(ownerId))
    })

    // ─── One-click setup ──────────────────────────────────────────
    // The step-by-step checklist on the Telegram screen drives these:
    // "Register webhook" (setWebhook with the saved token + Base URL) and
    // "Send test message" (prove the round trip). Both act on the bot's
    // own identity, like every other route here, and explain what is
    // missing in plain English instead of surfacing a network error.
    const apiFetch = () => fetchImpl || globalThis.fetch

    async function callTelegram(method, payload) {
      const botToken = token()
      if (!botToken) return { ok: false, error: 'Save a bot token first — Settings → Telegram bot & mini app.' }
      const f = apiFetch()
      if (typeof f !== 'function') return { ok: false, error: 'No network client on this server.' }
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
        const res = await f(`${API_BASE}/bot${botToken}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
          signal: controller.signal,
        })
        clearTimeout(timer)
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json?.ok === false) {
          return { ok: false, error: json?.description || `Telegram answered HTTP ${res.status}` }
        }
        return { ok: true, result: json?.result }
      } catch (err) {
        return { ok: false, error: err?.message || 'Telegram is unreachable right now.' }
      }
    }

    /** The address this server expects Telegram to call. */
    function webhookUrl() {
      const base = publicBase()
      return base ? `${base}/api/telegram/webhook` : ''
    }

    // What step ② needs: registered / where / last delivery error. No token
    // yet is a normal state, not an error — the screen says "step ① first".
    router.get('/api/telegram/webhook/info', resolveTenant, requireAdmin, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const secret = Boolean(String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim())
      if (!token()) {
        return res.json({ ok: true, configured: false, registered: false, url: '', expectedUrl: webhookUrl(), matches: false, secret })
      }
      const info = await callTelegram('getWebhookInfo', {})
      if (!info.ok) return res.status(502).json({ ok: false, configured: true, error: info.error })
      const result = info.result || {}
      const url = String(result.url || '')
      res.json({
        ok: true,
        configured: true,
        registered: Boolean(url),
        url,
        expectedUrl: webhookUrl(),
        matches: Boolean(url) && url === webhookUrl(),
        pendingUpdates: Number(result.pending_update_count) || 0,
        lastError: result.last_error_message || '',
        lastErrorAt: result.last_error_date ? new Date(result.last_error_date * 1000).toISOString() : null,
        secret,
      })
    })

    router.post('/api/telegram/webhook/register', resolveTenant, requireAdmin, async (req, res) => {
      if (!token()) {
        return res.status(400).json({ ok: false, error: 'Save a bot token first — Settings → Telegram bot & mini app.' })
      }
      const url = webhookUrl()
      if (!isHttpUrl(url)) {
        return res.status(400).json({ ok: false, error: 'Set the Base URL first — the webhook needs this server’s public address.' })
      }
      const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
      const payload = { url, allowed_updates: ['message', 'edited_message', 'channel_post'] }
      if (secret) payload.secret_token = secret
      const set = await callTelegram('setWebhook', payload)
      if (!set.ok) return res.status(502).json({ ok: false, error: set.error, url })
      res.json({ ok: true, url, secret: Boolean(secret) })
    })

    // "Send test message": the bot can already reach every chat that has
    // messaged it plus the configured ids — prove it with one message
    // (a named chatId wins when the caller passes one).
    router.post('/api/telegram/test', resolveTenant, requireAdmin, async (req, res) => {
      if (!token()) {
        return res.status(400).json({ ok: false, error: 'Save a bot token first — Settings → Telegram bot & mini app.' })
      }
      const body = req.body || {}
      const explicit = String(body.chatId || '').trim()
      let targets = explicit ? [explicit] : []
      if (!targets.length) {
        try {
          const empire = getState()
          const shop = empire?.locations?.downtown || Object.values(empire?.locations || {})[0]
          const active = notifier?.()
          targets = active?.targets ? active.targets(shop?.settings).map(String) : []
        } catch { /* no reachable chat — reported below */ }
      }
      if (!targets.length) {
        return res.status(400).json({ ok: false, error: 'No chat to message yet — send the bot /start once from your phone, then try again.' })
      }
      const text = typeof body.text === 'string' && body.text.trim()
        ? body.text.trim().slice(0, 200)
        : '✅ Restora bot is connected — floor updates will land in this chat.'
      const results = []
      for (const chatId of targets) {
        const sent = await sendTelegramMessage(chatId, text, { token: token(), fetchImpl: apiFetch() })
        results.push({ chatId, ok: sent.ok === true, error: sent.error || (sent.skipped ? sent.reason : undefined) })
      }
      const sentCount = results.filter((row) => row.ok).length
      res.json({ ok: sentCount > 0, sent: sentCount, targets, results })
    })
  }

  return { router, run, stats, chatRoles }
}
