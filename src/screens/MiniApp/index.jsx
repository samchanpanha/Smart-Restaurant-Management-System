import { useEffect, useRef, useState } from 'react'
import GuestScreen from '../GuestScreen'
import { Icon } from '../../components/Icon'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { translateTableName, translateZone, useDomTranslator, useI18n } from '../../lib/i18n'
import { isFreeTableStatus, isTableInServiceStatus } from '../../lib/constants'
import { loadTelegramWebApp } from '../../lib/telegram-webapp'
import { quoteWait, useRestora } from '../../lib/store'
import { useToast } from '../../components/ui/toast-context'
import { guestSessionToken, telegramWebApp, applyTelegramTheme } from './shared.js'
import { MiniAppTableController } from './sections/MiniAppTableController.jsx'
import { TablePicker } from './sections/TablePicker.jsx'

function MiniAppScreen({ tableId }) {
  const { state, dispatch } = useRestora()
  const { lang, dict } = useI18n()
  useDomTranslator(null, lang)
  const { notify } = useToast()
  const [inTelegram, setInTelegram] = useState(false)
  // The party size chosen in the picker travels with the claim, and the
  // name Telegram already knows is used instead of a generic label.
  const [partySize, setPartySize] = useState(2)
  const [guestName, setGuestName] = useState('')
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
        const user = app.initDataUnsafe?.user
        if (user) {
          const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
          if (name && !cancelled) setGuestName(name)
        }
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
      notify(dict.miniapp?.sentToKitchen || 'Sent to the kitchen', 'success')
    }
    window.addEventListener('restora:order-sent', onSent)
    return () => window.removeEventListener('restora:order-sent', onSent)
  }, [dict.miniapp, notify])

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
  const onDineIn = orderMode === 'dine_in'
  const restaurantName = state.settings?.restaurantName || 'The Olive Restaurant'
  const modeLabel = orderMode === 'delivery'
    ? (dict.miniapp?.deliveryOrder || '🛵 Delivery order')
    : orderMode === 'pickup'
      ? (dict.miniapp?.pickupOrder || '🍽 Pickup order')
      : ''
  const tableLabel = table
    ? `${translateTableName(table.name, lang)} · ${translateZone(table.zone, lang)}`
    : state.tables.length > 0
      ? (dict.miniapp?.noTableSelected || 'No table selected')
      : (dict.miniapp?.tableNotFound || 'Table not found')
  const waitMin = quoteWait(state, partySize)
  // Delivery and pickup skip the table picker entirely.
  const offTable = orderMode === 'delivery' || orderMode === 'pickup'
  const showPicker = !offTable && (pickerOpen || (!table && state.tables.length > 0))
  // A free/reserved table is not seated yet: the welcome card is the only
  // gate, so the old duplicate GuestScreen gate never renders underneath it.
  const canOrder = offTable || Boolean(table && isTableInServiceStatus(table.status))

  function seatHere(next) {
    // One action per tap: the claim already marks the table occupied, sets
    // seatedBy: 'guest' and records the movement, and the guest menu treats
    // 'occupied' as seated. A second SEAT_PARTY round-trip only made the
    // tap feel slow on a phone connection.
    dispatch({
      type: 'MINIAPP_CLAIM_TABLE',
      payload: {
        tableId: next.id,
        partySize,
        guestName: guestName.trim() || 'Telegram Guest',
        sessionToken: guestSessionToken(),
      },
    })
    setPicked(next.id)
    setPickerOpen(false)
    setOrderMode('dine_in')
  }

  function chooseTable(next) {
    if (isFreeTableStatus(next.status)) return seatHere(next)
    if (isTableInServiceStatus(next.status)) {
      setPicked(next.id)
      setPickerOpen(false)
    }
  }

  return (
    <div className="restora-guest min-h-screen bg-[var(--guest-page)]">
      <header ref={headerRef} className="surface-dark sticky top-0 z-40 border-b border-black/5 bg-[var(--guest-chrome)] text-white">
        <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {onDineIn && state.tables.length > 0 ? (
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              aria-label={table
                ? `${dict.miniapp?.changeTable || 'Change table'} — ${translateTableName(table.name, lang)}`
                : (dict.miniapp?.choose || 'Choose a table')}
              className="group flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-amber-400">
                <Icon name="send" size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{restaurantName}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-white/60">
                  <span className="truncate">{tableLabel}</span>
                  <span aria-hidden="true" className="text-[9px] text-white/45 transition-transform group-hover:translate-y-0.5">▾</span>
                  {table && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
                </span>
              </span>
            </button>
          ) : (
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-amber-400">
                <Icon name="send" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{restaurantName}</div>
                {offTable ? (
                  <button
                    type="button"
                    onClick={() => setOrderMode('dine_in')}
                    className="mt-0.5 flex min-h-7 max-w-full items-center gap-1 text-[11px] font-medium text-white/60 transition-colors hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    <span className="truncate">{modeLabel}</span>
                    <span className="shrink-0 underline decoration-white/30 underline-offset-2">
                      {dict.miniapp?.change || 'Change'}
                    </span>
                  </button>
                ) : (
                  <div className="truncate text-[11px] font-medium text-white/60">
                    {tableLabel}
                    {table && onDineIn && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
                  </div>
                )}
              </div>
            </div>
          )}
          <LanguageSwitcher compact menu tone="dark" testIdPrefix="miniapp-lang" className="shrink-0" />
          <span className="sr-only">{inTelegram ? 'In Telegram' : 'Web preview'}</span>
          <span className="sr-only">Telegram mini app</span>
        </div>
      </header>

      {/* Welcome journey + seated bar. Pickup/delivery is chosen from the
          welcome card, so the permanent order-type strip is gone. */}
      {!offTable && (
        <div className="mx-auto max-w-md">
          <MiniAppTableController
            activeTable={table}
            waitMin={waitMin}
            onOpenPicker={() => setPickerOpen(true)}
            onSeatActive={seatHere}
            onTableReady={(t) => {
              if (t && t.id !== picked) setPicked(t.id)
            }}
          />
        </div>
      )}

      <main className="mx-auto max-w-md">
        {showPicker ? (
          <TablePicker
            tables={state.tables}
            pickedId={picked}
            waitMin={waitMin}
            lang={lang}
            partySize={partySize}
            onPartySize={setPartySize}
            onChoose={chooseTable}
            onClose={table ? () => setPickerOpen(false) : null}
          />
        ) : canOrder ? (
          <GuestScreen
            key={offTable ? orderMode : 'dine_in'}
            tableId={offTable ? '' : (picked || '')}
            allowPickup={true}
            initialOrderMode={offTable ? orderMode : null}
            embedded
            defaultGuestName={guestName}
            onSelfSeat={table && isFreeTableStatus(table.status) ? () => seatHere(table) : null}
          />
        ) : null}
      </main>
    </div>
  )
}

export default MiniAppScreen
