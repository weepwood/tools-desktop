import { useEffect, useState } from "react";
import { cancelTask, listHistory, listSplitTasks, listVideoTasks, openSplitOutput, openVideoOutput } from "../api";
import type { SessionRecord, VideoSplitRecord, VideoTask } from "../types";
import { taskLabel, useTaskStatus } from "../lib/taskStatus";
import { PanelBottomIcon, CloseIcon, ClockIcon } from "../lib/icons";
import { ResizeHandle } from "./ResizeHandle";
import { PANEL_LIMITS } from "./AppShell";
import { isTauri } from "../lib/tauri";
import "./BottomPanel.css";

interface BottomPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenHistory: () => void;
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
type RecentTask = { id: string; kind: "wash" | "restore" | "video" | "split"; title: string; detail: string; at: string; recordId?: string };
const statusText = (status: string) => ({ completed: "已完成", cancelled: "已停止", failed: "失败", skipped: "已跳过", interrupted: "中断", running: "进行中" } as Record<string, string>)[status] ?? status;
const dateText = (value: string) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(); };

export function BottomPanel({ open, onClose, onOpenHistory, size, dragging, onSize, onStow, onUnstow, onDragging }: BottomPanelProps) {
  const status = useTaskStatus();
  const [recent, setRecent] = useState<RecentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const desktop = isTauri();
  const progress = status.progress as Record<string, unknown> | null;
  const percent = typeof progress?.progressPercent === "number"
    ? Math.max(0, Math.min(100, progress.progressPercent))
    : typeof progress?.completed === "number" && typeof progress?.total === "number" && progress.total > 0
      ? Math.max(0, Math.min(100, progress.completed / progress.total * 100)) : null;

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    setLoading(true); setError("");
    void Promise.allSettled([listHistory(), listVideoTasks(), listSplitTasks()]).then(([washResult, videoResult, splitResult]) => {
      if (!current) return;
      const rows: RecentTask[] = [];
      if (washResult.status === "fulfilled") for (const session of washResult.value as SessionRecord[]) {
        const status = session.interrupted ? "interrupted" : session.cancelled ? "cancelled" : session.failed ? "failed" : "completed";
        rows.push({ id: `wash-${session.id}`, recordId: session.id, kind: "wash", title: session.rootPath, at: session.finishedAt || session.startedAt, detail: `${statusText(status)} · ${session.success} 成功 · ${session.failed} 失败` });
        for (const run of session.restoreRuns || []) rows.push({ id: `restore-${run.id}`, recordId: session.id, kind: "restore", title: session.rootPath, at: run.finishedAt || run.startedAt, detail: `${statusText(run.cancelled ? "cancelled" : run.failed ? "failed" : "completed")} · ${run.success} 成功 · ${run.failed} 失败` });
      }
      if (videoResult.status === "fulfilled") for (const task of videoResult.value as VideoTask[])
        rows.push({ id: `video-${task.id}`, recordId: task.id, kind: "video", title: task.video.name, at: task.finishedAt || task.startedAt, detail: `${statusText(task.status)} · ${task.framesWritten} 张截图` });
      if (splitResult.status === "fulfilled") for (const task of splitResult.value as VideoSplitRecord[])
        rows.push({ id: `split-${task.id}`, recordId: task.id, kind: "split", title: task.videoName, at: task.finishedAt || task.startedAt, detail: `${statusText(task.status)} · ${task.parts.length} 个分片` });
      rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      setRecent(rows.slice(0, 12));
      const rejected = [washResult, videoResult, splitResult].filter(result => result.status === "rejected").length;
      if (rejected) setError("部分历史记录暂时无法读取。可在对应工作区查看详细诊断。");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [desktop, status.running, refresh]);

  async function stop() {
    try { await cancelTask(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function openOutput(item: RecentTask) {
    if (!item.recordId) return;
    try {
      if (item.kind === "video") await openVideoOutput(item.recordId);
      else if (item.kind === "split") await openSplitOutput(item.recordId);
      else onOpenHistory();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return (
    <section className="bottom-panel" data-open={open}>
      <div className="bottom-panel-inner">
        <div className="bottom-panel-tabs">
          <div className="bottom-panel-tab" data-active="true" aria-current="page">
            <PanelBottomIcon />
            <span>任务中心</span>
          </div>
          <div className="bottom-panel-spacer" />
          <button className="halo-link-button" onClick={onOpenHistory}><ClockIcon aria-hidden="true" />打开历史</button>
          <button className="icon-button" title="关闭任务中心" aria-label="关闭任务中心" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="bottom-panel-content">
          <div className="task-center">
            {status.running ? <section className="task-center-active" aria-live="polite">
              <div className="task-center-heading"><strong>{taskLabel(status.kind)}正在运行</strong><span>{percent === null ? "处理中" : `${Math.floor(percent)}%`}</span></div>
              <div className="halo-progress" data-indeterminate={percent === null} role="progressbar" aria-label="当前任务进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><div style={{ width: `${percent ?? 30}%` }} /></div>
              {typeof progress?.message === "string" && <p>{progress.message}</p>}
              {typeof progress?.currentFile === "string" && <p className="task-center-current" title={progress.currentFile}>{progress.currentFile}</p>}
              <button className="halo-button danger compact" disabled={status.cancelling} onClick={() => void stop()}>{status.cancelling ? "正在停止…" : "停止当前任务"}</button>
            </section> : <p className="task-center-idle">当前没有运行中的任务。</p>}
            <div className="task-center-recent-head"><strong>最近任务</strong><button className="halo-link-button" disabled={!desktop || loading} onClick={() => setRefresh(value => value + 1)}>{loading ? "读取中…" : `刷新 · ${recent.length} 条`}</button></div>
            {error && <p className="task-center-error" role="alert">{error}</p>}
            {!desktop ? <p className="task-center-idle">历史任务需要在 HALO 桌面版中读取。</p> : recent.length ? <div className="task-center-list">{recent.map(item => <div className="task-center-item" key={item.id}>
              <div className="task-center-item-main"><strong>{item.title}</strong><span>{taskLabel(item.kind === "split" ? "video-split" : item.kind)} · {dateText(item.at)} · {item.detail}</span></div>
              <button className="halo-link-button" onClick={() => void openOutput(item)}>{item.kind === "wash" || item.kind === "restore" ? "查看历史" : "打开输出"}</button>
            </div>)}</div> : !loading && <p className="task-center-idle">完成任务后会在这里汇总结果。</p>}
          </div>
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
