# Restora UI/UX Case Study — Step-by-Step Plan

> Written plan only. No product code in this cycle. Pair with `docs/superpowers/specs/2026-10-12-restora-ux-design.md`.

**Goal:** Produce a complete UI/UX case study for Restora that proves the product solves restaurant operations problems, not just that it looks like a dashboard.

**Architecture:** Hybrid case study: one Friday-night service spine, seven modules hanging off it, each tied to a business wound, a user, a flow, a screen, and a metric.

**Stack for the case study (documentation, not a product):** this markdown plan, the design spec, optional later Figma/frames. No app scaffold.

## Global Constraints

- Restaurant: single-location casual dining, table service, 12–24 tables.
- Users: Maya (owner/GM), Jordan (server), Kim (kitchen lead), Alex (host).
- Cut: guest app, multi-unit, payroll, delivery aggregators, hardware POS.
- Live screens are shift-first; reports are one click away.
- Ticket is the system of record.
- Realistic numbers: average check $38–$62, ticket target 18 min, food cost 28–32%.
- Status is color + word. Kitchen UI is the honesty check.

---

### Task 1: Lock the story spine

**Files:**
- Read: `docs/superpowers/specs/2026-10-12-restora-ux-design.md`
- Produce in the case study: opening problem statement

- [ ] **Step 1: Write the one-sentence problem**

Use this, do not genericize:

> Casual restaurants lose time, food, and profit because orders, tables, kitchen, stock, and cost live in separate tools.

- [ ] **Step 2: Write the one-sentence solution**

> Restora is one operational system of record for the ticket, so floor, kitchen, and owner see the same shift.

- [ ] **Step 3: Write the Friday-night spine (keep this order in every later section)**

1. Host seats
2. Server sends
3. Kitchen fires and bumps
4. Inventory theoretically decrements
5. Guest pays
6. Closer counts
7. Owner reads cost in the morning

Do not reorder modules as a feature list. Always hitch a module to this spine.

- [ ] **Step 4: Gate**

If a later screen cannot be pointed at one of these seven beats, cut it.

---

### Task 2: Research frame (even without field access)

**Produces:** Case study section "Research"

- [ ] **Step 1: Define what you would observe on a Friday 6–10pm**

| Minute | Watch | Failure if tools are split |
| --- | --- | --- |
| 18:00 | Host quotes wait | Guessing from memory |
| 18:12 | Server sends 3-item ticket with mods | Kitchen gets a shout, not a ticket |
| 18:19 | Grill 86s salmon | Floor keeps selling it |
| 18:31 | Table 12 seated 55 min | Host does not know it will free |
| 21:40 | Close count | Theoretical vs actual unknown |
| Next day | Owner asks food cost | Spreadsheet, 10 days late |

- [ ] **Step 2: Capture four quotes (composite, attributed to roles)**

- Maya: "I know sales. I do not know if the menu is making money tonight."
- Jordan: "If the modifier does not hit the ticket, I walk to the pass."
- Kim: "Paper tickets vanish. I need age on the board."
- Alex: "I will not quote a wait I cannot defend."

- [ ] **Step 3: Insight to carry forward**

The ticket — not the table, not the invoice — is the object every role already shares. Design around that.

---

### Task 3: Users, jobs, and role-aware IA

**Produces:** Personas + sitemap in the case study

- [ ] **Step 1: Jobs to be done (one per role)**

- Maya: See shift health and kill a losing dish.
- Jordan: Send a correct ticket in under 20 seconds.
- Kim: Cook the oldest fireable item without hunting.
- Alex: Seat the next party on a true-free table.

- [ ] **Step 2: Draw IA as Live / Control / Insight**

```
Live:      Dashboard, Floor, Tickets, Kitchen
Control:   Menu & Recipes, Inventory, Staff (light)
Insight:   Reports, Food Cost & Profit
Settings:  profile, tax, stations
```

- [ ] **Step 3: Role vs nav matrix**

