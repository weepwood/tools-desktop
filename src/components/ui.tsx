import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import "./ui.css";

/*
 * HALO primitives.
 *
 * Every screen in the app is built from these. They exist for two reasons:
 *   1. one visual language — the same button, card, badge and field look
 *      identical in 文件洗码 / 视频截图 / 视频切分 / 历史恢复;
 *   2. one accessibility baseline — focus ring, aria wiring and disabled
 *      states are implemented once instead of per screen.
 *
 * Style-only markup (e.g. `<div className="halo-card">`) still works, because
 * the class names in ui.css are the public surface. Components are the
 * preferred entry point in new code.
 */

/* -------------------------------------------------------------- Button */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Compact height for toolbars and inline actions. */
  compact?: boolean;
  /** Stretch to the width of its container. */
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  compact,
  block,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "halo-button",
    variant,
    compact ? "compact" : "",
    block ? "block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Card */

export interface CardProps {
  title?: ReactNode;
  /** Small right-aligned label in the heading row. */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Remove body padding (tables and lists manage their own). */
  flush?: boolean;
}

export function Card({
  title,
  meta,
  actions,
  children,
  className,
  flush,
}: CardProps) {
  return (
    <section className={["halo-card", flush ? "flush" : "", className ?? ""].filter(Boolean).join(" ")}>
      {(title || meta || actions) && (
        <div className="halo-card-heading">
          <div className="halo-card-title">
            {title && <h2>{title}</h2>}
            {meta && <span className="halo-card-meta">{meta}</span>}
          </div>
          {actions && <div className="halo-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* --------------------------------------------------------------- Badge */

export type BadgeTone = "success" | "failed" | "skipped" | "pending" | "accent";

const TONE_LABEL: Record<BadgeTone, string> = {
  success: "成功",
  failed: "失败",
  skipped: "跳过",
  pending: "待核验",
  accent: "进行中",
};

export function Badge({
  tone,
  children,
  dot = true,
}: {
  tone: BadgeTone;
  children?: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`halo-badge ${tone}`}>
      {dot && <span className="halo-badge-dot" aria-hidden="true" />}
      {children ?? TONE_LABEL[tone]}
    </span>
  );
}

/* -------------------------------------------------------------- Switch */

export interface SwitchRowProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * A labelled switch row. The native checkbox stays in the DOM (visually
 * hidden) so keyboard, screen readers and form semantics keep working.
 */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  ...rest
}: SwitchRowProps) {
  return (
    <label className="halo-switch-row" data-disabled={disabled || undefined}>
      <span className="halo-switch-copy">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      <span className="halo-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          {...rest}
        />
        <span className="halo-switch-track" aria-hidden="true" />
      </span>
    </label>
  );
}

/* --------------------------------------------------------------- Field */

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["halo-field", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

/* ------------------------------------------------------------ Progress */

export function ProgressBar({
  percent,
  completed,
  total,
  label = "文件处理进度",
  running = false,
}: {
  percent: number;
  completed: number;
  total: number;
  label?: string;
  running?: boolean;
}) {
  return (
    <div className="halo-progress-block">
      <div
        className="halo-progress"
        data-running={running || undefined}
        role="progressbar"
        aria-label={label}
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuetext={`${completed} / ${total} 个文件`}
      >
        <div className="halo-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="halo-progress-meta">
        <strong>{percent}%</strong>
        <span>
          {completed} / {total} 文件
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Pagination */

export function Pagination({
  total,
  page,
  onChange,
  size = 50,
  unit = "条",
}: {
  total: number;
  page: number;
  onChange: (page: number) => void;
  size?: number;
  unit?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="halo-pagination">
      <span>
        共 {total} {unit} · 第 {page + 1} / {pages} 页
      </span>
      <div>
        <Button compact disabled={page === 0} onClick={() => onChange(page - 1)}>
          上一页
        </Button>
        <Button
          compact
          disabled={page + 1 >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="halo-empty-state">
      {icon && <span className="halo-empty-icon">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/* -------------------------------------------------------- SectionLabel */

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="halo-section-label">{children}</div>;
}
