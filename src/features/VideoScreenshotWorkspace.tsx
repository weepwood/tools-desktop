import { useEffect, useRef, useState } from "react";
import { fileUrl as convertFileSrc } from "../lib/electron";
import { open } from "../lib/dialog";
import { cancelTask, exportContactSheet, extractVideoFrames, getVideoTaskFrames, listVideoTasks, openVideoOutput, probeVideo, videoOutputSuggestion, videoToolStatus } from "../api";
import { ChevronDownIcon, CloseIcon, FolderIcon, ImageIcon } from "../lib/icons";
import { NoticeStack, NoticeToast } from "../components/NoticeToast";
import { useScrollFade } from "../lib/useScrollFade";
import { Button, EmptyState } from "../components/ui";
import { usePersistedState } from "../lib/usePersistedState";
import { taskLabel, useTaskStatus } from "../lib/taskStatus";
import { isTauri, sendNotification } from "../lib/tauri";
import { notifyTaskEndByMail } from "../lib/mail";
import { useSettings } from "../lib/settingsStore";
import type { VideoEvent, VideoFrame, VideoFramePage, VideoInfo, VideoTask, VideoTools } from "../types";
import "./VideoScreenshotWorkspace.css";

const STATUS_LABELS = { running: "进行中", completed: "已完成", cancelled: "已停止", failed: "失败", interrupted: "已中断" };
function errorText(error: unknown) { return typeof error === "string" ? error : error instanceof Error ? error.message : "操作失败，请重试。"; }
function duration(seconds: number | null) {
  if (seconds === null) return "未知时长";
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 3600).toString().padStart(2, "0")}:${Math.floor(value / 60 % 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
function displayPath(path: string) { return path.replace(/^\\\\\?\\/, ""); }
function localTime(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

export function VideoScreenshotWorkspace({ active }: { active: boolean }) {
  const desktop = isTauri();
  const taskStatus = useTaskStatus();
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  const optionsRef = useRef<HTMLDivElement>(null);
  useScrollFade(optionsRef);
  settingsRef.current = settings;
  const [interval, setInterval] = usePersistedState("halo:video-interval", "60");
  const [outputParent, setOutputParent] = usePersistedState("halo:video-output", "");
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [tools, setTools] = useState<VideoTools | null>(null);
  const [toolError, setToolError] = useState("");
  const [checking, setChecking] = useState(false);
  const [probing, setProbing] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ type: "info" | "error" | "success"; text: string } | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [live, setLive] = useState<VideoEvent | null>(null);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [selected, setSelected] = useState<VideoTask | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [page, setPage] = useState(0);
  const [images, setImages] = useState<VideoFramePage | null>(null);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState("");
  const [imageRetry, setImageRetry] = useState(0);
  const [expanded, setExpanded] = useState<VideoFrame | null>(null);
  const lock = useRef(false);
  const initialized = useRef(false);
  const historyRevision = useRef(0);
  const busy = checking || probing || running || dialogBusy || taskStatus.running;
  const seconds = Number(interval);
  const validInterval = /^\d+$/.test(interval) && Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400;
  const estimated = video?.durationSeconds && validInterval ? Math.max(1, Math.round(video.durationSeconds / seconds)) : null;
  const foreignTask = taskStatus.running && !running && !probing && !checking;

  async function refreshHistory(preferredId?: string) {
    const revision = ++historyRevision.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const records = await listVideoTasks();
      if (revision !== historyRevision.current) return;
      setTasks(records);
      setSelected(previous => {
        const id = preferredId ?? previous?.id;
        return records.find(record => record.id === id) ?? previous ?? records[0] ?? null;
      });
    } catch (error) { if (revision === historyRevision.current) setHistoryError(errorText(error)); }
    finally { if (revision === historyRevision.current) setHistoryLoading(false); }
  }

  async function checkTools() {
    if (lock.current || taskStatus.running) return;
    lock.current = true; setChecking(true); setStopping(false); setToolError("");
    try { setTools(await videoToolStatus()); }
    catch (error) { setTools(null); setToolError(errorText(error)); }
    finally { setChecking(false); lock.current = false; }
  }

  useEffect(() => {
    if (!active || !desktop || initialized.current || taskStatus.running) return;
    initialized.current = true;
    void checkTools();
    void refreshHistory();
  }, [active, desktop, taskStatus.running]);

  useEffect(() => {
    if (!video || !desktop) { setSuggestion(""); return; }
    let current = true;
    void videoOutputSuggestion(video.path, outputParent || null).then(path => { if (current) setSuggestion(path); })
      .catch(error => { if (current) { setSuggestion(""); setNotice({ type: "error", text: errorText(error) }); } });
    return () => { current = false; };
  }, [video, outputParent, desktop, selected?.id]);

  useEffect(() => { if (!active) setExpanded(null); }, [active]);

  useEffect(() => {
    setImages(null); setImagesError(""); setExpanded(null);
    if (!selected || selected.status === "running" || running) { setImagesLoading(false); return; }
    let current = true;
    setImagesLoading(true);
    void getVideoTaskFrames(selected.id, page).then(result => {
      if (current) { setImages(result); setPage(result.page); }
    }).catch(error => { if (current) setImagesError(errorText(error)); })
      .finally(() => { if (current) setImagesLoading(false); });
    return () => { current = false; };
  }, [selected, page, imageRetry, running]);

  async function analyze(path: string) {
    setProbing(true); setVideo(null); setNotice(null);
    try { setVideo(await probeVideo(path)); }
    catch (error) { setNotice({ type: "error", text: errorText(error) }); }
    finally { setProbing(false); setStopping(false); }
  }

  async function chooseVideo() {
    if (busy || lock.current) return;
    lock.current = true; setDialogBusy(true);
    try {
      const path = await open({ title: "选择一个视频", multiple: false, directory: false, filters: [{ name: "视频", extensions: ["mp4", "mkv", "mov", "avi", "wmv", "flv", "webm", "m4v", "ts", "mts"] }, { name: "全部文件", extensions: ["*"] }] });
      if (typeof path === "string") await analyze(path);
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
    finally { lock.current = false; setDialogBusy(false); }
  }

  useEffect(() => {
    if (!desktop || !active || busy) { setDragging(false); return; }
    const unlisten = window.halo?.on<{type: string; paths: string[]}>('drag-drop', (payload) => {
      if (payload.type === 'enter' || payload.type === 'over') { setDragging(true); return; }
      setDragging(false);
      if (payload.type !== 'drop' || lock.current) return;
      if (payload.paths.length !== 1) { setNotice({ type: 'error', text: '请一次拖入一个视频文件。' }); return; }
      lock.current = true;
      void analyze(payload.paths[0]).finally(() => { lock.current = false; });
    });
    return () => { unlisten?.(); };
  }, [active, desktop, busy]);

  async function chooseOutput() {
    if (busy || lock.current) return;
    lock.current = true; setDialogBusy(true);
    try {
      const path = await open({ title: "选择截图保存位置", directory: true, multiple: false });
      if (typeof path === "string") setOutputParent(path);
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
    finally { lock.current = false; setDialogBusy(false); }
  }

  async function start() {
    if (busy || lock.current || !video || !validInterval || !tools || !suggestion) return;
    lock.current = true; setRunning(true); setStopping(false); setNotice(null); setLive(null); setExpanded(null); setPage(0);
    try {
      const result = await extractVideoFrames({ videoPath: video.path, intervalSeconds: seconds, outputParent: outputParent || null }, setLive);
      const text = result.historyError ? `图片已保留，但截图记录保存失败：${result.historyError}`
        : result.error ?? `${STATUS_LABELS[result.status]}，保留 ${result.framesWritten} 张图片。`;
      setNotice({ type: result.status === "failed" || result.historyError ? "error" : result.status === "completed" ? "success" : "info", text });
      await refreshHistory(result.id);
      setSelected(result); // Preserve the final result even when its record could not be updated.
      if (settingsRef.current.notifications) void sendNotification("HALO 视频截图", text).catch(() => {});
      void notifyTaskEndByMail("HALO 视频截图", text);
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
    finally { lock.current = false; setRunning(false); setStopping(false); }
  }

  async function stop() {
    setStopping(true);
    try { if (!await cancelTask()) setStopping(false); }
    catch (error) { setStopping(false); setNotice({ type: "error", text: errorText(error) }); }
  }

  async function copy(path: string) {
    try { await navigator.clipboard.writeText(displayPath(path)); setNotice({ type: "success", text: "路径已复制。" }); }
    catch (error) { setNotice({ type: "error", text: `复制失败：${errorText(error)}` }); }
  }

  async function openOutput() {
    if (!selected) return;
    try { await openVideoOutput(selected.id); }
    catch (error) { setNotice({ type: "error", text: errorText(error) }); }
  }

  async function createContactSheet() {
    if (!selected || !images?.frames.length || busy) return;
    try {
      const result = await exportContactSheet(selected.id, page);
      setNotice({ type: "success", text: `已导出 ${result.frames} 张截图的联系表：${result.path}` });
      await openVideoOutput(selected.id);
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
  }

  const percent = running ? live?.progressPercent ?? null : selected?.status === "completed" ? 100 : null;
  const count = running ? live?.framesWritten ?? 0 : images?.total ?? selected?.framesWritten ?? 0;
  const elapsed = running ? live?.elapsedMs ?? 0 : selected?.elapsedMs ?? 0;
  const output = running ? live?.outputDir ?? suggestion : selected?.outputDir;
  const cancelling = stopping || taskStatus.cancelling;
  const taskTitle = running ? cancelling ? "正在停止，保留已完成图片…" : live ? "正在截图" : "正在检查视频…" : selected ? STATUS_LABELS[selected.status] : "等待截图";
  const pages = Math.max(1, Math.ceil((images?.total ?? 0) / 24));

  return <div className="halo-workspace video-workspace" data-dragging={dragging}>
    <header className="halo-page-header"><div><h1>视频截图</h1><p>按时间间隔保存视频画面，全程在本机处理。</p></div><span className="halo-muted">PNG · 原始尺寸</span></header>
    <NoticeStack>
      {!desktop && <div className="halo-notice info">当前为界面预览，视频选择、拖放和截图需在 HALO 桌面版中使用。</div>}
      {foreignTask && <div className="halo-notice info" role="status"><span>{taskLabel(taskStatus.kind)}正在运行，结束后可开始截图。</span><button className="halo-button secondary compact" disabled={cancelling} onClick={() => void stop()}>{cancelling ? "正在停止…" : "停止任务"}</button></div>}
      {notice && <NoticeToast type={notice.type} message={notice.text} onDismiss={() => setNotice(null)} />}
    </NoticeStack>
    <div className="video-layout">
      <aside className="video-options" aria-label="截图设置">
        <div className="video-options-body" ref={optionsRef}>
          <button className="video-drop" disabled={!desktop || busy || !tools} onClick={() => void chooseVideo()}>
            <ImageIcon aria-hidden="true" /><strong>{probing ? "正在读取视频…" : dragging ? "松开以选择视频" : video ? "更换视频" : "拖入一个视频"}</strong><span>或点击选择视频文件</span>
          </button>
          {video && <div className="video-source"><strong title={displayPath(video.path)}>{video.name}</strong><span>{duration(video.durationSeconds)} · {video.width} × {video.height}</span><button className="halo-link-button" onClick={() => void copy(video.path)}>复制源路径</button></div>}
          <div className="halo-field"><label htmlFor="video-interval">截图间隔</label><div className="halo-presets" role="group" aria-label="常用截图间隔">{[10, 30, 60].map(value => <button key={value} className="halo-preset" aria-pressed={seconds === value} disabled={busy} onClick={() => setInterval(String(value))}>{value} 秒</button>)}</div><div className="halo-input-unit"><input id="video-interval" inputMode="numeric" type="number" min="1" max="86400" step="1" value={interval} disabled={busy} onChange={event => setInterval(event.target.value)} aria-invalid={!validInterval} aria-describedby="video-interval-hint" /><span>秒</span></div><small id="video-interval-hint">{validInterval ? "每隔一段时间保存一张图片。" : "请输入 1–86400 的整数秒。"}</small></div>
          <div className="halo-field"><label>保存位置</label><button className="video-folder" disabled={!desktop || busy} onClick={() => void chooseOutput()}><FolderIcon aria-hidden="true" /><span>{outputParent ? displayPath(outputParent) : "与视频放在同一位置"}</span><span>选择</span></button>{outputParent && <button className="halo-link-button" disabled={busy} onClick={() => setOutputParent("")}>恢复为视频所在位置</button>}<small className="video-path">{suggestion ? `输出目录：${displayPath(suggestion)}` : "选择视频后显示输出目录。"}</small><small>已存在同名目录时自动编号，保留原有图片。</small></div>
          <details className="video-engine halo-disclosure"><summary><span>{checking ? "正在检查截图工具…" : tools ? "截图工具已就绪" : "截图工具未就绪"}</span><ChevronDownIcon aria-hidden="true" /></summary>{tools && <><p>{tools.source}</p><p>{tools.ffmpegVersion}</p><p>{tools.ffprobeVersion}</p></>}{toolError && <p role="alert">{toolError}</p>}<button className="halo-button secondary compact" disabled={!desktop || busy} onClick={() => void checkTools()}>重新检查</button></details>
          {toolError && <p className="video-error" role="alert">{toolError}</p>}
          <details className="video-recent halo-disclosure" open><summary><span>最近任务 <small>{tasks.length}</small></span><ChevronDownIcon aria-hidden="true" /></summary><button className="halo-link-button" disabled={!desktop || historyLoading || running} onClick={() => void refreshHistory()}>{historyLoading ? "读取中…" : "刷新记录"}</button>{historyError && <p className="video-error" role="alert">{historyError}</p>}{!tasks.length && !historyLoading && <p className="halo-muted">完成截图后可在这里重新查看。</p>}<div className="video-recent-list">{tasks.map(task => <button key={task.id} aria-pressed={selected?.id === task.id} disabled={running} onClick={() => { setSelected(task); setPage(0); setLive(null); }}><strong>{task.video.name}</strong><span>{localTime(task.startedAt)} · {STATUS_LABELS[task.status]} · {task.framesWritten} 张</span></button>)}</div></details>
        </div>
        <div className="halo-action-footer"><p className="halo-action-hint">{probing ? "正在检查视频内容，可随时停止" : running ? "可停止任务，已完成图片会保留" : estimated ? `预计约 ${estimated} 张，以实际生成数量为准` : video ? "图片数量未知" : "先选择视频，再开始截图"}</p><div className="halo-button-row"><button className="halo-button primary" disabled={!desktop || busy || !video || !validInterval || !tools || !suggestion} onClick={() => void start()}>开始截图</button>{(running || probing || checking) && <button className="halo-button danger" disabled={cancelling} onClick={() => void stop()}>{cancelling ? "正在停止…" : "停止"}</button>}</div><p className="halo-safety-note">读取视频并生成图片，不修改源视频。</p></div>
      </aside>
      <section className="video-results" aria-label="截图结果">
        <div className="video-task"><div className="halo-card-heading"><h2 aria-live="polite">{taskTitle}</h2><span className="halo-muted">{percent !== null ? `${Math.floor(percent)}% · ` : ""}已生成 {count} 张 · {duration(elapsed / 1000)}</span></div>{(running || selected) && <><div className="halo-progress" data-indeterminate={percent === null && running} role="progressbar" aria-label="视频截图进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? "进度暂不可估算" : `${Math.floor(percent)}%`}><div style={{ width: percent === null ? running ? "30%" : "0%" : `${percent}%` }} /></div><p className="video-path">{output ? displayPath(output) : "正在准备输出目录…"}</p>{running && <small className="halo-muted">截图数量和进度为实时估算，任务结束后核对实际图片。</small>}</>}{!running && selected?.error && <p className="video-error">{selected.error}</p>}{!running && selected?.historyError && <p className="video-error">记录保存失败：{selected.historyError}</p>}{!running && selected?.log && <details className="video-log halo-disclosure"><summary><span>查看处理日志</span><ChevronDownIcon aria-hidden="true" /></summary><pre>{selected.log}</pre></details>}</div>
        <div className="video-gallery-head"><h2>截图预览</h2>{selected && !running && <div>{images?.frames.length ? <button className="halo-button secondary compact" disabled={busy || imagesLoading} onClick={() => void createContactSheet()}>导出本页联系表</button> : null}<button className="halo-button secondary compact" onClick={() => void copy(selected.outputDir)}>复制目录路径</button><button className="halo-button secondary compact" onClick={() => void openOutput()}>打开输出目录</button></div>}</div>
        <div className="video-gallery-scroll">
          {imagesLoading ? <p className="video-gallery-note" role="status">正在读取图片和生成缩略图…</p> : imagesError ? <div role="alert"><EmptyState title="无法读取截图" description={imagesError} action={<Button variant="secondary" onClick={() => setImageRetry(value => value + 1)}>重试读取</Button>} /></div> : images?.frames.length ? <div className="video-grid">{images.frames.map(frame => <button className="video-frame" key={frame.path} onClick={() => setExpanded(frame)} aria-label={`放大查看第 ${frame.number} 张截图`}><img src={convertFileSrc(frame.thumbnailPath)} alt={`视频截图 ${frame.number}`} loading="lazy" decoding="async" /><span><strong>{String(frame.number).padStart(3, "0")}</strong>{frame.name}</span></button>)}</div> : <EmptyState icon={<ImageIcon aria-hidden="true" />} title={running ? "正在保存视频画面" : selected ? "暂无可查看的图片" : "把视频画面留在这里"} description={running ? "完成或停止后，可浏览已经生成的截图。" : selected ? "图片可能未生成或已被移动，可打开输出目录检查。" : "拖入一个视频，默认每 60 秒保存一张原尺寸 PNG。"} />}
        </div>
        {images && images.total > 0 && <nav className="halo-pagination" aria-label="截图分页"><span>{images.total} 张 · {images.page + 1} / {pages} 页</span><div><button className="halo-button secondary compact" disabled={imagesLoading || page === 0} onClick={() => setPage(value => value - 1)}>上一页</button><button className="halo-button secondary compact" disabled={imagesLoading || page + 1 >= pages} onClick={() => setPage(value => value + 1)}>下一页</button></div></nav>}
      </section>
    </div>
    {expanded && <ImagePreview frame={expanded} onClose={() => setExpanded(null)} onCopy={copy} />}
  </div>;
}

function ImagePreview({ frame, onClose, onCopy }: { frame: VideoFrame; onClose: () => void; onCopy: (path: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="video-image-dialog" aria-label={`第 ${frame.number} 张截图`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="video-image-panel"><header><strong>{frame.name}</strong><div><button className="halo-button secondary compact" onClick={() => void onCopy(frame.path)}>复制图片路径</button><button className="icon-button" aria-label="关闭图片预览" onClick={onClose}><CloseIcon aria-hidden="true" /></button></div></header><img src={convertFileSrc(frame.path)} alt={`原始尺寸视频截图 ${frame.number}`} /><p>{displayPath(frame.path)}</p></div></dialog>;
}
