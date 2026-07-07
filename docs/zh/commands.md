# 命令

这是 OpenSpec 斜杠命令的参考文档。这些命令在你的 AI 编码助手的聊天界面中调用（例如 Claude Code、Cursor、Windsurf）。

关于工作流模式以及何时使用每个命令，请参阅 [工作流](workflows.md)。关于 CLI 命令，请参阅 [CLI](cli.md)。

## 快速参考

### 默认快速路径（`core` profile）

| 命令 | 用途 |
|---------|---------|
| `/opsx:propose` | 一步创建变更并生成规划产物 |
| `/opsx:explore` | 在提交变更之前深入思考想法 |
| `/opsx:apply` | 实施变更中的任务 |
| `/opsx:sync` | 将增量规格合并到主规格中 |
| `/opsx:archive` | 归档已完成的变更 |

### 扩展工作流命令（自定义工作流选择）

| 命令 | 用途 |
|---------|---------|
| `/opsx:new` | 开始新的变更脚手架 |
| `/opsx:continue` | 根据依赖关系创建下一个产物 |
| `/opsx:ff` | 快进：一次性创建所有规划产物 |
| `/opsx:verify` | 验证实现是否与产物匹配 |
| `/opsx:bulk-archive` | 一次性归档多个变更 |
| `/opsx:onboard` | 完整工作流的引导式教程 |
| `/opsx:review-cycle` | 迭代式审查循环 —— 审查、分诊、修复、复审增量，循环直至干净或上报 |

默认全局 profile 为 `full` —— 所有工作流命令开箱即用。要精简为核心命令，运行 `openspec config profile core`（或用 `openspec config profile` 选择自定义子集），然后在你的项目中运行 `openspec update`。

---

## 命令参考

### `/opsx:propose`

一步创建新变更并生成规划产物。这是 `core` profile 中的默认启动命令。

**语法：**
```text
/opsx:propose [change-name-or-description]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name-or-description` | 否 | kebab-case 名称或自然语言的变更描述 |

**功能说明：**
- 创建 `openspec/changes/<change-name>/`
- 生成实现之前所需的产物（对于 `spec-driven`：proposal、specs、design、tasks）
- 当变更准备好执行 `/opsx:apply` 时停止

**示例：**
```text
You: /opsx:propose add-dark-mode

AI:  Created openspec/changes/add-dark-mode/
     ✓ proposal.md
     ✓ specs/ui/spec.md
     ✓ design.md
     ✓ tasks.md
     Ready for implementation. Run /opsx:apply.
```

**提示：**
- 使用此命令可获得最快的端到端路径
- 如果你想逐步控制产物，启用扩展工作流并使用 `/opsx:new` + `/opsx:continue`

---

### `/opsx:explore`

> **不确定时从这里开始。** Explore 是一个零成本的思考伙伴：它阅读你的代码库、比较各种方案，并在任何变更发生之前把一个模糊的想法打磨成具体的计划。它在默认 profile 中提供。完整论述和更多示例请参阅 [先探索](explore.md) 指南。

在提交变更之前，深入思考想法、调查问题并明确需求。

**语法：**
```
/opsx:explore [topic]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `topic` | 否 | 你想要探索或调查的内容 |

**功能说明：**
- 开启一个无需结构化的探索性对话
- 调查代码库以回答问题
- 比较选项和方法
- 创建可视化图表以理清思路
- 当想法成形时可以过渡到 `/opsx:propose`（默认）或 `/opsx:new`（扩展工作流）

**示例：**
```text
You: /opsx:explore

AI:  What would you like to explore?

You: How should we handle authentication for the mobile app?

AI:  Let me investigate your current auth setup...
     [Analyzes codebase]

     I see you're using session-based auth for the web app.
     For mobile, we have three main options:

     1. JWT tokens (stateless, works offline)
     2. OAuth2 (if you need third-party login)
     3. Extend current sessions (simpler, but requires connectivity)

     Your API already has CORS configured. Which direction interests you?

You: Let's go with JWT. Can we start a change for that?

AI:  Ready when you are. Run /opsx:propose add-jwt-auth to begin.
```

**提示：**
- 当需求不明确或需要调查时使用
- 探索过程中不会创建任何产物
- 适合在决策前比较多种方案
- 可以读取文件和搜索代码库

---

### `/opsx:new`

开始新的变更脚手架。创建变更文件夹，等待你使用 `/opsx:continue` 或 `/opsx:ff` 生成产物。

此命令属于扩展工作流集（不包含在默认的 `core` profile 中）。

**语法：**
```
/opsx:new [change-name] [--schema <schema-name>]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 变更文件夹的名称（未提供时会提示输入） |
| `--schema` | 否 | 要使用的工作流 schema（默认：来自配置或 `spec-driven`） |

