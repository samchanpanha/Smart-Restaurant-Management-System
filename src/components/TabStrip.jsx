// ─── Chrome-style workspace tab strip ───────────────────────────────
// Drag to reorder, middle-click to close, right-click for the tab menu,
// double-click to rename, pin for always-open screens. Each tab carries a
// live alert badge so the strip doubles as an at-a-glance ops board.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CRITICAL_ALERTS, NAV_SECTIONS, ROLE_NAV, SCREEN_ICONS, screenForAlert } from '../lib/constants'
import { LOCATIONS, getAlerts, useRestora } from '../lib/store'
import { Icon } from './Icon'

const TAB_LABELS = Object.fromEntries(NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.id, i.label])))
const LOC_DOTS = ['bg-orange-500', 'bg-teal-500', 'bg-violet-500', 'bg-sky-500']
const DRAG_THRESHOLD_PX = 5

function locDot(locId) {
  const index = LOCATIONS.findIndex((item) => item.id === locId)
  return LOC_DOTS[index < 0 ? 0 : index % LOC_DOTS.length]
}

function tabLabel(tab) {
  return tab.title || TAB_LABELS[tab.screen] || 'New tab'
}

export default function TabStrip({ fallbackScreen }) {
  const {
    role, state, tabs, activeTabId, activateTab, closeTab, openTab, reorderTab, renameTab,
    togglePinTab, duplicateTab, closeOtherTabs, closeRightTabs, reopenClosedTab, canReopenClosed,
  } = useRestora()
  const allowed = ROLE_NAV[role] || ROLE_NAV.owner
  // Every tab of the workspace is shown, whatever the current role: a role
  // switch is a change of who is driving, not a reason to hide the road.
  // The role only gates which screens can be *opened* from here.
  const visibleTabs = tabs
  const newTabScreen = allowed[0] || 'floor'
  const pinnedVisible = tabs.filter((tab) => tab.pinned).length

  const badges = useMemo(() => {
    const counts = {}
    for (const alert of getAlerts(state)) {
      const target = screenForAlert(alert)
      counts[target] = counts[target] || { count: 0, critical: false }
      counts[target].count += 1
      if (CRITICAL_ALERTS.has(alert.type)) counts[target].critical = true
    }
    return counts
  }, [state])

  const listRef = useRef(null)
  const tabEls = useRef(new Map())
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [menu, setMenu] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [fade, setFade] = useState({ left: false, right: false })

  // ── drag to reorder ───────────────────────────────────────────────
  function gapAtPointer(clientX, dragId) {
    const list = listRef.current
    if (!list) return 0
    const listLeft = list.getBoundingClientRect().left
    let gap = visibleTabs.length
    for (let i = 0; i < visibleTabs.length; i += 1) {
      const el = tabEls.current.get(visibleTabs[i].id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientX - listLeft < rect.left - listLeft + rect.width / 2) { gap = i; break }
    }
    const dragged = visibleTabs.find((tab) => tab.id === dragId)
    const [lo, hi] = dragged?.pinned ? [0, pinnedVisible] : [pinnedVisible, visibleTabs.length]
    return Math.min(Math.max(gap, lo), hi)
  }

  function onTabPointerDown(event, tab) {
    if (event.button !== 0 || renaming) return
    dragRef.current = { id: tab.id, el: event.currentTarget, startX: event.clientX, live: false }
  }

  function onTabPointerMove(event) {
    const held = dragRef.current
    if (!held) return
    const dx = event.clientX - held.startX
    if (!held.live) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      held.live = true
      try {
        held.el.setPointerCapture(event.pointerId)
      } catch {
        /* pointer already released — drag continues without capture */
      }
    }
    held.dx = dx
    held.gap = gapAtPointer(event.clientX, held.id)
    setDrag({ id: held.id, dx, over: held.gap })
  }

  function onTabPointerUp() {
    const held = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!held?.live) return
    const from = visibleTabs.findIndex((tab) => tab.id === held.id)
    if (from < 0 || held.gap === from || held.gap === from + 1) return
    reorderTab(held.id, visibleTabs[held.gap]?.id ?? null)
  }

  useEffect(() => {
    function cancelDrag(event) {
      if (event.key === 'Escape' && dragRef.current?.live) {
        dragRef.current = null
        setDrag(null)
      }
    }
    window.addEventListener('keydown', cancelDrag)
    return () => window.removeEventListener('keydown', cancelDrag)
  }, [])

  // ── overflow: fades, wheel, scroll active into view ───────────────
  const updateFade = useMemo(() => () => {
    const list = listRef.current
    if (!list) return
    setFade({
      left: list.scrollLeft > 4,
      right: list.scrollLeft + list.clientWidth < list.scrollWidth - 4,
    })
  }, [])

  useEffect(() => {
    updateFade()
    const list = listRef.current
    if (!list) return undefined
    const observer = new ResizeObserver(updateFade)
    observer.observe(list)
    window.addEventListener('resize', updateFade)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateFade)
    }
  }, [updateFade, visibleTabs.length])

  useEffect(() => {
    const list = listRef.current
    const el = tabEls.current.get(activeTabId)
    if (!list || !el) return
    const viewRight = list.scrollLeft + list.clientWidth
    const elRight = el.offsetLeft + el.offsetWidth
    if (el.offsetLeft < list.scrollLeft) list.scrollTo({ left: Math.max(0, el.offsetLeft - 8), behavior: 'smooth' })
    else if (elRight > viewRight) list.scrollTo({ left: elRight - list.clientWidth + 8, behavior: 'smooth' })
  }, [activeTabId, visibleTabs.length])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const onWheel = (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      list.scrollLeft += event.deltaY
      event.preventDefault()
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => list.removeEventListener('wheel', onWheel)
  }, [])

  // ── keyboard shortcuts ────────────────────────────────────────────
  // Ctrl/Cmd+1…9 and Ctrl+Tab are claimed by the browser itself and never
  // reach the page, so the workspace also listens on chords browsers leave
  // alone: Alt+1…9 to jump and Ctrl/⌘+PageUp/PageDown to cycle.
  useEffect(() => {
    function handleShortcut(event) {
      const target = event.target
      if (target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      const mod = event.ctrlKey || event.metaKey
      const list = visibleTabs
      const jump = (digit) => {
        const index = digit === '9' ? list.length - 1 : Number(digit) - 1
        if (list[index]) activateTab(list[index].id)
      }
      const cycle = (step) => {
        const index = list.findIndex((tab) => tab.id === activeTabId)
        const next = list[((index < 0 ? 0 : index) + step + list.length) % list.length]
        if (next) activateTab(next.id)
      }
      const key = event.key
      const lower = key.toLowerCase()

      if (event.altKey && !mod && /^[1-9]$/.test(key)) {
        event.preventDefault()
        jump(key)
        return
      }
      if (mod && /^[1-9]$/.test(key)) {
        event.preventDefault()
        jump(key)
        return
      }
      if (mod && (key === 'PageDown' || key === 'PageUp')) {
        event.preventDefault()
        const forward = key === 'PageDown'
        cycle((event.shiftKey ? !forward : forward) ? 1 : -1)
        return
      }
      if (!mod) return
      if (lower === 't') {
        event.preventDefault()
        if (event.shiftKey) reopenClosedTab()
        else openTab(newTabScreen)
      } else if (lower === 'w' && !event.shiftKey) {
        event.preventDefault()
        closeTab(activeTabId, fallbackScreen)
      } else if (key === 'Tab') {
        event.preventDefault()
        cycle(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [activeTabId, activateTab, closeTab, fallbackScreen, newTabScreen, openTab, reopenClosedTab, visibleTabs])

  // ── context menu ──────────────────────────────────────────────────
  useEffect(() => {
    if (!menu) return undefined
    function dismiss(event) {
      if (!event.target.closest('.tab-menu')) setMenu(null)
    }
    function dismissOnKey(event) {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismissOnKey)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismissOnKey)
      window.removeEventListener('resize', dismiss)
    }
  }, [menu])

  function openMenu(event, tabId) {
    event.preventDefault()
    const width = 216
    const height = tabId ? 268 : 92
    setMenu({
      tabId,
      x: Math.min(event.clientX, window.innerWidth - width - 8),
      y: Math.min(event.clientY, window.innerHeight - height - 8),
    })
  }

  function menuAction(run) {
    return () => { run(); setMenu(null) }
  }

  function commitRename() {
    if (!renaming) return
    renameTab(renaming.tabId, renaming.draft)
    setRenaming(null)
  }

  const menuTab = menu?.tabId ? tabs.find((tab) => tab.id === menu.tabId) : null
  const menuIndex = menuTab ? visibleTabs.findIndex((tab) => tab.id === menuTab.id) : -1
  const closableRight = menuIndex >= 0 ? visibleTabs.slice(menuIndex + 1).filter((tab) => !tab.pinned).length : 0
  const closableOthers = menuTab ? visibleTabs.filter((tab) => tab.id !== menuTab.id && !tab.pinned).length : 0

  return (
    <div className="app-tabs relative flex h-11 shrink-0 items-end border-b px-2 pt-1" onContextMenu={(event) => { if (event.target === event.currentTarget) openMenu(event, null) }}>
      {fade.left && <div aria-hidden="true" className="tab-fade pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-8" style={{ background: 'linear-gradient(to right, #eceef0, rgba(236,238,240,0))' }} />}
      {fade.right && <div aria-hidden="true" className="tab-fade pointer-events-none absolute bottom-0 right-12 top-0 z-10 w-8" style={{ background: 'linear-gradient(to left, #eceef0, rgba(236,238,240,0))' }} />}

      <div
        ref={listRef}
        className="tab-list relative flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overscroll-x-contain"
        role="tablist"
        aria-label="Workspace tabs"
        onScroll={updateFade}
        onContextMenu={(event) => { if (event.target === event.currentTarget) openMenu(event, null) }}
        onAuxClick={(event) => {
          if (event.button === 1 && event.target === event.currentTarget) {
            event.preventDefault()
            openTab(newTabScreen)
          }
        }}
      >
        {visibleTabs.map((tab, index) => {
          const selected = tab.id === activeTabId
          const locked = !allowed.includes(tab.screen)
          const badge = badges[tab.screen]
          const label = tabLabel(tab)
          const locShort = LOCATIONS.find((item) => item.id === tab.locId)?.short || tab.locId
          const isRenaming = renaming?.tabId === tab.id
          return (
            <Fragment key={tab.id}>
              {drag?.over === index && drag.id !== tab.id && <span aria-hidden="true" className="tab-drop" />}
              <div
                ref={(el) => {
                  if (el) tabEls.current.set(tab.id, el)
                  else tabEls.current.delete(tab.id)
                }}
                onPointerDown={(event) => onTabPointerDown(event, tab)}
                onPointerMove={onTabPointerMove}
                onPointerUp={onTabPointerUp}
                onPointerCancel={onTabPointerUp}
                onAuxClick={(event) => {
                  if (event.button === 1) { event.preventDefault(); closeTab(tab.id, fallbackScreen) }
                }}
                onDoubleClick={() => setRenaming({ tabId: tab.id, draft: label })}
                onContextMenu={(event) => openMenu(event, tab.id)}
                className={`restora-tab group relative flex h-9 shrink-0 select-none items-center rounded-t-lg border border-b-0 ${tab.pinned ? 'w-10 justify-center px-0' : 'min-w-32 max-w-56 px-0'} ${
                  selected
                    ? 'restora-tab-active border-[#dfe3e8] bg-[#f7f8fa] text-zinc-800'
                    : 'border-transparent text-zinc-500 hover:bg-white/70 hover:text-zinc-700'
                } ${drag?.id === tab.id ? 'restora-tab-dragging' : ''}`}
                style={drag?.id === tab.id ? { transform: `translateX(${drag.dx}px)` } : undefined}
              >
                {selected && <span aria-hidden="true" className="tab-accent" />}
                {isRenaming ? (
                  <input
                    autoFocus
                    defaultValue={label}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => setRenaming({ tabId: tab.id, draft: event.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename()
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                    aria-label="Tab name"
                    className="h-7 min-w-0 flex-1 rounded-md border border-orange-300 bg-white px-2 text-xs font-semibold text-zinc-800 outline-none ring-2 ring-orange-100"
                  />
                ) : (
                  <button
                    id={`workspace-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="workspace-panel"
                    onClick={() => activateTab(tab.id)}
                    title={`${label} · ${locShort}${tab.pinned ? ' · pinned' : ''}${locked ? ` · not available to ${role}` : ''}`}
                    className={`flex h-full min-w-0 flex-1 items-center gap-2 rounded-tl-lg text-left text-xs font-semibold ${tab.pinned ? 'justify-center px-0' : 'px-3'}`}
                  >
                    <span className="relative shrink-0">
                      <Icon
                        name={locked ? 'lock' : (SCREEN_ICONS[tab.screen] || 'dashboard')}
                        size={15}
                        className={locked ? 'text-amber-500' : selected ? 'text-orange-600' : 'text-zinc-400'}
                      />
                      <span aria-hidden="true" className={`absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full ${locDot(tab.locId)}`} />
                    </span>
                    {!tab.pinned && <span className={`truncate ${locked ? 'text-amber-700/80' : ''}`}>{label}</span>}
                    {badge && (
                      <span
                        title={`${badge.count} alert${badge.count > 1 ? 's' : ''} need attention`}
                        className={`tab-badge flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${badge.critical ? 'bg-red-500' : 'bg-amber-500'}`}
                      >
                        {tab.pinned ? '' : Math.min(9, badge.count)}
                      </span>
                    )}
                  </button>
                )}
                {!tab.pinned && !isRenaming && (
                  <button
                    type="button"
                    aria-label={`Close ${label} tab`}
                    title="Close tab (Ctrl/⌘+W)"
                    onClick={() => closeTab(tab.id, fallbackScreen)}
                    className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-sm leading-none text-zinc-400 hover:bg-zinc-300/70 hover:text-zinc-800"
                  >
                    ×
                  </button>
                )}
              </div>
            </Fragment>
          )
        })}
        {drag?.over === visibleTabs.length && <span aria-hidden="true" className="tab-drop" />}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pb-1 pl-1">
        {canReopenClosed && (
          <button
            type="button"
            aria-label="Reopen closed tab"
            title="Reopen closed tab (Ctrl/⌘+Shift+T)"
            onClick={reopenClosedTab}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-white hover:text-zinc-800"
          >
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 2.8-6.5L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
        <button
          type="button"
          aria-label="Open a new tab"
          title="New tab (Ctrl/⌘+T)"
          onClick={() => openTab(newTabScreen)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-white hover:text-zinc-900"
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      {menu && (
        <div
          role="menu"
          className="tab-menu fixed z-50 w-[216px] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(22,30,40,.18)]"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem label="New tab" hint="⌘T" onPick={menuAction(() => openTab(newTabScreen))} />
          {canReopenClosed && <MenuItem label="Reopen closed tab" hint="⌘⇧T" onPick={menuAction(reopenClosedTab)} />}
          {menuTab && (
            <>
              <div className="my-1 h-px bg-zinc-100" />
              <MenuItem label="Duplicate tab" onPick={menuAction(() => duplicateTab(menuTab.id))} />
              <MenuItem label="Rename tab" onPick={menuAction(() => setRenaming({ tabId: menuTab.id, draft: tabLabel(menuTab) }))} />
              <MenuItem label={menuTab.pinned ? 'Unpin tab' : 'Pin tab'} onPick={menuAction(() => togglePinTab(menuTab.id))} />
              <div className="my-1 h-px bg-zinc-100" />
              <MenuItem label="Close tab" hint="⌘W" onPick={menuAction(() => closeTab(menuTab.id, fallbackScreen))} />
              <MenuItem label="Close other tabs" disabled={!closableOthers} onPick={menuAction(() => closeOtherTabs(menuTab.id))} />
              <MenuItem label="Close tabs to the right" disabled={!closableRight} onPick={menuAction(() => closeRightTabs(menuTab.id))} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, hint, disabled, onPick }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onPick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-medium text-zinc-700 hover:bg-orange-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
    >
      {label}
      {hint && <span className="ml-4 text-[10px] text-zinc-400">{hint}</span>}
    </button>
  )
}
