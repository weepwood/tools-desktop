import { useEffect, useRef, useState } from "react";
import { SETTINGS_CATEGORIES } from "./SettingsSidebar";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { MailSettings } from "./MailSettings";
import { URLSchemeSettings } from "./URLSchemeSettings";
import { Group, Row } from "./SettingsGroup";
import { Toggle } from "./controls/Toggle";
import { SegmentedControl } from "./controls/SegmentedControl";
import { Select } from "./controls/Select";
import { useSettings, type NoticePosition } from "../lib/settingsStore";
import { useTheme } from "../theme/useTheme";
import { useScrollFade } from "../lib/useScrollFade";
import type { ThemeChoice } from "../theme/ThemeProvider";
import {
  isAutostartEnabled,
  setAutostartEnabled,
  setMenuBarVisible,
  isTauri,
  sendNotification,
} from "../lib/tauri";
import "./SettingsView.css";

/**
 * Settings content for one category: page title + groups.
 *
 * The workspace frame and category sidebar live in SettingsWorkspace; this
 * file only owns the panels, so the same content can be
 * embedded anywhere without dragging the sidebar along.
 */
export function SettingsBody({ category }: { category: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useScrollFade(contentRef);

  return (
    <div className="settings-content" ref={contentRef}>
      <div className="settings-content-column">
        <h1 className="settings-title">
          {SETTINGS_CATEGORIES.find((c) => c.id === category)?.label}
        </h1>
        {category === "general" && <GeneralSettings />}
        {category === "mail" && <MailSettings />}
        {category === "appearance" && <AppearanceSettings />}
        {category === "shortcuts" && <ShortcutsSettings />}
        {category === "advanced" && <AdvancedSettings />}
        {category === "url-scheme" && <URLSchemeSettings />}
      </div>
    </div>
  );
}

/* Row and Group are shared with panes that live in their own files. */

/* ---- Categories ---- */

function GeneralSettings() {
  const { settings, update } = useSettings();
  // Launch-at-login lives in the OS, not our settings store, so it's queried
  // on mount. "Show in menu bar" and "Start minimized" persist in settings.
  const [autostart, setAutostart] = useState(false);
  const [startupBusy, setStartupBusy] = useState(true);
  const [feedback, setFeedback] = useState("");
  const menuBar = settings.showInMenuBar;

  useEffect(() => {
    void isAutostartEnabled().then(setAutostart)
      .catch((error) => setFeedback(`读取启动设置失败：${String(error)}`))
      .finally(() => setStartupBusy(false));
  }, []);

  // The menu-bar icon is the master switch: without it there's nowhere for a
  // login launch to land, so the startup options hang off it. Turning it off
  // also clears any existing login entry.
  const toggleMenuBar = async (on: boolean) => {
    setStartupBusy(true);
    setFeedback("");
    try {
      if (!on && autostart) {
        await setAutostartEnabled(false, settings.startMinimized);
        setAutostart(false);
      }
      await setMenuBarVisible(on);
      update("showInMenuBar", on);
    } catch (error) { setFeedback(`修改托盘设置失败：${String(error)}`); }
    finally { setStartupBusy(false); }
  };

  const toggleAutostart = async (enabled: boolean) => {
    setStartupBusy(true);
    setFeedback("");
    try {
      await setAutostartEnabled(enabled, settings.startMinimized);
      setAutostart(enabled);
    } catch (error) { setFeedback(`修改开机启动失败：${String(error)}`); }
    finally { setStartupBusy(false); }
  };

  // Re-register the login entry so its hidden flag tracks the new value.
  const toggleMinimized = async (minimized: boolean) => {
    setStartupBusy(true);
    setFeedback("");
    try {
      if (autostart) await setAutostartEnabled(true, minimized);
      update("startMinimized", minimized);
    } catch (error) { setFeedback(`修改最小化启动失败：${String(error)}`); }
    finally { setStartupBusy(false); }
  };

  return (
    <>
      <Group label="启动与托盘">
        <Row
          title="显示托盘图标"
          description={
            isTauri()
              ? "关闭窗口后继续在托盘运行，可从托盘重新打开或安全退出"
              : "仅在桌面应用中可用"
          }
        >
          <Toggle
            checked={menuBar}
            onChange={toggleMenuBar}
            disabled={!isTauri() || startupBusy}
            aria-label="显示托盘图标"
          />
        </Row>
        <Row
          title="开机启动"
          description="登录系统后自动启动 HALO"
        >
          <Toggle
            checked={autostart}
            onChange={toggleAutostart}
            disabled={!isTauri() || !menuBar || startupBusy}
            aria-label="开机启动"
          />
        </Row>
        <Row
          title="启动时最小化"
          description="开机启动时保持窗口隐藏，通过托盘访问"
        >
          <Toggle
            checked={settings.startMinimized}
            onChange={toggleMinimized}
            disabled={!isTauri() || !menuBar || !autostart || startupBusy}
            aria-label="启动时最小化"
          />
        </Row>
      </Group>

      <Group label="通知">
        <Row title="任务通知" description="洗码或恢复任务结束后发送系统通知">
          <Toggle
            checked={settings.notifications}
            onChange={(v) => update("notifications", v)}
            aria-label="任务通知"
          />
        </Row>
        <Row title="应用内通知位置" description="设置成功、错误与操作提示在窗口中的显示位置">
          <Select<NoticePosition>
            value={settings.noticePosition}
            onChange={(value) => update("noticePosition", value)}
            aria-label="应用内通知位置"
            options={[
              { value: "top-left", label: "左上" },
              { value: "top-right", label: "右上" },
              { value: "bottom-left", label: "左下" },
              { value: "bottom-right", label: "右下" },
              { value: "center", label: "顶部居中" },
            ]}
          />
        </Row>
        <Row
          title="测试通知"
          description="发送一条通知以检查系统权限"
        >
          <button
            className="control-button"
            onClick={() =>
              void sendNotification("HALO 测试通知", "系统通知已启用。")
                .then((shown) =>
                  setFeedback(
                    shown
                      ? "测试通知已发送。"
                      : "系统未能显示通知；请检查通知权限和 macOS 应用签名状态。",
                  ),
                )
                .catch((error) => setFeedback(`发送通知失败：${String(error)}`))
            }
          >
            发送测试
          </button>
        </Row>
      </Group>
      <UpdateSettings />
      {feedback && (
        <p className="settings-feedback" role="status">
          {feedback}
        </p>
      )}
    </>
  );
}

type UpdateStatusName = "idle" | "checking" | "available" | "up-to-date" | "downloading" | "downloaded" | "installing" | "error";
interface UpdateStatus {
  status: UpdateStatusName;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  mode: "windows-installer" | "release-page";
  canInstall: boolean;
  error?: string | null;
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
}

function UpdateSettings() {
  const [state, setState] = useState<UpdateStatus>({
    status: "idle",
    currentVersion: "",
    mode: "release-page",
    canInstall: false,
  });
  const desktop = window.halo;

  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    const unsubscribe = desktop.on<UpdateStatus>("update-status", (next) => {
      if (mounted) setState(next);
    });
    void desktop.invoke<UpdateStatus>("update_status")
      .then((next) => { if (mounted) setState(next); })
      .catch((error) => {
        if (mounted) setState((current) => ({ ...current, status: "error", error: String(error) }));
      });
    return () => { mounted = false; unsubscribe(); };
  }, [desktop]);

  const pending = ["checking", "downloading", "installing"].includes(state.status);
  const action = state.status === "available"
    ? state.canInstall ? "update_download" : "update_open_release"
    : state.status === "downloaded" ? "update_install" : "update_check";
  const actionLabel = state.status === "checking" ? "正在检查…"
    : state.status === "downloading" ? "正在下载…"
      : state.status === "installing" ? "正在准备安装…"
        : state.status === "available" ? state.canInstall ? "下载更新" : "查看下载页面"
          : state.status === "downloaded" ? "立即重启并安装"
            : state.status === "up-to-date" ? "重新检查" : "检查更新";

  async function runAction() {
    if (!desktop) return;
    try {
      const next = await desktop.invoke<UpdateStatus>(action);
      if (next && typeof next === "object" && "status" in next) setState(next);
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: String(error) }));
    }
  }

  const progress = Math.max(0, Math.min(100, state.progress?.percent ?? 0));
  const message = state.status === "checking" ? "正在查询 GitHub 最新正式版…"
    : state.status === "available" ? `发现新版本 ${state.latestVersion}`
      : state.status === "up-to-date" ? "当前已是最新正式版。"
        : state.status === "downloading" ? `正在下载更新：${Math.floor(progress)}%`
          : state.status === "downloaded" ? `HALO ${state.latestVersion} 已下载，确认后将重启并安装。`
            : state.status === "installing" ? "应用即将退出并安装更新…"
              : state.status === "error" ? `更新检查失败：${state.error || "请稍后重试。"}`
                : desktop ? "手动检查是否有新版本。" : "请在 HALO 桌面应用中检查更新。";

  return (
    <Group label="软件更新">
      <Row title="检查更新" description={`当前版本：${state.currentVersion || "读取中…"}`}>
        <button className="control-button" disabled={!desktop || pending} onClick={() => void runAction()}>
          {actionLabel}
        </button>
      </Row>
      <div className="settings-update-details" role={state.status === "error" ? "alert" : "status"}>
        <p>{message}</p>
        {state.status === "downloading" && (
          <div className="settings-update-progress" role="progressbar" aria-label="更新下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}>
            <div style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {state.releaseNotes?.trim() && state.latestVersion && (
        <details className="settings-update-notes">
          <summary>HALO {state.latestVersion} 更新说明</summary>
          <div>{state.releaseNotes}</div>
        </details>
      )}
    </Group>
  );
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const { settings, update } = useSettings();

  return (
    <>
      <Group label="主题">
        <Row title="外观主题" description="跟随系统或使用固定的浅色、深色主题">
          <SegmentedControl<ThemeChoice>
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </Row>
      </Group>

      <Group label="字体">
        <Row
          title="界面字体"
          description="更改整个应用的字体；未安装的字体会自动使用后备字体。"
        >
          <Select
            value={settings.uiFont}
            onChange={(value) => update("uiFont", value)}
            aria-label="界面字体"
            options={[
              { value: "system", label: "系统默认" },
              { value: "segoe", label: "Segoe UI" },
              { value: "yahei", label: "微软雅黑" },
              { value: "dengxian", label: "等线" },
              { value: "source-han", label: "思源黑体" },
            ]}
          />
        </Row>
      </Group>

      <Group label="动画">
        <Row title="减少动态效果" description="减少面板动画，或跟随系统的动态效果偏好">
          <SegmentedControl
            value={settings.reduceMotion}
            onChange={(v) => update("reduceMotion", v)}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "on", label: "开启" },
              { value: "off", label: "关闭" },
            ]}
          />
        </Row>
      </Group>

    </>
  );
}

