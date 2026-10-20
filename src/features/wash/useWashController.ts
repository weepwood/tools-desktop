import { useEffect, useMemo, useRef, useState } from "react";
import { confirm, open, save } from "../../lib/dialog";
import {
  cancelTask,
  clearHistory,
  exportSessionCsv,
  listHistory,
  restoreSession,
  scanFiles,
  washFiles,
} from "../../api";
import type {
  FileRecord,
  RestoreEvent,
  ScanRequest,
  ScanSummary,
  SessionRecord,
  VerificationMode,
  WashEvent,
  WashMode,
  WashRequest,
} from "../../types";
import { usePersistedState } from "../../lib/usePersistedState";
import { useSettings } from "../../lib/settingsStore";
import { isTauri, sendNotification } from "../../lib/tauri";
import {
  formatBytes,
  normalizeError,
  percentOf,
  verificationDescription,
  verificationLabel,
} from "../../lib/format";
import { useTaskStatus } from "../../lib/taskStatus";
import { DEFAULT_EXTENSIONS } from "./presets";

export interface Notice {
  type: "info" | "success" | "error";
  text: string;
}

export interface ResultCounts {
  success: number;
  failed: number;
  skipped: number;
}

/**
 * All state and side effects of the wash screen, with no markup.
 *
 * The component used to mix this orchestration with 350 lines of JSX, which
 * made both halves hard to reason about: a UI tweak had to be made inside a
 * function that also handled destructive file operations. Everything that
 * touches the file system, the dialog bridge or the task channel now lives
 * here, and the views below are pure projections of `ctrl`.
 */
