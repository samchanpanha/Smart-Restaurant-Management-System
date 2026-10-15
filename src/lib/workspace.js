// Browser-style workspace tabs. Each tab owns its screen, location, and
// private view context (selected table/order/dish + scroll offset), while
// restaurant data remains shared through the existing provider.

export const MAX_TABS = 20
export const MAX_CLOSED = 10

function makeTab(id, screen, locId, extra = {}) {
  return {
    id,
    screen,
    locId,
    title: null,
    pinned: false,
    ctx: {},
    scroll: 0,
    ...extra,
  }
}

export function createWorkspace(screen, locId, tabId) {
  const tab = makeTab(tabId, screen, locId)
  return { tabs: [tab], activeTabId: tab.id, closed: [] }
}

// Tolerates workspaces persisted by older builds (no `closed` stack, no ctx).
export function normalizeWorkspace(workspace) {
  const tabs = Array.isArray(workspace?.tabs) && workspace.tabs.length
    ? workspace.tabs.map((tab) => makeTab(tab.id, tab.screen ?? null, tab.locId, tab))
    : null
  if (!tabs) return null
  const activeTabId = tabs.some((tab) => tab.id === workspace.activeTabId)
    ? workspace.activeTabId
    : tabs[0].id
  const closed = Array.isArray(workspace.closed) ? workspace.closed.slice(-MAX_CLOSED) : []
  return { tabs, activeTabId, closed }
}

export function activeWorkspaceTab(workspace) {
  return workspace.tabs.find((tab) => tab.id === workspace.activeTabId) || workspace.tabs[0]
}

export function tabIdForScreen(workspace, screen) {
  const tab = workspace.tabs.find((item) => item.screen === screen)
  return tab?.id || null
}

export function pinnedCount(workspace) {
  return workspace.tabs.filter((tab) => tab.pinned).length
}

function withClosed(workspace, removed, startIndex) {
  const entries = removed.map((tab, offset) => ({ tab, index: startIndex + offset }))
  return [...workspace.closed, ...entries].slice(-MAX_CLOSED)
}

