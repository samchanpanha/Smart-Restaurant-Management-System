// ─── Telegram WebApp SDK loader ─────────────────────────────────────
// The mini app needs `window.Telegram.WebApp` for the platform chrome:
// expanding to full height, the theme colours, the haptics, the closing
// confirmation and the guest's own name from initData. Without the SDK
// every one of those silently no-ops and the app renders as a plain web
// page squeezed into the Telegram viewport.
//
// It is loaded on demand instead of from a <script> in index.html so the
// first paint never waits on telegram.org — on a slow phone connection a
// render-blocking third-party script is exactly what makes a mini app
// feel dead. A timeout keeps a captive-portal request from hanging the
// platform setup forever.

const SDK_SRC = 'https://telegram.org/js/telegram-web-app.js'
const SDK_TIMEOUT_MS = 4000

let pending = null

/** Resolves with the WebApp object (or null outside Telegram / offline). */
export function loadTelegramWebApp() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null)
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp)
  if (pending) return pending

  pending = new Promise((resolve) => {
    let settled = false
    const finish = (app) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(app || null)
    }
    const timer = setTimeout(() => finish(window.Telegram?.WebApp || null), SDK_TIMEOUT_MS)
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.onload = () => finish(window.Telegram?.WebApp || null)
    script.onerror = () => finish(null)
    document.head.appendChild(script)
  })
  return pending
}
