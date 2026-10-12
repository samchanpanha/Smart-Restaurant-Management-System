# Restora – Smart Restaurant Management System

## UI/UX Case Study Design Spec

Date: 2026-10-12
Status: Approved for written plan
Deliverable: Written UX plan only (no product code in this cycle)
Restaurant context: Single-location casual dining, table service, 12–24 tables
Approach: Hybrid — business problem per module, then users, flows, screens, and success metrics

---

## 1. Problem

Independent casual restaurants run daily operations across disconnected tools: POS tickets, paper reservations, kitchen shout-outs, spreadsheet inventory, and end-of-month accounting. That split creates four business losses:

- Time loss: staff re-enter the same order in two or three places.
- Food waste: kitchen over-preps because stock and ticket volume are not linked.
- Revenue loss: tables sit dirty or unseated because floor status is not live.
- Blind decisions: owners see sales after the week closes, not while the shift is still fixable.

Restora exists to close those gaps in one operational system, not to look like a dashboard for its own sake.

## 2. Solution

Restora is an all-in-one restaurant operations product with a single source of truth for covers, tickets, stock, and cost.

Core modules:

- Dashboard — shift health at a glance
- Order Management — live tickets from floor to payment
- Table Management — floor map, reservations, turn times
- Kitchen Management — station queues and ticket timing
- Inventory Management — stock, par levels, receiving
- Reports and Analytics — sales, labor-adjacent spend, and profit
- Food Cost and Profit — recipe costing and menu contribution

Primary outcome: fewer wasted minutes per ticket, fewer 86'd items mid-service, faster table turns, and a weekly food-cost number the owner trusts.

## 3. Goals and Non-Goals

### Goals

- Cut order-to-kitchen latency to under 10 seconds after send.
- Make table status (free, seated, ordered, billed, dirty) visible without walking the floor.
- Surface low-stock items before the dinner rush, not after 86.
- Show food cost % and contribution margin per menu item from actual recipes.
- Let an owner run a shift from one screen, and a cook run tickets from another.

### Non-Goals (this case study)

- Multi-location chain controls
- Guest-facing ordering app / QR menu
- Full accounting / payroll / HR
- Hardware POS certification
- Delivery aggregator integrations
- Fine-dining course orchestration beyond casual courses (appetizer / main / dessert)

## 4. Users

### Maya — Owner / GM

Runs one casual dining room. Needs today's sales vs last week, food cost drift, and which dishes lose money. Uses Restora on a laptop in the office and a tablet near the host stand. Success: she can answer "are we making money on this menu?" in under two minutes.

### Jordan — Floor / Server

Takes orders, needs table context, modifiers, send/hold, and check split. Uses a handheld or POS terminal. Success: send a modified ticket without asking the kitchen twice.

### Kim — Kitchen Lead

Needs incoming tickets by station, fire times, 86 board, and bump. Uses a kitchen display. Success: no ticket older than the target ticket time without a visual alert.

### Alex — Host

Needs reservations, walk-ins, waitlist, and which tables will free next. Uses a tablet at the door. Success: quote an honest wait time from live turn data.

Secondary: inventory clerk (often Maya or a closer) receiving invoices and counting stock after close.

## 5. Design Principles

1. Shift-first, not report-first. Live service screens stay uncluttered; analysis lives one click away.
2. Status is color + word, never color alone. Accessible in a dark dining room and a bright kitchen.
3. One ticket, one truth. Floor, kitchen, and inventory all read the same order object.
4. Exceptions over averages. Highlight late tickets, 86 risk, and negative-margin items.
5. Hands-busy UI. Large tap targets, few typed fields during service, undo on send for 15 seconds.
6. Cost is a first-class object. Recipes, yields, and invoice prices feed every profit view.

## 6. Information Architecture

```
Restora
|-- Live
|   |-- Dashboard
|   |-- Floor (tables + reservations)
|   |-- Tickets (orders)
|   `-- Kitchen
|-- Control
|   |-- Menu & Recipes
|   |-- Inventory
|   `-- Staff (roles only, light)
|-- Insight
|   |-- Reports
|   `-- Food Cost & Profit
`-- Settings
    |-- Restaurant profile
    |-- Tax / service charge
    `-- Stations & printers (logical, not hardware)
