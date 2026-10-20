import { useEffect, useState } from "react";
import { useSettings } from "./lib/settingsStore";
import { ThemeProvider } from "./theme/ThemeProvider";
import { NavigationProvider, useNavigation } from "./lib/navigation";
import { AppShell } from "./shell/AppShell";
import { SettingsView } from "./settings/SettingsView";
import { XimaWorkspace } from "./features/XimaWorkspace";
import { VideoScreenshotWorkspace } from "./features/VideoScreenshotWorkspace";
import { VideoSplitWorkspace } from "./features/VideoSplitWorkspace";
import { TaskStatusProvider } from "./lib/taskStatus";
import type { XimaSection } from "./shell/LeftSidebar";

function CurrentView() {
  const { view } = useNavigation();
  const [section, setSection] = useState<XimaSection>("wash");
  return <>
    <div hidden={view === "settings"} style={{ height: "100%" }}>
      <AppShell activeSection={section} onSelectSection={setSection}>
        <div hidden={section === "video" || section === "split"} style={{ height: "100%" }}><XimaWorkspace section={section === "history" ? "history" : "wash"} /></div>
        <div hidden={section !== "video"} style={{ height: "100%" }}><VideoScreenshotWorkspace active={view === "shell" && section === "video"} /></div>
        <div hidden={section !== "split"} style={{ height: "100%" }}><VideoSplitWorkspace active={view === "shell" && section === "split"} /></div>
      </AppShell>
    </div>
    {view === "settings" && <SettingsView />}
  </>;
}

export default function App() {
  const { settings } = useSettings();
  useEffect(() => { document.documentElement.dataset.reduceMotion = settings.reduceMotion; }, [settings.reduceMotion]);
  return (
    <ThemeProvider>
      <NavigationProvider>
        <TaskStatusProvider><CurrentView /></TaskStatusProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}
