import { isMacOS } from "../lib/tauri";
import { WindowControls } from "./WindowControls";
import { Tooltip } from "../lib/Tooltip";
import { useShortcuts } from "../lib/shortcuts";
import { PanelLeftIcon } from "../lib/icons";
import type { PanelState } from "./AppShell";
import type { UIVisibility } from "../lib/settingsStore";
import type { WorkspaceTabId, WorkspaceTabState } from "../lib/workspace-tabs.mjs";
import { TitleBarTabs } from "./TitleBarTabs";
import "./TitleBar.css";

interface TitleBarProps {
  panels: PanelState;
  ui: UIVisibility;
  onToggle: (panel: keyof PanelState) => void;
  /** Hovering the left toggle previews the closed sidebar. */
  onLeftPeekStart: () => void;
  onLeftPeekEnd: () => void;
  tabs: WorkspaceTabState;
  screenCaptureAvailable: boolean;
  tabPickerOpen: boolean;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onCloseTab: (tab: WorkspaceTabId) => void;
  onMoveTab: (fromIndex: number, toIndex: number) => void;
  onTabPickerOpenChange: (open: boolean) => void;
}

/**
 * Transparent title bar overlaying the full window width: its contents
 * never move — opening the sidebar just slides a new background
 * underneath them. The middle area contains the workspace tab strip and
 * the window controls stay pinned on the right.
 *
 * On macOS the left cluster starts past the inset traffic lights; on
 * Windows/Linux custom window controls render on the right.
 */
export function TitleBar({
  panels,
  ui,
  onToggle,
  onLeftPeekStart,
  onLeftPeekEnd,
  tabs,
  screenCaptureAvailable,
  tabPickerOpen,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onTabPickerOpenChange,
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

      <TitleBarTabs
        state={tabs}
        screenCaptureAvailable={screenCaptureAvailable}
        pickerOpen={tabPickerOpen}
        onSelect={onSelectTab}
        onClose={onCloseTab}
        onMove={onMoveTab}
        onOpenPicker={() => onTabPickerOpenChange(!tabPickerOpen)}
        onClosePicker={() => onTabPickerOpenChange(false)}
      />

      <div className="titlebar-right">
        <WindowControls />
      </div>
    </header>
  );
}
