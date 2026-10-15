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
npm run server   # API on :3001 (SQLite, SSE, Telegram webhook) — optional
npm run seed:demo # load a full two-store demo + one sign-in per staff role
npm test         # reducer, SQLite catalog, settings/currency/documents, screens contracts, tabs
npm run check:ui # static audit of fonts, CSS, type scale, and responsive risk
npm run fonts:sync # re-vendor the self-hosted webfonts from node_modules
```

No backend needed for the demo: state persists to `localStorage`; **Reset demo data** in the sidebar restores the Friday-night seed.

With the API running, extra environment (all optional — nothing breaks without it):

| Variable | What it is |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token. Without it the bot answers in the screen and every push is a logged no-op. |
| `TELEGRAM_CHAT_ROLES` | `12345:manager,67890:staff` — chat ids and the access they get (`*` is the default, `staff`). |
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret Telegram must echo back on every update. |
| `RESTORA_PUBLIC_URL` | Public origin used for guest / mini-app links in replies. |
| `RESTORA_DATA` | Where `restora.sqlite` lives (default `server/data/`). |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` / `SUPERADMIN_NAME` | Seed (or promote) the platform super admin on boot. |
| `RESTORA_TENANT` | Slug (or id) of the owner the Telegram bot serves; defaults to the first owner, else the legacy `default` tenant. |
| `RESTORA_SECURE_COOKIES` | Set to `1` behind HTTPS so session cookies are marked `Secure`. |
| `AI_API_KEY` | Provider key (OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Groq, OpenRouter, Mistral, Cerebras, GLM, Kimi, Grok, Together, Perplexity, Ollama, LM Studio). **Absent ⇒ AI is off everywhere** and the app behaves exactly as before. |
| `AI_PROVIDER` / `AI_MODEL` / `AI_BASE_URL` | Which provider, model, and endpoint to call (each has a default; see **AI assistant**). |
| `AI_KEYS` | Extra keys for the failover chain: `sk-a,sk-b` (same vendor) or a JSON array `[{"provider":"qwen","apiKey":"…"}]`. |
| `AI_TIMEOUT_MS` / `AI_RATE_LIMIT` / `AI_GUEST_RATE_LIMIT` / `AI_RATE_WINDOW_MS` / `AI_CACHE_TTL_MS` | Outbound timeout, per-window rate limits (staff / guest), and the insight-cache TTL. |
| `AI_FAILOVER_COOLDOWN_MS` | How long a key that just failed stays parked so the next key answers (default `60000`). |

## Accounts & tenants

One server hosts many restaurants. Signing in is required for the terminal
workspace; the guest QR app and the Telegram mini app stay open.

- **Register** creates a host owner (its own restaurant) plus the first owner
  user; **sign in** sets an httpOnly `restora_session` cookie (7 days).
- Users and Roles are scoped to their owner. A manager sees only their own
  team, and nobody below a super admin can grant a role broader than their own.
- A **super admin** (`SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`) gets a Host
  owners console to add, suspend, or delete restaurants.
- Every state table, read model, action log, and SSE stream is partitioned by
  `owner_id`, so two restaurants never see each other's floor, stock, or menu.

The API picks a tenant per request: a signed-in user is pinned to their own
owner; a super admin names one with `?ownerId=`; guests and the mini app pick
one with `?owner=<slug>` (a named tenant that does not exist is a `404`). The
Telegram bot is bound to `RESTORA_TENANT` (first owner, else legacy `default`).

## Workspace tabs

A Chrome-style tab strip sits above the active screen. Each tab keeps its own
screen, store location, open drawer (table / check / dish), and scroll
position — restaurant data stays shared. The last remaining tab closes back to
the current role's default screen (Floor when available). Up to 20 tabs; the
10 most recently closed can be brought back.

- **+** or **Ctrl/⌘+T** — new tab, opened next to the active one
- click to switch · **×** or middle-click or **Ctrl/⌘+W** — close
- drag a tab to reorder · double-click — rename · right-click — tab menu
  (duplicate, rename, pin, close, close others, close tabs to the right)
