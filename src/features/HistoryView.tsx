import { useEffect, useMemo, useRef, useState } from "react";
import { getHistorySession } from "../api";
import { CloseIcon, ProjectIcon, SearchIcon } from "../lib/icons";
import type { FileRecord, RestoreFileRecord, RestoreRecord, SessionRecord, VerificationMode } from "../types";
import "./HistoryView.css";

const FILE_PAGE_SIZE = 30;
const FILE_FILTERS = [
  { value: "all", label: "全部" },
  { value: "available", label: "待恢复" },
  { value: "restored", label: "已恢复" },
  { value: "issues", label: "异常" },
];

interface HistoryViewProps {
  history: SessionRecord[];
  loading: boolean;
  busy: boolean;
  desktopMode: boolean;
  onExport: (session: SessionRecord) => Promise<void>;
  onRestore: (session: SessionRecord, file?: FileRecord) => Promise<void>;
  onRelocate: (session: SessionRecord, file: FileRecord) => Promise<void>;
  onCopyPath: (path: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenWash: () => void;
  progress: { sessionId: string; completed: number; total: number; currentFile: string; cancelling: boolean } | null;
  loadSession?: (id: string) => Promise<SessionRecord>;
}

function date(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function bytes(value: number) {
  if (value <= 0) return "0 B";
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${["B", "KB", "MB", "GB", "TB"][index]}`;
}

function verification(mode?: VerificationMode) {
  return mode === "fast" ? "快速校验" : mode === "sampled" ? "抽样校验" : "完整校验";
}

function sessionState(session: SessionRecord) {
  return session.interrupted ? "已中断" : session.cancelled ? "已停止" : session.failed || session.taskError || session.historyError ? "有异常" : "已完成";
}

function eligible(file: FileRecord) {
  return (file.status === "success" || file.pending) && !!file.appendedHex;
}

export function HistoryView(props: HistoryViewProps) {
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const queryText = query.trim().toLowerCase();
  const filtered = useMemo(() => props.history.filter((session) => !queryText || `${session.rootPath} ${session.id} ${date(session.startedAt)}`.toLowerCase().includes(queryText)), [props.history, queryText]);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1));
  const selected = props.history.find((session) => session.id === selectedId);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo(0, 0); }, [visiblePage, query]);

  return <section className={`halo-history-view ${selected ? "has-selection" : ""}`} aria-label="历史记录工作区">
    {props.progress && <div className="halo-history-live" role="status"><div className="halo-card-heading"><strong>正在恢复 {props.progress.completed} / {props.progress.total}</strong><button className="halo-button danger compact" disabled={props.progress.cancelling} onClick={() => void props.onCancel()}>{props.progress.cancelling ? "正在停止…" : "停止恢复"}</button></div><div className="halo-progress" role="progressbar" aria-label="恢复进度" aria-valuenow={props.progress.completed} aria-valuemin={0} aria-valuemax={Math.max(props.progress.total, 1)}><div style={{ width: `${Math.min(100, props.progress.completed / Math.max(props.progress.total, 1) * 100)}%` }} /></div><p className="halo-current-file" title={props.progress.currentFile}>{props.progress.currentFile || "正在准备…"}</p></div>}
    <div className="halo-history-split">
    <aside className="halo-history-list" aria-label="任务记录">
      <div className="halo-history-list-tools">
        <div className="halo-card-heading"><h2>任务记录</h2><span className="halo-muted">{props.history.length} 次任务</span></div>
        <SearchField label="搜索历史记录" placeholder="搜索文件夹、日期或任务编号" value={query} onChange={(value) => { setQuery(value); setPage(0); }} />
      </div>
      <div className="halo-history-list-body" ref={listRef} aria-busy={props.loading}>
        {props.loading && !props.history.length ? <p className="halo-history-placeholder" role="status">正在读取历史记录…</p> : !filtered.length ? queryText ? <p className="halo-history-placeholder">没有匹配的任务记录。</p> : <div className="halo-history-empty"><ProjectIcon aria-hidden="true" /><strong>还没有任务记录</strong><p>完成文件洗码后，记录会保存在本机，之后可在这里验证并恢复。</p><button className="halo-button secondary compact" onClick={props.onOpenWash}>打开文件洗码</button></div> : filtered.slice(visiblePage * 10, (visiblePage + 1) * 10).map((session) => <button key={session.id} className="halo-history-item" aria-pressed={selected?.id === session.id} onClick={() => setSelectedId(session.id)}>
          <span className="halo-history-item-top"><strong>{date(session.startedAt)}</strong><span className={`halo-status ${session.interrupted || session.cancelled ? "cancelled" : session.failed || session.taskError || session.historyError ? "failed" : "success"}`}>{sessionState(session)}</span></span>
          <span className="halo-history-item-path" title={session.rootPath}>{session.rootPath}</span>
          <span className="halo-muted">{session.success} 成功 · {session.failed} 失败 · {session.skipped} 跳过</span>
        </button>)}
      </div>
      {!!filtered.length && <Pager total={filtered.length} page={visiblePage} size={10} onChange={setPage} label="任务" />}
    </aside>
    {selected ? <HistoryDetail key={selected.id} {...props} summary={selected} onBack={() => setSelectedId("")} /> : <div className="halo-history-detail-empty"><ProjectIcon aria-hidden="true" /><h2>选择一条任务记录</h2><p>查看文件明细、恢复状态与操作记录。</p></div>}
    </div>
  </section>;
}

function HistoryDetail({ summary, onBack, loadSession = getHistorySession, ...props }: HistoryViewProps & { summary: SessionRecord; onBack: () => void }) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState("files");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError("");
    // A returned restore result may contain unsaved history; keep those actual results visible.
    const request = summary.files.length ? Promise.resolve(summary) : loadSession(summary.id);
    void request.then((record) => { if (active) setSession(record); }).catch((reason: unknown) => {
      if (active) setError(typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "读取文件明细失败。");
    });
    return () => { active = false; };
  }, [summary, loadSession, retry]);
  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [page, query, filter, tab]);

  const restores = useMemo(() => {
    const results = new Map<string, RestoreFileRecord>();
    for (const run of session?.restoreRuns ?? []) for (const file of run.files) {
      const latest = results.get(file.path);
      // Retrying a restored file produces a skip; retain its known successful recovery.
      if (!latest || latest.status === "skipped" && file.status === "success") results.set(file.path, file);
    }
    return results;
  }, [session]);
  const files = session?.files ?? [];
  const available = useMemo(() => session?.files.filter((file) => eligible(file) && restores.get(file.path)?.status !== "success").length ?? 0, [session, restores]);
  const queryText = query.trim().toLowerCase();
  const filtered = useMemo(() => (session?.files ?? []).filter((file) => {
    const restored = restores.get(file.path);
    const matches = filter === "all" || filter === "available" && eligible(file) && restored?.status !== "success" || filter === "restored" && restored?.status === "success" || filter === "issues" && (file.pending || file.status === "failed" || restored?.status === "failed");
    return matches && (!queryText || `${file.relativePath} ${file.path} ${file.error ?? ""} ${restored?.error ?? ""}`.toLowerCase().includes(queryText));
  }), [session, restores, filter, queryText]);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / FILE_PAGE_SIZE) - 1));
  const activeProgress = props.progress?.sessionId === summary.id ? props.progress : null;

  return <section className="halo-history-detail" aria-label="任务详情" aria-busy={!session && !error}>
    <header className="halo-history-detail-head">
      <button className="halo-history-back halo-link-button" onClick={onBack}>返回任务列表</button>
      <div className="halo-card-heading"><h2>{date(summary.startedAt)}</h2><span className="halo-muted">{sessionState(summary)}</span></div>
      <p className="halo-history-root">{summary.rootPath}</p>
      <p className="halo-muted">{summary.mode === "recoverable" ? "32 字节标记" : "5 字节兼容"} · {verification(summary.verificationMode)} · {summary.total} 个候选文件 · 追加 {bytes(summary.bytesAppended)}</p>
      <div className="halo-filter-tabs" role="group" aria-label="详情视图">
        <button aria-pressed={tab === "files"} onClick={() => setTab("files")}>文件明细{session ? ` (${files.length})` : ""}</button>
        <button aria-pressed={tab === "runs"} onClick={() => setTab("runs")}>恢复记录 ({summary.restoreRuns.length})</button>
      </div>
    </header>
    <div className="halo-history-detail-body" ref={bodyRef}>
      {error ? <div className="halo-history-placeholder" role="alert"><p>{error}</p><button className="halo-button secondary" onClick={() => setRetry((value) => value + 1)}>重新读取明细</button></div> : !session ? <p className="halo-history-placeholder" role="status">正在读取文件明细…</p> : <>
        {session.interrupted && <p className="halo-history-warning">任务意外中断。“待核验”的文件会在恢复前重新核对内容与尾部字节。</p>}
        {session.taskError && <p className="halo-history-warning" role="alert">任务日志异常：{session.taskError}</p>}
        {session.historyError && <p className="halo-history-warning" role="alert">历史保存异常：{session.historyError}</p>}
        {session.restoreRuns[0]?.historyError && <p className="halo-history-warning" role="alert">恢复结果保存失败：{session.restoreRuns[0].historyError}</p>}
        {tab === "files" ? <>
          <div className="halo-history-file-tools">
            <div className="halo-filter-tabs" role="group" aria-label="文件恢复状态">{FILE_FILTERS.map((item) => <button key={item.value} aria-pressed={filter === item.value} onClick={() => { setFilter(item.value); setPage(0); }}>{item.label}</button>)}</div>
            <SearchField label="搜索历史文件" placeholder="搜索文件路径或异常原因" value={query} onChange={(value) => { setQuery(value); setPage(0); }} />
          </div>
          <p className="halo-muted">待恢复 {available} 个 · 筛选结果 {filtered.length} 个</p>
          {!filtered.length && <div className="halo-history-placeholder"><p>{files.length ? "没有符合当前条件的文件。" : "本次任务未生成文件记录。"}</p>{files.length > 0 && <button className="halo-link-button" onClick={() => { setFilter("all"); setQuery(""); setPage(0); }}>显示全部文件</button>}</div>}
          {filtered.slice(visiblePage * FILE_PAGE_SIZE, (visiblePage + 1) * FILE_PAGE_SIZE).map((file) => {
            const restored = restores.get(file.path);
            const canRestore = eligible(file) && restored?.status !== "success";
            return <article className="halo-history-file" key={file.path}>
              <div className="halo-history-file-top"><strong title={file.path}>{file.relativePath}</strong><span className={`halo-status ${restored?.status === "success" ? "success" : file.pending ? "cancelled" : restored?.status === "failed" ? "failed" : file.status}`}>{restored?.status === "success" ? "已恢复" : restored?.status === "failed" ? "恢复失败" : file.pending ? "待核验" : file.status === "success" ? "待恢复" : file.status === "failed" ? "洗码失败" : "洗码跳过"}</span></div>
              {file.error && <p className="halo-history-file-error">洗码：{file.error}</p>}
              {restored?.error && <p className="halo-history-file-error">恢复：{restored.error}</p>}
              <div className="halo-history-file-meta"><span className="halo-muted">{verification(file.verificationMode)} · {bytes(file.beforeSize)} → {bytes(file.afterSize)}</span><div className="halo-history-file-actions"><button className="halo-link-button" onClick={() => void props.onCopyPath(restored?.resolvedPath ?? file.path)}>复制路径</button><button className="halo-link-button" disabled={props.busy || !props.desktopMode || !canRestore} onClick={() => void props.onRestore(session, file)}>恢复此文件</button><button className="halo-link-button" disabled={props.busy || !props.desktopMode || !canRestore} onClick={() => void props.onRelocate(session, file)}>选择移动后文件</button></div></div>
              <details className="halo-history-file-check"><summary>路径与校验信息</summary><dl><dt>原路径</dt><dd>{file.path}</dd>{restored?.resolvedPath && <><dt>恢复位置</dt><dd>{restored.resolvedPath}</dd></>}<dt>洗码前校验</dt><dd>{file.verificationMode === "sampled" ? `${file.samples.length} 个抽样区块` : file.beforeSha256 || "未记录正文哈希"}</dd><dt>洗码后校验</dt><dd>{file.pending ? "待核验" : file.verificationMode === "sampled" ? file.status === "success" ? "尾部已验证" : "未完成校验" : file.afterSha256 || "未记录正文哈希"}</dd><dt>追加字节</dt><dd>{file.appendedHex || "未追加"}</dd></dl></details>
            </article>;
          })}
        </> : !session.restoreRuns.length ? <p className="halo-history-placeholder">暂无恢复操作记录。恢复完成后可在这里查看结果与失败原因。</p> : session.restoreRuns.map((run) => <RestoreRun key={run.id} run={run} />)}
      </>}
    </div>
    {session && tab === "files" && !!filtered.length && <Pager total={filtered.length} page={visiblePage} size={FILE_PAGE_SIZE} onChange={setPage} label="文件" />}
    <footer className="halo-history-detail-footer"><p className="halo-muted">恢复前会重新校验文件；已恢复文件会跳过。任务恢复包含筛选外的文件。</p><div><button className="halo-button secondary" disabled={props.busy || !props.desktopMode} onClick={() => void props.onExport(session ?? summary)}>导出 CSV</button><button className="halo-button primary" disabled={props.busy || !props.desktopMode || !session || !available} onClick={() => session && void props.onRestore(session)}>{activeProgress ? "正在恢复…" : "校验并恢复本次任务"}</button></div></footer>
  </section>;
}

function RestoreRun({ run }: { run: RestoreRecord }) {
  const [page, setPage] = useState(0);
  return <article className="halo-history-run"><h3>{date(run.startedAt)}{run.cancelled ? " · 已停止" : ""}</h3><p className="halo-muted">{run.success} 成功 · {run.failed} 失败 · {run.skipped} 跳过</p>{run.historyError && <p className="halo-history-warning">结果保存失败：{run.historyError}</p>}<details><summary>查看 {run.files.length} 个文件的恢复结果</summary>{run.files.slice(page * FILE_PAGE_SIZE, (page + 1) * FILE_PAGE_SIZE).map((file) => <div className="halo-history-run-file" key={file.path}><div className="halo-history-file-top"><strong>{file.relativePath}</strong><span className={`halo-status ${file.status}`}>{file.status === "success" ? "已恢复" : file.status === "failed" ? "恢复失败" : "已跳过"}</span></div>{file.error && <p className="halo-history-file-error">{file.error}</p>}{file.resolvedPath && <p className="halo-history-root">{file.resolvedPath}</p>}</div>)}{!!run.files.length && <Pager total={run.files.length} page={page} size={FILE_PAGE_SIZE} onChange={setPage} label="恢复结果" />}</details></article>;
}

function SearchField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return <div className="halo-search-field"><SearchIcon aria-hidden="true" /><input aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />{value && <button aria-label={`清空${label}`} onClick={() => onChange("")}><CloseIcon aria-hidden="true" /></button>}</div>;
}

function Pager({ total, page, size, label, onChange }: { total: number; page: number; size: number; label: string; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <nav className="halo-pagination halo-history-pagination" aria-label={`${label}分页`}><span>{total} 条 · {page + 1} / {pages} 页</span><div><button className="halo-button secondary compact" aria-label={`${label}上一页`} disabled={!page} onClick={() => onChange(page - 1)}>上一页</button><button className="halo-button secondary compact" aria-label={`${label}下一页`} disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>下一页</button></div></nav>;
}
