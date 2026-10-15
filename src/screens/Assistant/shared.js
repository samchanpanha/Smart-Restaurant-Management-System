// Copy + shape for the Ops Copilot screen. The English labels live here so
// the screen and the UI test read one source; every user-visible string is
// still routed through `dict.assistant` when a translation exists.

export const SUGGESTED_PROMPTS = [
  'What needs my attention right now?',
  'How is food cost trending this week?',
  'What should we reorder?',
  'Which dishes are losing money?',
  'What should we prep for tonight?',
]

// Insight kinds the rail can request. `id` is the server kind, `icon` is an
// <Icon> name, and `label` is the English fallback for the button.
export const INSIGHT_KINDS = [
  { id: 'alert', icon: 'bell', label: 'Explain tonight’s alerts' },
  { id: 'menu', icon: 'menu', label: 'Menu engineering ideas' },
  { id: 'reorder', icon: 'cart', label: 'Smart reorder' },
  { id: 'forecast', icon: 'clock', label: 'Service forecast' },
]

// The prebuilt answer bodies the server returns for each insight kind.
export const INSIGHT_TITLES = {
  alert: 'Alert explainer',
  menu: 'Menu engineering',
  reorder: 'Reorder suggestions',
  forecast: 'Prep forecast',
  briefing: 'Shift briefing',
}