function AdvancedSettings() {
  const { reset } = useSettings();
  const [storageWarnings, setStorageWarnings] = useState<string[] | null>(null);
  useEffect(() => {
    let active = true;
    if (window.halo) {
      void window.halo.invoke<string[]>("storage_diagnostics").then(warnings => {
        if (active) setStorageWarnings(warnings);
      }).catch(error => { if (active) setStorageWarnings(["诊断失败：" + String(error)]); });
    }
    return () => { active = false; };
  }, []);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");

  async function resetSettings() {
    setResetting(true);
    setError("");
    try {
      await setMenuBarVisible(true);
      await setAutostartEnabled(false, false);
      reset();
    } catch (error) {
      setError(`重置失败：${String(error)}`);
    } finally { setResetting(false); }
  }

  return (
    <>
      {storageWarnings && (
        <Group label="历史记录完整性">
          <Row title="本地诊断" description="只检查历史记录格式，不修改或删除原始记录">
            <span>{storageWarnings.length ? "发现 " + storageWarnings.length + " 项异常" : "未发现解析异常"}</span>
          </Row>
          {storageWarnings.map((message, index) => (
            <p role="alert" key={index}>{message}</p>
          ))}
        </Group>
      )}
      <Group>
        <Row title="恢复记录" description="历史、任务日志和最近一次历史备份保存在本机应用数据目录。历史不会自动删除。">
          <span>本机保存</span>
        </Row>
      </Group>

      <Group label="重置">
        <Row title="恢复应用设置" description="重置通知、动画和启动选项；历史记录与洗码筛选条件保留">
          <button className="control-button" data-variant="danger" disabled={resetting} onClick={() => void resetSettings()}>
            {resetting ? "重置中…" : "重置设置"}
          </button>
        </Row>
      </Group>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
