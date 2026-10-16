# Restora — Operations integrity, money truth, and a 3D customer surface

**Date:** 2026-10-16
**Status:** implemented
**Scope:** audit of the shipped `smart_restaurant` / Restora codebase, then a
focused pass on the order→kitchen→payment journey, the money records it
writes, and the customer-facing menu.

This plan follows the house format in `docs/superpowers/plans/`. The product
spec stays `docs/superpowers/specs/2026-10-12-restora-ux-design.md`.

---

## 1. Audit — what already exists

The brief asked for a project audit before changing anything. The repository
is **not** a prototype: it is a complete, tested, multi-tenant product.

| Area | State in the codebase | Verdict |
| --- | --- | --- |
| Framework | React 19 + Vite 8 + Tailwind v4; optional Express 5 + `better-sqlite3` | Confirmed — no rebuild needed |
| State | `src/lib/reducer.js` — one reducer, shared verbatim by browser and server | Sound, and the right place to fix logic |
| Live sync | SSE (`/api/events`) + snapshot resync + optimistic local apply | Works; no rewrite needed |
| Live kitchen queue | `src/screens/KitchenScreen.jsx` — station columns, SLA ring, bump/recall, 86 board | Exists |
| Table + QR ordering | `GuestScreen`, `GUEST_SEND`, Telegram mini app, `QrModal` | Exists |
| Low-stock alerts | `getAlerts`, `applyAuto86`, reorder policy (`reorder_point`/`par`) | Exists |
| Daily sales / best sellers | `src/lib/reports.js`, `src/screens/Reports/*` | Exists |
| Role-based access | `ROLE_NAV`, `allowedScreens`, `UsersScreen`, `RolesScreen` | Exists |
| i18n | km / en / zh, auto-translated, separate kitchen dictionary | Exists |
| AI | Optional, read-only, per-tenant config, 503 no-op without a key | Exists |
| Three.js | **Absent** | The one genuinely new dependency |

Baseline before this work: **315 tests passing, 41 lint warnings, 0 lint
errors**. After this work: **334 tests passing, the same 41 warnings, 0
errors**.

So the brief's Phase 1, Phase 2 and Phase 4 are, functionally, already
shipped. The audit instead found **four real defects** in the Phase 2
journey, plus the missing Phase 3.

---

## 2. Findings (all reproduced before fixing)

### F1 — A ticket keeps its status while new food cooks (order integrity)

`SEND_ORDER` advanced the status with a one-way ladder:

```js
const status = o.status === 'open' ? 'sent' : o.status === 'sent' ? 'in_prep' : o.status
```

A ticket that had reached `ready` (or `served`) and then had a new course
fired kept saying `ready`/`served` while the kitchen was cooking it. The
guest tracker showed "Ready" for food that was still in the pan, the Tickets
screen filed it under *Ready to serve*, and the cashier could close the
check on a ticket the kitchen had not started.

Reproduced on the seeded demo:

```
order o_seed_9 status: served
after ADD_ITEM   -> status: served | items: bump,bump,bump,held
after SEND_ORDER -> status: served | items: bump,bump,bump,fired   ← still "served"
```

### F2 — The declared status machine was decorative

`TICKET_TRANSITIONS` in `src/lib/constants.js` was only ever drawn by
`SystemScreen` as a diagram. No action consulted it. The reducer carried its
own ad-hoc allow-lists that had drifted from the machine (the machine said
`in_prep → ready`; the reducer allowed `in_prep → paid` and never said so).

### F3 — A voided line could hold a ticket out of "ready" forever

`VOID_ITEM` flags `voided: true` but leaves the line's `status` untouched, so
a voided `fired` line kept `every(item => item.status === 'bump')` false and
the ticket could never become ready.

### F4 — Two different numbers for the same night's money

`PAY_ORDER` stored `order.total = orderSubtotal + deliveryFee` — the food
subtotal, with **no tax, no service charge and no tip** — while the guest
actually paid `charges.total + tip`. Two consumers then read different
fields:

- `src/lib/reports.js` → `orderCharges(...).grandTotal` → the real takings
- `src/lib/documents.js` → `order.total` → the pre-tax subtotal

On the seeded demo (8 paid checks, 8.75% tax, 18% tip):

```
documents.js  (order.total)            : 388.00
reports.js    (orderCharges.grandTotal): 532.02   ← 27% apart
```

The dashboard and the Sales Report disagreed about the same service.

### F5 — No Three.js anywhere

Phase 3 of the brief was entirely undone.

---

## 3. What was changed

### 3.1 The ticket status is derived from its lines

`src/lib/models.js` — `orderStatusFromItems(items, current)` is now the one
place that answers "where does this ticket stand":

- voided lines are excluded (fixes F3),
- food in the pan pulls a `ready`/`served` ticket back to `in_prep` (fixes F1),
- `served` survives a bump, because handing a plate over is a server action.

`src/lib/reducer.js` — `SEND_ORDER`, `BUMP_ITEM` and `RECALL_ITEM` now derive
the status through that helper instead of the ladder. The dead
`orderStatusFromItems` helper is finally used.

### 3.2 The status machine is enforced

`src/lib/constants.js` — `TICKET_TRANSITIONS` is corrected and complete:

- `sent → paid` and `in_prep → paid` (a guest who is leaving settles early —
  legal, and now written down),
- `ready → in_prep` and `served → in_prep` (the re-fire path from F1).

`src/lib/reducer.js` — `SERVE_ORDER`, `PAY_ORDER` and `VOID_ORDER` consult
`canTicketTransition` before they move a ticket. A check can only be served
when nothing is cooking, and can only be settled once.

