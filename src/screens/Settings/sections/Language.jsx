// ─── Settings → Language & translation ───────────────────────────────
// Two layers, one screen to see both:
//
//   1. the hand-written dictionary (src/lib/i18n-phrases.js) — tuned
//      restaurant vocabulary, instant, offline, always wins;
//   2. Google Translate's free endpoint — reached through the same-origin
//      /api/translate proxy, fills whatever layer 1 missed, cached on this
//      device *and* on the server.
//
// Both are per-device preferences, not tenant settings: the language a
// terminal reads in has no business travelling through the reducer into
// /api/state (which guests can read), and a restaurant's staff do not all
// read the same language. So this section writes localStorage, never a
// draft — which is also why it takes no `draft`/`patch` props.

import { useCallback, useEffect, useState } from 'react'
import { Card, Toggle } from '../primitives'
import { Icon } from '../../../components/Icon'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import {
  clearTranslationCache,
  fetchTranslateStatus,
  flushTranslations,
  isMachineTranslationEnabled,
  setMachineTranslationEnabled,
  translationCacheStats,
  useI18n,
  useTranslateStatus,
} from '../../../lib/i18n'

const STATE_COPY = {
  idle: 'Idle — every string on screen came from the built-in dictionary.',
  loading: 'Translating the strings the dictionary does not cover…',
  ready: 'Machine translations applied.',
  error: 'Google Translate could not be reached. The dictionary copy stays on screen; nothing is queued.',
  off: 'Machine translation is switched off on this device.',
}

/** Small monospace figure, so cache counts read as data and not as copy. */
function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="text-[11px] font-semibold tracking-wide text-zinc-600 uppercase">{label}</div>
      <div className="tnum mt-0.5 text-lg font-bold text-zinc-900">{value}</div>
    </div>
  )
}

export function LanguageSection() {
  const { lang } = useI18n()
  const status = useTranslateStatus()
  const [enabled, setEnabled] = useState(() => isMachineTranslationEnabled())
  const [server, setServer] = useState(null)
  const [stats, setStats] = useState(() => translationCacheStats())
  const [busy, setBusy] = useState(false)

  // Ask the server what it is configured with. No backend (the localStorage
  // demo) answers null and the card says so instead of showing a dead button.
  useEffect(() => {
    let alive = true
    fetchTranslateStatus().then((payload) => {
      if (alive) setServer(payload)
    })
    return () => { alive = false }
  }, [status.updatedAt])

  const refreshStats = useCallback(() => setStats(translationCacheStats()), [])

  function onToggle(next) {
    setEnabled(setMachineTranslationEnabled(next))
    refreshStats()
    if (next) void flushTranslations(lang).then(refreshStats)
  }

  async function onTranslateNow() {
    setBusy(true)
    try {
      await flushTranslations(lang)
    } finally {
      setBusy(false)
      refreshStats()
    }
  }

  function onClearCache() {
    clearTranslationCache()
    refreshStats()
  }

  return (
    <div className="space-y-4" data-testid="settings-language">
      <Card
        title="Interface language"
        sub="Khmer, English and Chinese across the staff workspace, the guest QR menu and the Telegram mini app. Saved on this device only — a kitchen tablet can read Khmer while the office reads English."
      >
        <div className="flex flex-wrap items-center gap-3">
          <LanguageSwitcher testIdPrefix="settings-lang" />
          <span className="text-xs text-zinc-600" data-testid="settings-lang-current">
            {lang === 'km' ? 'Khmer (default)' : lang === 'zh' ? 'Chinese' : 'English'}
          </span>
        </div>
      </Card>

      <Card
        title="Machine translation · Google Translate (free)"
        sub="Fills the phrases the built-in dictionary does not cover. The dictionary always wins, so tuned restaurant vocabulary — 86'd, bump, covers, par — is never replaced by a machine guess."
        actions={
          <span
            data-testid="settings-translate-state"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              status.state === 'error'
                ? 'bg-red-50 text-red-300 ring-1 ring-red-200 ring-inset'
                : status.state === 'loading'
                  ? 'bg-sky-50 text-sky-300 ring-1 ring-sky-200 ring-inset'
                  : 'bg-emerald-50 text-emerald-300 ring-1 ring-emerald-200 ring-inset'
            }`}
          >
            <Icon name={status.state === 'error' ? 'warning' : 'globe'} size={12} />
            {status.state}
          </span>
        }
      >
        <div className="space-y-3">
          <Toggle
            label="Fill missing phrases with Google Translate"
            hint="Off means dictionary-only: every screen still works, and nothing is ever sent off this server."
            checked={enabled}
            onChange={onToggle}
          />

          <p className="text-xs leading-relaxed text-zinc-600" data-testid="settings-translate-explainer">
            {STATE_COPY[status.state] || STATE_COPY.idle}
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            <Metric label="Cached here" value={stats.entries} />
            <Metric label="Translated now" value={status.translated} />
            <Metric label="Waiting" value={status.pending} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTranslateNow}
              disabled={!enabled || busy}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-orange-500 px-3.5 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="settings-translate-now"
            >
              <Icon name="globe" size={15} />
              {busy ? 'Translating…' : 'Translate this screen now'}
            </button>
            <button
              type="button"
              onClick={onClearCache}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              data-testid="settings-translate-clear"
            >
              <Icon name="trash" size={15} />
              Clear cached translations
            </button>
          </div>

          <div
            className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-600"
            data-testid="settings-translate-server"
          >
            {server ? (
              <>
                <span className="font-bold text-zinc-800">Server:</span>{' '}
                {server.enabled ? 'proxy on' : 'proxy disabled by TRANSLATE_ENABLED'}
                {server.provider ? ` · ${server.provider}` : ''}
                {server.cache ? ` · ${server.cache.entries} cached for every terminal` : ''}
                {server.guestRateLimit ? ` · guests ${server.guestRateLimit}/min` : ''}
                {server.stats ? ` · ${server.stats.upstream || 0} upstream calls` : ''}
              </>
            ) : (
              <>
                <span className="font-bold text-zinc-800">Server:</span> not reachable — the localStorage demo
                translates through the Vite dev proxy, or not at all in a static build.
              </>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="What is sent, and what never leaves"
        sub="Machine translation only ever sees interface copy this device could not translate locally."
      >
        <ul className="space-y-2 text-xs leading-relaxed text-zinc-700">
          {[
            'Sent: labels, headings, hints and buttons the dictionary does not cover — batched, once per string, then cached.',
            'Never sent: numbers, prices, dates, SKU and account codes, bot commands (/today, /stock), API identifiers.',
            'Never sent: anything already written in Khmer or Chinese, including seeded dish and supplier names.',
            'Never stored here: guest orders, payments or personal data — the proxy is stateless apart from its phrase cache.',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="check" size={13} className="mt-0.5 shrink-0 text-emerald-300" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
          Translations come from Google's free, key-less endpoint. It is unmetered but unofficial: an operator can
          switch it off per server with <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] text-zinc-800">TRANSLATE_ENABLED=false</code>,
          and the app falls back to the dictionary with no other change.
        </p>
      </Card>
    </div>
  )
}
