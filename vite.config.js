import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import {
  TRANSLATE_LANGS,
  createTranslationCache,
  sanitizeForTranslation,
  translateBatch,
} from './src/lib/translate-engine.js'

// https://vite.dev/config/

const BACKEND = 'http://localhost:3001'
const TRANSLATE_PATH = '/api/translate'

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

/**
 * Machine translation in `npm run dev`.
 *
 * Google's free translate endpoint sends no CORS headers, so the browser can
 * only reach it through a same-origin proxy. In production that is
 * `server/translate.js`; this middleware is the dev twin, so the documented
 * zero-backend demo (`vite` on :5173, localStorage) still translates.
 *
 * It prefers the real Express route when one is listening on :3001 — that
 * keeps a single shared cache across dev terminals — and only translates
 * in-process when nothing is there (ECONNREFUSED). The engine
 * (`src/lib/translate-engine.js`) is the same module both hosts use, so the
 * two paths cannot drift.
 */
function translateDevApi() {
  const cache = createTranslationCache({ max: 4000 })
  const stats = { requests: 0, strings: 0, upstream: 0, local: 0, errors: 0, lastError: null }

  async function handleLocally(req, res, url, rawBody) {
    // The body is parsed first because that is where the browser client puts
    // `target` — reading only the query string 400s every real request and
    // leaves dev silently dictionary-only.
    let body = {}
    if (req.method === 'POST') {
      try {
        body = JSON.parse(rawBody || '{}')
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
        return
      }
    }

    const target = String(body.target || url.searchParams.get('target') || '').trim().toLowerCase()
    if (!TRANSLATE_LANGS.includes(target)) {
      sendJson(res, 400, { ok: false, error: `unsupported target language: ${target || '(none)'}` })
      return
    }

    let texts = []
    if (req.method === 'POST') {
      const raw = Array.isArray(body.texts) ? body.texts : (typeof body.text === 'string' ? [body.text] : [])
      texts = raw.filter((text) => typeof text === 'string').slice(0, 120)
    } else {
      const single = url.searchParams.get('text')
      texts = single ? [single] : []
    }
    texts = texts.map(sanitizeForTranslation).filter(Boolean)

    stats.requests += 1
    stats.strings += texts.length
    if (!texts.length) {
      sendJson(res, 200, { ok: true, translations: {}, missing: [], requests: 0, dev: 'vite' })
      return
    }

    const result = await translateBatch({ texts, target, cache, timeoutMs: 8000 })
    stats.upstream += result.requests
    stats.local += 1
    if (!result.ok) {
      stats.errors += 1
      stats.lastError = result.error || 'translate failed'
    }
    if (req.method === 'POST') {
      sendJson(res, 200, {
        ok: result.ok,
        target,
        translations: result.translations,
        missing: result.missing,
        skipped: result.skipped,
        requests: result.requests,
        error: result.error,
        dev: 'vite',
      })
      return
    }
    const text = texts[0]
    sendJson(res, 200, {
      ok: result.ok,
      text,
      target,
      translation: result.translations[text] || '',
      cached: result.requests === 0,
      error: result.error,
      dev: 'vite',
    })
  }

  return {
    name: 'restora-translate-dev-api',
    configureServer(server) {
      // Registered before Vite's internal middlewares, so this runs ahead of
      // the `/api` → :3001 proxy below and can answer translation itself.
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(TRANSLATE_PATH)) return next()
        const url = new URL(req.url, 'http://localhost')

        void (async () => {
          // Read the body once: it has to survive a failed proxy attempt,
          // because the fallback below still needs it.
          let rawBody = ''
          if (req.method === 'POST') {
            try {
              rawBody = await readBody(req)
            } catch {
              sendJson(res, 413, { ok: false, error: 'payload too large' })
              return
            }
          }

          // Prefer the real backend when it is up (one shared cache for every
          // dev terminal); translate in-process when nothing is listening.
          try {
            const response = await fetch(`${BACKEND}${req.url}`, {
              method: req.method,
              headers: { 'content-type': 'application/json' },
              body: req.method === 'POST' ? rawBody : undefined,
            })
            const payload = await response.text()
            res.statusCode = response.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(payload)
            return
          } catch (error) {
            const code = error?.cause?.code || error?.code || ''
            if (code !== 'ECONNREFUSED' && code !== 'ENOTFOUND' && code !== 'ECONNRESET') {
              sendJson(res, 502, { ok: false, error: `backend proxy failed: ${error?.message || code}` })
              return
            }
          }

          if (url.pathname === `${TRANSLATE_PATH}/status`) {
            sendJson(res, 200, {
              ok: true,
              enabled: true,
              provider: 'google-translate-free',
              source: 'en',
              targets: TRANSLATE_LANGS.map((lang) => ({ lang, code: lang === 'zh' ? 'zh-CN' : lang })),
              cache: { entries: cache.size },
              stats,
              dev: 'vite',
            })
            return
          }
          await handleLocally(req, res, url, rawBody)
        })()
        return undefined
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), translateDevApi()],
  build: {
    rollupOptions: {
      output: {
        // Split the vendored libs out of the app chunk so a code change to a
        // screen does not invalidate React/lucide in the browser cache.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
    // Screens are split per route; the remaining app chunk is i18n phrases +
    // the four shift-critical screens kept eager for a fallback-free boot.
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': BACKEND,
    },
  },
})