| | Floor | Tickets | Kitchen | Inventory | Cost | Reports | Dashboard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Host | yes | no | no | no | no | no | snapshot |
| Server | yes | yes | no | no | no | no | no |
| Kitchen | 86 only | no | yes | no | no | no | no |
| Owner | yes | yes | yes | yes | yes | yes | yes |

- [ ] **Step 4: Gate**

Do not put Food Cost on the kitchen display. Do not put KDS cards on the owner laptop as the home screen. Mixing Live and Insight is the main IA failure.

---

### Task 4: Object model and status machines

**Produces:** Case study "System" section — enough for a designer to stay consistent

- [ ] **Step 1: Memorize the objects**

Table, Reservation, Order/Ticket, TicketItem, MenuItem, Recipe, InventoryItem, Alert.

Full fields: spec section 7.

- [ ] **Step 2: Table status machine (strict)**

`free` -> `seated` -> `ordered` -> `billed` -> `dirty` -> `free`

`reserved` overlays `free` only. Host confirm required to over-seat.

- [ ] **Step 3: Ticket status machine**

`open` -> `sent` -> `in_prep` -> `ready` -> `served` -> `paid`

Branch: `void` after manager PIN. 15-second undo after send. Kitchen owns the item after that.

- [ ] **Step 4: Inventory timing rule (write this on every inventory frame)**

Theoretical on-hand drops on **fire**, not on draft and not on pay. Counted on-hand is only updated by receive, waste log, or close count.

- [ ] **Step 5: Margin bands (write on every costing frame)**

Contribution = (price - plate cost) / price

- high: >= 70%
- ok: 55–70%
- low: 10–55%
- loss: < 10%

Restaurant food-cost target: 28–32% unless owner overrides.

---

### Task 5: End-to-end flow storyboard

**Produces:** 8-frame storyboard (the case study hero)

Frame each beat as: user, screen, action, system result.

- [ ] **Frame 1 — Seat**

Alex on Floor map. Taps Table 14 (`free`, 4-top), party of 3 from waitlist. Table -> `seated`, seatedAt now, reservation/waitlist item -> `seated`.

- [ ] **Frame 2 — Compose**

Jordan opens check from Table 14. Adds burger (temp required), fries, salad. Holds dessert. Tap Send.

- [ ] **Frame 3 — Fire**

Kim on KDS grill column. Burger appears with modifiers and 0:00 timer. Recipe snapshot attached. Theoretical inventory: bun, patty, tomato decrement.

- [ ] **Frame 4 — Exception (required, not optional)**

Salmon hits par=0. Alert `low_stock` then `86`. Jordan's composer blocks salmon and offers substitute. Dashboard alert rail shows 86.

- [ ] **Frame 5 — Bump and ready**

Kim bumps at 11:40. Jordan sees `ready`. Expo still sees the whole table until all items bumped.

- [ ] **Frame 6 — Pay and turn**

Jordan pays. Table -> `billed` then `dirty`. Alex sees predicted next free from today's 4-top turn time. Turn alert would have fired at 90% of target if they lingered.

- [ ] **Frame 7 — Count**

Closer opens count sheet. Theoretical vs counted. Variance reason required if off par. Waste log if spoil.

- [ ] **Frame 8 — Morning**

Maya on Dashboard: sales, covers, food cost % 7-day, late tickets, salmon 86, burger as plowhorse, one loss-band dish. One tap into Food Cost matrix.

Gate: if a frame does not change an object from Task 4, it is decoration. Cut it.

---

### Task 6: Screen specs — Live

**Produces:** annotated wireframe list for Dashboard, Floor, Tickets, Kitchen

#### 6.1 Dashboard (Maya, laptop)

- KPI row: today's sales, covers, average check, food cost % (7-day), occupancy
- Alerts rail: late tickets, below par, 86, negative margin
- Sparkline: sales vs last week
- Top 5 sellers / bottom 5 contribution
- Kitchen SLA vs 18 min target
- Floor thumbnail
- Empty state: "Shift not started" + last close, never blank charts

Read in 15 seconds. No decorative illustration.

