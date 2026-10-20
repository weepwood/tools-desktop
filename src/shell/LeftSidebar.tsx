import { ClockIcon, ComposeIcon, ImageIcon, SplitIcon } from "../lib/icons";
import { AccountArea } from "./AccountArea";
import { ResizeHandle } from "./ResizeHandle";
import { PANEL_LIMITS, type PeekPhase } from "./AppShell";
import "./LeftSidebar.css";

export type XimaSection = "wash" | "history" | "video" | "split";

interface LeftSidebarProps {
  activeSection: XimaSection;
  onSelectSection: (section: XimaSection) => void;
  open: boolean;
  peek: PeekPhase;
  showProfileRow: boolean;
  onPeekHold: () => void;
  onPeekEnd: () => void;
  onPeekExited: () => void;
  size: number;
  dragging: boolean;
  onSize: (size: number) => void;
  onStow: () => void;
  onUnstow: () => void;
  onDragging: (dragging: boolean) => void;
}

/**
 * Full-height left sidebar. It slides underneath the floating title
 * bar (which owns the toggle/nav buttons), so its content simply
 * starts below that strip. While closed, hovering the toggle shows it
 * as a temporary overlay ("peek") until the pointer leaves it. Nav
 * items, sections and list rows are placeholder scaffolding — replace
 * with real navigation.
 */
export function LeftSidebar({
  activeSection,
  onSelectSection,
  open,
  peek,
  showProfileRow,
  onPeekHold,
  onPeekEnd,
  onPeekExited,
  size,
  dragging,
  onSize,
  onStow,
  onUnstow,
  onDragging,
}: LeftSidebarProps) {
  const peeking = !open && peek !== "closed";

  return (
    <aside
      className="left-sidebar"
      data-open={open}
      data-peek={peeking ? peek : "closed"}
      onMouseEnter={peeking ? onPeekHold : undefined}
      onMouseLeave={peeking ? onPeekEnd : undefined}
      onAnimationEnd={peek === "closing" ? onPeekExited : undefined}
    >
      <div className="left-sidebar-inner">
        <nav className="left-sidebar-nav">
          <div className="sidebar-section-title">工作区</div>
          <button className="sidebar-item" data-active={activeSection === "wash"} onClick={() => onSelectSection("wash")}>
            <ComposeIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">文件洗码</span>
          </button>
          <button className="sidebar-item" data-active={activeSection === "video"} onClick={() => onSelectSection("video")}>
            <ImageIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">视频截图</span>
          </button>
          <button className="sidebar-item" data-active={activeSection === "split"} onClick={() => onSelectSection("split")}>
            <SplitIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">视频按大小切分</span>
          </button>
          <button className="sidebar-item" data-active={activeSection === "history"} onClick={() => onSelectSection("history")}>
            <ClockIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">历史与恢复</span>
          </button>
        </nav>

        {showProfileRow && <AccountArea />}
      </div>

      {/* Stays mounted mid-drag so a stow can be pulled back open. */}
      {(open || dragging) && (
        <ResizeHandle
          edge="right"
          dir={1}
          size={size}
          min={PANEL_LIMITS.left.min}
          max={PANEL_LIMITS.left.max}
          onSize={onSize}
          onStow={onStow}
          onUnstow={onUnstow}
          onDragging={onDragging}
        />
      )}
    </aside>
  );
}
