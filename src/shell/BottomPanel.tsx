import { PanelBottomIcon, PlusIcon, CloseIcon } from "../lib/icons";
import { ResizeHandle } from "./ResizeHandle";
import { PANEL_LIMITS } from "./AppShell";
import "./BottomPanel.css";

interface BottomPanelProps {
  open: boolean;
  onClose: () => void;
  size: number;
  dragging: boolean;
  onSize: (size: number) => void;
  onStow: () => void;
  onUnstow: () => void;
  onDragging: (dragging: boolean) => void;
}

/**
 * Bottom panel spanning everything right of the sidebar. The tab bar
 * and content line are placeholders — swap in a real dock pane.
 */
export function BottomPanel({ open, onClose, size, dragging, onSize, onStow, onUnstow, onDragging }: BottomPanelProps) {
  return (
    <section className="bottom-panel" data-open={open}>
      <div className="bottom-panel-inner">
        <div className="bottom-panel-tabs">
          <div className="bottom-panel-tab" data-active="true">
            <PanelBottomIcon />
            <span>Panel</span>
          </div>
          <button className="icon-button" title="New tab">
            <PlusIcon />
          </button>
          <div className="bottom-panel-spacer" />
          <button className="icon-button" title="Close panel" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="bottom-panel-content">
          <span className="bottom-panel-placeholder">Bottom panel content</span>
        </div>
      </div>

      {/* Stays mounted mid-drag so a stow can be pulled back open. */}
      {(open || dragging) && (
        <ResizeHandle
          edge="top"
          dir={-1}
          size={size}
          min={PANEL_LIMITS.bottom.min}
          max={PANEL_LIMITS.bottom.max}
          onSize={onSize}
          onStow={onStow}
          onUnstow={onUnstow}
          onDragging={onDragging}
        />
      )}
    </section>
  );
}
