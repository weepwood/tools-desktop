# XIMA Tools — Electron Edition

本项目基于 [XIMA Desktop](https://github.com/weepwood/xima-desktop) 的原始 React 19 + CSS UI，移植为 Electron 桌面客户端。

原项目 Tauri/Rust 后端已由 Electron 主进程的 Node.js 文件系统和 FFmpeg 服务替代；界面的配色、布局、导航、卡片、设置页和交互文件来自原仓库。

## 开发与打包

建议 Node.js 24+。

    npm ci
    npm run dev

    npm test
    npm run build
    npm run dist:win

Windows x64 安装包：NSIS 安装器、Portable 便携程序。CI 运行后，在 GitHub Actions Artifacts 中下载构建结果。

## 迁移功能

| 功能 | Electron 实现 |
|---|---|
| 标题栏、主题、侧栏、设置、快捷键 | 直接复用 React 和原 CSS |
| 扫描过滤、文件统计、指纹核验 | Node.js fs + SHA-256 |
| 文件洗码 | 与 Rust 相同的 32 字节 XIMA 可恢复标记、兼容模式 5 字节随机标记 |
| 完整/抽样/快速校验 | SHA-256、随机/定点区块采样、元数据检查 |
| 停止任务、确认与安全恢复 | AbortController、Electron Dialog、标记/大小/内容核验 |
| 洗码/恢复历史、CSV | JSON 历史、同步 JSONL 日志、CSV 导出 |
| 视频定时截图与记录 | ffprobe/ffmpeg、PNG 图片、进度、停止 |
| 截图画廊、放大预览、输出目录 | 限制访问的 xima://image 协议 |
| 托盘、通知、开机启动 | Electron 主进程 |

## 安全与兼容说明

- 本地文件修改是高风险操作。**正式使用前请备份重要文件**，并在真实的 Windows 环境运行回归测试。
- 渲染进程关闭 Node.js Integration，开启 Context Isolation 和 Sandbox；受控 Preload + IPC 只允许显式列出的操作。
- 新版本使用自己的 Electron 数据目录（历史、设置、任务记录）；**不自动导入或删除原 Tauri 历史**。原 Rust 的尾部标记格式兼容，但记录、文件身份和异常恢复仍须单独验证后才能迁移。
- 视频工具来自 ffmpeg-static 与 ffprobe-static，支持 XIMA_VIDEO_TOOLS 环境变量指定自己的 FFmpeg/FFprobe。实际分发前需要核查第三方二进制许可证、附带声明和源代码提供义务。
- 当前截图画廊直接使用原始 PNG 作为网格图片，没有 Tauri 版的磁盘缩略图缓存，大图加载性能可能有差异。
- Windows NSIS 安装包尚未完成真实机器的安装/卸载与界面交互验收，CI 通过也不等于功能完全等价。

## 来源和授权

原始项目：[weepwood/xima-desktop](https://github.com/weepwood/xima-desktop)。

前端源码由原仓库移植，遵循仓库保留的 MIT LICENSE。外部 FFmpeg/FFprobe 二进制遵循各自许可证。

## v0.2.0 安全与稳定性

- Electron 单实例锁：第二次启动会激活已有窗口，避免多进程同时编辑同一文件。
- 扫描指纹纳入文件身份、修改时间及头/中/尾三个不超过 4 KiB 的内容采样点，写入前重新校验；即使 Windows 时间戳粒度不足也能发现采样区域的变化。
- IPC 入参采用明确命令列表、类型与路径约束；渲染侧不暴露 Node 文件系统接口。
- CSP 阻止远程代码/脚本加载；主题初始化已移至独立静态资源。
- 单个损坏的视频历史或恢复日志不再阻断其他有效记录；损坏文件原样保留，设置页可以查看历史诊断。
- CI 使用 npm lockfile 与 `npm ci` 实现可重复依赖安装，额外运行参数边界测试。

**注意：** 扫描指纹还包含小范围内容采样，但不等于完整内容哈希；恶意修改或只修改未采样区域的变化仍可能绕过。关键文件请使用完整 SHA-256 校验。大量小文件预扫描会额外打开并读取文件片段，可能增加扫描耗时。首次升级后建议用测试文件验证恢复流程；不要把历史记录当成原文件备份。
