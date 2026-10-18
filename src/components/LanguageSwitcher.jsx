// ─── Global language switcher (Khmer default, English, Chinese) ────
// Three buttons, one per supported language — the vocabulary is fixed, what
// changed is where the translations come from. The hand-written dictionary
// paints instantly; anything it misses is fetched from Google Translate
// (free, through the same-origin proxy) and repainted a beat later. The dot
// beside the trigger is that second layer: it is the only sign a user gets
// that a screen is still filling in, so it says so in words on hover and to
// screen readers instead of relying on colour alone.

import { LANGUAGES, useI18n, useTranslateStatus } from '../lib/i18n'
import { Icon } from './Icon'

/**
 * One line of copy for the machine layer, in the language being switched to.
 * Deliberately short (it sits in a 10rem popover on a phone) and — for km and
 * zh — deliberately free of Latin words: this line renders inside the guest
 * surfaces that tests/i18n-coverage.test.js walks for untranslated copy, and
 * a brand name there would read as a gap.
 */
const MACHINE_COPY = {
  km: {
    loading: 'កំពុងបកប្រែពាក្យដែលនៅខ្វះ…',
    ready: 'បានបកប្រែពាក្យដែលនៅខ្វះរួចរាល់',
    error: 'មិនអាចបកប្រែស្វ័យប្រវត្តិបានទេ — បង្ហាញតែពាក្យដែលមានក្នុងប្រព័ន្ធ',
    off: 'បានបិទការបកប្រែស្វ័យប្រវត្តិ',
  },
  zh: {
    loading: '正在翻译剩余文字…',
    ready: '剩余文字已翻译完成',
    error: '自动翻译暂不可用 — 仅显示内置译文',
    off: '已关闭自动翻译',
  },
  en: {
    loading: 'Translating with Google…',
    ready: 'Google Translate finished',
    error: 'Google Translate unreachable — showing built-in phrases only',
    off: 'Machine translation is off',
  },
}

/** `state` → the dot's colour and its spoken/written explanation. */
function machineStatus(lang, status) {
  const copy = MACHINE_COPY[lang] || MACHINE_COPY.en
  if (!status.enabled) return { tone: 'off', label: copy.off }
  if (status.state === 'loading' || status.pending > 0) return { tone: 'loading', label: copy.loading }
  if (status.state === 'error') return { tone: 'error', label: copy.error }
  if (status.state === 'ready' || status.translated > 0) return { tone: 'ready', label: copy.ready }
  return null // idle and nothing fetched: the dictionary covered everything
}

const DOT_TONE = {
  loading: 'bg-[var(--info)] animate-pulse',
  ready: 'bg-[var(--success)]',
  error: 'bg-[var(--danger)]',
  off: 'bg-[var(--text-subtle)]',
}

export default function LanguageSwitcher({ compact = false, testIdPrefix = 'app-lang', tone = 'light', className = '', menu = false }) {
  const { lang, setLang, kitchenDict } = useI18n()
  const status = useTranslateStatus()
  const machine = machineStatus(lang, status)
  const dark = tone === 'dark'
  const label = kitchenDict.languageLabel || 'Language'

  // A three-button segmented control is fine on a dashboard, but in a phone
  // header it competes with the table and the restaurant name. The menu
  // variant keeps one compact trigger and reveals the same buttons on tap.
  if (menu) {
    const active = LANGUAGES.find((option) => option.id === lang) || LANGUAGES[0]
    return (
      <details className={`relative ${className}`} data-testid={`${testIdPrefix}-switcher`}>
        <summary
          aria-label={label}
          className={`flex min-h-9 cursor-pointer list-none select-none items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-bold transition-colors [&::-webkit-details-marker]:hidden ${
            dark
              ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
              : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]'
          }`}
        >
          <Icon name="globe" size={13} className="opacity-80" />
          <span>{active.label}</span>
          {machine && (
            <span
              aria-hidden="true"
              data-testid={`${testIdPrefix}-machine-dot`}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[machine.tone]}`}
            />
          )}
          <span aria-hidden="true" className="text-[9px] opacity-70">▾</span>
        </summary>
        <div
          role="group"
          aria-label={label}
          className={`absolute right-0 top-full z-50 mt-2 w-40 rounded-2xl border p-1 shadow-xl ${
            dark ? 'border-white/20 bg-[#1c1917]/95 backdrop-blur' : 'border-[var(--border)] bg-[var(--surface)]'
          }`}
        >
          {LANGUAGES.map((option) => {
            const isActive = lang === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={(event) => {
                  setLang(option.id)
                  const details = event.currentTarget.closest('details')
                  if (details) details.open = false
                }}
                aria-pressed={isActive}
                aria-label={`Switch language to ${option.englishName}`}
                data-testid={`${testIdPrefix}-${option.id}`}
                className={`flex min-h-[38px] w-full items-center justify-between rounded-xl px-2.5 text-xs font-bold transition-colors ${
                  isActive
                    ? 'bg-[var(--guest-accent)] text-[var(--guest-ink)]'
                    : dark
                      ? 'text-white hover:bg-white/15'
                      : 'text-[var(--text)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                <span>{option.label}</span>
                {isActive && <Icon name="check" size={13} />}
              </button>
            )
          })}
          {machine && (
            <p
              data-testid={`${testIdPrefix}-machine-status`}
              className={`mt-1 flex items-start gap-1.5 border-t px-2.5 pt-2 pb-1.5 text-[10px] leading-snug font-semibold ${
                dark ? 'border-white/20 text-white/85' : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}
            >
              <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[machine.tone]}`} />
              {machine.label}
            </p>
          )}
        </div>
      </details>
    )
  }

  return (
    <div
      role="group"
      aria-label={label}
      data-testid={`${testIdPrefix}-switcher`}
      className={`inline-flex items-center gap-1 rounded-xl border p-1 shadow-xs ${
        dark ? 'border-white/20 bg-white/10 backdrop-blur' : 'border-[var(--border)] bg-[var(--surface)]'
      } ${className}`}
    >
      {LANGUAGES.map((option) => {
        const active = lang === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setLang(option.id)}
            aria-pressed={active}
            aria-label={`Switch language to ${option.englishName}`}
            data-testid={`${testIdPrefix}-${option.id}`}
            className={`rounded-lg font-bold transition-colors ${
              compact ? 'min-h-[30px] px-2.5 text-[11px]' : 'min-h-[36px] px-3 text-xs'
            } ${
              active
                ? dark
                  ? 'bg-[var(--guest-accent)] text-[var(--guest-ink)] shadow-xs'
                  : 'bg-[var(--accent)] text-[var(--text-on-accent)] shadow-xs'
                : dark
                  ? 'text-white hover:bg-white/20 hover:text-white'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
      {machine && (
        <span
          data-testid={`${testIdPrefix}-machine-dot`}
          title={machine.label}
          aria-label={machine.label}
          role="status"
          className={`ml-0.5 h-2 w-2 shrink-0 self-center rounded-full ${DOT_TONE[machine.tone]}`}
        />
      )}
    </div>
  )
}
