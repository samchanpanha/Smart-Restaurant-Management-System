# AGENTS.md

Restora — smart restaurant management. React 19 + Vite + Tailwind v4 frontend; optional Express 5 + `better-sqlite3` backend. Plain JS/JSX, ESM only (`"type": "module"`) — there is **no TypeScript and no build step for the server**.

The design source of truth is `docs/superpowers/specs/2026-10-12-restora-ux-design.md` (plan: `docs/superpowers/plans/`). `README.md` §"Build tracker" maps modules to steps.

## Commands

```bash
npm install
npm run dev        # Vite demo on :5173, localStorage, no backend needed
npm run build      # → dist/
npm run server     # Express + SQLite API on :3001 (serves dist/ if built)
npm run seed:demo  # idempotent full demo (both stores + a login per role)
npm test           # node --test over tests/**/*.test.js
npm run lint       # oxlint (warnings tolerated; only no-undef is an error)
npm run check:ui   # static audit: fonts, CSS, type scale, responsive risk
node --test tests/units.test.js   # run one test file
```

No typecheck. Verification order: `lint` → `check:ui` → `test`.

## Architecture — read this before changing state

- **`src/lib/reducer.js` is the single source of truth and runs on both sides.** The client (`src/lib/store.jsx`) and the server (`server/index.js`, `server/db.js`, `server/telegram.js`, `server/ai.js`) import the *same* reducer. Every state change must be a new action dispatched through it — never mutate state elsewhere, or the server/SSE terminals diverge.
- State is an "empire": `{ version, locations: { downtown, riverside } }`. Shop actions travel wrapped as `{ type: 'LOC', locId, action }`. `STATE_VERSION` is `6` (server schema is v3); old snapshots/DBs migrate on boot in `reducer.js` `migrateToEmpire` and `server/db.js`. Bumping a version means adding a migration, not just changing the number.
- The server imports helpers from `src/lib/**`; the Dockerfile ships both `server/` and `src/` for this reason. Keep them ESM-compatible and safe to import in Node (no browser globals at module top level).
- **Multi-tenant:** every state table, action log, and SSE stream is partitioned by `owner_id`. Tenant per request: signed-in user → own owner; super admin → `?ownerId=`; guests/mini app → `?owner=<slug>`. Don't write cross-tenant reads.
- **Money** is stored as plain numbers in the base currency and formatted only via `src/lib/currency.js`; normalized menu prices in SQLite are integer cents. **Unit arithmetic** (`packFactor`, `packPrice`, `describeQty`, …) lives only in `src/lib/units.js`.
- **i18n:** UI supports km/en/zh. Strings are auto-translated through `src/lib/i18n.js` + `src/lib/i18n-phrases.js`; add phrases there instead of hardcoding translated text. The Kitchen display has its own dict in `src/lib/kitchen-i18n.js` and defaults to Khmer.
- **AI is optional and read-only.** `server/ai.js` exposes `/api/ai/{status,chat,insight,briefing}` around a provider-agnostic adapter (`src/lib/ai-providers.js`) and a redacted context digest (`src/lib/ai.js`); the browser calls them through `src/lib/ai-client.js`. No `AI_API_KEY` ⇒ every route is a 503 no-op and the app is unchanged. Guests are pinned to `scope:'menu'`, the model never dispatches a reducer action, and replies are cached per context hash. Prompting lives in `src/lib/ai.js`: the guest `scope:'menu'` digest is the rich row (localized names, `dietaryTags`/`allergens`/`spiceLevel`, ingredient names only — never quantities/costs, plus a `popular` flag from real sales) and uses `SYSTEM_PROMPTS.menuBase` for recommendation-first answers; ops adds `SYSTEM_PROMPTS.appGuide` so "how do I …" questions can be answered. Guests hitting `/api/ai/status` get no server stats, and guest rate-limit buckets are per-IP (`actorKey`). Surfaces: the Ops Copilot screen (`src/screens/Assistant/`), the dashboard AI cards (`src/screens/Dashboard/sections/{AiInsight,ShiftBriefing}.jsx`), and the guest/mini-app concierge (`src/components/MenuConcierge.jsx`). Sixteen vendors live in `src/lib/ai-providers.js` as pure data (`wire` = openai | anthropic | gemini | ollama, plus `models`/`tier`/`keysUrl` for the UI) — adding one is a data change, never a branch: openai, anthropic, gemini, deepseek, qwen (+ the mainland DashScope endpoint as an `alternate`), groq, openrouter, mistral, cerebras, zhipu, moonshot, xai, together, perplexity, ollama, lmstudio. `normalizeProvider` also resolves aliases (`dashscope`, `kimi`, `glm`, `claude`, `grok`, …); unknown names fall back to `openai`. Local wires (`ollama`, `lmstudio`) need no key: `providerNeedsKey()` gates that, so throwing `AI_API_KEY` away does not disable a local model.
**Multi-key failover.** Stored config may carry `keys: [{ id, label, provider, model, baseUrl, apiKey, enabled }]` + `rotate`. `mergeAiConfig(stored, env)` folds that into an ordered `attempts` chain (primary → enabled backups → env `AI_KEYS`) via `buildAttempts()`; every attempt is de-duplicated by (provider, key) and a keyless cloud entry is dropped. `createAiRouter` walks that chain, parks a failed key for `AI_FAILOVER_COOLDOWN_MS` (health lives in memory, keyed by attempt id), and reports the winner as `via`/`failover` — never the key. `rotate` round-robins instead of always preferring the primary. `poolStatus(tenantId)` is the sanitized health view the settings screen reads.
Env vars: `AI_API_KEY`, `AI_KEYS`, `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS`, `AI_FAILOVER_COOLDOWN_MS`, `AI_RATE_LIMIT`, `AI_GUEST_RATE_LIMIT`, `AI_RATE_WINDOW_MS`, `AI_CACHE_TTL_MS` (see README).
- **Per-tenant AI config (owner/super-admin only).** `server/ai-config.js` adds `GET`/`PUT /api/ai/config` and `POST /api/ai/config/test` (`keyId` targets one backup key); the UI is **Settings → AI assistant** (`src/screens/Settings/sections/Ai.jsx`). Config lives in the SQLite `kv` table (`getAiConfig`/`setAiConfig` in `server/db.js`) — **never** in reducer state, because `/api/state` is served to guests. `mergeAiConfig(stored, env)` (exported from `server/ai.js`) lets tenant fields override env with per-field fallback; the raw key is write-only (`present()` reports `hasKey`/`keySource`/`keyCount`/`poolCount`/`keys[]` metadata, never a key). Saving `keys` replaces the pool: an entry with no `apiKey` inherits the stored secret with the same `id`, so the UI can relabel or disable a key without the owner re-pasting it. Changes apply on the next request, no restart.
- Guest surfaces (`GuestScreen`, `MiniAppScreen`) render with `<RestoraProvider waitForServer={false}>` so the menu paints before the network answers; only logged-in terminals wait on a boot screen.

