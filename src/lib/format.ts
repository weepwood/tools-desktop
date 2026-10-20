import type { VerificationMode } from "../types";

/*
 * Pure formatting helpers.
 *
 * These used to be closures inside HaloWorkspace, which meant they could not
 * be unit-tested or reused by 历史 / 视频 screens. They are pure functions of
 * their arguments, so they live here instead.
 */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

/** 10 leading + 8 trailing hex chars — enough to eyeball a difference. */
export function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : "—";
}

export function percentOf(completed: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

export function normalizeError(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "发生未知错误。";
}

export function verificationLabel(value?: VerificationMode): string {
  switch (value ?? "full") {
    case "fast":
      return "快速校验";
    case "sampled":
      return "抽样校验";
    case "full":
      return "完整校验";
  }
}

export function verificationDescription(value?: VerificationMode): string {
  switch (value ?? "full") {
    case "fast":
      return "仅核对文件大小、身份、修改时间和尾部标记，不读取文件正文。";
    case "sampled":
      return "读取头尾区块和 8 个随机区块，通常每个文件约 10 MiB。";
    case "full":
      return "完整读取文件一次并记录洗码前后 SHA-256，最严格但最慢。";
  }
}
