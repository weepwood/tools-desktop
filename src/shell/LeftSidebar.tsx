import { ClockIcon, ComposeIcon, GearIcon, ImageIcon, SplitIcon } from "../lib/icons";
import { useNavigation } from "../lib/navigation";
import type { PeekPhase } from "./AppShell";
import { SidebarMarker, useSidebarMarker } from "./SidebarMarker";
import "./LeftSidebar.css";

export type HaloSection = "wash" | "history" | "video" | "split" | "shutdown";

interface LeftSidebarProps {
  activeSection: HaloSection;
  onSelectSection: (section: HaloSection) => void;
  open: boolean;
  peek: PeekPhase;
  onPeekHold: () => void;
  onPeekEnd: () => void;
  onPeekExited: () => void;
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
  onPeekHold,
  onPeekEnd,
  onPeekExited,
}: LeftSidebarProps) {
  const peeking = !open && peek !== "closed";
  const { navigate, view } = useNavigation();
  const marker = useSidebarMarker(`${view}:${activeSection}`);

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
        <nav className="left-sidebar-nav" ref={marker.navRef}>
          <SidebarMarker top={marker.top} />
          <button className="sidebar-item" data-active={view === "shell" && activeSection === "wash"} onClick={() => onSelectSection("wash")}>
            <ComposeIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">文件洗码</span>
          </button>
          <button className="sidebar-item" data-active={view === "shell" && activeSection === "video"} onClick={() => onSelectSection("video")}>
            <ImageIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">视频截图</span>
          </button>
          <button className="sidebar-item" data-active={view === "shell" && activeSection === "split"} onClick={() => onSelectSection("split")}>
            <SplitIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">视频按大小切分</span>
          </button>
          <button className="sidebar-item" data-active={view === "shell" && activeSection === "shutdown"} onClick={() => onSelectSection("shutdown")}>
            <ClockIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">定时关机</span>
          </button>
          <button className="sidebar-item" data-active={view === "shell" && activeSection === "history"} onClick={() => onSelectSection("history")}>
            <ClockIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">历史与恢复</span>
          </button>
          <button className="sidebar-item" data-active={view === "settings"} onClick={() => navigate("settings")}>
            <GearIcon className="sidebar-item-icon" />
            <span className="sidebar-item-label">设置</span>
          </button>
        </nav>
      </div>

    </aside>
  );
}
