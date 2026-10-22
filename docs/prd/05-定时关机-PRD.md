# HALO 定时关机 PRD（完整版）

> 版本 v1.0 · 作者 司南（产品）· 日期 2026-10-21 · 状态 草稿（基于 `electron/main.cjs` 源码核实）

## 一、文档信息

| 项 | 内容 |
|----|------|
| 文档版本 | v1.0 |
| 作者 | 司南（产品） |
| 日期 | 2026-10-21 |
| 变更记录 | v1.0 初版 |
| 评审记录 | 待评审 |

## 二、背景与目标

**背景**：用户希望 HALO 在指定时间自动关机（或定时开机），常用于「跑完批处理任务后自动关机」「定时开机准备任务」。实现依赖各平台系统命令，并以 `shutdown-schedule.json` 持久化，开机自启时回读。

**要解决的问题**：
1. 跨平台能力差异（Windows 仅关机、macOS 关机+开机、Linux 依赖 shutdown/rtcwake 与权限）。
2. 到点前用户应能取消；已排程不能重复排（一次一个）。
3. 计划时间窗口合理（≥1 分钟，≤10 年），且睡眠/合盖/权限不足时要明确报错而非静默失败。

**成功指标与口径**：
- 计划成功率 = 成功创建系统计划的比例（目标：能力可用平台上 ≥99%）。
- 取消成功率 = 成功撤销系统计划的比例（目标 ≥99%）。
- 能力探测准确率 = `shutdownCapabilities` 对平台能力判定与实际情况一致的比例（目标 100%）。

## 三、名词与术语定义

| 术语 | 定义 |
|------|------|
| 电源计划 `shutdownPlan` | 单例，含 `scheduledAt` 与 `action`（shutdown/power-on） |
| 关机 `shutdown` | 到点自动断电 |
| 定时开机 `power-on` | 借 RTC 闹钟（macOS pmset / Linux rtcwake）到点唤醒 |
| 能力探测 `shutdownCapabilities` | 按平台返回 canShutdown/canPowerOn |
| 计划持久化 `shutdown-schedule.json` | 落 userData，启动回读 |

## 四、需求范围

**包含**：查询平台能力、安排关机/开机、取消计划、持久化与启动回读、参数与权限校验。
**不包含**：休眠/睡眠（仅作为关机前的系统状态，不单独调度）、多计划排队、关机前弹窗提醒（当前无）。

## 五、方案对比与选型说明

| 方案 | 对比 | 结论 |
|------|------|------|
| 关机实现 | 调系统命令（shutdown.exe/pmset/shutdown）vs 自研 | **调系统命令**（已落地） |
| 开机实现 | pmset schedule（macOS）/ rtcwake（Linux）vs BIOS 设置 | **系统 RTC**（已落地；Windows 不支持通用开机） |
| 单例约束 | 允许多计划 vs 一次一个 | **一次一个**（已落地，避免冲突） |
| 持久化 | 不持久 vs 写 schedule.json 启动回读 | **持久化回读**（已落地） |

推荐：维持现状。后续演进：关机前 X 分钟提醒/取消窗口、多计划（如工作日）。

## 六、用户角色与使用场景

| 角色 | 目标 | 场景 | 频率 |
|------|------|------|------|
| 普通用户 | 到点关机/开机 | 长任务跑完自动关机；定时开机准备 | 低中 |

## 七、功能需求

**FR-01 能力探测**
- 描述：`shutdownCapabilities` 按平台返回能力——Windows(canShutdown)/macOS(canShutdown+canPowerOn)/Linux(探测 shutdown 与 rtcwake+/dev/rtc0)。
- 验收：Given macOS，When 探测，Then canShutdown=true 且 canPowerOn=true；Given Linux 无 rtcwake，When 探测，Then canPowerOn=false。

**FR-02 安排关机/开机**
- 描述：`scheduleShutdown(scheduledAt, action)` 校验动作合法、平台支持、时间为 1 分钟–10 年之内、无未到期计划；按平台调系统命令并写 `shutdown-schedule.json`。
- 规则：Windows 不支持 power-on；Linux shutdown 对齐到整分钟；macOS 用 `pmset schedule` 需管理员权限（osascript）。
- 验收：Given macOS 排 10 分钟后关机，When 执行，Then 系统计划创建且 plan 持久化；Given 已有一个未到期计划，When 再排，Then 拒绝「请先取消」。