```

Primary nav is role-aware:

- Owner: all
- Server: Floor, Tickets
- Kitchen: Kitchen, 86 board
- Host: Floor, Reservations / waitlist

## 7. Key Objects

### Table

id, name, seats, zone, status (`free` | `reserved` | `seated` | `ordered` | `billed` | `dirty`), currentCheckId, seatedAt, targetTurnMinutes

### Reservation

id, name, partySize, time, tableId (optional), status (`booked` | `seated` | `no_show` | `cancelled`), notes, source (`phone` | `walk_in` | `online`)

### Order / Ticket

id, tableId or type (`dine_in` | `takeout`), serverId, status (`open` | `sent` | `in_prep` | `ready` | `served` | `paid` | `void`), courses[], items[], sentAt, paidAt

### TicketItem

id, menuItemId, qty, modifiers[], station, status (`held` | `fired` | `bump`), notes, recipeSnapshot

### MenuItem

id, name, category, price, recipeId, available (86 flag), marginBand (`high` | `ok` | `low` | `loss`)

### Recipe

id, yieldPortions, ingredients[{inventoryItemId, qty, unit, wastePct}], prepNotes

### InventoryItem

id, name, unit, onHand, par, lastCost, vendor, location (`walk_in` | `dry` | `bar`)

### Alert

type (`late_ticket` | `low_stock` | `86` | `negative_margin` | `long_turn`), severity, entityId, createdAt, dismissedBy

## 8. Service Flow (happy path)

1. Host seats party on Floor. Table goes `seated`. Reservation (if any) marked `seated`.
2. Server opens check from the table, builds items, holds desserts, sends starters/mains.
3. Kitchen display receives fired items by station. Prep clock starts.
4. Inventory decrements theoretically from recipe on fire (not on pay), so 86 risk is live.
5. Kitchen bumps items. Server sees `ready`. Table status `ordered` until billed.
6. Server prints/pays. Table `billed` then `dirty`. Host sees predicted next free time.
7. Closer counts stock against theoretical usage. Variance feeds food cost.
8. Owner opens Dashboard next morning: sales, food cost %, waste, and menu dogs.

Exception paths: void after send (manager PIN), 86 mid-service, split check, walk-in waitlist, no-show after 15 minutes, recipe cost change after invoice receive.

## 9. Module Specs

### 9.1 Dashboard

Purpose: one screen that answers "how is this shift / this week?"

Layout:

- Top KPI row: today's sales, covers, average check, food cost % (rolling 7-day), table occupancy
- Alerts rail: late tickets, items below par, 86 list, dishes below 10% margin
- Sales vs last week sparkline
- Top 5 sellers and bottom 5 contribution items
- Kitchen SLA: average ticket time vs target
- Floor snapshot thumbnail linking to Floor

Empty/error: if no sales yet, show "Shift not started" with last close summary, not a blank chart.

Success metric: owner understands shift health in under 15 seconds.

### 9.2 Order Management

Purpose: build, send, modify, and close tickets without leaving table context.

Key screens:

- Ticket list: open / sent / ready / paid, filter by server and table
- Ticket composer: categories, search, modifiers, hold/fire, course
- Check actions: split even, split by item, void, comp (reason required), pay

Rules:

- Sending is the commit. 15-second undo, then kitchen owns the item.
- Modifiers are required when the recipe marks them required (temp, sides).
- 86 items are blocked in composer with substitute suggestion if mapped.
- Theoretical inventory drops on fire, not on draft.

Success metric: typical 3-item ticket sent in under 20 seconds.

### 9.3 Table Management

Purpose: floor as a live map, not a list.

Key screens:

- Floor map: tables as seats-sized cards, status color + label, party size, minutes seated
- Reservation book: timeline by 15-minute slots, drag to table
- Waitlist: quoted wait from average turn of that party size today

Rules:

- Status machine is strict: `free` -> `seated` -> `ordered` -> `billed` -> `dirty` -> `free`. `reserved` overlays `free`.
- Host cannot seat over capacity without confirm.
- Turn alert fires at 90% of target turn time.

Success metric: host quotes wait within 1 minute of actual next free table.

### 9.4 Kitchen Management

Purpose: cook from tickets, not from paper.

Key screens:

- KDS columns by station (grill, saute, pantry, dessert, expo)
- Ticket card: table, server, items, modifiers, elapsed time, course
- 86 board shared with floor in real time
- Recall last bumped ticket

Rules:

- Color by age: on-time, warning at 70% of target, late at 100%.
- Expo sees whole table; stations see only their items.
- Bump is irreversible except recall within 60 seconds.

Success metric: late-ticket rate visible and actionable during the rush.

### 9.5 Inventory Management

Purpose: prevent 86 and unexplained variance.

Key screens:

- Stock list with on-hand, par, status (`ok` | `low` | `out`)
- Receive invoice: vendor, items, unit cost (updates lastCost and recipe cost)
- Count sheet: after-close theoretical vs counted
- Waste log: reason (`prep` | `spoil` | `comp` | `error`)

Rules:

- Par alerts appear on Dashboard 2 hours before typical rush start (configurable).
- Unit conversions live on the ingredient (case -> each -> gram).
- Negative on-hand is allowed only as a flag, not silent wrap.

Success metric: zero surprise 86 on par-tracked proteins during Friday dinner.

### 9.6 Reports and Analytics

Purpose: after-the-fact truth that still leads to an action.

Default reports:

- Sales by hour / day / category
- Server and table performance (turns, average check)
- Voids / comps with reasons
- Inventory variance
- P&L-lite: sales minus theoretical food cost minus logged waste (no full accounting)

Filters: today, last 7 days, last 30 days, custom. Compare to previous period always on.

Success metric: each report has a next action (86 a dish, change par, retrain a void reason).

### 9.7 Food Cost and Profit

Purpose: stop selling dishes that lose money.

Key screens:

- Recipe coster: ingredients, yield, waste %, plate cost, menu price, margin %
- Menu matrix: popularity vs margin (star, plowhorse, puzzle, dog)
- Ingredient shock: "salmon +12% this week — 3 dishes drop below 10% margin"

Rules:

- Cost uses last invoice cost, not a static number.
- Margin bands: high >= 70% contribution (price - plate) / price; ok 55–70%; low 10–55%; loss < 10%. Casual dining food-cost target shown as 28–32% unless owner overrides.
- Changing a recipe writes a new cost snapshot; historical tickets keep old snapshot.

Success metric: owner can mark one dog to 86 or reprice in the same session.

## 10. Visual Direction

Not a consumer food app. This is a tool used in motion, heat, and low light.

- Theme: dark operational UI for Live screens; slightly lighter for Insight screens.
- Color: status green / amber / red with labels; brand accent used only for primary actions (Send, Seat, Bump).
- Type: large numerals for KPIs and ticket timers; short labels; no decorative copy on Live screens.
- Density: Kitchen and Floor are dense; Dashboard and Costing are airy.
- Motion: only for status changes and new tickets. No ambient animation.
- Imagery: none on Live. Optional plated-dish thumbnails only on Menu costing.

Accessibility: WCAG AA contrast, 44px tap targets on Floor/Kitchen, never color-only status, keyboard for office reports.

## 11. Case Study Narrative (what the written story must prove)

The case study is not a feature tour. Each section must connect a business wound to a design decision.

1. Context — casual dining, fragmented tools, waste and slow turns.
2. Research — shadow a Friday dinner; map the handoffs that drop tickets.
3. Insight — the system of record is the ticket, not the table and not the invoice.
4. IA — Live / Control / Insight, because mixing them buries the rush.
5. Flows — seat -> send -> fire -> bump -> pay -> count.
6. Screens — Floor, Ticket, KDS, Cost matrix as the four hero frames.
7. Impact — define metrics even without a live product: ticket time, 86 rate, food cost variance, turn time.
8. Reflection — what was cut (guest app, multi-unit, payroll) and why.

## 12. Risks

- Boiling the ocean: seven modules can become a generic ERP. Mitigate with the service-flow spine.
- Fake data in a case study that does not match restaurant math. Use realistic checks ($38–$62 average), 18-minute ticket target, 30% food cost.
- Pretty dashboards that a cook cannot use with wet hands. Kitchen UI is the honesty check.
- Inventory theoretical vs actual confusion. Always label which number is which.

## 13. Success Criteria for This Plan Cycle

The written plan is done when a designer or engineer can:

- Name the users, objects, and status machines without inventing new ones
- Draw the Friday-night flow end to end
- Know which screen owns each business problem
- Write the case study outline without adding unrelated features