**功能说明：**
- 创建 `openspec/changes/<change-name>/` 目录
- 在变更文件夹中创建 `.openspec.yaml` 元数据文件
- 显示第一个准备创建的产物模板
- 如果未提供变更名称和 schema，会进行提示

**创建的内容：**
```
openspec/changes/<change-name>/
└── .openspec.yaml    # Change metadata (schema, created date)
```

**示例：**
```
You: /opsx:new add-dark-mode

AI:  Created openspec/changes/add-dark-mode/
     Schema: spec-driven

     Ready to create: proposal
     Use /opsx:continue to create it, or /opsx:ff to create all artifacts.
```

**提示：**
- 使用描述性名称：`add-feature`、`fix-bug`、`refactor-module`
- 避免使用通用名称如 `update`、`changes`、`wip`
- Schema 也可以在项目配置中设置（`openspec/config.yaml`）

---

### `/opsx:continue`

在依赖链中创建下一个产物。每次创建一个产物以实现增量进展。

**语法：**
```
/opsx:continue [change-name]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 要继续的变更（未提供时从上下文推断） |

**功能说明：**
- 查询产物依赖图
- 显示哪些产物已就绪、哪些被阻塞
- 创建第一个就绪的产物
- 读取依赖文件以获取上下文
- 显示创建后新可用的后续产物

**示例：**
```
You: /opsx:continue

AI:  Change: add-dark-mode

     Artifact status:
     ✓ proposal    (done)
     ◆ specs       (ready)
     ◆ design      (ready)
     ○ tasks       (blocked - needs: specs)

     Creating specs...

     [Reads proposal.md, creates specs based on requirements]

     ✓ Created openspec/changes/add-dark-mode/specs/ui/spec.md

     Now available: tasks
     Run /opsx:continue to create the next artifact.
```

**提示：**
- 当你想在继续之前审查每个产物时使用
- 适合需要精细控制的复杂变更
- 多个产物可能同时就绪
- 你可以在继续之前编辑已创建的产物

---

### `/opsx:ff`

快进式创建产物。一次性创建所有规划产物。

**语法：**
```
/opsx:ff [change-name]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 要快进的变更（未提供时从上下文推断） |

**功能说明：**
- 按依赖顺序创建所有产物
- 通过待办列表跟踪进度
- 当所有 `apply-required` 产物完成时停止
- 在创建下一个产物之前读取每个依赖

**示例：**
```
You: /opsx:ff add-dark-mode

AI:  Fast-forwarding add-dark-mode...

     ✓ Creating proposal.md
     ✓ Creating specs/ui/spec.md
     ✓ Creating design.md
     ✓ Creating tasks.md

     All planning artifacts complete!
     Ready for implementation. Run /opsx:apply to begin.
```

**提示：**
- 当你对要构建的内容有清晰想法时使用
- 对于简单直接的变更，比 `/opsx:continue` 更快
- 之后仍然可以编辑产物
- 适合中小型功能

---

### `/opsx:apply`

实施变更中的任务。按任务列表逐项工作，编写代码并勾选完成项。

**语法：**
```
/opsx:apply [change-name]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 要实施的变更（未提供时从上下文推断） |

**功能说明：**
- 读取 `tasks.md` 并识别未完成的任务
- 逐个完成任务
- 根据需要编写代码、创建文件、运行测试
- 使用复选框 `[x]` 标记任务完成

**示例：**
```
You: /opsx:apply

AI:  Implementing add-dark-mode...

     Reading tasks.md:
     - [ ] 1.1 Create ThemeContext
     - [ ] 1.2 Add CSS custom properties
     - [ ] 1.3 Implement localStorage persistence

     Working on 1.1: Create ThemeContext...
     [Creates src/context/ThemeContext.tsx]

     ✓ 1.1 Complete

     Working on 1.2: Add CSS custom properties...
     [Updates src/styles/globals.css]

     ✓ 1.2 Complete
     ...
```

**提示：**
- 如果中断可以从上次停止的地方继续
- 通过指定变更名称来处理并行变更
- 完成状态通过 `tasks.md` 中的复选框跟踪

---

### `/opsx:verify`

验证实现是否与变更产物匹配。检查完整性、正确性和一致性。

**语法：**
```
/opsx:verify [change-name]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 要验证的变更（未提供时从上下文推断） |

