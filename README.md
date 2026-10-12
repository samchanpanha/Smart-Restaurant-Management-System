# Restora — Smart Restaurant Management System

Single-location casual dining, table service, 12–24 tables.
One operational system of record for the ticket — floor, kitchen, stock, and owner see the same shift.

> Spec: `docs/superpowers/specs/2026-10-12-restora-ux-design.md`
> Plan: `docs/superpowers/plans/2026-10-12-restora-ux-case-study.md`

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # production build → dist/
```

No backend needed. State persists to `localStorage`; **Reset demo data** in the sidebar restores the Friday-night seed.

## Stack

React 19 + Vite + Tailwind CSS v4. In-memory store (`useReducer` + context) with `localStorage` persistence.

## Build tracker (spine-first)

| Step | Module | Status | What it proves |
|------|--------|--------|----------------|
| 1 | Object model + status machines | ✅ Done | Tables, tickets, items, recipes, inventory, alerts; strict machines; seed data; role-aware shell |
| 2 | Floor seat/dirty | ✅ Done | Live map by zone, tap-to-seat, over-cap confirm, reservations, waitlist + honest wait quotes |
| 3 | Ticket compose/send/undo | ✅ Done | Composer + required mods, 86 w/ substitute, course fire, 15s undo, split/pay/void/comp |
| 4 | KDS fire/bump/86 | ⬜ Next | Station columns, age alerts, 86 board, 60s recall |
| 5 | Theoretical inventory on fire | ⬜ | Receive, count sheet, waste log, par alerts |
| 6 | Dashboard alerts | ⬜ | KPIs, alert rail, sparkline, SLA, floor snapshot |
| 7 | Recipe cost + matrix | ⬜ | Coster, popularity×margin matrix, ingredient shock |
| 8 | Reports | ⬜ | Sales, server/table, voids, variance, P&L-lite |

## Key rules (from spec — enforced in code)

- Table machine is strict: `free → seated → ordered → billed → dirty → free` (`reserved` overlays `free`)
- Theoretical inventory drops on **fire**, not on draft, not on pay
- Send = commit: 15s undo, then kitchen owns the item; bump recall 60s
- Status is color + word, never color alone; 44px targets on Floor/Kitchen
- Plate cost uses last invoice cost; contribution bands high ≥70 / ok 55–70 / low 10–55 / loss <10
