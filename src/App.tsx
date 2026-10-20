import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSettings } from "./lib/settingsStore";
import { ThemeProvider } from "./theme/ThemeProvider";
import { NavigationProvider, useNavigation } from "./lib/navigation";
import { AppShell } from "./shell/AppShell";
import { SettingsWorkspace } from "./settings/SettingsWorkspace";
import { HaloWorkspace } from "./features/HaloWorkspace";
import { VideoScreenshotWorkspace } from "./features/VideoScreenshotWorkspace";
import { VideoSplitWorkspace } from "./features/VideoSplitWorkspace";
import { TaskStatusProvider } from "./lib/taskStatus";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { HaloSection } from "./shell/LeftSidebar";
import "./styles/halo-views.css";

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
  const [section, setSection] = useState<HaloSection>("wash");
  const settingsOpen = view === "settings";
  const closeSettings = useCallback(() => navigate("shell"), [navigate]);
  const selectSection = useCallback((next: HaloSection) => {
    setSection(next);
    navigate("shell");
  }, [navigate]);

  return (
    <div className="halo-shell-root">
      <AppShell activeSection={section} onSelectSection={selectSection}>
        <KeptView visible={!settingsOpen && section !== "video" && section !== "split"}>
          <HaloWorkspace section={section === "history" ? "history" : "wash"} onOpenWash={() => selectSection("wash")} />
        </KeptView>
        <KeptView visible={!settingsOpen && section === "video"}>
          <VideoScreenshotWorkspace active={!settingsOpen && section === "video"} />
        </KeptView>
        <KeptView visible={!settingsOpen && section === "split"}>
          <VideoSplitWorkspace active={!settingsOpen && section === "split"} />
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
