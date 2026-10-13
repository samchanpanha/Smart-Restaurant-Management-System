// ─── Restora application shell ──────────────────────────────────────
// Warm orange / white operations UI with a charcoal navigation rail.
// The Chrome-style tab strip lives in TabStrip.jsx above each screen.

import { useEffect, useMemo, useRef, useState } from 'react'
import StatusPill from './StatusPill'
import TabStrip from './TabStrip'
import { Icon } from './Icon'
import { NAV_SECTIONS, ROLES, ROLE_NAV, SCREEN_ICONS, screenForAlert } from '../lib/constants'
import { getAlerts, LOCATIONS, useNow, useRestora } from '../lib/store'

const NAV_LABELS = {
  dashboard: 'Dashboard',
  floor: 'Tables',
  tickets: 'Orders',
  kitchen: 'Kitchen',
  inventory: 'Inventory',
  menu: 'Menu & Recipes',
  catalog: 'Catalog',
  suppliers: 'Suppliers',
  purchases: 'Purchases',
  costing: 'Food Cost & Profit',
  reports: 'Reports',
  settings: 'Settings',
  system: 'System & Model',
}

// Sidebar order follows the nav sections; icons come from the shared map.
const NAV_ITEMS = NAV_SECTIONS
  .flatMap((section) => section.items.map((item) => item.id))
  .filter((id) => NAV_LABELS[id])
  .map((id) => ({ id, label: NAV_LABELS[id], icon: SCREEN_ICONS[id] || 'dashboard' }))

function displayOrderId(id) {
  const suffix = String(id || '').replace(/\D/g, '').slice(-4)
  return `#${suffix || String(id).slice(-4).toUpperCase()}`
}

