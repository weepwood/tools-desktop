import { useEffect, useState } from "react";
import { Button, Card, EmptyState } from "../components/ui";
import { DateTimePicker } from "../components/DateTimePicker";
import { NumericStepper } from "../components/NumericStepper";
import { NoticeStack, NoticeToast } from "../components/NoticeToast";
import { ClockIcon } from "../lib/icons";
import { SegmentedControl } from "../settings/controls/SegmentedControl";
import { confirm } from "../lib/dialog";
import "./ShutdownWorkspace.css";

type ShutdownMode = "at-time" | "after-hours";
type ShutdownAction = "shutdown" | "power-on";
type ShutdownNotice = { type: "info" | "success" | "error"; text: string };
interface ShutdownState {
  platform: string;
  canShutdown: boolean;
  canPowerOn: boolean;
  plan: { scheduledAt: number; action: ShutdownAction } | null;
}

function currentMinuteValue() {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return [days ? `${days} 天` : "", remainingHours ? `${remainingHours} 小时` : "", minutes ? `${minutes} 分` : "", `${remainingSeconds} 秒`]
    .filter(Boolean)
    .join(" ");
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ShutdownWorkspace({ active }: { active: boolean }) {
  const [mode, setMode] = useState<ShutdownMode>("at-time");
  const [action, setAction] = useState<ShutdownAction>("shutdown");
  const [targetTime, setTargetTime] = useState(currentMinuteValue);
  const [hours, setHours] = useState("1");
  const [minutes, setMinutes] = useState("0");
  const [shutdown, setShutdown] = useState<ShutdownState>({ platform: "unknown", canShutdown: false, canPowerOn: false, plan: null });
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ShutdownNotice | null>(null);
  const delayMinutes = Number(hours) * 60 + Number(minutes);
  const delayedTime = new Date(now + (Number.isFinite(delayMinutes) ? delayMinutes : 0) * 60_000);

  useEffect(() => {
    let mounted = true;
    if (!window.halo) {
      setLoading(false);
      return;
    }
    void window.halo.invoke<ShutdownState>("get_shutdown_schedule").then((result) => {
      if (mounted) setShutdown(result);
    }).catch((error) => {
      if (mounted) setNotice({ type: "error", text: "读取关机计划失败：" + errorMessage(error) });
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!active || (shutdown.plan === null && mode !== "after-hours")) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), shutdown.plan === null ? 30_000 : 1000);
    return () => window.clearInterval(timer);
  }, [active, mode, shutdown.plan]);

  async function schedule() {
    if ((action === "shutdown" ? !shutdown.canShutdown : !shutdown.canPowerOn) || busy || shutdown.plan !== null) return;
    const requestedAt = Date.now();
    const scheduledAt = mode === "at-time"
      ? new Date(targetTime).getTime()
      : requestedAt + delayMinutes * 60_000;
    if (!Number.isFinite(scheduledAt) || scheduledAt - requestedAt < 60_000) {
      setNotice({ type: "info", text: "请选择至少 1 分钟之后的时间。" });
      return;
    }

    const localTime = new Date(scheduledAt).toLocaleString();
    const actionLabel = action === "shutdown" ? "关机" : "开机或唤醒";
    const accepted = await confirm(
      action === "shutdown"
        ? `确认在 ${localTime} 关闭电脑？未保存的文件和正在运行的任务可能会中断。关闭 HALO 后，计划仍会生效。`
        : `确认设置电脑在 ${localTime} 开机或唤醒？此操作依赖设备硬件和系统支持。`,
      { title: `确认定时${actionLabel}`, kind: "warning" },
    );
    if (!accepted) return;

    setBusy(true);
      setNotice(null);
    try {
      const result = await window.halo!.invoke<{ scheduledAt: number; action: ShutdownAction }>("schedule_shutdown", { scheduledAt, action });
      setShutdown((current) => ({ ...current, plan: result }));
      setNow(Date.now());
      const successMessage = action === "shutdown"
        ? "已安排关机。计划由操作系统执行，关闭 HALO 后仍会生效。"
        : shutdown.platform === "linux"
          ? "已设置 RTC 唤醒闹钟。它依赖主板硬件；请在计划时间前正常关机，电脑才会自动启动。"
          : "已安排开机或唤醒。请确认设备支持该电源事件。";
      setNotice({ type: "success", text: successMessage });
    } catch (error) {
      const detail = errorMessage(error);
      const authorizationCancelled = /-128|用户已取消|user canceled|user cancelled/i.test(detail);
      const message = authorizationCancelled
        ? "未设置电源计划：macOS 管理员授权已取消。请重新安排，并在系统授权对话框中选择允许。"
        : "安排电源计划失败：" + detail;
      setNotice({ type: "error", text: message });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy || shutdown.plan === null) return;
    setBusy(true);
    setNotice(null);
    try {
      await window.halo!.invoke<boolean>("cancel_shutdown");
      setShutdown((current) => ({ ...current, plan: null }));
      setNotice({ type: "success", text: "已取消电源计划。" });
    } catch (error) {
      setNotice({ type: "error", text: "取消电源计划失败：" + errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="halo-workspace shutdown-workspace">
      <header className="halo-page-header">
        <div>
          <h1>定时开关机</h1>
          <p>安排电脑在指定时间或若干小时后关机，也可设置开机或唤醒。</p>
        </div>
      </header>
      <main className="shutdown-content">
        {!shutdown.canShutdown && !loading ? (
          <div className="shutdown-unsupported">
            <EmptyState
              icon={<ClockIcon aria-hidden="true" />}
              title="当前平台暂不支持"
              description="HALO 通过系统自带的计划任务安排关机；当前系统没有可用的接口，因此这项功能在此设备上不可用。"
            />
          </div>
        ) : shutdown.plan !== null ? (
          <Card title={`当前${shutdown.plan.action === "shutdown" ? "关机" : "开机/唤醒"}计划`}>
            <div className="shutdown-active">
              <span className="shutdown-status-dot" aria-hidden="true" />
              <div className="shutdown-active-details">
                <strong>电脑将在 {new Date(shutdown.plan.scheduledAt).toLocaleString()} {shutdown.plan.action === "shutdown" ? "关机" : "开机或唤醒"}</strong>
                <span>剩余时间：{formatRemaining(shutdown.plan.scheduledAt - now)}</span>
              </div>
            </div>
            <p className="shutdown-muted">计划由操作系统执行，关闭 HALO 后仍会生效。</p>
            <Button variant="danger" disabled={busy} onClick={() => void cancel()}>
              {busy ? "处理中…" : "取消电源计划"}
            </Button>
          </Card>
        ) : (
          <Card title="安排电源计划" meta={shutdown.platform === "darwin" ? "macOS" : shutdown.platform === "linux" ? "Linux" : "Windows"}>
            {shutdown.canPowerOn && (
              <div className="shutdown-mode-row">
                <span className="shutdown-label">计划类型</span>
                <SegmentedControl<ShutdownAction>
                  value={action}
                  onChange={setAction}
                  options={[
                    { value: "shutdown", label: "定时关机" },
                    { value: "power-on", label: "定时开机/唤醒" },
                  ]}
                />
              </div>
            )}
            <div className="shutdown-mode-row">
                <span className="shutdown-label">{action === "shutdown" ? "关机方式" : "开机时间"}</span>
              <SegmentedControl<ShutdownMode>
                value={mode}
                onChange={setMode}
                options={[
                  { value: "at-time", label: "指定时间" },
                  { value: "after-hours", label: "几小时后" },
                ]}
              />
            </div>
            {mode === "at-time" ? (
              <div className="shutdown-field">
                <label htmlFor="shutdown-target-time">{action === "shutdown" ? "关机时间" : "开机时间"}</label>
                <DateTimePicker id="shutdown-target-time" value={targetTime} min={currentMinuteValue()} onChange={setTargetTime} />
              </div>
            ) : (
              <>
                <div className="shutdown-field shutdown-after-hours-field">
                  <span>{action === "shutdown" ? "延迟关机" : "延迟开机"}</span>
                  <div className="shutdown-duration-inputs">
                    <NumericStepper id="shutdown-hours" label="延迟小时数" value={hours} unit="小时" min={0} max={720} onChange={setHours} />
                    <NumericStepper id="shutdown-minutes" label="延迟分钟数" value={minutes} unit="分钟" min={0} max={59} onChange={setMinutes} />
                  </div>
                </div>
                <p className="shutdown-estimated-time">预计{action === "shutdown" ? "关机" : "开机/唤醒"}时间：{delayedTime.toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              </>
            )}
            <p className="shutdown-muted">
              {action === "shutdown"
                ? "计划至少提前 1 分钟。开始前会再次确认；关机可能中断未保存的工作。"
                : shutdown.platform === "linux"
                  ? "Linux 开机计划使用 RTC 闹钟，需主板支持。设置后请在计划时间前正常关机；部分设备只能唤醒休眠状态。"
                  : "开机或唤醒能力取决于 Mac 型号、电源状态及系统设置。macOS 定时关机要求届时电脑处于唤醒状态并有用户登录。"}
            </p>
            {shutdown.platform === "linux" && !shutdown.canPowerOn && (
              <p className="shutdown-muted">此 Linux 设备未检测到 rtcwake 或 /dev/rtc0；可使用定时关机，定时开机需要 RTC 硬件支持。</p>
            )}
            {!shutdown.canPowerOn && shutdown.platform === "win32" && (
              <p className="shutdown-muted">Windows 上的定时开机需要 BIOS/UEFI 或厂商电源管理支持；HALO 可安排定时关机。</p>
            )}
            <Button
              variant="primary"
              disabled={loading || busy || (action === "shutdown" ? !shutdown.canShutdown : !shutdown.canPowerOn) || (mode === "after-hours" && (!Number.isInteger(Number(hours)) || Number(hours) < 0 || Number(hours) > 720 || !Number.isInteger(Number(minutes)) || Number(minutes) < 0 || Number(minutes) > 59 || delayMinutes < 1 || delayMinutes > 720 * 60))}
              onClick={() => void schedule()}
            >
              {busy ? "正在安排…" : `安排${action === "shutdown" ? "关机" : "开机/唤醒"}`}
            </Button>
          </Card>
        )}
        {notice && <NoticeStack><NoticeToast type={notice.type} message={notice.text} onDismiss={() => setNotice(null)} /></NoticeStack>}
      </main>
    </div>
  );
}
