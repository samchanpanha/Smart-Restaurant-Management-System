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
node --test tests/units.test.js   # run one test file
```

No typecheck. Verification order: `lint` → `test`.

## Architecture — read this before changing state

- **`src/lib/reducer.js` is the single source of truth and runs on both sides.** The client (`src/lib/store.jsx`) and the server (`server/index.js`, `server/db.js`, `server/telegram.js`) import the *same* reducer. Every state change must be a new action dispatched through it — never mutate state elsewhere, or the server/SSE terminals diverge.
- State is an "empire": `{ version, locations: { downtown, riverside } }`. Shop actions travel wrapped as `{ type: 'LOC', locId, action }`. `STATE_VERSION` is `6` (server schema is v3); old snapshots/DBs migrate on boot in `reducer.js` `migrateToEmpire` and `server/db.js`. Bumping a version means adding a migration, not just changing the number.
- The server imports helpers from `src/lib/**`; the Dockerfile ships both `server/` and `src/` for this reason. Keep them ESM-compatible and safe to import in Node (no browser globals at module top level).
- **Multi-tenant:** every state table, action log, and SSE stream is partitioned by `owner_id`. Tenant per request: signed-in user → own owner; super admin → `?ownerId=`; guests/mini app → `?owner=<slug>`. Don't write cross-tenant reads.
- **Money** is stored as plain numbers in the base currency and formatted only via `src/lib/currency.js`; normalized menu prices in SQLite are integer cents. **Unit arithmetic** (`packFactor`, `packPrice`, `describeQty`, …) lives only in `src/lib/units.js`.
- **i18n:** UI supports km/en/zh. Strings are auto-translated through `src/lib/i18n.js` + `src/lib/i18n-phrases.js`; add phrases there instead of hardcoding translated text. The Kitchen display has its own dict in `src/lib/kitchen-i18n.js` and defaults to Khmer.
- Guest surfaces (`GuestScreen`, `MiniAppScreen`) render with `<RestoraProvider waitForServer={false}>` so the menu paints before the network answers; only logged-in terminals wait on a boot screen.

## Tests

- `node --test` with `node:assert/strict`; files in `tests/*.test.js`. No Jest/Vitest.
- Server tests (`auth-server.test.js`, `tenant-isolation.test.js`, `demo-seed.test.js`, `menu-catalog.test.js`) point `RESTORA_DATA` at an `os.tmpdir()` scratch dir before importing `server/*`. Always set `RESTORA_DATA` for test writes — never touch `server/data/`.
- UI tests (`screens-ui.test.js`, `tabs-ui.test.js`, `screens-contract.test.js`, `multitab-ui.test.js`, `telegram-ui.test.js`, `miniapp-seating.test.js`) boot Vite via `createServer({ server: { middlewareMode: true, hmr: false } })` in jsdom, then `ssrLoadModule`. Reproduce this setup when adding a UI test — without `hmr: false`, concurrent UI tests collide on the HMR port.
- Each `src/screens/*Screen.jsx` should keep a heading the contract test can find; `ROLE_NAV` / `NAV_SECTIONS` in `src/lib/constants.js` drive both sidebar and tab strip and must not drift.

## Operational gotchas

- The root `.env` is a **stale leftover** from a Postgres/Spring Boot template and is never loaded (no `dotenv`). Real config is `process.env` only: `PORT`, `HOST`, `RESTORA_*`, `TELEGRAM_*`, `SUPERADMIN_*` (see README).
- `server/data/` (SQLite) and `dist/` are git-ignored. In Docker the DB lives on the `restora-data` volume — seed it with `docker compose exec restora npm run seed:demo`, not from the host.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `style:`), often with a scope (`feat(tenant): …`).
