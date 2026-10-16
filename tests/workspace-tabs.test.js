import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_TABS, activeWorkspaceTab, createWorkspace, normalizeWorkspace, workspaceReducer,
} from '../src/lib/workspace.js'

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

test('remapping a removed branch rebinds every tab parked on it', () => {
  let workspace = createWorkspace('floor', 'airport', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'SET_TAB_CONTEXT', tabId: 'tab-1', patch: { tableId: 't4' } })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'SET_LOCATION', locId: 'downtown' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-3', screen: 'kitchen' })
  workspace = workspaceReducer(workspace, { type: 'SET_LOCATION', locId: 'riverside' })
  workspace = workspaceReducer(workspace, { type: 'ACTIVATE_TAB', tabId: 'tab-1' })

  const remapped = workspaceReducer(workspace, { type: 'REMAP_LOCATION', from: 'airport', to: 'downtown' })
  assert.equal(remapped.activeTabId, 'tab-1', 'focus stays on the same tab')
  assert.deepEqual(remapped.tabs.map((tab) => tab.locId), ['downtown', 'downtown', 'riverside'])
  assert.equal(remapped.tabs[0].ctx.tableId, 't4', 'the tab keeps its view context')
  assert.equal(remapped.tabs[0].id, 'tab-1')

  // No-ops keep the exact same object: equal ids, a missing branch, or an id
  // no tab uses means there is nothing to remap.
  assert.equal(workspaceReducer(remapped, { type: 'REMAP_LOCATION', from: 'downtown', to: 'downtown' }), remapped)
  assert.equal(workspaceReducer(remapped, { type: 'REMAP_LOCATION', from: 'closed', to: 'riverside' }), remapped)
  assert.equal(workspaceReducer(remapped, { type: 'REMAP_LOCATION', to: 'riverside' }), remapped)
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

test('new tabs open next to the active tab, not at the end', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'ACTIVATE_TAB', tabId: 'tab-1' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-3', screen: 'reports' })

  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-1', 'tab-3', 'tab-2'])
  assert.equal(workspace.activeTabId, 'tab-3')
})

test('tab limit stops new tabs at MAX_TABS', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  for (let i = 2; i <= MAX_TABS + 3; i += 1) {
    workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: `tab-${i}`, screen: 'menu' })
  }

  assert.equal(workspace.tabs.length, MAX_TABS)
})

test('reorder moves a tab before an anchor and clamps to the unpinned block', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-3', screen: 'reports' })
  workspace = workspaceReducer(workspace, { type: 'TOGGLE_PIN', tabId: 'tab-1' })

  // Drag the last tab to the front: it may not enter the pinned block.
  workspace = workspaceReducer(workspace, { type: 'REORDER_TAB', tabId: 'tab-3', beforeTabId: 'tab-1' })
  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-1', 'tab-3', 'tab-2'])

  workspace = workspaceReducer(workspace, { type: 'REORDER_TAB', tabId: 'tab-3', beforeTabId: null })
  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-1', 'tab-2', 'tab-3'])
})

test('pinning moves a tab into the left block and unpinning releases it', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-3', screen: 'reports' })
  workspace = workspaceReducer(workspace, { type: 'TOGGLE_PIN', tabId: 'tab-3' })

  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-3', 'tab-1', 'tab-2'])
  assert.equal(workspace.tabs[0].pinned, true)

  workspace = workspaceReducer(workspace, { type: 'TOGGLE_PIN', tabId: 'tab-3' })
  // Unpinned tabs re-enter at the head of the unpinned block, Chrome-style.
  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-3', 'tab-1', 'tab-2'])
  assert.equal(workspace.tabs[0].pinned, false)
})

test('reopen restores the most recently closed tab at its old position', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-3', screen: 'reports' })
  workspace = workspaceReducer(workspace, { type: 'CLOSE_TAB', tabId: 'tab-2', replacementId: 'tab-x' })

  assert.equal(workspace.closed.length, 1)
  workspace = workspaceReducer(workspace, { type: 'REOPEN_TAB' })

  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-1', 'tab-2', 'tab-3'])
  assert.equal(workspace.activeTabId, 'tab-2')
  assert.equal(workspace.closed.length, 0)
})

test('close others keeps pinned tabs and the target, close right keeps the left side', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'menu' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-3', screen: 'reports' })
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-4', screen: 'kitchen' })
  workspace = workspaceReducer(workspace, { type: 'TOGGLE_PIN', tabId: 'tab-4' })

  workspace = workspaceReducer(workspace, { type: 'CLOSE_RIGHT', tabId: 'tab-1' })
  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-4', 'tab-1'])

  workspace = workspaceReducer(workspace, { type: 'REOPEN_TAB' })
  workspace = workspaceReducer(workspace, { type: 'REOPEN_TAB' })
  workspace = workspaceReducer(workspace, { type: 'CLOSE_OTHERS', tabId: 'tab-2' })
  assert.deepEqual(workspace.tabs.map((tab) => tab.id), ['tab-4', 'tab-2'])
})

test('duplicate copies screen, location, and view context', () => {
  let workspace = createWorkspace('floor', 'riverside', 'tab-1')
  workspace = workspaceReducer(workspace, {
    type: 'SET_TAB_CONTEXT',
    tabId: 'tab-1',
    patch: { tableId: 't7' },
  })
  workspace = workspaceReducer(workspace, { type: 'DUPLICATE_TAB', tabId: 'tab-1', id: 'tab-2' })

  assert.equal(workspace.tabs.length, 2)
  assert.equal(workspace.activeTabId, 'tab-2')
  assert.equal(workspace.tabs[1].locId, 'riverside')
  assert.equal(workspace.tabs[1].ctx.tableId, 't7')
})

test('view context and scroll offset stay on their own tab', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'OPEN_TAB', id: 'tab-2', screen: 'tickets' })
  workspace = workspaceReducer(workspace, { type: 'SET_TAB_CONTEXT', tabId: 'tab-2', patch: { orderId: 'o9' } })
  workspace = workspaceReducer(workspace, { type: 'SET_TAB_SCROLL', tabId: 'tab-2', scroll: 480 })
  workspace = workspaceReducer(workspace, { type: 'ACTIVATE_TAB', tabId: 'tab-1' })

  assert.equal(activeWorkspaceTab(workspace).ctx.orderId, undefined)
  assert.equal(activeWorkspaceTab(workspace).scroll, 0)
  assert.equal(workspace.tabs[1].ctx.orderId, 'o9')
  assert.equal(workspace.tabs[1].scroll, 480)
})

test('rename stores a trimmed title and clears it back to the screen label', () => {
  let workspace = createWorkspace('floor', 'downtown', 'tab-1')
  workspace = workspaceReducer(workspace, { type: 'RENAME_TAB', tabId: 'tab-1', title: '  Friday prep  ' })
  assert.equal(workspace.tabs[0].title, 'Friday prep')
  workspace = workspaceReducer(workspace, { type: 'RENAME_TAB', tabId: 'tab-1', title: '   ' })
  assert.equal(workspace.tabs[0].title, null)
})

test('normalizeWorkspace upgrades workspaces saved by older builds', () => {
  const restored = normalizeWorkspace({
    tabs: [{ id: 'tab-1', screen: 'floor', locId: 'downtown' }],
    activeTabId: 'tab-missing',
  })

  assert.equal(restored.tabs[0].pinned, false)
  assert.deepEqual(restored.tabs[0].ctx, {})
  assert.equal(restored.closed.length, 0)
  assert.equal(restored.activeTabId, 'tab-1')
  assert.equal(normalizeWorkspace({ tabs: [] }), null)
})
