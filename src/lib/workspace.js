// Browser-style workspace tabs. Each tab owns its screen and location,
// while restaurant data remains shared through the existing provider.

export function createWorkspace(screen, locId, tabId) {
  const tab = { id: tabId, screen, locId }
  return { tabs: [tab], activeTabId: tab.id }
}

export function activeWorkspaceTab(workspace) {
  return workspace.tabs.find((tab) => tab.id === workspace.activeTabId) || workspace.tabs[0]
}

export function workspaceReducer(workspace, action) {
  switch (action.type) {
    case 'OPEN_TAB': {
      const current = activeWorkspaceTab(workspace)
      const tab = {
        id: action.id,
        screen: action.screen || 'floor',
        locId: action.locId || current?.locId || 'downtown',
      }
      return { tabs: [...workspace.tabs, tab], activeTabId: tab.id }
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

    case 'CLOSE_TAB': {
      const index = workspace.tabs.findIndex((tab) => tab.id === action.tabId)
      if (index < 0) return workspace
      if (workspace.tabs.length === 1) {
        const fallback = {
          id: action.replacementId,
          screen: action.fallbackScreen || 'floor',
          locId: workspace.tabs[0].locId,
        }
        return { tabs: [fallback], activeTabId: fallback.id }
      }

      const tabs = workspace.tabs.filter((tab) => tab.id !== action.tabId)
      const activeTabId = workspace.activeTabId === action.tabId
        ? tabs[Math.min(index, tabs.length - 1)].id
        : workspace.activeTabId
      return { tabs, activeTabId }
    }

    default:
      return workspace
  }
}
