import { useId } from "react";
import { Button, Field, SectionLabel, SwitchRow } from "../../components/ui";
import { ChevronDownIcon, ProjectIcon } from "../../lib/icons";
import { EXTENSION_PRESETS } from "./presets";
import type { WashController } from "./useWashController";
import type { WashMode, VerificationMode } from "../../types";

/**
 * Left column of the wash screen: scope, mode, filters and the action footer.
 * Purely presentational — every decision it makes is a call into `ctrl`.
 */
export function WashOptionsPanel({ ctrl }: { ctrl: WashController }) {
  const busy = ctrl.busy;
  const ids = useId();
  const scopeLabel = [
    ctrl.recursive ? "含子文件夹" : "仅当前文件夹",
    ctrl.skipSmall ? `大于 ${ctrl.minSizeMb} MB` : "不限大小",
  ].join(" · ");

  return (
    <aside className="halo-options" aria-label="处理设置">
      <div className="halo-options-body">
        <header className="halo-options-head">
          <h2>处理设置</h2>
          <span className="halo-options-tag">
            <span className="halo-live-dot" aria-hidden="true" />
            本机处理
          </span>
        </header>

        <button
          className="halo-folder-picker"
          data-selected={Boolean(ctrl.rootPath)}
          disabled={!ctrl.desktopMode || busy}
          onClick={() => void ctrl.chooseFolder()}
        >
          <span className="halo-folder-glyph" aria-hidden="true">
            <ProjectIcon />
          </span>
          <span className="halo-folder-copy">
            <strong>{ctrl.rootPath ? "已选择文件夹" : "选择文件夹"}</strong>
            <small title={ctrl.rootPath}>
              {ctrl.rootPath || "使用系统文件夹选择器"}
            </small>
          </span>
          <span className="halo-folder-action">{ctrl.rootPath ? "更换" : "浏览"}</span>
        </button>

        <Field
          label="文件扩展名"
          htmlFor={`${ids}-extensions`}
          hint="逗号或空格分隔，留空处理全部类型。"
        >
          <div className="halo-presets" role="group" aria-label="常用文件类型">
            {EXTENSION_PRESETS.map((preset) => {
              const active =
                ctrl.extensions.length === preset.values.length &&
                preset.values.every((value) => ctrl.extensions.includes(value));
              return (
                <button
                  key={preset.label}
                  className="halo-preset"
                  disabled={busy}
                  aria-pressed={active}
                  onClick={() => ctrl.setExtensionInput(preset.values.join(", "))}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <textarea
            id={`${ids}-extensions`}
            name="extensions"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            placeholder="例如 mp4, mkv, zip…"
            value={ctrl.extensionInput}
            disabled={busy}
            onChange={(event) => ctrl.setExtensionInput(event.target.value)}
          />
        </Field>

        <section className="halo-options-section">
          <SectionLabel>处理方式</SectionLabel>

          <Field label="洗码模式" htmlFor={`${ids}-mode`}>
            <select
              id={`${ids}-mode`}
              name="mode"
              value={ctrl.mode}
              disabled={busy}
              onChange={(event) => ctrl.setMode(event.target.value as WashMode)}
            >
              <option value="recoverable">可识别标记 · 32 字节</option>
              <option value="legacy">兼容模式 · 5 字节</option>
            </select>
          </Field>

          <Field
            label="校验级别"
            htmlFor={`${ids}-verification`}
            hint={verificationHint(ctrl.verificationMode)}
          >
            <select
              id={`${ids}-verification`}
              name="verification"
              value={ctrl.verificationMode}
              disabled={busy}
              onChange={(event) =>
                ctrl.setVerificationMode(event.target.value as VerificationMode)
              }
            >
              <option value="fast">快速 · 不读取文件正文</option>
              <option value="sampled">抽样 · 默认推荐</option>
              <option value="full">完整 · 全文件 SHA-256</option>
            </select>
          </Field>

          <div className="halo-options-switches">
            <SwitchRow
              title="跳过已标记文件"
              description="避免重复追加，仅适用于 32 字节模式"
              checked={ctrl.skipAlreadyWashed}
              disabled={busy || ctrl.mode === "legacy"}
              onChange={ctrl.setSkipAlreadyWashed}
            />
          </div>
        </section>

        <details className="halo-disclosure">
          <summary>
            <span>
              筛选与排除
              <small>{scopeLabel}</small>
            </span>
            <ChevronDownIcon aria-hidden="true" />
          </summary>
          <div className="halo-options-switches">
            <SwitchRow
              title="递归子文件夹"
              description="包含全部子目录"
              checked={ctrl.recursive}
              disabled={busy}
              onChange={ctrl.setRecursive}
            />
            <SwitchRow
              title="跳过隐藏项"
              description="忽略以 . 或 # 开头的项目"
              checked={ctrl.skipHidden}
              disabled={busy}
              onChange={ctrl.setSkipHidden}
            />
            <SwitchRow
              title="跳过小文件"
              description="降低文本和配置文件误操作风险"
              checked={ctrl.skipSmall}
              disabled={busy}
              onChange={ctrl.setSkipSmall}
            />
            <Field label="最小文件大小" htmlFor={`${ids}-min-size`}>
              <div className="halo-input-unit">
                <input
                  id={`${ids}-min-size`}
                  name="min-size"
                  type="number"
                  min="0"
                  value={ctrl.minSizeMb}
                  disabled={busy || !ctrl.skipSmall}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) ctrl.setMinSizeMb(Math.max(0, value));
                  }}
                />
                <span>MB</span>
              </div>
            </Field>
          </div>
        </details>
      </div>

      <div className="halo-action-footer">
        <p className="halo-action-hint">
          {ctrl.running
            ? "任务进行中，可随时停止"
            : ctrl.scanning
              ? "正在扫描文件范围…"
              : !ctrl.rootPath
                ? "先选择文件夹，再预扫描确认范围"
                : ctrl.scanSummary
                  ? `已找到 ${ctrl.scanSummary.totalFiles} 个候选文件`
                  : "开始前将自动扫描并确认范围"}
        </p>
        <p className="halo-safety-note halo-safety-note-critical" role="note">
          洗码会直接修改原文件。重要文件请先备份；关键资料建议选择完整校验。
        </p>
        <div className="halo-button-row">
          <Button
            disabled={!ctrl.desktopMode || busy || !ctrl.rootPath}
            onClick={() => void ctrl.handleScan()}
          >
            {ctrl.scanning ? "扫描中…" : "预扫描"}
          </Button>
          <Button
            variant="primary"
            disabled={
              !ctrl.desktopMode || busy || !ctrl.rootPath || ctrl.scanSummary?.totalFiles === 0
            }
            onClick={() => void ctrl.handleStart()}
          >
            {ctrl.running ? "正在洗码…" : "开始洗码"}
          </Button>
          {(ctrl.scanning || ctrl.running) && (
            <Button
              variant="danger"
              disabled={ctrl.cancelling}
              onClick={() => void ctrl.handleCancel()}
            >
              {ctrl.cancelling ? "正在停止…" : "停止"}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function verificationHint(mode: VerificationMode) {
  switch (mode) {
    case "fast":
      return "仅核对文件大小、身份、修改时间和尾部标记，不读取文件正文。";
    case "sampled":
      return "读取头尾区块和 8 个随机区块，通常每个文件约 10 MiB。";
    default:
      return "完整读取文件一次并记录洗码前后 SHA-256，最严格但最慢。";
  }
}
