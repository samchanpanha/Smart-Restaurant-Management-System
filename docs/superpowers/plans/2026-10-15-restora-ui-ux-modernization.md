# Restora UI/UX Modernization — Execution Plan

> Build plan (produces product code). Pairs with the design spec
> `docs/superpowers/specs/2026-10-12-restora-ux-design.md` and the audit this
> plan is based on. Source of truth for state stays `src/lib/reducer.js`.

**Goal:** Make every surface faster, consistent, accessible and easier to
manage — a real design system, split render path, interactive 2D floor, faster
live-ops screens, modernized admin modules, and a unified guest/mini-app — with
no regression to offline-first sync or the shared reducer.

**Decisions (locked):**
- All workstreams; **interactive 2D floor, no Three.js** (leave a seam).
- **Tablet-first staff + phone-first guests.**
- **Keep light workspace + dark sidebar**, but tokenized (no palette remap).
- Pragmatic dependencies allowed.

**Stack additions:** `react-router-dom`, `zustand`, `@floating-ui/react`,
`lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`,
`recharts` (lazy). No `three`.

**Verification after every wave:** `npm run lint` → `npm test`; new tests use
`node --test`; UI tests keep the Vite `middlewareMode` + `hmr: false` jsdom
harness.

---

## Global constraints

- Never bypass `src/lib/reducer.js`; it runs on both client and server.
- Behavior-preserving migrations: bump `STATE_VERSION` for any shape change.
- Keep `ROLE_NAV` / `NAV_SECTIONS` (`src/lib/constants.js`) as the one nav
  source (sidebar + tab strip must not drift).
- Keep guest/mini-app first paint (`waitForServer={false}`) intact.
- 44px tap targets, status is color **and** word, respect `prefers-reduced-motion`.

---

## Wave 1 — Design system + UI kit (foundation)

**Files:** `src/index.css`, new `src/components/ui/*`, new `src/lib/cn.js`,
`src/components/Icon.jsx`, new `tests/design-system.test.js`.

- [x] **1.1 Semantic token layer** — added `:root` semantic tokens + radius/
  elevation/typography/motion/z-index scales and `.surface-dark` scope.
  *(The legacy `.restora-theme` palette remap is deprecated, not yet deleted —
  removal is gated on screens migrating to tokens/primitives in Waves 4–5.)*
- [ ] **1.2 Fold guest (stone/amber) + mini-app (raw navy hex) palettes into
  tokens** — deferred to Wave 6 (touch the same screens once).
- [x] **1.3 Primitives** in `src/components/ui/`: `Button`/`IconButton`, `Badge`,
  `Card`, `SectionHeader`, `Toolbar`, `Divider`, `Skeleton`, `EmptyState`,
  `ErrorBanner`, `Modal` (portal + focus trap + Esc + scroll lock + focus
  restore), `Sheet` (safe-area), `Drawer`, `Field`, `Input/Select/Textarea`,
  `Toggle`, `Stepper`, `Tabs`, `DataTable`. *(Toast/Toaster + CommandPalette
  deferred to Wave 2.)*
- [x] **1.4 `Icon.jsx` now backed by `lucide-react`** behind the same
  `<Icon name>` API; unknown names warn in DEV instead of silently falling back.
- [x] **1.5 `cn()`** (`clsx` + `tailwind-merge`) + `cva` variants.
- [x] **1.6 `tests/design-system.test.js`** — 14 tests; full suite 240 green;
  `npm run build` green.

**DoD:** primitives render + tested; palette remap removal tracked for Waves 4–5.

**Dep note:** added `clsx`, `tailwind-merge`, `class-variance-authority`,
`lucide-react`. `react-router-dom`, `zustand`, `@floating-ui/react` land in
Wave 2; `recharts` in Wave 5.


## Wave 2 — App architecture

**Files:** `src/lib/store.jsx`, `src/App.jsx`, `src/components/AppShell.jsx`,
`src/components/TabStrip.jsx`, `src/lib/constants.js`, new `src/lib/clock.jsx`,
new `src/components/ErrorBoundary.jsx`, `vite.config.js`,
new `tests/resilience.test.js`.

- [x] **2.1 (partial)** `setLink` is now idempotent — an SSE ping that reports
  the same `{ server, live }` no longer allocates a new object, so the context
  value stays stable. *(Full State/Dispatch/Ui context split deferred: only the
  active screen + shell are mounted, so the churn was the value object, not the
  consumer count — revisit with the Wave 3 selector work.)*
