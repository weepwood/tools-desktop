# HALO

**本机文件与视频工作台。** 洗码、校验恢复、视频截图、按大小切分——全部在本地完成，不联网、不上传。

Electron 44 + React 19 + Vite 7，界面为手写 CSS（无 UI 框架）。

```
HALO/
├─ src/            渲染进程：shell（标题栏/侧栏/面板）、features、design system
├─ electron/       主进程：文件引擎、历史、视频、切分、IPC 校验
├─ assets/         图标：icon.svg（源文件）、icon.png、icon.ico、tray.png
├─ tests/          node:test：引擎 / 切分 / 视频历史 / IPC 参数边界
└─ docs/           HALO-design.md（工程分析与设计系统说明）
```

## 开发与打包

建议 Node.js 24+。

```bash
npm ci
npm run dev

npm test          # 26 项回归测试
npm run build     # tsc --noEmit + vite build
npm run dist:win  # NSIS 安装器 + Portable
```

Windows x64 产物：`HALO-Setup-<version>-x64.exe`、`HALO-Portable-<version>-x64.exe`。CI 通过后在 GitHub Actions Artifacts 的 `HALO-Windows` 中下载。

## 功能

| 功能 | 实现 |
|---|---|
| 标题栏、主题、侧栏、设置、快捷键 | React + 自研 shell（可收起三栏 + 悬停预览） |
| 扫描过滤、文件统计、指纹核验 | Node.js fs + SHA-256 + 三段内容采样 |
| 文件洗码 | 32 字节可恢复标记；兼容模式 5 字节随机标记 |
| 完整 / 抽样 / 快速校验 | 全文件 SHA-256、随机与定点区块采样、元数据检查 |
| 停止任务、确认与安全恢复 | AbortController、系统对话框、标记 / 大小 / 内容三重核验 |
| 洗码 / 恢复历史、CSV | JSON 历史 + 同步 JSONL 日志 + CSV 导出 |
| 视频定时截图 | ffprobe / ffmpeg、PNG 输出、实时进度、停止 |
| 截图画廊与放大预览 | 受限 `halo://image` 协议 |
| 按大小切分视频 | `-c copy` 无损切分，严格校验每个分片不超阈值 |
| 托盘、通知、开机启动 | Electron 主进程 |

## 设计系统

三层：`styles/tokens.css`（原子令牌）→ `styles/themes.css`（双主题 + 语义别名）→ `components/ui.css`（原语）。
功能样式表只做布局，**不重新定义原语**。

- 主色靛青 `#4658E8` / 深色 `#6D7CFF`；成功、警告、危险各有独立的弱底与可读文字色。
- 动效只用位移与透明度，220–320ms，`prefers-reduced-motion` 与设置页开关双重降级。
- 完整规范（含时长曲线表与决策理由）见 [`docs/HALO-design.md`](docs/HALO-design.md)。

## 安全与兼容

- **洗码会直接修改原文件。** 正式使用前请备份重要文件，并在真实 Windows 环境做回归验证。
- 渲染进程关闭 Node 集成，启用 contextIsolation + sandbox；preload 只暴露显式命令白名单，主进程逐条校验入参与路径。
- CSP 禁止远程脚本，主题在首帧前由 `public/theme-init.js` 应用，无白闪。
- 视频工具来自 `ffmpeg-static` / `ffprobe-static`，可用 `HALO_VIDEO_TOOLS` 指向自备目录。分发前需核查第三方二进制许可证与源代码提供义务。
- 单个损坏的历史或恢复日志不会阻断其他记录；损坏文件原样保留，设置页可查看诊断。
- 扫描指纹包含文件身份、修改时间与头/中/尾采样，**不等于完整内容哈希**——关键文件请用完整 SHA-256 校验。

## 品牌重命名说明

本项目原为 XIMA Desktop 的 Electron 移植版，现统一更名为 **HALO**：界面、CSS 前缀、IPC 通道、协议、环境变量、安装产物全部同步。

- 磁盘上的洗码标记字节（`XIMA` 的 ASCII，32 字节格式）**保持不变**，已洗码文件仍可正常识别与恢复。
- 应用数据目录改为 `%APPDATA%\halo-desktop`，旧目录不会自动迁移；升级后主题、面板尺寸与上次目录会回到默认一次。
- 环境变量改为 `HALO_DEV_URL` / `HALO_VIDEO_TOOLS`；自定义协议改为 `halo://`。

## 来源和授权

原始项目：[weepwood/xima-desktop](https://github.com/weepwood/xima-desktop)（Tauri + Rust）。
前端源码由原仓库移植并按 MIT LICENSE 使用；FFmpeg / FFprobe 二进制遵循各自许可证。
