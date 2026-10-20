export type WorkspaceTabId = "wash" | "history" | "video" | "screen" | "split" | "shutdown";

export interface WorkspaceTabState {
  openTabs: WorkspaceTabId[];
  activeTab: WorkspaceTabId | null;
}

export const WORKSPACE_TAB_IDS: WorkspaceTabId[];
export const DEFAULT_WORKSPACE_TAB_STATE: WorkspaceTabState;
export function restoreWorkspaceTabState(
  value: unknown,
  supportedTabs?: WorkspaceTabId[],
): WorkspaceTabState;
export function openWorkspaceTab(state: WorkspaceTabState, tabId: WorkspaceTabId): WorkspaceTabState;
export function closeWorkspaceTab(state: WorkspaceTabState, tabId: WorkspaceTabId): WorkspaceTabState;
export function moveWorkspaceTab(state: WorkspaceTabState, fromIndex: number, toIndex: number): WorkspaceTabState;
