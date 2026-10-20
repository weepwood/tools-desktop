import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSettings } from "./lib/settingsStore";
import { ThemeProvider } from "./theme/ThemeProvider";
import { NavigationProvider, useNavigation } from "./lib/navigation";
import { AppShell } from "./shell/AppShell";
import { SettingsWorkspace } from "./settings/SettingsWorkspace";
import { HaloWorkspace } from "./features/HaloWorkspace";
import { VideoScreenshotWorkspace } from "./features/VideoScreenshotWorkspace";
import { ScreenCaptureWorkspace } from "./features/ScreenCaptureWorkspace";
import { VideoSplitWorkspace } from "./features/VideoSplitWorkspace";
import { ShutdownWorkspace } from "./features/ShutdownWorkspace";
import { TaskStatusProvider } from "./lib/taskStatus";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { HaloSection } from "./shell/LeftSidebar";
import {
  DEFAULT_WORKSPACE_TAB_STATE,
  WORKSPACE_TAB_IDS,
  closeWorkspaceTab,
  moveWorkspaceTab,
  openWorkspaceTab,
  restoreWorkspaceTabState,
  type WorkspaceTabId,
  type WorkspaceTabState,
} from "./lib/workspace-tabs.mjs";
import "./styles/halo-views.css";

const WORKSPACE_TABS_STORAGE_KEY = "app:workspace-tabs";
const WORKSPACE_TABS_WITHOUT_SCREEN = WORKSPACE_TAB_IDS.filter((tab) => tab !== "screen");

function loadWorkspaceTabs(): WorkspaceTabState {
  try {
    const raw = localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY);
    if (raw === null) return DEFAULT_WORKSPACE_TAB_STATE;
    return restoreWorkspaceTabState(JSON.parse(raw));
  } catch {
    return DEFAULT_WORKSPACE_TAB_STATE;
  }
}

/**
 * Workspaces stay mounted while another one is active so that scroll
 * position, filters and in-flight state survive a trip to 设置 and back.
 * `hidden` keeps them out of the layout *and* restarts their entry
 * animation the next time they become visible.
 */
function KeptView({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div className="halo-view-slot" hidden={!visible} aria-hidden={!visible}>
      {children}
    </div>
  );
}

function CurrentView() {
  const { view, navigate } = useNavigation();
  const [tabs, setTabs] = useState<WorkspaceTabState>(loadWorkspaceTabs);
  const [screenCaptureAvailable, setScreenCaptureAvailable] = useState<boolean | null>(null);
  const [tabPickerOpen, setTabPickerOpen] = useState(false);
  const settingsOpen = view === "settings";
  const closeSettings = useCallback(() => navigate("shell"), [navigate]);
  const selectTab = useCallback((next: WorkspaceTabId) => {
    if (next === "screen" && screenCaptureAvailable !== true) return;
    setTabs((previous) => openWorkspaceTab(previous, next));
    setTabPickerOpen(false);
    navigate("shell");
  }, [navigate, screenCaptureAvailable]);
  const closeTab = useCallback((tab: WorkspaceTabId) => {
    setTabs((previous) => closeWorkspaceTab(previous, tab));
  }, []);
  const moveTab = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((previous) => moveWorkspaceTab(previous, fromIndex, toIndex));
  }, []);
  const visibleTabs = useMemo(
    () => screenCaptureAvailable === true
      ? tabs
      : restoreWorkspaceTabState(tabs, WORKSPACE_TABS_WITHOUT_SCREEN),
    [screenCaptureAvailable, tabs],
  );
  const activeTab = visibleTabs.activeTab;

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      // Keep tab state in memory if local storage is unavailable.
    }
  }, [tabs]);

  useEffect(() => {
    let current = true;
    void window.halo?.invoke<boolean>("screen_capture_supported").then((available) => {
      if (current) setScreenCaptureAvailable(available);
    }).catch(() => {
      if (current) setScreenCaptureAvailable(false);
    });
    if (!window.halo) setScreenCaptureAvailable(false);
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (screenCaptureAvailable !== false) return;
    setTabs((previous) => restoreWorkspaceTabState(
      previous,
      WORKSPACE_TAB_IDS.filter((tab) => tab !== "screen"),
    ));
  }, [screenCaptureAvailable]);

  const selectSection = useCallback((next: HaloSection) => selectTab(next), [selectTab]);

  return (
    <div className="halo-shell-root">
      <AppShell
        activeSection={activeTab}
        onSelectSection={selectSection}
        tabs={visibleTabs}
        screenCaptureAvailable={screenCaptureAvailable === true}
        tabPickerOpen={tabPickerOpen}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onMoveTab={moveTab}
        onTabPickerOpenChange={setTabPickerOpen}
      >
        <KeptView visible={!settingsOpen && (activeTab === "wash" || activeTab === "history")}>
          <HaloWorkspace section={activeTab === "history" ? "history" : "wash"} onOpenWash={() => selectSection("wash")} />
        </KeptView>
        <KeptView visible={!settingsOpen && activeTab === "video"}>
          <VideoScreenshotWorkspace active={!settingsOpen && activeTab === "video"} />
        </KeptView>
        <KeptView visible={!settingsOpen && activeTab === "screen"}>
          <ScreenCaptureWorkspace active={!settingsOpen && activeTab === "screen"} />
        </KeptView>
        <KeptView visible={!settingsOpen && activeTab === "split"}>
          <VideoSplitWorkspace active={!settingsOpen && activeTab === "split"} />
        </KeptView>
        <KeptView visible={!settingsOpen && activeTab === "shutdown"}>
          <ShutdownWorkspace active={!settingsOpen && activeTab === "shutdown"} />
        </KeptView>
        <KeptView visible={!settingsOpen && activeTab === null}>
          <div className="halo-tab-empty">
            <strong>没有打开的功能</strong>
            <span>使用顶部的“打开功能”选择一个工作区。</span>
          </div>
        </KeptView>
        <KeptView visible={settingsOpen}>
          <SettingsWorkspace onBack={closeSettings} />
        </KeptView>
      </AppShell>
    </div>
  );
}

export default function App() {
  const { settings } = useSettings();

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = settings.reduceMotion;
  }, [settings.reduceMotion]);

  useEffect(() => {
    document.documentElement.dataset.uiFont = settings.uiFont;
  }, [settings.uiFont]);

  return (
    <ThemeProvider>
      <NavigationProvider>
        <TaskStatusProvider>
          <ErrorBoundary>
            <CurrentView />
          </ErrorBoundary>
        </TaskStatusProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}
