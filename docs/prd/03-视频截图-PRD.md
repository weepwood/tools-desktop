# HALO 视频截图 PRD（完整版）

> 版本 v1.0 · 作者 司南（产品）· 日期 2026-10-21 · 状态 草稿（基于 `electron/video.cjs` 源码核实）
> 范围：本文「视频截图」指**从视频文件按间隔抽帧**（`Video.extract`）。另有一套「屏幕定时录制」能力（`ScreenCapture`，见附录），二者共用 FFmpeg 解析与缩略图协议。

## 一、文档信息

| 项 | 内容 |
|----|------|
| 文档版本 | v1.0 |
| 作者 | 司南（产品） |
| 日期 | 2026-10-21 |
| 变更记录 | v1.0 初版 |
| 评审记录 | 待评审 |

## 二、背景与目标

**背景**：用户需要把一段视频按固定时间间隔抽取静帧（关键帧 PNG），用于预览、取证或做联系表。实现依赖本地 FFmpeg，经 `halo://image` 协议在渲染进程展示缩略图。

**要解决的问题**：
1. 抽帧必须无损（`-c copy` 思路不适用抽帧，实际用 fps 滤镜 + PNG），间隔可配。
2. 输出目录自动分配、不与已有冲突。
3. 缩略图协议对每张图不重复扫描任务列表（性能）。

**成功指标与口径**：
- 抽帧成功率 = 生成帧数 > 0 的完成任务数 ÷ 总抽帧任务数（目标 ≥98%）。
- 平均单任务帧数 = framesWritten（按 interval 与 duration 推算）。

## 三、名词与术语定义

| 术语 | 定义 |
|------|------|
| 抽帧 `extract` | 用 ffmpeg `fps=1/<interval>` 按间隔导出 PNG |
| 帧文件 `keyframes_NNN.png` | 抽取出的静帧，命名含序号 |
| 任务记录 `video-tasks/<id>.json` | 含 video/schema/status/framesWritten |
| `halo://image` 协议 | 渲染进程读取本地 PNG 缩略图的自定义协议，经 `imageAllowed` 校验 |
| 工具解析 `resolveBinaries` | 从 `HALO_VIDEO_TOOLS` / 静态包 / PATH 解析可用 ffmpeg/ffprobe |

## 四、需求范围

**包含**：选视频、设间隔（1–86400s）、抽帧、输出目录自动分配、分页浏览、联系表导出（tile 4×6）、任务列表（TTL 缓存）、损坏记录保留。
**不包含**：视频剪辑、转码、字幕提取；屏幕录制（见附录）。

## 五、方案对比与选型说明

| 方案 | 对比 | 结论 |
|------|------|------|
| 帧导出 | ffmpeg fps 滤镜直接出 PNG vs 先抽再转 | **直接出 PNG**（简单、无损） |
| 列表读取 | 每次重读所有任务 JSON vs 2s TTL 缓存 | **2s TTL 缓存**（已落地，缩略图批量共享一次扫描） |
| 输出目录 | 覆盖 vs 自动分配 `<名>/<名>_截图_N` | **自动分配**（已落地） |

推荐：维持现状。后续演进：补拖放（当前 `src/` 零 drag/onDrop）、导出格式/质量可配。

## 六、用户角色与使用场景

| 角色 | 目标 | 场景 | 频率 |
|------|------|------|------|
| 普通用户 | 按间隔抽帧预览 | 长视频取证/预览关键帧；导出联系表 | 中 |

## 七、功能需求

**FR-01 抽帧任务**
- 描述：选视频 + 间隔，调用 ffmpeg `fps=1/<interval>` 导出 `keyframes_%03d.png` 到自动分配目录，记录任务。
- 规则：间隔须 1–86400 整数秒；输出目录自动分配且不与已有冲突；`-atomic_writing 1` 防半文件。
- 验收：Given 视频 + 间隔 5s，When 抽帧完成，Then 目录含 N 张 PNG 且任务状态 completed；Given 间隔 0，When 提交，Then 拒绝（参数校验）。

**FR-02 工具可用性校验**
- 描述：`toolStatus`/`resolveBinaries` 解析并 `-version` 验证 ffmpeg/ffprobe；缺失则报错指引配置 `HALO_VIDEO_TOOLS`。
- 验收：Given 无 ffmpeg，When 抽帧，Then 报错「未找到可运行的 ffmpeg」。

