

const SESSION_KEY = 'restora_miniapp_session_v1'
function guestSessionToken() {
  try {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const created = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(SESSION_KEY, created)
    return created
  } catch {
    return `sess_${Date.now().toString(36)}`
  }
}

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
export { SESSION_KEY, guestSessionToken, telegramWebApp, applyTelegramTheme, TABLE_TAG }
