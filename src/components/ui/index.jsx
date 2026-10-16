// ─── Restora UI kit ─────────────────────────────────────────────────
// One import surface for the whole app. New code should use the components
// (Button/Card/Modal/…) and semantic tokens; the legacy `inputCls` /
// `btnPrimary` / `btnGhost` string constants are kept for the screens that
// haven't migrated yet and are removed as Wave 4–5 lands.

export { Button, IconButton, Badge, buttonVariants } from './Button'
export { Card, SectionHeader, Toolbar, Divider, Skeleton, EmptyState, ErrorBanner } from './Card'
export { Progress } from './Progress'
export { Sparkline } from './Sparkline'
export { BarChart } from './Chart'
export { StatTile } from './StatTile'
export { Modal, Sheet, Drawer } from './Overlay'
export { ToastProvider } from './Toast'
export { Field, Input, Textarea, Select, Toggle, Stepper } from './Forms'
export { Tabs } from './Tabs'
export { DataTable } from './Table'

// ─── Legacy style constants (deprecated) ────────────────────────────
export const inputCls =
  'w-full rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-800)] px-3 py-2.5 text-sm text-zinc-100 min-h-[44px]'

export const btnPrimary =
  'w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 min-h-[44px]'

export const btnGhost =
  'w-full rounded-lg border border-[var(--color-ink-600)] py-2.5 text-sm font-semibold text-zinc-200 hover:bg-white/5 min-h-[44px] transition-colors'
