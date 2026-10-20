# HALO

**本机文件与视频工作台。** 洗码、校验恢复、重复文件查找、视频截图与切分、电源计划——全部在本地完成，不联网、不上传。

Electron 44 + React 19 + Vite 7，界面为手写 CSS（无 UI 框架）。

```
HALO/
├─ src/            渲染进程：shell（标题栏/侧栏/面板）、features、design system
├─ electron/       主进程：文件引擎、历史、视频、切分、IPC 校验
├─ assets/         图标：icon.svg、icon.png、icon.ico、icon.icns；含 macOS 彩色托盘图标
├─ tests/          node:test：引擎 / 切分 / 视频历史 / IPC 参数边界
└─ docs/           HALO-design.md（工程分析与设计系统说明）
```

## 开发与打包

建议 Node.js 24+。

```bash
npm ci
npm run dev

npm run build     # tsc --noEmit + vite build
npm run dist:win  # NSIS 安装器 + Portable
npm run dist:mac  # DMG + ZIP（需在 macOS 构建）
npm run dist:linux # AppImage + deb（需在 Linux 构建）
```

CI 为 Windows、macOS 和 Linux 分别构建安装包。Actions Artifacts 可下载对应平台产物；各平台本地打包通常也应在目标操作系统上运行。

### 自动发布多平台版本

更新 `package.json` 中的版本号并同步 `package-lock.json` 后，推送匹配的版本标签（例如 `v1.0.1`）。GitHub Actions 会构建 Windows、macOS 和 Linux 产物，并自动创建 GitHub Release 上传安装包。标签版本需与 `package.json` 中的版本一致。

## 功能

| 功能 | 实现 |
|---|---|
| 标题栏、主题、侧栏、设置、快捷键 | React + 自研 shell（可收起三栏 + 悬停预览） |
| 扫描过滤、文件统计、指纹核验 | Node.js fs + SHA-256 + 三段内容采样 |
| 重复文件查找 | 完整 SHA-256 分组；只报告结果，不自动删除 |
| 文件洗码 | 32 字节可恢复标记；兼容模式 5 字节随机标记 |
| 预扫描清单与可选原文件备份 | 显示候选文件，洗码前复制到独立批次目录 |
| 可复用洗码预设 | 本地保存筛选、校验、模式与备份目录配置 |
| 完整 / 抽样 / 快速校验 | 全文件 SHA-256、随机与定点区块采样、元数据检查 |
| 停止任务、确认与安全恢复 | AbortController、系统对话框、标记 / 大小 / 内容三重核验 |
| 洗码 / 恢复历史、CSV | JSON 历史 + 同步 JSONL 日志 + CSV 导出 |
| 视频定时截图 | ffprobe / ffmpeg、PNG 输出、实时进度、停止 |
| 定时屏幕截图 | Windows/macOS 选择显示器、锁屏/睡眠暂停、按日期归档并导出 MP4 |
| 截图画廊与放大预览 | 受限 `halo://image` 协议 |
| 截图联系表 | 使用 FFmpeg 导出当前截图页的缩略总览图 |
| 按大小切分视频 | `-c copy` 无损切分，严格校验每个分片不超阈值 |
| 分片清单与合并 | 生成可核对的 JSON 清单，可按清单无损合并，保留原分片 |
| 任务中心 | 汇总运行进度与最近洗码、恢复、截图、切分记录 |
| 跨平台电源计划 | Windows/macOS/Linux 定时关机；定时开机需平台和硬件支持 |
| 托盘、通知、开机启动 | Electron 主进程 |
| 邮件通知 | 自研 SMTP 客户端（EHLO / STARTTLS / AUTH / DATA），密码经系统密钥环加密 |

## 邮件通知

设置 → 邮件通知 中填写 SMTP 服务器（SSL/TLS 465、STARTTLS 587 或内网不加密）、账号与收件人，保存后可先发送测试邮件。
开启「启用邮件通知」+「任务结束时发送」后，洗码、恢复、视频截图与切分任务结束时会自动发信；该开关独立于系统通知。

- 协议实现位于 `electron/mailer.cjs`，无第三方邮件库依赖，渲染进程拿不到密码与套接字。
- 配置保存在应用数据目录的 `mail.json`；密码经 Electron `safeStorage` 加密（macOS 钥匙串 / Windows DPAPI / Linux 密钥环），系统无密钥环时降级为仅当前用户可读的明文，设置页会明确提示。
- 收件人最多 20 个；邮件正文为 UTF-8 base64，中文标题按 RFC 2047 编码，各邮件客户端均可正常显示。

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
