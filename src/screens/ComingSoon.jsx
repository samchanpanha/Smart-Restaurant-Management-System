// Placeholder for modules built in later spine steps.
// Each card states the spec contract so the build stays honest.

const CONTENT = {
  dashboard: {
    step: 6,
    title: 'Dashboard',
    purpose: 'One screen that answers “how is this shift / this week?”',
    points: [
      'KPI row: sales · covers · avg check · food cost 7d · occupancy',
      'Alerts rail: late tickets · below par · 86 · losing dishes',
      'Sales vs last week sparkline + top/bottom 5 dishes',
      'Kitchen SLA vs 18-min target + floor snapshot',
    ],
    metric: 'Owner reads shift health in under 15 seconds.',
  },
  floor: {
    step: 2,
    title: 'Floor — Tables & Reservations',
    purpose: 'The floor as a live map, not a list.',
    points: [
      'Map of 16 tables sized by seats, status color + word',
      'Tap to seat ·Reservation rail in 15-min slots · waitlist with quoted wait',
      'Strict machine: free → seated → ordered → billed → dirty → free',
      'Turn alert at 90% of target; dirty tables cannot seat',
    ],
    metric: 'Host quotes wait within 1 minute of actual next free table.',
  },
  tickets: {
    step: 3,
    title: 'Tickets — Order Management',
    purpose: 'Build, send, modify, and close tickets without leaving table context.',
    points: [
      'Ticket list: open / sent / ready / paid, filter by server + table',
      'Composer: categories · search · required modifiers · hold/fire · course',
      '86 blocked with substitute · split · void · comp (reason) · pay',
      'Send is commit: 15s undo, then the kitchen owns the item',
    ],
    metric: 'Typical 3-item ticket sent in under 20 seconds.',
  },
  kitchen: {
    step: 4,
    title: 'Kitchen — KDS',
    purpose: 'Cook from tickets, not from paper.',
    points: [
      'Columns by station: grill · sauté · pantry · dessert · expo',
      'Card: table · server · items · mods · elapsed · course',
      'Age color + word: on-time · warning 70% · late 100% of 18 min',
      'Shared 86 board · bump irreversible except 60s recall · 44px targets',
    ],
    metric: 'Late-ticket rate visible and actionable during the rush.',
  },
  menu: {
    step: 7,
    title: 'Menu & Recipes',
    purpose: 'Cost is a first-class object: recipes feed every profit view.',
    points: [
      'Recipe coster: ingredients · yield · waste % · plate · price · margin',
      'New cost snapshot on every recipe change; old tickets keep theirs',
      '86 toggle writes through to composer + KDS immediately',
    ],
    metric: 'Every dish carries a live plate cost from last invoice.',
  },
  inventory: {
    step: 5,
    title: 'Inventory',
    purpose: 'Prevent 86 and unexplained variance.',
    points: [
      'Stock list: on-hand · par · ok/low/out · location',
      'Receive invoice → lastCost → live recipe cost',
      'Count sheet: theoretical vs counted · waste log with reasons',
      'Par alert 2h before rush · negative on-hand is a flag, never silent',
    ],
    metric: 'Zero surprise 86 on par-tracked proteins on Friday dinner.',
  },
  reports: {
    step: 8,
    title: 'Reports & Analytics',
    purpose: 'After-the-fact truth that still leads to an action.',
    points: [
      'Sales by hour / day / category · server + table performance',
      'Voids / comps with reasons · inventory variance',
      'P&L-lite: sales − theoretical food cost − logged waste',
      'Ranges with previous-period compare; every report ends in a next action',
    ],
    metric: 'Each report names its next action (86 a dish, change par…).',
  },
  costing: {
    step: 7,
    title: 'Food Cost & Profit',
    purpose: 'Stop selling dishes that lose money.',
    points: [
      'Menu matrix: popularity vs margin → star / plowhorse / puzzle / dog',
      'Ingredient shock: “salmon +12% — 3 dishes drop below 10%”',
      'Owner can 86 or reprice in the same session',
      'Bands: high ≥70% · ok 55–70% · low 10–55% · loss <10%',
    ],
    metric: 'Owner marks one dog to 86 or reprice in the same session.',
  },
}

export default function ComingSoon({ screen }) {
  const c = CONTENT[screen] || { step: '?', title: screen, purpose: '', points: [], metric: '' }
  return (
    <div className="mx-auto max-w-2xl pt-10">
      <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-8">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
          Build step {c.step} · not yet implemented
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{c.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{c.purpose}</p>
        <ul className="mt-5 space-y-2">
          {c.points.map((p) => (
            <li key={p} className="flex gap-2.5 text-sm text-zinc-300">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-6 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-500/30">
          <span className="font-semibold">Success metric: </span>
          {c.metric}
        </div>
      </div>
    </div>
  )
}
