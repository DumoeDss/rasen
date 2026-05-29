# 迁移到 OPSX

本指南帮助你从旧版 OpenSpec 工作流过渡到 OPSX。迁移过程设计得非常顺畅——你现有的工作会被保留，新系统也提供了更多灵活性。

## 有什么变化？

OPSX 用流畅的、基于操作的方式取代了旧的阶段锁定工作流。以下是关键变化：

| 方面 | 旧版 | OPSX |
|--------|--------|------|
| **命令** | `/openspec:proposal`, `/openspec:apply`, `/openspec:archive` | 默认: `/opsx:propose`, `/opsx:apply`, `/opsx:archive` (扩展工作流命令可选) |
| **工作流** | 一次性创建所有制品 | 渐进式或一次性创建——由你选择 |
| **回退** | 笨拙的阶段门控 | 自然——随时更新任何制品 |
| **定制** | 固定结构 | Schema 驱动，完全可定制 |
| **配置** | `CLAUDE.md` 标记 + `project.md` | 简洁的配置在 `openspec/config.yaml` |

**理念变化：** 工作不是线性的。OPSX 不再假装它是线性的。

---

## 开始之前

### 你的现有工作是安全的

迁移过程以保留为设计原则：

- **`openspec/changes/` 中的活跃变更** — 完全保留。你可以使用 OPSX 命令继续它们。
- **已归档的变更** — 不受影响。你的历史记录保持完整。
- **`openspec/specs/` 中的主规格** — 不受影响。这些是你的真实数据源。
- **你在 CLAUDE.md、AGENTS.md 等文件中的内容** — 保留。只有 OpenSpec 标记块会被移除；你写的所有内容都会保留。

### 什么会被移除

只有被替换的 OpenSpec 管理文件：

| 内容 | 原因 |
|------|-----|
| 旧版斜杠命令目录/文件 | 被新的 skills 系统替代 |
| `openspec/AGENTS.md` | 已过时的工作流触发器 |
| `CLAUDE.md`、`AGENTS.md` 等中的 OpenSpec 标记 | 不再需要 |

**各工具的旧版命令位置**（示例——你的工具可能有所不同）：

- Claude Code: `.claude/commands/openspec/`
- Cursor: `.cursor/commands/openspec-*.md`
- Windsurf: `.windsurf/workflows/openspec-*.md`
- Cline: `.clinerules/workflows/openspec-*.md`
- Roo: `.roo/commands/openspec-*.md`
- GitHub Copilot: `.github/prompts/openspec-*.prompt.md`（仅 IDE 扩展；Copilot CLI 不支持）
- 以及其他工具（Augment、Continue、Amazon Q 等）

迁移会检测你已配置的工具并清理它们的旧版文件。

移除列表看起来可能很长，但这些都是 OpenSpec 最初创建的文件。你自己的内容永远不会被删除。

### 需要你注意的事项

有一个文件需要手动迁移：

**`openspec/project.md`** — 这个文件不会被自动删除，因为它可能包含你编写的项目上下文。你需要：

1. 审查其内容
2. 将有用的上下文移到 `openspec/config.yaml`（参见下方指导）
3. 准备好后删除该文件

**为什么我们做了这个改变：**

旧的 `project.md` 是被动的——AI 助手可能读它，可能不读，可能忘了读过什么。我们发现可靠性不一致。

新的 `config.yaml` 上下文会**被主动注入到每个 OpenSpec 规划请求中**。这意味着你的项目约定、技术栈和规则在 AI 创建制品时始终存在。可靠性更高。

**权衡：**

因为上下文会被注入到每个请求中，你需要尽量简洁。专注于真正重要的内容：
- 技术栈和关键约定
- AI 需要了解的非显而易见的约束
- 之前经常被忽略的规则

不必担心做到完美。我们仍在探索什么最有效，并且会在实验中不断改进上下文注入的方式。

---

## 运行迁移

`openspec init` 和 `openspec update` 都会检测旧版文件并引导你完成相同的清理过程。根据你的情况选择合适的命令：

- 新安装默认使用 `core` 配置文件（`propose`、`explore`、`apply`、`archive`）。
- 迁移安装会在需要时通过写入 `custom` 配置文件来保留你之前安装的工作流。

### 使用 `openspec init`

如果你想添加新工具或重新配置已设置的工具，请运行此命令：

```bash
openspec init
```

