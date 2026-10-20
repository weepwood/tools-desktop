import { FolderIcon, SearchIcon, ClockIcon } from "../lib/icons";
import { ResizeHandle } from "./ResizeHandle";
import { PANEL_LIMITS } from "./AppShell";
import "./RightSidebar.css";

interface RightSidebarProps {
  open: boolean;
  size: number;
  dragging: boolean;
  onSize: (size: number) => void;
  onStow: () => void;
  onUnstow: () => void;
  onDragging: (dragging: boolean) => void;
}

const PANEL_ITEMS = [
  { icon: FolderIcon, label: "Files", hint: "⌘P" },
  { icon: SearchIcon, label: "Search", hint: "⌘F" },
  { icon: ClockIcon, label: "History" },
];

/**
 * Right side panel — a vertical list of placeholder rows. Swap these
 * for the app's real tool panes.
 */
export function RightSidebar({ open, size, dragging, onSize, onStow, onUnstow, onDragging }: RightSidebarProps) {
  return (
    <aside className="right-sidebar" data-open={open}>
      <div className="right-sidebar-inner">
        <div className="right-sidebar-list">
          {PANEL_ITEMS.map(({ icon: Icon, label, hint }) => (
            <button key={label} className="right-sidebar-item">
              <Icon className="right-sidebar-item-icon" />
              <span className="right-sidebar-item-label">{label}</span>
              {hint && <span className="kbd-hint">{hint}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Stays mounted mid-drag so a stow can be pulled back open. */}
      {(open || dragging) && (
        <ResizeHandle
          edge="left"
          dir={-1}
          size={size}
          min={PANEL_LIMITS.right.min}
          max={PANEL_LIMITS.right.max}
          onSize={onSize}
          onStow={onStow}
          onUnstow={onUnstow}
          onDragging={onDragging}
        />
      )}
    </aside>
  );
}
