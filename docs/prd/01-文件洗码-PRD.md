# HALO 文件洗码 PRD（完整版）

> 版本 v1.0 · 作者 司南（产品）· 日期 2026-10-21 · 状态 草稿（基于 `electron/engine.cjs` 源码核实）
> 本 PRD 为需求归档 + 加固基线说明；若要做新功能/改版，请基于本文件提变更。

## 一、文档信息

| 项 | 内容 |
|----|------|
| 文档版本 | v1.0 |
| 作者 | 司南（产品） |
| 日期 | 2026-10-21 |
| 变更记录 | v1.0 初版，依据 engine.cjs 现状核实 |
| 评审记录 | 待评审 |

## 二、背景与目标

**背景**：用户需要对一批本地文件做「洗码/脱敏」——在文件尾部追加一段可识别的 HALO 标记，用于标记「已处理」，且必须能安全、可验证地恢复（截断标记）。该能力是 HALO 的护城河（可验证的不可逆批量改写），也是崩溃/断电后不丢数据要求最高的模块。

**要解决的问题**：
1. 大批量文件标记必须可中断、可恢复，跑完崩溃不能判为「永久 interrupted」。
2. 标记/恢复过程不能破坏原文件，部分写入要能自动回滚。
3. 跨平台（尤其 Windows NTFS 大 inode）身份识别不能失效。

**成功指标与口径**：
- 任务恢复成功率 = 崩溃/断电后能从 journal 续跑或正确判定 complete 的会话数 ÷ 异常退出会话总数（目标 ≥99%，统计周期：版本内）。
- 标记校验一致率 = 恢复时抽样/全量哈希与记录匹配的文件数 ÷ 恢复文件总数（目标 100%）。
- 误改率 = 因身份/内容变化被拒绝写入的文件数（目标越高越好，即拒绝而非错改）。

## 三、名词与术语定义

| 术语 | 定义 |
|------|------|
| 洗码模式 `mode` | `legacy`（5 字节随机）或 `recoverable`（32 字节：MAGIC 8 + 时间戳 8 + 随机 16） |
| 校验方式 `verificationMode` | `fast`（仅 mtime）/ `sampled`（10 处抽样哈希）/ `full`（整文件 SHA-256） |
| 标记 `marker` | 追加到文件尾部的字节；`MAGIC = 58 49 4D 41 01 00 00 00` |
| 指纹 `fingerprint` | 扫描结果按路径/大小/身份/采样哈希算出的 SHA-256，用于检测范围变化 |
| 写前日志 `journal` | 每条文件的 `prepared`/`completed` 事件与 `end` 收尾事件，落 `journals/*.jsonl` |

## 四、需求范围

**包含**：
- 文件夹扫描（递归/扩展名/隐藏/小文件过滤）、范围指纹校验
- 批量尾部追加标记（recoverable/legacy）、已洗跳过
- 三种校验方式、可选原文件备份（temp+rename 原子）
- 查重（整文件 SHA-256 分组）
- 恢复（截断标记 + 校验）、中断续跑、部分写入自动回滚

**不包含**：文件内容加密、云同步、跨设备去重、文件名改写（当前仅尾部追加）。

## 五、方案对比与选型说明

| 方案 | 思路 | 对比 | 结论 |
|------|------|------|------|
| 标记位置 | 尾部追加 vs 原地覆写 | 尾部追加可逆、破坏面小、易校验；原地覆写不可逆且危险 | **选尾部追加** |
| 校验强度 | fast / sampled / full | fast 最快但不可信；full 最安全但 TB 级慢；sampled 折中 | **三档并存，默认 sampled** |
| 备份落盘 | temp+rename 原子 vs 直接写 | 直接写断电留半文件致下次 EEXIST 永久洗不了 | **选 temp+rename 原子**（已落地） |
| 中断判定 | 补 `end` 事件 vs 仅 prepared/completed | 无 end 时跑完崩溃被误判 interrupted | **补 `end` 事件**（已落地） |

推荐：维持当前「尾部追加 + 写前日志 + 原子备份 + 三档校验」组合。后续演进：引入任务队列化（并发/限速）以降低超大批量耗时。

## 六、用户角色与使用场景

| 角色 | 目标 | 场景 | 频率 |
|------|------|------|------|
| 普通用户 | 批量标记已处理文件并可恢复 | 整理归档前对整批文件打标；误标后恢复 | 中低频、批量 |

## 七、功能需求

**FR-01 扫描与过滤**
- 描述：指定文件夹，按 `extensions`/`recursive`/`skipHidden`/`skipSmall`+`minSizeBytes` 过滤，产出候选文件列表与范围指纹。
- 规则：根路径须为普通文件夹、拒绝符号链接；扫描期间对每个文件做大小/身份/采样签名三道校验，变化即拒绝。
- 验收（GWT）：Given 选含子目录与普通文件的文件夹，When 开启递归，Then 仅返回普通文件且不含符号链接；Given 文件在扫描后变化，When 进入洗码，Then 该文件被拒绝并计入 `unreadable`/告警。

**FR-02 尾部追加标记**
- 描述：对每个候选文件在尾部追加 `marker`，写前先记 `prepared`，写后校验尾部内容一致，记 `completed`。
- 规则：仅修改普通文件、拒绝符号链接；身份用 bigint ino（防 Windows NTFS 溢出）；已含 MAGIC 尾部则 `skipped`。
- 验收：Given 一个未洗文件，When 执行 recoverable 洗码，Then 文件大小 +32 且尾部 8 字节等于 MAGIC；Given 已洗文件二次洗码，When 开启 `skipAlreadyWashed`，Then 状态为 skipped。