- **Pin** keeps a screen icon-only at the left, always open
- **Ctrl/⌘+Tab** / **Ctrl/⌘+Shift+Tab** cycle · **Ctrl/⌘+1…9** jump (9 = last)
- **Ctrl/⌘+Shift+T** reopens the last closed tab
- Live alert badges: a tab whose screen needs attention carries a count —
  red and pulsing for act-now alerts (late tickets, bill/call-server),
  amber otherwise
- A colored dot on each tab marks its store (Downtown / Riverside)

Tabs survive a reload on the same terminal (session storage); kiosk URLs
(`?role=…`) always boot a fresh single tab so shared devices never inherit
the last operator's workspace.

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

### Demo data & accounts

`npm run seed:demo` writes one complete, believable restaurant into the
database the server boots from — both stores (Downtown + Riverside) with
floor, tickets, kitchen, menu, catalog, inventory, stock movements,
purchases, suppliers, reports, costing, settings, and a filled document
registry (receipts, an invoice, a ticket, a purchase order, a shift report).
It also creates a sign-in per staff role (all `demo1234` by default), so a
whole team can walk through the app:

```
owner@restora-demo.demo     owner
manager@restora-demo.demo   manager
server@restora-demo.demo    server
kitchen@restora-demo.demo   kitchen
host@restora-demo.demo      host
```

It is idempotent — re-running refreshes the same owner, accounts, and
snapshot. Override with `DEMO_OWNER_NAME`, `DEMO_SLUG`, `DEMO_PASSWORD`, and
`RESTORA_DATA` (to target a specific database). The guest menu for the demo
is `/login` and `/?owner=restora-demo`.

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

### Configuration, documents, catalog & suppliers

**Control → Settings & Documents** is the configuration surface. Sections save
together as one `UPDATE_SETTINGS` — or, with *Apply to all stores*, one action
per location:

- **Business profile** — company/legal name, tagline, description, address,
  phone/email/website, tax ID, logo upload (data URL, warned above 400KB) or an
  initials monogram, brand color, timezone
- **Money & tax** — tax %, service charge %, custom labels, prices-include-tax,
  bill rounding (`none` / `nearest 0.05` / `nearest whole`), tip presets,
  auto-gratuity party size
- **Documents & templates** — a designer for **invoice · receipt · ticket ·
  report**: paper (A4 / A5 / Letter / 80mm / 58mm), title, accent, logo · QR ·
  signature toggles, tax breakdown, notes, terms/bank details, footer, copies.
  The preview is the exact HTML the printer receives; **File** registers the
  document so it can be reprinted or voided from the registry
- **Stock policy** — valuation (`last cost` / `weighted average`), reorder policy
  (`par`, or `reorder point + safety days`), auto-86 on zero stock, negative
  stock, receive rounding, cycle-count cadence, storage zones, shelf life
- **POS & service** — ticket copies, printer routing names, guest QR ordering,
  split/discount permissions, manager-void requirement
- **Alerts** — low stock, late tickets, guest requests, negative margin,
  throttle, digest time, channel
- **Data** — JSON export, validated import (`HYDRATE`), per-section reset,
  document registry (reprint · download · void)

Documents print from where the work happens: **Tickets → Documents** bar
(receipt — filed automatically once the check is paid — invoice, kitchen ticket,
download), **Reports → Print report** for the shift P&L.

### Multi-currency

Money is stored as plain base-currency numbers and formatted through
`src/lib/currency.js`; the store re-points the active currency whenever a
location's settings change, so floor, tickets, reports, and CSV exports all
follow the configured symbol, position, and decimals with no per-screen code.
Rates are base-relative rows (`rate` = units per 1 base unit); a document can
print in a foreign currency — the builder converts at build time and prints an
`1 USD = …` FX note. `SET_BASE_CURRENCY` re-bases every rate and keeps the old
base as a row. 20 currencies are pre-registered (USD, EUR, GBP, JPY, CNY, KHR,
THB, VND, IDR, MYR, SGD, AUD, CAD, INR, KRW, AED, CHF, MXN, BRL, PHP).

