import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installApiTransport } from './lib/api'

// Every same-origin /api call carries the session: the HttpOnly cookie, plus
// the bearer token when the browser could not keep the cookie (embedded frame,
// third-party cookies blocked). Installed here, once, so no screen has to
// remember it — see src/lib/api.js.
installApiTransport()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
