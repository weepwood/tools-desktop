import { useEffect, useMemo, useState } from "react";
import { Group, Row } from "./SettingsGroup";
import { TextInput } from "./controls/TextInput";
import { Toggle } from "./controls/Toggle";
import { Select } from "./controls/Select";
import { NoticeStack, NoticeToast } from "../components/NoticeToast";
import {
  getMailConfig,
  saveMailConfig,
  sendTestMail,
  type MailConfig,
  type MailSecurity,
} from "../lib/mail";
import "./MailSettings.css";

/*
 * 邮件通知 pane. SMTP credentials are edited here but stored by the main
 * process; the password field is write-only, so reopening settings shows
 * "已保存" instead of the secret.
 */

interface Draft {
  enabled: boolean;
  notifyOnTaskEnd: boolean;
  host: string;
  port: string;
  security: MailSecurity;
  username: string;
  from: string;
  fromName: string;
  to: string;
}

function toDraft(config: MailConfig): Draft {
  return {
    enabled: config.enabled,
    notifyOnTaskEnd: config.notifyOnTaskEnd,
    host: config.host,
    port: String(config.port),
    security: config.security,
    username: config.username,
    from: config.from,
    fromName: config.fromName,
    to: config.to.join(", "),
  };
}

function parseRecipients(value: string): string[] {
  return [...new Set(value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean))];
}

type Feedback = { tone: "info" | "success" | "error"; text: string } | null;

