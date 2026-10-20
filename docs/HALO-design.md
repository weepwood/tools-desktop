# HALO 设计与工程优化说明

> 本文档记录本轮对 `tools-desktop`（原 XIMA Desktop 的 Electron 移植版）的**工程分析**、**结构优化**、**UI / 动效设计**与**品牌重命名**。
> 品牌：**XIMA → HALO**；版本：0.2.0 → 1.0.0。

---

## 1. 现状分析

### 1.1 规模与结构（改造前）

```
src/            约 4.6k 行   React 19 + 纯 CSS（无 UI 库、无 Tailwind）
electron/       约 1.1k 行   主进程：文件引擎 / 历史 / 视频 / 切分 / IPC 校验
tests/          约 0.4k 行   node:test（引擎、切分、视频历史、IPC 参数边界）
```

架构本身是健康的：渲染进程关闭 Node 集成、contextIsolation + sandbox、IPC 走显式命令白名单并校验入参、自定义 `xima://` 协议只读放行图片。**问题集中在渲染层的组织方式**，不在安全模型。

### 1.2 具体问题与证据

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | **巨型组件**：状态、副作用、JSX 全在一个文件 | `XimaWorkspace.tsx` 593 行，其中 30+ 个 `useState`/`useRef`，同时包含洗码、恢复、历史、导出四条流程 | 改一个按钮要在「会删改用户文件」的函数旁边动手；无法单测 |
| 2 | **公共组件寄生在功能样式表** | `.halo-button / .halo-card / .halo-field / .halo-notice / .halo-progress / .halo-pagination / .halo-search-field / .halo-table-*` 全部定义在 `XimaWorkspace.css`，却被 VideoScreenshot / VideoSplit / History 三个功能隐式依赖 | 谁引用谁不明确；改洗码页按钮会连带改视频页 |
| 3 | **CSS 重复与覆盖** | `.xima-wash-layout` 定义 2 次、`.xima-results-column` 定义 2 次（后者整段覆盖前者）、`.xima-metric` padding 重复声明 | 阅读成本高，后写的规则默默赢 |
| 4 | **主题色变量被复制到功能文件** | `--xima-action-color / -focus / -success-text / -danger-text / -warning-text` 在 `XimaWorkspace.css` 的深色与浅色块里各写一遍 | 新增主题必须改两处，且容易漏 |
| 5 | **无错误边界** | `main.tsx` 直接 `render(<App/>)` | 任一屏渲染异常 = 整窗白屏，而这是个会动用户文件的应用，白屏会让人以为数据出问题 |
| 6 | **减少动效开关有失效选择器** | `VideoScreenshotWorkspace.css` 用 `[data-reduce-motion="true"]`，而实际值是 `on / off / system` | 该规则永不命中（已删除，统一由 `global.css` 处理） |
| 7 | **未使用设计令牌** | 字号/圆角/时长大量硬编码（`font-size: 15px`、`border-radius: 3px`、`0.16s ease-out`、`z-index: 40/200`） | 视觉不统一，改一处要全局搜 |

---

## 2. 工程优化（已实施）

### 2.1 分层：令牌 → 主题 → 原语 → 功能

```
src/styles/tokens.css      主题无关的原子令牌（字号、间距、圆角、动效曲线、阴影、z-index）
src/styles/themes.css      每个主题一套调色板 + 语义别名（--halo-*）
src/styles/motion.css      关键帧与动效工具类（只在需要时被消费）
src/components/ui.css      原语层（button / card / field / notice / badge / progress / table …）
src/features/*.css         功能层：只放布局与本屏独有构件
```

**纪律（写进文件头注释）**：功能样式表可以扩展原语（`.halo-card.something`），**不得重新定义同名规则**。原语样式表由 `main.tsx` 在功能样式之前加载，保证顺序稳定。

### 2.2 拆分巨型组件