export default function AppShell({ children }) {
  const {
    state, dispatch, role, setRole, screen, setScreen, link, resync, notice, locId, setLocId,
    tabs, activeTabId, saveTabScroll, setSelectedTableId, setSelectedDishId, setSelectedOrderId,
  } = useRestora()
  const now = useNow(30000)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const allowed = ROLE_NAV[role] || ROLE_NAV.owner
  const fallbackScreen = allowed.includes('floor') ? 'floor' : allowed[0]
  const alerts = useMemo(() => getAlerts(state), [state])
  const location = LOCATIONS.find((item) => item.id === locId) || LOCATIONS[0]
  const displayName = role === 'owner' ? 'Maya Chen' : ROLES[role]?.name || 'Restaurant team'
  const roleTitle = role === 'owner' ? 'Restaurant Manager' : ROLES[role]?.label?.split('·')[1]?.trim() || 'Team member'
  const dateLabel = new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const timeLabel = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    const results = []
    for (const order of state.orders) {
      const table = state.tables.find((item) => item.id === order.tableId)
      const label = `Order ${displayOrderId(order.id)}`
      if (`${label} ${table?.name || ''} ${order.status} ${order.type}`.toLowerCase().includes(query)) {
        results.push({ id: `order-${order.id}`, title: label, detail: `${table?.name || order.type} · ${order.status}`, screen: 'tickets', tableId: order.tableId, orderId: order.id })
      }
    }
    for (const table of state.tables) {
      if (`${table.name} ${table.zone} ${table.status}`.toLowerCase().includes(query)) {
        results.push({ id: `table-${table.id}`, title: table.name, detail: `${table.zone} · ${table.status}`, screen: 'floor', tableId: table.id })
      }
    }
    for (const dish of state.menu) {
      if (`${dish.name} ${dish.category}`.toLowerCase().includes(query)) {
        results.push({ id: `menu-${dish.id}`, title: dish.name, detail: `${dish.category} · Menu item`, screen: 'menu', dishId: dish.id })
      }
    }
    return results.filter((result) => allowed.includes(result.screen)).slice(0, 7)
  }, [allowed, search, state.menu, state.orders, state.tables])

  useEffect(() => {
    function closeMenusOnOutsideClick(event) {
      if (!event.target.closest('.global-search')) setSearchOpen(false)
      if (!event.target.closest('.global-actions')) { setNoticeOpen(false); setProfileOpen(false) }
      if (!event.target.closest('.app-sidebar')) setLocationOpen(false)
    }
    document.addEventListener('pointerdown', closeMenusOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsideClick)
  }, [])

  // Each tab keeps its own scroll offset, like a browser tab does.
  const panelRef = useRef(null)
  const prevTabRef = useRef(activeTabId)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const previous = prevTabRef.current
    if (previous && previous !== activeTabId) saveTabScroll(previous, panel.scrollTop)
    prevTabRef.current = activeTabId
    const target = tabsRef.current.find((tab) => tab.id === activeTabId)?.scroll || 0
    const frame = requestAnimationFrame(() => { panel.scrollTop = target })
    return () => cancelAnimationFrame(frame)
  }, [activeTabId, saveTabScroll])

  function selectSearchResult(result) {
    if (result.orderId) { setSelectedTableId(null); setSelectedOrderId(result.orderId) }
    else if (result.tableId) setSelectedTableId(result.tableId)
    if (result.dishId) setSelectedDishId(result.dishId)
    setScreen(result.screen)
    setSearch('')
    setSearchOpen(false)
  }

  // Switching role never rewrites the workspace: each tab keeps the screen
  // it was opened with, and the router locks the ones this role cannot see.
  function changeRole(nextRole) {
    setRole(nextRole)
    setProfileOpen(false)
  }

  const linkPill = link.status === 'live'
    ? { tone: 'ok', label: 'Live · server' }
    : link.status === 'offline'
      ? { tone: 'warn', label: 'Offline · this terminal' }
      : { tone: 'muted', label: 'Local demo' }

  return (
    <div className="restora-theme flex h-screen min-h-screen overflow-hidden bg-[var(--color-ink-950)] text-zinc-100">
      <aside className="app-sidebar flex w-[248px] shrink-0 flex-col border-r border-[var(--color-ink-700)] bg-[var(--color-ink-900)] text-zinc-100">
        <div className="border-b border-[var(--color-ink-700)] px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20">
              <svg aria-hidden="true" width="29" height="29" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 19c-2.2-.4-3.5-2-3.5-4.2 0-2.5 1.8-4.4 4.1-4.7A8.8 8.8 0 0 1 16 4a8.8 8.8 0 0 1 8.4 6.1c2.3.3 4.1 2.2 4.1 4.7 0 2.2-1.3 3.8-3.5 4.2v4.5H7V19Z" />
                <path d="M10 16.5c1.4 1.3 3.4 2 6 2s4.6-.7 6-2M12 24v4m8-4v4" />
                <path d="M11 11c.3-1.7 1.3-2.8 2.8-3.4M18.5 8.2c1 .6 1.7 1.5 2 2.8" />
              </svg>
            </div>
            <div className="app-sidebar-copy min-w-0">
              <div className="text-[23px] font-bold leading-none tracking-tight">Restora</div>
              <div className="mt-1 text-[10px] tracking-wide text-zinc-500">Manage · Serve · Grow</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Main navigation">
          <div className="space-y-1">
            {NAV_ITEMS.filter((item) => allowed.includes(item.id)).map((item) => {
              const active = screen === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScreen(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm transition-colors ${
                    active
                      ? 'bg-amber-500 font-semibold text-white shadow-[0_6px_18px_rgba(243,106,33,.22)]'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-zinc-100'
                  }`}
                >
                  <Icon name={item.icon} size={19} className={active ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'} />
                  <span className="app-sidebar-label min-w-0 flex-1 truncate">{item.label}</span>
                  {item.id === 'tickets' && alerts.some((alert) => alert.type === 'bill_request') && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">
                      {alerts.filter((alert) => alert.type === 'bill_request').length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="mt-auto border-t border-[var(--color-ink-700)] p-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setLocationOpen((open) => !open)}
              aria-expanded={locationOpen}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left hover:bg-white/5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                <Icon name="tables" size={18} />
              </span>
              <span className="app-sidebar-branch min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-zinc-100">{state.settings.restaurantName || 'The Olive Restaurant'}</span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">{location.short} · Branch</span>
              </span>
              <Icon name="chevron" size={16} className={`text-zinc-500 transition-transform ${locationOpen ? 'rotate-180' : ''}`} />
            </button>
            {locationOpen && (
              <div className="absolute bottom-full left-0 z-40 mb-2 w-full rounded-xl border border-[var(--color-ink-600)] bg-[var(--color-ink-850)] p-1.5 shadow-2xl">
                {LOCATIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setLocId(item.id); setLocationOpen(false) }}
                    className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-sm ${locId === item.id ? 'bg-amber-500/15 font-semibold text-amber-300' : 'text-zinc-300 hover:bg-white/5'}`}
                  >
                    {item.short}
                    {locId === item.id && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 px-2.5 pb-1">
            <StatusPill tone={linkPill.tone} size="sm">{linkPill.label}</StatusPill>
            {link.mode === 'server' && (
              <button type="button" onClick={() => resync()} className="text-[11px] text-zinc-500 hover:text-zinc-200" title="Reload authoritative snapshot">
                Resync
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Reset demo data to the Friday-night seed on ${link.mode === 'server' ? 'ALL terminals' : 'this terminal'}?`)) {
                dispatch({ type: 'RESET_ALL' })
              }
            }}
            className="mt-2 w-full rounded-lg px-2.5 py-2 text-left text-[11px] text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            Reset demo data
          </button>
        </div>
      </aside>

      <main className="flex h-screen min-h-0 min-w-0 flex-1 flex-col">
        <header className="app-topbar relative z-30 flex items-center justify-between gap-5 px-6 py-3">
          <div className="global-search relative w-full max-w-[540px]">
            <div className={`flex h-10 items-center gap-3 rounded-xl border bg-[#f7f7f8] px-3.5 transition-all ${searchOpen ? 'border-orange-300 ring-2 ring-orange-100' : 'border-transparent'}`}>
              <Icon name="search" size={18} className="shrink-0 text-zinc-500" />
              <input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setSearchOpen(true) }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { setSearch(''); setSearchOpen(false) }
                  if (event.key === 'Enter' && searchResults[0]) selectSearchResult(searchResults[0])
                }}
                placeholder="Search orders, tables, menu..."
                aria-label="Search orders, tables, and menu"
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:ring-0"
              />
              {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="text-zinc-400 hover:text-zinc-700">×</button>}
            </div>
            {searchOpen && search.trim() && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(22,30,40,.16)]">
                {searchResults.length ? searchResults.map((result) => (
                  <button key={result.id} type="button" onClick={() => selectSearchResult(result)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-orange-50">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-600"><Icon name={result.screen === 'floor' ? 'tables' : result.screen === 'menu' ? 'menu' : 'orders'} size={16} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-zinc-800">{result.title}</span><span className="block truncate text-xs text-zinc-500">{result.detail}</span></span>
                    <span className="text-xs text-zinc-400">Open</span>
                  </button>
                )) : <div className="px-3 py-4 text-sm text-zinc-500">No matching orders, tables, or menu items.</div>}
              </div>
            )}
          </div>

          <div className="global-actions flex shrink-0 items-center gap-3 sm:gap-5">
            <div className="relative">
              <button type="button" onClick={() => { setNoticeOpen((open) => !open); setProfileOpen(false) }} aria-label={`Notifications, ${alerts.length} alerts`} aria-expanded={noticeOpen} className="relative flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100">
                <Icon name="bell" size={20} />
                {alerts.length > 0 && <span className="absolute right-1 top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{Math.min(9, alerts.length)}</span>}
              </button>
              {noticeOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-[min(360px,90vw)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_18px_45px_rgba(22,30,40,.16)]">
                  <div className="flex items-center justify-between px-1 pb-2"><strong className="text-sm text-zinc-900">Notifications</strong><span className="text-xs text-zinc-500">{alerts.length} active</span></div>
                  <div className="max-h-80 space-y-1 overflow-y-auto">
                    {alerts.slice(0, 6).map((alert) => <button key={alert.key} type="button" onClick={() => { setScreen(screenForAlert(alert)); setNoticeOpen(false) }} className="block w-full rounded-xl p-2.5 text-left hover:bg-orange-50"><span className="block text-sm font-semibold text-zinc-800">{alert.label}</span><span className="mt-0.5 block text-xs text-zinc-500">{alert.detail}</span></button>)}
                    {!alerts.length && <div className="px-2 py-5 text-center text-sm text-zinc-500">All quiet — you are up to date.</div>}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden text-right leading-tight md:block">
              <div className="text-xs font-semibold text-zinc-700">{dateLabel}</div>
              <div className="mt-1 text-[11px] text-zinc-500">{timeLabel}</div>
            </div>
            <div className="hidden h-8 w-px bg-zinc-200 md:block" />
            <div className="relative">
              <button type="button" onClick={() => { setProfileOpen((open) => !open); setNoticeOpen(false) }} aria-expanded={profileOpen} className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-1.5 text-left hover:bg-zinc-50">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-orange-200 to-orange-400 text-sm font-bold text-orange-900 ring-2 ring-white">{displayName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
                <span className="hidden min-w-[112px] sm:block"><span className="block text-xs font-bold text-zinc-800">{displayName}</span><span className="mt-0.5 block text-[10px] text-zinc-500">{roleTitle}</span></span>
                <Icon name="chevron" size={15} className={`text-zinc-500 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_18px_45px_rgba(22,30,40,.16)]">
                  <div className="border-b border-zinc-100 px-2 pb-3"><div className="text-sm font-bold text-zinc-800">{displayName}</div><div className="mt-0.5 text-xs text-zinc-500">{roleTitle} · {location.short}</div></div>
                  <label className="mt-3 block px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500" htmlFor="role">Demo role</label>
                  <select id="role" value={role} onChange={(event) => changeRole(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800">
                    {Object.entries(ROLES).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
                  </select>
                  <button type="button" onClick={() => { setProfileOpen(false); if (window.confirm(`Reset demo data to the Friday-night seed on ${link.mode === 'server' ? 'ALL terminals' : 'this terminal'}?`)) dispatch({ type: 'RESET_ALL' }) }} className="mt-2 w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Reset demo data</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <TabStrip fallbackScreen={fallbackScreen} />

        <div ref={panelRef} id="workspace-panel" role="tabpanel" aria-labelledby={`workspace-tab-${activeTabId}`} className="app-workspace min-h-0 flex-1 overflow-y-auto">
          <div className="app-page">
            {notice && <div className="animate-status-in mb-4 rounded-xl bg-sky-500/10 px-4 py-2.5 text-sm text-sky-800 ring-1 ring-inset ring-sky-500/30" role="status">{notice}</div>}
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