export function useWashController() {
  /* ------------------------------------------------------------ settings */
  const [rootPath, setRootPath] = usePersistedState("halo:root", "");
  const [extensionInput, setExtensionInput] = usePersistedState(
    "halo:extensions",
    DEFAULT_EXTENSIONS.join(", "),
  );
  const [recursive, setRecursive] = usePersistedState("halo:recursive", true);
  const [skipHidden, setSkipHidden] = usePersistedState("halo:skip-hidden", true);
  const [skipSmall, setSkipSmall] = usePersistedState("halo:skip-small", true);
  const [minSizeMb, setMinSizeMb] = usePersistedState("halo:min-size", 5);
  const [mode, setMode] = usePersistedState<WashMode>("halo:mode", "recoverable");
  const [verificationMode, setVerificationMode] = usePersistedState<VerificationMode>(
    "halo:verification",
    "sampled",
  );
  const [skipAlreadyWashed, setSkipAlreadyWashed] = usePersistedState(
    "halo:skip-washed",
    true,
  );

  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const desktopMode = isTauri();
  const taskStatus = useTaskStatus();

  /* ---------------------------------------------------------------- state */
  const actionLock = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoringSessionId, setRestoringSessionId] = useState("");
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [liveResults, setLiveResults] = useState<FileRecord[]>([]);
  const [progressCompleted, setProgressCompleted] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [currentFile, setCurrentFile] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoreCompleted, setRestoreCompleted] = useState(0);
  const [restoreTotal, setRestoreTotal] = useState(0);
  const [restoreCurrentFile, setRestoreCurrentFile] = useState("");
  const [restoreResultCount, setRestoreResultCount] = useState(0);
  const [resultCounts, setResultCounts] = useState<ResultCounts>({
    success: 0,
    failed: 0,
    skipped: 0,
  });

  /* Event coalescing: the main process can emit one event per file, so the
     view is flushed at most ten times a second. */
  const pendingResults = useRef<FileRecord[]>([]);
  const pendingWashEvent = useRef<WashEvent | null>(null);
  const washTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRequest = useRef(0);

  const externalTaskRunning = taskStatus.running && !running && !restoring && !scanning;
  const busy = running || restoring || scanning || confirming || taskStatus.running;

  const extensions = useMemo(
    () => [
      ...new Set(
        extensionInput
          .split(/[，,;；\s]+/)
          .map((value) => value.trim().toLowerCase().replace(/^\.+/, ""))
          .filter(Boolean),
      ),
    ],
    [extensionInput],
  );

  const progressPercent = percentOf(progressCompleted, progressTotal);
  const scanKey = JSON.stringify([
    rootPath,
    recursive,
    skipHidden,
    skipSmall,
    minSizeMb,
    extensions,
  ]);

  /* ------------------------------------------------------------ lifecycle */
  // Any change to scope invalidates the previous scan.
  useEffect(() => {
    setScanSummary(null);
  }, [scanKey]);

  useEffect(() => {
    if (!desktopMode) {
      setNotice({
        type: "info",
        text: "当前为界面预览，文件扫描和恢复需在 HALO 桌面版中使用。",
      });
      return;
    }
    if (!taskStatus.running) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopMode, taskStatus.running]);

  useEffect(() => {
    return () => {
      if (washTimer.current) clearTimeout(washTimer.current);
    };
  }, []);

  /* -------------------------------------------------------------- helpers */
  function buildScanRequest(): ScanRequest {
    return {
      rootPath,
      recursive,
      skipHidden,
      skipSmall,
      minSizeBytes: Math.max(0, Math.round(minSizeMb * 1024 * 1024)),
      extensions,
    };
  }

  function buildWashRequest(): WashRequest {
    return { ...buildScanRequest(), mode, verificationMode, skipAlreadyWashed };
  }

  function showNotice(type: Notice["type"], text: string) {
    setNotice({ type, text });
  }

  function dismissNotice() {
    setNotice(null);
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      showNotice("success", "文件路径已复制。");
    } catch (error) {
      showNotice("error", `复制路径失败：${normalizeError(error)}`);
    }
  }

  function notifyFinished(text: string) {
    if (settingsRef.current.notifications) {
      void sendNotification("HALO 任务结果", text).catch(() => {});
    }
  }

  function flushWashEvents() {
    if (washTimer.current) clearTimeout(washTimer.current);
    washTimer.current = null;
    const batch = pendingResults.current;
    pendingResults.current = [];
    if (batch.length) {
      setLiveResults((previous) => previous.concat(batch));
      setResultCounts((previous) => {
        const next = { ...previous };
        batch.forEach((file) => next[file.status]++);
        return next;
      });
    }
    const event = pendingWashEvent.current;
    pendingWashEvent.current = null;
    if (event) {
      setProgressCompleted(event.completed);
      setProgressTotal(event.total);
      setCurrentFile(event.currentFile ?? "");
    }
  }

  /* --------------------------------------------------------------- tasks */
  async function chooseFolder() {
    if (busy || actionLock.current) return;
    actionLock.current = true;
    setConfirming(true);
    try {
      const selected = await open({
        title: "选择要洗码的文件夹",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string") {
        setRootPath(selected);
        setScanSummary(null);
      }
    } catch (error) {
      showNotice("error", normalizeError(error));
    } finally {
      actionLock.current = false;
      setConfirming(false);
    }
  }

  async function handleScan() {
    if (busy || actionLock.current) return;
    if (!rootPath) return showNotice("error", "请先选择文件夹。");
    actionLock.current = true;
    setScanning(true);
    setScanSummary(null);
    try {
      const summary = await scanFiles(buildScanRequest());
      setScanSummary(summary);
      showNotice(
        summary.unreadable ? "info" : "success",
        `扫描完成，共找到 ${summary.totalFiles} 个候选文件，${summary.unreadable} 个项目无法读取。`,
      );
    } catch (error) {
      showNotice("error", normalizeError(error));
    } finally {
      setScanning(false);
      setCancelling(false);
      actionLock.current = false;
    }
  }

  async function handleStart() {
    if (busy || actionLock.current) return;
    if (!rootPath) return showNotice("error", "请先选择文件夹。");
    actionLock.current = true;
    setConfirming(true);
    const request = buildWashRequest();
    try {
      let summary = scanSummary;
      if (!summary) {
        setScanning(true);
        summary = await scanFiles(request);
        setScanning(false);
        setScanSummary(summary);
      }
      if (!summary.totalFiles) {
        showNotice("info", "没有符合条件的文件，请调整处理范围。");
        return;
      }
      const accepted = await confirm(
        `将处理 ${summary.totalFiles} 个文件，共 ${formatBytes(summary.totalBytes)}。${summary.unreadable ? `\n有 ${summary.unreadable} 个项目无法读取，将被忽略。` : ""}\n\n校验方式：${verificationLabel(request.verificationMode)}。${verificationDescription(request.verificationMode)}\n\n洗码会直接修改原文件。恢复记录不是备份。是否继续？`,
        { title: "确认执行洗码", kind: "warning" },
      );
      if (!accepted) return;
      setConfirming(false);
      setRunning(true);
      setCancelling(false);
      setCurrentSession(null);
      flushWashEvents();
      setLiveResults([]);
      setResultCounts({ success: 0, failed: 0, skipped: 0 });
      setProgressCompleted(0);
      setProgressTotal(summary.totalFiles);
      setCurrentFile("");
      showNotice(
        "info",
        `正在使用${verificationLabel(request.verificationMode)}处理文件，恢复记录会随任务保存。`,
      );
      const session = await washFiles(
        { ...request, expectedScanFingerprint: summary.fingerprint },
        handleWashEvent,
      );
      flushWashEvents();
      setCurrentSession(session);
      setLiveResults(session.files);
      setResultCounts({
        success: session.success,
        failed: session.failed,
        skipped: session.skipped,
      });
      setProgressCompleted(session.files.length);
      setProgressTotal(session.total);
      if (session.historyError)
        showNotice(
          "error",
          `恢复记录保存出现问题：${session.historyError}。请保留应用数据目录中的任务日志。`,
        );
      else if (session.taskError)
        showNotice(
          "error",
          `任务因日志保存异常停止：${session.taskError}。已处理文件的恢复记录已保存到历史。`,
        );
      else if (session.cancelled)
        showNotice(
          "info",
          `任务已停止：成功 ${session.success}，失败 ${session.failed}，跳过 ${session.skipped}。`,
        );
      else if (session.failed)
        showNotice("error", `任务完成，但有 ${session.failed} 个文件失败。`);
      else
        showNotice("success", `洗码完成：成功 ${session.success}，跳过 ${session.skipped}。`);
      await loadHistory();
      notifyFinished(
        `洗码${session.cancelled ? "已停止" : "完成"}：成功 ${session.success}，失败 ${session.failed}，跳过 ${session.skipped}${session.historyError ? "；恢复记录保存异常" : ""}。`,
      );
    } catch (error) {
      showNotice("error", normalizeError(error));
      setScanSummary(null);
    } finally {
      flushWashEvents();
      setRunning(false);
      setScanning(false);
      setConfirming(false);
      actionLock.current = false;
      setCancelling(false);
      setCurrentFile("");
    }
  }

  function handleWashEvent(event: WashEvent) {
    pendingWashEvent.current = event;
    if (event.result) pendingResults.current.push(event.result);
    if (!washTimer.current) washTimer.current = setTimeout(flushWashEvents, 100);
    if (event.message) showNotice("info", event.message);
  }

  function handleRestoreEvent(event: RestoreEvent) {
    setRestoreCompleted(event.completed);
    setRestoreTotal(event.total);
    setRestoreCurrentFile(event.currentFile ?? "");
    if (event.result) setRestoreResultCount((count) => count + 1);
    if (event.message) showNotice("info", event.message);
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      if (!(await cancelTask())) {
        setCancelling(false);
        showNotice("info", "当前没有正在运行的后端任务。");
      }
    } catch (error) {
      setCancelling(false);
      showNotice("error", normalizeError(error));
    }
  }

  /* ------------------------------------------------------------- history */
  async function loadHistory() {
    const requestId = ++historyRequest.current;
    setHistoryLoading(true);
    try {
      const summaries = await listHistory();
      if (requestId !== historyRequest.current) return;
      setHistory(summaries);
    } catch (error) {
      if (requestId === historyRequest.current) showNotice("error", normalizeError(error));
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false);
    }
  }

  async function handleRestore(session: SessionRecord, file?: FileRecord, targetPath?: string) {
    if (busy || actionLock.current) return;
    const count = file
      ? 1
      : session.files.filter((item) => item.status === "success" || item.pending).length;
    if (!count) return showNotice("error", "这条记录中没有可校验恢复的文件。");
    const target = file
      ? targetPath && targetPath !== file.path
        ? `移动后的文件：${targetPath}`
        : `文件：${file.relativePath}`
      : `本次任务中的 ${count} 个可校验文件`;
    const selectedMode = file?.verificationMode ?? session.verificationMode ?? "full";
    actionLock.current = true;
    setConfirming(true);
    try {
      const accepted = await confirm(
        `将恢复${target}。\n\n程序会按${verificationLabel(selectedMode)}核对文件大小、尾部标记和对应内容校验；选择移动后文件时，还会使用它的当前位置进行恢复。不一致时不会截断文件。是否继续？`,
        { title: "从历史记录恢复", kind: "warning" },
      );
      if (!accepted) return;
      setConfirming(false);
      setRestoring(true);
      setCancelling(false);
      setRestoringSessionId(session.id);
      setRestoreCompleted(0);
      setRestoreTotal(count);
      setRestoreCurrentFile("");
      setRestoreResultCount(0);
      showNotice("info", "正在校验洗码后状态并移除历史尾部字节。");
      const result = await restoreSession(
        session.id,
        file ? [file.path] : [],
        file && targetPath && targetPath !== file.path ? { [file.path]: targetPath } : {},
        handleRestoreEvent,
      );
      if (result.historyError)
        showNotice(
          "error",
          `文件恢复已执行：成功 ${result.success}，失败 ${result.failed}；历史更新失败：${result.historyError}。`,
        );
      else if (result.cancelled)
        showNotice(
          "info",
          `恢复已停止：成功 ${result.success}，失败 ${result.failed}，跳过 ${result.skipped}。`,
        );
      else if (result.failed)
        showNotice("error", `恢复完成，但有 ${result.failed} 个文件未成功恢复，请查看具体原因。`);
      else showNotice("success", `恢复完成：成功 ${result.success}，跳过 ${result.skipped}。`);
      if (result.historyError) {
        setHistory((previous) =>
          previous.map((item) =>
            item.id === session.id
              ? { ...session, restoreRuns: [result, ...session.restoreRuns] }
              : item,
          ),
        );
      } else await loadHistory();
      notifyFinished(
        `恢复${result.cancelled ? "已停止" : "完成"}：成功 ${result.success}，失败 ${result.failed}，跳过 ${result.skipped}。`,
      );
    } catch (error) {
      showNotice("error", normalizeError(error));
    } finally {
      setRestoring(false);
      setConfirming(false);
      actionLock.current = false;
      setCancelling(false);
      setRestoringSessionId("");
      setRestoreCurrentFile("");
    }
  }

  async function handleRestoreFromNewLocation(session: SessionRecord, file: FileRecord) {
    if (busy || actionLock.current) return;
    actionLock.current = true;
    setConfirming(true);
    let selected;
    try {
      selected = await open({ title: "选择移动后的文件", multiple: false, directory: false });
    } catch (error) {
      showNotice("error", normalizeError(error));
    } finally {
      actionLock.current = false;
      setConfirming(false);
    }
    if (typeof selected === "string") await handleRestore(session, file, selected);
  }

  async function handleClearHistory() {
    if (busy || historyLoading || actionLock.current) return;
    actionLock.current = true;
    setConfirming(true);
    try {
      const accepted = await confirm(
        "清除历史后将失去自动恢复所需的尾部字节与校验记录。不会改动任何文件。是否继续？",
        { title: "清除历史记录", kind: "warning" },
      );
      if (!accepted) return;
      await clearHistory();
      historyRequest.current++;
      setHistory([]);
      showNotice("success", "历史记录已清除。");
    } catch (error) {
      showNotice("error", normalizeError(error));
    } finally {
      actionLock.current = false;
      setConfirming(false);
    }
  }

  async function handleExport(session: SessionRecord) {
    if (busy || actionLock.current) return;
    actionLock.current = true;
    setConfirming(true);
    try {
      const outputPath = await save({
        title: "导出洗码记录",
        defaultPath: `halo-${session.id.slice(0, 8)}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outputPath) return;
      await exportSessionCsv(session.id, outputPath);
      showNotice("success", "CSV 记录已导出。");
    } catch (error) {
      showNotice("error", normalizeError(error));
    } finally {
      actionLock.current = false;
      setConfirming(false);
    }
  }

  return {
    // settings + derived
    rootPath,
    setRootPath,
    extensionInput,
    setExtensionInput,
    recursive,
    setRecursive,
    skipHidden,
    setSkipHidden,
    skipSmall,
    setSkipSmall,
    minSizeMb,
    setMinSizeMb,
    mode,
    setMode,
    verificationMode,
    setVerificationMode,
    skipAlreadyWashed,
    setSkipAlreadyWashed,
    extensions,
    desktopMode,
    taskStatus,
    // status
    busy,
    confirming,
    scanning,
    running,
    cancelling,
    restoring,
    restoringSessionId,
    externalTaskRunning,
    // data
    scanSummary,
    currentSession,
    liveResults,
    progressCompleted,
    progressTotal,
    progressPercent,
    currentFile,
    resultCounts,
    history,
    historyLoading,
    restoreProgress: {
      sessionId: restoringSessionId,
      completed: restoreCompleted,
      total: restoreTotal,
      currentFile: restoreCurrentFile,
      cancelling,
    },
    restoreResultCount,
    notice,
    // actions
    chooseFolder,
    handleScan,
    handleStart,
    handleCancel,
    loadHistory,
    handleRestore,
    handleRestoreFromNewLocation,
    handleClearHistory,
    handleExport,
    copyPath,
    showNotice,
    dismissNotice,
  };
}

export type WashController = ReturnType<typeof useWashController>;