**功能说明：**
- 从三个维度检查实现质量
- 搜索代码库以寻找实现证据
- 将问题分为 CRITICAL、WARNING 或 SUGGESTION 进行报告
- 不会阻止归档，但会显示问题

**验证维度：**

| 维度 | 验证内容 |
|-----------|-------------------|
| **完整性（Completeness）** | 所有任务已完成、所有需求已实现、场景已覆盖 |
| **正确性（Correctness）** | 实现符合规格意图、边界情况已处理 |
| **一致性（Coherence）** | 设计决策体现在代码中、模式保持一致 |

**示例：**
```
You: /opsx:verify

AI:  Verifying add-dark-mode...

     COMPLETENESS
     ✓ All 8 tasks in tasks.md are checked
     ✓ All requirements in specs have corresponding code
     ⚠ Scenario "System preference detection" has no test coverage

     CORRECTNESS
     ✓ Implementation matches spec intent
     ✓ Edge cases from scenarios are handled
     ✓ Error states match spec definitions

     COHERENCE
     ✓ Design decisions reflected in code structure
     ✓ Naming conventions consistent with design.md
     ⚠ Design mentions "CSS variables" but implementation uses Tailwind classes

     SUMMARY
     ─────────────────────────────
     Critical issues: 0
     Warnings: 2
     Ready to archive: Yes (with warnings)

     Recommendations:
     1. Add test for system preference detection
     2. Update design.md to reflect Tailwind usage, or refactor to use CSS variables
```

**提示：**
- 在归档之前运行以尽早发现不匹配
- 警告不会阻止归档，但表示潜在问题
- 适合在提交之前审查 AI 的工作
- 可以揭示产物和实现之间的偏差

---

### `/opsx:review-cycle`

通过迭代循环把变更推进到「真正干净」：`review → triage → fix → re-review(Δ) → {pass | loop | escalate}`。它不重新实现审查器 —— 每一轮都委托给始终安装的 `openspec-review` 引擎。本命令只负责循环、按修复规模分诊、作者≠验证者不变式、终止与上报。属于可选项（不在 `core` profile 中）。

**语法：**
```
/opsx:review-cycle [change-name]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 要运行循环的变更（未提供时从上下文推断） |

**功能说明：**
- 通过 `openspec-review` 跑一轮审查，然后按修复规模对每条发现分诊
- 路由修复：琐碎（trivial）→ 编排者就地修复；非琐碎（non-trivial）→ 编写该代码的实现 agent；设计级（design-level）→ 单独的修复 agent
- 仅复审修复增量；只有当**非作者**对照原始发现确认后，该发现才标记为已解决（作者≠验证者）
- 循环上限为最大轮次（默认 3）；达到上限且仍有未解决的 Blocker/Major 发现时上报给人类 —— 绝不静默通过
- 在 `review-cycle-report.md` 中记录轮次历史与每条非作者确认

**作者≠验证者不变式：**
只有当确认者不是修复的作者时，发现才算解决。对于编排者就地完成的琐碎修复，等价的非作者检查是一次独立的门禁运行（测试/lint/构建）加上对该改动的 diff 阅读 —— 并且必须记入循环报告。

**复审路径：**
- **Claude Code 加速（可选）：** 启用 agent-teams（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）时，lead 可通过 `SendMessage` 唤回原审查器只复审增量（仅 lead 可发起 `SendMessage`）。
- **工具无关回退（强制）：** 否则进行一次全新的增量审查，将先前发现与修复 diff 通过共享文件传入。结果等价，只是成本更高。

**示例：**
```
You: /opsx:review-cycle add-dark-mode

AI:  Review Cycle: add-dark-mode (round 1/3)
     Findings: 1 Blocker, 2 Major
       - [Blocker] missing null guard → trivial → orchestrator inline
       - [Major]   race in toggle      → non-trivial → implementing agent
       - [Major]   contract changed     → design-level → separate fix agent
     Fixes applied → re-reviewing delta (fresh non-author review)...
     Round 2/3: 0 Blocker, 0 Major → CLEAN
     Report: review-cycle-report.md
```

**提示：**
- 在实现**之后**针对实时 diff 使用；若只需单次验证门禁，请改用 `/opsx:verify`
- 循环是有界的 —— 若上报，开放发现与轮次历史会交给人类，而非静默通过

---

### `/opsx:sync`

**可选命令。** 将变更中的增量规格合并到主规格中。归档时会在需要时提示同步，因此通常不需要手动运行此命令。

**语法：**
```
/opsx:sync [change-name]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 要同步的变更（未提供时从上下文推断） |

