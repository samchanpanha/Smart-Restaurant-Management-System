// ─── Item photos + food vocabulary ──────────────────────────────────
// Shared by the catalog product/ingredient editors and the menu coster:
// one photo control, one tag picker, so an item looks the same wherever
// it is edited.

import { useMemo, useState } from 'react'
import { IMAGE_ACCEPT, readImageFile } from '../lib/images'

const inputCls =
  'w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'

export function PhotoField({ value, onChange, maxKb = 180, hint }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputId = useMemo(() => `photo-${Math.random().toString(36).slice(2, 9)}`, [])

  async function pick(file) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const result = await readImageFile(file, { maxKb })
      onChange(result.dataUrl)
      if (result.oversized) setError(`Still ${result.kb} kB after compression — try a simpler photo.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be used.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-zinc-500">Photo</span>
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50">
          {value ? (
            <img src={value} alt="Item photo" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-center text-3xs uppercase tracking-wide text-zinc-400">No photo</span>
          )}
        </div>
        <div className="min-w-[min(220px,100%)] flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor={inputId}
              className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              {busy ? 'Resizing…' : value ? 'Replace photo' : 'Upload photo'}
            </label>
            <input
              id={inputId}
              type="file"
              accept={IMAGE_ACCEPT}
              className="sr-only"
              onChange={(event) => { pick(event.target.files?.[0]); event.target.value = '' }}
            />
            {value && (
              <button
                type="button"
                onClick={() => { onChange(''); setError('') }}
                className="inline-flex min-h-9 items-center rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
              >
                Remove
              </button>
            )}
          </div>
          <input
            value={value?.startsWith('data:') ? '' : value || ''}
            onChange={(event) => onChange(event.target.value.trim())}
            placeholder={value?.startsWith('data:') ? 'Uploaded photo stored in this app' : 'https://… or /photos/plate.jpg'}
            className={inputCls}
          />
          <p className="text-2xs text-zinc-500">
            {error ? <span className="text-red-600">{error}</span> : (hint || `Resized and compressed to about ${maxKb} kB before it is saved — no upload service needed.`)}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Tag / allergen chips ───────────────────────────────────────────

export function ChipPicker({ label, options, selected, onToggle, empty }) {
  return (
    <div>
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 && <span className="text-xs text-zinc-500">{empty}</span>}
        {options.map((option) => {
          const on = selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              aria-pressed={on}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition ${
                on ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50'
              }`}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}