**FR-03 取消计划**
- 描述：`cancelShutdown` 按平台撤销系统计划（Windows `shutdown /a`、macOS `pmset schedule cancel`、Linux `shutdown -c`/rtcwake disable）并清 plan 与文件。
- 规则：Linux rtcwake 仅当闹钟时间匹配（±5s）才清除，避免误清他人闹钟。
- 验收：Given 已排关机，When 取消，Then 系统计划撤销且 plan 置空；Given Linux 闹钟被他人占用，When 取消，Then 拒绝并提示。

**FR-04 持久化与启动回读**
- 描述：`readShutdownSchedule` 启动回读，过期或平台不符则删文件返回 null；main 启动调用以恢复 plan。
- 验收：Given 上次排的未来计划，When 重启，Then plan 被恢复；Given 计划已过期，When 回读，Then 删文件返回 null。

**FR-05 参数与权限校验**
- 描述：动作非法、时间非法（<1 分钟或 >10 年）、平台不支持均报错；macOS pmset 需管理员权限，无权限由 osascript 弹窗。
- 验收：Given 时间 30 秒后，When 排，Then 拒绝「至少 1 分钟之后」。

## 八、非功能需求

| 类别 | 要求 |
|------|------|
| 兼容 | macOS/Windows/Linux；Linux 能力动态探测 |
| 安全 | macOS 用 osascript 提权，用户授权；Linux 用 pkexec |
| 可靠 | 计划持久化，启动恢复；损坏文件不阻断启动 |

## 九、业务流程与状态流转

**计划状态**：无 → 已安排（shutdown/power-on）→ 取消/已执行（系统侧）。
主流程：查能力 → 校验 → 调系统命令 → 写 schedule.json（plan 内存）；取消 → 调系统撤销 → 清文件/plan；启动 → 回读恢复。

## 十、数据与埋点需求

- 核心文件：`shutdown-schedule.json`（`scheduledAt`/`action`/`platform`）。
- 内存：`shutdownPlan`。
- 埋点建议：计划创建/取消次数、能力探测结果（当前仅 logger）。

## 十一、权限与安全要求

- macOS：pmset 经 `osascript with administrator privileges` 提权，用户确认。
- Linux：shutdown/rtcwake 经 `pkexec` 提权。
- Windows：shutdown.exe 无需额外权限。
- 无网络。

## 十二、异常处理清单

| 场景 | 处理 |
|------|------|
| 平台不支持关机/开机 | 明确报错 |
| 时间 <1 分钟或 >10 年 | 拒绝 |
| 已有一个未到期计划 | 拒绝，需先取消 |
| macOS 无管理员权限 | osascript 提权弹窗 |
| Linux rtcwake 被他人占用 | 报错提示检查现有唤醒计划 |
| schedule.json 损坏 | 删文件、不阻断启动 |

## 十三、上线计划与上线后验证

- 依赖：各平台系统命令（shutdown.exe / pmset / shutdown / rtcwake / pkexec）。
- 验证：需真实系统联调（沙箱无系统命令）；能力探测逻辑可单测。

## 十四、风险与遗留问题

| 编号 | 风险 | 等级 | 应对 |
|------|------|------|------|
| RK-01 | 系统睡眠/合盖导致到点未执行（关机前设备睡了） | 高 | 评估唤醒或「到点前阻止睡眠」；当前无此处理 |
| RK-02 | macOS 关机需管理员授权，未授权则失败 | 中 | 明确提示，保留手动入口 |
| RK-03 | 关机前无提醒/取消窗口，误关风险 | 中 | 后续加倒计时提醒与取消 |
| RK-04 | Windows 不支持定时开机 | 低 | 已明确报错，非缺陷 |

## 十五、附录

- 原型思路：定时关机工作区展示平台能力、安排（时间选择器 + 关机/开机切换）、当前计划、取消按钮、不支持态 EmptyState。
- 用户故事：作为用户，我想让电脑在我离开后自动关机，以便省电且不影响长任务，并能在反悔时取消。
- 参考：`electron/main.cjs`（scheduleShutdown/cancelShutdown/shutdownCapabilities/readShutdownSchedule）。
- 合规声明：本方案为产品设计参考，具体实施请结合公司合规与法务要求确认。
