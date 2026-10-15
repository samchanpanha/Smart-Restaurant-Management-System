// ─── Chrome-style workspace tab strip ───────────────────────────────
// Drag to reorder, middle-click to close, right-click for the tab menu,
// double-click to rename, pin for always-open screens. Each tab carries a
// live alert badge so the strip doubles as an at-a-glance ops board.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CRITICAL_ALERTS, NAV_SECTIONS, SCREEN_ICONS, screenForAlert, allowedScreens } from '../lib/constants'
import { translateScreenLabel, useI18n } from '../lib/i18n'
import { useAuth } from '../lib/auth'
import { LOCATIONS, useRestora } from '../lib/store'
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

function tabIcon(tab) {
  return tab.screen ? (SCREEN_ICONS[tab.screen] || 'dashboard') : 'plus'
}

export default function TabStrip({ fallbackScreen }) {
  const {
    role, alerts, tabs, activeTabId, activateTab, closeTab, openTab, openScreenInTab, reorderTab, renameTab,
    togglePinTab, duplicateTab, closeOtherTabs, closeRightTabs, reopenClosedTab, canReopenClosed,
  } = useRestora()
  const { lang, dict } = useI18n()
  const { screens } = useAuth()
  const allowed = allowedScreens(role, screens)
  // Every tab of the workspace is shown, whatever the current role: a role
  // switch is a change of who is driving, not a reason to hide the road.
  // The role only gates which screens can be *opened* from here.
  const visibleTabs = tabs
  const pinnedVisible = tabs.filter((tab) => tab.pinned).length

  const badges = useMemo(() => {
    const counts = {}
    for (const alert of alerts) {
      const target = screenForAlert(alert)
      counts[target] = counts[target] || { count: 0, critical: false }
      counts[target].count += 1
      if (CRITICAL_ALERTS.has(alert.type)) counts[target].critical = true
    }
    return counts
  }, [alerts])

  const listRef = useRef(null)
  const tabEls = useRef(new Map())
  const dragRef = useRef(null)
  const ignoreClickRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [menu, setMenu] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [fade, setFade] = useState({ left: false, right: false })

  function setIgnoreClick(tabId) {
    ignoreClickRef.current = tabId
    // Safety net: a dropped drag sometimes ends without a click at all.
    window.setTimeout(() => {
      if (ignoreClickRef.current === tabId) ignoreClickRef.current = null
    }, 250)
  }

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

  // A press only *may* become a drag: nothing is captured and nothing is
  // suppressed until the pointer really travels DRAG_THRESHOLD_PX. The old
  // code grabbed the pointer as soon as a tab moved 5px, which retargeted
  // the following click to the tab shell — the inner button never fired, so
  // activating a tab and opening another one looked dead.
  function onTabPointerDown(event, tab) {
    if (event.button !== 0 || renaming) return
    // The close button and the rename field own their presses.
    if (event.target.closest('button[aria-label^="Close"], input')) return
    dragRef.current = { id: tab.id, startX: event.clientX, live: false }
  }

  useEffect(() => {
    function onMove(event) {
      const held = dragRef.current
      if (!held) return
      const dx = event.clientX - held.startX
      if (!held.live) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
        held.live = true
        held.dx = dx
      }
      held.dx = dx
      held.gap = gapAtPointer(event.clientX, held.id)
      setDrag({ id: held.id, dx, over: held.gap })
    }

    function onRelease() {
      const held = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!held?.live) return
      // A live drag focuses the tab it moved, and the click that follows is
      // ignored: dropping a tab is not a request to open the one underneath.
      setIgnoreClick(held.id)
      activateTab(held.id)
      const from = visibleTabs.findIndex((tab) => tab.id === held.id)
      if (from < 0 || held.gap == null || held.gap === from || held.gap === from + 1) return
      reorderTab(held.id, visibleTabs[held.gap]?.id ?? null)
    }

    function cancelDrag(event) {
      if (event.key === 'Escape' && dragRef.current?.live) {
        dragRef.current = null
        setDrag(null)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('pointercancel', onRelease)
    window.addEventListener('keydown', cancelDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onRelease)
      window.removeEventListener('pointercancel', onRelease)
      window.removeEventListener('keydown', cancelDrag)
    }
  }, [activateTab, gapAtPointer, reorderTab, visibleTabs])

  // Window-level pointer tracking cannot tell which element the click will
  // land on, so the one click that follows a real drag is dropped here.
  function suppressed(tabId) {
    if (ignoreClickRef.current !== tabId) return false
    ignoreClickRef.current = null
    return true
  }

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
      // Chrome claims Ctrl+T / Ctrl+W / Ctrl+1…9 before the page sees them,
      // so the same actions are also on Alt chords that always arrive here.
      if (event.altKey && lower === 't' && !event.shiftKey) {
        event.preventDefault()
        openTab()
        return
      }
      if (event.altKey && lower === 'w' && !event.shiftKey) {
        event.preventDefault()
        closeTab(activeTabId, fallbackScreen)
        return
      }
      if (event.altKey && lower === '1' && event.shiftKey) {
        event.preventDefault()
        reopenClosedTab()
        return
      }
      if (!mod) return
      if (lower === 't') {
        event.preventDefault()
        if (event.shiftKey) reopenClosedTab()
        else openTab()
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
  }, [activeTabId, activateTab, closeTab, fallbackScreen, openTab, openScreenInTab, reopenClosedTab, visibleTabs])

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
          // Middle-clicking the empty part of the strip opens a tab, the way
          // Chrome does; middle-clicking a tab closes it (handled per tab).
          if (event.button === 1 && event.target === event.currentTarget) {
            event.preventDefault()
            openTab()
          }
        }}
      >
        {visibleTabs.map((tab, index) => {
          const selected = tab.id === activeTabId
          // A blank tab is waiting for a screen: never locked, never named
          // after a screen it does not hold yet.
          const locked = Boolean(tab.screen) && !allowed.includes(tab.screen)
          const badge = badges[tab.screen]
          const label = tabLabel(tab)
          const displayLabel = tab.title || (tab.screen ? translateScreenLabel(tab.screen, label, lang) : dict.newTab)
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
                    onClick={() => { if (!suppressed(tab.id)) activateTab(tab.id) }}
                    title={`${label} · ${locShort}${tab.pinned ? ' · pinned' : ''}${locked ? ` · not available to ${role}` : ''}`}
                    className={`flex h-full min-w-0 flex-1 items-center gap-2 rounded-tl-lg text-left text-xs font-semibold ${tab.pinned ? 'justify-center px-0' : 'px-3'}`}
                  >
                    <span className="relative shrink-0">
                      <Icon
                        name={locked ? 'lock' : tabIcon(tab)}
                        size={15}
                        className={locked ? 'text-amber-500' : selected ? 'text-orange-600' : 'text-zinc-400'}
                      />
                      <span aria-hidden="true" className={`absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full ${locDot(tab.locId)}`} />
                    </span>
                    {!tab.pinned && (
                      <span
                        data-i18n-tab={displayLabel}
                        className={`tab-i18n-label truncate ${locked ? 'text-amber-700/80' : ''}`}
                      >
                        <span className="sr-only">{label}</span>
                      </span>
                    )}
                    {badge && (
                      <span
                        title={`${badge.count} alert${badge.count > 1 ? 's' : ''} need attention`}
                        className={`tab-badge flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-3xs font-bold text-white ${badge.critical ? 'bg-red-500' : 'bg-amber-500'}`}
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

      <div className="flex shrink-0 items-end gap-0.5 pb-1 pl-1">
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
          title="New tab (Alt+T) — Chrome keeps Ctrl+T for its own tabs"
          onClick={() => openTab()}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-zinc-500 hover:bg-white hover:text-zinc-900"
        >
          <Icon name="plus" size={16} />
          <span className="hidden lg:inline">{dict.newTab}</span>
        </button>
      </div>

      {menu && (
        <div
          role="menu"
          className="tab-menu fixed z-50 w-[216px] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(22,30,40,.18)]"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem label={dict.newTab} srLabel="New tab" hint="⌥T" onPick={menuAction(() => openTab())} />
          {canReopenClosed && <MenuItem label={dict.reopenClosedTab} srLabel="Reopen closed tab" hint="⌘⇧T" onPick={menuAction(reopenClosedTab)} />}
          {menuTab && (
            <>
              <div className="my-1 h-px bg-zinc-100" />
              <MenuItem label={dict.duplicateTab} srLabel="Duplicate tab" onPick={menuAction(() => duplicateTab(menuTab.id))} />
              <MenuItem label={dict.renameTab} srLabel="Rename tab" onPick={menuAction(() => setRenaming({ tabId: menuTab.id, draft: tabLabel(menuTab) }))} />
              <MenuItem label={menuTab.pinned ? dict.unpinTab : dict.pinTab} srLabel={menuTab.pinned ? 'Unpin tab' : 'Pin tab'} onPick={menuAction(() => togglePinTab(menuTab.id))} />
              <div className="my-1 h-px bg-zinc-100" />
              <MenuItem label={dict.closeTab} srLabel="Close tab" hint="⌘W" onPick={menuAction(() => closeTab(menuTab.id, fallbackScreen))} />
              <MenuItem label={dict.closeOtherTabs} srLabel="Close other tabs" disabled={!closableOthers} onPick={menuAction(() => closeOtherTabs(menuTab.id))} />
              <MenuItem label={dict.closeRightTabs} srLabel="Close tabs to the right" disabled={!closableRight} onPick={menuAction(() => closeRightTabs(menuTab.id))} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, srLabel, hint, disabled, onPick }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onPick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-medium text-zinc-700 hover:bg-orange-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
    >
      <span>
        {label}
        {srLabel && srLabel !== label && <span className="sr-only"> {srLabel}</span>}
      </span>
      {hint && <span className="ml-4 text-3xs text-zinc-400">{hint}</span>}
    </button>
  )
}
