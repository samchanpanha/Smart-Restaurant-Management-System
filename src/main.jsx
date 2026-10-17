import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadBrand } from './lib/branding.js'

// Paint the deployment brand (title, favicon, home-screen icon) as early as
// possible; the fetch is public and failures keep the built-in defaults.
loadBrand()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