**FR-03 分页浏览与缩略图**
- 描述：`page` 按 24/页返回帧；`halo://image` 协议经 `imageAllowed`（校验文件名/目录/真实路径/PNG 头尾）后返回图。
- 验收：Given 任务有 50 帧，When 取第 2 页，Then 返回后 26 帧；Given 非 HALO 截图文件，When 请求协议，Then 拒绝。

**FR-04 联系表导出**
- 描述：`contactSheet` 用 ffmpeg tile 4×6 把当前页拼成一张 PNG。
- 验收：Given 当前页有帧，When 导出联系表，Then 生成有效 PNG 且 size ≥ 45。

**FR-05 任务列表与容错**
- 描述：`list` 用 2s TTL 缓存；损坏任务记录保留并告警，不阻断其他任务。
- 验收：Given 一个损坏任务 JSON，When list，Then 该记录被跳过并记告警。

**FR-06 中断恢复**
- 描述：`recover` 把 `running` 状态任务标为 `interrupted`。
- 验收：Given 上次意外退出遗留 running 任务，When 启动 recover，Then 标 interrupted。

## 八、非功能需求

| 类别 | 要求 |
|------|------|
| 性能 | 列表 2s TTL 缓存；缩略图协议批量共享一次扫描 |
| 兼容 | macOS/Windows/Linux；FFmpeg 来自环境变量/静态包/PATH |
| 资源 | PNG 落盘，按帧数线性增长 |

## 九、业务流程与状态流转

**任务状态机**：`running` → `completed` / `cancelled`（用户中止）/ `failed`（未生成帧或工具错误）。
主流程：probe 视频 → allocate 目录 → save(running) → ffmpeg 抽帧 → 统计帧数 → save(completed/failed)。

## 十、数据与埋点需求

- 核心文件：`video-tasks/<id>.json`（schemaVersion/video/intervalSeconds/outputDir/status/framesWritten）。
- 缩略图协议：`halo://image` 注册于主进程，`imageAllowed` 校验。
- 埋点建议：抽帧任务数、平均帧数、工具缺失次数（当前仅 logger）。

## 十一、权限与安全要求

- 仅读取用户显式选择的视频与输出目录。
- `imageAllowed` 严格校验路径真实性与 PNG 头尾，防目录穿越。
- 无网络。

## 十二、异常处理清单

| 场景 | 处理 |
|------|------|
| ffmpeg/ffprobe 缺失 | 报错指引配置 HALO_VIDEO_TOOLS |
| 无法读视频时长/分辨率 | 报错拒绝 |
| 未生成任何帧 | 状态 failed，提示缩短间隔 |
| 用户中止 | signal.aborted → cancelled |
| 损坏任务记录 | 保留并告警，不阻断其他 |

## 十三、上线计划与上线后验证

- 依赖：外部 FFmpeg/FFprobe（环境变量或打包静态二进制）。
- 验证：`npm test` 现状 48 通过 / 3 失败（沙箱限制，非回归）；FFmpeg 调用需真实环境联调。

## 十四、风险与遗留问题

| 编号 | 风险 | 等级 | 应对 |
|------|------|------|------|
| RK-01 | 无拖放，文件选择依赖系统选择器 | 中 | 评估补拖放（当前架构零 drag/onDrop） |
| RK-02 | 导出格式/质量不可配 | 低 | 后续增加参数 |
| RK-03 | FFmpeg 缺失导致功能不可用 | 中 | 明确引导 + 内置静态二进制（如可行） |

## 十五、附录

- 原型思路：视频截图工作区（VideoScreenshotWorkspace）选视频、设间隔、进度、结果网格（缩略图）、联系表导出。
- 用户故事：作为用户，我想按固定间隔把视频抽成静帧，以便快速浏览关键画面或导出联系表。
- 相邻能力：屏幕定时录制（`ScreenCapture`，`electron/screen-capture.cjs`）支持按间隔截屏、锁屏/睡眠自动暂停、每日导出 MP4；属另一条独立能力，未列入本「视频截图」主线。
- 参考：`electron/video.cjs`、`electron/screen-capture.cjs`。
- 合规声明：本方案为产品设计参考，具体实施请结合公司合规与法务要求确认。
