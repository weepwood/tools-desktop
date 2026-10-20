/*
 * Mail notification bridge.
 *
 * SMTP lives entirely in the main process: this module only shapes the config
 * for the settings pane and fires a task-end notification. The password is
 * write-only — `getMailConfig()` never returns it.
 */

export type MailSecurity = "tls" | "starttls" | "none";

export interface MailDeliveryResult {
  at: string | null;
  ok: boolean | null;
  error: string | null;
}

export interface MailConfig {
  enabled: boolean;
  notifyOnTaskEnd: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  from: string;
  fromName: string;
  to: string[];
  /** A secret is stored; the value itself stays in the main process. */
  hasPassword: boolean;
  /** True when the OS keyring encrypts the stored secret. */
  secretProtected: boolean;
  lastResult: MailDeliveryResult;
}

export type MailPatch = Partial<Omit<MailConfig, "hasPassword" | "secretProtected" | "lastResult">> & {
  password?: string;
  clearPassword?: boolean;
};

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!window.halo) throw new Error("邮件通知只能在桌面应用中配置。");
  return window.halo.invoke<T>(command, args);
}

let cached: MailConfig | null = null;

export async function getMailConfig(): Promise<MailConfig> {
  const config = await invoke<MailConfig>("mail_config_get");
  cached = config;
  return config;
}

export async function saveMailConfig(patch: MailPatch): Promise<MailConfig> {
  const config = await invoke<MailConfig>("mail_config_set", { patch });
  cached = config;
  return config;
}

export async function sendTestMail(): Promise<MailDeliveryResult> {
  try {
    const result = await invoke<MailDeliveryResult>("mail_test");
    if (cached) cached = { ...cached, lastResult: { at: result.at ?? null, ok: true, error: null } };
    return result;
  } catch (error) {
    return { at: new Date().toISOString(), ok: false, error: errorText(error) };
  }
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // The IPC layer prefixes rejections with "Error invoking remote method ...".
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}

/**
 * Fire-and-forget task notification. Silently does nothing unless the user
 * enabled mail + task notifications and configured a server, so callers can
 * invoke it unconditionally next to the system notification.
 */
export async function notifyTaskEndByMail(title: string, body: string): Promise<void> {
  try {
    const config = cached ?? (await getMailConfig());
    if (!config.enabled || !config.notifyOnTaskEnd || !config.host || !config.to.length) return;
    if (!config.from) return;
    await invoke("mail_notify", { title, body });
  } catch {
    // A failed notification must never surface as a task failure.
  }
}
