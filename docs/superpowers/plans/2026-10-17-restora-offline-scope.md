# Restora Offline Operating Scope — Execution Plan

> Build plan (produces product code). Pairs with the design spec
> `docs/superpowers/specs/2026-10-12-restora-ux-design.md`. Source of truth
> for state stays `src/lib/reducer.js` (shared client + server).

**Goal:** Terminals keep operating while the server is unreachable: the app
runs on the cached snapshot, sales keep flowing, and every offline change
replays to the server on reconnect without being wiped or double-applied.
Plus the first-release restriction set the team agreed on.

**Decisions (locked):**
- **Cash session = open shift.** `shift.status: 'open' | 'closed'`; an
  offline sell on a branch requires an open session — but the gate is
  *opt-in per branch*: it arms the first time an operator explicitly
  opens/closes one (legacy roster rows carry no marker and never
  sentence an upgrading deployment to a drawer).
- **Customers = local directory.** Per-branch `customers` list +
  `UPSERT_CUSTOMER`; the New Check modal picks or saves a customer, and
  the order's customer block carries `customerId` for the link.
- **Never silently drop money.** A financial action the server refuses
  (409/403 on replay) is parked as a conflict record
  (`restora-conflicts-v1`) shown in `AppShell` until dismissed.
- **Idempotent replay.** Every synced action carries a client-unique
  `_lid`; the server stores it and dedupes replays by
  `(owner_id, client_id, lid)` — a queue flushed twice (crash between
  POST and response, two tabs) applies once.
- **Offline sign-in expires after 24h** (`restora-session-cache-v1`);
  cleared by logout or an explicit server "not signed in".
- **Minimal service worker** (production builds only): app-shell assets
  only; `/api/*` is never cached.
- **Accepted v1 oddities:** receipt numbers created on two offline
  terminals may collide (review banner documents them); duplicate
  customers from two offline terminals are tolerated (dedupe later).

**Restrictions while offline (`src/lib/offline.js`):** no catalog/menu/
inventory-master edits, no settings or exchange-rate changes, no
supplier/purchase actions, no template edits, no shift-roster edits, no
empire-level actions, card/QR payments, or voids of server orders.
Employee/role edits are API-routed and offline-blocked for free.

**Verification after every phase:** `npm run lint` → `npm test`. New
tests: `tests/offline-gates.test.js` (policy + reducer),
`tests/outbox.test.js` (queue storage), `tests/replay-dedup.test.js`
(server idempotency), `tests/offline-ui.test.js` (end-to-end offline
terminal through the real provider in jsdom).

---

## Phases (all landed)

1. **Outbox + replay** — `src/lib/outbox.js` (storage), `src/lib/store.jsx`
   (`recover()` = flush FIFO → `resync()` on every reconnect path; boot
   retry for terminals cold-booted during an outage), `server/db.js` +
   `server/index.js` (`lid` column, unique partial index, dedupe
   pre-check returning `{ seq, dedup: true }`).
2. **Gates** — `src/lib/offline.js` sets + preflight; enforced in
   `sendAction` (shop) and `dispatch` (empire) while the link is down.
3. **Cash session** — `shift.status` normalization (marker-preserving),
   open/close in `ScheduleScreen.jsx` (modal checkbox + one-click close).
4. **Customers** — reducer `UPSERT_CUSTOMER` + `customerId` link;
   picker/saver in `Tickets/sections/NewCheckModal.jsx`.
5. **Identity** — cached `/api/auth/me` fallback in `src/lib/auth.jsx`;
   branch pin + TTL feed the sale preflight.
6. **Chrome, i18n, tests** — `public/sw.js` + registration; queue count
   in the link pill + conflict banner in `AppShell.jsx`; km/en/zh
   phrases; the four test files above.
