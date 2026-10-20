import { useEffect, useMemo, useState } from "react";
import { Group, Row } from "./SettingsGroup";
import { TextInput } from "./controls/TextInput";
import { Select } from "./controls/Select";
import { Toggle } from "./controls/Toggle";
import "./URLSchemeSettings.css";

type Action = "open" | "reveal" | "run" | "url";
interface URLSchemeConfig {
  aliases: Record<string, string>;
  logging: boolean;
  gatewayUrl: string;
  enabled: boolean;
}
interface URLSchemeStatus {
  supported: boolean;
  registered: boolean;
  osRegistered: boolean;
  platform: string;
}
interface URLSchemeCall {
  time: string;
  uri: string;
  status: "ok" | "cancelled" | "error" | "ignored";
  action?: string;
  target?: string;
  error?: string;
}

const DEFAULT_CONFIG: URLSchemeConfig = {
  aliases: {},
  logging: true,
  gatewayUrl: "https://s2u2.netlify.app/",
  enabled: false,
};
const ACTIONS = [
  { value: "open", label: "打开" },
  { value: "reveal", label: "定位" },
  { value: "run", label: "运行（点击链接后仍需确认）" },
  { value: "url", label: "打开网址" },
] as const;

function makeUri(action: Action, target: string) {
  const encoded = encodeURIComponent(target.trim());
  return action === "open" ? `openhalo:${encoded}` : `openhalo://${action}/${encoded}`;
}

function makeGatewayLink(gateway: string, uri: string) {
  const value = gateway.trim();
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const route = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    const prefix = `${parsed.origin}${route}${parsed.search}#`;
    return `${prefix}openhalo:${encodeURIComponent(uri.slice("openhalo:".length))}`;
  } catch { return ""; }
}

function invoke<T>(command: string, args?: Record<string, unknown>) {
  if (!window.halo) return Promise.reject(new Error("此操作仅在 HALO 桌面应用中可用"));
  return window.halo.invoke<T>(command, args);
}