| 文件 | 行数 | 职责 |
|---|---|---|
| `features/HaloWorkspace.tsx` | 96 | 组合根：决定显示哪块 + 页头 + 提示栈 |
| `features/wash/useWashController.ts` | 520 | 全部状态与副作用：扫描、洗码、恢复、历史、导出、通知 |
| `features/wash/WashOptionsPanel.tsx` | 250 | 左栏设置（纯展示，全部动作回调 `ctrl`） |
| `features/wash/WashResultCards.tsx` | 250 | 右栏三张卡 + 筛选/搜索/分页（视图态留在这里） |
| `features/wash/presets.ts` | 30 | 常量表（扩展名预设、结果筛选项、页大小） |
| `lib/format.ts` | 60 | 纯函数：字节、短哈希、百分比、错误归一化、校验级别文案 |

收益：破坏性文件操作的编排被隔离在一个可审阅的文件里；视图文件不再可能误触发副作用；格式化逻辑可被单测。

### 2.3 新增兜底与一致性

- `components/ErrorBoundary.tsx`：渲染异常时保留窗口，给出可读说明 + 「重新载入界面」，并把堆栈写进 console。
- `App.tsx`：用 `KeptView` 统一「保持挂载 + hidden」的视图槽位（原来 3 处内联 `style={{height:'100%'}}`）。
- `ui.tsx`：`Button / Card / Badge / SwitchRow / Field / ProgressBar / Pagination / EmptyState / SectionLabel` 一份实现，焦点环、禁用态、aria 接线只写一次。

---

## 3. 设计系统：HALO

### 3.1 概念

**HALO = 光环。** 一个只在本机运行的精密工具：安静、克制、有边界感。所以视觉上：

- **一个彩色元素**：品牌环（渐变弧），其余全部是无彩灰阶 + 状态色；
- **卡片是容器，不是装饰**：1px 描边 + 1px 投影就够，靠留白分组；
- **动效只用位移与透明度**，不缩放布局、不做视差，桌面工具对掉帧零容忍。

### 3.2 色彩

主色从原来的 `#339CFF` 换成靛青 `#4658E8`（深色 `#6D7CFF`）：

1. 原亮蓝在大面积白底上"太像系统默认"，缺乏品牌记忆；
2. 靛青在 14px 正文上对比更高（白底 5.6:1，达 AA）；
3. 与状态色（绿 `#1C8A4F` / 红 `#CD3B3B` / 橙 `#B9691A`）在色相环上距离更远，减少"主色 vs 成功色"的误读。

| 语义 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--color-bg-base` | `#ECEEF4` | `#0A0C11` | 窗口 / 侧栏底 |
| `--color-bg-surface` | `#FFFFFF` | `#101319` | 主内容 |
| `--color-bg-inset` | `#F4F6FA` | `#1A1F28` | 输入框、表头、开关轨道 |
| `--color-bg-canvas` | `#F7F8FC` | `#0D1016` | 卡片画布（卡片浮在其上） |
| `--color-accent` | `#4658E8` | `#6D7CFF` | 主操作、选中 |
| `--color-accent-weak` | `rgba(70,88,232,.085)` | `rgba(109,124,255,.14)` | 选中底、图标底 |
| `--color-text` / `-secondary` / `-tertiary` | `#151821` / `#5B6273` / `#7B8496` | `#EEF0F6` / `#9AA2B5` / `#7D8799` | 三级文字 |
| `--color-success` / `-warning` / `-danger` | `#1C8A4F` / `#B9691A` / `#CD3B3B` | `#4CB87A` / `#E2913F` / `#E5645C` | 状态 |

三级文字特意从 `#949AAB` 加深到 `#7B8496`：11px 的辅助说明在原值下对比只有 2.9:1，读不清。

语义别名（`--halo-action-color / -focus-color / -success-text / -danger-text / -warning-text`）现在**只在 `themes.css` 定义一次**，功能表直接消费——原来那种"每个功能文件自己 color-mix 一遍"的写法全部删除。

### 3.3 排版

