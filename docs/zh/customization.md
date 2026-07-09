# 自定义

OpenSpec 提供三个层级的自定义方式：

| 层级 | 功能 | 适用场景 |
|------|------|----------|
| **项目配置** | 设置默认值，注入上下文/规则 | 大多数团队 |
| **自定义 Schema** | 定义你自己的工作流产物 | 有独特流程的团队 |
| **全局覆盖** | 跨所有项目共享 schema | 高级用户 |

---

## 项目配置

`rasen/config.yaml` 文件是为你的团队自定义 OpenSpec 最简单的方式。它可以：

- **设置默认 schema** - 无需每条命令都加 `--schema`
- **注入项目上下文** - AI 可以了解你的技术栈、规范等
- **添加按产物分类的规则** - 为特定产物设置自定义规则

### 快速设置

```bash
rasen init
```

这将引导你通过交互方式创建配置。也可以手动创建：

```yaml
# rasen/config.yaml
schema: spec-driven

context: |
  Tech stack: TypeScript, React, Node.js, PostgreSQL
  API style: RESTful, documented in docs/api.md
  Testing: Jest + React Testing Library
  We value backwards compatibility for all public APIs

rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
  specs:
    - Use Given/When/Then format
    - Reference existing patterns before inventing new ones
```

### 工作原理

**默认 schema：**

```bash
# 没有配置时
rasen new change my-feature --schema spec-driven

# 有配置时 - schema 自动应用
rasen new change my-feature
```

**上下文和规则注入：**

在生成任何产物时，你的上下文和规则会被注入到 AI 提示词中：

```xml
<context>
Tech stack: TypeScript, React, Node.js, PostgreSQL
...
</context>

<rules>
- Include rollback plan
- Identify affected teams
</rules>

<template>
[Schema's built-in template]
</template>
```

- **上下文（Context）** 会出现在所有产物中
- **规则（Rules）** 只会出现在匹配的产物中

### Schema 解析顺序

当 OpenSpec 需要确定使用哪个 schema 时，会按以下顺序检查：

1. CLI 标志：`--schema <name>`
2. 变更元数据（变更文件夹中的 `.openspec.yaml`）
3. 项目配置（`rasen/config.yaml`）
4. 默认值（`spec-driven`）

---

## 自定义 Schema

当项目配置不够用时，可以创建自己的 schema，定义完全自定义的工作流。自定义 schema 位于项目的 `openspec/schemas/` 目录中，与代码一起进行版本控制。

```text
your-project/
├── openspec/
│   ├── config.yaml        # 项目配置
│   ├── schemas/           # 自定义 schema 存放位置
│   │   └── my-workflow/
│   │       ├── schema.yaml
│   │       └── templates/
│   └── changes/           # 你的变更
└── src/
```

### 从现有 Schema 派生

最快的自定义方式是从内置 schema 派生：

```bash
rasen schema fork spec-driven my-workflow
```

这会将整个 `spec-driven` schema 复制到 `openspec/schemas/my-workflow/`，你可以自由编辑。

**你将获得：**

```text
openspec/schemas/my-workflow/
├── schema.yaml           # 工作流定义
└── templates/
    ├── proposal.md       # proposal 产物的模板
    ├── spec.md           # specs 的模板
    ├── design.md         # design 的模板
    └── tasks.md          # tasks 的模板
```

然后编辑 `schema.yaml` 来修改工作流，或编辑模板来改变 AI 生成的内容。

### 从零创建 Schema

如果需要全新的工作流：

```bash
# 交互式
rasen schema init research-first

# 非交互式
rasen schema init rapid \
  --description "Rapid iteration workflow" \
  --artifacts "proposal,tasks" \
  --default
```

### Schema 结构

Schema 定义了工作流中的产物以及它们之间的依赖关系：

```yaml
# openspec/schemas/my-workflow/schema.yaml
name: my-workflow
version: 1
description: My team's custom workflow

artifacts:
  - id: proposal
    generates: proposal.md
    description: Initial proposal document
    template: proposal.md
    instruction: |
      Create a proposal that explains WHY this change is needed.
      Focus on the problem, not the solution.
    requires: []

  - id: design
    generates: design.md
    description: Technical design
    template: design.md
    instruction: |
      Create a design document explaining HOW to implement.
    requires:
      - proposal    # Can't create design until proposal exists

  - id: tasks
    generates: tasks.md
    description: Implementation checklist
    template: tasks.md
    requires:
      - design

apply:
  requires: [tasks]
  tracks: tasks.md
```

**关键字段：**