init 命令会检测旧版文件并引导你完成清理：

```
Upgrading to the new OpenSpec

OpenSpec now uses agent skills, the emerging standard across coding
agents. This simplifies your setup while keeping everything working
as before.

Files to remove
No user content to preserve:
  • .claude/commands/openspec/
  • openspec/AGENTS.md

Files to update
OpenSpec markers will be removed, your content preserved:
  • CLAUDE.md
  • AGENTS.md

Needs your attention
  • openspec/project.md
    We won't delete this file. It may contain useful project context.

    The new openspec/config.yaml has a "context:" section for planning
    context. This is included in every OpenSpec request and works more
    reliably than the old project.md approach.

    Review project.md, move any useful content to config.yaml's context
    section, then delete the file when ready.

? Upgrade and clean up legacy files? (Y/n)
```

**当你选择"是"时会发生什么：**

1. 旧版斜杠命令目录被移除
2. OpenSpec 标记从 `CLAUDE.md`、`AGENTS.md` 等文件中剥离（你的内容保留）
3. `openspec/AGENTS.md` 被删除
4. 新的 skills 安装到 `.claude/skills/`
5. `openspec/config.yaml` 使用默认 schema 创建

### 使用 `openspec update`

如果你只想迁移并将现有工具刷新到最新版本，请运行此命令：

```bash
openspec update
```

update 命令也会检测并清理旧版制品，然后刷新生成的 skills/commands 以匹配你当前的 profile 和 delivery 设置。

### 非交互式 / CI 环境

用于脚本化迁移：

```bash
openspec init --force --tools claude
```

`--force` 标志跳过提示并自动接受清理。

---

## 将 project.md 迁移到 config.yaml

旧的 `openspec/project.md` 是一个自由格式的 markdown 文件，用于项目上下文。新的 `openspec/config.yaml` 是结构化的，而且关键的是——**会被注入到每个规划请求中**，这样你的约定在 AI 工作时始终存在。

### 之前 (project.md)

```markdown
# Project Context

This is a TypeScript monorepo using React and Node.js.
We use Jest for testing and follow strict ESLint rules.
Our API is RESTful and documented in docs/api.md.

## Conventions

- All public APIs must maintain backwards compatibility
- New features should include tests
- Use Given/When/Then format for specifications
```

### 之后 (config.yaml)

```yaml
schema: spec-driven

context: |
  Tech stack: TypeScript, React, Node.js
  Testing: Jest with React Testing Library
  API: RESTful, documented in docs/api.md
  We maintain backwards compatibility for all public APIs

rules:
  proposal:
    - Include rollback plan for risky changes
  specs:
    - Use Given/When/Then format for scenarios
    - Reference existing patterns before inventing new ones
  design:
    - Include sequence diagrams for complex flows
```

### 关键区别

| project.md | config.yaml |
|------------|-------------|
| 自由格式 markdown | 结构化 YAML |
| 一大段文本 | 独立的上下文和按制品分类的规则 |
| 不清楚何时被使用 | 上下文出现在所有制品中；规则仅出现在匹配的制品中 |
| 无 schema 选择 | 显式的 `schema:` 字段设置默认工作流 |

### 保留什么，丢弃什么

迁移时要有选择性。问自己："AI 在*每个*规划请求中都需要这个吗？"

**适合放入 `context:` 的内容**
- 技术栈（语言、框架、数据库）
- 关键架构模式（monorepo、微服务等）
- 非显而易见的约束（"我们不能使用库 X 因为……"）
- 经常被忽略的关键约定

**改为放入 `rules:` 的内容**
- 特定制品的格式要求（"在 specs 中使用 Given/When/Then"）
- 审查标准（"proposal 必须包含回滚计划"）
- 这些只会出现在匹配的制品中，使其他请求更轻量

**完全省略的内容**
- AI 已经知道的通用最佳实践
- 可以被总结的冗长解释
- 不影响当前工作的历史上下文

### 迁移步骤

1. **创建 config.yaml**（如果 init 尚未创建）：
   ```yaml
   schema: spec-driven
   ```

2. **添加你的上下文**（保持简洁——这会进入每个请求）：
   ```yaml
   context: |
     Your project background goes here.
     Focus on what the AI genuinely needs to know.
   ```