**FR-03 三档校验**
- 描述：按 `verificationMode` 在写入前后采集 `fast`/`sampled`/`full` 校验数据，供恢复时复核。
- 验收：Given `full` 模式，When 写入前，Then 记录 `beforeSha256`/`afterSha256`；Given `sampled` 模式，Then 记录 10 处 offset/length/sha256。

**FR-04 原文件备份**
- 描述：`backupDirectory` 在根目录之外时，为每个文件原子备份（`temp+rename`），记录 `backupPath`。
- 规则：备份目录不得位于正在处理的文件夹内；备份期间源文件变化则报错。
- 验收：Given 指定外部备份目录，When 洗码完成，Then 每文件在备份目录存在同内容副本。

**FR-05 查重**
- 描述：`findDuplicates` 对扫描结果逐文件整文件 SHA-256，按 `size:sha256` 分组，返回重复组。
- 验收：Given 两个内容相同文件，When 查重，Then 归入同一组且 `files.length>1`。

**FR-06 恢复（截断标记）**
- 描述：`restore` 对 `success`/`pending` 文件截断尾部标记，按原校验方式复核后 `truncate(beforeSize)`。
- 规则：恢复前记 `prepared`（破坏性与洗码同级）；`full` 须匹配 `beforeSha256`；`sampled` 须逐个样本复核；`fast` 仅比 mtime 且拒绝移动后文件。
- 验收：Given 已洗文件且 `full` 记录，When 恢复且原内容未变，Then 文件大小回退到 `beforeSize` 且状态 success；Given 内容被外部改动，When 恢复，Then 拒绝并保留错误。

**FR-07 中断续跑与收尾**
- 描述：循环结束后写 `end` 事件，`load()` 据此标 `complete`；崩溃遗留 journal 由历史模块重建。
- 验收：Given 任务正常完成，When 读历史，Then `interrupted=false`；Given 写前崩溃，When 重启，Then 该文件按 prepared/completed 重建且不完整者标 interrupted。

**FR-08 部分写入自动回滚**
- 描述：`washOne` 写入中抛错时，若尾部仅多出自家 marker 且身份未变，自动 `truncate` 回 `beforeSize`。
- 验收：Given 写入中途失败且尾部为自家 marker，When 捕获异常，Then 文件大小回退且 `pending=false`；Given 文件被他进程改动，When 回滚前检查，Then 拒绝回滚并保留 journal。

## 八、非功能需求

| 类别 | 要求 |
|------|------|
| 性能 | 整文件 SHA-256 为单线程串行（`full` 模式 TB 级为扩展性上限，非 bug）；扫描单次 lstat（bigint）合并身份/元数据 |
| 资源 | 文件列表全量常驻内存；建议受控并发 + 耗时估算（后续） |
| 安全 | 仅改普通文件、拒绝符号链接；bigint ino 防溢出；写入前多道身份/内容校验 |
| 兼容 | Windows/macOS/Linux；NTFS 大 inode 已处理 |

## 九、业务流程与状态流转

**文件状态机**：`pending` → `success` / `skipped` / `failed`
**会话状态机**：`running` → `completed` / `cancelled` / `interrupted`（无 end 或日志末行截断）

主流程：scan → 指纹校验 → 建备份目录 → 起 journal → 逐文件 washOne（prepared→写入→completed）→ 写 end → saveSession。

## 十、数据与埋点需求

- 核心实体：session（含 files[]、restoreRuns[]）、fileRecord（before/after size、sha256、appendedHex、verificationMode、samples）。
- 埋点建议：`wash_start`/`wash_file_done{status}`/`restore_start`/`restore_file_done{status}`（当前无埋点，仅日志）。
- 指标口径：恢复成功率、标记校验一致率（见第二节）。

## 十一、权限与安全要求

- 文件系统：仅 `O_RDWR` 普通文件，`O_NOFOLLOW` 拒符号链接。
- 防误改：身份（bigint ino）、大小、mtime、采样签名四重比对；写入后再校验尾部。
- 备份目录隔离：不得位于处理根目录内。
- 无网络/无云，纯本地。

## 十二、异常处理清单

| 场景 | 处理 |
|------|------|
| 扫描后文件变化 | 拒绝修改，计入 unreadable/告警 |
| 写入中途失败 | 尾部为自家 marker 则自动 truncate 回滚；他进程改动则拒绝回滚 |
| 备份目录在处理根内 | 启动即抛错 |
| 已洗文件二次洗 | skipped（开启 skipAlreadyWashed） |
| 用户中止 | signal.aborted 抛「任务已停止」，session.cancelled |

## 十三、上线计划、依赖与上线后验证

- 依赖：无外部依赖（纯 Node fs/crypto）。
- 上线后验证：用损坏 journal、双损坏、断电模拟验证 load/recover 逻辑（已通过隔离脚本验证）；`npm test` 现状 48 通过 / 3 失败（沙箱 copyFile 限制，非回归）。

## 十四、风险与遗留问题

| 编号 | 风险 | 等级 | 应对 |
|------|------|------|------|
| RK-01 | `full` 模式 TB 级数据单线程慢 | 中 | 受控并发 + 耗时估算（后续） |
| RK-02 | 文件名冲突未定义策略 | 中 | 待定义（当前仅尾部追加，不涉及改名） |
| RK-03 | 超大批量内存常驻 | 低 | 流式/分批（后续） |

## 十五、附录

- 原型思路：洗码工作区（WashWorkspace）提供根目录选择、扩展名/过滤、模式与校验档选择、备份目录、开始/停止、结果列表（成功/跳过/失败）。
- 用户故事：作为普通用户，我想批量给文件打「已处理」标记，以便我后续能识别并可在误标时恢复，从而安心归档。
- 参考：`electron/engine.cjs`（wash/restore/findDuplicates/scan）。
- 合规声明：本方案为产品设计参考，具体实施请结合公司合规与法务要求确认。
