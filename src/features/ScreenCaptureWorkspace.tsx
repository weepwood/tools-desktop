import { useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState } from "../components/ui";
import { Calendar } from "../components/Calendar";
import { NoticeStack, NoticeToast } from "../components/NoticeToast";
import { NumericStepper } from "../components/NumericStepper";
import { Select } from "../settings/controls/Select";
import { cancelTask, exportScreenCaptureDay, getScreenCaptureFrames, lastScreenCaptureSession, listScreenCaptureDays, openScreenCaptureDay, screenCaptureDisplays, screenCaptureSupported, startScreenCapture } from "../api";
import { fileUrl } from "../lib/electron";
import { open } from "../lib/dialog";
import { usePersistedState } from "../lib/usePersistedState";
import { taskLabel, useTaskStatus } from "../lib/taskStatus";
import { FolderIcon, MonitorIcon } from "../lib/icons";
import type { ScreenCaptureDay, ScreenCaptureDisplay, ScreenCaptureEvent, ScreenCaptureFrame, ScreenCaptureFramePage } from "../types";
import "./ScreenCaptureWorkspace.css";

type Notice = { type: "info" | "error" | "success"; text: string };
const FPS_OPTIONS = [1, 2, 5, 10, 15, 24, 30];
function errorText(error: unknown) { return typeof error === "string" ? error : error instanceof Error ? error.message : "操作失败，请重试。"; }
function dateLabel(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }); }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function localTime(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function displayPath(value: string) { return value.replace(/^\\\\\?\\/, ""); }

export function ScreenCaptureWorkspace({ active }: { active: boolean }) {
  const taskStatus = useTaskStatus();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [displays, setDisplays] = useState<ScreenCaptureDisplay[]>([]);
  const [displayId, setDisplayId] = usePersistedState("halo:screen-display", "");
  const [interval, setInterval] = usePersistedState("halo:screen-interval", "60");
  const [outputRoot, setOutputRoot] = usePersistedState("halo:screen-output", "");
  const [days, setDays] = useState<ScreenCaptureDay[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [fps, setFps] = usePersistedState("halo:screen-fps", 10);
  const [page, setPage] = useState(0);
  const [frames, setFrames] = useState<ScreenCaptureFramePage | null>(null);
  const [preview, setPreview] = useState<ScreenCaptureFrame | null>(null);
  const [live, setLive] = useState<ScreenCaptureEvent | null>(null);
  const [exportLive, setExportLive] = useState<ScreenCaptureEvent | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busyDialog, setBusyDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const revision = useRef(0);
  const seconds = Number(interval);
  const validInterval = /^\d+$/.test(interval) && Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86400;
  const selectedFps = FPS_OPTIONS.includes(fps) ? fps : 10;
  const foreignTask = taskStatus.running && !running && !exporting;
  const busy = running || exporting || starting || busyDialog || taskStatus.running;
  const selectedDisplay = displays.find(display => display.id === displayId);
  const daysByDate = new Map(days.map(day => [day.date, day]));
  const calendarDate = selectedDate ? new Date(`${selectedDate}T12:00:00`) : undefined;

  async function loadDays(preferred?: string) {
    const current = ++revision.current;
    if (!outputRoot) { setDays([]); setSelectedDate(""); setFrames(null); return; }
    try {
      const result = await listScreenCaptureDays(outputRoot);
      if (current !== revision.current) return;
      setDays(result);
      setSelectedDate(value => {
        const wanted = preferred || value;
        return result.some(day => day.date === wanted) ? wanted : result[0]?.date || "";
      });
    } catch (error) { if (current === revision.current) setNotice({ type: "error", text: errorText(error) }); }
  }

  async function loadDisplays() {
    try {
      const result = await screenCaptureDisplays();
      setDisplays(result);
      setDisplayId(current => result.some(display => display.id === current) ? current : result.find(display => display.primary)?.id || result[0]?.id || "");
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
  }

  useEffect(() => {
    let current = true;
    void screenCaptureSupported().then(value => {
      if (!current) return;
      setSupported(value);
      if (value) {
        void loadDisplays();
        void lastScreenCaptureSession().then(session => {
          if (current && session?.status === "interrupted") setNotice({ type: "info", text: `上次采集异常结束，已保留 ${session.framesWritten} 张截图。` });
        }).catch(error => { if (current) setNotice({ type: "error", text: errorText(error) }); });
      }
    }).catch(error => { if (current) setNotice({ type: "error", text: errorText(error) }); });
    return () => { current = false; };
  }, []);

  useEffect(() => { if (active && supported) void loadDisplays(); }, [active, supported]);
  useEffect(() => { if (supported) void loadDays(); }, [outputRoot, supported]);
  useEffect(() => { setPage(0); }, [selectedDate]);
  useEffect(() => {
    let current = true;
    if (!outputRoot || !selectedDate) { setFrames(null); return; }
    setLoading(true);
    void getScreenCaptureFrames(outputRoot, selectedDate, page).then(result => {
      if (current) { setFrames(result); setPage(result.page); }
    }).catch(error => { if (current) setNotice({ type: "error", text: errorText(error) }); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [outputRoot, selectedDate, page, live?.framesWritten, exporting]);

  async function chooseOutput() {
    if (busy) return;
    setBusyDialog(true);
    try {
      const path = await open({ title: "选择屏幕截图保存位置", directory: true, multiple: false });
      if (typeof path === "string") { setOutputRoot(path); setSelectedDate(""); setDays([]); setFrames(null); }
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
    finally { setBusyDialog(false); }
  }

  async function start() {
    if (busy || !selectedDisplay || !outputRoot || !validInterval) return;
    setStarting(true); setRunning(true); setStopping(false); setLive(null); setNotice(null);
    try {
      const result = await startScreenCapture({ displayId: selectedDisplay.id, intervalSeconds: seconds, outputRoot }, event => {
        setLive(event);
        if (event.kind === "paused") setNotice({ type: "info", text: event.message });
        if (event.kind === "resumed") setNotice({ type: "success", text: event.message });
        if (event.kind === "progress") void loadDays();
        if (event.kind === "failed") setNotice({ type: "error", text: event.message });
      });
      const message = result.historyError ? `截图已保存，但会话记录更新失败：${result.historyError}`
        : result.error || (result.status === "failed" ? "采集失败。" : `采集已结束，共保存 ${result.framesWritten} 张截图。`);
      setNotice({ type: result.status === "failed" || result.historyError ? "error" : "success", text: message });
      await loadDays();
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
    finally { setRunning(false); setStarting(false); setStopping(false); void loadDisplays(); }
  }

  async function stop() {
    setStopping(true);
    try { if (!await cancelTask()) setStopping(false); }
    catch (error) { setStopping(false); setNotice({ type: "error", text: errorText(error) }); }
  }

  async function exportDay() {
    if (!selectedDate || !outputRoot || !frames?.total || busy) return;
    setExporting(true); setExportLive(null); setNotice(null);
    try {
      const result = await exportScreenCaptureDay(outputRoot, selectedDate, selectedFps, setExportLive);
      setNotice({ type: "success", text: `已导出 ${result.frames} 张截图（${result.fps} fps）：${displayPath(result.path)}` });
      await openScreenCaptureDay(outputRoot, selectedDate);
      await loadDays(selectedDate);
    } catch (error) { setNotice({ type: "error", text: errorText(error) }); }
    finally { setExporting(false); }
  }

  async function openDay() {
    if (!selectedDate || !outputRoot) return;
    try { await openScreenCaptureDay(outputRoot, selectedDate); }
    catch (error) { setNotice({ type: "error", text: errorText(error) }); }
  }

  const pages = Math.max(1, Math.ceil((frames?.total || 0) / 24));
  return <div className="halo-workspace screen-capture-workspace">
    <header className="halo-page-header"><div><h1>屏幕截图</h1><p>按间隔保存屏幕画面，按日期浏览并导出缩时视频。</p></div><span className="halo-muted">本机处理 · PNG</span></header>
    <div className="screen-capture-content">
      {!window.halo && <div className="halo-notice info">界面预览模式不支持系统屏幕采集。</div>}
      {supported === false && <div className="halo-notice info">此功能仅支持 Windows 和 macOS。</div>}
      {foreignTask && <div className="halo-notice info" role="status"><span>{taskLabel(taskStatus.kind)}正在运行，结束后可开始截图。</span><Button compact disabled={taskStatus.cancelling} onClick={() => void stop()}>{taskStatus.cancelling ? "正在停止…" : "停止任务"}</Button></div>}
      {notice && <NoticeStack><NoticeToast type={notice.type} message={notice.text} onDismiss={() => setNotice(null)} /></NoticeStack>}
      <div className="screen-capture-grid">
        <aside className="screen-capture-sidebar">
          <section className="screen-capture-options">
            <Card title="采集设置" className="screen-card">
              <div className="halo-field"><label htmlFor="screen-display">目标显示器</label>
                <Select id="screen-display" className="screen-display-select" value={displayId} disabled={busy || !displays.length} onChange={setDisplayId} options={displays.length ? displays.map(display => ({ value: display.id, label: `${display.name}${display.primary ? " · 主显示器" : ""} · ${display.width} × ${display.height}` })) : [{ value: "", label: "未检测到显示器" }]} />
              </div>
              <div className="halo-field"><label htmlFor="screen-interval">截图间隔</label><NumericStepper id="screen-interval" label="截图间隔" value={interval} min={1} max={86400} disabled={busy} onChange={setInterval} /></div>
              <div className="halo-field"><label>保存位置</label><button className="screen-folder" disabled={busy} onClick={() => void chooseOutput()}><FolderIcon aria-hidden="true" /><span>{outputRoot ? displayPath(outputRoot) : "选择本地文件夹"}</span><span>选择</span></button></div>
              {running ? <Button variant="danger" block disabled={stopping || taskStatus.cancelling} onClick={() => void stop()}>{stopping || taskStatus.cancelling ? "正在停止…" : <span className="screen-running-button-label"><span>已保存 {live?.framesWritten ?? 0} 张</span><strong>停止采集</strong></span>}</Button>
                : <Button variant="primary" block disabled={!selectedDisplay || !outputRoot || !validInterval || busy || supported !== true} onClick={() => void start()} icon={<MonitorIcon aria-hidden="true" />}>{starting ? "正在启动…" : "开始定时截图"}</Button>}
              {running && live?.kind === "paused" && <p className="screen-paused-note">解锁或唤醒后会自动继续采集。</p>}
            </Card>
          </section>

          <section className="screen-calendar-sidebar">
            <div className="screen-calendar-heading"><strong>每日截图</strong><span>{days.length} 天</span></div>
            {!outputRoot ? <EmptyState title="先选择保存位置" description="截图和每日视频都会保存在本地目录。" />
              : days.length ? <Calendar
                aria-label="每日截图日期"
                value={calendarDate}
                defaultMonth={calendarDate}
                disabledDate={date => !daysByDate.has(dateKey(date))}
                dayLabel={date => {
                  const day = daysByDate.get(dateKey(date));
                  const label = date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
                  return day ? `${label}，${day.frameCount} 张截图` : label;
                }}
                onChange={date => setSelectedDate(dateKey(date))}
              /> : <EmptyState title="还没有截图" description="开始定时截图后，每一天的画面会显示在这里。" />}
          </section>
        </aside>

        <section className="screen-gallery">
          <Card title={selectedDate ? dateLabel(selectedDate) : "截图预览"} meta={selectedDate ? `${frames?.total || 0} 张` : undefined}
            actions={selectedDate ? <button className="halo-link-button" onClick={() => void openDay()}>打开文件夹</button> : undefined}
            className="screen-card screen-gallery-card" flush>
            {selectedDate && <div className="screen-export-bar">
              <label htmlFor="screen-fps">视频帧率</label>
              <Select id="screen-fps" className="screen-fps-select" value={String(selectedFps)} disabled={busy} onChange={value => setFps(Number(value))} options={FPS_OPTIONS.map(value => ({ value: String(value), label: `${value} fps` }))} />
              <Button variant="primary" disabled={!frames?.total || busy} onClick={() => void exportDay()}>{exporting ? "正在导出…" : "导出 MP4"}</Button>
            </div>}
            {exporting && <div className="screen-export-progress" role="status"><span>{exportLive?.message || "正在编码…"}</span><div className="halo-progress"><span style={{ width: `${exportLive?.progressPercent ?? 0}%` }} /></div></div>}
            {!outputRoot ? <EmptyState title="请选择截图保存目录" description="设置本地根目录后即可查看日期图库。" />
              : loading ? <div className="screen-loading">正在读取截图…</div>
              : !selectedDate || !frames?.total ? <EmptyState title="选择有截图的日期" description="原始 PNG 会在导出视频后保留。" />
              : <>
                <div className="screen-frame-grid">{frames.frames.map(frame => <button key={frame.name} className="screen-frame" onClick={() => setPreview(frame)}>
                  <div className="screen-frame-preview">
                    <img src={fileUrl(frame.path)} alt={localTime(frame.capturedAt)} loading="lazy" />
                    <span aria-hidden="true">{new Date(frame.capturedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  </div>
                </button>)}</div>
                {pages > 1 && <div className="screen-pagination"><Button compact disabled={page <= 0} onClick={() => setPage(value => Math.max(0, value - 1))}>上一页</Button><span>{page + 1} / {pages}</span><Button compact disabled={page + 1 >= pages} onClick={() => setPage(value => Math.min(pages - 1, value + 1))}>下一页</Button></div>}
              </>}
          </Card>
        </section>
      </div>
    </div>
    {preview && <ScreenImagePreview frame={preview} onClose={() => setPreview(null)} />}
  </div>;
}

function ScreenImagePreview({ frame, onClose }: { frame: ScreenCaptureFrame; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  return <dialog ref={dialog} className="screen-image-dialog" aria-label="屏幕截图预览" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="screen-image-panel"><header><strong>{localTime(frame.capturedAt)}</strong><button className="halo-button secondary compact" onClick={onClose}>关闭</button></header><img src={fileUrl(frame.path)} alt={`屏幕截图 ${localTime(frame.capturedAt)}`} /><p>{displayPath(frame.path)}</p></div>
  </dialog>;
}
