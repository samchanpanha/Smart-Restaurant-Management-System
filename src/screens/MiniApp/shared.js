
import {
  GUEST_ORDER_KEY,
  GUEST_SESSION_KEY,
  guestSessionToken,
  loadGuestOrder,
  saveGuestOrder,
} from '../../lib/guest-session.js'

function telegramWebApp() {
  const app = typeof window !== 'undefined' ? window.Telegram?.WebApp : null
  return app || null
}

/** Telegram hands the mini app a palette; mirror it onto the page. */
function applyTelegramTheme(app) {
  const theme = app?.themeParams
  if (!theme) return
  if (theme.bg_color) document.documentElement.style.setProperty('--tg-bg', theme.bg_color)
  if (theme.text_color) document.documentElement.style.setProperty('--tg-text', theme.text_color)
}

const TABLE_TAG = {
  free: 'Free · sit here',
  available: 'Free · sit here',
  idle: 'Free · sit here',
  reserved: 'Reserved',
  seated: 'In service',
  occupied: 'In service',
  ordered: 'In service',
  billed: 'Paying',
  billing: 'Paying',
  cleaning: 'Being cleaned',
  dirty: 'Being cleaned',
}
export {
  GUEST_ORDER_KEY,
  GUEST_SESSION_KEY,
  guestSessionToken,
  loadGuestOrder,
  saveGuestOrder,
  telegramWebApp,
  applyTelegramTheme,
  TABLE_TAG,
}
