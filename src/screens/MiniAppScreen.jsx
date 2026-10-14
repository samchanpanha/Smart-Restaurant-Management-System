// ─── Telegram mini app ──────────────────────────────────────────────
// The guest menu, packaged for Telegram. It is the SAME surface the table
// QR opens (GuestScreen) inside the platform chrome: Telegram gets its
// ready/expand/theme calls and a haptic tap when an order lands, and a
// plain browser gets the identical page without the chrome. Nothing here
// is required for ordering to work, which is what keeps it honest.

import { useEffect, useState } from 'react'
import GuestScreen from './GuestScreen'
import { Icon } from '../components/Icon'
import { translateTableName, translateZone, useI18n } from '../lib/i18n'
import { useRestora } from '../lib/store'

function telegramWebApp() {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp || null
}

export default function MiniAppScreen({ tableId }) {
  const { state } = useRestora()
  const { lang } = useI18n()
  const [inTelegram, setInTelegram] = useState(Boolean(telegramWebApp()))
  const [toast, setToast] = useState('')
  // Opened from the chat rather than a table QR: start on a table that is
  // already in service, and let the guest pick their own if they want to.
  const [picked, setPicked] = useState(() => tableId
    || state.tables.find((table) => table.status === 'seated' || table.status === 'ordered')?.id
    || state.tables[0]?.id
    || '')

  useEffect(() => {
    const app = telegramWebApp()
    if (!app) return undefined
    try {
      app.ready()
      app.expand?.()
      app.setHeaderColor?.('#1b1c1e')
      app.setBackgroundColor?.('#faf6ef')
      app.disableVerticalSwipes?.()
      app.enableClosingConfirmation?.()
      // Paint with Telegram's own palette when the client hands one over.
      const theme = app.themeParams
      if (theme?.bg_color) document.documentElement.style.setProperty('--tg-bg', theme.bg_color)
      if (theme?.text_color) document.documentElement.style.setProperty('--tg-text', theme.text_color)
      setInTelegram(true)
    } catch {
      setInTelegram(false)
    }
    return undefined
  }, [])

  useEffect(() => {
    function onSent() {
      const app = telegramWebApp()
      try {
        app?.HapticFeedback?.notificationOccurred?.('success')
      } catch {
        /* older clients */
      }
      setToast('Sent to the kitchen')
      window.setTimeout(() => setToast(''), 3500)
    }
    window.addEventListener('restora:order-sent', onSent)
    return () => window.removeEventListener('restora:order-sent', onSent)
  }, [])

  const table = state.tables.find((entry) => entry.id === picked)

  return (
    <div className="min-h-screen bg-[#f2efe9]">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-[#1b1c1e] text-white">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-amber-400">
            <Icon name="send" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{state.settings?.restaurantName || 'The Olive Restaurant'}</div>
            <div className="truncate text-[11px] text-white/60">
              {table ? `${translateTableName(table.name, lang)} · ${translateZone(table.zone, lang)}` : 'Table not found'} · Telegram mini app{table && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
            </div>
          </div>
          {!tableId && state.tables.length > 1 && (
            <label className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/60">
              <span className="sr-only">Table</span>
              <select
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                className="rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white outline-none"
              >
                {state.tables.map((entry) => (
                  <option key={entry.id} value={entry.id} className="text-zinc-900">
                    {translateTableName(entry.name, lang)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {inTelegram
            ? <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300">In Telegram</span>
            : <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300">Web preview</span>}
        </div>
      </header>

      {!inTelegram && (
        <p className="mx-auto max-w-md px-4 pt-3 text-[11px] leading-relaxed text-stone-500">
          This page is the mini app a guest opens from the bot. Opened outside Telegram it behaves exactly like the
          table QR page — the platform calls (ready, expand, theme, haptics) simply do nothing.
        </p>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-40 mx-auto w-fit rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg" role="status">
          {toast}
        </div>
      )}

      <main className="mx-auto max-w-md">
        <GuestScreen tableId={picked} allowPickup />
      </main>
    </div>
  )
}
