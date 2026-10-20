import { SHORTCUT_ACTIONS } from "../lib/shortcuts";

/*
 * Search index for the settings panel. Mirrors every row rendered in
 * SettingsView so the sidebar search can match against all settings
 * text. When you add/remove a settings row, update CONTENT here too —
 * except the "shortcuts" category, which is derived from
 * SHORTCUT_ACTIONS and stays in sync automatically.
 */

export interface SearchRow {
  title: string;
  description?: string;
}

const CONTENT: Record<string, SearchRow[]> = {
  general: [
    { title: "显示托盘图标", description: "关闭窗口后继续在托盘运行" },
    { title: "开机启动", description: "登录系统后自动启动 HALO" },
    { title: "启动时最小化", description: "通过托盘访问应用" },
    { title: "任务通知", description: "洗码或恢复任务结束后发送系统通知" },
    { title: "应用内通知位置", description: "设置操作提示在窗口中的显示位置：四角或顶部居中" },
    { title: "测试通知", description: "发送通知以检查系统权限" },
  ],
  mail: [
    { title: "启用邮件通知", description: "通过 SMTP 服务器把任务结果发送到邮箱" },
    { title: "任务结束时发送", description: "任务结束后自动发送邮件通知" },
    { title: "服务器地址", description: "SMTP 服务器地址，如 smtp.qq.com" },
    { title: "端口", description: "465（SSL/TLS）或 587（STARTTLS）" },
    { title: "加密方式", description: "SSL/TLS 直连、STARTTLS 或不加密" },
    { title: "用户名", description: "SMTP 登录账号" },
    { title: "密码 / 授权码", description: "SMTP 密码或客户端授权码" },
    { title: "发件人地址", description: "邮件头 From 地址" },
    { title: "发件人名称", description: "显示在收件箱里的名称" },
    { title: "收件人", description: "通知邮件的接收地址" },
    { title: "发送测试邮件", description: "按当前配置发送测试邮件" },
  ],
  appearance: [
    { title: "外观主题", description: "跟随系统、浅色或深色主题" },
    { title: "界面字体", description: "系统默认、Segoe UI、微软雅黑、等线、思源黑体" },
    { title: "减少动态效果", description: "减少面板动画，或跟随系统偏好" },
  ],
  advanced: [
    { title: "恢复记录", description: "历史、任务日志和备份保存在本机，历史不会自动删除" },
    { title: "恢复应用设置", description: "重置主题、字体、动画和启动选项" },
  ],
};

/** Searchable rows for a category (shortcuts are derived from their store). */
export function rowsForCategory(id: string): SearchRow[] {
  if (id === "shortcuts") {
    return SHORTCUT_ACTIONS.map((a) => ({ title: a.label, description: a.description }));
  }
  return CONTENT[id] ?? [];
}

export interface CategoryMatch {
  categoryId: string;
  /** The category label itself matched (e.g. searching "profile"). */
  labelMatch: boolean;
  /** Rows within the category whose title or description matched. */
  rows: SearchRow[];
}

/**
 * Match a query against every category's label and rows, preserving the
 * given category order. A category is included when its label matches or
 * at least one of its rows matches.
 */
export function searchSettings(
  query: string,
  categories: readonly { id: string; label: string }[],
): CategoryMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: CategoryMatch[] = [];
  for (const cat of categories) {
    const labelMatch = cat.label.toLowerCase().includes(q);
    const rows = rowsForCategory(cat.id).filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
    if (labelMatch || rows.length > 0) {
      results.push({ categoryId: cat.id, labelMatch, rows });
    }
  }
  return results;
}