#### 6.2 Floor (Alex, tablet)

- Map, not list. Tables sized by seats.
- Each table: name, seats, status word + color, party size, minutes seated
- Side rail: reservations in 15-min slots, waitlist with quoted wait
- Quote wait from today's actual turn for that party size
- Cannot seat over capacity without confirm
- Dirty tables cannot be seated

#### 6.3 Tickets (Jordan, POS / handheld)

- List: open / sent / ready / paid, filter server + table
- Composer: categories, search, required modifiers, hold/fire, course
- 86 items blocked with substitute if mapped
- Actions: split even, split by item, void, comp (reason), pay
- Send is commit; 15s undo then kitchen-owned
- Target: 3-item ticket sent in under 20 seconds

#### 6.4 Kitchen (Kim, KDS)

- Columns by station: grill, saute, pantry, dessert, expo
- Card: table, server, items, mods, elapsed, course
- Age color + word: on-time, warning at 70% of 18 min, late at 100%
- Expo = whole table; station = own items only
- 86 board shared with floor
- Bump irreversible except 60s recall
- Wet-hands: 44px targets, no tiny toggles

---

### Task 7: Screen specs — Control and Insight

**Produces:** Menu/Recipes, Inventory, Reports, Food Cost screens

#### 7.1 Menu and Recipes (Maya, office)

- Recipe coster: ingredient, qty, unit, waste %, yield, plate cost, price, margin %
- Changing recipe writes a new cost snapshot; old tickets keep old snapshot
- 86 toggle writes through to composer and KDS immediately

#### 7.2 Inventory (Maya or closer)

- List: on-hand, par, `ok` | `low` | `out`, location
- Receive invoice: vendor, qty, unit cost -> lastCost -> live recipe cost
- Count sheet: theoretical vs counted
- Waste log: `prep` | `spoil` | `comp` | `error`
- Par alert 2 hours before configured rush
- Negative on-hand is a flag, never silent wrap
- Always label theoretical vs counted

#### 7.3 Reports

- Sales by hour / day / category
- Server and table: turns, average check
- Voids/comps with reasons
- Inventory variance
- P&L-lite: sales - theoretical food cost - logged waste
- Range: today, 7d, 30d, custom, always vs previous period
- Every report ends with a next action, not a chart for its own sake

#### 7.4 Food Cost and Profit (hero Insight screen)

- Menu matrix: popularity vs margin = star / plowhorse / puzzle / dog
- Ingredient shock: "salmon +12% this week — 3 dishes drop below 10% margin"
- Owner can 86 or reprice in the same session
- Cost uses last invoice, not a static card

---

### Task 8: Visual, a11y, and content rules

**Produces:** Case study "Visual design" section

- [ ] **Step 1: Two surfaces**

- Live: dark operational UI (Floor, Tickets, Kitchen, Dashboard during service)
- Insight: slightly lighter (Reports, Costing)

- [ ] **Step 2: Color rules**

- Green / amber / red only for status, always with a word
- Brand accent only on primary actions: Seat, Send, Bump, Receive, 86
- No color-only 86

- [ ] **Step 3: Type and density**

- Large numerals for KPIs and ticket age
- Short labels, no marketing copy on Live
- Kitchen and Floor dense; Dashboard and Costing airy
- Motion only for new tickets and status change

- [ ] **Step 4: A11y**

- WCAG AA contrast
- 44px targets on Floor and Kitchen
- Keyboard for office reports
- Status announced as text

- [ ] **Step 5: Sample data that must appear on frames (do not invent prettier numbers)**

- Average check $48
- Ticket target 18:00
- Food cost 30.4% vs 32% cap
- Table 14: 4-top, 22 min seated
- Burger $16, plate $4.10, contribution 74% (star/plowhorse depending on volume)
- Salmon 86 at 18:19

---

### Task 9: Metrics and impact (even without a live product)

**Produces:** Case study "Impact" section — design for measurement