export function URLSchemeSettings() {
  const [status, setStatus] = useState<URLSchemeStatus | null>(null);
  const [config, setConfig] = useState<URLSchemeConfig>(DEFAULT_CONFIG);
  const [calls, setCalls] = useState<URLSchemeCall[]>([]);
  const [action, setAction] = useState<Action>("open");
  const [target, setTarget] = useState("");
  const [aliasName, setAliasName] = useState("");
  const [aliasTarget, setAliasTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const nativeUri = useMemo(() => target.trim() ? makeUri(action, target) : "", [action, target]);
  const gatewayLink = useMemo(
    () => nativeUri && config.gatewayUrl ? makeGatewayLink(config.gatewayUrl, nativeUri) : "",
    [config.gatewayUrl, nativeUri],
  );

  const refresh = async () => {
    const [nextStatus, nextConfig, nextCalls] = await Promise.all([
      invoke<URLSchemeStatus>("openhalo_status"),
      invoke<URLSchemeConfig>("openhalo_config_get"),
      invoke<URLSchemeCall[]>("openhalo_calls"),
    ]);
    setStatus(nextStatus);
    setConfig(nextConfig);
    setCalls(nextCalls);
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      invoke<URLSchemeStatus>("openhalo_status"),
      invoke<URLSchemeConfig>("openhalo_config_get"),
      invoke<URLSchemeCall[]>("openhalo_calls"),
    ]).then(([nextStatus, nextConfig, nextCalls]) => {
      if (!mounted) return;
      setStatus(nextStatus);
      setConfig(nextConfig);
      setCalls(nextCalls);
    }).catch(error => {
      if (mounted) setFeedback(`读取 URL Scheme 设置失败：${String(error)}`);
    });
    return () => { mounted = false; };
  }, []);

  const saveConfig = async (next: URLSchemeConfig) => {
    setBusy(true);
    setFeedback("");
    try {
      const saved = await invoke<URLSchemeConfig>("openhalo_config_set", { config: next });
      setConfig(saved);
      setFeedback("URL Scheme 设置已保存。");
    } catch (error) {
      setFeedback(`保存失败：${String(error)}`);
    } finally { setBusy(false); }
  };

  const toggleRegistration = async () => {
    setBusy(true);
    setFeedback("");
    try {
      const registered = await invoke<boolean>(status?.registered ? "openhalo_unregister" : "openhalo_register");
      const next = await invoke<URLSchemeStatus>("openhalo_status");
      setStatus(next);
      setFeedback(registered ? "openhalo: 已注册到系统。" : "openhalo: 已从系统取消注册。");
    } catch (error) {
      setFeedback(`协议注册失败：${String(error)}`);
    } finally { setBusy(false); }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(`${label}已复制。`);
    } catch (error) { setFeedback(`复制失败：${String(error)}`); }
  };

  const addAlias = async () => {
    const key = aliasName.trim();
    if (!key || !aliasTarget.trim()) return;
    await saveConfig({ ...config, aliases: { ...config.aliases, [key]: aliasTarget.trim() } });
    setAliasName("");
    setAliasTarget("");
  };

  const removeAlias = async (key: string) => {
    const aliases = { ...config.aliases };
    delete aliases[key];
    await saveConfig({ ...config, aliases });
  };

  return (
    <>
      <Group label="协议状态">
        <Row
          title={status?.registered ? "openhalo: 已注册" : "openhalo: 未注册"}
          description={status?.supported
            ? `当前平台：${status.platform === "darwin" ? "macOS" : "Windows"}。注册后，外部链接可启动 HALO。`
            : "系统级 URL Scheme 仅支持 Windows 和 macOS。"}
        >
          <button className="control-button" disabled={busy || !status?.supported} onClick={() => void toggleRegistration()}>
            {busy ? "处理中…" : status?.registered ? "取消注册" : "注册协议"}
          </button>
        </Row>
      </Group>

      <Group label="生成链接">
        <div className="openhalo-link-form">
          <Select<Action> value={action} onChange={setAction} options={[...ACTIONS]} aria-label="链接动作" />
          <TextInput value={target} onChange={setTarget}
            placeholder={action === "run" ? '"程序绝对路径" 参数' : "文件路径、别名或 HTTP(S) 地址"}
            aria-label="链接目标" />
        </div>
        <div className="openhalo-generated-link">
          <label>原生 URI</label>
          <code>{nativeUri || "输入目标后生成"}</code>
          <button className="control-button" disabled={!nativeUri} onClick={() => void copy(nativeUri, "原生 URI")}>复制</button>
        </div>
        <div className="openhalo-generated-link">
          <label>网关链接</label>
          <code>{gatewayLink || "输入目标后生成"}</code>
          <button className="control-button" disabled={!gatewayLink} onClick={() => void copy(gatewayLink, "网关链接")}>复制</button>
        </div>
        <div className="openhalo-gateway-config">
          <span>网关地址</span>
          <TextInput value={config.gatewayUrl} onChange={value => setConfig(current => ({ ...current, gatewayUrl: value }))} aria-label="网关地址" />
          <button className="control-button" disabled={busy} onClick={() => void saveConfig(config)}>保存</button>
        </div>
      </Group>

      <Group label="路径别名">
        <p className="openhalo-help">例如添加 hosts → C:\\Windows\\System32\\drivers\\etc\\hosts，之后可用 openhalo:hosts 打开。</p>
        <div className="openhalo-alias-form">
          <TextInput value={aliasName} onChange={setAliasName} placeholder="别名" aria-label="别名名称" />
          <TextInput value={aliasTarget} onChange={setAliasTarget} placeholder="绝对路径或程序目标" aria-label="别名目标" />
          <button className="control-button" disabled={busy || !aliasName.trim() || !aliasTarget.trim()} onClick={() => void addAlias()}>添加</button>
        </div>
        {Object.entries(config.aliases).length === 0 ? (
          <p className="openhalo-empty">还没有配置别名。</p>
        ) : (
          <div className="openhalo-alias-list">
            {Object.entries(config.aliases).map(([name, value]) => (
              <div className="openhalo-alias-row" key={name}>
                <code>{name}</code><span>{value}</span>
                <button className="control-button" disabled={busy} onClick={() => void removeAlias(name)}>删除</button>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group label="调用日志">
        <Row title="记录 URL Scheme 调用" description="日志保存在本机，仅保留最近 200 条">
          <Toggle checked={config.logging} onChange={value => void saveConfig({ ...config, logging: value })} disabled={busy} aria-label="记录 URL Scheme 调用" />
        </Row>
        <div className="openhalo-log-heading">
          <span>{calls.length} 条记录</span>
          <button className="control-button" onClick={() => void refresh().catch(error => setFeedback(String(error)))}>刷新</button>
        </div>
        {calls.length === 0 ? (
          <p className="openhalo-empty">暂无调用记录。</p>
        ) : (
          <div className="openhalo-log-list">
            {[...calls].reverse().map((call, index) => (
              <article className="openhalo-log-row" key={`${call.time}-${index}`}>
                <div>
                  <strong>{call.action || "URI"}</strong>
                  <span data-status={call.status}>
                    {call.status === "ok" ? "成功" : call.status === "cancelled" ? "已取消" : call.status === "ignored" ? "未处理" : "失败"}
                  </span>
                  <time>{new Date(call.time).toLocaleString()}</time>
                </div>
                <code>{call.target || call.uri}</code>
                {call.error && <span className="openhalo-log-error">{call.error}</span>}
              </article>
            ))}
          </div>
        )}
      </Group>

      {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
    </>
  );
}