- [x] **2.2** Shared `ClockProvider` (`src/lib/clock.jsx`): one master 200ms
  interval drives every `useNow(intervalMs)` through per-subscriber cadence;
  `useNow` re-exported from the store so call sites are unchanged, with a
  private-interval fallback when no provider is mounted.
- [x] **2.3** `React.lazy` + `Suspense` per screen, `advancedChunks` vendor
  split (react/icons), deep-link URL sync (`?screen=&loc=`) via
  `history.replaceState`. *(`react-router-dom` skipped: this canvas-tab app has
  no route tree; lightweight URL sync gives shareable links without the dep.
  `popstate` back-button handling deferred.)*
- [x] **2.4** Per-screen `ErrorBoundary` (`ScreenBoundary`, auto-resets on tab
  change); single role gate `allowedScreens(role, screens)` in
  `constants.js` — fixes the `TabStrip.jsx` drift, now shared by sidebar,
  strip, router and search. *(Cmd+K palette + mobile sidebar drawer deferred to
  the polish waves.)*

**DoD:** one floor action no longer re-renders on link chatter; each screen's
chunk loads on demand; a throwing screen is contained and recoverable. ✅


## Wave 3 — Performance & data growth

**Files:** `src/lib/reducer.js`, `server/db.js`, `src/lib/store.jsx`,
`src/components/AppShell.jsx`, `src/screens/MenuScreen.jsx`.

- [x] **3.1 Cap `state.orders`** — `MAX_ORDERS = 400` via `capOrders` (keeps all
  open + last 400 closed); applied on `ADD_ORDER`/`CREATE_ORDER` and in
  `withShopDefaults`. *Archive-to-daily-aggregates + `STATE_VERSION` bump
  deferred* — shape is unchanged so no migration is required yet.
- [x] **3.2 Prune `dismissedAlerts`** — `MAX_DISMISSED_ALERTS = 200` (`slice(-200)`)
  on append and on `withShopDefaults`.
- [x] **3.3 Server `actions` retention** — `commitActionTx` prunes rows older than
  `RETAIN_ACTIONS = 5000` per tenant each insert; `AUTOINCREMENT` keeps `seq`
  monotone so a lagging client just resyncs (`seq` gap > 200).
- [x] **3.4 Debounce localStorage writes** — coalesced to a single ~300 ms write,
  flushed on `pagehide`.
- [x] **3.5 AppShell search index + `useDeferredValue`** — flat index built once
  per data change (`useMemo`), filtered per keystroke; query trails input.
- [x] **3.6 Compute `getAlerts` once** — one `useMemo` in `store.jsx` exposed as
  `alerts` on context; `AppShell` and `TabStrip` read it (no local recompute).
- [x] **3.7 `useMemo` MenuScreen sort/costing.**
- [ ] **3.8 Uniform Loading/Empty/Error/Offline states.** — *deferred to Wave 6*
  (fold into guest/empty-state pass).

**DoD:** snapshot bounded across a simulated long shift; no redundant scans.
*Met:* `tests/retention.test.js` (5 tests) pins order/alert caps, boot-trim
migration, and the 5000-row action-log bound. `lint` clean · `test` 251/251 ·
`build` clean.

## Wave 4 — Live ops screens

**Files:** `src/screens/FloorScreen.jsx`, `KitchenScreen.jsx`, `TicketsScreen.jsx`.

- [x] **4.1 Floor:** table positions + `SET_TABLE_LAYOUT` action + migration;
  interactive 2D plan (zoom/pan, drag+snap, zone overlays); drive colors from
  `TABLE_STATUS_META` (fix `FloorScreen.jsx:1075` green bug); self-seat /
  service / bill badges on tiles.
  - `reducer.js`: `normalizeTablePositions` (0–100, grid slot per zone when
    missing) applied in `withShopDefaults` + `ADD_TABLE`; new `SET_TABLE_LAYOUT`
    (single or batch `moves`, clamps, same-ref no-op); `STATE_VERSION` 4 → 5;
    fixed `migrateToEmpire` version override.
  - `seed.js`: `TABLE_LAYOUT` positions for t01–t16.
  - `FloorScreen.jsx`: interactive plan — zoom (buttons + wheel), pan (pointer
    capture), arrange-mode drag+snap + arrow nudge, zone bands, status tones from
    `TABLE_STATUS_META`, badges (`S` self-seat, `$` bill, item count).
  - Tests: `floor-layout.test.js` (6); `STATE_VERSION` assertions updated.