| 令牌 | 值 | 用途 |
|---|---|---|
| `--text-xs` | 11px | 辅助说明、徽章 |
| `--text-sm` | 12px | 按钮、表格 |
| `--text-base` | 13px | 侧栏 |
| `--text-md` | 14px | 正文 |
| `--text-xl` | 18px | 页标题 |
| `--text-display` | 24px | 指标数字（等宽数字） |

数字统一 `font-variant-numeric: tabular-nums`，进度/大小/耗时纵向对齐不跳动。标题用 `-0.02em` 字距收紧，正文 `1.5` 行高。

### 3.4 层级与节奏

- 阴影三级：`--elev-1` 卡片静置 → `--elev-3` 浮层/Toast → `--elev-4` 侧栏 peek / 大图预览。
- z-index 语义化：`--z-sticky 4 / --z-panel 10 / --z-titlebar 30 / --z-overlay 40 / --z-toast 50`（替代散落的 40、200）。
- 圆角：控件 8 / 卡片 14 / 浮层 10；按钮与输入框同高 32px（紧凑 28px）。

### 3.5 关键界面

**标题栏**：高度 44px（原 52px），条内所有按钮统一 26px。品牌环 + `HALO` 字标（`letter-spacing: .14em`），环是界面里唯一出现品牌渐变的地方；悬停时轻微旋转 18°，是"光环"这个概念的落点。窗口控制沿用 Windows 习惯，关闭键悬停变红。

> 顶栏该放哪些功能、窄窗如何折叠，见独立文档 [`HALO-titlebar.md`](HALO-titlebar.md)。

> **整条顶栏只用一种颜色**（`--color-bg-base`，与左侧栏同色）。改造前顶栏是透明的，左半段压在侧栏上呈灰、右半段压在内容上呈白，窗口控制像是浮在白底上的一块孤岛。现在顶栏是一条完整的 chrome 带，两侧栏与内容都从它下方开始。

**窗口控制与工作区共用一套**：`shell/WindowControls.tsx` 由应用外壳统一提供。设置页作为应用外壳内的工作区子页面显示，与文件洗码、历史和视频工具共用标题栏、窗口控制及页面背景；设置分类在设置页内切换，切换工作区时原工作区仍保持挂载，以保留当前状态。

**洗码页**：右侧从"满幅 1px 分隔线"改成**卡片画布**——画布 `bg-canvas` + 三张独立卡片（扫描概览 / 任务状态 / 处理结果）。

> 为什么改：分隔线只能表达"上下相邻"，无法表达"同组"；窗口被侧栏挤压时，卡片会自然换行/重排，分隔线则会变成一条孤立长横线。卡片还给了 hover、focus-within 一个落点。

**左栏**：文件夹选择器从"普通按钮"升级为"目标区域"（图标色块 + 主副标题 + 动作词），因为"选目录"是这条流程唯一的起点，值得更重的位置。

**侧栏**：选中项用 `accent-weak` 底 + 主色文字 + 加粗，图标在 hover 时 `scale(1.06)`；分组标题改为 11px 大写字距——信息层级不靠色块堆叠。

**历史 / 视频**：沿用同一套原语，因此按钮、字段、空状态、进度条的外观自动与新洗码页一致。

**设置页**：作为应用外壳中的工作区子页面显示，通过工作区侧栏中的设置入口访问。页面保留常规、外观、快捷键和高级分类导航，并沿用工作区的 `.sidebar-item`、控件尺寸、圆角及背景令牌。设置与各工具页共享应用标题栏和页面背景，离开设置后可继续使用其他工作区。

### 3.6 应用图标

图标已替换为**指南针**：整圆表盘 + 珊瑚色外圈 + 蓝/橙指针，深棕描边（`#45190E`）。它表达的是「定位、方向」，与「本机文件工作台」的定位一致。

产物与用途：

| 文件 | 规格 | 用途 |
|---|---|---|
| `assets/icon.svg` | 1024×1024，8 条路径 | **设计源文件**，改图只改这里 |
| `assets/icon.png` | 512×512 RGBA | 开发态窗口图标、Linux / 文档 |
| `assets/icon.ico` | 16/24/32/48/64/128/256 七档 | 安装包、exe、快捷方式 |
| `assets/tray.png` | 32×32 | Windows 托盘（200% 缩放仍清晰） |

