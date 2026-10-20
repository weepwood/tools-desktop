import { PanelBottomIcon, PanelRightIcon } from "../lib/icons";
import { Tooltip } from "../lib/Tooltip";
import { useShortcuts } from "../lib/shortcuts";
import type { PanelState } from "./AppShell";
import type { UIVisibility } from "../lib/settingsStore";

interface PanelTogglesProps {
  panels: PanelState;
  ui: UIVisibility;
  onToggle: (panel: keyof PanelState) => void;
}

/**
 * The panel toggle buttons in the title bar's top-right: bottom panel,
 * then right side panel. (The left sidebar's toggle lives in the title
 * bar's left cluster.)
 */
export function PanelToggles({ panels, ui, onToggle }: PanelTogglesProps) {
  const { binding } = useShortcuts();

  return (
    <>
      {ui.bottomPanel && (
        <Tooltip label="Bottom panel" shortcut={binding("toggle-bottom")} align="right">
          <button
            className="icon-button"
            data-active={panels.bottom}
            onClick={() => onToggle("bottom")}
          >
            <PanelBottomIcon />
          </button>
        </Tooltip>
      )}
      {ui.rightSidebar && (
        <Tooltip label="Right sidebar" shortcut={binding("toggle-right")} align="right">
          <button
            className="icon-button"
            data-active={panels.right}
            onClick={() => onToggle("right")}
          >
            <PanelRightIcon />
          </button>
        </Tooltip>
      )}
    </>
  );
}
