// ─── Settings & Documents ───────────────────────────────────────────
// Everything a store is configured with lives here: identity and logo,
// multi-currency, tax and service, the four document templates (invoice,
// receipt, kitchen ticket, shift report) with live print preview,
// numbering, stock policy, POS rules, and alert routing.
//
// Editing is draft-first and per-section: each section tracks the keys it
// touched, so it can save (or discard) exactly its own changes without
// publishing a half-finished edit made elsewhere. The save bar still
// applies the whole draft in one UPDATE_SETTINGS action, and every value
// is sanitized by the shared reducer.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import StatusPill from '../../components/StatusPill'
import { configurationAudit } from '../../lib/settings'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { useRestora } from '../../lib/store'
import { AiSection } from './sections/Ai'
import { AlertsSection } from './sections/Alerts'
import { BrandSection } from './sections/Brand'
import { BusinessSection } from './sections/Business'
import { BranchesSection } from './sections/Branches'
import { DashboardSection } from './sections/Dashboard'
import { DataSection } from './sections/Data'
import { DocumentsSection } from './sections/Documents'
import { FoodSection } from './sections/Food'
import { MoneySection } from './sections/Money'
import { PosSection } from './sections/Pos'
import { StockSection } from './sections/Stock'
import { SetupWizard } from './SetupWizard'

const SETUP_STEPS = ['business', 'money', 'documents', 'stock', 'food', 'pos']

const SECTIONS = [
  { id: 'business', label: 'Business profile', blurb: 'Name, address, logo, tax ID' },
  { id: 'branches', label: 'Branches', blurb: 'Manage multiple locations/branches' },
  { id: 'money', label: 'Currency & tax', blurb: 'Base currency, rates, tax, service' },
  { id: 'documents', label: 'Documents', blurb: 'Invoice, receipt, ticket, report' },
  { id: 'stock', label: 'Stock rules', blurb: 'Valuation, reorder, auto-86' },
  { id: 'food', label: 'Food & menu', blurb: 'Tags, allergens, courses, photos, service windows' },
  { id: 'pos', label: 'Service & POS', blurb: 'Tips, splits, printers, QR' },
  { id: 'dashboard', label: 'Dashboard', blurb: 'Hero, KPI cards, section toggles, targets' },
  { id: 'alerts', label: 'Alerts', blurb: 'What pings whom, and when' },
  { id: 'ai', label: 'AI assistant & Guides', blurb: 'Provider, model, API key, how-to guides' },
  { id: 'brand', label: 'App brand', blurb: 'Name, tagline, logo, icon' },
  { id: 'data', label: 'Data & backup', blurb: 'Registry, export, reset' },
]

const SECTION_ICON = {
  business: 'settings',
  branches: 'map',
  documents: 'doc',
  money: 'costing',
  stock: 'inventory',
  pos: 'pos',
  dashboard: 'dashboard',
  alerts: 'bell',
  ai: 'sparkles',
  brand: 'photo',
  food: 'dish',
  data: 'layers',
}

