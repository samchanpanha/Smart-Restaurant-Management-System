// ─── Photo carousel ─────────────────────────────────────────────────
// One large photo with arrows either side, a counter, and a strip of
// thumbnails underneath. ← / → and a swipe step through, wrapping at the
// ends. The large photo is letterboxed (object-contain) so a cook sees
// the whole plate, never a crop. A photo that fails to load shows a calm
// placeholder instead of a broken-image icon.

import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

const SWIPE_PX = 40

export default function PhotoCarousel({
  photos,
  index = 0,
  onIndexChange,
  altFor = (position) => `Photo ${position + 1}`,
  labels = {},
  keyboard = true,
}) {
  const count = photos.length
  const current = count ? Math.min(Math.max(0, index), count - 1) : 0
  const [failed, setFailed] = useState(() => new Set())
  const swipeFrom = useRef(null)
  const src = photos[current]

  const go = (next) => {
    if (count < 2) return
    onIndexChange?.((next + count) % count)
  }

  // Arrow keys page the photos while the carousel is on screen. Typing in a
  // field, or any modified arrow (the tab strip's shortcuts), is left alone.
  useEffect(() => {
    if (!keyboard || count < 2) return undefined
    function onKey(event) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')) return
      if (event.key === 'ArrowRight') { event.preventDefault(); onIndexChange?.((current + 1) % count) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); onIndexChange?.((current - 1 + count) % count) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, count, current, onIndexChange])

  if (!count) return null
  const broken = failed.has(src)

  return (
    <div className="space-y-2">
      <div
        className="relative overflow-hidden rounded-xl bg-[var(--color-ink-800)] ring-1 ring-inset ring-[var(--color-ink-700)]"
        style={{ aspectRatio: '16 / 10' }}
        onPointerDown={(event) => { swipeFrom.current = event.clientX }}
        onPointerUp={(event) => {
          if (swipeFrom.current === null) return
          const dx = event.clientX - swipeFrom.current
          swipeFrom.current = null
          if (Math.abs(dx) >= SWIPE_PX) go(current + (dx < 0 ? 1 : -1))
        }}
      >
        {broken ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-500">
            <Icon name="photo" size={34} />
            <span className="text-sm">{labels.missing || 'Photo unavailable'}</span>
          </div>
        ) : (
          <img
            key={src}
            src={src}
            alt={altFor(current)}
            draggable={false}
            decoding="async"
            onError={() => setFailed((set) => new Set(set).add(src))}
            className="h-full w-full select-none object-contain"
          />
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(current - 1)}
              aria-label={labels.prev || 'Previous photo'}
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-800 shadow-md ring-1 ring-black/10 transition hover:bg-white"
            >
              <Icon name="chevronLeft" size={22} />
            </button>
            <button
              type="button"
              onClick={() => go(current + 1)}
              aria-label={labels.next || 'Next photo'}
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-800 shadow-md ring-1 ring-black/10 transition hover:bg-white"
            >
              <Icon name="chevronRight" size={22} />
            </button>
            <span className="tnum absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white" aria-live="polite">
              {current + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto p-0.5">
          {photos.map((photo, position) => (
            <button
              key={photo}
              type="button"
              onClick={() => go(position)}
              aria-label={labels.show ? labels.show(position) : `Show photo ${position + 1}`}
              aria-current={position === current ? 'true' : undefined}
              className={`h-14 w-[88px] shrink-0 overflow-hidden rounded-lg bg-[var(--color-ink-800)] ring-2 ring-offset-1 transition ${
                position === current ? 'ring-amber-500' : 'opacity-70 ring-transparent hover:opacity-100'
              }`}
            >
              {failed.has(photo) ? (
                <span className="flex h-full w-full items-center justify-center text-zinc-500"><Icon name="photo" size={18} /></span>
              ) : (
                <img src={photo} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
