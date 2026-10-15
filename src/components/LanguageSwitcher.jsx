// ─── Global language switcher (Khmer default, English, Chinese) ────

import { LANGUAGES, useI18n } from '../lib/i18n'

export default function LanguageSwitcher({ compact = false, testIdPrefix = 'app-lang', className = '' }) {
  const { lang, setLang, kitchenDict } = useI18n()

  return (
    <div
      role="group"
      aria-label={kitchenDict.languageLabel || 'Language'}
      data-testid={`${testIdPrefix}-switcher`}
      className={`inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-xs ${className}`}
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
              compact ? 'min-h-[30px] px-2.5 text-2xs' : 'min-h-[36px] px-3 text-xs'
            } ${
              active
                ? 'bg-orange-500 text-white shadow-xs'
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
