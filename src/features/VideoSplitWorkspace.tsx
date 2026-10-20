import { useEffect, useRef, useState } from "react";
import { cancelTask, listSplitTasks, openSplitOutput, probeVideo, splitVideoBySize } from "../api";
import { open } from "../lib/dialog";
import { usePersistedState } from "../lib/usePersistedState";
import { isTauri, sendNotification } from "../lib/tauri";
import { useTaskStatus, taskLabel } from "../lib/taskStatus";
import { useSettings } from "../lib/settingsStore";
import { CloseIcon, FolderIcon, SplitIcon } from "../lib/icons";
import type { VideoInfo, VideoSplitRecord, VideoSplitEvent } from "../types";
import "./XimaWorkspace.css";
import "./VideoScreenshotWorkspace.css";
import "./VideoSplitWorkspace.css";

const labels: Record<VideoSplitRecord["status"], string> = {
  running: "处理中", completed: "已完成", skipped: "无需切分",
  cancelled: "已取消", failed: "失败", interrupted: "意外中断",
};
const prettyBytes = (value: number) => value >= 1e9
  ? (value / 1e9).toFixed(2) + " GB"
  : value >= 1e6 ? (value / 1e6).toFixed(1) + " MB"
  : (value / 1e3).toFixed(1) + " KB";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function VideoSplitWorkspace({ active }: { active: boolean }) {
  const desktop = isTauri();
  const taskStatus = useTaskStatus();
  const { settings } = useSettings();
  const [maxSizeText, setMaxSizeText] = usePersistedState("xima:split-max-gb", "4.5");
  const [outputParent, setOutputParent] = usePersistedState("xima:split-output", "");
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ type: "info" | "error" | "success"; text: string } | null>(null);
  const [recent, setRecent] = useState<VideoSplitRecord[]>([]);
  const [selected, setSelected] = useState<VideoSplitRecord | null>(null);
  const [progress, setProgress] = useState<VideoSplitEvent | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const lock = useRef(false);
  const maxSizeGb = Number(maxSizeText);
  const validSize = maxSizeText.trim().length > 0 && Number.isFinite(maxSizeGb)
    && maxSizeGb >= 0.00001 && maxSizeGb <= 10000;
  const maxSizeBytes = maxSizeGb * 1e9;
  const overLimit = video?.sizeBytes !== undefined && validSize && video.sizeBytes > maxSizeBytes;
  const busy = probing || running || taskStatus.running;
  const foreignTask = taskStatus.running && !running && !probing;
  const progressPercent = progress?.progressPercent ?? (selected?.status === "completed" ? 100 : null);

  async function refresh() {
    setLoadingHistory(true);
    try {
      const records = await listSplitTasks();
      setRecent(records);
      setSelected(previous => previous ? records.find(r => r.id === previous.id) ?? previous : records[0] ?? null);
    } catch(error) {
      setNotice({ type: "error", text: "读取分片历史失败：" + errorMessage(error) });
    } finally { setLoadingHistory(false); }
  }
  useEffect(() => { if (desktop) void refresh(); }, [desktop]);

  async function analyze(file: string) {
    setProbing(true);
    setVideo(null);
    setNotice(null);
    try { setVideo(await probeVideo(file)); }
    catch(error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setProbing(false); }
  }
  async function chooseVideo() {
    if (busy || lock.current) return;
    lock.current = true;
    try {
      const choice = await open({ title: "选择需要按大小切分的视频", multiple: false,
        directory: false, filters: [
          { name: "常用视频格式", extensions: ["mp4","mkv","mov","m4v","webm","avi","ts","wmv","flv"] },
          { name: "全部文件", extensions: ["*"] },
        ]});
      if(typeof choice==="string")await analyze(choice);
    } catch(error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { lock.current = false; }
  }
  async function chooseOutput() {
    if (busy || lock.current) return;
    lock.current = true;
    try {
      const choice = await open({ title: "选择分片保存位置", directory: true, multiple: false });
      if (typeof choice==="string")setOutputParent(choice);
    } catch(error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { lock.current = false; }
  }
  useEffect(() => {
    if(!desktop || !active || busy){setDragging(false);return;}
    const stop=window.xima?.on<{type:string;paths:string[]}>("drag-drop", payload=>{
      if(payload.type==="enter"||payload.type==="over"){setDragging(true);return;}
      setDragging(false);
      if(payload.type!=="drop"||lock.current)return;
      if(payload.paths.length!==1){setNotice({type:"error",text:"请一次拖入一个视频文件。"});return;}
      lock.current=true;
      void analyze(payload.paths[0]).finally(()=>{lock.current=false;});
    });
    return ()=>{stop?.();};
  },[active,desktop,busy]);

  async function start() {
    if (busy || lock.current || !video || !validSize || !overLimit) return;
    lock.current=true;setRunning(true);setStopping(false);setProgress(null);setNotice(null);
    try {
      const result=await splitVideoBySize({
        videoPath:video.path,maxSizeGb,outputParent:outputParent || null,
      },setProgress);
      setSelected(result);
      await refresh();
      const message=result.status==="completed"
        ? "切分完成，共生成 "+result.parts.length+" 个分片，所有文件均不超过 "+maxSizeText+" GB。"
        : result.status==="skipped" ? "文件大小未超过阈值，无需切分。"
        : result.error ?? "任务已停止。";
      setNotice({type:result.status==="completed"?"success":result.status==="failed"?"error":"info",text:message});
      if(settings.notifications)void sendNotification("XIMA 视频切分",message).catch(()=>{});
    } catch(error) {setNotice({type:"error",text:errorMessage(error)});}
    finally {setRunning(false);setStopping(false);lock.current=false;}
  }
  async function stop() {
    if(stopping)return;
    setStopping(true);
    try {if(!await cancelTask())setStopping(false);}
    catch(error){setStopping(false);setNotice({type:"error",text:errorMessage(error)});}
  }
  async function openFolder(record: VideoSplitRecord) {
    try {await openSplitOutput(record.id);}
    catch(error){setNotice({type:"error",text:errorMessage(error)});}
  }
  const parts = selected?.parts ?? [];
  return <div className="xima-workspace video-workspace video-split-workspace" data-dragging={dragging}>
    <header className="xima-page-header">
      <div><h1>视频按大小切分</h1>
        <p>把超出指定容量的视频分成多个可独立播放的文件，默认每个不超过 4.5 GB。</p></div>
      <span className="xima-muted">FFmpeg · 无损封装切分</span>
    </header>
    <div className="xima-notice-stack">
      {!desktop && <div className="xima-notice info">请在 Electron 桌面版中选择视频并执行切分。</div>}
      {foreignTask && <div className="xima-notice info" role="status">
        <span>{taskLabel(taskStatus.kind)}正在运行，完成后才能切分视频。</span>
      </div>}
      {notice && <div className={"xima-notice "+notice.type} role={notice.type==="error"?"alert":"status"}>
        <span>{notice.text}</span><button aria-label="关闭提示" onClick={()=>setNotice(null)}>
          <CloseIcon aria-hidden="true"/></button></div>}
    </div>
    <div className="video-layout">
      <aside className="video-options" aria-label="切分设置">
        <div className="video-options-body">
          <button className="video-drop" disabled={!desktop||busy} onClick={()=>void chooseVideo()}>
            <SplitIcon aria-hidden="true"/><strong>{probing?"正在读取视频…":dragging?"松开以载入视频":video?"更换视频":"拖入一个视频"}</strong>
            <span>或点击选择本地文件</span>
          </button>
          {video && <div className="video-source">
            <strong title={video.path}>{video.name}</strong>
            <span>{video.sizeBytes!==undefined?prettyBytes(video.sizeBytes)+" · ":""}{video.width} × {video.height}
              {video.durationSeconds ? " · "+Math.round(video.durationSeconds)+" 秒":""}</span>
          </div>}
          <div className="xima-field">
            <label htmlFor="split-max-size">单个分片最大大小</label>
            <div className="xima-presets" role="group" aria-label="分片大小预设">
              {[2,4.5,8].map(value=><button key={value} className="xima-preset"
                aria-pressed={maxSizeGb===value} disabled={busy} onClick={()=>setMaxSizeText(String(value))}>
                {value} GB</button>)}
            </div>
            <div className="xima-input-unit"><input id="split-max-size" type="number"
              min="0.00001" max="10000" step="0.1" inputMode="decimal"
              value={maxSizeText} disabled={busy} onChange={event=>setMaxSizeText(event.target.value)}
              aria-invalid={!validSize} aria-describedby="split-size-hint"/><span>GB</span></div>
            <small id="split-size-hint">{validSize
              ? "1 GB = 1,000,000,000 字节，输出分片会逐个核验。"
              : "请输入大于等于 0.00001 且不超过 10000 的 GB 数值。"}</small>
          </div>
          <div className="xima-field"><label>保存位置</label>
            <button className="video-folder" disabled={!desktop||busy} onClick={()=>void chooseOutput()}>
              <FolderIcon aria-hidden="true"/>
              <span>{outputParent || "与原视频同目录（创建独立子文件夹）"}</span><span>选择</span>
            </button>
            {outputParent && <button className="xima-link-button" disabled={busy}
              onClick={()=>setOutputParent("")}>恢复默认位置</button>}
            <small>以“视频名_分片”创建新文件夹，避免覆盖现有文件。</small>
          </div>
          <details className="video-engine"><summary>切分方式与兼容性</summary>
            <p>优先通过视频关键帧直接切分，不重新编码、不改变原视频。</p>
            <p>分片太大时自动缩短时长重试，最多尝试 9 次。若关键帧间隔过长，可能无法满足严格大小上限，届时会报错而不是生成超限的成品。</p>
            <p>MP4、MKV、MOV、WebM 尽量保留原封装；其他格式通常输出为 MKV。部分编码或字幕流可能无法直接复制。</p>
          </details>
        </div>
        <div className="xima-action-footer">
          <p className="xima-action-hint">{!video?"先选择一个视频"
            : !validSize?"请输入有效的分片大小"
            : !overLimit?"文件没有超过目标大小，无需切分"
            : "预计至少 "+Math.ceil((video.sizeBytes ?? 0)/maxSizeBytes)+" 个分片（以结果为准）"}</p>
          <div className="xima-button-row">
            <button className="xima-button primary" disabled={!desktop||busy||!video||!validSize||!overLimit}
              onClick={()=>void start()}>开始切分</button>
            {running && <button className="xima-button danger" disabled={stopping||taskStatus.cancelling}
              onClick={()=>void stop()}>{stopping?"正在停止…":"停止"}</button>}
          </div>
          <p className="xima-safety-note">原视频不会删除或修改。请预留充足磁盘空间；取消任务会删除当前尝试产生的临时文件。</p>
        </div>
      </aside>
      <section className="video-results" aria-label="切分结果">
        <div className="video-task">
          <div className="xima-card-heading"><h2>{running?"正在切分视频":selected?labels[selected.status]:"等待任务"}</h2>
            <span className="xima-muted">{running?"第 "+(progress?.attempt??1)+" 次尝试":selected?
              selected.parts.length+" 个分片":""}</span></div>
          {(running||selected) && <div className="xima-progress" data-indeterminate={running&&progressPercent===null}
            role="progressbar" aria-label="视频切分进度" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={progressPercent??undefined}>
            <div style={{width:(progressPercent??(running?30:0))+"%"}}/></div>}
          {running && progress?.message && <p className="video-path">{progress.message}</p>}
          {!running && selected?.error && <p className="video-error" role="alert">{selected.error}</p>}
          {!running && selected?.historyError && <p className="video-error">历史保存异常：{selected.historyError}</p>}
          {selected?.outputDir && <p className="video-path">{selected.outputDir}</p>}
        </div>
        <div className="video-gallery-head"><h2>分片文件</h2>
          {selected?.outputDir && !running &&
            <button className="xima-button secondary compact" onClick={()=>void openFolder(selected)}>
              打开输出目录</button>}
        </div>
        <div className="video-gallery-scroll split-results-scroll">
          {parts.length ? <div className="split-file-list" role="list">{parts.map((part,index)=>
            <div className="split-file-row" role="listitem" key={part.path}>
              <span className="split-file-index">{String(index+1).padStart(2,"0")}</span>
              <div className="split-file-description"><strong>{part.name}</strong>
                <span title={part.path}>{part.path}</span></div>
              <span className="split-file-size">{prettyBytes(part.sizeBytes)}</span>
            </div>)}</div>
            : <div className="video-empty"><SplitIcon aria-hidden="true"/>
              <strong>{selected?.status==="skipped"?"此视频无需切分":"等待生成分片"}</strong>
              <p>{selected?.status==="failed"?"任务失败，请检查错误信息与磁盘空间。"
                :"文件超过所选大小才开始切分；完成后可在这里核对每个分片的真实大小。"}</p>
            </div>}
        </div>
        <div className="split-history"><div className="video-gallery-head"><h2>最近切分任务</h2>
          <button className="xima-button secondary compact" disabled={!desktop||loadingHistory||running}
            onClick={()=>void refresh()}>{loadingHistory?"读取中…":"刷新"}</button></div>
          <div className="split-history-list">{recent.slice(0,20).map(task=>
            <button key={task.id} aria-pressed={selected?.id===task.id} disabled={running}
              onClick={()=>{setSelected(task);setProgress(null);}}>
              <strong>{task.videoName}</strong><span>{labels[task.status]} · {task.parts.length} 个 · {task.maxSizeGb} GB</span>
            </button>)}
            {!recent.length && <p className="xima-muted">暂无历史任务。</p>}
          </div>
        </div>
      </section>
    </div>
  </div>;
}
