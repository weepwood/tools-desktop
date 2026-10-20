import { useId, useState } from "react";
import { Button, Field, SectionLabel, SwitchRow } from "../../components/ui";
import { ChevronDownIcon, CloseIcon, ProjectIcon } from "../../lib/icons";
import { formatBytes } from "../../lib/format";
import { EXTENSION_PRESETS } from "./presets";
import type { WashController } from "./useWashController";
import type { WashMode, VerificationMode } from "../../types";
import { usePersistedState } from "../../lib/usePersistedState";

type WashProfile = { name: string; rootPath: string; extensions: string; recursive: boolean; skipHidden: boolean; skipSmall: boolean; minSizeMb: number; mode: WashMode; verificationMode: VerificationMode; skipAlreadyWashed: boolean; backupDirectory: string };

/**
 * Left column of the wash screen: scope, mode, filters and the action footer.
 * Purely presentational — every decision it makes is a call into `ctrl`.
 */
export function WashOptionsPanel({ ctrl }: { ctrl: WashController }) {
  const busy = ctrl.busy;
  const ids = useId();
  const [safetyNoteDismissed, setSafetyNoteDismissed] = useState(false);
  const [profiles, setProfiles] = usePersistedState<WashProfile[]>("halo:wash-profiles", []);
  const [profileName, setProfileName] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  function saveProfile() {
    const name = profileName.trim();
    if (!name) return;
    const profile: WashProfile = { name, rootPath: ctrl.rootPath, extensions: ctrl.extensionInput, recursive: ctrl.recursive, skipHidden: ctrl.skipHidden, skipSmall: ctrl.skipSmall, minSizeMb: ctrl.minSizeMb, mode: ctrl.mode, verificationMode: ctrl.verificationMode, skipAlreadyWashed: ctrl.skipAlreadyWashed, backupDirectory: ctrl.backupDirectory };
    setProfiles(previous => [...previous.filter(item => item.name !== name), profile].slice(-30));
    setSelectedProfile(name); setProfileName("");
  }
  function loadProfile() {
    const profile = profiles.find(item => item.name === selectedProfile);
    if (!profile) return;
    ctrl.setRootPath(profile.rootPath); ctrl.setExtensionInput(profile.extensions);
    ctrl.setRecursive(profile.recursive); ctrl.setSkipHidden(profile.skipHidden); ctrl.setSkipSmall(profile.skipSmall);
    ctrl.setMinSizeMb(profile.minSizeMb); ctrl.setMode(profile.mode); ctrl.setVerificationMode(profile.verificationMode);
    ctrl.setSkipAlreadyWashed(profile.skipAlreadyWashed); ctrl.setBackupDirectory(profile.backupDirectory);
  }
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

        {ctrl.rootPath && <div className="wash-scan-summary" data-ready={Boolean(ctrl.scanSummary)}>
          <span className="halo-live-dot" aria-hidden="true" />
          <span>{ctrl.scanning ? "正在检查文件范围…" : ctrl.scanSummary
            ? `${ctrl.scanSummary.totalFiles} 个文件 · ${formatBytes(ctrl.scanSummary.totalBytes)}`
            : "尚未预扫描，开始时会先展示确认信息"}</span>
        </div>}
        <details className="wash-advanced-options halo-disclosure">
          <summary><span>更多设置与工具<small>{ctrl.backupDirectory ? "已启用处理前备份" : "筛选、校验、预设和重复查找"}</small></span><ChevronDownIcon aria-hidden="true" /></summary>

          <section className="halo-wash-profiles" aria-label="处理预设">
            <SectionLabel>处理预设</SectionLabel>
            <div className="halo-profile-row">
              <input aria-label="预设名称" placeholder="预设名称" maxLength={40} value={profileName} disabled={busy} onChange={event => setProfileName(event.target.value)} />
              <Button compact disabled={busy || !profileName.trim()} onClick={saveProfile}>保存</Button>
            </div>
            {profiles.length > 0 && <div className="halo-profile-row">
              <select aria-label="已保存的处理预设" value={selectedProfile} disabled={busy} onChange={event => setSelectedProfile(event.target.value)}>
                <option value="">选择预设</option>{profiles.map(profile => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
              </select>
              <Button compact disabled={busy || !selectedProfile} onClick={loadProfile}>载入</Button>
              <Button compact disabled={busy || !selectedProfile} onClick={() => { setProfiles(previous => previous.filter(item => item.name !== selectedProfile)); setSelectedProfile(""); }}>删除</Button>
            </div>}
          </section>

        <div className="halo-field halo-backup-field">
          <label>处理前备份</label>
          <button className="halo-folder-picker" data-selected={Boolean(ctrl.backupDirectory)} disabled={!ctrl.desktopMode || busy} onClick={() => void ctrl.chooseBackupFolder()}>
            <span className="halo-folder-glyph" aria-hidden="true"><ProjectIcon /></span>
            <span className="halo-folder-copy"><strong>{ctrl.backupDirectory ? "已启用洗码前备份" : "选择备份文件夹"}</strong><small title={ctrl.backupDirectory}>{ctrl.backupDirectory || "将原文件复制到单独批次目录"}</small></span>
            <span className="halo-folder-action">{ctrl.backupDirectory ? "更换" : "选择"}</span>
          </button>
          {ctrl.backupDirectory && <button className="halo-link-button" disabled={busy} onClick={() => ctrl.setBackupDirectory("")}>关闭额外备份</button>}
          <small>可选。每次任务创建独立目录，不覆盖旧备份。</small>
        </div>

        <section className="halo-options-section halo-duplicates">
          <div className="wash-tool-heading"><SectionLabel>重复文件</SectionLabel><Button compact disabled={!ctrl.desktopMode || busy || !ctrl.rootPath} onClick={() => void ctrl.handleFindDuplicates()}>
            {ctrl.findingDuplicates ? "正在完整校验…" : "查找重复文件"}
          </Button></div>
          <p className="halo-muted">完整比对文件内容，不会自动删除。</p>
          {ctrl.duplicateResult && <details className="halo-disclosure" open>
            <summary><span>重复结果<small>{ctrl.duplicateResult.groups.length} 组 · 已扫描 {ctrl.duplicateResult.scannedFiles} 个文件</small></span><ChevronDownIcon aria-hidden="true" /></summary>
            {ctrl.duplicateResult.groups.length ? <ul className="halo-duplicate-list">{ctrl.duplicateResult.groups.slice(0, 30).map(group => <li key={group.sha256}><strong>{formatBytes(group.sizeBytes)} · {group.files.length} 份</strong>{group.files.map(file => <span key={file.path} title={file.path}>{file.relativePath}</span>)}</li>)}</ul> : <p className="halo-muted">没有发现完全重复的文件。</p>}
            {ctrl.duplicateResult.groups.length > 30 && <small>结果仅展示前 30 组。</small>}
          </details>}
        </section>

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
        </details>
      </div>

      <div className="halo-action-footer">
        {(ctrl.running || ctrl.scanning || ctrl.rootPath) && <p className="halo-action-hint">
          {ctrl.running
            ? "正在处理文件，可随时停止"
            : ctrl.scanning
              ? "正在扫描文件范围…"
              : ctrl.scanSummary
                ? `已确认 ${ctrl.scanSummary.totalFiles} 个文件`
                : "开始前会先扫描并请你确认文件范围"}
        </p>}
        {!safetyNoteDismissed && <div className="halo-safety-note halo-safety-note-critical" role="note">
          <span>{ctrl.backupDirectory ? "处理前会复制备份；洗码仍会修改原文件。" : "洗码会直接修改原文件；重要文件建议先启用备份。"}</span>
          <button className="halo-safety-note-dismiss" aria-label="关闭原文件修改提示" onClick={() => setSafetyNoteDismissed(true)}>
            <CloseIcon aria-hidden="true" />
          </button>
        </div>}
        <div className="halo-button-row">
          <Button
            variant="primary"
            disabled={
              !ctrl.desktopMode || busy || !ctrl.rootPath || ctrl.scanSummary?.totalFiles === 0
            }
            onClick={() => void ctrl.handleStart()}
          >
            {ctrl.running ? "正在洗码…" : "开始洗码"}
          </Button>
          <Button compact
            disabled={!ctrl.desktopMode || busy || !ctrl.rootPath}
            onClick={() => void ctrl.handleScan()}
          >
            {ctrl.scanning ? "扫描中…" : "预扫描"}
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