**功能说明：**
- 从变更文件夹读取增量规格
- 解析 ADDED/MODIFIED/REMOVED/RENAMED 部分
- 将变更合并到主 `openspec/specs/` 目录
- 保留增量中未提及的现有内容
- 不归档变更（保持活动状态）

**示例：**
```text
You: /opsx:sync

AI:  Syncing add-dark-mode delta specs...

     Reading: openspec/changes/add-dark-mode/specs/ui/spec.md
     Target:  openspec/specs/ui/spec.md

     Changes to apply:
     ✓ ADDED: Theme Selection requirement (2 scenarios)
     ✓ ADDED: Accessibility requirement (1 scenario)

     Merging...
     ✓ openspec/specs/ui/spec.md updated

     Change remains active. Run /opsx:archive when ready to complete.
```

**何时手动使用：**

| 场景 | 是否使用 sync？ |
|----------|-----------|
| 长期运行的变更，想在归档前把规格放入主目录 | 是 |
| 多个并行变更需要更新后的基础规格 | 是 |
| 想单独预览/审查合并结果 | 是 |
| 快速变更，直接归档 | 否（归档会处理） |

**提示：**
- sync 是智能合并，而非简单复制粘贴
- 可以向现有需求添加场景而不产生重复
- sync 后变更仍保持活动状态（不会被归档）
- 大多数用户永远不需要直接调用此命令——归档时会在需要时提示

---

### `/opsx:archive`

归档已完成的变更。最终确认变更并将其移至归档文件夹。

**语法：**
```
/opsx:archive [change-name]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-name` | 否 | 要归档的变更（未提供时从上下文推断） |

**功能说明：**
- 检查产物完成状态
- 检查任务完成情况（未完成时发出警告）
- 如果增量规格尚未同步，提供同步选项
- 将变更文件夹移至 `openspec/changes/archive/YYYY-MM-DD-<name>/`
- 保留所有产物以供审计追溯

**示例：**
```text
You: /opsx:archive

AI:  Archiving add-dark-mode...

     Artifact status:
     ✓ proposal.md exists
     ✓ specs/ exists
     ✓ design.md exists
     ✓ tasks.md exists (8/8 tasks complete)

     Delta specs: Not yet synced
     → Sync now? (recommended)

You: Yes

AI:  ✓ Synced specs to openspec/specs/ui/spec.md
     ✓ Moved to openspec/changes/archive/2025-01-24-add-dark-mode/

     Change archived successfully.
```

**提示：**
- 归档不会因未完成的任务而阻塞，但会发出警告
- 增量规格可以在归档时或之前同步
- 已归档的变更会保留以供历史记录
- 先使用 `/opsx:verify` 来发现问题

---

### `/opsx:bulk-archive`

一次性归档多个已完成的变更。处理变更之间的规格冲突。

**语法：**
```
/opsx:bulk-archive [change-names...]
```

**参数：**
| 参数 | 必需 | 描述 |
|----------|----------|-------------|
| `change-names` | 否 | 要归档的特定变更（未提供时提示选择） |

**功能说明：**
- 列出所有已完成的变更
- 归档前验证每个变更
- 检测跨变更的规格冲突
- 通过检查实际实现来解决冲突
- 按时间顺序归档

**示例：**
```
You: /opsx:bulk-archive

AI:  Found 3 completed changes:
     - add-dark-mode (8/8 tasks complete)
     - fix-login-bug (3/3 tasks complete)
     - update-footer (2/2 tasks complete)

     Checking for spec conflicts...
     ⚠ add-dark-mode and update-footer both touch specs/ui/

     Inspecting codebase to resolve...
     Both changes are implemented. Will merge in chronological order:
     1. add-dark-mode (created Jan 20)
     2. update-footer (created Jan 22)

     Archive all 3 changes?

You: Yes

AI:  ✓ Archived add-dark-mode
     ✓ Archived fix-login-bug
     ✓ Archived update-footer
     Specs merged: add-dark-mode → update-footer
```

**提示：**
- 适合并行工作流
- 冲突解决是智能的（会检查代码库）
- 变更按创建顺序归档
- 覆盖规格内容前会进行提示

---

### `/opsx:onboard`

通过完整 OpenSpec 工作流的引导式入门教程。使用你的实际代码库进行交互式教学。

**语法：**
```
/opsx:onboard
```

**功能说明：**
- 通过叙述引导完成完整的工作流循环
- 扫描你的代码库以寻找真实的改进机会
- 使用真实产物创建实际变更
- 实施实际工作（小型、安全的更改）
- 归档已完成的变更
- 在每个步骤发生时进行解释

