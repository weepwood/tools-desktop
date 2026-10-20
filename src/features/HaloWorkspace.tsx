import { Button } from "../components/ui";
import { NoticeToast } from "../components/NoticeToast";
import { taskLabel } from "../lib/taskStatus";
import type { HaloSection } from "../shell/LeftSidebar";
import { HistoryView } from "./HistoryView";
import { WashOptionsPanel } from "./wash/WashOptionsPanel";
import { WashResultCards } from "./wash/WashResultCards";
import { useWashController } from "./wash/useWashController";
import "./HaloWorkspace.css";

/**
 * Composition root of the wash / history screens.
 *
 * The screen is three pieces now: a controller that owns every side effect,
 * a left options panel and a right results column. This file only decides
 * what to show, which is why it fits on one page.
 */
export function HaloWorkspace({ section, onOpenWash }: { section: HaloSection; onOpenWash: () => void }) {
  const ctrl = useWashController();

  return (
    <div className="halo-workspace">
      {section === "history" && (
        <header className="halo-page-header">
          <div>
            <h1>历史与恢复</h1>
            <p>查看本机任务记录，验证文件后恢复原始内容。</p>
          </div>
          <div className="halo-toolbar-actions">
            <Button
              disabled={!ctrl.desktopMode || ctrl.historyLoading || ctrl.busy}
              onClick={() => void ctrl.loadHistory()}
            >
              {ctrl.historyLoading ? "读取中…" : "刷新"}
            </Button>
            <Button
              variant="danger"
              disabled={!ctrl.history.length || ctrl.historyLoading || ctrl.busy}
              onClick={() => void ctrl.handleClearHistory()}
            >
              清除历史
            </Button>
          </div>
        </header>
      )}
      {section === "wash" && (
        <header className="halo-page-header">
          <div>
            <h1>文件洗码</h1>
            <p>在本机批量处理文件，并查看扫描与校验结果。</p>
          </div>
        </header>
      )}

      <div className="halo-notice-stack">
        {ctrl.externalTaskRunning && (
          <div className="halo-notice info" role="status">
            <span>{taskLabel(ctrl.taskStatus.kind)}正在运行，结束后可继续操作。</span>
            <Button
              compact
              disabled={ctrl.cancelling || ctrl.taskStatus.cancelling}
              onClick={() => void ctrl.handleCancel()}
            >
              {ctrl.cancelling || ctrl.taskStatus.cancelling ? "正在停止…" : "停止任务"}
            </Button>
          </div>
        )}
        {ctrl.currentSession?.historyError && (
          <div className="halo-notice error" role="alert">
            恢复记录保存异常：{ctrl.currentSession.historyError}
            。请保留任务日志，并在处理新文件前检查历史记录。
          </div>
        )}
        {ctrl.notice && (
          <NoticeToast type={ctrl.notice.type} message={ctrl.notice.text} onDismiss={ctrl.dismissNotice} />
        )}
      </div>

      {section === "wash" ? (
        <section className="halo-wash-layout" aria-label="文件洗码">
          <h1 className="halo-sr-only">文件处理工作区</h1>
          <WashOptionsPanel ctrl={ctrl} />
          <WashResultCards ctrl={ctrl} />
        </section>
      ) : (
        <HistoryView
          history={ctrl.history}
          loading={ctrl.historyLoading}
          busy={ctrl.busy || ctrl.historyLoading}
          desktopMode={ctrl.desktopMode}
          onExport={ctrl.handleExport}
          onRestore={ctrl.handleRestore}
          onRelocate={ctrl.handleRestoreFromNewLocation}
          onCopyPath={ctrl.copyPath}
          progress={ctrl.restoring ? ctrl.restoreProgress : null}
          onCancel={ctrl.handleCancel}
          onOpenWash={onOpenWash}
        />
      )}

      {ctrl.restoreResultCount > 0 && (
        <span className="halo-sr-only" aria-live="polite">
          已处理 {ctrl.restoreResultCount} 个恢复结果
        </span>
      )}
    </div>
  );
}
