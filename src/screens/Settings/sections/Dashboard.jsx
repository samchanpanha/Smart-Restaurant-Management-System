// ─── Settings → Dashboard ───────────────────────────────────────────
// Customizes what the shift-overview page shows: the hero banner (photo,
// greeting, subtitle), which KPI cards appear, which blocks of the
// dashboard render at all, and the target bands its statuses are read
// against. Everything defaults to the shipped layout — the blank state
// is the designed page, not an error.

import { Field, Toggle, Card, inputCls } from '../primitives'

const KPI_CARDS = [
  ['revenue', "Today's revenue"],
  ['covers', 'Covers'],
  ['avgCheck', 'Avg. check'],
  ['foodCost', 'Food cost · 7-day'],
  ['occupancy', 'Table occupancy'],
]

const MAIN_SECTIONS = [
  ['salesTrend', "Today's sales overview"],
  ['alertsRail', 'Insight rail (plain alerts)'],
  ['aiAlerts', 'AI alert explainer'],
  ['menuEngineering', 'Menu engineering'],
  ['aiMenu', 'AI menu advisor'],
  ['kitchenSla', 'Kitchen SLA'],
  ['floorSnapshot', 'Floor snapshot'],
  ['branchOverview', 'Branch overview (owner)'],
  ['quickOverview', 'Quick overview grid'],
]

const RAIL_SECTIONS = [
  ['shiftBriefing', 'Shift briefing'],
  ['quickActions', 'Quick actions'],
  ['aiForecast', 'AI prep forecast'],
  ['recentActivity', 'Recent activity'],
  ['shiftHealth', 'Shift health'],
]

export function DashboardSection({ draft, patch }) {
  // Older drafts predate the block; fall back to the shipped layout so
  // every control still has a value to edit.
  const dash = draft.dashboard || {
    heroEnabled: true,
    heroImage: '',
    showLivePill: true,
    showMetaLine: true,
    greetingName: '',
    subtitle: '',
    cards: {},
    sections: {},
  }
  const set = (key, value) => patch({ dashboard: { ...dash, [key]: value } })
  const setCard = (key, value) => patch({ dashboard: { ...dash, cards: { ...dash.cards, [key]: value } } })
  const setSection = (key, value) => patch({ dashboard: { ...dash, sections: { ...dash.sections, [key]: value } } })

  return (
    <div className="space-y-4">
      <Card title="Hero banner" sub="The photo and greeting at the top of the Dashboard page. Blank values keep the designed defaults.">
        <div className="grid gap-2 md:grid-cols-2">
          <Toggle
            label="Show hero banner"
            hint="Turn off for a tighter overview that starts at the KPI row."
            checked={dash.heroEnabled !== false}
            onChange={(value) => set('heroEnabled', value)}
          />
          <Toggle
            label="Show live-shift pill"
            hint="The '• LIVE SHIFT · <branch>' badge."
            checked={dash.showLivePill !== false}
            onChange={(value) => set('showLivePill', value)}
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Greeting name" hint="Shown after 'Good afternoon'. Leave blank to greet the signed-in role label.">
            <input
              value={dash.greetingName || ''}
              onChange={(e) => set('greetingName', e.target.value.slice(0, 40))}
              placeholder="Maya"
              className={inputCls}
              maxLength={40}
            />
          </Field>
          <Field label="Custom subtitle" hint="Blank = the default 'Here's what's happening…' line.">
            <input
              value={dash.subtitle || ''}
              onChange={(e) => set('subtitle', e.target.value)}
              placeholder="Here's what's happening at your restaurant today."
              className={inputCls}
              maxLength={160}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Background image URL" hint="https://, data:image, or /path — blank uses the built-in Restora photo.">
            <div className="flex gap-2">
              <input
                value={dash.heroImage || ''}
                onChange={(e) => set('heroImage', e.target.value)}
                placeholder="https://… or leave blank"
                className={inputCls}
                spellCheck={false}
              />
              {dash.heroImage && (
                <button
                  type="button"
                  onClick={() => set('heroImage', '')}
                  className="min-h-9 shrink-0 rounded-lg border border-[var(--color-ink-300)] px-3 text-xs font-semibold text-[var(--color-ink-700)] hover:bg-black/5"
                >
                  Reset
                </button>
              )}
            </div>
          </Field>
          <Toggle
            label="Show date & location line"
            hint="The 'Sat, October 17 … · Branch' footer of the banner."
            checked={dash.showMetaLine !== false}
            onChange={(value) => set('showMetaLine', value)}
          />
        </div>
      </Card>

      <Card title="KPI cards" sub="Every number in the top row can be hidden — the remaining cards re-flow to fill the row.">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {KPI_CARDS.map(([key, label]) => (
            <Toggle key={key} label={label} checked={dash.cards?.[key] !== false} onChange={(value) => setCard(key, value)} />
          ))}
        </div>
      </Card>

      <Card title="Dashboard sections" sub="Hide any block this branch doesn't use. Behaviour and permissions stay exactly as built — this only changes what renders.">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {MAIN_SECTIONS.map(([key, label]) => (
            <Toggle key={key} label={label} checked={dash.sections?.[key] !== false} onChange={(value) => setSection(key, value)} />
          ))}
        </div>
        <div className="mt-4 border-t border-black/5 pt-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-500)]">Side rail</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {RAIL_SECTIONS.map(([key, label]) => (
              <Toggle key={key} label={label} checked={dash.sections?.[key] !== false} onChange={(value) => setSection(key, value)} />
            ))}
          </div>
        </div>
      </Card>

      <Card title="Targets & bands" sub="The numbers the dashboard reads statuses against.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Food cost target %" hint="Over this 7-day food cost, the Food cost card flips to 'Review' (amber) and Shift health follows.">
            <input
              type="number"
              min="5"
              max="95"
              step="0.5"
              value={((Number(draft.foodCostCap) || 0.32) * 100).toFixed(1)}
              onChange={(e) => patch({ foodCostCap: Math.max(0.05, Math.min(0.95, Number(e.target.value) / 100)) })}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
      </Card>
    </div>
  )
}