3. **添加按制品分类的规则**（可选）：
   ```yaml
   rules:
     proposal:
       - Your proposal-specific guidance
     specs:
       - Your spec-writing rules
   ```

4. **删除 project.md**，在你迁移完所有有用内容之后。

**不要过度思考。** 从基本要素开始，然后迭代。如果你注意到 AI 遗漏了重要内容，就添加它。如果上下文感觉臃肿，就精简它。这是一个活文档。

### 需要帮助？使用这个提示词

如果你不确定如何精炼你的 project.md，可以问你的 AI 助手：

```
I'm migrating from OpenSpec's old project.md to the new config.yaml format.

Here's my current project.md:
[paste your project.md content]

Please help me create a config.yaml with:
1. A concise `context:` section (this gets injected into every planning request, so keep it tight—focus on tech stack, key constraints, and conventions that often get ignored)
2. `rules:` for specific artifacts if any content is artifact-specific (e.g., "use Given/When/Then" belongs in specs rules, not global context)

Leave out anything generic that AI models already know. Be ruthless about brevity.
```

AI 会帮你识别哪些是必要的，哪些可以精简。

---

## 新命令

命令可用性取决于 profile：

**默认（`core` profile）：**

| 命令 | 用途 |
|---------|---------|
| `/opsx:propose` | 创建变更并一步生成规划制品 |
| `/opsx:explore` | 无结构地思考想法 |
| `/opsx:apply` | 从 tasks.md 执行任务 |
| `/opsx:archive` | 完成并归档变更 |

**扩展工作流（自定义选择）：**

| 命令 | 用途 |
|---------|---------|
| `/opsx:new` | 创建新的变更脚手架 |
| `/opsx:continue` | 创建下一个制品（一次一个） |
| `/opsx:ff` | 快进——一次创建规划制品 |
| `/opsx:verify` | 验证实现是否匹配规格 |
| `/opsx:sync` | 预览/spec-merge 而不归档 |
| `/opsx:bulk-archive` | 一次归档多个变更 |
| `/opsx:onboard` | 引导式端到端入门工作流 |

使用 `openspec config profile` 启用扩展命令，然后运行 `openspec update`。

### 从旧版命令映射

| 旧版 | OPSX 对应命令 |
|--------|-----------------|
| `/openspec:proposal` | `/opsx:propose`（默认）或 `/opsx:new` 然后 `/opsx:ff`（扩展） |
| `/openspec:apply` | `/opsx:apply` |
| `/openspec:archive` | `/opsx:archive` |

### 新功能

这些功能是扩展工作流命令集的一部分。

**细粒度制品创建：**
```
/opsx:continue
```
根据依赖关系一次创建一个制品。当你想逐步审查时使用此命令。

**探索模式：**
```
/opsx:explore
```
在提交变更之前，与伙伴一起思考想法。

---

## 理解新架构

### 从阶段锁定到流畅

旧版工作流强制线性推进：

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   PLANNING   │ ───► │ IMPLEMENTING │ ───► │   ARCHIVING  │
│    PHASE     │      │    PHASE     │      │    PHASE     │
└──────────────┘      └──────────────┘      └──────────────┘

如果你在实现阶段发现设计有问题？
很遗憾。阶段门控不允许你轻松回退。
```

OPSX 使用操作而非阶段：

```
         ┌───────────────────────────────────────────────┐
         │           ACTIONS (not phases)                │
         │                                               │
         │     new ◄──► continue ◄──► apply ◄──► archive │
         │      │          │           │             │   │
         │      └──────────┴───────────┴─────────────┘   │
         │                    any order                  │
         └───────────────────────────────────────────────┘
```

### 依赖图

制品形成有向图。依赖关系是促成条件，而非门控：

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
```

当你运行 `/opsx:continue` 时，它会检查哪些已就绪并提供下一个制品。你也可以按任意顺序创建多个就绪的制品。

### Skills 与 Commands

旧系统使用工具特定的命令文件：

```
.claude/commands/openspec/
├── proposal.md
├── apply.md
└── archive.md
```

OPSX 使用新兴的 **skills** 标准：

```
.claude/skills/
├── openspec-explore/SKILL.md
├── openspec-new-change/SKILL.md
├── openspec-continue-change/SKILL.md
├── openspec-apply-change/SKILL.md
└── ...
```

Skills 被多种 AI 编码工具识别，并提供更丰富的元数据。

---

## 继续现有变更

