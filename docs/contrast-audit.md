# Restora contrast & legibility audit

**Every measured text/background combination in the app now passes WCAG 2.1 AA.**
The table at the bottom is generated; the numbers in this section are the
before/after for the whole pass.

| Layer | Before | After |
| --- | --- | --- |
| Design-token pairs (A) | **11 of 25 fail** | **0 of 25 fail** |
| Hardcoded `text-*` + `bg-*` pairs in markup (B) | **149 fail** | **0 fail** |
| Text colours failing on *every* surface they can land on (C) | **446 fail** | **0 fail** |
| Lowest ratio anywhere in the app | 1.01:1 (white on white) | 3.05:1 (brand accent used as an *icon*, where WCAG asks for 3:1) |

Both columns were measured with the same tool, `node scripts/contrast-audit.mjs`,
which reads the real palette out of `src/index.css` and walks every
`className` in `src/**/*.jsx`. The before column is that tool run against
`main` at `0fb5ad6`.

## What was actually wrong

Five root causes accounted for almost all 596 failures:

1. **`text-zinc-500` was Tailwind's `#71717a` on white cards — 316 failures.**
   The app's most-used muted ink. The theme already remapped the zinc ramp for
   the topbar/tabs/workspace, but the selector list
   (`.restora-theme :is(.app-topbar, .app-tabs, .app-workspace) .text-zinc-500`)
   missed the sign-in screen, the boot splash and **every portaled dialog**
   (modals, sheets and drawers render onto `<body>`, outside `.restora-theme`),
   where `text-zinc-100` painted `#f4f4f5` on a near-white background —
   effectively invisible text. The remap now covers three light roots
   (`.restora-theme`, `.restora-light`, `.restora-guest`) and the dialogs carry
   `.restora-light`.

2. **White on the brand orange — 31 buttons at 2.8:1.** The most-clicked pixel
   in the app. The orange stays exactly the brand colour (`#f36a21`); the
   *label* now flips to `--text-on-accent: #14100c`, which measures 6.22:1 and
   matches what the guest accent buttons have always done.

3. **Accent and status colours used as *ink* — ~90 failures.**
   `text-[var(--accent)]` (2.84:1) appeared 37 times as a label or icon colour,
   and the pale Tailwind steps were used as text everywhere
   (`text-orange-600` on `bg-orange-50` 3.35:1, `text-red-600` on `bg-red-50`
   4.41:1 ×10, `text-rose-300` on a rose wash 1.66:1). Two mechanisms now,
   because they are two different jobs: `--color-*` **variables** carry fills
   (pale 50/100/200 washes, strong 500/600 fills) and `.text-*` **class
   remaps** carry ink (`--accent-text: #a63a0c`, 6.5:1 on white). Remapping the
   variables alone would have darkened the matching chips too.

4. **Dark islands inside a light theme painted dark-on-dark — ~20 failures.**
   The command palette, the shortcuts dialog, toasts, the ticket batch bar, the
   dashboard hero, the floor selection bar, the mini-app header and the
   "guest preview" panel in Settings → Payments are dark by design, but their
   surfaces resolve through light-theme tokens, so `text-zinc-200` on
   `bg-zinc-800` landed at 1.14:1. Each is now marked `.surface-dark` (or
   `.app-sidebar`), which restores the light zinc/accent/status ramps for that
   subtree — and the audit detects the marker, including on descendants.

5. **Two token gaps and one invisible button.** `dark/body-on-ink` and
   `dark/muted-on-ink` did not resolve at all; `--border-strong` was `#d4d7dc`
   (1.44:1, under the 3:1 non-text target); and Settings → Dashboard had a
   "Reset" button styled `text-[var(--color-ink-700)]`, which in the light
   theme is `#e6e8eb` — light gray text on a white card, 1.1:1.

## What changed

**`src/index.css`**

