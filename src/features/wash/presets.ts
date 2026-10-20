/** Shared option lists for the wash screen. */

export const DEFAULT_EXTENSIONS = [
  "mp4", "mkv", "mov", "avi", "wmv", "flv", "webm",
  "jpg", "jpeg", "png", "gif", "webp", "heic",
  "zip", "rar", "7z", "tar", "pdf", "mp3", "flac", "m4a", "wav",
];

export const PAGE_SIZE = 50;

export const EXTENSION_PRESETS = [
  { label: "常用", values: DEFAULT_EXTENSIONS },
  { label: "视频", values: ["mp4", "mkv", "mov", "avi", "wmv", "flv", "webm"] },
  { label: "图片", values: ["jpg", "jpeg", "png", "gif", "webp", "heic"] },
  { label: "音频", values: ["mp3", "flac", "m4a", "wav"] },
  { label: "文档 / 压缩", values: ["pdf", "zip", "rar", "7z", "tar"] },
];

export const RESULT_FILTERS = [
  { value: "all", label: "全部" },
  { value: "failed", label: "失败" },
  { value: "success", label: "成功" },
  { value: "skipped", label: "跳过" },
];