- [x] **4.2 KDS:** `React.memo` cards; isolate the 1s tick to timer text; close
  gallery by default / lazy; station filters; large bump.
  - `KitchenScreen.jsx`: ticking leaves (`CardAge`/`AgeRing`/`LineAge`/`NewBadge`)
    subscribe to `useNow(1000)` so the per-second clock no longer repaints cards;
    `TicketCard` memoized (takes `tables`+`dispatch` as props, drops `now`);
    gallery defaults closed; bump buttons enlarged to 48px+.
  - `kitchen.test.js` updated for gallery-closed-on-first-paint.
- [x] **4.3 Tickets:** quick-add favorites/recent, search-first composer,
  keyboard fire/hold.
  - `TicketsScreen.jsx` composer: `autoFocus` search (Enter adds top match,
    Esc clears) + quick-add strip (bestsellers ★ + recent ↺) derived from order
    history, `data-testid="quick-add"`.
  - `TicketWorkspace`: keyboard `F` fires held lines, `S` marks ready served
    (ignored while typing / modal open) with on-screen hints; removed the unused
    `onError` composer param.
  - `screens-ui.test.js`: composer quick-add + keyboard-fire test.

**DoD:** floor drag persists + reloads; KDS 1s tick no longer repaints cards. ✅

## Wave 5 — Admin modules

**Files:** split `SettingsScreen`/`Tickets`/`Floor`/`Catalog`/`Reports`/`MiniApp`.

- [x] **5.1** Extract into `screens/<Name>/` + `sections/*`; no file > ~600 lines.
  - `SettingsScreen.jsx` → `Settings/{index.jsx, primitives.jsx, sections/*}`
    (Business/Money/Documents/Food/Units/Stock/Pos/Alerts/Data).
  - `TicketsScreen.jsx` → `Tickets/{index.jsx, shared.js, sections/*}`
    (TicketList/ModifierModal/Composer/ReasonModal/PayModal/Lines/
    TicketWorkspace/NewCheckModal/OrderDetailsModal/UndoBanner).
  - `FloorScreen.jsx` → `Floor/{index.jsx, shared.js, sections/*}` (SeatDialog/
    TableCard/TransferTableModal/TableDetail/RescheduleModal/ReservationsPanel/
    WaitlistPanel/TableEditorModal/FloorMap).
  - `CatalogScreen.jsx` → `Catalog/{index.jsx, shared.js, sections/*}`
    (CategoryEditor/CategoriesTab/ProductModal/ProductsTab/IngredientModal/
    IngredientsTab).
  - `ReportsScreen.jsx` → `Reports/{index.jsx, shared.js, sections/*}`
    (Common/Sales/Service/Voids/Variance/Pnl/SellBuy/ProfitLoss/TopLow).
  - `MiniAppScreen.jsx` → `MiniApp/{index.jsx, shared.js, sections/*}`
    (MiniAppTableController/TablePicker); each old `*Screen.jsx` is now a
    one-line re-export shim.
  - `multitab-ui.test.js`: added a `flush()` that polls until the Suspense
    fallback clears (extra modules made the fixed-time `settle()` flaky).
- [x] **5.2 Settings:** in-page nav + first-run setup wizard; per-section save.
  - `Settings/index.jsx`: per-section dirty tracking (`touched` keys per section);
    a section footer with `Save <section>` / `Discard` that publishes only that
    section's keys, nav dots (`data-testid="section-dirty-*"`), and a
    "N sections with unsaved edits" footer. Whole-draft header save kept.
  - `Settings/SetupWizard.jsx`: guided 6-step pass (business → money →
    documents → stock → food → pos) over the same draft; step list, Back/Next,
    Finish publishes. Auto-opens only for a near-empty store (`audit.done ≤ 2`);
    otherwise reachable from the "Setup wizard / Finish setup" header button.
  - `screens-ui.test.js`: per-section save isolation + wizard step/finish tests.