| Token / rule | Before | After | Ratio |
| --- | --- | --- | --- |
| `--text-on-accent` | `#ffffff` | `#14100c` | 3.05 → **6.22** on `--accent` |
| `--accent-text` (new) | — | `#a63a0c` | **6.5** on white, **5.83** on the accent wash |
| `--text-subtle` | `#77808b` | `#666e78` | 4.00 → **5.16** |
| `--border-strong` | `#d4d7dc` | `#868d95` | 1.44 → **3.36** (non-text, 3:1 target) |
| `--success` / `--info` | `#17835d` / `#1675b8` | `#146b4f` / `#14689f` | 4.17 → **5.58** and 4.30 → **5.19** on their soft washes |
| `--warning` / `--danger` | `#b45309` / `#bd3737` (already passing) | `#a44a08` / `#b32d2d` | re-tinted to match the new washes: **5.20** / **5.38** |
| zinc ink ramp (`.text-zinc-100…800`) | Tailwind, topbar-only scope | dark ink, all three light roots | 400 → **5.6**, 500 → **5.2**, 600 → **5.6** on white |
| zinc ink ramp in dark islands | none | `.app-sidebar, .surface-dark` | 100 → **17.4** … 800 → **6.9** on `#17181a` |
| accent-family ink (`.text-orange/amber/red/rose/emerald/sky/violet/stone-*`) | Tailwind pale steps | one accessible ink per family | **4.8–8.0** on white and on their own 50/100 washes |
| palette fills (`--color-*-50…700`) | Tailwind | pale washes stay pale, strong fills carry a label at ≥ **4.5** | e.g. white on `--color-emerald-500` **4.79**, on `--color-sky-500` **4.97** |
| dark-island status inks | inherited the light (dark) values | `--success: #4ecb96`, `--warning: #ffb27a`, `--danger: #ff9d9d`, `--info: #7dd3fc` | **8.1–10.0** on `#17181a` |
| placeholder ink | `#9aa1aa` | `#666e78` | 2.63 → **5.16** |
| `:focus-visible` outline | `var(--color-brand-400)` = `#f59e0b` | `var(--accent)` = `#f36a21` | 2.15 → **3.05** on white (non-text, 3:1 target) |

**Markup** (only where a class could not be fixed centrally)

- 37 × `text-[var(--accent)]` → `text-[var(--accent-text)]`, plus one
  `text-[var(--accent-hover)]`.
- `text-black` on the emerald/red/sky "confirm" fills → `text-white`
  (Kitchen, Menu, Costing, Tickets, PayModal, UndoBanner): black on
  `--color-emerald-500` is 4.39:1, white is 4.79:1. The two translucent
  `bg-emerald-500/90` fills became solid, because a 90% wash over white drops
  the label to 3.99:1.
- `bg-teal-600` → `bg-teal-700` on the Receive button (3.9 → 4.9 with white).
- Two checkboxes drawn as dark chips on a light card
  (`bg-zinc-800 text-amber-500`, 2.29:1) → light box with `--accent-text` glyph.
- The dashboard hero's two chips stopped relying on the photo gradient's thin
  right-hand edge: `bg-black/20 text-white/90` → `bg-[rgb(18_17_16/72%)]
  text-white`, which holds 6.6:1 even over a white photograph.
- `bg-red-600/80` / `bg-amber-600/80` batch buttons → `var(--danger)` /
  `var(--warning)` solids (6.6:1 and 6.9:1).
- Island markers added: `Overlay.jsx` panels (`.restora-light`), toasts,
  command palette, shortcuts dialog, ticket batch bar, dashboard hero,
  mini-app headers, guest QR/mini-app roots (`.restora-guest`), the Settings →
  Payments guest preview panel.

## Re-running it

```bash
node scripts/contrast-audit.mjs                        # print the report
node scripts/contrast-audit.mjs --json                 # machine-readable
node scripts/contrast-audit.mjs --fail                 # exit 1 on any failure (CI)
node scripts/contrast-audit.mjs --out docs/x.md        # write a file
node scripts/contrast-audit.mjs --why src/screens/KitchenScreen.jsx:315   # why one element scored what it did
node --test tests/contrast-tokens.test.js              # 12 assertions that pin the ratios
```

`tests/contrast-tokens.test.js` is the guard rail: it re-measures every
`CONTRAST_PAIRS` row, both zinc ramps, every accent-family ink, the status
colours, the island inks and the non-text 3:1 targets, and it asserts the pair
table still has ≥ 25 rows so it cannot be emptied to go green.

## What the audit can and cannot see

It resolves static `className` literals — named utilities, opacity modifiers
(`text-white/70`), arbitrary values (`bg-[var(--warning)]`, `bg-[#121110]`,
`bg-[rgb(18_17_16/72%)]`) — through the token tables and class remaps in
`src/index.css`, and composites translucent fills over the surface they sit on.
It tracks dark islands through JSX nesting, so a `<span>` inside a
`.surface-dark` panel is graded against the island's ramp.