| 字段 | 用途 |
|------|------|
| `id` | 唯一标识符，用于命令和规则中 |
| `generates` | 输出文件名（支持 glob 模式，如 `specs/**/*.md`） |
| `template` | `templates/` 目录中的模板文件 |
| `instruction` | AI 创建此产物时的指令 |
| `requires` | 依赖项 - 哪些产物必须先存在 |

### 模板

模板是引导 AI 的 markdown 文件。在创建对应产物时，它们会被注入到提示词中。

```markdown
<!-- templates/proposal.md -->
## Why

<!-- Explain the motivation for this change. What problem does this solve? -->

## What Changes

<!-- Describe what will change. Be specific about new capabilities or modifications. -->

## Impact

<!-- Affected code, APIs, dependencies, systems -->
```

模板可以包含：
- AI 应填写的章节标题
- 为 AI 提供指导的 HTML 注释
- 展示预期结构的示例格式

### 验证你的 Schema

使用自定义 schema 之前，先进行验证：

```bash
rasen schema validate my-workflow
```

验证内容包括：
- `schema.yaml` 语法是否正确
- 所有引用的模板是否存在
- 是否存在循环依赖
- 产物 ID 是否有效

### 使用自定义 Schema

创建完成后，使用以下方式应用你的 schema：

```bash
# 在命令中指定
rasen new change feature --schema my-workflow

# 或在 config.yaml 中设为默认
schema: my-workflow
```

### 调试 Schema 解析

不确定当前使用的是哪个 schema？可以通过以下命令检查：

```bash
# 查看特定 schema 的来源
rasen schema which my-workflow

# 列出所有可用的 schema
rasen schema which --all
```

输出会显示它来自项目目录、用户目录还是安装包：

```text
Schema: my-workflow
Source: project
Path: /path/to/project/openspec/schemas/my-workflow
```

---

> **注意：** OpenSpec 还支持用户级别的 schema，位于 `~/.local/share/openspec/schemas/`，可以跨项目共享。但推荐使用项目级别的 schema（位于 `openspec/schemas/`），因为它们可以与代码一起进行版本控制。

---

## 示例

### 快速迭代工作流

一个用于快速迭代的最小化工作流：

```yaml
# openspec/schemas/rapid/schema.yaml
name: rapid
version: 1
description: Fast iteration with minimal overhead

artifacts:
  - id: proposal
    generates: proposal.md
    description: Quick proposal
    template: proposal.md
    instruction: |
      Create a brief proposal for this change.
      Focus on what and why, skip detailed specs.
    requires: []

  - id: tasks
    generates: tasks.md
    description: Implementation checklist
    template: tasks.md
    requires: [proposal]

apply:
  requires: [tasks]
  tracks: tasks.md
```

### 添加 Review 产物

从默认 schema 派生并添加审查步骤：

```bash
rasen schema fork spec-driven with-review
```

然后编辑 `schema.yaml` 添加：

```yaml
  - id: review
    generates: review.md
    description: Pre-implementation review checklist
    template: review.md
    instruction: |
      Create a review checklist based on the design.
      Include security, performance, and testing considerations.
    requires:
      - design

  - id: tasks
    # ... existing tasks config ...
    requires:
      - specs
      - design
      - review    # Now tasks require review too
```

---

## 社区 Schema

OpenSpec 还支持通过独立仓库分发的、由社区维护的 schema。它们提供开箱即用的工作流，把 OpenSpec 与其他工具或系统集成，其机制类似于 [github/spec-kit 的社区扩展目录](https://github.com/github/spec-kit/tree/main/extensions)之于 spec-kit。

社区 schema 并未被内置进 OpenSpec 核心——它们住在各自的仓库里，拥有各自的发布节奏。要使用其中一个，请把该 schema 包复制到你项目的 `openspec/schemas/<schema-name>/` 目录中（每个仓库的 README 里都有安装说明）。

| Schema | 维护者 | 仓库 | 说明 |
|--------|-----------|-----------|-------------|
| `superpowers-bridge` | @JiangWay | [JiangWay/openspec-schemas](https://github.com/JiangWay/openspec-schemas/tree/main/superpowers-bridge) | 将 OpenSpec 的产物治理与 [obra/superpowers](https://github.com/obra/superpowers) 的执行技能（头脑风暴、编写计划、通过子代理做 TDD、代码审查、收尾）集成在一起。新增了一个以证据为先的 `retrospective` 产物，填补了 Superpowers 原生未覆盖的空白。 |

> 想贡献一个社区 schema？开一个带仓库链接的 issue，或提交一个 PR 在这张表里添加一行。

---

## 另请参阅

- [CLI 参考：Schema 命令](cli.md#schema-命令) - 完整的命令文档