**阶段：**
1. 欢迎和代码库分析
2. 寻找改进机会
3. 创建变更（`/opsx:new`）
4. 编写提案
5. 创建规格
6. 编写设计
7. 创建任务
8. 实施任务（`/opsx:apply`）
9. 验证实现
10. 归档变更
11. 总结和后续步骤

**示例：**
```
You: /opsx:onboard

AI:  Welcome to OpenSpec!

     I'll walk you through the complete workflow using your actual codebase.
     We'll find something small to improve, create a proper change for it,
     implement it, and archive it.

     Let me scan your codebase for opportunities...

     [Analyzes codebase]

     I found a few things we could work on:
     1. Add input validation to the contact form
     2. Improve error messages in the auth flow
     3. Add loading states to async buttons

     Which interests you? (or suggest something else)
```

**提示：**
- 最适合学习工作流的新用户
- 使用真实代码，而非示例项目
- 创建一个你可以保留或丢弃的真实变更
- 完成大约需要 15-30 分钟

---

## 不同 AI 工具的命令语法

不同的 AI 工具使用略有不同的命令语法。使用与你的工具匹配的格式：

| 工具 | 语法示例 |
|------|----------------|
| Claude Code | `/opsx:propose`, `/opsx:apply` |
| Cursor | `/opsx-propose`, `/opsx-apply` |
| Windsurf | `/opsx-propose`, `/opsx-apply` |
| Copilot (IDE) | `/opsx-propose`, `/opsx-apply` |
| Kimi CLI | 基于技能的调用方式，如 `/skill:openspec-propose`、`/skill:openspec-apply-change`（不生成 `opsx-*` 命令文件） |
| Trae | 基于技能的调用方式，如 `/openspec-propose`、`/openspec-apply-change`（不生成 `opsx-*` 命令文件） |

各工具的意图相同，但命令的呈现方式会因集成方式而异。

> **注意：** GitHub Copilot 命令（`.github/prompts/*.prompt.md`）仅在 IDE 扩展中可用（VS Code、JetBrains、Visual Studio）。GitHub Copilot CLI 目前不支持自定义提示文件——详情和变通方法请参阅 [支持的工具](supported-tools.md)。

---

## 旧版命令

这些命令使用较旧的「一次性完成」工作流。它们仍然有效，但推荐使用 OPSX 命令。

| 命令 | 功能 |
|---------|--------------|
| `/openspec:proposal` | 一次性创建所有产物（proposal、specs、design、tasks） |
| `/openspec:apply` | 实施变更 |
| `/openspec:archive` | 归档变更 |

**何时使用旧版命令：**
- 使用旧工作流的现有项目
- 不需要增量产物创建的简单变更
- 偏好一次性完成的方式

**迁移到 OPSX：**
旧版变更可以用 OPSX 命令继续。产物结构是兼容的。

---

## 故障排除

### "Change not found"

命令无法识别要处理的变更。

**解决方案：**
- 明确指定变更名称：`/opsx:apply add-dark-mode`
- 检查变更文件夹是否存在：`openspec list`
- 确认你在正确的项目目录中

### "No artifacts ready"

所有产物要么已完成，要么被缺失的依赖阻塞。

**解决方案：**
- 运行 `openspec status --change <name>` 查看阻塞原因
- 检查所需的产物是否存在
- 先创建缺失的依赖产物

### "Schema not found"

指定的 schema 不存在。

**解决方案：**
- 列出可用的 schema：`openspec schemas`
- 检查 schema 名称的拼写
- 如果是自定义 schema，则创建它：`openspec schema init <name>`

### 命令无法识别

AI 工具不识别 OpenSpec 命令。

**解决方案：**
- 确保 OpenSpec 已初始化：`openspec init`
- 重新生成技能：`openspec update`
- 检查 `.claude/skills/` 目录是否存在（对于 Claude Code）
- 重启你的 AI 工具以加载新技能

### 产物未正确生成

AI 创建了不完整或不正确的产物。

**解决方案：**
- 在 `openspec/config.yaml` 中添加项目上下文
- 为特定指导添加每个产物的规则
- 在变更描述中提供更多细节
- 使用 `/opsx:continue` 替代 `/opsx:ff` 以获得更多控制

---

## 后续步骤

- [工作流](workflows.md) - 常见模式以及何时使用每个命令
- [CLI](cli.md) - 用于管理和验证的终端命令
- [自定义](customization.md) - 创建自定义 schema 和工作流