export default function SettingsScreen({ initialSection = 'business' }) {
  const { state, settings, dispatch, dispatchEverywhere, empire, locId, link, role, issueDocument, resync } = useRestora()
  const { user } = useAuth()
  // The deployment brand is super-admin territory: one brand for every
  // restaurant on this server, stored outside the tenant state.
  const visibleSections = useMemo(
    () => SECTIONS.filter((entry) => entry.id !== 'brand' || Boolean(user?.isSuperAdmin)),
    [user],
  )
  const { lang, dict } = useI18n()
  const st = dict.settings || {}
  // Cross-screen handoff: another screen (e.g. the Dashboard's
  // "Customize" button) asks for a specific section once.
  const [section, setSection] = useState(() => {
    try {
      const wanted = sessionStorage.getItem('restora-settings-section')
      if (wanted && SECTIONS.some((entry) => entry.id === wanted)) {
        sessionStorage.removeItem('restora-settings-section')
        return wanted
      }
    } catch { /* storage unavailable — default landing */ }
    return initialSection
  })
  const [draft, setDraft] = useState(() => settings)
  const [scopeAll, setScopeAll] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [touched, setTouched] = useState({})
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const audit = useMemo(() => configurationAudit(state), [state])
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings])

  const sectionLabels = {
    business: st.identityTab || 'Business profile',
    branches: 'Branches',
    money: st.currencyTab || 'Currency & tax',
    documents: st.documentsTab || 'Documents',
    stock: st.inventoryTab || 'Stock rules',
    food: st.foodTab || 'Food & menu',
    pos: st.posTab || 'Service & POS',
    dashboard: st.dashboardTab || 'Dashboard',
    alerts: st.notificationsTab || 'Alerts & notifications',
    ai: st.aiTab || 'AI assistant & Guides',
    brand: 'App brand',
    data: st.dataTab || 'Data & reset',
  }

  // Follow the store when someone else changes settings (another terminal),
  // unless this screen has unsaved edits.
  useEffect(() => {
    if (!dirty) setDraft(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  // A truly fresh store gets the wizard on first paint; a configured one
  // only opens it on request.
  useEffect(() => {
    if (audit.done <= 2) setWizardOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patchFor = useCallback((sectionId) => (partial) => {
    setDraft((current) => ({ ...current, ...partial }))
    setTouched((prev) => {
      const keys = new Set(prev[sectionId] || [])
      for (const key of Object.keys(partial)) keys.add(key)
      return { ...prev, [sectionId]: [...keys] }
    })
  }, [])

  const sectionTouched = (sectionId) => touched[sectionId] || []
  const sectionDirty = (sectionId) => sectionTouched(sectionId).some(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(settings[key]),
  )
  const dirtyCount = SECTIONS.filter((entry) => sectionDirty(entry.id)).length

  function dispatchSave(patch) {
    const action = { type: 'UPDATE_SETTINGS', patch, updatedBy: role }
    if (scopeAll) dispatchEverywhere(action)
    else dispatch(action)
    setSavedAt(Date.now())
  }

  function save() {
    dispatchSave(draft)
    setTouched({})
  }

  function discard() {
    setDraft(settings)
    setTouched({})
  }

  function saveSection(sectionId) {
    const keys = sectionTouched(sectionId)
    if (!keys.length) return
    dispatchSave(Object.fromEntries(keys.map((key) => [key, draft[key]])))
    setTouched((prev) => {
      const next = { ...prev }
      delete next[sectionId]
      return next
    })
  }

  function discardSection(sectionId) {
    const keys = sectionTouched(sectionId)
    if (!keys.length) return
    setDraft((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, settings[key]])) }))
    setTouched((prev) => {
      const next = { ...prev }
      delete next[sectionId]
      return next
    })
  }

  function renderSection(sectionId) {
    const patch = patchFor(sectionId)
    switch (sectionId) {
      case 'business':
        return <BusinessSection draft={draft} patch={patch} />
      case 'branches':
        return <BranchesSection />
      case 'money':
        return <MoneySection draft={draft} patch={patch} dispatch={dispatch} settings={settings} state={state} locationLabel={locId} />
      case 'documents':
        return <DocumentsSection draft={draft} patch={patch} state={state} dispatch={dispatch} locId={locId} issueDocument={issueDocument} />
      case 'stock':
        return <StockSection draft={draft} patch={patch} inventory={state.inventory} />
      case 'food':
        return <FoodSection draft={draft} patch={patch} />
      case 'pos':
        return <PosSection draft={draft} patch={patch} />
      case 'dashboard':
        return <DashboardSection draft={draft} patch={patch} />
      case 'alerts':
        return <AlertsSection draft={draft} patch={patch} />
      case 'ai':
        return <AiSection />
      case 'brand':
        return <BrandSection />
      case 'data':
        return <DataSection state={state} draft={draft} dispatch={dispatch} empire={empire} locId={locId} link={link} resync={resync} />
      default:
        return null
    }
  }

  const wizardSteps = SETUP_STEPS.map((id) => SECTIONS.find((entry) => entry.id === id))

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            {settings.logoUrl
              ? <img src={settings.logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" />
              : <Icon name="settings" size={22} className="text-orange-600" />}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-orange-600">
              <Icon name="settings" size={14} className="text-orange-600" />
              {st.kicker || 'Configuration Center'}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
              {settings.restaurantName || st.title || 'Settings & Documents'}
              {lang !== 'en' && <span className="sr-only"> Settings &amp; Documents</span>}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {settings.legalName || settings.restaurantName} · {locId}
              {link.status === 'live' ? ' · synced to every terminal' : ' · this terminal (offline)'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setWizardStep(0); setWizardOpen(true) }}
            data-testid="open-setup-wizard"
            className="min-h-10 rounded-xl border border-orange-200 bg-orange-50 px-4 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
          >
            {audit.ready ? 'Setup wizard' : 'Finish setup'}
          </button>
          <StatusPill tone={audit.ready ? 'ok' : audit.done / audit.total >= 0.7 ? 'warn' : 'bad'}>
            {audit.done}/{audit.total} checks ready
          </StatusPill>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600">
            <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} className="h-4 w-4 accent-orange-500" />
            {st.applyAllLocations || 'Apply to all stores'}
          </label>
          <button
            type="button"
            disabled={!dirty}
            onClick={save}
            className="min-h-10 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {dirty ? (st.saveSettings || 'Save changes') : savedAt ? (st.saved || 'Saved ✓') : 'No changes'}
          </button>
          {dirty && (
            <button type="button" onClick={discard} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50">
              {st.resetDefaults || 'Discard'}
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {audit.checks.slice(0, 5).map((check) => (
          <button
            key={check.id}
            type="button"
            onClick={() => setSection(SECTIONS.some((entry) => entry.id === check.section) ? check.section : 'business')}
            className={`rounded-2xl border p-3.5 text-left shadow-sm transition ${check.ok ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70 hover:border-amber-300'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${check.ok ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                {check.ok ? '✓' : '!'}
              </span>
              <span className="text-xs font-bold text-zinc-800">{check.label}</span>
            </div>
            {!check.ok && <p className="mt-1.5 text-[11px] leading-snug text-amber-800">{check.fix}</p>}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[248px_1fr]">
        <nav className="space-y-1 self-start rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm xl:sticky xl:top-4" aria-label="Settings sections">
          {visibleSections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              aria-current={section === entry.id}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${section === entry.id ? 'bg-orange-50 ring-1 ring-inset ring-orange-200' : 'hover:bg-zinc-50'}`}
            >
              <Icon name={SECTION_ICON[entry.id] || 'settings'} size={16} className={section === entry.id ? 'mt-0.5 text-orange-600' : 'mt-0.5 text-zinc-400'} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${section === entry.id ? 'text-orange-700' : 'text-zinc-700'}`}>
                  {sectionLabels[entry.id] || entry.label}
                  {lang !== 'en' && <span className="sr-only"> {entry.label}</span>}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{entry.blurb}</span>
              </span>
              {sectionDirty(entry.id) && (
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500"
                  data-testid={`section-dirty-${entry.id}`}
                  title="Unsaved edits in this section"
                />
              )}
            </button>
          ))}
          <div className="mt-1 border-t border-zinc-100 px-3 py-2.5 text-[11px] text-zinc-500">
            {dirtyCount > 0
              ? <span className="font-semibold text-amber-700">{dirtyCount} section{dirtyCount === 1 ? '' : 's'} with unsaved edits</span>
              : 'All changes saved'}
          </div>
        </nav>

        <div className="space-y-4">
          {renderSection(section)}

          {/* The AI and App brand sections save themselves against the
              server, so they do not use the draft-first section save bar. */}
          {section !== 'ai' && section !== 'branches' && section !== 'brand' && (
          <div className="sticky bottom-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
            <span className="text-xs text-zinc-500" data-testid="section-save-status">
              {sectionDirty(section) ? 'Unsaved edits in this section' : 'This section has no unsaved edits'}
            </span>
            <div className="flex items-center gap-2">
              {sectionDirty(section) && (
                <button
                  type="button"
                  onClick={() => discardSection(section)}
                  className="min-h-9 rounded-xl border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Discard
                </button>
              )}
              <button
                type="button"
                disabled={!sectionDirty(section)}
                onClick={() => saveSection(section)}
                data-testid={`save-section-${section}`}
                className="min-h-9 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save {sectionLabels[section] || 'section'}
              </button>
            </div>
          </div>
          )}
        </div>
      </div>

      <SetupWizard
        open={wizardOpen}
        step={wizardStep}
        steps={wizardSteps}
        labels={sectionLabels}
        audit={audit}
        ready={audit.ready}
        dirty={dirty}
        onStep={(next) => setWizardStep(Math.max(0, Math.min(wizardSteps.length - 1, next)))}
        onClose={() => setWizardOpen(false)}
        onFinish={() => { save(); setSection(wizardSteps[wizardStep].id); setWizardOpen(false) }}
        renderSection={renderSection}
      />
    </div>
  )
}
