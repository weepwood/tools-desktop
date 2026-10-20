import { useEffect, useMemo, useRef, useState } from "react";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import {
  cancelTask,
  clearHistory,
  exportSessionCsv,
  listHistory,
  restoreSession,
  scanFiles,
  washFiles,
} from "../api";
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
} from "../types";
import type { XimaSection } from "../shell/LeftSidebar";
import { usePersistedState } from "../lib/usePersistedState";
import { useSettings } from "../lib/settingsStore";
import { isTauri, sendNotification } from "../lib/tauri";
import { ProjectIcon, SearchIcon, ChevronDownIcon, CloseIcon } from "../lib/icons";
import "./XimaWorkspace.css";
import { HistoryView } from "./HistoryView";
import { taskLabel, useTaskStatus } from "../lib/taskStatus";

const DEFAULT_EXTENSIONS = [
  "mp4", "mkv", "mov", "avi", "wmv", "flv", "webm",
  "jpg", "jpeg", "png", "gif", "webp", "heic",
  "zip", "rar", "7z", "tar", "pdf", "mp3", "flac", "m4a", "wav",
];
const PAGE_SIZE = 50;
const EXTENSION_PRESETS = [
  { label: "常用", values: DEFAULT_EXTENSIONS },
  { label: "视频", values: ["mp4", "mkv", "mov", "avi", "wmv", "flv", "webm"] },
  { label: "图片", values: ["jpg", "jpeg", "png", "gif", "webp", "heic"] },
  { label: "音频", values: ["mp3", "flac", "m4a", "wav"] },
  { label: "文档 / 压缩", values: ["pdf", "zip", "rar", "7z", "tar"] },
];
const RESULT_FILTERS = [
  { value: "all", label: "全部" },
  { value: "failed", label: "失败" },
  { value: "success", label: "成功" },
  { value: "skipped", label: "跳过" },
];

interface XimaWorkspaceProps {
  section: XimaSection;
}