> **一处需要决定的冲突**：图标的珊瑚橙 / 深棕配色与界面主色靛青 `#4658E8` 不是同一套色系。两者可以并存（很多工具的应用图标并不复用 UI 主色），但如果你希望品牌收得更紧，可以基于同一 SVG 出一版靛青-青色变体（把 `#F78A64 / #FA926A` 换成 `--halo-grad-b/c`，`#64A8E4` 换成主色），源文件已在仓库里，改色只需替换 4 个 `fill`。

---

## 4. 动效规范

四个原则：**解释状态变化、只动位移与透明度、退出比进入快、循环动效必须低对比**。

| 场景 | 时长 / 曲线 | 实现 |
|---|---|---|
| 视图进入 | 320ms `cubic-bezier(.16,1,.3,1)` | `.halo-workspace` / `.video-workspace` 淡入；`hidden` 切换后重放 |
| 卡片 / 列表错峰 | 320ms + 22ms×index（封顶 8 档） | `.halo-stagger > *` |
| 面板展开/收起 | 220ms `cubic-bezier(.2,0,0,1)` | grid track 动效（原有实现保留） |
| 侧栏 peek | 220ms 进入 / 150ms 退出 | 位移 16% + 淡入 |
| 按钮按压 | 90ms | `translateY(1px) scale(.99)` |
| 悬停换色 / 边框 | 150ms | 颜色类属性 |
| 开关滑块 | 220ms `cubic-bezier(.34,1.4,.64,1)` | 轻微回弹，仅此一处用弹性曲线 |
| 进度推进 | 220ms | 宽度渐变 |
| 运行中微光 | 1.6s 循环 | 高光横扫已填充部分（`data-running`） |
| 未知进度 | 1.5s 往返 | `data-indeterminate` |
| 任务状态点 | 1.4s 呼吸 + 1.4s ping | 进行中才有 |
| Toast 提示 | 220ms 滑入 | 从右侧 14px + 轻微缩放 |
| Tooltip | 90ms 淡入 | 感觉"本来就在" |
| 大图预览 | 220ms 升起 | `dialog[open]` |

**降级**：`html[data-reduce-motion="on"]` 与 `prefers-reduced-motion` 两条路径都把 `animation/transition` 压到 0.01ms，设置页的开关优先于系统设置。所有循环动效都有对应的 `animation: none` 兜底。

---

## 5. 品牌重命名：XIMA → HALO

### 5.1 映射表

| 层 | 旧 | 新 |
|---|---|---|
| 界面文案 / `index.html` `<title>` | XIMA | HALO |
| CSS 类前缀 | `.xima-*` | `.halo-*` |
| CSS 局部变量 | `--xima-*` | `--halo-*`（并上收到 `themes.css`） |
| React 组件 / 类型 / 文件 | `XimaWorkspace` / `XimaSection` | `HaloWorkspace` / `HaloSection` |
| 全局桥对象 | `window.xima` | `window.halo` |
| IPC 通道 | `xima:invoke` / `xima:event` / `xima:drag` | `halo:invoke` / `halo:event` / `halo:drag` |
| 自定义协议 | `xima://image/…` + CSP `xima:` | `halo://image/…` + CSP `halo:` |
| 环境变量 | `XIMA_DEV_URL` / `XIMA_VIDEO_TOOLS` | `HALO_DEV_URL` / `HALO_VIDEO_TOOLS` |
| localStorage 键 | `xima:root` 等 | `halo:root` 等 |
| appId / productName | `com.weepwood.xima.electron` / `XIMA Tools` | `com.weepwood.halo.electron` / `HALO` |
| 安装产物 | `XIMA-Tools-Setup-*` / `-Portable-*` | `HALO-Setup-*` / `HALO-Portable-*` |
| 包名 / 版本 | `tools-desktop` 0.2.0 | `halo-desktop` 1.0.0 |
| CI artifact | `XIMA-Tools-Windows` | `HALO-Windows` |