export function MailSettings() {
  const [config, setConfig] = useState<MailConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [testNotice, setTestNotice] = useState<Feedback>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    if (!window.halo) {
      setLoadError("邮件通知只能在桌面应用中配置。");
      return;
    }
    void getMailConfig()
      .then((value) => {
        if (!active) return;
        setConfig(value);
        setDraft(toDraft(value));
      })
      .catch((error) => { if (active) setLoadError(`读取邮件配置失败：${String(error)}`); });
    return () => { active = false; };
  }, []);

  const base = useMemo(() => (config ? toDraft(config) : null), [config]);
  const dirty = Boolean(draft && base && JSON.stringify(draft) !== JSON.stringify(base)) || password.length > 0;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  function validate(value: Draft): string {
    if (value.enabled) {
      if (!value.host.trim()) return "启用前请填写 SMTP 服务器地址。";
      if (!value.from.trim()) return "启用前请填写发件人地址。";
      if (!parseRecipients(value.to).length) return "启用前请填写至少一个收件人。";
    }
    const port = Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "端口必须是 1-65535 之间的整数。";
    return "";
  }

  async function persist(report: (message: NonNullable<Feedback>) => void = setFeedback): Promise<MailConfig | null> {
    if (!draft) return null;
    const problem = validate(draft);
    if (problem) {
      report({ tone: "error", text: problem });
      return null;
    }
    try {
      const saved = await saveMailConfig({
        enabled: draft.enabled,
        notifyOnTaskEnd: draft.notifyOnTaskEnd,
        host: draft.host.trim(),
        port: Number(draft.port),
        security: draft.security,
        username: draft.username.trim(),
        from: draft.from.trim(),
        fromName: draft.fromName.trim(),
        to: parseRecipients(draft.to),
        ...(password ? { password } : {}),
      });
      setConfig(saved);
      setDraft(toDraft(saved));
      setPassword("");
      return saved;
    } catch (error) {
      report({ tone: "error", text: `保存失败：${clean(error)}` });
      return null;
    }
  }

  async function save() {
    setBusy("save");
    setFeedback(null);
    const saved = await persist();
    setBusy(null);
    if (saved) setFeedback({ tone: "success", text: "配置已保存。" });
  }

  async function saveAndTest() {
    setBusy("test");
    setFeedback(null);
    setTestNotice(null);
    const saved = await persist(setTestNotice);
    if (!saved) {
      setBusy(null);
      return;
    }
    try {
      const result = await sendTestMail();
      if (result.ok) {
        setTestNotice({ tone: "success", text: `测试邮件已发送至 ${saved.to.join("、")}。` });
      } else {
        setTestNotice({ tone: "error", text: result.error || "测试邮件发送失败。" });
      }
    } catch (error) {
      setTestNotice({ tone: "error", text: `测试邮件发送失败：${clean(error)}` });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <p className="settings-feedback" role="alert">{loadError}</p>;
  if (!draft) return <p className="settings-feedback">正在读取邮件配置…</p>;

  return (
    <>
      <Group label="发送条件">
        <Row title="启用邮件通知" description="通过 SMTP 服务器把任务结果发送到邮箱">
          <Toggle checked={draft.enabled} onChange={(v) => set("enabled", v)} aria-label="启用邮件通知" />
        </Row>
        <Row title="任务结束时发送" description="洗码、恢复、视频截图与切分任务结束后自动发信">
          <Toggle
            checked={draft.notifyOnTaskEnd}
            onChange={(v) => set("notifyOnTaskEnd", v)}
            disabled={!draft.enabled}
            aria-label="任务结束时发送邮件"
          />
        </Row>
      </Group>

      <Group label="SMTP 服务器">
        <Row title="服务器地址" description="如 smtp.qq.com、smtp.gmail.com">
          <div className="mail-field">
            <TextInput value={draft.host} onChange={(v) => set("host", v)} placeholder="smtp.example.com" aria-label="SMTP 服务器地址" />
          </div>
        </Row>
        <Row title="端口" description="SSL/TLS 通常为 465，STARTTLS 通常为 587">
          <div className="mail-field mail-field-narrow">
            <TextInput value={draft.port} onChange={(v) => set("port", v.replace(/[^\d]/g, ""))} placeholder="465" aria-label="SMTP 端口" />
          </div>
        </Row>
        <Row title="加密方式" description="不加密仅适用于本机或内网中继">
          <Select<MailSecurity>
            value={draft.security}
            onChange={(v) => set("security", v)}
            aria-label="SMTP 加密方式"
            options={[
              { value: "tls", label: "SSL/TLS 直连" },
              { value: "starttls", label: "STARTTLS" },
              { value: "none", label: "不加密" },
            ]}
          />
        </Row>
        {draft.security === "none" && (
          <p className="mail-warning" role="alert">
            已选择「不加密」：账号与邮件内容将以明文在网络中传输，凭据可被同网段截获。仅可在本机中继或可信内网中使用。
          </p>
        )}
        <Row title="用户名" description="通常与发件人地址相同">
          <div className="mail-field">
            <TextInput value={draft.username} onChange={(v) => set("username", v)} placeholder="you@example.com" aria-label="SMTP 用户名" />
          </div>
        </Row>
        <Row
          title="密码 / 授权码"
          description={config?.hasPassword ? "已保存，留空则保持不变" : "多数邮箱需要使用客户端授权码"}
        >
          <div className="mail-field">
            <TextInput
              value={password}
              onChange={setPassword}
              type="password"
              placeholder={config?.hasPassword ? "••••••••" : "输入密码或授权码"}
              aria-label="SMTP 密码"
            />
          </div>
        </Row>
      </Group>

      <Group label="邮件内容">
        <Row title="发件人地址" description="邮件头中的 From，需与服务器允许的发信身份一致">
          <div className="mail-field">
            <TextInput value={draft.from} onChange={(v) => set("from", v)} placeholder="halo@example.com" aria-label="发件人地址" />
          </div>
        </Row>
        <Row title="发件人名称" description="可选，显示在收件箱里">
          <div className="mail-field">
            <TextInput value={draft.fromName} onChange={(v) => set("fromName", v)} placeholder="HALO" aria-label="发件人名称" />
          </div>
        </Row>
        <Row title="收件人" description="多个地址用逗号分隔，最多 20 个" stacked>
          <div className="mail-field mail-field-wide">
            <TextInput value={draft.to} onChange={(v) => set("to", v)} placeholder="you@example.com, team@example.com" aria-label="收件人地址" />
          </div>
        </Row>
      </Group>

      <Group label="验证">
        <Row title="发送测试邮件" description="按当前已保存的配置发送一封测试邮件">
          <button className="control-button" disabled={busy !== null} onClick={() => void saveAndTest()}>
            {busy === "test" ? "发送中…" : "保存并发送测试"}
          </button>
        </Row>
        {config?.hasPassword && !config.secretProtected && (
          <p className="mail-warning" role="alert">
            当前系统未提供密钥环，密码以明文形式保存在本机应用数据目录，仅当前用户可读。
          </p>
        )}
      </Group>

      <div className="mail-actions">
        <button className="control-button" data-variant="primary" disabled={busy !== null || !dirty} onClick={() => void save()}>
          {busy === "save" ? "保存中…" : "保存配置"}
        </button>
        {dirty && <span className="mail-dirty">有未保存的修改</span>}
      </div>
      {feedback && (
        <p className="settings-feedback" data-tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.text}
        </p>
      )}
      {testNotice && (
        <NoticeStack>
          <NoticeToast type={testNotice.tone} message={testNotice.text} onDismiss={() => setTestNotice(null)} />
        </NoticeStack>
      )}
    </>
  );
}

function clean(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}
