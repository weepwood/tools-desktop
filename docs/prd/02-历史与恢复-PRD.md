# HALO 历史与恢复 PRD（完整版）

> 版本 v1.0 · 作者 司南（产品）· 日期 2026-10-21 · 状态 草稿（基于 `electron/history.cjs` + `electron/main.cjs` 源码核实）

## 一、文档信息

| 项 | 内容 |
|----|------|
| 文档版本 | v1.0 |
| 作者 | 司南（产品） |
| 日期 | 2026-10-21 |
| 变更记录 | v1.0 初版 |
| 评审记录 | 待评审 |

## 二、背景与目标

**背景**：HALO 的所有破坏性任务（洗码、恢复、视频切分、截图）都依赖历史模块记录会话，供用户查看、重放、恢复。历史文件一旦损坏，旧实现会同时锁死读与写，使应用无法使用历史功能。

**要解决的问题**：
1. `history.json` 损坏时不得锁死应用（读/写都要可降级）。
2. 崩溃遗留的恢复日志（restores）要在启动时重建为可追踪的 restoreRun。
3. 重复读取历史不应每次重解析所有 journal（性能）。

**成功指标与口径**：
- 历史可用性 = 损坏/双损坏场景下仍能读写的会话比例（目标 100%，已通过隔离脚本验证）。
- 恢复日志重建率 = 启动遗留 restores 日志被重建为 interrupted restoreRun 的比例（目标 100%）。
- 历史读性能 = 签名未变时命中缓存、不重解析（已实现）。

## 三、名词与术语定义

| 术语 | 定义 |
|------|------|
| session | 一次任务会话（洗码/切分/截图），含 files[] 与 restoreRuns[] |
| journal | `journals/<id>.jsonl` 写前日志，记录 start/prepared/completed/end |
| restore log | `restores/<runId>.jsonl` 恢复任务日志，复用 runId |
| 签名缓存 | 基于 history.json + 各 journal 的 name/mtime/size 计算的签名，未变则复用内存解析结果 |
| 损坏兜底 | base() 损坏先读 `.bak`，再不行 rename 为 `history.corrupt-<ts>.json` 并返回 `[]` |

## 四、需求范围

**包含**：会话持久化、journal 写前日志、`.bak` 双写、损坏兜底、签名缓存、启动恢复日志重建、CSV 导出、清空历史。
**不包含**：历史条目过期自动清理策略（当前无）、跨设备同步。

## 五、方案对比与选型说明

| 方案 | 对比 | 结论 |
|------|------|------|
| 损坏处理 | 抛错锁死 vs 回退 .bak vs rename 损坏文件返回 [] | **三级兜底**（已落地） |
| 读性能 | 每次重解析 vs 签名缓存 | **签名缓存**（已落地，且保证 #15 损坏 journal 仍被检出） |
| 恢复日志 | 启动忽略 vs 重建为 interrupted restoreRun | **recoverRestoreRuns 重建**（已落地） |

推荐：维持「.bak 双写 + 签名缓存 + 启动重建」组合。后续演进：定义历史保留/清理策略。

## 六、用户角色与使用场景

| 角色 | 目标 | 场景 | 频率 |
|------|------|------|------|
| 普通用户 | 查看/恢复历史任务 | 误标后从历史找会话恢复；查看过去任务结果 | 中 |

## 七、功能需求

**FR-01 会话持久化**
- 描述：`saveSession` 先 `copyFile` 到 `.bak`，再原子写 `history.json`，随后删除对应 journal。
- 验收：Given 会话完成，When saveSession，Then history.json 更新且 `.bak` 为上一版；Given saveSession 后，Then 对应 journal 被删除。

**FR-02 损坏兜底（base）**
- 描述：`base()` 解析失败先读 `.bak`（非空才用），否则 rename 损坏文件为 `history.corrupt-<ts>.json` 返回 `[]`，绝不抛错。
- 验收：Given history.json 损坏且有 bak，When load，Then 从 bak 恢复；Given 双损坏，When load，Then 返回 `[]` 且不抛错；Given 损坏无 bak，When load，Then 原文件被 rename 为 corrupt 且返回 `[]`。