### Catalog & suppliers

**Control → Catalog** owns the naming tree — categories *and* sub-categories for
menus and inventory. Renaming re-labels the items; deleting a category requires
choosing where its items go first. Products get inline price/station edits, bulk
move, bulk 86/restore, and a full editor. Ingredients get supplier assignment,
storage zone, par / reorder point, and a status that follows the stock policy.

**Control → Suppliers** is vendor management: terms, delivery days, lead time,
minimum order, rating, and notes; a per-supplier reorder list with copy/mailto,
spend history from received invoices, and **Receive delivery** — which updates
on-hand, last cost, and the weighted average used by recipe costing.

### Buying stock, the movement ledger & reports

**Operations → Purchases** is the buy side of the book. A purchase order is a
real document with lines, a supplier, expected date, tax and shipping; it moves
`draft → ordered → received` (or `cancelled`) and prints on the configured PO
template. **Receive** converts each line from the unit it was ordered in (cases,
kegs, bottles) into the unit the item is counted in, writes a signed `buy`
movement per line, updates on-hand, last cost, and the weighted average used by
recipe costing, and keeps partial deliveries open with the balance outstanding.
Receive it in one click from the delivery, or with `/receive PO-2026-0100` from
Telegram. Quick one-off deliveries skip the document: **Suppliers → Receive
delivery** posts `RECEIVE_INVOICE`.

**Operations → Stock movements** is the ledger behind all of it — every buy,
sale, opening balance, return, waste, count, and adjustment as a signed row
with value, unit cost, reference, and who did it. Filter by kind, item, or day,
see the balance a row left behind, and export the window to CSV. On-hand is the
sum of the ledger, so the numbers a screen shows and the rows an accountant
reads are never two different stories.

**Control → Reports** turns that into the four questions an owner actually
asks, over *Tonight / 7 days / 30 days*:

- **Sales, buys & stock** — takings, net sales, tax, tips, covers, by method,
  by hour, by category, plus what was bought and what moved in and out
- **Profit & loss** — revenue less cost of goods (from recipe snapshots), waste,
  shrinkage, comps, and discounts, with the food-cost % against its target
- **Top & bottom** — best and worst sellers by revenue, units, and contribution,
  with unsold dishes called out; the same on the buy side by spend and units,
  and who the money went to
- **Service / Voids & comps / Variance** — the operational reads (turn times,
  leakage, theoretical usage vs counted stock)

Every report ends in an action: print it on the report template, or jump to the
screen that fixes the problem.

### Units of measure & packaging

An item is *counted* in one unit and *bought* in another. The model is the same
everywhere: `item.unit` is the stock unit the book is kept in, `item.packs`
says what one purchase unit holds (`1 Case = 12 ea`, and packs can nest —
`1 Keg = 6 Case`), and `item.purchaseUnit` is what a new order line starts on.
`src/lib/units.js` owns the arithmetic (`packFactor`, `packPrice`, `basePrice`,
`describeQty`) so the order line, the receiving screen, the stock list, and the
bot all convert identically.

- **Settings → Units** (in the Telegram/stock card set) defines the units
  (`each`, `kg`, `ml`, `bottle`, `case`, …) and the pack vocabulary, plus the
  defaults new items start from
- Ordering by the case: `2 Case × $39.00` receives **18,000 ml** of stock at
  `$0.0022/ml` (pack cost ÷ pack size, not the pack price), and the movement
  line says which pack it came from
- Stock lists print the pack breakdown (`1 Case + 1 Bottle + 70 ml`) instead of
  a raw count when *Show pack breakdown* is on
- Once an item has movements its stock unit is **frozen** — the reducer refuses
  the change and the editor disables the field, because every historical row is
  counted in it. Add a new item instead

### Item images & food settings

