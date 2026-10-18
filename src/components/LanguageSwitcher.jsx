// ─── Global language switcher (Khmer default, English, Chinese) ────

import { LANGUAGES, useI18n } from '../lib/i18n'
import { Icon } from './Icon'

export default function LanguageSwitcher({ compact = false, testIdPrefix = 'app-lang', tone = 'light', className = '', menu = false }) {
  const { lang, setLang, kitchenDict } = useI18n()
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
              ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
              : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
          }`}
        >
          <Icon name="globe" size={13} className="opacity-70" />
          <span>{active.label}</span>
          <span aria-hidden="true" className="text-[9px] opacity-60">▾</span>
        </summary>
        <div
          role="group"
          aria-label={label}
          className={`absolute right-0 top-full z-50 mt-2 w-36 rounded-2xl border p-1 shadow-xl ${
            dark ? 'border-white/15 bg-[#1c1917]/95 backdrop-blur' : 'border-zinc-200 bg-white'
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
                      ? 'text-white/80 hover:bg-white/10'
                      : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <span>{option.label}</span>
                {isActive && <Icon name="check" size={13} />}
              </button>
            )
          })}
        </div>
      </details>
    )
  }

  return (
    <div
      role="group"
      aria-label={kitchenDict.languageLabel || 'Language'}
      data-testid={`${testIdPrefix}-switcher`}
      className={`inline-flex items-center gap-1 rounded-xl border p-1 shadow-xs ${
        dark ? 'border-white/15 bg-white/10 backdrop-blur' : 'border-zinc-200 bg-white'
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
                  : 'bg-orange-500 text-white shadow-xs'
                : dark
                  ? 'text-white/70 hover:bg-white/15 hover:text-white'
                  : 'text-zinc-600 hover:bg-orange-50 hover:text-zinc-900'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