## Type, CSS & responsive contract

- **Fonts are self-hosted.** `public/fonts/*.woff2` (Inter Variable latin + latin-ext, Noto Sans Khmer Variable) are vendored from the `@fontsource` dev-deps by `npm run fonts:sync` and declared in `src/styles/fonts.css`; `index.html` preloads them. Never point `@font-face` at a CDN — a restaurant LAN has no internet.
- **Micro type is a token**, not a literal: `text-2xs` / `text-3xs` / `text-4xs` / `text-kpi` are declared in `@theme` (`src/index.css`). Do not reintroduce `text-[11px]`.
- **Script-aware scale** lives in `src/styles/typography.css` and keys off `html[lang]`. `applyDocumentLang()` in `src/lib/i18n.js` (called by `setAppLang` and the `useI18n` effect) is the only writer of `<html lang>`; `index.html` sets it pre-paint from the saved language. Khmer needs the bigger sizes and the looser leading — that is why the tokens exist.
- **`src/styles/responsive.css` is deliberately unlayered**: Tailwind utilities live in `@layer utilities`, so an unlayered rule of equal specificity wins without `!important`. That is how `.app-shell` overrides `h-screen` (dvh) and `.table-scroll` styles the wide financial tables. Style existing legacy selectors in `src/index.css` instead — those come later in source order and would win.
- Wide tables get `className="table-scroll"`; charts get their palette from `.recharts-*` rules, never from the JSX.
- `scripts/audit-ui.mjs` (`npm run check:ui`) is the mechanical contract, asserted by `tests/typography-css.test.js`, which also computes WCAG contrast for every text token and the remapped zinc ladder. Add a rule there when a bug class should not come back.

## Tests

- `node --test` with `node:assert/strict`; files in `tests/*.test.js`. No Jest/Vitest.
- Server tests (`auth-server.test.js`, `tenant-isolation.test.js`, `demo-seed.test.js`, `menu-catalog.test.js`) point `RESTORA_DATA` at an `os.tmpdir()` scratch dir before importing `server/*`. Always set `RESTORA_DATA` for test writes — never touch `server/data/`.
- UI tests (`screens-ui.test.js`, `tabs-ui.test.js`, `screens-contract.test.js`, `multitab-ui.test.js`, `telegram-ui.test.js`, `miniapp-seating.test.js`, `assistant-ui.test.js`, `dashboard-ai.test.js`, `guest-concierge.test.js`) boot Vite via `createServer({ server: { middlewareMode: true, hmr: false } })` in jsdom, then `ssrLoadModule`. Reproduce this setup when adding a UI test — without `hmr: false`, concurrent UI tests collide on the HMR port. The AI/guest UI tests stub `globalThis.fetch` so `/api/ai/*` answers without a server.
- Each `src/screens/*Screen.jsx` should keep a heading the contract test can find; `ROLE_NAV` / `NAV_SECTIONS` in `src/lib/constants.js` drive both sidebar and tab strip and must not drift.

## Operational gotchas

- The root `.env` is a **stale leftover** from a Postgres/Spring Boot template and is never loaded (no `dotenv`). Real config is `process.env` only: `PORT`, `HOST`, `RESTORA_*`, `TELEGRAM_*`, `SUPERADMIN_*`, `AI_*` (see README).
- `server/data/` (SQLite) and `dist/` are git-ignored. In Docker the DB lives on the `restora-data` volume — seed it with `docker compose exec restora npm run seed:demo`, not from the host.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `style:`), often with a scope (`feat(tenant): …`).
