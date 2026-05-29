# 技能深度指南

每个 OPSX 技能的详细指南 — 理念、工作流程和示例。

| 技能 | 你的角色 | 功能说明 |
|------|---------|---------|
| [`/opsx:explore`](#opsxexplore) | **思考伙伴** | 从这里开始（当需求不明确时）。不创建任何工件，只是和你一起调查代码库、比较方案、理清思路。当想法成熟后，过渡到 `/opsx:propose`。 |
| [`/opsx:propose`](#opsxpropose) | **产品经理** | 一步到位的快速路径。创建变更并按依赖顺序生成所有规划工件（proposal → specs → design → tasks）。大多数变更从这里开始。 |
| [`/opsx:apply`](#opsxapply) | **实施工程师** | 读取 tasks.md，逐个完成任务，编写代码，勾选完成项。中断后可以从上次位置继续。 |
| [`/opsx:archive`](#opsxarchive) | **归档管理员** | 完成变更的最后一步。将增量规范合并到主规范，变更文件夹移至归档目录。保留完整审计记录。 |
| | | |
| **扩展工作流** | | |
| [`/opsx:new`](#opsxnew) | **脚手架工具** | 只创建变更目录结构，不生成任何工件。配合 `/opsx:continue` 或 `/opsx:ff` 使用。 |
| [`/opsx:continue`](#opsxcontinue) | **增量构建器** | 每次创建一个工件。查询依赖图，显示哪些可以创建，逐步推进。适合需要精细控制的复杂变更。 |
| [`/opsx:ff`](#opsxff) | **快进生成器** | 一次性生成所有规划工件。和 `/opsx:propose` 类似，但不创建变更目录（需要先 `/opsx:new`）。 |
| [`/opsx:verify`](#opsxverify) | **质量审计员** | 从完整性、正确性、一致性三个维度验证实现是否与工件匹配。归档前的最后检查。 |
| [`/opsx:sync`](#opsxsync) | **规范同步器** | 将变更中的增量规范合并到主规范，但不归档变更。长期运行的变更或并行工作时使用。 |
| [`/opsx:bulk-archive`](#opsxbulk-archive) | **批量归档器** | 一次归档多个已完成的变更。自动检测规范冲突并通过检查代码库来解决。 |
| [`/opsx:onboard`](#opsxonboard) | **入门导师** | 用你的真实代码库进行交互式教学。找到一个小改进机会，带你走完完整工作流。 |

---

## 理念：操作而非阶段

在深入每个技能之前，理解 OPSX 的核心设计决策至关重要。

传统的规范系统强制你走线性阶段：先规划，再实现，然后结束。一旦进入"实现阶段"，你就不能回去改设计。OPSX 彻底抛弃了这种模式。

```
传统工作流：
  规划 ────── 强制门禁 ──────► 实现 ────── 强制门禁 ──────► 完成
                                   │
                                   └── "发现设计有误？太晚了。"

OPSX：
  proposal ◄──► specs ◄──► design ◄──► tasks ◄──► 实现
                    │                              │
                    └── 任何时候都可以回头修改 ──────┘
```

**依赖是推动力，不是关卡。** 它们告诉你什么*可以*做，不是什么*必须*做。你可以跳过 design 直接写 tasks。你可以在实现过程中回去改 specs。工件之间的依赖关系只是建议——系统追踪状态，但不阻止你。

**这是有意为之的。** 因为实际工作永远不是线性的。你实现了某个功能，发现设计有误，需要更新规格，然后继续实现。OPSX 拥抱这个现实，而不是对抗它。

---

## `/opsx:explore`

这是你面对不确定性时应该去的地方。

在你知道要构建什么之前，在你有明确范围之前，在你准备好提交任何结构之前——先和一个了解你代码库的思考伙伴坐下来，搞清楚到底要做什么。

### 为什么存在这个技能

大多数失败的功能不是因为实现得差，而是因为从一开始就在解决错误的问题。`/opsx:explore` 存在的意义是让你在创建任何工件之前，先把问题想清楚。

它不创建任何文件。它不修改任何代码。它只是帮你思考——调查代码库、比较方案、识别风险、理清需求。

### 两种典型场景

**调查型** — 你遇到了一个问题但不确定根因：

```
你：   /opsx:explore
AI：   你想探索什么？

你：   用户报告页面加载很慢，但我不确定瓶颈在哪里。
AI：   让我调查一下你的前端架构...
       [分析打包大小、查询模式、组件渲染]

       发现三个主要瓶颈：
       1. ProductList 组件同步获取 200+ 条数据
       2. 未压缩的图片（平均 2.3MB/张）
       3. Context 变更导致整棵组件树重新渲染

       瓶颈 1 影响最大——首屏加载时间的 60% 花在这里。
       想从这个开始吗？

你：   对，我们先解决数据获取的问题。
AI：   好的。你可以运行 /opsx:propose optimize-product-fetching
       来开始正式的变更流程。
```

**决策型** — 你有多个方案但不确定选哪个：

```
你：   /opsx:explore 我想给 API 加速率限制，
       但不确定用什么方案。

AI：   让我看看你现在的架构...
       [分析 API 层、中间件、部署方式]

       你当前的栈是 Express + Redis + 单节点部署。
       三个可行方案：

       1. express-rate-limit 中间件
          - 优点：5 分钟搞定，零新依赖
          - 缺点：单进程内存，多实例不共享
          - 适合：当前规模（单节点）

       2. Redis 滑动窗口
          - 优点：多实例共享状态，精确控制
          - 缺点：Redis 已有，但需要新的 key 命名空间
          - 适合：计划扩展到多节点时

       3. API 网关层
          - 优点：与应用逻辑完全解耦
          - 缺点：需要额外基础设施
          - 适合：微服务架构

       你的 Redis 已经在跑了，方案 2 是稳健选择。
       但如果近期不扩展，方案 1 最快上线。

你：   先用方案 1，以后需要了再升级到方案 2。
AI：   明智的选择。运行 /opsx:propose add-api-rate-limiting
       来开始。
```

### 关键特点

- **零副作用** — 不创建文件，不修改代码，只读操作
- **代码库感知** — 可以搜索文件、阅读代码、分析架构
- **自然过渡** — 想法成熟后直接引导到 `/opsx:propose`
- **无限制** — 没有固定格式，就是一段对话

---

## `/opsx:propose`

这是大多数变更的起点——一步完成从创建到规划。

`/opsx:propose` 是默认快速路径。它创建变更目录，然后按依赖顺序生成所有规划工件，直到可以开始实施为止。

### 为什么这是默认选择

因为大多数变更不需要逐步控制每个工件的创建过程。你说清楚要做什么，AI 生成提案、规格、设计和任务清单，你审查一下，然后开始实施。整个规划过程在一次交互中完成。

### 工作流程

```
用户输入 ──► 创建变更目录 ──► 查询依赖图 ──► 按顺序创建工件
                │                                     │
                ▼                                     ▼
         openspec/changes/              proposal → specs → design → tasks
         <change-name>/                        │
                                               └─ 读取依赖工件作为上下文
```

每创建一个工件，AI 都会先读取它所依赖的已完成工件。这意味着：
- specs 基于 proposal 的范围来写
- design 参考 proposal 的方案来设计
- tasks 结合 specs 的需求和 design 的架构来分解

### 示例

```
你：   /opsx:propose add-dark-mode

AI：   已创建 openspec/changes/add-dark-mode/
       Schema: spec-driven

       正在创建工件...
       ✓ proposal.md — 为什么要做、范围和方案
       ✓ specs/ui/spec.md — 行为需求和场景
       ✓ design.md — 技术架构和决策
       ✓ tasks.md — 8 个实施任务

       所有规划工件已完成！
       运行 /opsx:apply 开始实施。
```

你也可以用自然语言描述：

```
你：   /opsx:propose 给移动端用户添加触控手势支持，
       包括滑动删除和下拉刷新

AI：   从描述推导变更名称：add-touch-gestures
       已创建 openspec/changes/add-touch-gestures/
       ...
```

### 创建的工件

| 工件 | 作用 | 包含内容 |
|------|------|---------|
| `proposal.md` | 为什么 + 什么 | 意图、范围（包含/排除）、高层方案 |
| `specs/**/*.md` | 行为契约 | 需求（SHALL/MUST）+ 验收场景（WHEN/THEN） |
| `design.md` | 怎么做 | 技术架构、关键决策及理由、数据流 |
| `tasks.md` | 执行清单 | 分组的实施任务，带复选框 |

### propose 与 new + ff 的区别

`/opsx:propose` = `/opsx:new` + `/opsx:ff` 的快捷方式。选择 propose 的场景：
- 你清楚要做什么
- 不需要在每个工件之间停下来审查
- 想要最快的端到端路径

选择 new + continue/ff 的场景：
- 复杂变更，想逐步控制每个工件
- 想在写 specs 之前先审查 proposal
- 使用自定义 schema

---

## `/opsx:apply`

这是你从规划走向代码的地方。

`/opsx:apply` 读取 `tasks.md`，找到未完成的任务，逐个实施——编写代码、创建文件、运行测试，然后在 tasks.md 中勾选完成。

### 核心设计

```
读取 tasks.md ──► 找到第一个 [ ] 任务 ──► 实施 ──► 标记 [x] ──► 下一个
                                             │
                                             └── 参考 design.md 和 specs/ 作为指导
```

这个设计有一个重要特性：**可中断恢复**。因为进度通过 tasks.md 中的复选框追踪，如果你中途中断——关闭窗口、切换到另一个变更、或者第二天再回来——`/opsx:apply` 会从上次停止的地方继续。

### 示例

```
你：   /opsx:apply

AI：   正在实施 add-dark-mode...

       读取 tasks.md：
       - [ ] 1.1 创建 ThemeContext
       - [ ] 1.2 添加 CSS 自定义属性
       - [ ] 1.3 实现 localStorage 持久化
       - [ ] 2.1 创建 ThemeToggle 组件
       - [ ] 2.2 在设置页面添加切换
       ...

       正在处理 1.1：创建 ThemeContext...
       [创建 src/contexts/ThemeContext.tsx]
       ✓ 1.1 完成

       正在处理 1.2：添加 CSS 自定义属性...
       [修改 src/styles/globals.css]
       ✓ 1.2 完成

       正在处理 1.3：实现 localStorage 持久化...
       [更新 ThemeContext，添加持久化逻辑]
       ✓ 1.3 完成

       第 1 组完成（主题基础设施）。
       继续第 2 组（UI 组件）...
```

### 并行变更

当你同时处理多个变更时，指定变更名称：

```
你：   /opsx:apply add-dark-mode

AI：   恢复 add-dark-mode...
       从任务 2.1 继续（上次停在 1.3）...
```

如果不指定名称，AI 会从对话上下文推断。如果无法判断，会提示你选择。

### 实现中的迭代

这是 OPSX 与传统工作流最大的不同之处。在实现过程中，你可能发现：

- 设计方案行不通 → **直接编辑 design.md，然后继续 apply**
- 需要新增一个需求 → **编辑 specs/，然后继续 apply**
- 任务分解有误 → **编辑 tasks.md，然后继续 apply**

不需要"重新进入规划阶段"。不需要从头来过。你的工件是活的文档，随时可以更新。

```
你：   等等，CSS 自定义属性的方案行不通，
       我们的 Tailwind 配置不支持运行时切换。

AI：   明白。让我更新 design.md...
       [将方案从 CSS 自定义属性改为 Tailwind 的 dark: 前缀]
       [更新相关任务]

       design.md 和 tasks.md 已更新。
       继续实施？

你：   继续。
```

---

## `/opsx:archive`

这是变更生命周期的最后一步。

`/opsx:archive` 做三件事：检查工件完成状态、将增量规范合并到主规范、然后将变更文件夹移至归档目录。

### 为什么归档很重要

归档不只是"把文件夹挪个地方"。它完成了 OpenSpec 的核心循环：

```
规范描述当前行为 ──► 变更提议修改 ──► 实现落地 ──► 归档合并增量 ──► 规范更新
       ▲                                                               │
       └───────────────────────────────────────────────────────────────┘
```

每次归档都让主规范（`openspec/specs/`）更加完整。随着时间推移，你的规范有机增长，成为系统行为的真正唯一事实来源。

### 示例

```
你：   /opsx:archive

AI：   正在归档 add-dark-mode...

       工件状态：
       ✓ proposal.md 存在
       ✓ specs/ 存在
       ✓ design.md 存在
       ✓ tasks.md 存在（8/8 任务完成）

       增量规范：尚未同步
       → 现在同步吗？（推荐）

你：   是

AI：   ✓ 已将规范同步到 openspec/specs/ui/spec.md
       ✓ 已移至 openspec/changes/archive/2025-01-24-add-dark-mode/

       变更归档完成。
```

### 归档不会阻止你

未完成的任务不会阻止归档——只会发出警告。有时候你故意只完成部分任务（剩余的留到下一个变更），这完全合理。

### 增量规范的合并

归档时的合并是智能的。它按操作类型处理：

| 操作 | 行为 |
|------|------|
| `ADDED` | 追加新需求到主规范 |
| `MODIFIED` | 找到同名需求并替换 |
| `REMOVED` | 找到同名需求并删除 |
| `RENAMED` | 找到同名需求并更新名称 |

合并后，主规范就包含了最新的行为定义。已归档的变更文件夹保留所有工件，作为审计记录。

---

## `/opsx:new`

> 扩展工作流命令。需要通过 `openspec config profile` 启用。

`/opsx:new` 是最小化的起点——只创建变更目录结构和元数据文件，不生成任何工件。

### 为什么需要它

当你想要完全控制工件创建过程时。`/opsx:propose` 是全自动的快速路径，而 `/opsx:new` 让你拿到方向盘。

```
/opsx:propose = /opsx:new + /opsx:ff（一步到位）

/opsx:new + /opsx:continue（手动挡）
    ├── 先审查 proposal
    ├── 再决定写不写 specs
    ├── design 可以跳过
    └── 每一步都由你控制
```

### 创建的内容

```
openspec/changes/<change-name>/
└── .openspec.yaml    # 元数据（schema、创建日期）
```

仅此而已。一个空目录和一个元数据文件。

### 示例

```
你：   /opsx:new add-webhook-system

AI：   已创建 openspec/changes/add-webhook-system/
       Schema: spec-driven

       就绪工件：proposal
       使用 /opsx:continue 创建它，或 /opsx:ff 一次性创建所有工件。
```

---

## `/opsx:continue`

> 扩展工作流命令。

这是精细控制模式——每次只创建一个工件。

### 工作方式

`/opsx:continue` 查询工件依赖图，显示哪些已完成、哪些就绪、哪些被阻塞，然后创建第一个就绪的工件。

```
你：   /opsx:continue

AI：   变更：add-webhook-system

       工件状态：
       ✓ proposal    （完成）
       ◆ specs       （就绪）
       ◆ design      （就绪）
       ○ tasks       （阻塞 — 需要：specs）

       正在创建 specs...
       [读取 proposal.md 作为上下文]
       [创建 specs/webhooks/spec.md]

       ✓ 已创建 openspec/changes/add-webhook-system/specs/webhooks/spec.md

       现在可用：tasks（需要 design 也完成）
       运行 /opsx:continue 创建下一个工件。
```

### 何时选择 continue 而非 ff

| 场景 | 选择 |
|------|------|
| 想在 specs 之前审查 proposal | `/opsx:continue` |
| 复杂变更，每个工件都需要仔细把关 | `/opsx:continue` |
| 想跳过某些工件（如 design） | `/opsx:continue` |
| 需求明确，快速推进 | `/opsx:ff` |

### 图状态可视化

每次运行 `/opsx:continue` 都会显示当前的依赖图状态：

```
✓ = 完成（文件存在）
◆ = 就绪（所有依赖已完成，可以创建）
○ = 阻塞（缺少依赖）
```

这让你始终清楚工件的整体进度。

---

## `/opsx:ff`

> 扩展工作流命令。

快进模式——一次性创建所有规划工件。

### 与 propose 的区别

`/opsx:ff` 只负责生成工件，不创建变更目录。需要先用 `/opsx:new` 创建目录。

```
/opsx:propose = 创建目录 + 生成工件
/opsx:ff      = 仅生成工件（目录已存在）
```

这个分离在一个场景下特别有用：你用 `/opsx:new` 创建了变更，用 `/opsx:continue` 创建了 proposal，审查后满意，然后用 `/opsx:ff` 一次性生成剩余工件。

### 示例

```
你：   /opsx:ff add-webhook-system

AI：   正在快进 add-webhook-system...

       ✓ 正在创建 proposal.md
       ✓ 正在创建 specs/webhooks/spec.md
       ✓ 正在创建 design.md
       ✓ 正在创建 tasks.md

       所有规划工件已完成！
       运行 /opsx:apply 开始实施。
```

如果某些工件已经存在（比如你之前用 continue 创建了 proposal），ff 会跳过它们，只生成缺失的工件。

---

## `/opsx:verify`

> 扩展工作流命令。

这是归档前的质量检查站。

### 三个维度

`/opsx:verify` 从三个维度验证实现是否与工件匹配：

**完整性** — 所有该做的都做了吗？
- 所有任务在 tasks.md 中都勾选了吗
- 所有需求在代码中都有对应实现吗
- 所有场景都有测试覆盖吗

**正确性** — 做的对不对？
- 实现是否符合规格的意图
- 边界情况是否已处理
- 错误状态是否符合规格定义

**一致性** — 设计和实现一致吗？
- 架构决策是否体现在代码结构中
- 命名约定是否与 design.md 一致
- 选择的技术方案是否与设计吻合

### 示例

```
你：   /opsx:verify

AI：   正在验证 add-dark-mode...

       完整性
       ✓ tasks.md 中所有 8 个任务已勾选
       ✓ 所有需求在代码中有对应实现
       ⚠ 场景 "系统偏好检测" 没有测试覆盖

       正确性
       ✓ 实现匹配规格意图
       ✓ 边界情况已处理
       ✓ 错误状态符合规格定义

       一致性
       ✓ 架构决策体现在代码结构中
       ✓ 命名约定与 design.md 一致
       ⚠ design.md 说 "CSS 变量" 但实现用了 Tailwind dark: 类

       总结
       ─────────────────────────────
       严重问题：0
       警告：2
       可以归档：是（带警告）

       建议：
       1. 为系统偏好检测添加测试
       2. 更新 design.md 以反映 Tailwind 方案，或重构为 CSS 变量
```

### 不会阻止你

验证结果是建议性的，不会阻止归档。有些偏差是刻意的——实现过程中你发现了更好的方案，design.md 还没来得及更新。`/opsx:verify` 把这些差异暴露出来，由你决定是否需要修正。

---

## `/opsx:sync`

> 扩展工作流命令。

将变更中的增量规范合并到主规范，但不归档变更。

### 何时需要手动 sync

大多数时候你不需要直接调用这个命令——`/opsx:archive` 归档时会自动提示同步。但在两种情况下手动 sync 很有用：

**长期运行的变更** — 变更持续数天或数周，你希望中途就让主规范保持最新：

```
你：   /opsx:sync

AI：   正在同步 add-webhook-system 的增量规范...

       读取：openspec/changes/add-webhook-system/specs/webhooks/spec.md
       目标：openspec/specs/webhooks/spec.md

       将要应用的变更：
       ✓ ADDED：Webhook 注册需求（3 个场景）
       ✓ ADDED：重试机制需求（2 个场景）

       合并中...
       ✓ openspec/specs/webhooks/spec.md 已更新

       变更仍保持活动状态。完成后运行 /opsx:archive。
```

**并行变更** — 多个变更需要基于最新的主规范工作：

变更 A 修改了 auth 规范，变更 B 也需要基于最新的 auth 规范。先 sync 变更 A，变更 B 就能看到更新后的主规范。

---

## `/opsx:bulk-archive`

> 扩展工作流命令。

一次归档多个已完成的变更。

### 冲突解决

当多个变更修改了同一个规范文件时，bulk-archive 会检测冲突并通过检查实际代码库来解决——因为如果代码已经实现了，实现就是事实来源。

```
你：   /opsx:bulk-archive

AI：   发现 3 个已完成的变更：
       - add-dark-mode（8/8 任务完成）
       - fix-login-bug（3/3 任务完成）
       - update-footer（2/2 任务完成）

       检查规范冲突...
       ⚠ add-dark-mode 和 update-footer 都修改了 specs/ui/

       检查代码库来解决...
       两个变更都已实现。将按创建时间顺序合并：
       1. add-dark-mode（创建于 1月20日）
       2. update-footer（创建于 1月22日）

       归档所有 3 个变更？

你：   是

AI：   ✓ 已归档 add-dark-mode
       ✓ 已归档 fix-login-bug
       ✓ 已归档 update-footer
       规范合并顺序：add-dark-mode → update-footer
```

---

## `/opsx:onboard`

> 扩展工作流命令。

用你的真实代码库进行交互式教学——不是读文档，而是做一个真正的变更。

### 工作方式

`/opsx:onboard` 扫描你的代码库，找到 3 个安全的小改进机会，让你选一个，然后带你走完完整流程：创建变更 → 编写工件 → 实施 → 验证 → 归档。

每一步都有解释——不只是执行命令，而是告诉你*为什么*这样做。

### 示例

```
你：   /opsx:onboard

AI：   欢迎使用 OpenSpec！

       我会用你的实际代码库带你走完完整工作流。
       我们会找到一个小改进点，创建正式的变更，
       实施它，然后归档。

       让我扫描你的代码库...
       [分析代码库]

       发现几个可以改进的地方：
       1. 联系表单缺少输入验证
       2. 认证流程的错误消息不够清晰
       3. 异步按钮缺少加载状态

       哪个最感兴趣？（或者提出别的建议）

你：   我们做第 3 个。

AI：   好选择！我们来创建一个正式变更...

       [第 1 步：创建变更]
       这会创建一个独立的文件夹来组织所有工作。
       每个变更都是自包含的——提案、设计、规格、任务，
       全部在一个地方。

       运行 openspec new change "add-loading-states"...
       ✓ 已创建 openspec/changes/add-loading-states/

       [第 2 步：创建提案]
       提案回答两个问题："为什么做？" 和 "做什么？"
       它不涉及技术细节——那些留给 design.md...
```

完成整个流程大约需要 15-30 分钟。你会得到一个真正的、可以保留或丢弃的变更。

---

## 工作流组合

### 默认快速路径（core profile）

```
/opsx:propose ──► /opsx:apply ──► /opsx:archive
```

三步搞定。适合大多数中小型变更。

### 探索 + 快速路径

```
/opsx:explore ──► /opsx:propose ──► /opsx:apply ──► /opsx:archive
```

先调查，再规划，然后实施。适合需求不明确的场景。

### 精细控制（扩展工作流）

```
/opsx:new ──► /opsx:continue ──► ... ──► /opsx:apply ──► /opsx:verify ──► /opsx:archive
```

逐步创建每个工件，每步都审查。适合复杂变更。

### 并行工作

```
变更 A：/opsx:propose ──► /opsx:apply（进行中）
                              │
                         上下文切换
                              │
变更 B：/opsx:propose ──► /opsx:apply ──► /opsx:archive
                              │
                         切回变更 A
                              │
变更 A：/opsx:apply（继续）──► /opsx:archive
```

用变更名称区分。`/opsx:apply` 从上次停止的地方继续。

---

## 自定义 Schema

OPSX 的工件序列由 schema 定义。默认是 `spec-driven`：

```
proposal → specs → design → tasks → implement
```

但你可以创建自己的 schema：

```bash
# 从头创建
openspec schema init research-first

# 或者 fork 现有的
openspec schema fork spec-driven research-first
```

**自定义示例：**

```yaml
# openspec/schemas/research-first/schema.yaml
name: research-first
artifacts:
  - id: research
    generates: research.md
    requires: []           # 先做调研

  - id: proposal
    generates: proposal.md
    requires: [research]   # 基于调研写提案

  - id: tasks
    generates: tasks.md
    requires: [proposal]   # 跳过 specs 和 design
```

这个 schema 的依赖图：

```
research ──► proposal ──► tasks
```

适合快速 bug 修复或小改进——不需要完整的规格和设计文档。

---

## 项目配置

通过 `openspec/config.yaml` 注入项目上下文和规则，让 AI 生成的工件更贴合你的项目。

```yaml
# openspec/config.yaml
schema: spec-driven

context: |
  技术栈：TypeScript, React, Node.js
  API 约定：RESTful, JSON 响应
  测试：Vitest 做单元测试, Playwright 做 E2E
  编码规范：ESLint + Prettier, 严格 TypeScript

rules:
  proposal:
    - 必须包含回滚计划
    - 标注受影响的团队
  specs:
    - 场景必须使用 Given/When/Then 格式
  design:
    - 复杂流程必须包含时序图
```

**context** 注入到所有工件指令中，帮助 AI 理解你的项目约定。

**rules** 按工件类型注入约束，确保每个工件满足你的质量标准。

---

## 何时更新 vs. 重新开始

一个常见问题：什么时候可以更新现有变更的工件，什么时候应该归档后新建？

```
                        ┌────────────────────────────┐
                        │   这还是同一个工作吗？       │
                        └─────────────┬──────────────┘
                                      │
                   ┌─────────────────┼─────────────────┐
                   │                 │                  │
                   ▼                 ▼                  ▼
            意图相同？          >50% 重叠？        原始变更能独立
            同一个问题？        范围一致？        标记为"完成"吗？
                   │                 │                  │
          ┌───────┴───────┐  ┌──────┴──────┐   ┌───────┴───────┐
          │               │  │             │   │               │
         是              否  是            否   否             是
          │               │  │             │   │               │
          ▼               ▼  ▼             ▼   ▼               ▼
        更新            新建  更新         新建  更新           新建
```

**更新**——意图相同，方法改进：
- 发现了新的边界情况
- 方案需要微调但目标不变
- 实现中发现设计有误

**新建**——本质上是不同的工作：
- 问题本身变了
- 范围膨胀到面目全非
- 原始变更可以独立完成

---

## 与 AI 工具的集成

OpenSpec 通过适配器模式支持 25+ 个 AI 编码工具。不同工具使用略有不同的命令语法：

| 工具 | 命令语法 | 技能目录 |
|------|---------|---------|
| Claude Code | `/opsx:propose`, `/opsx:apply` | `.claude/skills/` |
| Cursor | `/opsx-propose`, `/opsx-apply` | `.cursor/` |
| Windsurf | `/opsx-propose`, `/opsx-apply` | `.windsurf/` |
| GitHub Copilot | `/opsx-propose`, `/opsx-apply` | `.github/prompts/` |
| Gemini CLI | `/opsx-propose`, `/opsx-apply` | `.gemini/` |
| 更多... | [查看完整列表](supported-tools.md) | |

命令的语法不同，但底层意图相同。所有工具都通过 `openspec` CLI 查询同一个依赖图和状态。

---

## 提示和最佳实践

- **变更名称要有描述性**：`add-dark-mode`、`fix-login-redirect`、`optimize-product-query`，避免 `update`、`changes`、`wip`
- **每个变更聚焦一个工作单元**："添加功能 X 同时重构 Y" 应该拆成两个变更
- **需求不明确时先 explore**：探索不创建任何工件，零风险
- **实现中发现问题就更新工件**：工件是活的文档，不是一次性写好就不能改的
- **归档前先 verify**：哪怕不修复所有警告，至少知道差异在哪里
- **用项目配置注入上下文**：让 AI 生成的工件更贴合你的技术栈和约定
- **检查状态**：随时运行 `openspec status --change "name"` 查看进度
