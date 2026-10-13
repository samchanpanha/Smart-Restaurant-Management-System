import assert from 'node:assert/strict'
import test from 'node:test'
import { activeWorkspaceTab, createWorkspace, workspaceReducer } from '../src/lib/workspace.js'

test('new workspace starts with one tab and navigation changes only the active tab', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'SET_SCREEN', screen: 'reports' })

  assert.equal(workspace.tabs.length, 2)
  assert.equal(activeWorkspaceTab(workspace).screen, 'reports')
  assert.equal(workspace.tabs.find((tab) => tab.id === 'tab-1').screen, 'floor')
  assert.equal(workspace.tabs.find((tab) => tab.id === 'tab-2').locId, 'downtown')
})

test('tabs keep their own location and activation restores the tab location', () => {
  let workspace = createWorkspace('dashboard', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'SET_LOCATION', locId: 'riverside' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'SET_LOCATION', locId: 'downtown' })
  workspace = workspaceReducer(workspace, { type: 'ACTIVATE_TAB', tabId: 'tab-1' })

  assert.equal(activeWorkspaceTab(workspace).locId, 'riverside')
  assert.equal(workspace.tabs.find((tab) => tab.id === 'tab-2').locId, 'downtown')
})

test('closing tabs selects a neighbor and closing the final tab opens Floor', () => {
  let workspace = createWorkspace('floor', 'riverside', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'tickets' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-3', screen: 'kitchen' })
  workspace = workspaceReducer(workspace, { type: 'CLOSE_TAB', tabId: 'tab-3', replacementId: 'tab-4' })

  assert.equal(workspace.activeTabId, 'tab-2')
  assert.equal(workspace.tabs.length, 2)

  workspace = workspaceReducer(workspace, { type: 'CLOSE_TAB', tabId: 'tab-1', replacementId: 'tab-5' })
  workspace = workspaceReducer(workspace, { type: 'CLOSE_TAB', tabId: 'tab-2', replacementId: 'tab-6' })

  assert.equal(workspace.tabs.length, 1)
  assert.equal(workspace.activeTabId, 'tab-6')
  assert.equal(activeWorkspaceTab(workspace).screen, 'floor')
  assert.equal(activeWorkspaceTab(workspace).locId, 'riverside')
})

test('closing the final tab uses a fallback screen available to the current role', () => {
  let workspace = createWorkspace('kitchen', 'downtown', 'tab-kitchen')
  workspace = workspaceReducer(workspace, {
    type: 'CLOSE_TAB',
    tabId: 'tab-kitchen',
    replacementId: 'tab-new',
    fallbackScreen: 'kitchen',
  })

  assert.equal(workspace.activeTabId, 'tab-new')
  assert.equal(activeWorkspaceTab(workspace).screen, 'kitchen')
})
