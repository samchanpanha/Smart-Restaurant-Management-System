// ─── Global language switcher (Khmer default, English, Chinese) ────

import { LANGUAGES, useI18n } from '../lib/i18n'

export default function LanguageSwitcher({ compact = false, testIdPrefix = 'app-lang', tone = 'light', className = '' }) {
  const { lang, setLang, kitchenDict } = useI18n()
  const dark = tone === 'dark'

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
