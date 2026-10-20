import { useEffect, useRef, useState } from "react";
import {
  ClockIcon,
  CloseIcon,
  ComposeIcon,
  HistoryIcon,
  ImageIcon,
  MonitorIcon,
  PlusIcon,
  SplitIcon,
} from "../lib/icons";
import type { WorkspaceTabId, WorkspaceTabState } from "../lib/workspace-tabs.mjs";
import "./TitleBarTabs.css";

const WORKSPACES: { id: WorkspaceTabId; label: string; icon: typeof ComposeIcon }[] = [
  { id: "wash", label: "文件洗码", icon: ComposeIcon },
  { id: "history", label: "历史与恢复", icon: HistoryIcon },
  { id: "video", label: "视频截图", icon: ImageIcon },
  { id: "screen", label: "屏幕截图", icon: MonitorIcon },
  { id: "split", label: "视频按大小切分", icon: SplitIcon },
  { id: "shutdown", label: "定时关机", icon: ClockIcon },
];

interface TitleBarTabsProps {
  state: WorkspaceTabState;
  screenCaptureAvailable: boolean;
  pickerOpen: boolean;
  onSelect: (tab: WorkspaceTabId) => void;
  onClose: (tab: WorkspaceTabId) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onOpenPicker: () => void;
  onClosePicker: () => void;
}

export function TitleBarTabs({
  state,
  screenCaptureAvailable,
  pickerOpen,
  onSelect,
  onClose,
  onMove,
  onOpenPicker,
  onClosePicker,
}: TitleBarTabsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draggedTab, setDraggedTab] = useState<WorkspaceTabId | null>(null);
  const availableWorkspaces = WORKSPACES.filter(
    (workspace) => workspace.id !== "screen" || screenCaptureAvailable,
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClosePicker();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClosePicker();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen, onClosePicker]);

  return (
    <div className="titlebar-tabs" ref={rootRef} data-tauri-drag-region>
      <div className="titlebar-tabs-scroll" role="tablist" aria-label="功能标签页">
        {state.openTabs.map((tabId) => {
          const workspace = WORKSPACES.find((item) => item.id === tabId);
          if (!workspace) return null;
          const Icon = workspace.icon;
          const active = state.activeTab === tabId;
          return (
            <div
              className="titlebar-tab"
              key={tabId}
              data-active={active}
              data-dragging={draggedTab === tabId}
              onDragStart={(event) => {
                setDraggedTab(tabId);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tabId);
              }}
              onDragEnd={() => setDraggedTab(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData("text/plain") as WorkspaceTabId;
                const fromIndex = state.openTabs.indexOf(sourceId);
                const toIndex = state.openTabs.indexOf(tabId);
                if (fromIndex >= 0 && toIndex >= 0) onMove(fromIndex, toIndex);
                setDraggedTab(null);
              }}
            >
              <button
                className="titlebar-tab-select"
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={workspace.label}
                title={workspace.label}
                onClick={() => onSelect(tabId)}
                draggable
              >
                <Icon aria-hidden="true" />
                <span>{workspace.label}</span>
              </button>
              <button
                className="titlebar-tab-close"
                type="button"
                aria-label={`关闭${workspace.label}`}
                title={`关闭${workspace.label}`}
                onClick={() => onClose(tabId)}
                draggable={false}
              >
                <CloseIcon aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <div className="titlebar-tab-spacer" data-tauri-drag-region />
      </div>

      <button
        className="titlebar-add-tab"
        type="button"
        aria-label={state.openTabs.length ? "打开功能标签" : "选择要打开的功能"}
        aria-haspopup="menu"
        aria-expanded={pickerOpen}
        title={state.openTabs.length ? "打开功能" : "选择要打开的功能"}
        onClick={onOpenPicker}
      >
        <PlusIcon aria-hidden="true" />
        {state.openTabs.length === 0 && <span>打开功能</span>}
      </button>

      {pickerOpen && (
        <div className="titlebar-tab-menu" role="menu" aria-label="选择功能">
          {availableWorkspaces.map(({ id, label, icon: Icon }) => {
            const open = state.openTabs.includes(id);
            return (
              <button
                className="titlebar-tab-menu-item"
                key={id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(id);
                  onClosePicker();
                }}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
                {open && <small>已打开</small>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
