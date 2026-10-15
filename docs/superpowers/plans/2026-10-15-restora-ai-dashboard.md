# Restora AI + Dashboard Modernization — Execution Plan

> Build plan (produces product code). Pairs with the design spec
> `docs/superpowers/specs/2026-10-12-restora-ux-design.md` and the UI
> modernization plan `2026-10-15-restora-ui-ux-modernization.md`. Source of
> truth for state stays `src/lib/reducer.js`.

**Goal:** Add an optional, offline-safe AI layer (provider-agnostic) on top of
the restaurant's shared reducer, and finish modernizing the Dashboard into the
tokenized design system with the spec §9.1 widgets.

**Decisions (locked):**
- **Provider-agnostic** adapter (OpenAI / Anthropic / Gemini / Ollama) over
  global `fetch` — no SDK, no lock-in.
- **Read-only v1**: AI reads a redacted digest and returns suggestions; it never
  dispatches reducer actions. Advisor features produce *suggestions*, not commits.
- **Optional**: no `AI_API_KEY` ⇒ every route is a no-op; the app behaves
  exactly as today. Tests run offline with no key.
- **Surfaces**: staff web app (Copilot screen + dashboard cards), Telegram bot
  (briefing/digest), guest QR + mini app (menu-only concierge).
- **Dashboard**: full migration to semantic tokens + `components/ui` primitives,
  split into `screens/Dashboard/sections/*`, add the missing spec widgets.

**Stack additions:** none (reuses global `fetch`, existing `recharts`, UI kit).

**Verification after every phase:** `npm run lint` → `npm test`. New tests use
`node --test`; UI tests keep the Vite `middlewareMode` + `hmr: false` jsdom
harness.

---

## Global constraints

- Never bypass `src/lib/reducer.js`; it runs on both client and server.
- AI routes are tenant-scoped via `resolveTenant` (`server/index.js:99`). Guests
  (no session) may only use `scope:'menu'`.
- Money via `src/lib/models.js` `money` / `src/lib/currency.js`; unit math only
  in `src/lib/units.js`.
- New UI strings go in `src/lib/i18n-phrases.js`, not inline dicts.
- Keep `ROLE_NAV` / `NAV_SECTIONS` (`src/lib/constants.js`) as the one nav source.
- No state-shape change in this plan ⇒ no `STATE_VERSION` bump.

---

## Phase 0 — AI foundation (no UI)

**Files:** new `server/ai.js`, `src/lib/ai.js`, `src/lib/ai-providers.js`,
`src/lib/ai-client.js`, `server/index.js`, new `tests/ai.test.js`.

- **`src/lib/ai-providers.js`** (pure, isomorphic): provider registry
  (`openai` | `anthropic` | `gemini` | `ollama`) with default base URLs/models,
  `normalizeMessages`, `providerRequest({ provider, model, baseUrl, apiKey, system, messages })`
  → `{ url, headers, body }`, and `providerResult({ provider, json })` → text.
- **`src/lib/ai.js`** (pure, isomorphic): `AI_SCOPES = ['ops','menu']`,
  `AI_INSIGHT_KINDS = ['alert','menu','reorder','forecast','briefing']`,
  `buildAiContext(state, { scope, locId, now, limits })` (PII-redacted,
  token-bounded, `menu` scope strips all operational data), `buildMessages(...)`,
  `SYSTEM_PROMPTS`, and `hashContext(...)` for caching.
- **`server/ai.js`**: `createAiRouter({ getState, resolveTenant, apiKey, provider,
  model, baseUrl, fetchImpl, timeoutMs, rateLimit, cacheTtlMs })`. Copy
  `sendTelegramMessage`'s shape (`server/telegram.js:37-59`): injectable
  `fetchImpl`, `AbortController` timeout, token-gated no-op, never throws.
  Routes: `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/insight`,
  `POST /api/ai/briefing`. In-memory per-tenant sliding-window rate limit + a
  context-hash response cache.
- **`src/lib/ai-client.js`**: client fetch wrapper with a checksum-keyed cache
  (mirrors `src/lib/useMenuCatalog.js`).
- **`server/index.js`**: instantiate after the Telegram router (~line 637),
  `app.use(ai.router)`, `getState: (tenantId) => runtimeFor(tenantId).state`,
  `resolveTenant`.

**Tests (`tests/ai.test.js`):** offline no-op without a key; context
shape/redaction/token cap; `menu` scope strips operational data; provider
request/response mapping per provider; rate limit; cache hit.

