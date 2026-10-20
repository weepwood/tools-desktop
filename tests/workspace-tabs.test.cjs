const test = require('node:test');
const assert = require('node:assert/strict');
const tabs = import('../src/lib/workspace-tabs.mjs');

test('invalid saved tab state falls back to the first workspace', async () => {
  const { DEFAULT_WORKSPACE_TAB_STATE, restoreWorkspaceTabState } = await tabs;
  assert.deepEqual(restoreWorkspaceTabState({ openTabs: 'wash', activeTab: 'wash' }), DEFAULT_WORKSPACE_TAB_STATE);
});

test('opening an already open workspace activates it without adding a duplicate', async () => {
  const { openWorkspaceTab } = await tabs;
  const state = { openTabs: ['wash', 'video'], activeTab: 'wash' };

  assert.deepEqual(openWorkspaceTab(state, 'video'), {
    openTabs: ['wash', 'video'],
    activeTab: 'video',
  });
});

test('closing the active tab selects its right neighbor or the previous last tab', async () => {
  const { closeWorkspaceTab } = await tabs;
  const state = { openTabs: ['wash', 'video', 'split'], activeTab: 'video' };

  assert.deepEqual(closeWorkspaceTab(state, 'video'), {
    openTabs: ['wash', 'split'],
    activeTab: 'split',
  });
  assert.deepEqual(closeWorkspaceTab({ ...state, activeTab: 'split' }, 'split'), {
    openTabs: ['wash', 'video'],
    activeTab: 'video',
  });
});

test('closing the last workspace leaves an empty selection state', async () => {
  const { closeWorkspaceTab } = await tabs;
  assert.deepEqual(closeWorkspaceTab({ openTabs: ['wash'], activeTab: 'wash' }, 'wash'), {
    openTabs: [],
    activeTab: null,
  });
});

test('moving a tab changes tab order without changing the selected workspace', async () => {
  const { moveWorkspaceTab } = await tabs;
  assert.deepEqual(moveWorkspaceTab({ openTabs: ['wash', 'video', 'split'], activeTab: 'video' }, 0, 2), {
    openTabs: ['video', 'split', 'wash'],
    activeTab: 'video',
  });
});

test('restoring filters unsupported and duplicate workspace IDs', async () => {
  const { restoreWorkspaceTabState } = await tabs;
  assert.deepEqual(
    restoreWorkspaceTabState(
      { openTabs: ['wash', 'screen', 'wash'], activeTab: 'screen' },
      ['wash', 'video'],
    ),
    { openTabs: ['wash'], activeTab: 'wash' },
  );
});

test('restoring an intentional empty tab list preserves the empty start page', async () => {
  const { restoreWorkspaceTabState } = await tabs;
  assert.deepEqual(restoreWorkspaceTabState({ openTabs: [], activeTab: null }), {
    openTabs: [],
    activeTab: null,
  });
});

test('unknown saved workspace IDs are treated as invalid persisted data', async () => {
  const { DEFAULT_WORKSPACE_TAB_STATE, restoreWorkspaceTabState } = await tabs;
  assert.deepEqual(restoreWorkspaceTabState({ openTabs: ['future-tool'], activeTab: 'future-tool' }), DEFAULT_WORKSPACE_TAB_STATE);
});
