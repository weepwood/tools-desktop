export const WORKSPACE_TAB_IDS = ["wash", "history", "video", "screen", "split", "shutdown"];

export const DEFAULT_WORKSPACE_TAB_STATE = {
  openTabs: ["wash"],
  activeTab: "wash",
};

function isTabId(value, supportedTabs) {
  return typeof value === "string" && supportedTabs.includes(value);
}

export function restoreWorkspaceTabState(value, supportedTabs = WORKSPACE_TAB_IDS) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { openTabs: [...DEFAULT_WORKSPACE_TAB_STATE.openTabs], activeTab: "wash" };
  }

  const candidate = value;
  if (
    !Array.isArray(candidate.openTabs) ||
    !candidate.openTabs.every((tab) => WORKSPACE_TAB_IDS.includes(tab)) ||
    !(candidate.activeTab === null || WORKSPACE_TAB_IDS.includes(candidate.activeTab))
  ) {
    return { openTabs: [...DEFAULT_WORKSPACE_TAB_STATE.openTabs], activeTab: "wash" };
  }

  const openTabs = [...new Set(candidate.openTabs.filter((tab) => isTabId(tab, supportedTabs)))];
  const activeTab = openTabs.includes(candidate.activeTab)
    ? candidate.activeTab
    : openTabs[0] ?? null;
  return { openTabs, activeTab };
}

export function openWorkspaceTab(state, tabId) {
  const openTabs = state.openTabs.includes(tabId)
    ? state.openTabs
    : [...state.openTabs, tabId];
  return { openTabs, activeTab: tabId };
}

export function closeWorkspaceTab(state, tabId) {
  const index = state.openTabs.indexOf(tabId);
  if (index < 0) return state;

  const openTabs = state.openTabs.filter((tab) => tab !== tabId);
  const activeTab = state.activeTab === tabId
    ? openTabs[Math.min(index, openTabs.length - 1)] ?? null
    : state.activeTab;
  return { openTabs, activeTab };
}

export function moveWorkspaceTab(state, fromIndex, toIndex) {
  if (
    fromIndex < 0 || fromIndex >= state.openTabs.length ||
    toIndex < 0 || toIndex >= state.openTabs.length ||
    fromIndex === toIndex
  ) return state;

  const openTabs = [...state.openTabs];
  const [tab] = openTabs.splice(fromIndex, 1);
  openTabs.splice(toIndex, 0, tab);
  return { openTabs, activeTab: state.activeTab };
}
