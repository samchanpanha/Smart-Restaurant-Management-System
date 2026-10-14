// ─── Language switch ────────────────────────────────────────────────
// A segmented radio group labelled in each language's own script
// (ខ្មែរ · English · 中文), so a cook can find theirs without reading the
// one on screen. Arrow keys move the choice, like any radio group; the
// English name rides along as a tooltip for managers.

import { useRef } from 'react'
import { Icon } from './Icon'
import { LANGUAGES } from '../lib/i18n'

export default function LanguageSwitch({ value, onChange, label = 'Language', className = '' }) {
  const buttons = useRef([])
  const selected = Math.max(0, LANGUAGES.findIndex((language) => language.id === value))

  function choose(position) {
    onChange(LANGUAGES[position].id)
    buttons.current[position]?.focus()
  }

  function onKeyDown(event) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    let next = null
    if (step) next = (selected + step + LANGUAGES.length) % LANGUAGES.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = LANGUAGES.length - 1
    if (next === null) return
    event.preventDefault()
    choose(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`inline-flex items-center gap-0.5 rounded-xl bg-[var(--color-ink-900)] p-0.5 ring-1 ring-inset ring-[var(--color-ink-600)] ${className}`}
    >
      <Icon name="globe" size={18} className="mx-2 shrink-0 text-zinc-500" />
      {LANGUAGES.map((language, position) => {
        const active = position === selected
        return (
          <button
            key={language.id}
            ref={(node) => { buttons.current[position] = node }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            lang={language.htmlLang}
            title={language.english}
            onClick={() => choose(position)}
            className={`min-h-[44px] min-w-[60px] rounded-[10px] px-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-500 ${
              active ? 'bg-amber-500 text-white shadow-sm' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            {language.label}
          </button>
        )
      })}
    </div>
  )
}