**FR-03 签名缓存（load）**
- 描述：`load()` 用目录签名（history.json + 各 journal 的 name/mtime/size）判断是否复用内存解析结果；签名变化才重建。
- 验收：Given 磁盘未变，When 多次 load，Then 不重解析 journal；Given 手动丢入损坏 journal，When load，Then 该 journal 仍被检出（#15 用例）。

**FR-04 启动恢复日志重建（recoverRestoreRuns）**
- 描述：启动时遍历 `restores/*.jsonl`，把遗留恢复日志重建为 `interrupted` 的 restoreRun（prepared 但无 completed 的文件标「可能已截断，请重新核验」），写回历史后删除日志。
- 验收：Given 遗留 restores 日志，When 启动 recoverRestoreRuns，Then 对应 session 新增 interrupted restoreRun；Given 日志格式异常，When 重建，Then 原文件保留并告警。

**FR-05 CSV 导出**
- 描述：`exportCsv` 导出会话文件明细（含 sha256、appendedHex 等），UTF-8 BOM。
- 验收：Given 会话，When 导出，Then 生成含表头的 CSV。

**FR-06 清空历史**
- 描述：`clear` 删除 history.json 与所有 journal。
- 验收：Given clear，When 执行，Then 历史为空。

## 八、非功能需求

| 类别 | 要求 |
|------|------|
| 可靠 | 写采用 temp+rename 原子；`.bak` 先于主文件写 |
| 性能 | 签名缓存避免重复解析；list/summaries 复用 |
| 容错 | 损坏 journal 末行截断容忍（仅末行、且仅当文件不以 \n 结尾） |

## 九、业务流程与状态流转

**session 状态**：由 journal 推导——有 `end` 且无截断 → complete；否则 interrupted。
**restoreRun 状态**：成功写回后删除日志；遗留日志 → interrupted（启动重建）。
主流程：任务结束 → saveSession（bak+原子写+删 journal）；启动 → load → recoverRestoreRuns 重建遗留 restores。

## 十、数据与埋点需求

- 核心文件：`history.json`（会话数组）、`journals/*.jsonl`、`restores/*.jsonl`、损坏文件 `history.corrupt-*.json`。
- 埋点建议：历史读写耗时、损坏兜底触发次数（当前仅 logger，无埋点）。

## 十一、权限与安全要求

- 本地文件，无网络。
- 损坏文件保留（rename 而非删除）以便排查。
- `.bak` 与主文件同目录，权限继承。

## 十二、异常处理清单

| 场景 | 处理 |
|------|------|
| history.json 损坏 | 回退 .bak → 否则 rename 损坏文件返回 [] |
| journal 末行截断（断电） | 容忍，保留前序条目，标 interrupted |
| journal 中间行损坏 | 抛错并保留原文件、记告警 |
| restores 日志格式异常 | 保留原文件、记告警、跳过 |

## 十三、上线计划与上线后验证

- 依赖：无外部。
- 验证：隔离脚本验证 base() 三种损坏分支、recoverRestoreRuns 重建；`npm test` 现状 48 通过 / 3 失败（沙箱环境限制，非回归）。

## 十四、风险与遗留问题

| 编号 | 风险 | 等级 | 应对 |
|------|------|------|------|
| RK-01 | 历史无限增长，无清理策略 | 中 | 定义保留/清理策略（后续） |
| RK-02 | 多恢复日志并发写 | 低 | 当前单通道 halo:invoke 串行，风险低 |
| RK-03 | 大历史文件读性能 | 低 | 签名缓存已缓解 |

## 十五、附录

- 原型思路：历史页（HistoryView）分页（任务 10/页、文件 30/页），展示会话、恢复运行、文件明细与状态。
- 用户故事：作为用户，我想在误标后从历史找到那次会话并恢复，以便把文件还原到洗码前。
- 参考：`electron/history.cjs`、`electron/main.cjs`（recoverRestoreRuns 启动调用）。
- 合规声明：本方案为产品设计参考，具体实施请结合公司合规与法务要求确认。