**DoD:** `lint` clean · `test` green · server boots with AI disabled.

---

## Phase 1 — Ops Copilot (staff)

**Files:** new `src/screens/Assistant/{index.jsx, sections/*}`,
`src/lib/constants.js`, `src/App.jsx`, `src/lib/i18n-phrases.js`, new UI test.

- Nav entry under **Insight** (`constants.js:203`); role-gate owner/host in
  `ROLE_NAV`; add `SCREEN_ICONS` entry and a lazy `SCREENS` mapping in `App.jsx`.
- Chat UI on `components/ui` primitives: transcript, input, suggested-prompt
  chips, source citations that deep-link to the owning screen. Non-streaming v1
  with a skeleton "thinking" state.
- Answers in the active UI language (km/en/zh) — pass `lang` to the model.

**DoD:** Assistant screen renders under the contract test heading; chat round
trips through `/api/ai/chat`; menu-only guests cannot reach it.

---

## Phase 2 — Dashboard modernization (full migration)

**Files:** new `src/screens/Dashboard/{index.jsx, shared.js, sections/*}`, new
`src/components/ui/{Chart,Sparkline,Progress,StatTile}.jsx`, `src/index.css`,
`DashboardScreen.jsx` → re-export shim.

- Migrate off raw `zinc-*`/`orange-*` and `.restora-theme` to semantic tokens +
  `Card`/`SectionHeader`/`Button`/`Skeleton`/`EmptyState`.
- Split into `KpiRow`, `AlertsRail`, `SalesTrend`, `MenuEngineering`,
  `KitchenSla`, `FloorSnapshot`, `AiInsight`.
- **Add spec §9.1 widgets** currently missing: sales-vs-last-week sparkline;
  top-5 sellers / bottom-5 contribution (already computed by `getDashboard`);
  floor snapshot thumbnail → Floor.
- Token-aware `Chart` wrapper (recharts colors are hardcoded dark today,
  `Reports/sections/RevenueChartImpl.jsx`).
- Loading skeletons + "Shift not started" empty state with last-close summary.
- Move inline `DASH_COPY` (`DashboardScreen.jsx:22-221`) into `i18n-phrases.js`.

**DoD:** `screens-contract.test.js` heading passes; dashboard has loading/empty
states; no raw palette classes remain in the dashboard.

**Done (2026-10-15):** New `src/components/ui/{Progress,Sparkline,Chart,StatTile}.jsx`
(dependency-free, token-driven) exported from the kit. `src/screens/Dashboard/`
ships `index.jsx` + `shared.js` + 12 sections (Hero, KpiRow, SalesTrend,
AlertsRail, MenuEngineering, KitchenSla, FloorSnapshot, QuickOverview,
QuickActions, RecentActivity, ShiftHealth, BranchOverview) with a
`DashboardScreen.jsx` re-export shim. Spec §9.1 widgets added: the KPI row
(sales · covers · avg check · 7-day food cost · occupancy), sales-vs-last-week
sparkline, top-5 sellers / bottom-5 contribution, kitchen SLA vs target, and a
floor snapshot thumbnail. "Shift not started" empty state (with last close)
replaces a blank chart when nothing is sold yet. Copy moved into the existing
`dashboard` dict block for km/en/zh (no inline `DASH_COPY`); the screen reads
`dict.dashboard`. Zero raw palette classes remain in `src/screens/Dashboard/`.

---

## Phase 3 — Alert explainer + shift briefing

**Files:** `src/screens/Dashboard/sections/*`, `src/screens/Assistant/*`,
`server/ai.js`, `server/telegram.js`, `src/lib/notify.js`.

- `kind:'alert'` → one-line "why + what to do" per `getAlerts()` item, inline on
  Dashboard/Costing/Inventory.
- `kind:'briefing'` → morning + end-of-shift summaries; in-app banner, and
  pushed through the existing `POST /api/telegram/digest` (`telegram.js:182`).
- Briefings cached per context hash.

**DoD:** alert cards show an AI explainer when configured and degrade to plain
alerts otherwise; briefing endpoint returns text without a token.

**Done (2026-10-15):** `sections/AiInsight.jsx` (alert explainer) and
`sections/ShiftBriefing.jsx` (open/close briefing, cached, optional Telegram
push) render only when `useAiStatus()` reports a configured key; otherwise they
return `null` and the plain `AlertsRail` is unchanged. The server `onBriefing`
hook (`server/index.js:673`) already pushes through the Telegram notifier, and
`tests/ai.test.js` now proves a briefing is delivered even when cached.
`tests/dashboard-ai.test.js` covers the widget round-trips in jsdom. Copy added
to the `dashboard` dict for km/en/zh.

