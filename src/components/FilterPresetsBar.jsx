import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { getSavedPresets } from '../lib/savedFilters'

/**
 * Reusable Saved Filter Presets Strip for operational screens.
 */
export function FilterPresetsBar({ screenKey, currentFilters, onApply }) {
  const { dict } = useI18n()
  const fp = dict.filterPresets || {}
  const [presets, setPresets] = useState(() => getSavedPresets(screenKey))
  const [picked, setPicked] = useState('')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(`restora.filters.${screenKey}.v1`, JSON.stringify(presets))
    } catch {
      // storage quota or incognito fallback
    }
  }, [presets, screenKey])

  function commit() {
    const label = name.trim()
    if (!label) return
    setPresets((list) => [...list.filter((p) => p.name !== label), { name: label, filters: currentFilters }])
    setPicked(label)
    setName('')
    setNaming(false)
  }

  function apply(presetName) {
    setPicked(presetName)
    const found = presets.find((p) => p.name === presetName)
    if (found && onApply) onApply(found.filters)
  }

  function remove(presetName) {
    setPresets((list) => list.filter((p) => p.name !== presetName))
    if (picked === presetName) setPicked('')
  }

  if (presets.length === 0 && !naming) {
    return (
      <button
        type="button"
        onClick={() => setNaming(true)}
        className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        title={fp.saveAsPreset || 'Save active filter as a quick preset'}
      >
        {fp.savePresetBtn || '+ Save filter preset'}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
        {fp.presetsLabel || 'Presets:'}
      </span>

      {presets.map((p) => {
        const isPicked = picked === p.name
        return (
          <span
            key={p.name}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold transition-all ${
              isPicked
                ? 'bg-amber-500 text-stone-950 shadow-xs'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
            }`}
          >
            <button
              type="button"
              onClick={() => apply(p.name)}
              className="truncate"
            >
              {p.name}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                remove(p.name)
              }}
              className="text-zinc-400 hover:text-red-500 ml-1"
              title={fp.deletePreset ? fp.deletePreset(p.name) : `Delete preset ${p.name}`}
              aria-label={fp.deletePreset ? fp.deletePreset(p.name) : `Delete preset ${p.name}`}
            >
              ×
            </button>
          </span>
        )
      })}

      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setName(''); setNaming(false) }
            }}
            placeholder={fp.presetNamePlaceholder || 'Preset name…'}
            className="h-7 w-28 rounded-lg border border-orange-400 bg-white dark:bg-zinc-800 px-2 text-xs outline-none"
          />
          <button
            type="button"
            onClick={commit}
            className="rounded-lg bg-orange-500 px-2 py-1 text-xs font-bold text-white hover:bg-orange-600"
          >
            {dict.save || 'Save'}
          </button>
          <button
            type="button"
            onClick={() => { setName(''); setNaming(false) }}
            className="text-zinc-400 hover:text-zinc-600"
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/5 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          title={fp.saveAsPreset || 'Save current filters as preset'}
        >
          {fp.savePresetBtn || '+ Save preset'}
        </button>
      )}
    </div>
  )
}

export default FilterPresetsBar