Menu items and stock items carry a photo (`imageUrl` — an upload kept as a small
data URL, or a path/URL), a description, dietary tags (Vegetarian, Vegan,
Gluten-free, Contains nuts…), spice level, allergens, station, prep time,
availability windows (breakfast / lunch / dinner / late), courses, and
modifier groups. The vocabulary is configurable under **Settings → Food**, the
photo is capped by `food.imageMaxKb`, and images appear on the guest menu, the
tickets, the KDS, and the printed documents.

### Telegram bot & mini app

The bot reads and writes the **same book** the terminals do: the engine
(`src/lib/telegram.js`) is pure and returns the actions it wants, the webhook
(`server/telegram.js`) applies them through the shared reducer, commits them
like any terminal action, and broadcasts over SSE. Nothing is a shadow copy.

1. Talk to **@BotFather**, create a bot, put its token in `TELEGRAM_BOT_TOKEN`.
2. Point Telegram at this server:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$RESTORA_PUBLIC_URL/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
3. Map chats to roles with `TELEGRAM_CHAT_ROLES=12345:manager,67890:staff`.
   Anything unmapped gets staff access: look-ups only.

**Commands** — staff: `/start /help /today /week /low /stock <item> /menu [term] /orders /qr <table> /table <n>`;
managers add `/pnl /report [range] /86 <item> /un86 <item> /po /receive <PO#> /buy [range] /digest`.
A staff chat asked for a manager command is told so politely, and the reply
keyboard only ever shows that chat's commands.

**The bot talks first.** Notices are derived by diffing the shop before and
after every committed action, so no screen has to remember to notify: a check
is fired, a table pays up, a dish is 86'd or comes back, stock crosses under
par, a purchase order is placed or received. Targets are
`settings.telegram.chatId`, the mapped chats, and **any chat that has messaged
the bot** — wiring a new phone is *say `/start` once*, not editing env files.
A close-of-day digest (sales, food cost, buying, what needs ordering) goes out
once a day after its configured hour, and can be previewed or forced from the
screen.

**Control → Telegram & Mini App** is the operating surface: the wiring steps, a
console that runs the exact command engine (preview, or apply through the
reducer), the notification switches and digest button, and the mini app.

**Mini app.** `/?tg=1&guest=<tableId>` is the guest menu packaged for Telegram:
the same QR ordering surface with the platform chrome — header colour from
`themeParams`, expand, closing confirmation, haptics and a toast when an order
lands. Open it from a bot reply (`/qr 12`), a menu button, or the link/QR on the
screen; outside Telegram it degrades to the plain web menu.

Three things keep the mini app fast on a phone, because a guest menu that takes
seconds to appear is a lost table:

- **The page never waits on the network to paint.** Guests and the mini app
  mount the cached/demo snapshot immediately (`RestoraProvider waitForServer={false}`)
  and hydrate when the API answers; only terminals hold a boot screen, and only
  so a shared tablet never shows the last shift's numbers.
- **The Telegram SDK is fetched in the background** (`src/lib/telegram-webapp.js`),
  so a slow `telegram.org` response cannot delay the menu. Chrome (expand,
  theme, haptics, `initData` name) is applied the moment it lands, with a 4s
  guard so a captive portal can't hang it.
- **One read per catalog, one action per tap.** `/api/menu` answers are cached
  and de-duplicated per tenant + location (`src/lib/useMenuCatalog.js`), live
  SSE actions are coalesced into one render per frame, and self-seating is a
  single `MINIAPP_CLAIM_TABLE` action (it sets `seatedBy: 'guest'`, so the
  stale-table sweep still frees an abandoned table).

The mini app renders the same `GuestScreen` the table QR page does and shares
the device's guest session token with the table picker, so a guest who sits
themselves down in Telegram orders onto the same ticket a server would print.

Bot API surface: `POST /api/telegram/webhook` (always answers 200 so Telegram
does not retry a command that already ran), `POST /api/telegram/simulate`
(`dryRun` by default), `POST /api/telegram/digest` (`dryRun` previews),
`GET /api/telegram/{status,commands,stats}`.

### Configuration API

