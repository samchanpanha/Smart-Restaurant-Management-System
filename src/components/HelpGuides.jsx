import { useMemo, useState } from 'react'
import { useRestora } from '../lib/store'
import { ROLE_NAV, NAV_SECTIONS } from '../lib/constants'
import { Card } from '../screens/Settings/primitives'

const SCREEN_LABELS = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, item.label])),
)

const COMMON_TASKS = [
  { id: 'take-order', title: 'Take an order', desc: 'Open table → add items → fire', screen: 'floor' },
  { id: 'bump-ticket', title: 'Bump ticket in Kitchen', desc: 'Mark items ready → serve/next course', screen: 'kitchen' },
  { id: '86-dish', title: '86 a dish', desc: 'Temporarily disable menu item', screen: 'menu' },
  { id: 'reorder-stock', title: 'Reorder stock', desc: 'Review low stock → create purchase', screen: 'purchases' },
  { id: 'close-check', title: 'Close check & pay', desc: 'Apply tip/split → mark paid', screen: 'orders' },
  { id: 'invite-staff', title: 'Invite staff', desc: 'Add user roles & permissions', screen: 'owners' },
  { id: 'ai-config', title: 'Connect AI assistant', desc: 'Provider/model/API key setup', screen: 'settings' },
]

export function HelpGuides() {
  const { role, askAi } = useRestora()
  const [query, setQuery] = useState('')
  const roleItems = ROLE_NAV[role] || ROLE_NAV.owner || []
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return COMMON_TASKS.filter(t => !q || t.title.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q))
  }, [query])

  return (
    <div className="space-y-4">
      <Card title="Guides & How-to" sub="Find answers and quick actions tailored to your role. Click “Ask AI” for step-by-step help.">
        <div className="mb-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guides (take order, bump, reorder...)"
            className="w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {filtered.map(task => (
            <button
              key={task.id}
              type="button"
              onClick={() => askAi(`How do I ${task.title.toLowerCase()}?`)}
              className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left hover:bg-zinc-50"
            >
              <div>
                <div className="text-sm font-semibold text-zinc-900">{task.title}</div>
                <p className="mt-0.5 text-xs text-zinc-500">{task.desc}</p>
              </div>
              <span className="rounded-lg border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">Ask AI</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Your role access" sub="Screens available for your current role.">
        <div className="flex flex-wrap gap-1.5">
          {roleItems.map((item) => {
            const label = SCREEN_LABELS[item] || item
            return (
              <span key={item} className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                {label}
              </span>
            )
          })}
        </div>
      </Card>

      <Card title="Quick prompts" sub="Click to ask the AI assistant directly.">
        <div className="flex flex-wrap gap-2">
          {[
            'Explain this shift summary',
            'What needs attention right now?',
            'Show me low stock items',
            'Suggest 2 dishes to promote',
            'Help me set up a new branch',
            'How to optimize food cost?',
          ].map(p => (
            <button
              key={p}
              type="button"
              onClick={() => askAi(p)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              {p}
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
