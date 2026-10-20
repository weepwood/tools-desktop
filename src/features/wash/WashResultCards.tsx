import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Pagination,
  ProgressBar,
} from "../../components/ui";
import {
  ChevronDownIcon,
  CloseIcon,
  ProjectIcon,
  SearchIcon,
} from "../../lib/icons";
import { formatBytes, shortHash } from "../../lib/format";
import { PAGE_SIZE, RESULT_FILTERS } from "./presets";
import type { WashController } from "./useWashController";
import type { FileRecord } from "../../types";

/**
 * Right column of the wash screen: scan summary, live task state and the
 * per-file result table. Filter / search / paging state is view-only, so it
 * lives here rather than in the controller.
 */
export function WashResultCards({ ctrl }: { ctrl: WashController }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const results = ctrl.liveResults;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (filter === "all" && !needle) return results;
    return results.filter(
      (file) =>
        (filter === "all" || file.status === filter) &&
        (!needle ||
          file.relativePath.toLowerCase().includes(needle) ||
          file.error?.toLowerCase().includes(needle)),
    );
  }, [results, filter, query]);

  const visiblePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));

  useEffect(() => {
    setPage(0);
  }, [filter, query]);

  const sessionState = ctrl.running
    ? "running"
    : ctrl.currentSession
      ? ctrl.currentSession.cancelled
        ? "stopped"
        : ctrl.currentSession.failed
          ? "failed"
          : "done"
      : "idle";

  return (
    <div className="halo-results-column">
      {/* Show scope details only after the user asks for a scan. */}
      {(ctrl.scanning || ctrl.scanSummary) && <Card
        className="halo-scan-card"
        title="已扫描范围"
        meta={
          <span className="halo-scan-state" data-ready={Boolean(ctrl.scanSummary)}>
            <span
              className="halo-live-dot"
              data-live={ctrl.scanning || undefined}
              aria-hidden="true"
            />
            {ctrl.scanning ? "扫描中…" : ctrl.scanSummary ? "已就绪" : "尚未扫描"}
          </span>
        }
      >
        <div className="halo-metrics">
          <Metric
            label="候选文件"
            value={ctrl.scanSummary?.totalFiles ?? "—"}
            detail={ctrl.scanSummary ? "个" : "等待扫描"}
          />
          <Metric
            label="总体积"
            value={ctrl.scanSummary ? formatBytes(ctrl.scanSummary.totalBytes) : "—"}
            detail="扫描范围"
          />
          <Metric
            label="已过滤"
            value={
              ctrl.scanSummary
                ? ctrl.scanSummary.hiddenSkipped +
                  ctrl.scanSummary.smallSkipped +
                  ctrl.scanSummary.extensionSkipped
                : "—"
            }
            detail="个项目"
          />
        </div>

        {!!ctrl.scanSummary?.preview.length && (
          <details className="halo-disclosure halo-preview">
            <summary>
              查看候选文件预览
              <ChevronDownIcon aria-hidden="true" />
            </summary>
            <div className="halo-file-preview">
              <div className="halo-preview-head">
                <span>文件</span>
                <span>大小</span>
              </div>
              {ctrl.scanSummary.preview.slice(0, 8).map((file) => (
                <div className="halo-preview-row" key={file.path}>
                  <span title={file.path}>{file.relativePath}</span>
                  <b>{formatBytes(file.size)}</b>
                </div>
              ))}
              {ctrl.scanSummary.totalFiles > 8 && (
                <p className="halo-muted">
                  另有 {ctrl.scanSummary.totalFiles - 8} 个文件未显示
                </p>
              )}
            </div>
          </details>
        )}

        {!!ctrl.scanSummary?.unreadable && (
          <details className="halo-disclosure halo-warnings">
            <summary>{ctrl.scanSummary.unreadable} 个项目无法读取，查看原因</summary>
            {ctrl.scanSummary.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </details>
        )}
      </Card>}

      {/* Keep the idle view quiet; show progress only for a real task. */}
      {(ctrl.running || ctrl.currentSession) && <Card className="halo-task-card">
        <div className="halo-task-head">
          <div className="halo-task-title">
            <span className="halo-task-dot" data-state={sessionState} aria-hidden="true" />
            <h2>
              {ctrl.running
                ? "正在处理"
                : ctrl.currentSession
                  ? ctrl.currentSession.cancelled
                    ? "任务已停止"
                    : "任务已结束"
                : "处理已结束"}
            </h2>
          </div>
          <div className="halo-task-chips">
            <Badge tone="success" dot={false}>
              成功 {ctrl.resultCounts.success}
            </Badge>
            <Badge tone="failed" dot={false}>
              失败 {ctrl.resultCounts.failed}
            </Badge>
            <Badge tone="skipped" dot={false}>
              跳过 {ctrl.resultCounts.skipped}
            </Badge>
          </div>
          {ctrl.running && (
            <Button
              variant="danger"
              compact
              disabled={ctrl.cancelling}
              onClick={() => void ctrl.handleCancel()}
            >
              {ctrl.cancelling ? "正在停止…" : "停止"}
            </Button>
          )}
        </div>

        {(ctrl.running || ctrl.currentSession) && (
          <>
            <ProgressBar
              percent={ctrl.progressPercent}
              completed={ctrl.progressCompleted}
              total={ctrl.progressTotal}
              running={ctrl.running}
            />
            <p className="halo-current-file" title={ctrl.currentFile}>
              {ctrl.currentFile ||
                (ctrl.running
                  ? "正在扫描处理范围…"
                  : ctrl.currentSession?.historyError
                    ? "恢复记录保存异常，请保留任务日志并检查历史"
                    : "处理记录已保留，可前往历史校验并恢复")}
            </p>
          </>
        )}
      </Card>}

      {/* -------------------------------------------------------- 处理结果 */}
      <Card
        className="halo-results-card"
        flush
        title="处理结果"
        meta={`${results.length} 个文件`}
      >
        <div className="halo-results-inner">
          {results.length > 0 && <div className="halo-result-tools">
            <div className="halo-filter-tabs" role="group" aria-label="结果状态筛选">
              {RESULT_FILTERS.map((item) => (
                <button
                  key={item.value}
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="halo-search-field">
              <SearchIcon aria-hidden="true" />
              <input
                aria-label="搜索文件名或错误原因"
                name="result-search"
                value={query}
                placeholder="搜索文件名或错误原因…"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button aria-label="清空搜索" onClick={() => setQuery("")}>
                  <CloseIcon aria-hidden="true" />
                </button>
              )}
            </div>
          </div>}

          <div className="halo-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>文件</th>
                  <th>状态</th>
                  <th>洗码前</th>
                  <th>洗码后</th>
                  <th>耗时</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody className="halo-stagger">
                {filtered
                  .slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE)
                  .map((item) => (
                    <ResultRow key={item.path} item={item} onCopy={ctrl.copyPath} />
                  ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={6} className="halo-table-empty">
                      <EmptyState
                        icon={<ProjectIcon aria-hidden="true" />}
                        title={
                          results.length
                            ? "没有匹配的文件"
                            : ctrl.running
                              ? "正在等待文件处理结果"
                              : "准备处理文件"
                        }
                        description={
                          results.length
                            ? "调整状态筛选或搜索关键词，查看其他结果。"
                            : ctrl.running
                              ? "完成一个文件后，大小与校验结果就会显示在这里。"
                              : "选择文件夹，预扫描确认范围，再开始洗码。"
                        }
                        action={
                          results.length > 0 ? (
                            <Button
                              compact
                              onClick={() => {
                                setQuery("");
                                setFilter("all");
                              }}
                            >
                              清除筛选
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > PAGE_SIZE && <Pagination total={filtered.length} page={visiblePage} onChange={setPage} />}
        </div>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="halo-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ResultRow({ item, onCopy }: { item: FileRecord; onCopy: (path: string) => void }) {
  return (
    <tr>
      <td className="halo-file-cell" title={item.path}>
        <span>{item.relativePath}</span>
        <button className="halo-link-button" onClick={() => void onCopy(item.path)}>
          复制路径
        </button>
      </td>
      <td>
        {item.pending ? <Badge tone="pending" /> : <Badge tone={item.status} />}
      </td>
      <td>
        <span>{formatBytes(item.beforeSize)}</span>
        <code title={item.beforeSha256}>
          {item.verificationMode === "sampled"
            ? `${item.samples.length} 个抽样区块`
            : shortHash(item.beforeSha256)}
        </code>
      </td>
      <td>
        <span>{formatBytes(item.afterSize)}</span>
        <code title={item.afterSha256}>
          {item.verificationMode === "sampled" && item.status === "success"
            ? "尾部已验证"
            : shortHash(item.afterSha256)}
        </code>
      </td>
      <td className="halo-num">{item.durationMs} ms</td>
      <td className="halo-error-reason">{item.error || "—"}</td>
    </tr>
  );
}