- `GET /api/suppliers?loc=` · `GET /api/inventory?loc=&q=&supplierId=&exceptionsOnly=true`
- `GET /api/categories?loc=` (`flat=true` for one level) · `GET /api/settings?loc=`
- `GET /api/documents?loc=&kind=invoice|receipt|ticket|report&limit=` → summary + registry
- `POST /api/actions` accepts the new actions — `UPDATE_SETTINGS`,
  `RESET_SETTINGS`, `UPDATE_TEMPLATE`, `UPSERT_CATEGORY` / `DELETE_CATEGORY`,
  `UPSERT_SUPPLIER` / `DELETE_SUPPLIER`, `ADD`/`UPDATE`/`DELETE_INVENTORY_ITEM`,
  `SET_BASE_CURRENCY`, `RESCALE_CATALOG`, `ISSUE_DOCUMENT`, `VOID_DOCUMENT`,
  and `RECEIVE_INVOICE` with a `supplierId`
- Buy side: `UPSERT_PURCHASE`, `SET_PURCHASE_STATUS`, `RECEIVE_PURCHASE`,
  `DELETE_PURCHASE`, and the stock movements they write
  (`GET /api/state` carries `shop.purchases` and `shop.movements`)

## Guest QR ordering

Each table has a QR tent card (Floor → table → 📱 Table QR code). Guests scan
and get a light consumer app at `/?guest=<tableId>&owner=<slug>` — no login, no
sidebar:

