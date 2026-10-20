import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getTaskStatus } from "../api";
import { isTauri } from "./tauri";
import type { TaskStatus } from "../types";

const IDLE: TaskStatus = { running: false, kind: null, cancelling: false };
const TaskContext = createContext<TaskStatus>(IDLE);

export function taskLabel(kind: string | null) {
  return ({ wash: "文件洗码", restore: "文件恢复", scan: "文件扫描", video: "视频截图", "video-split": "视频切分", "video-probe": "视频检查", history: "历史整理" } as Record<string, string>)[kind ?? ""] ?? "文件任务";
}

export function TaskStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState(IDLE);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let revision = 0;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const cleanup = window.halo!.on<TaskStatus>("task-status", (payload) => {
        revision += 1;
        if (active) setStatus(payload);
      });
      if (!active) { cleanup(); return; }
      unlisten = cleanup;
      const currentRevision = revision;
      const initial = await getTaskStatus();
      if (active && revision === currentRevision) setStatus(initial);
    })().catch((error: unknown) => console.error("读取任务状态失败", error));
    return () => { active = false; unlisten?.(); };
  }, []);
  return <TaskContext.Provider value={status}>{children}</TaskContext.Provider>;
}

export function useTaskStatus() { return useContext(TaskContext); }