Known limits, all deliberately conservative:

- Literals containing `${…}` are skipped, so a colour chosen by a ternary
  (`lateOnly ? 'bg-red-500 text-white' : …`) is only measured when written as a
  plain literal. `dark:` variants are ignored: this app ships one light theme
  with explicit islands, so those never paint.
- Text over a **photo** is composited over the surface the element declares,
  not over the image. The hero scrim is now solid enough that this no longer
  matters, but a new full-bleed photo needs the same treatment.
- Runtime styles (`style={{ … }}`) and per-tenant `brandColor` are out of
  scope. The tenant document colour (`#f36a21` in `src/lib/settings.js`,
  `documents.js`, `seed.js`) is printed-document branding, not UI ink.


---


Generated 2026-10-18 by `node scripts/contrast-audit.mjs`. 
WCAG 2.1: body text needs 4.5:1 (AA), large text and non-text UI 3:1.

**0 of 25 token pairs fail**, **0 hardcoded class pairs fail**, **0 text colours fail on every surface they can land on.**

## A. Design tokens

| Pair | Ink | Surface | Ratio | Level |
| --- | --- | --- | --- | --- |
| Accent icon on card (non-text) `accent/accent-as-icon` | `#f36a21` | `#ffffff` | 3.05 | AA |
| Card border (non-text) `workspace/border-on-surface` | `#868d95` | `#ffffff` | 3.36 | AA |
| Subtle text on sunken panel `workspace/subtle-on-sunken` | `#666e78` | `#f6f7f9` | 4.82 | AA |
| Primary button label (hover) `accent/label-on-accent-hover` | `#14100c` | `#df5817` | 5.00 | AA |
| Sidebar section heading `sidebar/muted-on-sidebar` | `#85898f` | `#17181a` | 5.05 | AA |
| Muted text on page background `workspace/muted-on-page` | `#626a74` | `#f5f6f8` | 5.07 | AA |
| Subtle text on card `workspace/subtle-on-surface` | `#666e78` | `#ffffff` | 5.16 | AA |
| Info pill text `status/info-on-soft` | `#14689f` | `#e8f0f5` | 5.19 | AA |
| Warning pill text `status/warning-on-soft` | `#a44a08` | `#fdefd8` | 5.20 | AA |
| Danger pill text `status/danger-on-soft` | `#b32d2d` | `#f7eaea` | 5.38 | AA |
| Muted text on card `workspace/muted-on-surface` | `#626a74` | `#ffffff` | 5.48 | AA |
| Success pill text `status/success-on-soft` | `#146b4f` | `#e8f0ed` | 5.58 | AA |
| Subtle button / badge label `accent/accent-on-soft` | `#a63a0c` | `#fef0e9` | 5.83 | AA |
| Primary button label `accent/label-on-accent` | `#14100c` | `#f36a21` | 6.22 | AA |
| Active nav item label `sidebar/active-on-accent` | `#14100c` | `#f36a21` | 6.22 | AA |
| Guest primary button label `guest/label-on-accent` | `#1c1917` | `#f59e0b` | 8.14 | AAA |
| Mini-app header sub-line `guest/muted-white-on-chrome` | `#ffffff` | `#1b1c1e` | 8.89 | AAA |
| Toast / palette secondary text `dark/muted-on-ink` | `#c3c6ca` | `#17181a` | 10.36 | AAA |
| Sidebar nav label `sidebar/nav-on-sidebar` | `#d4d6d9` | `#17181a` | 12.20 | AAA |
| Body text on card `workspace/body-on-surface` | `#30343a` | `#ffffff` | 12.52 | AAA |
| Mini-app header text `guest/white-on-chrome` | `#ffffff` | `#1b1c1e` | 13.93 | AAA |
| Guest body text `guest/ink-on-bg` | `#1c1917` | `#faf6ef` | 16.23 | AAA |
| Heading text on card `workspace/strong-on-surface` | `#1d2024` | `#ffffff` | 16.35 | AAA |
| Toast / palette body text `dark/body-on-ink` | `#f7f7f7` | `#17181a` | 16.58 | AAA |
| Guest card text `guest/ink-on-surface` | `#1c1917` | `#ffffff` | 17.49 | AAA |

## B. Hardcoded class pairs (text + background on one element)

None failing.

## C. Text colours that fail on every surface they can land on

None failing.
