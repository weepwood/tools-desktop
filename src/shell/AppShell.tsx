import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePersistedState } from "../lib/usePersistedState";
import { useShortcutHandlers } from "../lib/shortcuts";
import { TitleBar } from "./TitleBar";
import { LeftSidebar } from "./LeftSidebar";
import type { HaloSection } from "./LeftSidebar";
import type { WorkspaceTabState } from "../lib/workspace-tabs.mjs";
import { MainContent } from "./MainContent";
import { useNavigation } from "../lib/navigation";
import { useSettings } from "../lib/settingsStore";
import "./AppShell.css";

export interface PanelState {
  left: boolean;
}

/** Peek = preview of the closed left sidebar while hovering its toggle. */
export type PeekPhase = "closed" | "open" | "closing";

const DEFAULT_PANELS: PanelState = { left: true };
const SIDEBAR_WIDTH = 220;

const PEEK_OPEN_DELAY = 200;
const PEEK_CLOSE_DELAY = 250;

/**
 * The window frame: left navigation (full height) plus the main content.
 *
 * HALO has a persistent navigation rail and a browser-style strip for its
 * tool workspaces. Settings remains a separate view.
 *
 * The layout is a CSS grid whose sidebar track collapses to 0 when closed
 * (see AppShell.css) — no JS measurement anywhere. The title bar floats above
 * the grid so its buttons never move.
 */
interface AppShellProps {
  children: ReactNode;
  activeSection: HaloSection | null;
  onSelectSection: (section: HaloSection) => void;
  tabs: WorkspaceTabState;
  screenCaptureAvailable: boolean;
  tabPickerOpen: boolean;
  onSelectTab: (tab: HaloSection) => void;
  onCloseTab: (tab: HaloSection) => void;
  onMoveTab: (fromIndex: number, toIndex: number) => void;
  onTabPickerOpenChange: (open: boolean) => void;
}

export function AppShell({
  children,
  activeSection,
  onSelectSection,
  tabs,
  screenCaptureAvailable,
  tabPickerOpen,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onTabPickerOpenChange,
}: AppShellProps) {
  const [panels, setPanels] = usePersistedState<PanelState>("app:panels", DEFAULT_PANELS);
  const [noAnim, setNoAnim] = useState(false);
  const [peek, setPeek] = useState<PeekPhase>("closed");
  const peekOpenTimer = useRef<number>(undefined);
  const peekCloseTimer = useRef<number>(undefined);
  const { navigate, view } = useNavigation();
  const { settings } = useSettings();
  const ui = settings.ui;

  const cancelPeekTimers = () => {
    window.clearTimeout(peekOpenTimer.current);
    window.clearTimeout(peekCloseTimer.current);
  };

  /** Hovering the sidebar toggle previews the closed sidebar. */
  const peekStart = () => {
    cancelPeekTimers();
    if (panels.left) return;
    peekOpenTimer.current = window.setTimeout(() => setPeek("open"), PEEK_OPEN_DELAY);
  };

  /** Keep the peek while the pointer is over the sidebar itself. */
  const peekHold = () => {
    cancelPeekTimers();
  };

  const peekEnd = () => {
    cancelPeekTimers();
    peekCloseTimer.current = window.setTimeout(
      () => setPeek((p) => (p === "open" ? "closing" : p)),
      PEEK_CLOSE_DELAY,
    );
  };

  const toggle = (panel: keyof PanelState) => {
    if (panel === "left") {
      cancelPeekTimers();
      // A peek becoming a real open must not replay the slide-in:
      // the sidebar is already visually there, so snap the grid.
      if (peek !== "closed" && !panels.left) {
        setNoAnim(true);
        window.setTimeout(() => setNoAnim(false), 80);
      }
      setPeek("closed");
    }
    setPanels((p) => ({ ...p, [panel]: !p[panel] }));
  };

  useShortcutHandlers(
    useMemo(() => {
      const handlers: Record<string, () => void> = {
        "new-tab": () => onTabPickerOpenChange(true),
        "close-tab": () => {
          if (tabs.activeTab) onCloseTab(tabs.activeTab);
        },
        "next-tab": () => {
          if (!tabs.openTabs.length) return;
          const current = tabs.activeTab ? tabs.openTabs.indexOf(tabs.activeTab) : -1;
          onSelectTab(tabs.openTabs[current < 0 ? 0 : (current + 1) % tabs.openTabs.length]);
        },
        "prev-tab": () => {
          if (!tabs.openTabs.length) return;
          const current = tabs.activeTab ? tabs.openTabs.indexOf(tabs.activeTab) : -1;
          onSelectTab(tabs.openTabs[current < 0
            ? tabs.openTabs.length - 1
            : (current - 1 + tabs.openTabs.length) % tabs.openTabs.length]);
        },
      };
      if (view === "shell") handlers["open-settings"] = () => navigate("settings");
      if (ui.leftSidebar) handlers["toggle-left"] = () => toggle("left");
      return handlers;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, view, peek, ui, tabs, onCloseTab, onSelectTab, onTabPickerOpenChange]),
  );

  return (
    <div
      className="app-shell"
      data-left-open={panels.left && ui.leftSidebar}
      data-no-anim={noAnim}
      style={{ "--sidebar-width": `${SIDEBAR_WIDTH}px` } as CSSProperties}
    >
      <TitleBar
        panels={panels}
        ui={ui}
        onToggle={toggle}
        onLeftPeekStart={peekStart}
        onLeftPeekEnd={peekEnd}
        tabs={tabs}
        screenCaptureAvailable={screenCaptureAvailable}
        tabPickerOpen={tabPickerOpen}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onMoveTab={onMoveTab}
        onTabPickerOpenChange={onTabPickerOpenChange}
      />

      {ui.leftSidebar && (
        <LeftSidebar
          activeSection={activeSection}
          onSelectSection={onSelectSection}
          screenCaptureAvailable={screenCaptureAvailable}
          open={panels.left}
          peek={peek}
          onPeekHold={peekHold}
          onPeekEnd={peekEnd}
          onPeekExited={() => setPeek("closed")}
        />
      )}

      <div className="app-shell-main">
        <MainContent children={children} />
      </div>
    </div>
  );
}