### 5.2 刻意保留的三处

1. **磁盘标记字节 `MAGIC = [88,73,77,65]`（ASCII "XIMA"）不动。**
   它是洗码文件尾部的 32 字节格式常量。改名会让**所有已洗码文件无法识别与恢复**。代码里保留原值并加注释说明原因，26 项引擎测试全部通过，恢复流程不受影响。
2. **上游仓库链接 `weepwood/xima-desktop` 保留。** 这是来源声明，不是品牌。
3. **`assets/icon.png` / `icon.ico` 未重新绘制**（属于视觉资产，需要专门出图，见第 7 节）。

### 5.3 升级影响（需要告知用户）

- 应用数据目录从 `%APPDATA%\tools-desktop` 变为 `%APPDATA%\halo-desktop`：旧设置与历史**不会自动迁移**。
- localStorage 键前缀变更：主题、面板尺寸、上次选择的目录会回到默认值一次。
- 任何外部依赖 `xima://` 协议的链接需要同步为 `halo://`。

---

## 6. 验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过（0 error） |
| `vite build` | 通过，`dist/` 产 CSS 73.4 kB / JS 327 kB（gzip 12.4 / 99.5） |
| `node --test tests/*.test.cjs` | **26 / 26 通过**（含标记字节、切分、视频历史、IPC 参数边界） |
| 实机启动（Electron 44 / Windows） | 窗口标题 `HALO`，浅色与深色主题均逐屏核对（见交付截图） |
| 重命名残留扫描 | 全仓仅剩 2 处 `xima`，均为上游仓库链接 |

### 6.1 顺带修复：文件身份比较的精度 bug

验证过程中 `npm test` 出现**间歇性失败**（同一份代码 3 次里 1～2 次挂 5 项），定位后是引擎里的一个真实缺陷：

- `statId()` 用 `dev:ino` 标识文件；`washOne` / `restoreOne` 里**路径侧用的是普通 `fs.lstat()`（ino 为 Number），句柄侧用的是 `{bigint:true}`**。
- Windows 的 NTFS 文件索引经常超过 `Number.MAX_SAFE_INTEGER`（2^53），转成 Number 会被四舍五入，于是两侧字符串永不相等 → 命中 "扫描后文件身份变化，拒绝修改"。
- 是否失败取决于该文件的随机 inode 是否恰好可被 Number 精确表示——所以表现为"偶发"，实测 12 次里 9 次失败。

修复：两处路径侧的 `lstat` 都改用 `{bigint:true}`，与句柄侧同精度比较。修复后同样的 12 次循环 **0 失败**，测试连跑 4 轮均 26/26。

> 这个 bug 的影响面比测试大得多：在真实 Windows 机器上，它对大多数文件都会直接拒绝洗码/恢复——属于核心功能不可用级别，只是碰巧被"偶发"掩盖了。


> 本机 GPU 进程在受限环境中会崩溃，验证时使用 `--no-sandbox --disable-gpu` 启动；这是环境限制，与应用代码无关。

---

## 7. 未做与建议

1. **应用图标**：已替换为指南针（见 3.6），源文件为 `assets/icon.svg`；若要统一品牌色，按 3.6 的说明替换 4 个 `fill` 即可。
2. **设置页**：结构与控件已继承新令牌，但没有重新设计排版与分组，仍是最初的脚手架布局。
3. **视频切分页右栏**：已随 `.video-*` 原语自动统一，但「分片文件」列表仍可进一步卡片化。
4. **表格虚拟滚动**：目前每页 50 行，超过数千条历史时应考虑窗口化渲染。
5. **视觉回归**：建议引入 Playwright + 截图比对，把浅/深两套主题的关键屏固化为基线。
6. **图标按钮的 `aria-label`**：`title` 已有，但屏幕阅读器更依赖 `aria-label`，可批量补齐。