export function XimaWorkspace({ section }: XimaWorkspaceProps) {
  const [rootPath, setRootPath] = usePersistedState("xima:root", "");
  const [extensionInput, setExtensionInput] = usePersistedState("xima:extensions", DEFAULT_EXTENSIONS.join(", "));
  const [recursive, setRecursive] = usePersistedState("xima:recursive", true);
  const [skipHidden, setSkipHidden] = usePersistedState("xima:skip-hidden", true);
  const [skipSmall, setSkipSmall] = usePersistedState("xima:skip-small", true);
  const [minSizeMb, setMinSizeMb] = usePersistedState("xima:min-size", 5);
  const [mode, setMode] = usePersistedState<WashMode>("xima:mode", "recoverable");
  const [verificationMode, setVerificationMode] = usePersistedState<VerificationMode>("xima:verification", "sampled");
  const [skipAlreadyWashed, setSkipAlreadyWashed] = usePersistedState("xima:skip-washed", true);
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const desktopMode = isTauri();
  const [confirming, setConfirming] = useState(false);
  const taskStatus = useTaskStatus();
  const actionLock = useRef(false);
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
  const [notice, setNotice] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoreCompleted, setRestoreCompleted] = useState(0);
  const [restoreTotal, setRestoreTotal] = useState(0);
  const [restoreCurrentFile, setRestoreCurrentFile] = useState("");
  const [restoreResultCount, setRestoreResultCount] = useState(0);
  const pendingResults = useRef<FileRecord[]>([]);
  const pendingWashEvent = useRef<WashEvent | null>(null);
  const washTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resultCounts, setResultCounts] = useState({ success: 0, failed: 0, skipped: 0 });
  const [resultFilter, setResultFilter] = useState("all");
  const [resultQuery, setResultQuery] = useState("");
  const [resultPage, setResultPage] = useState(0);
  const historyRequest = useRef(0);

  const externalTaskRunning = taskStatus.running && !running && !restoring && !scanning;
  const busy = running || restoring || scanning || confirming || taskStatus.running;
  const extensions = useMemo(() => [...new Set(extensionInput
    .split(/[，,;；\s]+/)
    .map((value) => value.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean))], [extensionInput]);
  const progressPercent = progressTotal ? Math.min(100, Math.round(progressCompleted / progressTotal * 100)) : 0;
  const { success: successCount, failed: failedCount, skipped: skippedCount } = resultCounts;
  const filteredResults = useMemo(() => {
    const query = resultQuery.trim().toLowerCase();
    if (resultFilter === "all" && !query) return liveResults;
    return liveResults.filter((file) => (resultFilter === "all" || file.status === resultFilter)
      && (!query || file.relativePath.toLowerCase().includes(query) || file.error?.toLowerCase().includes(query)));
  }, [liveResults, resultFilter, resultQuery]);
  const visiblePage = Math.min(resultPage, Math.max(0, Math.ceil(filteredResults.length / PAGE_SIZE) - 1));
  const scanKey = JSON.stringify([rootPath, recursive, skipHidden, skipSmall, minSizeMb, extensions]);

  useEffect(() => { setScanSummary(null); }, [scanKey]);
  useEffect(() => { setResultPage(0); }, [resultFilter, resultQuery]);

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

  function verificationLabel(value?: VerificationMode) {
    switch (value ?? "full") {
      case "fast": return "快速校验";
      case "sampled": return "抽样校验";
      case "full": return "完整校验";
    }
  }

  function verificationDescription(value?: VerificationMode) {
    switch (value ?? "full") {
      case "fast": return "仅核对文件大小、身份、修改时间和尾部标记，不读取文件正文。";
      case "sampled": return "读取头尾区块和 8 个随机区块，通常每个文件约 10 MiB。";
      case "full": return "完整读取文件一次并记录洗码前后 SHA-256，最严格但最慢。";
    }
  }

  function showNotice(type: "info" | "success" | "error", text: string) {
    setNotice({ type, text });
  }

  function normalizeError(error: unknown) {
    return typeof error === "string" ? error : error instanceof Error ? error.message : "发生未知错误。";
  }

  function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
  }

  function shortHash(hash: string) {
    return hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : "—";
  }

  async function copyPath(path: string) {
    try { await navigator.clipboard.writeText(path); showNotice("success", "文件路径已复制。"); }
    catch (error) { showNotice("error", `复制路径失败：${normalizeError(error)}`); }
  }

  async function chooseFolder() {
    if (busy || actionLock.current) return;
    actionLock.current = true;
    setConfirming(true);
    try {
      const selected = await open({ title: "选择要洗码的文件夹", directory: true, multiple: false });
      if (typeof selected === "string") { setRootPath(selected); setScanSummary(null); }
    } catch (error) { showNotice("error", normalizeError(error)); }
    finally { actionLock.current = false; setConfirming(false); }
  }

  function notifyFinished(text: string) {
    if (settingsRef.current.notifications) void sendNotification("XIMA 任务结果", text).catch(() => {});
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

  async function handleScan() {
    if (busy || actionLock.current) return;
    if (!rootPath) return showNotice("error", "请先选择文件夹。");
    actionLock.current = true;
    setScanning(true);
    setScanSummary(null);
    try {
      const summary = await scanFiles(buildScanRequest());
      setScanSummary(summary);
      showNotice(summary.unreadable ? "info" : "success", `扫描完成，共找到 ${summary.totalFiles} 个候选文件，${summary.unreadable} 个项目无法读取。`);
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
      if (!summary.totalFiles) { showNotice("info", "没有符合条件的文件，请调整处理范围。"); return; }
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
      setResultPage(0);
      setProgressCompleted(0);
      setProgressTotal(summary.totalFiles);
      setCurrentFile("");
      showNotice("info", `正在使用${verificationLabel(request.verificationMode)}处理文件，恢复记录会随任务保存。`);
      const session = await washFiles({ ...request, expectedScanFingerprint: summary.fingerprint }, handleWashEvent);
      flushWashEvents();
      setCurrentSession(session);
      setLiveResults(session.files);
      setResultCounts({ success: session.success, failed: session.failed, skipped: session.skipped });
      setProgressCompleted(session.files.length);
      setProgressTotal(session.total);
      if (session.historyError) showNotice("error", `恢复记录保存出现问题：${session.historyError}。请保留应用数据目录中的任务日志。`);
      else if (session.taskError) showNotice("error", `任务因日志保存异常停止：${session.taskError}。已处理文件的恢复记录已保存到历史。`);
      else if (session.cancelled) showNotice("info", `任务已停止：成功 ${session.success}，失败 ${session.failed}，跳过 ${session.skipped}。`);
      else if (session.failed) showNotice("error", `任务完成，但有 ${session.failed} 个文件失败。`);
      else showNotice("success", `洗码完成：成功 ${session.success}，跳过 ${session.skipped}。`);
      await loadHistory();
      notifyFinished(`洗码${session.cancelled ? "已停止" : "完成"}：成功 ${session.success}，失败 ${session.failed}，跳过 ${session.skipped}${session.historyError ? "；恢复记录保存异常" : ""}。`);
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
      if (!await cancelTask()) { setCancelling(false); showNotice("info", "当前没有正在运行的后端任务。"); }
    } catch (error) {
      setCancelling(false);
      showNotice("error", normalizeError(error));
    }
  }

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
    const count = file ? 1 : session.files.filter((item) => item.status === "success" || item.pending).length;
    if (!count) return showNotice("error", "这条记录中没有可校验恢复的文件。");
    const target = file
      ? targetPath && targetPath !== file.path ? `移动后的文件：${targetPath}` : `文件：${file.relativePath}`
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
      if (result.historyError) showNotice("error", `文件恢复已执行：成功 ${result.success}，失败 ${result.failed}；历史更新失败：${result.historyError}。`);
      else if (result.cancelled) showNotice("info", `恢复已停止：成功 ${result.success}，失败 ${result.failed}，跳过 ${result.skipped}。`);
      else if (result.failed) showNotice("error", `恢复完成，但有 ${result.failed} 个文件未成功恢复，请查看具体原因。`);
      else showNotice("success", `恢复完成：成功 ${result.success}，跳过 ${result.skipped}。`);
      if (result.historyError) {
        setHistory((previous) => previous.map((item) => item.id === session.id ? { ...session, restoreRuns: [result, ...session.restoreRuns] } : item));
      } else await loadHistory();
      notifyFinished(`恢复${result.cancelled ? "已停止" : "完成"}：成功 ${result.success}，失败 ${result.failed}，跳过 ${result.skipped}。`);
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
    try { selected = await open({ title: "选择移动后的文件", multiple: false, directory: false }); }
    catch (error) { showNotice("error", normalizeError(error)); }
    finally { actionLock.current = false; setConfirming(false); }
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
    } finally { actionLock.current = false; setConfirming(false); }
  }

  async function handleExport(session: SessionRecord) {
    if (busy || actionLock.current) return;
    actionLock.current = true;
    setConfirming(true);
    try {
    const outputPath = await save({
      title: "导出洗码记录",
      defaultPath: `xima-${session.id.slice(0, 8)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!outputPath) return;
      await exportSessionCsv(session.id, outputPath);
      showNotice("success", "CSV 记录已导出。");
    } catch (error) {
      showNotice("error", normalizeError(error));
    } finally { actionLock.current = false; setConfirming(false); }
  }

  useEffect(() => {
    if (!desktopMode) { showNotice("info", "当前为界面预览，文件扫描和恢复需在 XIMA 桌面版中使用。"); return; }
    if (!taskStatus.running) void loadHistory();
  }, [desktopMode, taskStatus.running]);

  useEffect(() => {
    return () => { if (washTimer.current) clearTimeout(washTimer.current); };
  }, []);

  return (
    <div className="xima-workspace">
      {section === "history" && <header className="xima-page-header">
        <div>
          <h1>历史与恢复</h1>
          <p>查看本机任务记录，验证文件后恢复原始内容。</p>
        </div>
        <div className="xima-toolbar-actions">
            <button className="xima-button secondary" disabled={!desktopMode || historyLoading || busy} onClick={() => void loadHistory()}>{historyLoading ? "读取中…" : "刷新"}</button>
            <button className="xima-button danger" disabled={!history.length || historyLoading || busy} onClick={() => void handleClearHistory()}>清除历史</button>
        </div>
      </header>}

      <div className="xima-notice-stack">
      {externalTaskRunning && <div className="xima-notice info" role="status"><span>{taskLabel(taskStatus.kind)}正在运行，结束后可继续操作。</span><button className="xima-button secondary" disabled={cancelling || taskStatus.cancelling} onClick={() => void handleCancel()}>{cancelling || taskStatus.cancelling ? "正在停止…" : "停止任务"}</button></div>}
      {currentSession?.historyError && <div className="xima-notice error" role="alert">恢复记录保存异常：{currentSession.historyError}。请保留任务日志，并在处理新文件前检查历史记录。</div>}

      {notice && (
        <div className={`xima-notice ${notice.type}`} role="status">
          <span>{notice.text}</span>
          <button aria-label="关闭提示" onClick={() => setNotice(null)}><CloseIcon aria-hidden="true" /></button>
        </div>
      )}
      </div>

      {section === "wash" ? (
        <section className="xima-wash-layout" aria-label="文件洗码">
          <h1 className="xima-sr-only">文件处理工作区</h1>
          <aside className="xima-options" aria-label="处理设置">
            <div className="xima-options-body">
            <div className="xima-card-heading"><h2>处理设置</h2><span className="xima-muted">本机处理</span></div>
            <button className="xima-folder-picker" disabled={!desktopMode || busy} onClick={() => void chooseFolder()}>
              <ProjectIcon className="xima-folder-icon" aria-hidden="true" />
              <span><strong>{rootPath ? "已选择文件夹" : "选择文件夹"}</strong><small title={rootPath}>{rootPath || "使用系统文件夹选择器"}</small></span>
              <span className="xima-folder-action">{rootPath ? "更换" : "浏览"}</span>
            </button>

            <div className="xima-field">
              <label htmlFor="extensions">文件扩展名</label>
              <div className="xima-presets" role="group" aria-label="常用文件类型">{EXTENSION_PRESETS.map((preset) => <button key={preset.label} className="xima-preset" disabled={busy} aria-pressed={extensions.length === preset.values.length && preset.values.every((value) => extensions.includes(value))} onClick={() => setExtensionInput(preset.values.join(", "))}>{preset.label}</button>)}</div>
              <textarea id="extensions" name="extensions" value={extensionInput} onChange={(event) => setExtensionInput(event.target.value)} disabled={busy} rows={3} spellCheck={false} autoComplete="off" placeholder="例如 mp4, mkv, zip…" aria-describedby="extensions-hint" />
              <small id="extensions-hint">逗号或空格分隔，留空处理全部类型。</small>
            </div>

            <div className="xima-settings-section">
              <h3>处理方式</h3>
              <div className="xima-field">
                <label htmlFor="mode">洗码模式</label>
                <select id="mode" name="mode" value={mode} onChange={(event) => setMode(event.target.value as WashMode)} disabled={busy}>
                  <option value="recoverable">可识别标记 · 32 字节</option>
                  <option value="legacy">兼容模式 · 5 字节</option>
                </select>
              </div>
            <div className="xima-field">
              <label htmlFor="verification-mode">校验级别</label>
              <select id="verification-mode" name="verification" value={verificationMode} onChange={(event) => setVerificationMode(event.target.value as VerificationMode)} disabled={busy} aria-describedby="verification-hint">
                <option value="fast">快速 · 不读取文件正文</option>
                <option value="sampled">抽样 · 默认推荐</option>
                <option value="full">完整 · 全文件 SHA-256</option>
              </select>
              <small id="verification-hint">{verificationDescription(verificationMode)}</small>
            </div>
            <ToggleRow title="跳过已标记文件" description="避免重复追加，仅适用于 32 字节模式" checked={skipAlreadyWashed} disabled={busy || mode === "legacy"} onChange={setSkipAlreadyWashed} />
            </div>

            <details className="xima-range-options">
              <summary><span>筛选与排除<small>{recursive ? "含子文件夹" : "仅当前文件夹"} · {skipSmall ? `大于 ${minSizeMb} MB` : "不限大小"}</small></span><ChevronDownIcon aria-hidden="true" /></summary>
              <div className="xima-options-list">
              <ToggleRow title="递归子文件夹" description="包含全部子目录" checked={recursive} disabled={busy} onChange={setRecursive} />
              <ToggleRow title="跳过隐藏项" description="忽略以 . 或 # 开头的项目" checked={skipHidden} disabled={busy} onChange={setSkipHidden} />
              <ToggleRow title="跳过小文件" description="降低文本和配置文件误操作风险" checked={skipSmall} disabled={busy} onChange={setSkipSmall} />
              <div className="xima-field">
                <label htmlFor="min-size">最小文件大小</label>
                <div className="xima-input-unit"><input id="min-size" name="min-size" type="number" min="0" value={minSizeMb} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setMinSizeMb(Math.max(0, value)); }} disabled={busy || !skipSmall} /><span>MB</span></div>
              </div>
              </div>
            </details>
            </div>

            <div className="xima-action-footer">
            <p className="xima-action-hint">{running ? "任务进行中，可随时停止" : scanning ? "正在扫描文件范围…" : !rootPath ? "先选择文件夹，再预扫描确认范围" : scanSummary ? `已找到 ${scanSummary.totalFiles} 个候选文件` : "开始前将自动扫描并确认范围"}</p>
            <div className="xima-button-row">
              <button className="xima-button secondary" disabled={!desktopMode || busy || !rootPath} onClick={() => void handleScan()}>{scanning ? "扫描中…" : "预扫描"}</button>
              <button className="xima-button primary" disabled={!desktopMode || busy || !rootPath || scanSummary?.totalFiles === 0} onClick={() => void handleStart()}>{running ? "正在洗码…" : "开始洗码"}</button>
              {(scanning || running) && <button className="xima-button danger" disabled={cancelling} onClick={() => void handleCancel()}>{cancelling ? "正在停止…" : "停止"}</button>}
            </div>
            <p className="xima-safety-note">直接修改原文件。重要文件建议先备份，并选择完整校验。</p>
            </div>
          </aside>

          <div className="xima-results-column">
            <article className="xima-card xima-scan-card">
              <div className="xima-card-heading"><h2>扫描概览</h2><span className={`xima-scan-state ${scanSummary ? "ready" : ""}`}>{scanning ? "扫描中…" : scanSummary ? "已就绪" : "尚未扫描"}</span></div>
              <div className="xima-metrics">
                <Metric label="候选文件" value={scanSummary?.totalFiles ?? "—"} detail={scanSummary ? "个" : "等待扫描"} />
                <Metric label="总体积" value={scanSummary ? formatBytes(scanSummary.totalBytes) : "—"} detail="扫描范围" />
                <Metric label="已过滤" value={scanSummary ? scanSummary.hiddenSkipped + scanSummary.smallSkipped + scanSummary.extensionSkipped : "—"} detail="个项目" />
              </div>
              {!!scanSummary?.preview.length && <details className="xima-preview-details"><summary>查看候选文件预览<ChevronDownIcon aria-hidden="true" /></summary><div className="xima-file-preview">
                <div className="xima-preview-head"><span>文件</span><span>大小</span></div>
                {scanSummary.preview.slice(0, 8).map((file) => <div className="xima-preview-row" key={file.path}><span title={file.path}>{file.relativePath}</span><b>{formatBytes(file.size)}</b></div>)}
                {scanSummary.totalFiles > 8 && <p className="xima-muted">另有 {scanSummary.totalFiles - 8} 个文件未显示</p>}
              </div></details>}
              {!!scanSummary?.unreadable && <details className="xima-scan-warnings"><summary>{scanSummary.unreadable} 个项目无法读取，查看原因</summary>{scanSummary.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
            </article>

            <article className="xima-card xima-task-card">
              <div className="xima-card-heading"><div className="xima-task-title"><span className={`xima-task-dot ${running ? "running" : currentSession ? currentSession.cancelled ? "stopped" : currentSession.failed ? "failed" : "done" : ""}`} aria-hidden="true" /><h2>{running ? "正在处理" : currentSession ? currentSession.cancelled ? "任务已停止" : "任务已结束" : "等待执行"}</h2></div><div className="xima-status-chips"><span className="success">成功 {successCount}</span><span className="failed">失败 {failedCount}</span><span className="skipped">跳过 {skippedCount}</span></div>{running && <button className="xima-button danger compact" disabled={cancelling} onClick={() => void handleCancel()}>{cancelling ? "正在停止…" : "停止"}</button>}</div>
              {(running || currentSession) && <><Progress percent={progressPercent} completed={progressCompleted} total={progressTotal} /><p className="xima-current-file" title={currentFile}>{currentFile || (running ? "正在扫描处理范围…" : currentSession?.historyError ? "恢复记录保存异常，请保留任务日志并检查历史" : "处理记录已保留，可前往历史校验并恢复")}</p></>}
            </article>

            <article className="xima-card xima-results-card">
              <div className="xima-card-heading"><div className="xima-results-title"><h2>处理结果</h2><span className="xima-result-count">{liveResults.length} 个文件</span></div><span className="xima-muted">文件大小与校验对比</span></div>
              <div className="xima-result-tools"><div className="xima-filter-tabs" role="group" aria-label="结果状态筛选">{RESULT_FILTERS.map((filter) => <button key={filter.value} aria-pressed={resultFilter === filter.value} onClick={() => setResultFilter(filter.value)}>{filter.label}</button>)}</div><div className="xima-search-field"><SearchIcon aria-hidden="true" /><input aria-label="搜索文件名或错误原因" name="result-search" value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} placeholder="搜索文件名或错误原因…" autoComplete="off" spellCheck={false} />{resultQuery && <button aria-label="清空搜索" onClick={() => setResultQuery("")}>×</button>}</div></div>
              <div className="xima-table-wrap"><table><thead><tr><th>文件</th><th>状态</th><th>洗码前</th><th>洗码后</th><th>耗时</th><th>说明</th></tr></thead><tbody>
                {filteredResults.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE).map((item) => <tr key={item.path}><td className="xima-file-cell" title={item.path}><span>{item.relativePath}</span><button className="xima-link-button" onClick={() => void copyPath(item.path)}>复制路径</button></td><td>{item.pending ? <span className="xima-status cancelled">待核验</span> : <Status status={item.status} />}</td><td><span>{formatBytes(item.beforeSize)}</span><code title={item.beforeSha256}>{item.verificationMode === "sampled" ? `${item.samples.length} 个抽样区块` : shortHash(item.beforeSha256)}</code></td><td><span>{formatBytes(item.afterSize)}</span><code title={item.afterSha256}>{item.verificationMode === "sampled" && item.status === "success" ? "尾部已验证" : shortHash(item.afterSha256)}</code></td><td>{item.durationMs} ms</td><td className="xima-error-reason">{item.error || "—"}</td></tr>)}
                {!filteredResults.length && <tr><td colSpan={6} className="xima-table-empty"><div className="xima-result-empty"><ProjectIcon aria-hidden="true" /><strong>{liveResults.length ? "没有匹配的文件" : running ? "正在等待文件处理结果" : "准备处理文件"}</strong><p>{liveResults.length ? "调整状态筛选或搜索关键词，查看其他结果。" : running ? "完成一个文件后，大小与校验结果就会显示在这里。" : "选择文件夹，预扫描确认范围，再开始洗码。"}</p>{liveResults.length > 0 && <button className="xima-button secondary compact" onClick={() => { setResultQuery(""); setResultFilter("all"); }}>清除筛选</button>}</div></td></tr>}
              </tbody></table></div>
              <Pagination total={filteredResults.length} page={visiblePage} onChange={setResultPage} />
            </article>
          </div>
        </section>
      ) : (
        <HistoryView
          history={history} loading={historyLoading} busy={busy || historyLoading} desktopMode={desktopMode}
          onExport={handleExport} onRestore={handleRestore} onRelocate={handleRestoreFromNewLocation} onCopyPath={copyPath}
          progress={restoring ? { sessionId: restoringSessionId, completed: restoreCompleted, total: restoreTotal, currentFile: restoreCurrentFile, cancelling } : null}
          onCancel={handleCancel}
        />
      )}
      {restoreResultCount > 0 && <span className="xima-sr-only" aria-live="polite">已处理 {restoreResultCount} 个恢复结果</span>}
    </div>
  );
}

function ToggleRow({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="xima-toggle-row"><span><strong>{title}</strong><small>{description}</small></span><span className="xima-toggle-control"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="xima-toggle-track" aria-hidden="true" /></span></label>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="xima-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Progress({ percent, completed, total }: { percent: number; completed: number; total: number }) {
  return <><div className="xima-progress" role="progressbar" aria-label="文件处理进度" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuetext={`${completed} / ${total} 个文件`}><div style={{ width: `${percent}%` }} /></div><div className="xima-progress-meta"><strong>{percent}%</strong><span>{completed} / {total} 文件</span></div></>;
}

function Status({ status }: { status: "success" | "failed" | "skipped" }) {
  const label = status === "success" ? "成功" : status === "failed" ? "失败" : "跳过";
  return <span className={`xima-status ${status}`}>{label}</span>;
}

function Pagination({ total, page, onChange, size = PAGE_SIZE }: { total: number; page: number; onChange: (page: number) => void; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className="xima-pagination"><span>共 {total} 条 · 第 {page + 1} / {pages} 页</span><div><button className="xima-button secondary compact" disabled={page === 0} onClick={() => onChange(page - 1)}>上一页</button><button className="xima-button secondary compact" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>下一页</button></div></div>;
}