---

## Phase 4 — Advisor features (read-only suggestions)

**Files:** `src/screens/Dashboard/sections/*`, `src/screens/Costing`, `src/screens/Purchases`.

- **Menu engineering**: pricing/placement/cut suggestions from
  `topSellers`/`bottomContribution`/costing, with rationale.
- **Smart reorder**: suggested quantities from low-stock + par + supplier, shown
  as a draft on Purchases (human commits).
- **Forecast/prep planner**: hourly covers + par suggestions from
  `salesHistory`/`turnHistory`; also feeds the spec's "predicted next free table".

**DoD:** each advisor returns suggestions only; no action is dispatched.

**Scope decision (2026-10-15):** Dashboard advisors only. `sections/AiInsight.jsx`
was generalized into one read-only advisor card (`kind` = alert · menu ·
forecast). The Dashboard now carries three advisors — alert explainer, menu
advisor, prep forecast — plus the shift briefing. The Purchases smart-reorder
draft and the Costing advisor are **deferred**; reorder suggestions remain
reachable from the Ops Copilot screen. `tests/dashboard-ai.test.js` proves each
kind returns its own reply and that nothing renders without a key.

---

## Phase 5 — Guest QR + mini app concierge

**Files:** `src/screens/GuestScreen.jsx`, `src/screens/MiniApp/*`, `server/ai.js`.

- "Ask about the menu" sheet → `/api/ai/chat` with forced `scope:'menu'`
  (dietary tags/allergens/pairings). Public `?owner=slug` tenant, strict rate
  limit, no operational data ever exposed.

**DoD:** guest route cannot read sales/inventory/staff; rate limit enforced.

**Done (2026-10-15):** `src/components/MenuConcierge.jsx` — an "Ask about the
menu" sheet with suggested prompts, `aria-live` transcript, and a friendly
unavailable state. GuestScreen renders a **✨ Menu help** trigger for both QR
guests and the Telegram mini app (which reuses GuestScreen). Every question
posts with `scope:'menu'`; the server pins guests to menu scope regardless
(`tests/ai.test.js`) and enforces the guest rate limit. `tests/guest-concierge.test.js`
proves the round-trip, the menu-scope body, and the offline degradation.

---

## Phase 6 — Polish & guardrails

- i18n phrase registration; a11y (`aria-live` on chat, focus-visible);
  reduced-motion.
- Update `README.md` build tracker + `AGENTS.md` (`AI_*` env, `server/ai.js`,
  Assistant screen).
- Full `lint` → `test` run.

**Done (2026-10-15):** `aria-live` on every AI surface, `Button` has
focus-visible rings, and `prefers-reduced-motion` is already honored in
`src/index.css`. README gained an **AI assistant (optional)** section + env
table and the build-tracker row 12 is ✅; `AGENTS.md` documents the AI stack,
`AI_*` env, and the new test files. Final run: `lint` no errors · `test` 295
pass.

---

## Environment

| Var | Purpose | Default |
|---|---|---|
| `AI_API_KEY` | Provider key; absent ⇒ AI disabled | — |
| `AI_PROVIDER` | `openai` \| `anthropic` \| `gemini` \| `ollama` | `openai` |
| `AI_MODEL` | Model id | provider default |
| `AI_BASE_URL` | Override endpoint (self-host/proxy) | provider default |
| `AI_TIMEOUT_MS` | Outbound timeout | `20000` |
| `AI_RATE_LIMIT` | Requests per window (staff) | `30` |
| `AI_GUEST_RATE_LIMIT` | Requests per window (guest) | `6` |
| `AI_RATE_WINDOW_MS` | Rate window | `60000` |
| `AI_CACHE_TTL_MS` | Response cache TTL | `300000` |

---

## Risks

- **Cost/abuse** → rate limits, context-hash caching, guest menu-only scope.
- **Hallucination** → answers grounded in the digest; "insufficient data"
  fallback; never ask the model to compute money (pass pre-computed values).
- **Latency/offline** → optional adapter, skeleton states, graceful
  "AI unavailable".
- **Security** → `resolveTenant`, PII redaction, no guest access to ops data.
- **Dashboard churn** → visual-only migration; no `STATE_VERSION` change.

## Sequencing

Phase 0 → 6 as written. Phase 0 is a prerequisite for all AI work; Phase 2 is
independent of AI and can ship on its own.