export function workspaceReducer(workspace, action) {
  switch (action.type) {
    case 'OPEN_TAB': {
      if (workspace.tabs.length >= MAX_TABS) return workspace
      const current = activeWorkspaceTab(workspace)
      const pinned = pinnedCount(workspace)
      // A tab opened without a screen shows the new-tab picker instead of
      // silently cloning the screen that is already in front of the
      // operator — that is what made "+" feel like it did nothing.
      const tab = makeTab(action.id, action.screen ?? null, action.locId || current?.locId || 'downtown')
      const tabs = workspace.tabs.slice()
      // Background tabs (middle-click) land at the end and leave focus alone.
      if (action.activate === false) {
        tabs.push(tab)
        return { ...workspace, tabs }
      }
      const atIndex = workspace.tabs.findIndex((item) => item.id === workspace.activeTabId)
      const insertAt = Math.min(Math.max(atIndex + 1, pinned), workspace.tabs.length)
      tabs.splice(insertAt, 0, tab)
      return { ...workspace, tabs, activeTabId: tab.id }
    }

    case 'ACTIVATE_TAB':
      return workspace.tabs.some((tab) => tab.id === action.tabId)
        ? { ...workspace, activeTabId: action.tabId }
        : workspace

    case 'SET_SCREEN': {
      const current = activeWorkspaceTab(workspace)
      if (!current || current.screen === action.screen) return workspace
      return {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === current.id ? { ...tab, screen: action.screen } : tab,
        ),
      }
    }

    case 'SET_LOCATION': {
      const current = activeWorkspaceTab(workspace)
      if (!current || current.locId === action.locId) return workspace
      return {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === current.id ? { ...tab, locId: action.locId } : tab,
        ),
      }
    }

    case 'SET_TAB_CONTEXT': {
      if (!action.patch) return workspace
      return {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === action.tabId ? { ...tab, ctx: { ...tab.ctx, ...action.patch } } : tab,
        ),
      }
    }

    case 'SET_TAB_SCROLL':
      return {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === action.tabId ? { ...tab, scroll: action.scroll || 0 } : tab,
        ),
      }

    case 'RENAME_TAB':
      return {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === action.tabId ? { ...tab, title: (action.title || '').trim() || null } : tab,
        ),
      }

    case 'TOGGLE_PIN': {
      const from = workspace.tabs.findIndex((tab) => tab.id === action.tabId)
      if (from < 0) return workspace
      const wasPinned = workspace.tabs[from].pinned
      const tab = { ...workspace.tabs[from], pinned: !wasPinned }
      const without = workspace.tabs.filter((item) => item.id !== action.tabId)
      const pinned = without.filter((item) => item.pinned).length
      const to = wasPinned ? pinned : Math.min(pinned, without.length)
      const tabs = without.slice()
      tabs.splice(to, 0, tab)
      return { ...workspace, tabs }
    }

    case 'REORDER_TAB': {
      const from = workspace.tabs.findIndex((tab) => tab.id === action.tabId)
      if (from < 0) return workspace
      const tab = workspace.tabs[from]
      const without = workspace.tabs.filter((item) => item.id !== action.tabId)
      const pinned = without.filter((item) => item.pinned).length
      // Pinned tabs stay in the left block; a drag can never cross it.
      const [lo, hi] = tab.pinned ? [0, pinned] : [pinned, without.length]
      const anchor = action.beforeTabId == null
        ? -1
        : without.findIndex((item) => item.id === action.beforeTabId)
      if (action.beforeTabId != null && anchor < 0) return workspace
      const to = Math.min(Math.max(anchor < 0 ? without.length : anchor, lo), hi)
      const tabs = without.slice()
      tabs.splice(to, 0, tab)
      return { ...workspace, tabs }
    }

    case 'DUPLICATE_TAB': {
      if (workspace.tabs.length >= MAX_TABS) return workspace
      const from = workspace.tabs.findIndex((tab) => tab.id === action.tabId)
      if (from < 0) return workspace
      const source = workspace.tabs[from]
      const copy = makeTab(action.id, source.screen, source.locId, {
        title: source.title,
        ctx: { ...source.ctx },
        scroll: source.scroll,
      })
      const tabs = workspace.tabs.slice()
      tabs.splice(from + 1, 0, copy)
      return { ...workspace, tabs, activeTabId: copy.id }
    }

    case 'CLOSE_TAB': {
      const index = workspace.tabs.findIndex((tab) => tab.id === action.tabId)
      if (index < 0) return workspace
      const closed = withClosed(workspace, [workspace.tabs[index]], index)
      if (workspace.tabs.length === 1) {
        const fallback = makeTab(action.replacementId, action.fallbackScreen || 'floor', workspace.tabs[0].locId)
        return { tabs: [fallback], activeTabId: fallback.id, closed }
      }

      const tabs = workspace.tabs.filter((tab) => tab.id !== action.tabId)
      const activeTabId = workspace.activeTabId === action.tabId
        ? tabs[Math.min(index, tabs.length - 1)].id
        : workspace.activeTabId
      return { tabs, activeTabId, closed }
    }

    case 'CLOSE_OTHERS': {
      const keep = workspace.tabs.find((tab) => tab.id === action.tabId)
      if (!keep) return workspace
      const removed = workspace.tabs.filter((tab) => tab.id !== action.tabId && !tab.pinned)
      if (!removed.length) return workspace
      const firstRemoved = workspace.tabs.indexOf(removed[0])
      const ids = new Set(removed.map((tab) => tab.id))
      const tabs = workspace.tabs.filter((tab) => !ids.has(tab.id))
      // The kept tab is the only survivor besides pinned ones — if the
      // active tab was closed, focus has to land somewhere real.
      const activeTabId = tabs.some((tab) => tab.id === workspace.activeTabId)
        ? workspace.activeTabId
        : action.tabId
      return {
        ...workspace,
        tabs,
        activeTabId,
        closed: withClosed(workspace, removed, firstRemoved),
      }
    }

    case 'CLOSE_RIGHT': {
      const index = workspace.tabs.findIndex((tab) => tab.id === action.tabId)
      if (index < 0) return workspace
      const removed = workspace.tabs.slice(index + 1).filter((tab) => !tab.pinned)
      if (!removed.length) return workspace
      const ids = new Set(removed.map((tab) => tab.id))
      const tabs = workspace.tabs.filter((tab) => !ids.has(tab.id))
      const activeTabId = ids.has(workspace.activeTabId) ? action.tabId : workspace.activeTabId
      return { tabs, activeTabId, closed: withClosed(workspace, removed, index + 1) }
    }

    case 'REOPEN_TAB': {
      if (!workspace.closed.length) return workspace
      if (workspace.tabs.length >= MAX_TABS) return workspace
      const closed = workspace.closed.slice()
      const entry = closed.pop()
      const pinned = pinnedCount(workspace)
      const insertAt = entry.tab.pinned
        ? Math.min(entry.index, pinned)
        : Math.min(Math.max(entry.index, pinned), workspace.tabs.length)
      const tabs = workspace.tabs.slice()
      tabs.splice(insertAt, 0, entry.tab)
      return { tabs, activeTabId: entry.tab.id, closed }
    }

    default:
      return workspace
  }
}
