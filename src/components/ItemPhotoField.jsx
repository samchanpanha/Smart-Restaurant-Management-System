// ─── Item photos + food vocabulary ──────────────────────────────────
// Shared by the catalog product/ingredient editors and the menu coster:
// one photo control, one tag picker, so an item looks the same wherever
// it is edited. Dishes get the gallery (cover + more photos for the
// kitchen display) and their names in Khmer and Chinese.

import { useId, useState } from 'react'
import { MAX_TRANSLATED_NAME, TRANSLATED_LANGUAGES, languageMeta } from '../lib/i18n'
import { IMAGE_ACCEPT, readImageFile } from '../lib/images'
import { MAX_ITEM_MEDIA_CHARS, MAX_ITEM_PHOTOS, itemMediaChars, sanitizeImageRef } from '../lib/settings'

const inputCls =
  'w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'

export function PhotoField({ value, onChange, maxKb = 180, hint }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputId = useId()

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
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Photo</span>
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50">
          {value ? (
            <img src={value} alt="Item photo" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-center text-[10px] uppercase tracking-wide text-zinc-400">No photo</span>
          )}
        </div>
        <div className="min-w-[220px] flex-1 space-y-2">
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
          <p className="text-[11px] text-zinc-500">
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
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
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

// ─── Photo gallery: the cover plus more photos ──────────────────────
// The first photo is the cover — the menu, the QR page and documents
// show it — and the kitchen display shows all of them. Uploads are
// compressed to fit the dish's media budget (an edit travels to the
// server as one request); links and /photos/ paths cost next to nothing.

const tileBtn = 'grid h-7 w-7 place-items-center rounded-md text-sm font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent'

export function PhotoGalleryField({ cover, images, onChange, maxKb = 180, hint }) {
  const photos = [cover, ...(Array.isArray(images) ? images : [])].filter(Boolean)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const inputId = useId()
  const used = itemMediaChars({ imageUrl: cover, images })
  const full = photos.length >= MAX_ITEM_PHOTOS
  const uploadsKb = Math.round(photos.filter((ref) => ref.startsWith('data:')).reduce((sum, ref) => sum + ref.length, 0) / 1024)

  function commit(list) {
    const clean = list.filter(Boolean)
    onChange({ imageUrl: clean[0] || '', images: clean.slice(1) })
  }

  function move(from, to) {
    if (to < 0 || to >= photos.length) return
    const next = [...photos]
    const [photo] = next.splice(from, 1)
    next.splice(to, 0, photo)
    commit(next)
  }

  async function pick(fileList) {
    const files = [...(fileList || [])]
    if (!files.length) return
    setBusy(true)
    setError('')
    let list = [...photos]
    let problem = ''
    try {
      for (const file of files) {
        if (list.length >= MAX_ITEM_PHOTOS) {
          problem = `A dish holds up to ${MAX_ITEM_PHOTOS} photos.`
          break
        }
        const room = MAX_ITEM_MEDIA_CHARS - list.reduce((sum, ref) => sum + ref.length, 0)
        const roomKb = Math.floor(room / 1.4 / 1024)
        if (roomKb < 16) {
          problem = 'No room for another uploaded photo — remove one, or add a link instead.'
          break
        }
        const result = await readImageFile(file, { maxKb: Math.min(maxKb, roomKb) })
        if (result.dataUrl.length > room) {
          problem = 'That photo is still too large to fit — try a smaller one, or add a link.'
          continue
        }
        if (list.includes(result.dataUrl)) continue // the same file twice
        list = [...list, result.dataUrl]
      }
    } catch (err) {
      problem = err instanceof Error ? err.message : 'That image could not be used.'
    } finally {
      setBusy(false)
    }
    if (list.length !== photos.length) commit(list)
    setError(problem)
  }

  function addLink() {
    const ref = sanitizeImageRef(link)
    if (!ref || ref.startsWith('data:')) {
      setError('Use an https:// link or a site path such as /photos/plate.jpg.')
      return
    }
    if (photos.includes(ref)) {
      setError('That photo is already in the gallery.')
      return
    }
    if (full) {
      setError(`A dish holds up to ${MAX_ITEM_PHOTOS} photos.`)
      return
    }
    commit([...photos, ref])
    setLink('')
    setError('')
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Photos · {photos.length} of {MAX_ITEM_PHOTOS}
        </span>
        {uploadsKb > 0 && (
          <span className="flex items-center gap-2 text-[11px] text-zinc-500" title="Uploaded photos are stored with the dish">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200">
              <span className="block h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, Math.round((used / MAX_ITEM_MEDIA_CHARS) * 100))}%` }} />
            </span>
            Uploads {uploadsKb} of {Math.round(MAX_ITEM_MEDIA_CHARS / 1024)} kB
          </span>
        )}
      </div>
      <ul className="flex flex-wrap gap-3" aria-label="Dish photos, cover first">
        {photos.map((photo, index) => (
          <li key={photo} className="w-[104px]">
            <div className="relative h-[78px] w-[104px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
              <img src={photo} alt={index === 0 ? 'Cover photo' : `Photo ${index + 1}`} className="h-full w-full object-cover" />
              {index === 0 && (
                <span className="absolute left-1 top-1 rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">Cover</span>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <button type="button" className={tileBtn} onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`} title="Move earlier">‹</button>
              <button type="button" className={tileBtn} onClick={() => move(index, 0)} disabled={index === 0} aria-label={`Make photo ${index + 1} the cover`} title="Make cover">★</button>
              <button type="button" className={tileBtn} onClick={() => move(index, index + 1)} disabled={index === photos.length - 1} aria-label={`Move photo ${index + 1} later`} title="Move later">›</button>
              <button
                type="button"
                className={`${tileBtn} hover:text-red-600`}
                onClick={() => { commit(photos.filter((_, position) => position !== index)); setError('') }}
                aria-label={`Remove photo ${index + 1}`}
                title="Remove"
              >
                ×
              </button>
            </div>
          </li>
        ))}
        {!full && (
          <li className="w-[104px]">
            <label
              htmlFor={inputId}
              className="grid h-[78px] w-[104px] cursor-pointer place-items-center rounded-xl border border-dashed border-zinc-300 bg-white px-2 text-center text-xs font-semibold text-zinc-600 hover:border-orange-300 hover:bg-orange-50"
            >
              {busy ? 'Resizing…' : photos.length ? '+ Add photos' : '+ Upload photos'}
            </label>
            <input
              id={inputId}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              className="sr-only"
              onChange={(event) => { pick(event.target.files); event.target.value = '' }}
            />
          </li>
        )}
      </ul>
      {!full && (
        <div className="mt-2 flex gap-2">
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLink() } }}
            placeholder="https://… or /photos/plate.jpg"
            aria-label="Photo link"
            className={inputCls}
          />
          <button
            type="button"
            onClick={addLink}
            disabled={!link.trim()}
            className="shrink-0 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            Add link
          </button>
        </div>
      )}
      <p className="mt-1 text-[11px] text-zinc-500">
        {error
          ? <span className="text-red-600">{error}</span>
          : (hint || `The first photo is the cover on the menu, QR page and documents; the kitchen display shows them all. Uploads are compressed to about ${maxKb} kB each.`)}
      </p>
    </div>
  )
}

// ─── Names in Khmer and Chinese ─────────────────────────────────────
// What the kitchen display (and later the floor) calls the item when a
// station runs in another language. Empty falls back to the English name.

export function NameTranslationsField({ value, onChange, englishName, hint }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Name in other languages</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {TRANSLATED_LANGUAGES.map((id) => {
          const meta = languageMeta(id)
          return (
            <label key={id} className="block">
              <span className="mb-0.5 block text-xs text-zinc-500">
                <span lang={meta.htmlLang} className="font-semibold text-zinc-700">{meta.label}</span> · {meta.english}
              </span>
              <input
                lang={meta.htmlLang}
                value={value?.[id] || ''}
                onChange={(event) => onChange({ ...value, [id]: event.target.value })}
                placeholder={englishName || 'Same as the English name'}
                maxLength={MAX_TRANSLATED_NAME}
                className={inputCls}
              />
            </label>
          )
        })}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">{hint || 'Shown on the kitchen display in that language; left empty, the English name is used.'}</p>
    </div>
  )
}
