import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePersistedState } from "../lib/usePersistedState";
import { useShortcutHandlers } from "../lib/shortcuts";
import { TitleBar } from "./TitleBar";
import { LeftSidebar } from "./LeftSidebar";
import type { HaloSection } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { BottomPanel } from "./BottomPanel";
import { MainContent } from "./MainContent";
import { useTabs } from "./useTabs";
import { useNavigation } from "../lib/navigation";
import { useSettings } from "../lib/settingsStore";
import "./AppShell.css";

export interface PanelState {
  left: boolean;
  right: boolean;
  bottom: boolean;
}

export interface PanelSizes {
  right: number;
  bottom: number;
}

/** Peek = preview of the closed left sidebar while hovering its toggle. */
export type PeekPhase = "closed" | "open" | "closing";

const DEFAULT_PANELS: PanelState = { left: true, right: false, bottom: false };
const SIDEBAR_WIDTH = 220;
const DEFAULT_SIZES: PanelSizes = { right: 380, bottom: 230 };

export const PANEL_LIMITS = {
  right: { min: 280, max: 560 },
  bottom: { min: 120, max: 480 },
} as const;

const PEEK_OPEN_DELAY = 200;
const PEEK_CLOSE_DELAY = 250;

/**
 * The three-panel frame: left sidebar (full height), main content,
 * right side panel, bottom panel. Layout is a CSS grid whose tracks
 * collapse to 0 when a panel closes (see AppShell.css) — no JS
 * measurement anywhere. The title bar floats above the grid so its
 * buttons never move. Panels are resizable by their inner edge and
 * auto-stow when dragged past their minimum. Right and bottom panel sizes
 * persist across launches; the left navigation has a fixed width.
 */
interface AppShellProps {
  children: ReactNode;
  activeSection: HaloSection;
  onSelectSection: (section: HaloSection) => void;
}

export function AppShell({ children, activeSection, onSelectSection }: AppShellProps) {
  const [panels, setPanels] = usePersistedState<PanelState>("app:panels", DEFAULT_PANELS);
  const [sizes, setSizes] = usePersistedState<PanelSizes>("app:panel-sizes", DEFAULT_SIZES);
  const [resizing, setResizing] = useState<keyof PanelState | null>(null);
  const [noAnim, setNoAnim] = useState(false);
  const [peek, setPeek] = useState<PeekPhase>("closed");
  const peekOpenTimer = useRef<number>(undefined);
  const peekCloseTimer = useRef<number>(undefined);
  const { navigate, view } = useNavigation();
  const { settings } = useSettings();
  const ui = settings.ui;
  const tabsApi = useTabs();

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

  const setSize = (panel: keyof PanelSizes) => (value: number) =>
    setSizes((s) => ({ ...s, [panel]: value }));

  const setOpen = (panel: keyof PanelState, open: boolean) =>
    setPanels((p) => ({ ...p, [panel]: open }));

  const setDragging = (panel: keyof PanelState) => (dragging: boolean) =>
    setResizing(dragging ? panel : null);

  // Only install a part's shortcuts when that part is enabled, so a
  // hidden panel/tab strip can't be toggled or cycled from the keyboard.
  useShortcutHandlers(
    useMemo(() => {
      if (view !== "shell") return {};
      const handlers: Record<string, () => void> = {
        "open-settings": () => navigate("settings"),
      };
      if (ui.leftSidebar) handlers["toggle-left"] = () => toggle("left");
      if (ui.rightSidebar) handlers["toggle-right"] = () => toggle("right");
      if (ui.bottomPanel) handlers["toggle-bottom"] = () => toggle("bottom");
      if (ui.tabs) {
        handlers["new-tab"] = tabsApi.addTab;
        handlers["close-tab"] = () =>
          tabsApi.activeTab && tabsApi.closeTab(tabsApi.activeTab.id);
        handlers["next-tab"] = () => tabsApi.cycle(1);
        handlers["prev-tab"] = () => tabsApi.cycle(-1);
      }
      return handlers;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, view, peek, tabsApi, ui]),
  );

  return (
    <div
      className="app-shell"
      data-left-open={panels.left && ui.leftSidebar}
      data-right-open={panels.right && ui.rightSidebar}
      data-bottom-open={panels.bottom && ui.bottomPanel}
      data-no-anim={resizing !== null || noAnim}
      style={
        {
          "--sidebar-width": `${SIDEBAR_WIDTH}px`,
          "--right-panel-width": `${sizes.right}px`,
          "--bottom-panel-height": `${sizes.bottom}px`,
        } as CSSProperties
      }
    >
      <TitleBar
        panels={panels}
        ui={ui}
        onToggle={toggle}
        onLeftPeekStart={peekStart}
        onLeftPeekEnd={peekEnd}
        tabs={tabsApi.tabs}
        activeTabId={tabsApi.activeTab?.id ?? null}
        onSelectTab={tabsApi.selectTab}
        onCloseTab={tabsApi.closeTab}
        onNewTab={tabsApi.addTab}
      />

      {ui.leftSidebar && (
        <LeftSidebar
          activeSection={activeSection}
          onSelectSection={onSelectSection}
          open={panels.left}
          peek={peek}
          onPeekHold={peekHold}
          onPeekEnd={peekEnd}
          onPeekExited={() => setPeek("closed")}
        />
      )}

      <div className="app-shell-main">
        <MainContent
          children={children}
        />
      </div>

      {ui.rightSidebar && (
        <RightSidebar
          open={panels.right}
          size={sizes.right}
          dragging={resizing === "right"}
          onSize={setSize("right")}
          onStow={() => setOpen("right", false)}
          onUnstow={() => setOpen("right", true)}
          onDragging={setDragging("right")}
        />
      )}
      {ui.bottomPanel && (
        <BottomPanel
          open={panels.bottom}
          onClose={() => toggle("bottom")}
          onOpenHistory={() => onSelectSection("history")}
          size={sizes.bottom}
          dragging={resizing === "bottom"}
          onSize={setSize("bottom")}
          onStow={() => setOpen("bottom", false)}
          onUnstow={() => setOpen("bottom", true)}
          onDragging={setDragging("bottom")}
        />
      )}
    </div>
  );
}