你正在进行的变更可以与 OPSX 命令无缝配合。

**有来自旧版工作流的活跃变更？**

```
/opsx:apply add-my-feature
```

OPSX 会读取现有制品并从你离开的地方继续。

**想为现有变更添加更多制品？**

```
/opsx:continue add-my-feature
```

根据已有内容显示哪些可以创建。

**需要查看状态？**

```bash
openspec status --change add-my-feature
```

---

## 新配置系统

### config.yaml 结构

```yaml
# Required: Default schema for new changes
schema: spec-driven

# Optional: Project context (max 50KB)
# Injected into ALL artifact instructions
context: |
  Your project background, tech stack,
  conventions, and constraints.

# Optional: Per-artifact rules
# Only injected into matching artifacts
rules:
  proposal:
    - Include rollback plan
  specs:
    - Use Given/When/Then format
  design:
    - Document fallback strategies
  tasks:
    - Break into 2-hour maximum chunks
```

### Schema 解析

确定使用哪个 schema 时，OPSX 按以下顺序检查：

1. **CLI 标志**: `--schema <name>`（最高优先级）
2. **变更元数据**: 变更目录中的 `.openspec.yaml`
3. **项目配置**: `openspec/config.yaml`
4. **默认值**: `spec-driven`

### 可用的 Schema

| Schema | 制品 | 最适用于 |
|--------|-----------|----------|
| `spec-driven` | proposal → specs → design → tasks | 大多数项目 |

列出所有可用的 schema：

```bash
openspec schemas
```

### 自定义 Schema

创建你自己的工作流：

```bash
openspec schema init my-workflow
```

或 fork 一个现有的：

```bash
openspec schema fork spec-driven my-workflow
```

详见 [定制指南](customization.md)。

---

## 故障排除

### "Legacy files detected in non-interactive mode"

你正在 CI 或非交互式环境中运行。使用：

```bash
openspec init --force
```

### 迁移后命令未出现

重启你的 IDE。Skills 在启动时被检测。

### "Unknown artifact ID in rules"

检查你的 `rules:` 键是否匹配你 schema 的制品 ID：

- **spec-driven**: `proposal`, `specs`, `design`, `tasks`

运行以下命令查看有效的制品 ID：

```bash
openspec schemas --json
```

### 配置未生效

1. 确保文件位于 `openspec/config.yaml`（不是 `.yml`）
2. 验证 YAML 语法
3. 配置更改立即生效——无需重启

### project.md 未迁移

系统有意保留 `project.md`，因为它可能包含你的自定义内容。手动审查它，将有用的部分移到 `config.yaml`，然后删除它。

### 想查看哪些内容会被清理？

运行 init 并拒绝清理提示——你将看到完整的检测摘要，不会做任何更改。

---

## 快速参考

### 迁移后的文件

```
project/
├── openspec/
│   ├── specs/                    # 未变更
│   ├── changes/                  # 未变更
│   │   └── archive/              # 未变更
│   └── config.yaml               # 新增: 项目配置
├── .claude/
│   └── skills/                   # 新增: OPSX skills
│       ├── openspec-propose/     # 默认 core profile
│       ├── openspec-explore/
│       ├── openspec-apply-change/
│       └── ...                   # 扩展 profile 添加 new/continue/ff 等
├── CLAUDE.md                     # OpenSpec 标记已移除，你的内容保留
└── AGENTS.md                     # OpenSpec 标记已移除，你的内容保留
```

### 已移除的内容

- `.claude/commands/openspec/` — 被 `.claude/skills/` 替代
- `openspec/AGENTS.md` — 已过时
- `openspec/project.md` — 迁移到 `config.yaml`，然后删除
- `CLAUDE.md`、`AGENTS.md` 等文件中的 OpenSpec 标记块

### 命令速查表

```text
/opsx:propose      快速开始（默认 core profile）
/opsx:apply        执行任务
/opsx:archive      完成并归档

# 扩展工作流（如果启用）：
/opsx:new          创建变更脚手架
/opsx:continue     创建下一个制品
/opsx:ff           创建规划制品
```

---

## 获取帮助

- **Discord**: [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC)
- **GitHub Issues**: [github.com/Fission-AI/OpenSpec/issues](https://github.com/Fission-AI/OpenSpec/issues)
- **文档**: [docs/opsx.md](opsx.md) 查看完整的 OPSX 参考
