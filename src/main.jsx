import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadBrand } from './lib/branding.js'

// Paint the deployment brand (title, favicon, home-screen icon) as early as
// possible; the fetch is public and failures keep the built-in defaults.
loadBrand()

// Offline app shell (production only): the built assets come from the
// cache so a cold reload works with no network. Dev keeps raw Vite, or
// HMR and every module fetch would fight the service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is a progressive enhancement */
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