### 3.3 One number for the money

- `PAY_ORDER` records the amount actually collected in `order.total`, plus
  the breakdown, so the ticket agrees with the receipt.
- `src/lib/documents.js` reads the same charge sheet the Sales Report reads.
- `src/lib/seed.js` derives the seeded paid checks from their own lines
  instead of hand-written numbers.

### 3.4 Three.js on the customer surface

New `src/components/three/`:

| File | Job |
| --- | --- |
| `capabilities.js` | The two questions — can this browser draw WebGL, and has the guest asked for reduced motion? Nothing here imports `three`, so the check runs before the chunk is ever fetched. |
| `DishStage.jsx` | The scene: a plate and a dish built from plain geometry, a slow turn, a little pointer lean. Lazy-loaded, so `three` + `@react-three/fiber` arrive only when a guest opens a dish on a capable browser. |
| `DishShowcase.jsx` | The decision. Photo underneath, stage on top, and the photo left showing if anything goes wrong. |
| `StageBoundary.jsx` | The safety net — a failed chunk or a thrown scene falls back to the photo instead of breaking the menu. |

The rules it keeps:

- **Lazy.** `three` and `@react-three/fiber` are in their own build chunk
  (`dist/assets/DishStage-*.js`); the main bundle is unchanged, so the
  staff workspace never pays for them.
- **Disposable.** No WebGL, `prefers-reduced-motion: reduce`, a failed
  download, or a scene that throws — each of those leaves the dish photo
  on screen and the menu working.
- **Decorative.** No textures and no 3D fonts, so the km/en/zh labels stay
  real, translatable HTML, and the canvas is hidden from screen readers.
- **Cheap.** The stage stops drawing when it scrolls out of view; the
  device pixel ratio is capped.
- **Guest only.** The kitchen, dashboard, floor and ticket screens are
  untouched and stay 2D.

### 3.5 Notifications that do not block a tablet

The back office answered with `window.alert`, `window.prompt` and
`window.confirm` — native dialogs that freeze a tablet, cannot be styled,
and read like a bug in a dark workspace. There were **eleven** of them.

- `src/components/ui/Toast.jsx` + `toast-context.js` — one toast host for
  the whole app, raised through `useToast()`. Used by `Settings → Data`
  (a restored snapshot) and by the supplier delete.
- `src/components/ui/ConfirmProvider.jsx` + `confirm-context.js` — one
  confirm host for the whole app, raised through `useConfirm()`:

  ```js
  const confirm = useConfirm()
  if (!(await confirm({ title: 'Delete this table?', body: '…', tone: 'danger' }))) return
  ```

  The dialog is rendered by the provider, so no screen has to own dialog
  state, and outside a provider the hook answers "no" — a screen rendered
  on its own can never act without an answer.
- Converted: reset demo data (×2), delete a table, delete a restaurant,
  delete a role, remove a user, delete a received purchase, reset a
  settings section, reset all settings, re-base the ledger, revalue the
  catalog.
- `SuppliersScreen` keeps its own dialog: deleting a vendor that still
  owns stock is a real decision, so that dialog says how many items move,
  offers the vendors to move them to, and refuses plainly when there is
  nowhere to put them.

`src/` now contains no native dialog at all, and `tests/screens-ui.test.js`
walks every screen with `alert` / `confirm` / `prompt` stubbed out, so a
new one cannot creep back in.

### 3.6 Tests

New `tests/order-lifecycle.test.js` locks the whole journey:
customer submits → kitchen fires → bump → serve → cashier pays → the sales
record agrees — plus the transition guard, the duplicate-payment guard, the
re-fire regression and the voided-line regression.

New `tests/three-fallback.test.js` holds the 3D contract: no WebGL means no
canvas, reduced motion means no canvas, and a guest always gets the photo.

New `tests/notifications.test.js` holds the dialog contract: a toast can be
raised and dismissed, deleting a supplier opens our own dialog, and a
destructive action asks in the app's dialog and answers "no" when the
operator cancels — all without a single native `alert` / `confirm` /
`prompt`.

---

## 4. How to run and verify

```bash
npm install --ignore-scripts   # node-gyp cannot fetch headers in the sandbox
npm run lint        # expect 0 errors (41 warnings, same as the baseline)
npm test            # expect 334 passing, 0 failures
npm run dev         # Vite on :5173 (localStorage, no backend needed)
npm run server      # Express + SQLite on :3001
npm run seed:demo   # idempotent demo seed (both stores + a login per role)
```

The test count moved from 315 to 334: 9 lifecycle, 5 3D fallback, 5
notification.

Manual walk-through:

1. `npm run server` then `npm run seed:demo`.
2. Open `http://localhost:5173/?role=owner&screen=floor` and sign in.
3. Floor → Table 9 → add a dessert → **Send**. The ticket must read *In prep*,
   not *Ready* (F1).
4. Kitchen → bump every line → the ticket reads *Ready*. Tickets → **Mark
   served**.
5. Tickets → **Pay** → close the check. The Dashboard "tonight" figure and
   the Sales Report must now agree (F4).
6. Pay the same check twice — the second attempt must not move the money.
7. `http://localhost:5173/?guest=t08` — the guest menu. Open a dish: the
   3D stage renders where WebGL is available and falls back to the dish
   photo otherwise; with *Reduce motion* on in the OS it never loads at all.
8. Suppliers → pick a vendor → **Delete**. A dialog asks, names how many
   stock items move, and offers the vendors to move them to. No browser
   dialog ever appears.
9. Any destructive action — delete a table, remove a user, reset the demo
   data — opens the same house dialog instead of a browser one.