- [x] **5.3 Catalog/Inventory:** extract editors; responsive tables→cards; bulk.
  - Editors were already extracted in 5.1 (`Catalog/sections/{CategoryEditor,
    ProductModal,IngredientModal}.jsx`), so this wave adopts the shared responsive
    `components/ui/Table.jsx` `DataTable` (real `<table>` on md+, stacked labeled
    cards below) in `Catalog/sections/ProductsTab.jsx`,
    `Catalog/sections/IngredientsTab.jsx`, and `InventoryScreen.jsx` `StockTab`
    (all previously forced `min-w-[760–900px]` horizontal scroll).
  - Select-all moved out of the table header into each toolbar (safe for mobile
    card headers); bulk bars: Products already had category/station/86/restore;
    Ingredients gained bulk **Assign supplier** / **Move storage**; Inventory
    Stock gained bulk **Export selection** (CSV) alongside select-all.
  - Footers now sit as text strips under the table; empty states render inside
    `DataTable`'s `empty` slot.
- [x] **5.4 Reports:** shared `ReportShell`, saved views, lazy `recharts`,
  every report ends in an action.
  - `sections/Common.jsx` gained `ReportShell({ title, source, action })` — a
    standard report header (title + one-line "reads from" source note) wrapping
    the body; all 8 report sections (`Sales`, `SellBuy`, `ProfitLoss`, `TopLow`,
    `Service`, `Voids`, `Variance`, `Pnl`) now render through it. Every report
    already ended in a `NextAction` (verified; added where missing).
  - `sections/SavedViews.jsx`: name the current `{ tab, range }` as a "view",
    persisted to `localStorage` (`restora.reports.views.v1`), recalled from a
    `select[aria-label="Saved views"]`, deletable; wired into the Reports header.
  - `sections/RevenueChart.jsx` + `sections/RevenueChartImpl.jsx`: `recharts`
    (`^3.10.1`, new dep) area chart for the Sales report. Imported via `React.lazy`
    so it lands in its own chunk (`RevenueChartImpl`, ~103 kB gzip); gated to real
    browsers (`chartsEnabled()` skips jsdom) and wrapped in an error boundary +
    `Suspense` that fall back to the existing CSS `Bars`, so tests/SSR never load it.
  - `screens-ui.test.js`: added saved-views capture/restore test; added a `flush()`
    polling helper (waits out the `"Opening…"` Suspense fallback) used by the
    screen-render loop and the Reports tests to absorb the heavier lazy chunk.

**DoD:** `screens-contract.test.js` headings pass; each module has empty/error.

## Wave 6 — Guest + Telegram mini-app

**Files:** `GuestScreen.jsx`, `MiniAppScreen.jsx`, `index.css`.

- [x] **6.1** Unify palette to tokens.
- [x] **6.2** Safe-area insets for fixed bottom nav/sheets.
- [x] **6.3** Fix mini-app sticky header/table-bar overlap (`z-40` over `z-30`).
- [x] **6.4** Fix image-error CLS (keep fixed-height box); add skeletons.
- [x] **6.5** Explicit order-status + offline states; share `Sheet`; PWA manifest.
- [x] **6.6** Stop whole-screen `useNow(5000)` re-render.

**Done:** Added guest palette tokens; `viewport-fit=cover` + `manifest.webmanifest`; Guest/mini-app use tokens + safe-area padding; header measured (`--miniapp-top-offset`) and table bar offset fixed; `DishImage` keeps fixed height + skeleton + placeholder (eliminates CLS); added `OrderStatusStepper`, `useOnline` banner, and `ServerCallControl` child (isolates time tick to that button); refactored Guest/mini-app modals to shared `Sheet` with safe-area; extracted `useNow` out of whole-screen Guest render.

**DoD:** guest menu LCP budget on throttled phone; no image CLS; bars never overlap.

## Wave 7 — Polish & guardrails

- [ ] **7.1** A11y pass (contrast, focus-visible, aria-live) + optional axe.
- [ ] **7.2** Motion scale for status transitions only.
- [ ] **7.3** i18n translator: fix attribute-write misclassification
  (`i18n.js:1680-1681`); remove `.sr-only` English mirror (`i18n.js:1626-1644`).
- [ ] **7.4** Update `README.md` build tracker + `AGENTS.md`.

---

## Risks

- Theme migration visual churn → incremental adoption + screenshot checks.
- Store split → keep reducer untouched; wrap only.
- Router → test tab scroll/state persistence; don't break kiosk `?role=` URLs.
- New deps → lazy-load heavy ones (recharts); watch bundle budget.

## Sequencing

Waves 1–3 are prerequisites. Waves 4–6 can run in parallel after them. Effort:
W1–2 L, W3 M, W4 L, W5 L, W6 M, W7 M.
