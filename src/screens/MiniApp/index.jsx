import { useEffect, useRef, useState } from 'react'
import GuestScreen from '../GuestScreen'
import { Icon } from '../../components/Icon'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { translateTableName, translateZone, useDomTranslator, useI18n } from '../../lib/i18n'
import { isFreeTableStatus, isTableInServiceStatus } from '../../lib/constants'
import { loadTelegramWebApp } from '../../lib/telegram-webapp'
import { quoteWait, useRestora } from '../../lib/store'
import { guestSessionToken, telegramWebApp, applyTelegramTheme } from './shared.js'
import { MiniAppTableController } from './sections/MiniAppTableController.jsx'
import { TablePicker } from './sections/TablePicker.jsx'

function MiniAppScreen({ tableId }) {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  useDomTranslator(null, lang)
  const [inTelegram, setInTelegram] = useState(false)
  const [toast, setToast] = useState('')
  // orderMode: 'dine_in' | 'pickup' | 'delivery'
  const [orderMode, setOrderMode] = useState('dine_in')
  const [picked, setPicked] = useState(() => {
    const fromUrl = tableId ? state.tables.find((t) => t.id === tableId) : null
    if (fromUrl) return fromUrl.id
    return state.tables.find((t) => isTableInServiceStatus(t.status))?.id || null
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const headerRef = useRef(null)

  // The seated table bar sticks right under this header. Measure the header
  // (it grows with the notch inset) into a CSS var so the two never overlap.
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const apply = () => {
      const height = el.getBoundingClientRect().height
      if (height) document.documentElement.style.setProperty('--miniapp-top-offset', `${Math.round(height)}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--miniapp-top-offset')
    }
  }, [])

  // Platform bootstrap: the SDK is fetched in the background, so the menu
  // paints first and the chrome (expand, theme, closing guard, haptics)
  // is applied the moment it arrives.
  useEffect(() => {
    let cancelled = false
    loadTelegramWebApp().then((app) => {
      if (cancelled || !app) return
      try {
        app.ready()
        app.expand?.()
        app.setHeaderColor?.('#1b1c1e')
        app.setBackgroundColor?.('#faf6ef')
        app.disableVerticalSwipes?.()
        app.enableClosingConfirmation?.()
        app.onEvent?.('themeChanged', () => applyTelegramTheme(app))
        applyTelegramTheme(app)
        setInTelegram(true)
      } catch {
        if (!cancelled) setInTelegram(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onSent() {
      const app = telegramWebApp()
      try {
        app?.HapticFeedback?.notificationOccurred?.('success')
      } catch {
        /* older clients */
      }
      setToast(dict.miniapp?.sentToKitchen || 'Sent to the kitchen')
      window.setTimeout(() => setToast(''), 3500)
    }
    window.addEventListener('restora:order-sent', onSent)
    return () => window.removeEventListener('restora:order-sent', onSent)
  }, [dict.miniapp])

  // The MiniAppTableController's "Delivery" button fires this event to switch
  // the order mode without prop-drilling through the controller.
  useEffect(() => {
    function onOrderMode(e) {
      const mode = e?.detail?.mode
      if (mode === 'delivery' || mode === 'pickup' || mode === 'dine_in') {
        setOrderMode(mode)
        setPickerOpen(false)
      }
    }
    window.addEventListener('restora:order-mode', onOrderMode)
    return () => window.removeEventListener('restora:order-mode', onOrderMode)
  }, [])

  const table = state.tables.find((entry) => entry.id === picked) || null
  const waitMin = quoteWait(state, 2)
  // Delivery and pickup skip the table picker entirely.
  const offTable = orderMode === 'delivery' || orderMode === 'pickup'
  const showPicker = !offTable && (pickerOpen || (!table && state.tables.length > 0))

  function seatHere(next) {
    // One action per tap: the claim already marks the table occupied, sets
    // seatedBy: 'guest' and records the movement, and the guest menu treats
    // 'occupied' as seated. A second SEAT_PARTY round-trip only made the
    // tap feel slow on a phone connection.
    dispatch({
      type: 'MINIAPP_CLAIM_TABLE',
      payload: {
        tableId: next.id,
        partySize: 2,
        guestName: 'Telegram Guest',
        sessionToken: guestSessionToken(),
      },
    })
    setPicked(next.id)
    setPickerOpen(false)
  }

  function chooseTable(next) {
    if (isFreeTableStatus(next.status)) return seatHere(next)
    if (isTableInServiceStatus(next.status)) {
      setPicked(next.id)
      setPickerOpen(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--guest-page)]">
      <header ref={headerRef} className="sticky top-0 z-40 border-b border-black/5 bg-[var(--guest-chrome)] text-white">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-amber-400">
            <Icon name="send" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{state.settings?.restaurantName || 'The Olive Restaurant'}</div>
            <div className="text-[11px] text-white/60">
              {orderMode === 'delivery'
                ? (dict.miniapp?.deliveryOrder || '🛵 Delivery order')
                : orderMode === 'pickup'
                  ? (dict.miniapp?.pickupOrder || '🍽 Pickup order')
                  : table
                    ? `${translateTableName(table.name, lang)} · ${translateZone(table.zone, lang)}`
                    : state.tables.length > 0 ? (dict.miniapp?.noTableSelected || 'No table selected') : (dict.miniapp?.tableNotFound || 'Table not found')}
              {table && orderMode === 'dine_in' && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
            </div>
          </div>
          <LanguageSwitcher compact testIdPrefix="miniapp-lang" className="shrink-0" />
          {state.tables.length > 0 && orderMode === 'dine_in' && (
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              className="shrink-0 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white"
            >
              {table ? (dict.miniapp?.table || 'Table') : (dict.miniapp?.choose || 'Choose')} ▾
              <span className="sr-only">Table</span>
            </button>
          )}
          {inTelegram ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300">
              {dict.miniapp?.inTelegram || 'In Telegram'}
              {lang !== 'en' && <span className="sr-only"> In Telegram</span>}
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300">
              {dict.miniapp?.webPreview || 'Web preview'}
              {lang !== 'en' && <span className="sr-only"> Web preview</span>}
            </span>
          )}
          <span className="sr-only">Telegram mini app</span>
        </div>
      </header>

      {/* Order type selector: Dine-in / Pickup / Delivery */}
      <div className="mx-auto max-w-md px-4 pt-3">
        <div className="flex gap-2 rounded-2xl bg-white/60 p-1 shadow-sm backdrop-blur" role="tablist" aria-label="Order type">
          {[
            ['dine_in', '🪑', dict.miniapp?.dineIn || 'Dine-in'],
            ['pickup', '🍽', dict.miniapp?.pickup || 'Pickup'],
            ['delivery', '🛵', dict.miniapp?.delivery || 'Delivery'],
          ].map(([mode, icon, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={orderMode === mode}
              onClick={() => { setOrderMode(mode); if (mode !== 'dine_in') setPickerOpen(false) }}
              className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all ${
                orderMode === mode
                  ? 'bg-amber-500 text-stone-950 shadow-sm'
                  : 'text-stone-600 hover:bg-white/80'
              }`}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* MiniAppTableController: Self-seating sticky bar, 1-tap service bar & interactive drawer */}
      <div className="mx-auto max-w-md">
        <MiniAppTableController
          activeTable={table}
          onSelectTable={(id) => setPicked(id)}
          onTableReady={(t) => {
            if (t && t.id !== picked) setPicked(t.id)
          }}
        />
      </div>

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
        {showPicker ? (
          <TablePicker
            tables={state.tables}
            pickedId={picked}
            waitMin={waitMin}
            lang={lang}
            onChoose={chooseTable}
            onClose={table ? () => setPickerOpen(false) : null}
          />
        ) : (
          <GuestScreen
            tableId={offTable ? '' : (picked || '')}
            allowPickup={true}
            initialOrderMode={offTable ? orderMode : null}
            onSelfSeat={table && isFreeTableStatus(table.status) ? () => seatHere(table) : null}
          />
        )}
      </main>
    </div>
  )
}

export default MiniAppScreen
