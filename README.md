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
```

No backend needed for the demo: state persists to `localStorage`; **Reset demo data** in the sidebar restores the Friday-night seed.

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

Known v1 limits: actions apply optimistically — if two terminals race (same
table), the server rejects the loser (`409`) and it resyncs. Edits made while
offline are overwritten by the authoritative snapshot on reconnect.

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
