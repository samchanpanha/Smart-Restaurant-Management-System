# Restora — Smart Restaurant Management System

Single-location casual dining, table service, 12–24 tables.
One operational system of record for the ticket — floor, kitchen, stock, and owner see the same shift.

> Spec: `docs/superpowers/specs/2026-10-12-restora-ux-design.md`
> Plan: `docs/superpowers/plans/2026-10-12-restora-ux-case-study.md`

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173 (standalone demo, localStorage)
npm run build    # production build → dist/
npm test         # reducer, SQLite menu catalog, and workspace tab checks
```

No backend needed for the demo: state persists to `localStorage`; **Reset demo data** in the sidebar restores the Friday-night seed.

## Workspace tabs

The app includes a Chrome-style tab strip above the active screen. Use **+** to
open a tab, select a tab to switch screens, and **×** to close one. Each tab
keeps its own screen and store location; restaurant data remains shared. The
last remaining tab closes back to the current role's default screen (Floor when
available). Keyboard shortcuts: **Ctrl/⌘+T** opens
a tab, **Ctrl/⌘+W** closes the active tab, and **Ctrl/⌘+Tab** switches tabs
(**Ctrl/⌘+Shift+Tab** goes backward). Tabs are session-only and reset to one
tab when the app reloads.

## Two terminals, one truth (backend)

`npm run server` starts Express + SQLite on `:3001`. The app auto-detects it,
boots from the server snapshot, and every terminal follows the same action log
live over SSE — the server re-runs the **exact same reducer** (`src/lib/reducer.js`).

```bash
npm run server            # API + SQLite (fresh seed on first run)
npm run dev               # in another shell — /api proxied to :3001
```

Kiosk URLs — open one per device:

- Floor tablet: `http://<host>:5173/?role=host&screen=floor`
- Kitchen display: `http://<host>:5173/?role=kitchen&screen=kitchen`
- Server handheld: `http://<host>:5173/?role=server&screen=tickets`
- Owner laptop: `http://<host>:5173/?role=owner&screen=dashboard`

Single-port production mode: `npm run build && npm run server` serves the
built frontend + API together (API on `:3001`, or set `PORT=`).

Data lives in `server/data/restora.sqlite` (git-ignored). Delete it to reseed.
Sidebar shows link state: **Live · server** / **Offline · this terminal** / **Local demo**.

### SQLite menu catalog

The existing snapshot/action-log database now also maintains a normalized,
location-scoped catalog. Menu changes are projected in the same SQLite
transaction as the state snapshot and action log. Tables include:

- `menu_categories` and `menu_items` (prices stored as integer cents)
- `menu_item_labels` for dietary labels and allergen notes
- `menu_modifier_groups` and `menu_modifier_options`

The owner can add/edit items in **Control → Menu & Recipes**. Descriptions,
category, price, kitchen station, optional image URL, dietary/allergen labels,
86 status, and guest visibility are saved per location. The customer QR menu
reads those details and falls back to local state when the API is offline.

Read endpoint: `GET /api/menu?loc=downtown` (optional `q`, `category`, and
`availableOnly=true` filters). For example, `/api/menu?loc=riverside&q=salmon`
returns Riverside's salmon item.

Allergen/dietary notes in the included demo seed are examples only; verify them
against the actual recipe and kitchen cross-contact practices before using them
for guest safety decisions.

Known v1 limits: actions apply optimistically — if two terminals race (same
table), the server rejects the loser (`409`) and it resyncs. Edits made while
offline are overwritten by the authoritative snapshot on reconnect.

## Guest QR ordering

Each table has a QR tent card (Floor → table → 📱 Table QR code). Guests scan
and get a light consumer app at `/?guest=<tableId>` — no login, no sidebar:

- Menu (86'd dishes vanish instantly) with required modifiers enforced
- Cart → **Send to kitchen**: one atomic `GUEST_SEND` lands on the table's
  shared ticket, tagged QR, and fires the KDS + decrements stock
- Live status per line (🔥 In kitchen → ✓ Ready) over the same SSE sync
- 🙋 Call server + bill request raise alerts on staff screens (Dashboard rail,
  Tickets banner with "On my way" ack)
- Pay the whole check with tip, or ask the server to take payment

Demo routing is by table id; production tents would carry unguessable tokens.

## Multi-location

Two demo stores — **Downtown** (16 tables) and **Riverside** (10 tables, softer
history, and it *has* salmon). State shape v2 keeps a full shop per store:

- Owner gets a **store switcher** in the sidebar; staff terminals stay pinned
  (`?loc=riverside` kiosk param, else Downtown)
- Every screen is location-scoped with zero per-screen changes — actions travel
  wrapped as `{ type: 'LOC', locId, action }` through the same shared reducer
- Dashboard (owner) adds an **Across locations** strip: per-store sales, covers,
  food cost, occupancy + combined total, tap to jump stores
- Menus, stock, tickets, and 86 boards are fully independent per store
  (86 wings downtown — Riverside keeps selling them)
- Old v1 snapshots (server DB + localStorage) **migrate on boot**: v1 becomes
  Downtown, Riverside seeds fresh; bare pre-LOC actions still apply to Downtown

## Stack

React 19 + Vite + Tailwind CSS v4. `useReducer` + context, synced to
Express + SQLite (`better-sqlite3`) via action log + SSE when a server is present.

## Build tracker (spine-first)

| Step | Module | Status | What it proves |
|------|--------|--------|----------------|
| 1 | Object model + status machines | ✅ Done | Tables, tickets, items, recipes, inventory, alerts; strict machines; seed data; role-aware shell |
| 2 | Floor seat/dirty | ✅ Done | Live map by zone, tap-to-seat, over-cap confirm, reservations, waitlist + honest wait quotes |
| 3 | Ticket compose/send/undo | ✅ Done | Composer + required mods, 86 w/ substitute, course fire, 15s undo, split/pay/void/comp |
| 4 | KDS fire/bump/86 | ✅ Done | Station columns + expo, live SLA timers, bump-all, 60s recall, shared 86 board |
| 5 | Theoretical inventory on fire | ✅ Done | Stock exceptions, receive w/ plate-cost impact, count sheet w/ variance reasons, waste log |
| 6 | Dashboard alerts | ✅ Done | KPIs, tappable alert rail, rush watch, sparkline, sellers/losers, SLA, floor snapshot |
| 7 | Recipe cost + matrix | ✅ Done | Recipe coster w/ snapshots, 86 write-through, menu matrix, ingredient shocks, in-place reprice |
| 8 | Reports | ✅ Done | Sales/hour/category/day, service, voids audit, variance, P&L-lite — every report ends in an action |

## Key rules (from spec — enforced in code)

- Table machine is strict: `free → seated → ordered → billed → dirty → free` (`reserved` overlays `free`)
- Theoretical inventory drops on **fire**, not on draft, not on pay
- Send = commit: 15s undo, then kitchen owns the item; bump recall 60s
- Status is color + word, never color alone; 44px targets on Floor/Kitchen
- Plate cost uses last invoice cost; contribution bands high ≥70 / ok 55–70 / low 10–55 / loss <10