| Metric | Baseline (fragmented tools) | Restora target | Where it is visible |
| --- | --- | --- | --- |
| Order-to-kitchen latency | minutes / verbal | < 10s after send | Tickets + KDS |
| 3-item send time | variable | < 20s | Tickets |
| Surprise 86 on par proteins | weekly | 0 on Friday dinner | Inventory + Dashboard |
| Host wait quote error | guessed | within 1 min of next free | Floor |
| Owner time-to-answer "are we making money on this menu?" | days | < 2 min | Dashboard + Cost |
| Shift health read | n/a | < 15s | Dashboard |
| Late ticket rate | unknown | visible vs 18 min SLA | KDS + Dashboard |
| Food cost variance | unmeasured | theoretical vs count after close | Inventory + Reports |

Every hero screen in the case study must caption one of these metrics.

---

### Task 10: Write the case study document itself

**Files:**
- Create: `docs/superpowers/specs/2026-10-12-restora-case-study-narrative.md` when writing the public narrative
- Source of truth remains the design spec

**Section order (do not reshuffle into a feature dump):**

1. Title + one-line outcome
2. Context and problem (Task 1)
3. Research (Task 2)
4. Insight: ticket is the system of record
5. Users and IA (Task 3)
6. Service flow storyboard (Task 5)
7. Four hero screens: Floor, Ticket composer, KDS, Cost matrix
8. Supporting modules: Dashboard, Inventory, Reports (short)
9. Visual and a11y (Task 8)
10. Impact metrics (Task 9)
11. What we cut and why (non-goals)
12. Reflection: kitchen UI as honesty check; theoretical vs counted labeled always

- [ ] **Step 1: Draft each section against the matching task above**
- [ ] **Step 2: Strip any sentence that does not name a user, an object, or a metric**
- [ ] **Step 3: Confirm non-goals are explicit**

Guest app, multi-unit, payroll, delivery, hardware POS, fine-dining course orchestration.

---

### Task 11: Self-review checklist

Run this before calling the plan done.

- [ ] Spec coverage: problem, seven modules, four users, status machines, food-cost bands, non-goals — each has a task.
- [ ] No placeholders: no TBD screens, no "add polish later."
- [ ] Type consistency: table statuses and ticket statuses match the spec exactly.
- [ ] Honesty: Kitchen and 86 path exist; dashboard is not the whole story.
- [ ] YAGNI: no QR ordering, no loyalty, no chef plating photos on Live.
- [ ] Business proof: every module maps to time, waste, or profit.

---

## Case study outline (copy-ready)

```
Restora — Smart Restaurant Management
UI/UX Case Study

Problem
Many restaurants juggle orders, tables, kitchen, inventory, and cost in separate tools.
Result: slow tickets, surprise 86s, idle tables, food cost nobody trusts.

Solution
One system of record: the ticket. Floor, kitchen, stock, and owner read the same shift.

Users
Maya (owner), Jordan (server), Kim (kitchen), Alex (host)

Principle
Shift-first Live screens. Insight one click away. Status as color + word.
Cost is a first-class object.

Flow
Seat -> Send -> Fire -> (86 exception) -> Bump -> Pay -> Count -> Morning cost

Hero screens
1. Floor map with true wait quotes
2. Ticket composer with required mods and 15s undo
3. KDS with age, stations, shared 86 board
4. Menu matrix (star / plowhorse / puzzle / dog) with invoice-based plate cost

Impact we design for
<10s send-to-kitchen, <20s compose, 0 surprise 86 on par proteins,
<2 min for the owner to judge the menu, food cost 28-32%.

Cut
Guest app, multi-unit, payroll, aggregators. Great design solves the shift,
not the entire company.
```

---

## Execution note

This cycle stops at written plan + spec. Do not scaffold an app, do not deploy, do not invent extra modules.

If a later cycle builds UI, implement in this order so the spine stays testable:

1. Object model + status machines
2. Floor seat/dirty
3. Ticket compose/send/undo
4. KDS fire/bump/86
5. Theoretical inventory on fire
6. Dashboard alerts
7. Recipe cost + matrix
8. Reports