- Menu (86'd dishes vanish instantly) with required modifiers enforced
- Cart → **Send to kitchen**: one atomic `GUEST_SEND` lands on the table's
  shared ticket, tagged QR, and fires the KDS + decrements stock
- Live status per line (🔥 In kitchen → ✓ Ready) over the same SSE sync
- 🙋 Call server + bill request raise alerts on staff screens (Dashboard rail,
  Tickets banner with "On my way" ack)
- Pay the whole check with tip, or ask the server to take payment

Demo routing is by table id; production tents would carry unguessable tokens.
For the same reason, the guest app reads its restaurant by a public slug and
loads the full tenant snapshot, then renders only the scanned table — a demo
convenience. A production deployment should serve guests a scoped projection
(menu + that table's ticket) instead of the whole snapshot.

The guest page (and the Telegram mini app, which reuses it) can also offer an
**✨ Menu help** sheet — a menu-only concierge that recommends dishes and answers
questions about ingredients, allergens, spice, dietary tags, and price, built on
the same AI layer described below. It shows a short *Ask about the menu* intro,
one-tap suggestion chips, and a friendly note when AI is off or busy, and it
degrades to the plain menu whenever the server has no AI key.

## AI assistant (optional)

An optional, provider-agnostic layer (`server/ai.js` + the pure modules
`src/lib/ai.js` and `src/lib/ai-providers.js`, called from the browser through
`src/lib/ai-client.js`). It reads a **redacted, pre-computed digest** of the
live shift and returns text — it is **read-only and never dispatches a reducer
action**, and it is **off by default**: with no `AI_API_KEY` every `/api/ai/*`
route is a clean 503 no-op and the app is byte-for-byte the same.

- **Providers:** sixteen vendors, all on the same `fetch`-only adapter
  (`src/lib/ai-providers.js`), chosen with `AI_PROVIDER`:

  | Provider id | Wire | Default model | Tier |
  |---|---|---|---|
  | `openai` (default) | OpenAI | `gpt-4o-mini` | paid |
  | `anthropic` | Anthropic | `claude-3-5-haiku-latest` | paid |
  | `gemini` | Gemini | `gemini-2.0-flash` | free quota |
  | `deepseek` | OpenAI-compatible | `deepseek-chat` | cheap |
  | `qwen` (DashScope international; mainland endpoint offered in the UI) | OpenAI-compatible | `qwen-plus` | free quota |
  | `groq` | OpenAI-compatible | `llama-3.3-70b-versatile` | free |
  | `openrouter` | OpenAI-compatible | `deepseek/deepseek-chat-v3-0324:free` | free `:free` models |
  | `mistral` | OpenAI-compatible | `mistral-small-latest` | free "Experiment" plan |
  | `cerebras` | OpenAI-compatible | `llama3.1-8b` | free |
  | `zhipu` (GLM) | OpenAI-compatible | `glm-4-flash` | free |
  | `moonshot` (Kimi) | OpenAI-compatible | `moonshot-v1-8k` | cheap |
  | `xai` (Grok) | OpenAI-compatible | `grok-3-mini` | paid |
  | `together` / `perplexity` | OpenAI-compatible | Llama 3.3 / `sonar` | paid |
  | `ollama` / `lmstudio` | native / OpenAI-compatible | local | **no key needed** |

  Aliases (`dashscope`, `kimi`, `glm`, `claude`, `grok`, `lm-studio`, …) resolve
  to the right entry, and every field is overridable with `AI_MODEL` /
  `AI_BASE_URL`. No SDKs — just `fetch`.
- **Several keys, with failover.** Beyond the primary key, a tenant can hold a
  **key pool** (Settings → AI assistant → *Failover keys*): more DeepSeek keys,
  a Qwen key, a free vendor, a local box. The router tries them in order
  (primary → backups → `AI_KEYS` from the environment) and a key that just
  failed is parked for `AI_FAILOVER_COOLDOWN_MS` so the next request goes
  straight to a working key. With *Spread requests across all keys* on, the
  chain is round-robined instead. Responses report which key answered
  (`via`, `failover`); keys themselves are never returned (`hasKey`,
  `poolCount` only), and pool health in `/api/ai/status` is staff-only.
  Local providers (`ollama`, `lmstudio`) need no key at all — just a base URL.
- **Surfaces:** the **Ops Copilot** screen (`Insight → Ops Copilot`) for chat +
  advisors + a shift briefing; the **Dashboard** AI cards (alert explainer,
  menu advisor, prep forecast, shift briefing); and the guest/mini-app **Menu
  help** concierge.
- **Guest recommendations:** the `scope:'menu'` digest is a rich row — localized
  dish names, category/sub-category, description, `dietaryTags`, `allergens`,
  `spiceLevel`, the ingredient **names** only (never quantities or costs), and a
  `popular` flag derived from real sales — so a guest question like "what's good
  and gluten-free?" gets a grounded, named recommendation. Guests see no
  operational data and `/api/ai/status` returns no server stats to them.
- **Ops help:** the Ops Copilot also answers "how do I …" questions about the app
  itself (it carries a static `appGuide` prompt that points to the right screen),
  alongside the live-shift digest.
- **Guardrails:** answers are grounded in the digest (the model never computes
  money); guests are pinned to `scope:'menu'` so a public caller can never read
  sales, stock, or staff; responses are cached per context hash; separate staff
  and guest rate limits apply (guest buckets are per client IP).
- **Telegram:** the shift briefing can be pushed to the bot (`POST
  /api/ai/briefing` with `deliver:true`, using the same notifier/chats as the
  rest of the pushes).
- **Configure in-app:** an owner or super admin can set the provider, model,
  base URL, API key, the failover pool, and rotation from **Settings → AI
  assistant**. It is stored per restaurant in SQLite (every key is write-only
  and never sent back to the browser) and overrides the env vars below; any
  field left blank falls back to them. The screen also lists the free and local
  options with a one-click *Use this* and a link to each vendor's key page, and
  can **Test** the primary or any single backup key. **Load from provider**
  asks the vendor for its live model list through `POST /api/ai/config/models`
  (`keyId` optional), so a renamed model id never has to be guessed — model
  names churn faster than this README can. The routes (`GET`/`PUT
  /api/ai/config`, `POST /api/ai/config/test` and `/models`) are owner-only,
  return no key material, and take effect without a restart.

| Variable | Purpose | Default |
|---|---|---|
| `AI_API_KEY` | Provider key; absent ⇒ AI disabled | — |
| `AI_KEYS` | Extra keys for the failover chain (comma list or JSON array) | — |
| `AI_PROVIDER` | any catalogue id — `openai`, `anthropic`, `gemini`, `deepseek`, `qwen`, `groq`, `openrouter`, `mistral`, `cerebras`, `zhipu`, `moonshot`, `xai`, `together`, `perplexity`, `ollama`, `lmstudio` | `openai` |
| `AI_MODEL` | Model id | provider default |
| `AI_BASE_URL` | Override endpoint (self-host / proxy) | provider default |
| `AI_TIMEOUT_MS` | Outbound timeout | `20000` |
| `AI_RATE_LIMIT` | Requests per window (staff) | `30` |
| `AI_GUEST_RATE_LIMIT` | Requests per window (guest) | `6` |
| `AI_RATE_WINDOW_MS` | Rate-limit window | `60000` |
| `AI_CACHE_TTL_MS` | Response cache TTL | `300000` |
| `AI_FAILOVER_COOLDOWN_MS` | How long a failed key stays parked | `60000` |

## Typography, responsiveness & the UI audit

The interface is dense (10–11px labels on purpose) and runs in Khmer,
English, and Chinese on tablets, phones, and the Kitchen display — so the type
and the layout are pinned down mechanically rather than by eye.

**Type**

- **Self-hosted webfonts**, vendored into `public/fonts` by `npm run fonts:sync`
  and declared in `src/styles/fonts.css`: **Inter Variable** (Latin +
  Latin-extended) and **Noto Sans Khmer Variable** (Khmer script). No CDN
  request at runtime, `font-display: swap`, `woff2` only (~190 KB for all three
  subsets; browsers fetch only the subsets a screen uses).
- **Micro type is tokenised**: `text-2xs` (11px), `text-3xs` (10px),
  `text-4xs` (8px, chip counters), `text-kpi` (27px numerals). Arbitrary
  `text-[11px]` classes are gone, so sizes stay consistent and can be rescaled
  in one place.
- **Script-aware scale** (`src/styles/typography.css`): `src/lib/i18n.js` writes
  `<html lang>` on every language change (and `index.html` sets it before first
  paint, from the saved language), and `html[lang='km']` / `html[lang='zh']`
  raise the micro sizes, open up leading, and relax Latin tracking — Khmer
  subscript clusters otherwise collide at 10px in tight leading.
- Numerals use tabular figures (`.tnum`) and headings get `text-wrap: balance`.

**Responsiveness**

- The shell is sized in `dvh` (`.app-shell`, `.guest-shell`) with a `vh`
  fallback, honours `env(safe-area-inset-*)`, disables tap highlight, and sets
  `-webkit-text-size-adjust: 100%` so iOS does not inflate text in landscape.
- The topbar wraps its search onto its own row ≤900px, the sidebar collapses to
  a 68px rail ≤760px and 58px ≤560px, and short viewports (landscape phones)
  give the row height back to the workspace.
- Wide financial tables (movements, purchases, currency, units) use the shared
  `.table-scroll` container: horizontal scroll with an edge fade and momentum
  scrolling instead of stretching the page.
- Chart colours (grid, axes, ticks, tooltip) come from `.recharts-*` rules in
  `src/styles/responsive.css`, so they follow the surface scope instead of a
  hard-coded dark palette.
- **Print** strips the rail, topbar, and tab strip, forces a white page, keeps
  colour (`print-color-adjust: exact`), and avoids breaking cards or table rows
  across pages — for the owner printing a P&L or the audit trail.
- `prefers-reduced-motion`, `prefers-contrast: more`, and focus rings are all
  handled; the focus ring clears 3:1 against its own surface in both the light
  workspace and the dark rail.

**Verify it**: `npm run check:ui` prints a report (fonts declared ⇄ files on
disk, balanced CSS, font stacks with a generic family, type below the 10px
floor, 5+ column grids without a breakpoint, wide tables with no scroll
container) and `tests/typography-css.test.js` asserts it stays clean **and**
computes the WCAG contrast of every text token.

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

## Deploy (Docker)

`npm run build && npm run server` serves the built frontend and the API on one
port. The bundled image does the same:

```bash
docker compose up --build            # → http://localhost:3001
```

SQLite lives on the `restora-data` volume. Provide `SUPERADMIN_EMAIL`,
`SUPERADMIN_PASSWORD`, `RESTORA_TENANT`, and the `TELEGRAM_*` values through
your environment (or a `.env` file beside `docker-compose.yml`) to configure
the super admin and the hosted bot.

The container has its own database on that volume, so seed the demo **inside
the container** — running `npm run seed:demo` on the host writes to
`server/data/`, which the container never reads:

```bash
docker compose exec restora npm run seed:demo
```

## Stack

React 19 + Vite + Tailwind CSS v4. `useReducer` + context, synced to
Express + SQLite (`better-sqlite3`) via action log + SSE when a server is present.

## Build tracker (spine-first)

| Step | Module | Status | What it proves |
|------|--------|--------|----------------|
| 1 | Object model + status machines | ✅ Done | Tables, tickets, items, recipes, inventory, alerts; strict machines; seed data; role-aware shell |
| 2 | Floor seat/dirty | ✅ Done | Live map by zone, tap-to-seat, over-cap confirm, reservations, waitlist + honest wait quotes |
| 3 | Tickets + delivery fulfillment | ✅ Done | Composer + required mods, 86 w/ substitute, 15s undo, split/pay/void; delivery queue, kitchen-ready handoff, delivered timestamps, type filter, v5 → v6 migration |
| 4 | KDS fire/bump/86 | ✅ Done | Station columns + expo, live SLA timers, bump-all, 60s recall, shared 86 board |
| 5 | Theoretical inventory on fire | ✅ Done | Stock exceptions, receive w/ plate-cost impact, count sheet w/ variance reasons, waste log |
| 6 | Dashboard alerts | ✅ Done | KPIs, tappable alert rail, rush watch, sparkline, sellers/losers, SLA, floor snapshot — now fully on semantic tokens (`components/ui` primitives, sections under `src/screens/Dashboard/`), with spec §9.1 widgets and an empty "shift not started" state |
| 7 | Recipe cost + matrix | ✅ Done | Recipe coster w/ snapshots, 86 write-through, menu matrix, ingredient shocks, in-place reprice |
| 8 | Reports | ✅ Done | Sales/hour/category/day, service, voids audit, variance, P&L-lite — every report ends in an action |
| 9 | Configuration, documents & catalog | ✅ Done | Settings sections (identity · money · templates · stock · POS · alerts · data), invoice/receipt/ticket/report designer + print, multi-currency, document registry, category tree, suppliers, live preview/print from Tickets & Reports |
| 10 | Buy side, units & Telegram | ✅ Done | Purchase CRUD → stock with pack conversion, the signed movement ledger, sell/buy + P&L + top/bottom reports, units of measure, item photos, bot console + push notices + digest, and the Telegram mini app |
| 11 | Accounts, roles & multi-tenant | ✅ Done | Owner accounts + owner-scoped users/roles, a super-admin host-owner console, per-owner isolation of every state table, read model, action log, and SSE stream (schema v3 migrates a legacy single-tenant file) |
| 12 | AI ops copilot | ✅ Done | Provider-agnostic, read-only assistant (`/api/ai/*`) with the Ops Copilot screen; Dashboard advisors (alert explainer, menu advisor, prep forecast) + shift briefing cards; guest/mini-app menu concierge; Telegram briefing push. Off by default — no `AI_API_KEY`, no AI. (Smart-reorder draft on Purchases deferred.) |

## Key rules (from spec — enforced in code)

- Table machine is strict: `free → seated → ordered → billed → dirty → free` (`reserved` overlays `free`)
- Theoretical inventory drops on **fire**, not on draft, not on pay
- Send = commit: 15s undo, then kitchen owns the item; bump recall 60s
- Status is color + word, never color alone; 44px targets on Floor/Kitchen
- Plate cost uses last invoice cost; contribution bands high ≥70 / ok 55–70 / low 10–55 / loss <10
