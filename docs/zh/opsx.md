# OPSX 工作流

> 欢迎在 [Discord](https://discord.gg/YctCnvvshC) 上提供反馈。

## 什么是 OPSX？

OPSX 现在是 OpenSpec 的标准工作流。

它是一个**灵活的、迭代式的工作流**，用于管理 OpenSpec 变更。不再有僵化的阶段——你可以随时执行任何操作。

## 为什么需要它

传统的 OpenSpec 工作流虽然可用，但**限制太多**：

- **指令是硬编码的** —— 埋在 TypeScript 中，你无法修改
- **要么全有要么全无** —— 一个大命令创建所有内容，无法单独测试各个部分
- **固定的结构** —— 所有人使用同样的工作流，无法自定义
- **黑盒** —— 当 AI 输出质量不好时，你无法调整提示词

**OPSX 将其开放。** 现在任何人都可以：

1. **尝试不同的指令** —— 编辑模板，看看 AI 是否表现更好
2. **细粒度测试** —— 独立验证每个产物的指令
3. **自定义工作流** —— 定义你自己的产物和依赖关系
4. **快速迭代** —— 修改模板，立即测试，无需重新构建

```
Legacy workflow:                      OPSX:
┌────────────────────────┐           ┌────────────────────────┐
│  Hardcoded in package  │           │  schema.yaml           │◄── You edit this
│  (can't change)        │           │  templates/*.md        │◄── Or this
│        ↓               │           │        ↓               │
│  Wait for new release  │           │  Instant effect        │
│        ↓               │           │        ↓               │
│  Hope it's better      │           │  Test it yourself      │
└────────────────────────┘           └────────────────────────┘
```

**这适用于所有人：**
- **团队** —— 创建与你实际工作方式匹配的工作流
- **高级用户** —— 调整提示词以获得更好的 AI 输出
- **OpenSpec 贡献者** —— 无需发布新版本即可尝试新方法

我们都还在探索什么方法最有效。OPSX 让我们一起学习。

## 用户体验

**线性工作流的问题：**
你处于"规划阶段"，然后是"实现阶段"，然后"完成"。但实际工作并非如此。你实现了某个功能，发现设计有误，需要更新规格，然后继续实现。线性阶段与工作的实际方式相矛盾。

**OPSX 的方法：**
- **操作，而非阶段** —— 创建、实现、更新、归档——随时执行任何操作
- **依赖是推动力** —— 它们展示什么是可能的，而不是什么是必须的

```
  proposal ──→ specs ──→ design ──→ tasks ──→ implement
```

## 设置

```bash
# Make sure you have openspec installed — skills are automatically generated
openspec init
```

这将在 `.claude/skills/`（或等效目录）中创建技能文件，AI 编码助手会自动检测到它们。

默认情况下，OpenSpec 使用 `core` 工作流配置（`propose`、`explore`、`apply`、`sync`、`archive`）。如果你需要扩展工作流命令（`new`、`continue`、`ff`、`verify`、`bulk-archive`、`onboard`），请使用 `openspec config profile` 进行配置，并通过 `openspec update` 应用。

在设置过程中，系统会提示你创建**项目配置**（`openspec/config.yaml`）。这是可选的，但建议创建。

## 项目配置

项目配置允许你设置默认值，并将项目特定的上下文注入到所有产物中。

### 创建配置

配置在 `openspec init` 时创建，也可以手动创建：

```yaml
# openspec/config.yaml
schema: spec-driven

context: |
  Tech stack: TypeScript, React, Node.js
  API conventions: RESTful, JSON responses
  Testing: Vitest for unit tests, Playwright for e2e
  Style: ESLint with Prettier, strict TypeScript

rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
  specs:
    - Use Given/When/Then format for scenarios
  design:
    - Include sequence diagrams for complex flows
```

### 配置字段

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `schema` | string | 新变更的默认 schema（例如 `spec-driven`） |
| `context` | string | 注入到所有产物指令中的项目上下文 |
| `rules` | object | 按产物 ID 索引的每产物规则 |

### 工作原理

**Schema 优先级**（从高到低）：
1. CLI 标志（`--schema <name>`）
2. 变更元数据（变更目录中的 `.openspec.yaml`）
3. 项目配置（`openspec/config.yaml`）
4. 默认值（`spec-driven`）

**上下文注入：**
- 上下文会被添加到每个产物指令的前面
- 包裹在 `<context>...</context>` 标签中
- 帮助 AI 理解你的项目规格

**规则注入：**
- 规则仅注入到匹配的产物中
- 包裹在 `<rules>...</rules>` 标签中
- 出现在上下文之后、模板之前

### 按 Schema 分类的产物 ID

**spec-driven**（默认）：
- `proposal` — 变更提案
- `specs` — 规格说明
- `design` — 技术设计
- `tasks` — 实现任务

### 配置验证

- `rules` 中的未知产物 ID 会生成警告
- Schema 名称会根据可用的 schema 进行验证
- 上下文大小限制为 50KB
- 无效的 YAML 会报告行号

### 故障排除

**"Unknown artifact ID in rules: X"**
- 检查产物 ID 是否与你的 schema 匹配（参见上方列表）
- 运行 `openspec schemas --json` 查看每个 schema 的产物 ID

**配置未生效：**
- 确保文件位于 `openspec/config.yaml`（不是 `.yml`）
- 使用验证器检查 YAML 语法
- 配置更改立即生效（无需重启）

**上下文过大：**
- 上下文限制为 50KB
- 改为概括或链接到外部文档

## 命令

| 命令 | 功能 |
|---------|--------------|
| `/opsx:propose` | 一步创建变更并生成规划产物（默认快捷路径） |
| `/opsx:explore` | 思考想法、调查问题、澄清需求 |
| `/opsx:new` | 创建新的变更脚手架（扩展工作流） |
| `/opsx:continue` | 创建下一个产物（扩展工作流） |
| `/opsx:ff` | 快速生成规划产物（扩展工作流） |
| `/opsx:apply` | 实现任务，按需更新产物 |
| `/opsx:verify` | 根据产物验证实现（扩展工作流） |
| `/opsx:sync` | 将增量规格同步到主分支（默认工作流，可选） |
| `/opsx:archive` | 完成后归档 |
| `/opsx:bulk-archive` | 批量归档已完成的变更（扩展工作流） |
| `/opsx:onboard` | 端到端变更的引导式演练（扩展工作流） |

## 使用方法

### 探索想法
```
/opsx:explore
```
思考想法、调查问题、比较选项。不需要任何结构——只是一个思考伙伴。当想法成熟后，转到 `/opsx:propose`（默认）或 `/opsx:new`/`/opsx:ff`（扩展）。

### 开始新的变更
```
/opsx:propose
```
创建变更并生成实现前所需的规划产物。

如果你启用了扩展工作流，也可以使用：

```text
/opsx:new        # scaffold only
/opsx:continue   # create one artifact at a time
/opsx:ff         # create all planning artifacts at once
```

### 创建产物
```
/opsx:continue
```
根据依赖关系显示哪些产物可以创建，然后创建一个。反复使用以逐步构建你的变更。

```
/opsx:ff add-dark-mode
```
一次性创建所有规划产物。当你对要构建的内容有清晰的认识时使用。

### 实现（灵活的部分）
```
/opsx:apply
```
逐步完成任务，逐一勾选。如果你同时处理多个变更，可以运行 `/opsx:apply <name>`；否则系统会从对话中推断，如果无法判断则会提示你选择。

### 收尾
```
/opsx:archive   # Move to archive when done (prompts to sync specs if needed)
```

## 何时更新 vs. 重新开始

你始终可以在实现前编辑提案或规格。但什么时候"改进"变成了"这是不同的工作"？

### 提案包含什么

一个提案定义了三件事：
1. **意图** —— 你在解决什么问题？
2. **范围** —— 什么在范围内/范围外？
3. **方法** —— 你将如何解决？

关键问题是：哪个发生了变化，变化了多少？

### 在以下情况下更新现有变更：

**相同意图，改进执行**
- 你发现了未考虑到的边界情况
- 方法需要微调但目标未变
- 实现中发现设计略有偏差

**范围缩小**
- 你意识到完整范围太大，想先发布 MVP
- "添加暗色模式" → "添加暗色模式切换（系统偏好在 v2 中实现）"

**学习驱动的修正**
- 代码库的结构与你想象的不同
- 某个依赖的行为与预期不符
- "使用 CSS 变量" → "改用 Tailwind 的 dark: 前缀"

### 在以下情况下开始新的变更：

**意图根本改变**
- 问题本身已经不同了
- "添加暗色模式" → "添加包含自定义颜色、字体、间距的综合主题系统"

**范围爆炸**
- 变更增长太多，本质上已经是不同的工作
- 更新后原始提案将面目全非
- "修复登录 bug" → "重写认证系统"

**原始变更可完成**
- 原始变更可以标记为"完成"
- 新工作独立存在，不是改进
- 完成"添加暗色模式 MVP" → 归档 → 新变更"增强暗色模式"

### 判断准则

```
                        ┌─────────────────────────────────────┐
                        │     Is this the same work?          │
                        └──────────────┬──────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
             Same intent?      >50% overlap?      Can original
             Same problem?     Same scope?        be "done" without
                    │                  │          these changes?
                    │                  │                  │
          ┌────────┴────────┐  ┌──────┴──────┐   ┌───────┴───────┐
          │                 │  │             │   │               │
         YES               NO YES           NO  NO              YES
          │                 │  │             │   │               │
          ▼                 ▼  ▼             ▼   ▼               ▼
       UPDATE            NEW  UPDATE       NEW  UPDATE          NEW
```

| 测试 | 更新 | 新变更 |
|------|--------|------------|
| **身份** | "同样的事情，改进了" | "不同的工作" |
| **范围重叠** | >50% 重叠 | <50% 重叠 |
| **完成度** | 没有这些更改无法"完成" | 可以完成原始工作，新工作独立存在 |
| **叙事** | 更新链讲述连贯的故事 | 补丁带来的困惑多于清晰 |

### 原则

> **更新保留上下文。新变更提供清晰度。**
>
> 当思考历程有价值时，选择更新。
> 当重新开始比打补丁更清晰时，选择新变更。

把它想象成 git 分支：
- 在同一个功能上持续提交
- 当确实是全新工作时开始新分支
- 有时合并部分功能，然后为第二阶段重新开始

## 有什么不同？

| | 传统工作流 (`/openspec:proposal`) | OPSX (`/opsx:*`) |
|---|---|---|
| **结构** | 一个大的提案文档 | 具有依赖关系的离散产物 |
| **工作流** | 线性阶段：规划 → 实现 → 归档 | 灵活操作——随时执行任何操作 |
| **迭代** | 难以回退 | 在学习过程中更新产物 |
| **自定义** | 固定结构 | Schema 驱动（定义你自己的产物） |

**核心洞察：** 工作不是线性的。OPSX 不再假装它是。

## 架构深入解析

本节解释 OPSX 的底层工作原理以及它与传统工作流的比较。
本节中的示例使用扩展命令集（`new`、`continue` 等）；默认 `core` 用户可以将同样的流程映射为 `propose → apply → sync → archive`。

### 理念：阶段 vs 操作

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LEGACY WORKFLOW                                      │
│                    (Phase-Locked, All-or-Nothing)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐             │
│   │   PLANNING   │ ───► │ IMPLEMENTING │ ───► │   ARCHIVING  │             │
│   │    PHASE     │      │    PHASE     │      │    PHASE     │             │
│   └──────────────┘      └──────────────┘      └──────────────┘             │
│         │                     │                     │                       │
│         ▼                     ▼                     ▼                       │
│   /openspec:proposal   /openspec:apply      /openspec:archive              │
│                                                                             │
│   • Creates ALL artifacts at once                                          │
│   • Can't go back to update specs during implementation                    │
│   • Phase gates enforce linear progression                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                            OPSX WORKFLOW                                     │
│                      (Fluid Actions, Iterative)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│              ┌────────────────────────────────────────────┐                 │
│              │           ACTIONS (not phases)             │                 │
│              │                                            │                 │
│              │   new ◄──► continue ◄──► apply ◄──► archive │                 │
│              │    │          │           │           │    │                 │
│              │    └──────────┴───────────┴───────────┘    │                 │
│              │              any order                     │                 │
│              └────────────────────────────────────────────┘                 │
│                                                                             │
│   • Create artifacts one at a time OR fast-forward                         │
│   • Update specs/design/tasks during implementation                        │
│   • Dependencies enable progress, phases don't exist                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 组件架构

**传统工作流** 使用 TypeScript 中的硬编码模板：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LEGACY WORKFLOW COMPONENTS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Hardcoded Templates (TypeScript strings)                                  │
│                    │                                                        │
│                    ▼                                                        │
│   Tool-specific configurators/adapters                                      │
│                    │                                                        │
│                    ▼                                                        │
│   Generated Command Files (.claude/commands/openspec/*.md)                  │
│                                                                             │
│   • Fixed structure, no artifact awareness                                  │
│   • Change requires code modification + rebuild                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**OPSX** 使用外部 schema 和依赖图引擎：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OPSX COMPONENTS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Schema Definitions (YAML)                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  name: spec-driven                                                  │   │
│   │  artifacts:                                                         │   │
│   │    - id: proposal                                                   │   │
│   │      generates: proposal.md                                         │   │
│   │      requires: []              ◄── Dependencies                     │   │
│   │    - id: specs                                                      │   │
│   │      generates: specs/**/*.md  ◄── Glob patterns                    │   │
│   │      requires: [proposal]      ◄── Enables after proposal           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                    │                                                        │
│                    ▼                                                        │
│   Artifact Graph Engine                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  • Topological sort (dependency ordering)                           │   │
│   │  • State detection (filesystem existence)                           │   │
│   │  • Rich instruction generation (templates + context)                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                    │                                                        │
│                    ▼                                                        │
│   Skill Files (.claude/skills/openspec-*/SKILL.md)                          │
│                                                                             │
│   • Cross-editor compatible (Claude Code, Cursor, Windsurf)                 │
│   • Skills query CLI for structured data                                    │
│   • Fully customizable via schema files                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 依赖图模型

产物形成有向无环图（DAG）。依赖是**推动力**，而非关卡：

```
                              proposal
                             (root node)
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
                 specs                       design
              (requires:                  (requires:
               proposal)                   proposal)
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                               tasks
                           (requires:
                           specs, design)
                                  │
                                  ▼
                          ┌──────────────┐
                          │ APPLY PHASE  │
                          │ (requires:   │
                          │  tasks)      │
                          └──────────────┘
```

**状态转换：**

```
   BLOCKED ────────────────► READY ────────────────► DONE
      │                        │                       │
   Missing                  All deps               File exists
   dependencies             are DONE               on filesystem
```

### 信息流

**传统工作流** —— 代理接收静态指令：

```
  User: "/openspec:proposal"
           │
           ▼
  ┌─────────────────────────────────────────┐
  │  Static instructions:                   │
  │  • Create proposal.md                   │
  │  • Create tasks.md                      │
  │  • Create design.md                     │
  │  • Create specs/<capability>/spec.md    │
  │                                         │
  │  No awareness of what exists or         │
  │  dependencies between artifacts         │
  └─────────────────────────────────────────┘
           │
           ▼
  Agent creates ALL artifacts in one go
```

**OPSX** —— 代理查询丰富的上下文：

```
  User: "/opsx:continue"
           │
           ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  Step 1: Query current state                                             │
  │  ┌────────────────────────────────────────────────────────────────────┐  │
  │  │  $ openspec status --change "add-auth" --json                      │  │
  │  │                                                                    │  │
  │  │  {                                                                 │  │
  │  │    "artifacts": [                                                  │  │
  │  │      {"id": "proposal", "status": "done"},                         │  │
  │  │      {"id": "specs", "status": "ready"},      ◄── First ready      │  │
  │  │      {"id": "design", "status": "ready"},                          │  │
  │  │      {"id": "tasks", "status": "blocked", "missingDeps": ["specs"]}│  │
  │  │    ]                                                               │  │
  │  │  }                                                                 │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  │                                                                          │
  │  Step 2: Get rich instructions for ready artifact                        │
  │  ┌────────────────────────────────────────────────────────────────────┐  │
  │  │  $ openspec instructions specs --change "add-auth" --json          │  │
  │  │                                                                    │  │
  │  │  {                                                                 │  │
  │  │    "template": "# Specification\n\n## ADDED Requirements...",      │  │
  │  │    "dependencies": [{"id": "proposal", "path": "...", "done": true}│  │
  │  │    "unlocks": ["tasks"]                                            │  │
  │  │  }                                                                 │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  │                                                                          │
  │  Step 3: Read dependencies → Create ONE artifact → Show what's unlocked  │
  └──────────────────────────────────────────────────────────────────────────┘
```

### 迭代模型

**传统工作流** —— 迭代很困难：

```
  ┌─────────┐     ┌─────────┐     ┌─────────┐
  │/proposal│ ──► │ /apply  │ ──► │/archive │
  └─────────┘     └─────────┘     └─────────┘
       │               │
       │               ├── "Wait, the design is wrong"
       │               │
       │               ├── Options:
       │               │   • Edit files manually (breaks context)
       │               │   • Abandon and start over
       │               │   • Push through and fix later
       │               │
       │               └── No official "go back" mechanism
       │
       └── Creates ALL artifacts at once
```

**OPSX** —— 自然迭代：

```
  /opsx:new ───► /opsx:continue ───► /opsx:apply ───► /opsx:archive
      │                │                  │
      │                │                  ├── "The design is wrong"
      │                │                  │
      │                │                  ▼
      │                │            Just edit design.md
      │                │            and continue!
      │                │                  │
      │                │                  ▼
      │                │         /opsx:apply picks up
      │                │         where you left off
      │                │
      │                └── Creates ONE artifact, shows what's unlocked
      │
      └── Scaffolds change, waits for direction
```

### 自定义 Schema

使用 schema 管理命令创建自定义工作流：

```bash
# Create a new schema from scratch (interactive)
openspec schema init my-workflow

# Or fork an existing schema as a starting point
openspec schema fork spec-driven my-workflow

# Validate your schema structure
openspec schema validate my-workflow

# See where a schema resolves from (useful for debugging)
openspec schema which my-workflow
```

Schema 存储在 `openspec/schemas/`（项目本地，版本控制）或 `~/.local/share/openspec/schemas/`（用户全局）。

**Schema 结构：**
```
openspec/schemas/research-first/
├── schema.yaml
└── templates/
    ├── research.md
    ├── proposal.md
    └── tasks.md
```

**示例 schema.yaml：**
```yaml
name: research-first
artifacts:
  - id: research        # Added before proposal
    generates: research.md
    requires: []

  - id: proposal
    generates: proposal.md
    requires: [research]  # Now depends on research

  - id: tasks
    generates: tasks.md
    requires: [proposal]
```

**依赖图：**
```
   research ──► proposal ──► tasks
```

### 总结

| 方面 | 传统工作流 | OPSX |
|--------|----------|------|
| **模板** | 硬编码 TypeScript | 外部 YAML + Markdown |
| **依赖** | 无（一次全部创建） | 具有拓扑排序的 DAG |
| **状态** | 基于阶段的心智模型 | 文件系统存在性 |
| **自定义** | 编辑源码，重新构建 | 创建 schema.yaml |
| **迭代** | 阶段锁定 | 灵活，可编辑任何内容 |
| **编辑器支持** | 特定工具的配置器/适配器 | 单一技能目录 |

## Schema

Schema 定义了存在哪些产物及其依赖关系。当前可用：

- **spec-driven**（默认）：proposal → specs → design → tasks

```bash
# List available schemas
openspec schemas

# See all schemas with their resolution sources
openspec schema which --all

# Create a new schema interactively
openspec schema init my-workflow

# Fork an existing schema for customization
openspec schema fork spec-driven my-workflow

# Validate schema structure before use
openspec schema validate my-workflow
```

## 提示

- 使用 `/opsx:explore` 在正式提交变更前思考想法
- 当你清楚想要什么时使用 `/opsx:ff`，探索时使用 `/opsx:continue`
- 在 `/opsx:apply` 期间，如果发现问题——修改产物，然后继续
- 任务通过 `tasks.md` 中的复选框跟踪进度
- 随时检查状态：`openspec status --change "name"`

## 反馈

这还很粗糙。这是有意为之的——我们正在学习什么有效。

发现了 bug？有想法？加入我们的 [Discord](https://discord.gg/YctCnvvshC) 或在 [GitHub](https://github.com/Fission-AI/openspec/issues) 上提交 issue。
