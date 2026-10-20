import { useEffect, useMemo, useState } from "react";
import { SettingsSidebar, SETTINGS_CATEGORIES } from "./SettingsSidebar";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { useShortcutHandlers } from "../lib/shortcuts";
import { useNavigation } from "../lib/navigation";
import { Toggle } from "./controls/Toggle";
import { SegmentedControl } from "./controls/SegmentedControl";
import { useSettings } from "../lib/settingsStore";
import { useTheme, } from "../theme/useTheme";
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
 * Settings: categories sidebar + one scrollable content pane. Each
 * category demonstrates the styled control primitives wired to the
 * persisted settings store.
 */
export function SettingsView() {
  const { navigate, settingsCategory } = useNavigation();
  const [category, setCategory] = useState(settingsCategory ?? "general");

  // Follow the category requested by navigation (e.g. Profile from the
  // account menu) even when the settings view is already mounted.
  useEffect(() => {
    if (settingsCategory) setCategory(settingsCategory);
  }, [settingsCategory]);

  // The settings shortcut acts as a toggle: pressing it here goes back.
  useShortcutHandlers(
    useMemo(() => ({ "open-settings": () => navigate("shell") }), [navigate]),
  );

  return (
    <div className="settings-view">
      <SettingsSidebar active={category} onSelect={setCategory} />
      <div className="settings-content-wrap">
        <div className="settings-titlebar" data-tauri-drag-region />
        <div className="settings-content">
          <div className="settings-content-column">
            <h1 className="settings-title">
              {SETTINGS_CATEGORIES.find((c) => c.id === category)?.label}
            </h1>
            {category === "general" && <GeneralSettings />}
            {category === "appearance" && <AppearanceSettings />}
            {category === "shortcuts" && <ShortcutsSettings />}
            {category === "advanced" && <AdvancedSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Shared row scaffolding ---- */

interface RowProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

function Row({ title, description, children }: RowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      {label && <div className="settings-group-label">{label}</div>}
      <div className="settings-group-card">{children}</div>
    </section>
  );
}

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
          description="登录系统后自动启动 XIMA"
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
        <Row
          title="测试通知"
          description="发送一条通知以检查系统权限"
        >
          <button
            className="control-button"
            onClick={() =>
              void sendNotification("XIMA 测试通知", "系统通知已启用。")
                .then((shown) => setFeedback(shown ? "测试通知已发送。" : "系统未授予通知权限。"))
                .catch((error) => setFeedback(`发送通知失败：${String(error)}`))
            }
          >
            发送测试
          </button>
        </Row>
      </Group>
      {feedback && <p role="status">{feedback}</p>}
    </>
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
    if (window.xima) {
      void window.xima.invoke<string[]>("storage_diagnostics").then(warnings => {
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
