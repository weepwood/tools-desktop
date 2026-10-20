import { isMacOS } from "../lib/tauri";
import { WindowControls } from "./WindowControls";
import { PanelToggles } from "./PanelToggles";
import { Tooltip } from "../lib/Tooltip";
import { useShortcuts } from "../lib/shortcuts";
import { PlusIcon, CloseIcon, PanelLeftIcon } from "../lib/icons";
import type { PanelState } from "./AppShell";
import type { UIVisibility } from "../lib/settingsStore";
import type { Tab } from "./useTabs";
import "./TitleBar.css";

interface TitleBarProps {
  panels: PanelState;
  ui: UIVisibility;
  onToggle: (panel: keyof PanelState) => void;
  /** Hovering the left toggle previews the closed sidebar. */
  onLeftPeekStart: () => void;
  onLeftPeekEnd: () => void;
  tabs: Tab[];
  activeTabId: number | null;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onNewTab: () => void;
}

/**
 * Transparent title bar overlaying the full window width: its contents
 * never move — opening a sidebar just slides a new background
 * underneath them. It's a single row — left cluster, the tab strip, and
 * the right cluster — and doubles as the drag region. On macOS the left
 * cluster starts past the inset traffic lights; on Windows/Linux custom
 * window controls render on the right.
 */
export function TitleBar({
  panels,
  ui,
  onToggle,
  onLeftPeekStart,
  onLeftPeekEnd,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: TitleBarProps) {
  const mac = isMacOS();
  const { binding } = useShortcuts();

  return (
    <header className="titlebar" data-tauri-drag-region data-mac={mac}>
      <div className="titlebar-left" data-tauri-drag-region>
        {ui.leftSidebar && (
          <Tooltip label="显示或隐藏导航" shortcut={binding("toggle-left")} align="left">
            <button
              className="icon-button"
              title="显示或隐藏导航"
              data-active={panels.left}
              onClick={() => onToggle("left")}
              onMouseEnter={onLeftPeekStart}
              onMouseLeave={onLeftPeekEnd}
            >
              <PanelLeftIcon />
            </button>
          </Tooltip>
        )}
        <span className="titlebar-brand" data-tauri-drag-region>
          {/* The mark is the product name: an open ring, i.e. a halo. */}
          <svg className="titlebar-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient
                id="halo-ring-gradient"
                x1="4"
                y1="3"
                x2="20"
                y2="21"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor="var(--halo-grad-a)" />
                <stop offset="0.55" stopColor="var(--halo-grad-b)" />
                <stop offset="1" stopColor="var(--halo-grad-c)" />
              </linearGradient>
            </defs>
            <circle
              cx="12"
              cy="12"
              r="7.7"
              fill="none"
              stroke="url(#halo-ring-gradient)"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeDasharray="38 11"
            />
          </svg>
          <span className="titlebar-brand-word">HALO</span>
        </span>
      </div>

      {/* Empty strip stays draggable; tab buttons opt out via CSS. */}
      <div className="titlebar-tabs" data-tauri-drag-region>
        {ui.tabs && (
          <>
        <div className="titlebar-tabs-list" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              className="titlebar-tab"
              data-active={tab.id === activeTabId}
              onMouseDown={() => onSelectTab(tab.id)}
              // Middle-click closes, matching common tab UIs.
              onAuxClick={(e) => e.button === 1 && onCloseTab(tab.id)}
            >
              <span className="titlebar-tab-title">{tab.title}</span>
              <Tooltip label="Close tab" shortcut={binding("close-tab")}>
                <button
                  className="titlebar-tab-close"
                  aria-label={`Close ${tab.title}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <CloseIcon />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
        <Tooltip label="New tab" shortcut={binding("new-tab")}>
          <button className="icon-button titlebar-tab-new" onClick={onNewTab}>
            <PlusIcon />
          </button>
        </Tooltip>
          </>
        )}
      </div>

      <div className="titlebar-right">
        <PanelToggles panels={panels} ui={ui} onToggle={onToggle} />
        <WindowControls />
      </div>
    </header>
  );
}
