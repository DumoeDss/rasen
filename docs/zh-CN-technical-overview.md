# OpenSpec 技术文档

> 版本：1.2.0 | 许可证：MIT | 仓库：https://github.com/Fission-AI/OpenSpec

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 核心概念](#2-核心概念)
- [3. 系统架构](#3-系统架构)
- [4. CLI 命令体系](#4-cli-命令体系)
- [5. 核心模块详解](#5-核心模块详解)
- [6. 关键数据结构](#6-关键数据结构)
- [7. 设计模式与架构决策](#7-设计模式与架构决策)
- [8. 工具与基础设施](#8-工具与基础设施)
- [9. 开发指南](#9-开发指南)

---

## 1. 项目概述

### 1.1 项目定位

OpenSpec 是一个 **AI 原生的规范驱动开发系统**。它是一个 Node.js CLI 工具，帮助团队和个人在编码之前对齐规范（Specification），使 AI 编码助手的行为更加可预测和高效。

核心工作流程：

```
提出变更（Propose） → 编写规范（Spec） → 应用实现（Apply） → 归档变更（Archive）
```

OpenSpec 充当开发者与 AI 助手之间的桥梁，通过结构化的规范来引导 AI 的编码行为。

### 1.2 核心理念

| 理念 | 说明 |
|------|------|
| **流动而非僵化** (Fluid not rigid) | 无阶段门禁，自然地在各阶段之间流动 |
| **迭代而非瀑布** (Iterative not waterfall) | 支持反复修订和增量演进 |
| **简单而非复杂** (Easy not complex) | 最小化配置和仪式感，快速上手 |
| **棕地优先** (Brownfield-first) | 专为已有代码库设计，而不仅仅是全新项目 |
| **可扩展** | 从个人项目到企业级团队均适用 |

### 1.3 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | 5.9+ | 主要开发语言 |
| **Node.js** | ≥20.19.0 | 运行时环境 |
| **Commander.js** | 14.x | CLI 框架 |
| **Zod** | 4.x | 运行时类型验证 |
| **YAML** | 2.8+ | 配置文件解析 |
| **Inquirer** | 7.8+ / 10.2+ | 交互式终端提示 |
| **Chalk** | 5.5+ | 终端颜色输出 |
| **Ora** | 8.2+ | 终端加载动画 |
| **fast-glob** | 3.3+ | 文件模式匹配 |
| **PostHog** | 5.20+ | 匿名遥测数据 |
| **Vitest** | 3.2+ | 测试框架 |
| **pnpm** | 9.x | 包管理器 |

### 1.4 项目仓库结构

```
OpenSpec/
├── bin/                     # CLI 可执行入口
│   └── openspec.js          # 启动脚本，导入 dist/cli/index.js
├── src/                     # 源代码（约 130 个 TypeScript 文件）
│   ├── cli/                 # CLI 设置与命令注册
│   ├── commands/            # 用户可见的命令实现
│   ├── core/                # 核心业务逻辑
│   ├── prompts/             # 自定义交互提示组件
│   ├── telemetry/           # 遥测数据收集
│   ├── ui/                  # 终端 UI 组件
│   └── utils/               # 通用工具函数
├── schemas/                 # 工作流模式定义（YAML）
│   └── spec-driven/         # 默认工作流模式
│       ├── schema.yaml      # 模式定义
│       └── templates/       # Artifact 模板（Markdown）
├── docs/                    # 用户文档
├── test/                    # 测试套件
│   ├── cli-e2e/             # 端到端测试
│   ├── commands/            # 命令测试
│   ├── core/                # 核心逻辑测试
│   ├── fixtures/            # 测试固件
│   └── helpers/             # 测试辅助工具
├── openspec/                # 项目自身的 OpenSpec 规范（自举使用）
│   ├── changes/             # 活跃的变更提案
│   ├── specs/               # 共享规范
│   └── explorations/        # 研究和探索文档
├── .github/workflows/       # GitHub Actions CI/CD
├── .changeset/              # Changesets 版本管理
├── scripts/                 # 构建和辅助脚本
├── package.json             # 项目清单
├── tsconfig.json            # TypeScript 配置
├── vitest.config.ts         # 测试框架配置
├── build.js                 # 自定义构建脚本
├── eslint.config.js         # ESLint 配置
└── flake.nix                # Nix 开发环境定义
```

---

## 2. 核心概念

### 2.1 Spec（规范）

Spec 是对系统行为的正式描述。每个 Spec 存放在 `openspec/specs/<domain>/spec.md` 中，包含以下结构：

```markdown
## Purpose
[描述该规范的目的，最少 50 个字符]

## Requirements

### Requirement: 需求名称
系统 SHALL [具体行为描述]

#### Scenario: 场景名称
- **WHEN** 某个操作发生
- **THEN** 系统产生某个结果
```

**关键规则**：
- Purpose 部分最少 50 个字符
- 每个 Requirement 必须包含 `SHALL` 或 `MUST` 关键词
- 每个 Requirement 必须至少有一个 Scenario
- Scenario 必须使用四级标题 (`####`)

### 2.2 Change（变更）

Change 是一个变更提案，描述为什么要做变更以及变更了什么。存放在 `openspec/changes/<change-name>/` 目录中：

```markdown
## Why
[为什么需要这个变更，50-1000 字符]

## What Changes
[变更概述]
```

每个 Change 包含一个 `specs/` 子目录，存放 Delta Spec 文件。

### 2.3 Delta（变更操作）

Delta 描述对现有 Spec 的具体修改操作，支持四种类型：

| 操作 | 含义 | 用法 |
|------|------|------|
| `ADDED` | 新增需求 | 引入全新的功能需求 |
| `MODIFIED` | 修改需求 | 变更现有需求的行为 |
| `REMOVED` | 删除需求 | 废弃某个功能需求 |
| `RENAMED` | 重命名需求 | 仅改变需求名称 |

Delta Spec 文件使用二级标题标记操作类型：

```markdown
## ADDED Requirements
### Requirement: 新功能
系统 SHALL ...

## MODIFIED Requirements
### Requirement: 已有功能（更新版）
系统 SHALL ...

## REMOVED Requirements
### Requirement: 废弃功能
**Reason**: 被新系统替代
**Migration**: 使用新的 API 端点

## RENAMED Requirements
### 旧名称 → 新名称
```

### 2.4 Artifact（工件）

Artifact 是工作流中的一个产出物，代表一个需要创建的文件。Artifact 之间存在依赖关系，形成有向无环图（DAG）。

每个 Artifact 包含：
- **id**: 唯一标识符（如 `proposal`、`specs`、`design`、`tasks`）
- **generates**: 生成的文件名或模式（如 `proposal.md`、`specs/**/*.md`）
- **description**: 描述该工件的用途
- **template**: 关联的模板文件路径
- **instruction**: 创建该工件的详细指导（可选）
- **requires**: 依赖的其他 Artifact ID 列表

### 2.5 Schema（工作流模式）

Schema 定义了一组 Artifact 及其依赖关系，描述完整的工作流。默认的 `spec-driven` 模式定义如下：

```
proposal → specs → design → tasks → apply
                ↘           ↗
                  design ──┘
```

具体依赖关系：
- `proposal`：无依赖，工作流起点
- `specs`：依赖 `proposal`
- `design`：依赖 `proposal`
- `tasks`：依赖 `specs` 和 `design`
- `apply`（应用阶段）：依赖 `tasks`

Schema 通过 YAML 文件定义（`schemas/spec-driven/schema.yaml`），包含 `name`、`version`、`description`、`artifacts` 数组和可选的 `apply` 阶段配置。

### 2.6 Profile（配置档）

Profile 控制安装哪些工作流命令：

| Profile | 包含的工作流 | 适用场景 |
|---------|-------------|---------|
| **core**（默认） | propose, explore, apply, archive | 新用户，精简体验 |
| **custom** | 最多 11 个工作流 | 高级用户，完整功能 |

所有可用的工作流：`propose`、`explore`、`new`、`continue`、`apply`、`ff`、`sync`、`archive`、`bulk-archive`、`verify`、`onboard`。

### 2.7 Delivery（交付方式）

Delivery 控制工作流命令如何安装到 AI 工具中：

| 方式 | 说明 |
|------|------|
| `skills` | 以技能文件形式安装（如 `.claude/skills/`） |
| `commands` | 以命令文件形式安装（如 `.opsx/commands/`） |
| `both`（默认） | 同时安装两种形式 |

---

## 3. 系统架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────┐
│                  CLI 层 (cli/)                   │
│          Commander.js 命令注册与路由              │
├─────────────────────────────────────────────────┤
│                命令层 (commands/)                 │
│    change | spec | validate | show | workflow    │
│    schema | config | completion | feedback       │
├─────────────────────────────────────────────────┤
│                核心层 (core/)                     │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ parsers/  │ │ schemas/ │ │  validation/   │  │
│  │ Markdown  │ │   Zod    │ │   Validator    │  │
│  │  解析器   │ │  数据模型 │ │   验证引擎    │  │
│  └───────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────────────┐ ┌──────────────────────┐  │
│  │ artifact-graph/  │ │ command-generation/  │  │
│  │  工件图依赖解析  │ │  AI 工具命令生成    │  │
│  └──────────────────┘ └──────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ archive  │ │ profiles │ │  completions/  │  │
│  │ 归档管理 │ │ 配置档   │ │  Shell 补全   │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────────────────────────────────────┐   │
│  │  config / global-config / project-config │   │
│  │          配置管理系统                     │   │
│  └──────────────────────────────────────────┘   │
├─────────────────────────────────────────────────┤
│              工具层 (utils/)                      │
│  file-system | item-discovery | change-utils    │
│  match | interactive | task-progress            │
├─────────────────────────────────────────────────┤
│          基础设施层                               │
│  telemetry/ | ui/ | prompts/                    │
└─────────────────────────────────────────────────┘
```

### 3.2 各层职责

| 层级 | 目录 | 职责 |
|------|------|------|
| **CLI 层** | `src/cli/` | 使用 Commander.js 注册所有命令、解析参数、设置全局选项（如 `--no-color`）、挂接前后处理钩子（遥测追踪） |
| **命令层** | `src/commands/` | 实现用户可见的 CLI 命令，每个命令封装为独立类或注册函数，处理参数验证和输出格式化 |
| **核心层** | `src/core/` | 核心业务逻辑，包含数据解析、验证、工件管理、命令生成、归档、配置等 |
| **工具层** | `src/utils/` | 通用辅助函数，如文件系统操作、项目内容发现、变更元数据管理等 |
| **基础设施层** | `src/telemetry/` `src/ui/` `src/prompts/` | 遥测收集、终端 UI 组件、自定义交互提示 |

### 3.3 数据处理流程

```
Markdown 文件 (spec.md / proposal.md)
        │
        ▼
┌───────────────────┐
│  Parsers 解析层   │  markdown-parser.ts / change-parser.ts
│  提取结构化段落   │  requirement-blocks.ts
└───────┬───────────┘
        │ 原始对象
        ▼
┌───────────────────┐
│  Zod Schema 验证  │  spec.schema.ts / change.schema.ts
│  类型安全校验     │  base.schema.ts
└───────┬───────────┘
        │ 类型化对象 (Spec / Change / Delta)
        ▼
┌───────────────────┐
│  Validator 规则   │  validator.ts + constants.ts
│  业务规则检查     │  (长度、关键词、格式等)
└───────┬───────────┘
        │ ValidationReport
        ▼
┌───────────────────┐
│  输出 / 处理      │  展示、归档、JSON 导出
└───────────────────┘
```

### 3.4 Artifact 工作流数据流

```
Schema YAML ──→ SchemaYamlSchema (Zod 验证)
                      │
                      ▼
              ArtifactGraph 构建
              (解析依赖关系)
                      │
                      ▼
              状态检测 (state.ts)
              (文件系统检查完成状态)
                      │
                      ▼
              指令加载 (instruction-loader.ts)
              (模板 + 上下文 + 规则注入)
                      │
                      ▼
              输出给 AI 工具执行
```

---

## 4. CLI 命令体系

### 4.1 命令总览

| 分类 | 命令 | 说明 |
|------|------|------|
| **设置** | `init [path]` | 初始化 OpenSpec 项目 |
| | `update [path]` | 更新指令文件 |
| **浏览** | `list` | 列出变更或规范 |
| | `view` | 交互式仪表板 |
| | `show [item]` | 显示变更或规范内容 |
| **验证** | `validate [item]` | 验证变更和规范 |
| **生命周期** | `archive [change]` | 归档已完成的变更 |
| | `new change <name>` | 创建新的变更目录 |
| **工作流** | `status` | 显示 Artifact 完成状态 |
| | `instructions [artifact]` | 输出工件创建指令 |
| | `templates` | 显示模板路径 |
| | `schemas` | 列出可用工作流模式 |
| **配置** | `config` | 查看/修改设置 |
| **模式管理** | `schema init/fork/validate/which` | 管理工作流模式 |
| **工具** | `completion install/generate/uninstall` | Shell 补全 |
| | `feedback <message>` | 提交反馈 |

### 4.2 全局选项

| 选项 | 说明 |
|------|------|
| `--version, -V` | 显示版本号 |
| `--no-color` | 禁用颜色输出 |
| `--help, -h` | 显示帮助信息 |

### 4.3 关键命令详解

#### `init`

初始化项目的 OpenSpec 配置。选项包括：
- `--tools <tools>`: 非交互式指定 AI 工具（如 `claude,cursor`，或 `all`/`none`）
- `--force`: 自动清理遗留文件
- `--profile <profile>`: 覆盖全局配置档（`core` 或 `custom`）

初始化过程会：
1. 创建 `openspec/` 目录结构
2. 根据选择的 AI 工具生成技能文件和命令文件
3. 应用 Profile 配置
4. 清理遗留文件（如果存在）

#### `validate`

验证变更和规范的格式正确性。选项包括：
- `--all`: 验证所有变更和规范
- `--changes` / `--specs`: 分别验证
- `--strict`: 启用严格验证模式
- `--json`: JSON 格式输出（适合程序化使用）
- `--concurrency <n>`: 并发验证数量

#### `archive`

归档已完成的变更并更新主规范。选项包括：
- `-y, --yes`: 跳过确认提示
- `--skip-specs`: 跳过规范更新操作
- `--no-validate`: 跳过验证（不推荐）

归档流程：验证变更 → 查找规范更新 → 应用 Delta 操作 → 移动到归档目录。

#### `status`

显示 Artifact 的完成状态，基于文件系统检测哪些工件已创建。

#### `instructions`

输出经过丰富化处理的工件创建指令，注入项目上下文和规则信息。特殊参数 `apply` 会输出 Apply 阶段的指令。

### 4.4 斜杠命令（AI 工作流）

OpenSpec 为 AI 工具生成斜杠命令（Slash Commands），核心工作流为：

```
/opsx:propose  ──→  创建变更提案
      │
      ▼
/opsx:explore  ──→  探索和研究（可选）
      │
      ▼
   [编写规范、设计、任务]
      │
      ▼
/opsx:apply    ──→  根据任务实施代码变更
      │
      ▼
/opsx:archive  ──→  归档变更，更新主规范
```

---

## 5. 核心模块详解

### 5.1 CLI 入口

**文件**: `src/cli/index.ts`

CLI 入口使用 Commander.js 构建，负责：

1. **创建根程序**: `new Command().name('openspec')`
2. **注册全局选项**: `--no-color`
3. **设置前后钩子**:
   - `preAction`: 处理颜色禁用、显示遥测通知、追踪命令执行
   - `postAction`: 关闭遥测连接
4. **注册所有命令**: 通过导入各命令模块并调用其注册函数
5. **调用 `program.parse()`**: 启动命令解析

命令注册采用两种模式：
- **类实例化**: 如 `new ArchiveCommand()`、`new ListCommand()`
- **注册函数**: 如 `registerSpecCommand(program)`、`registerConfigCommand(program)`

### 5.2 命令层

**目录**: `src/commands/`

| 文件 | 类/函数 | 职责 |
|------|---------|------|
| `change.ts` | `ChangeCommand` | 变更的 show/list/validate 操作（已弃用，推荐使用顶层命令） |
| `spec.ts` | `registerSpecCommand()` | 规范查看和操作 |
| `validate.ts` | `ValidateCommand` | 批量验证变更和规范 |
| `show.ts` | `ShowCommand` | 统一的 show 命令，自动检测项目类型 |
| `config.ts` | `registerConfigCommand()` | 配置管理子命令 |
| `schema.ts` | `registerSchemaCommand()` | 模式管理子命令 |
| `completion.ts` | `CompletionCommand` | Shell 补全的生成、安装、卸载 |
| `feedback.ts` | `FeedbackCommand` | 用户反馈提交 |
| `workflow/index.ts` | 多个导出函数 | 工作流命令（status, instructions, templates, schemas, new change） |

### 5.3 数据解析器

**目录**: `src/core/parsers/`

#### Markdown 解析器 (`markdown-parser.ts`)

负责将 `spec.md` 文件解析为结构化的 `Spec` 对象：

1. 标准化换行符
2. 按 Markdown 标题分割为段落
3. 构建层级段落树
4. 提取 `## Purpose` → `overview` 字段
5. 提取 `## Requirements` → 解析各个需求和场景
6. 使用 `SpecSchema` 进行 Zod 验证

#### Change 解析器 (`change-parser.ts`)

负责解析变更提案文档：

1. 提取 `## Why` → `why` 字段
2. 提取 `## What Changes` → `whatChanges` 字段
3. 从 `specs/` 子目录加载 Delta Spec 文件
4. 使用 `ChangeSchema` 进行验证

#### 需求块解析器 (`requirement-blocks.ts`)

负责解析 Delta Spec 中的具体需求操作：

1. 识别 `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` 段落
2. 提取每个需求的详细内容
3. 处理重命名语法（`旧名称 → 新名称`）

### 5.4 数据验证

**目录**: `src/core/validation/` + `src/core/schemas/`

#### Zod Schema 定义

Schema 定义在 `src/core/schemas/` 中，采用分层结构：

- **`base.schema.ts`**: 基础类型
  - `ScenarioSchema`: `{ rawText: string }` (最少 1 字符)
  - `RequirementSchema`: `{ text: string, scenarios: Scenario[] }` (text 须含 SHALL/MUST, scenarios ≥ 1)

- **`spec.schema.ts`**: 规范类型
  - `SpecSchema`: `{ name, overview, requirements[], metadata? }`

- **`change.schema.ts`**: 变更类型
  - `DeltaOperationType`: `'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'`
  - `DeltaSchema`: `{ spec, operation, description, requirement?, requirements?, rename? }`
  - `ChangeSchema`: `{ name, why, whatChanges, deltas[], metadata? }`

#### 验证约束常量

定义在 `src/core/validation/constants.ts`：

| 常量 | 值 | 说明 |
|------|-----|------|
| `MIN_WHY_SECTION_LENGTH` | 50 | Why 部分最小字符数 |
| `MAX_WHY_SECTION_LENGTH` | 1000 | Why 部分最大字符数 |
| `MIN_PURPOSE_LENGTH` | 50 | Purpose 部分最小字符数 |
| `MAX_REQUIREMENT_TEXT_LENGTH` | 500 | 需求文本最大字符数 |
| `MAX_DELTAS_PER_CHANGE` | 10 | 每个变更最大 Delta 数量 |

#### 验证管道

验证器 (`src/core/validation/validator.ts`) 采用三阶段管道：

```
1. Zod safeParse()     → 结构性验证（必填字段、类型）
        │
        ▼
2. 自定义规则检查      → 业务规则（SHA LL/MUST 关键词、长度限制等）
        │
        ▼
3. 增强错误消息        → 添加修复指导（包含示例代码片段）
```

验证结果为 `ValidationReport`：
```typescript
{
  valid: boolean;
  issues: ValidationIssue[];  // 每个含 level, path, message
  summary: { errors: number; warnings: number; info: number; }
}
```

### 5.5 Artifact Graph 系统

**目录**: `src/core/artifact-graph/`

Artifact Graph 是 OpenSpec 的工件依赖管理系统，核心功能包括：

#### 图数据结构 (`graph.ts`)

`ArtifactGraph` 类管理工件之间的依赖关系：
- 从 Schema YAML 构建有向无环图
- 追踪每个工件的完成状态
- 计算被阻塞的工件（依赖未完成的工件）

#### Schema 解析 (`schema.ts`)

使用 Zod 验证 Schema YAML 文件的合法性：
- 验证所有工件 ID 非空
- 确保依赖引用指向存在的工件
- 检测循环依赖

#### 依赖解析 (`resolver.ts`)

解析 Schema 的位置和加载：
- 支持内置 Schema（`schemas/` 目录）
- 支持项目级 Schema（`openspec/schemas/` 目录）
- 支持全局 Schema（`~/.local/share/openspec/schemas/`）

#### 状态检测 (`state.ts`)

通过文件系统检测工件完成状态：
- 检查变更目录中是否存在对应文件
- 返回已完成工件的 Set 集合
- 计算哪些工件被阻塞及其阻塞原因

#### 指令加载 (`instruction-loader.ts`)

生成丰富化的工件创建指令：
- 加载工件的模板文件
- 注入项目上下文（来自 `openspec/config.yaml` 的 `context` 字段）
- 注入工件规则（来自 `config.yaml` 的 `rules` 字段）
- 包含依赖工件的状态信息

### 5.6 AI 工具集成

**目录**: `src/core/command-generation/`

OpenSpec 通过适配器模式支持 25 个 AI 工具的集成。

#### 适配器接口

```typescript
interface ToolCommandAdapter {
  toolId: string;
  getFilePath(commandId: string): string;    // 返回命令文件路径
  formatFile(content: CommandContent): string; // 格式化文件内容
}
```

每个适配器需要实现两个方法：
- `getFilePath()`: 根据工具约定返回文件路径（如 `.claude/commands/opsx/explore.md`）
- `formatFile()`: 根据工具的 frontmatter 格式要求格式化文件内容

#### 命令内容

```typescript
interface CommandContent {
  id: string;          // 命令标识（如 'explore'）
  name: string;        // 显示名称（如 'OpenSpec Explore'）
  description: string; // 简要描述
  category: string;    // 分类（如 'Workflow'）
  tags: string[];      // 标签数组
  body: string;        // 命令指令内容
}
```

#### 支持的 AI 工具

| 工具 | 工具 ID | 技能目录 |
|------|---------|---------|
| Claude Code | `claude` | `.claude` |
| Cursor | `cursor` | `.cursor` |
| Cline | `cline` | `.cline` |
| GitHub Copilot | `github-copilot` | `.github` |
| Windsurf | `windsurf` | `.windsurf` |
| Gemini CLI | `gemini` | `.gemini` |
| Kiro | `kiro` | `.kiro` |
| Amazon Q Developer | `amazon-q` | `.amazonq` |
| Continue | `continue` | `.continue` |
| Codex | `codex` | `.codex` |
| OpenCode | `opencode` | `.opencode` |
| RooCode | `roocode` | `.roo` |
| Trae | `trae` | `.trae` |
| Kilo Code | `kilocode` | `.kilocode` |
| Qwen Code | `qwen` | `.qwen` |
| 以及更多... | | |

#### 工厂与注册表

- **`registry.ts`**: 维护所有已注册适配器的列表
- **`factory.ts`**: 根据工具 ID 创建对应的适配器实例
- **`generator.ts`**: 使用适配器批量生成命令文件

### 5.7 配置系统

OpenSpec 采用三级配置架构：

#### 全局配置

**文件位置**:
- Unix/macOS: `~/.config/openspec/config.json`（或 `$XDG_CONFIG_HOME/openspec/config.json`）
- Windows: `%APPDATA%/openspec/config.json`

**结构**:
```typescript
interface GlobalConfig {
  featureFlags?: Record<string, boolean>;  // 功能开关
  profile?: 'core' | 'custom';            // 配置档
  delivery?: 'both' | 'skills' | 'commands'; // 交付方式
  workflows?: string[];                    // 自定义工作流列表
}
```

**默认值**:
```json
{
  "featureFlags": {},
  "profile": "core",
  "delivery": "both"
}
```

全局配置遵循 XDG Base Directory 规范，支持 `$XDG_CONFIG_HOME` 和 `$XDG_DATA_HOME` 环境变量。

#### 项目配置

**文件位置**: `openspec/config.yaml`（支持 `.yml` 扩展名）

**结构**:
```yaml
schema: spec-driven           # 使用的工作流模式
context: |                     # 项目上下文（注入到所有工件指令中）
  技术栈：TypeScript, Node.js
  测试框架：Vitest
  编码规范：...
rules:                         # 工件级别规则
  proposal:
    - 必须说明业务影响
  specs:
    - 场景必须使用 WHEN/THEN 格式
```

**约束**:
- `context` 字段最大 50KB
- `rules` 中的 Artifact ID 会与 Schema 中的实际 ID 进行校验
- 使用弹性解析（resilient parsing），单个字段无效不影响其他字段

#### 配置优先级

```
项目配置 (openspec/config.yaml)  >  全局配置 (~/.config/openspec/config.json)  >  默认值
```

### 5.8 归档系统

**文件**: `src/core/archive.ts` + `src/core/specs-apply.ts`

归档是 OpenSpec 变更生命周期的最后一步。

#### 归档流程

```
1. 查找活跃变更（交互选择或命令行指定）
        │
        ▼
2. 验证变更文档（可通过 --no-validate 跳过）
        │
        ▼
3. 查找规范更新 (findSpecUpdates)
   扫描 changes/<name>/specs/ 目录中的 Delta Spec 文件
        │
        ▼
4. 构建更新后的规范 (buildUpdatedSpec)
   对每个 Delta 执行对应操作：
   - ADDED: 追加新需求
   - MODIFIED: 替换匹配的需求
   - REMOVED: 删除匹配的需求
   - RENAMED: 重命名匹配的需求
        │
        ▼
5. 写入更新后的规范到 openspec/specs/
        │
        ▼
6. 移动变更目录到 openspec/changes/archive/<date>-<name>/
```

#### Delta 应用算法 (`specs-apply.ts`)

`buildUpdatedSpec()` 函数处理每种 Delta 操作类型：

1. 读取现有主规范文件
2. 解析为结构化 Spec 对象
3. 对每个 Delta Requirement：
   - **ADDED**: 在 Requirements 列表末尾追加
   - **MODIFIED**: 找到名称匹配的需求并替换其全部内容
   - **REMOVED**: 找到名称匹配的需求并移除
   - **RENAMED**: 找到名称匹配的需求并更新名称
4. 重新生成 Markdown 并写入文件

### 5.9 模板与工作流

**目录**: `src/core/templates/` + `src/core/profiles.ts`

#### 工作流模板

每个 Artifact 关联一个 Markdown 模板文件，存放在 `schemas/<schema-name>/templates/` 中。默认的 `spec-driven` 模式包含：
- `proposal.md` — 变更提案模板
- `spec.md` — 规范文件模板
- `design.md` — 技术设计文档模板
- `tasks.md` — 任务清单模板

#### Profile 系统 (`profiles.ts`)

```typescript
const CORE_WORKFLOWS = ['propose', 'explore', 'apply', 'archive'];

const ALL_WORKFLOWS = [
  'propose', 'explore', 'new', 'continue', 'apply',
  'ff', 'sync', 'archive', 'bulk-archive', 'verify', 'onboard'
];
```

`getProfileWorkflows(profile, customWorkflows)` 函数根据配置档返回对应的工作流列表：
- `core` → 始终返回 `CORE_WORKFLOWS`
- `custom` → 返回用户自定义的工作流列表

### 5.10 Shell 补全系统

**目录**: `src/core/completions/`

```
completions/
├── generators/         # 各 Shell 的补全脚本生成器
│   ├── bash.ts
│   ├── zsh.ts
│   ├── fish.ts
│   └── powershell.ts
├── installers/         # 各 Shell 的补全脚本安装器
└── templates/          # 补全脚本模板
```

支持的 Shell：**Bash**、**Zsh**、**Fish**、**PowerShell**。

补全功能包括：
- 子命令补全
- 选项和标志补全
- 项目中变更/规范名称的动态补全

---

## 6. 关键数据结构

### 6.1 类型定义一览

```typescript
// ─── 基础类型 (base.schema.ts) ───

type Scenario = {
  rawText: string;              // 场景描述文本
};

type Requirement = {
  text: string;                 // 需求文本（须含 SHALL 或 MUST）
  scenarios: Scenario[];        // 至少一个场景
};

// ─── 规范类型 (spec.schema.ts) ───

type Spec = {
  name: string;                 // 规范名称
  overview: string;             // Purpose 部分内容
  requirements: Requirement[];  // 需求列表
  metadata?: {
    version: string;            // 默认 "1.0.0"
    format: 'openspec';
    sourcePath?: string;
  };
};

// ─── 变更类型 (change.schema.ts) ───

type DeltaOperation = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';

type Delta = {
  spec: string;                 // 目标规范名称
  operation: DeltaOperation;    // 操作类型
  description: string;          // 操作描述
  requirement?: Requirement;    // 单个需求操作
  requirements?: Requirement[]; // 多个需求操作
  rename?: {                    // 重命名信息
    from: string;
    to: string;
  };
};

type Change = {
  name: string;                 // 变更名称
  why: string;                  // 原因（50-1000 字符）
  whatChanges: string;          // 变更概述
  deltas: Delta[];              // Delta 列表（1-10 个）
  metadata?: {
    version: string;
    format: 'openspec-change';
    sourcePath?: string;
  };
};

// ─── Artifact 类型 (artifact-graph/types.ts) ───

type Artifact = {
  id: string;                   // 工件 ID
  generates: string;            // 生成的文件名/模式
  description: string;          // 描述
  template: string;             // 模板文件路径
  instruction?: string;         // 创建指导
  requires: string[];           // 依赖的工件 ID
};

type ApplyPhase = {
  requires: string[];           // 前置工件 ID
  tracks?: string | null;       // 进度追踪文件路径
  instruction?: string;         // Apply 阶段指导
};

type SchemaYaml = {
  name: string;                 // 模式名称
  version: number;              // 版本号（正整数）
  description?: string;         // 描述
  artifacts: Artifact[];        // 工件列表
  apply?: ApplyPhase;           // Apply 阶段配置
};

type ChangeMetadata = {
  schema: string;               // 工作流模式名称
  created?: string;             // 创建日期（YYYY-MM-DD）
};

// ─── 命令生成类型 (command-generation/types.ts) ───

interface CommandContent = {
  id: string;                   // 命令 ID
  name: string;                 // 显示名称
  description: string;          // 描述
  category: string;             // 分类
  tags: string[];               // 标签
  body: string;                 // 指令内容
};

interface ToolCommandAdapter = {
  toolId: string;
  getFilePath(commandId: string): string;
  formatFile(content: CommandContent): string;
};

interface GeneratedCommand = {
  path: string;                 // 文件路径
  fileContent: string;          // 文件内容
};

// ─── 配置类型 ───

type Profile = 'core' | 'custom';
type Delivery = 'both' | 'skills' | 'commands';

interface GlobalConfig = {
  featureFlags?: Record<string, boolean>;
  profile?: Profile;
  delivery?: Delivery;
  workflows?: string[];
};

type ProjectConfig = {
  schema: string;               // 工作流模式名称
  context?: string;             // 项目上下文（最大 50KB）
  rules?: Record<string, string[]>; // 工件级规则
};
```

---

## 7. 设计模式与架构决策

### 7.1 适配器模式（AI 工具集成）

**问题**: 需要支持 25+ 个 AI 工具，每个工具的文件路径约定和 frontmatter 格式不同。

**方案**: `ToolCommandAdapter` 接口统一抽象，每个工具实现自己的适配器。

```
CommandContent (工具无关数据)
        │
        ▼
ToolCommandAdapter.formatFile()
        │
  ┌─────┼─────┬──────┬──────┐
  ▼     ▼     ▼      ▼      ▼
Claude Cursor Cline Gemini  ...
```

**优势**:
- 新增工具只需添加一个适配器文件
- 命令内容与工具格式完全解耦
- 工厂模式 (`factory.ts`) 根据工具 ID 自动选择适配器

### 7.2 图模式（Artifact 依赖解析）

**问题**: 工件之间存在依赖关系，需要正确的执行顺序。

**方案**: 使用有向无环图（DAG）建模工件依赖。

```
proposal (无依赖)
    ├──→ specs (依赖 proposal)
    └──→ design (依赖 proposal)
              ├──→ tasks (依赖 specs + design)
              └──→      └──→ apply (依赖 tasks)
```

**优势**:
- 自动计算执行顺序
- 清晰可视化阻塞状态
- Schema 验证防止循环依赖

### 7.3 解析器模式（Markdown → 结构化数据）

**问题**: 需要从自由格式的 Markdown 中提取结构化数据。

**方案**: 分层解析器：
1. 段落分割器（按标题级别）
2. 段落类型识别器（Purpose / Requirements / Why / What Changes）
3. 内容提取器（需求、场景、Delta 操作）

### 7.4 验证管道模式

**问题**: 验证需要多个层次——结构、类型、业务规则。

**方案**: 三阶段验证管道：
1. **Zod Schema**: 结构和类型验证
2. **自定义规则**: 业务逻辑验证（关键词、长度等）
3. **增强消息**: 附加修复指导和示例

**优势**:
- 类型安全（Zod 推导 TypeScript 类型）
- 用户友好的错误消息
- 可组合的验证规则

### 7.5 配置分层模式

**问题**: 需要支持全局默认值、用户偏好和项目级覆盖。

**方案**: 三级配置合并：

```
默认值  ←──  全局配置 (~/.config)  ←──  项目配置 (openspec/config.yaml)
```

**关键设计决策**:
- 全局配置使用 JSON（简单性）
- 项目配置使用 YAML（可读性，支持多行文本）
- 弹性解析（单个字段无效不影响整体）
- 不使用缓存（性能足够，避免一致性问题）

---

## 8. 工具与基础设施

### 8.1 构建系统

**构建工具**: TypeScript 编译器 + 自定义 `build.js` 脚本

**TypeScript 配置** (`tsconfig.json`):
- 目标: ES2022
- 模块系统: NodeNext (ESM)
- 严格模式: 启用
- 源码映射: 启用
- 声明映射: 启用
- 输出目录: `dist/`

**构建命令**:
```bash
pnpm build          # 编译 TypeScript
pnpm dev            # 监听模式编译
pnpm dev:cli        # 编译 + 运行 CLI
```

### 8.2 测试框架

**框架**: Vitest 3.2+

**配置** (`vitest.config.ts`):
- 全局模式 (globals)
- Fork 池隔离（最大 4 个 worker）
- 测试超时: 10 秒
- 覆盖率报告器: text, json, html

**测试组织**:
```
test/
├── cli-e2e/          # 端到端测试（通过 execSync 调用 CLI 进程）
├── commands/         # 命令单元测试
├── core/             # 核心逻辑单元测试
│   ├── artifact-graph/    # 图系统测试
│   ├── command-generation/ # 适配器测试
│   └── ...
├── fixtures/         # 测试固件（临时目录结构）
└── helpers/
    └── run-cli.ts    # CLI 测试辅助函数
```

**测试模式**:
- `vi.mock()` 模拟外部依赖
- `vi.hoisted()` 提升模拟定义
- 临时目录用于文件系统测试
- 正面和负面测试用例
- `runCLI()` 辅助函数用于 E2E 测试

**测试命令**:
```bash
pnpm test              # 运行所有测试
pnpm test:watch        # 监听模式
pnpm test:ui           # Vitest UI 界面
pnpm test:coverage     # 覆盖率报告
```

### 8.3 CI/CD

**平台**: GitHub Actions

**主工作流** (`ci.yml`):
- 触发条件: PR、推送到 main、手动触发
- 作业:
  - `test_pr`: PR 上运行测试（10 分钟超时）
  - `test_matrix`: 多 Node.js 版本矩阵测试
  - `test_nix`: Nix 环境测试（仅 flake 文件变更时）
  - `release_draft`: main 分支上草拟发布
- 并发限制: 每个 ref 仅 1 个（自动取消旧运行）

**发布工作流** (`release-prepare.yml`):
- 自动化发布准备
- Changesets 集成

### 8.4 版本管理

**工具**: Changesets

**工作流程**:
1. 开发者本地运行 `pnpm changeset`，描述变更
2. CI 自动创建 "Version Packages" PR
3. 合并 PR 触发 npm 发布 + GitHub Release
4. 贡献者无需手动版本化或发布

**变更类别**: New Features / Bug Fixes / Breaking Changes / Deprecations / Other

### 8.5 遥测系统

**目录**: `src/telemetry/`

**提供者**: PostHog (posthog-node)

**收集内容**: 仅命令名称和版本号

**隐私保护**:
- 不收集任何参数、路径、文件内容或个人信息
- CI 环境自动禁用
- 首次运行时显示遥测通知
- 退出方式: 设置 `OPENSPEC_TELEMETRY=0` 或 `DO_NOT_TRACK=1`

**实现**:
- `trackCommand(commandPath, version)`: 记录命令执行
- `maybeShowTelemetryNotice()`: 首次运行通知
- `shutdown()`: 清理连接

### 8.6 ESLint 配置

**关键规则**:
- TypeScript 严格模式
- **禁止静态导入 `@inquirer` 模块**（会导致 pre-commit 挂起）— 必须使用动态 `import()`
- 例外: `src/core/init.ts`（已知需要动态加载）

---

## 9. 开发指南

### 9.1 环境搭建

**前置要求**:
- Node.js ≥ 20.19.0
- pnpm 9.x

**安装步骤**:
```bash
# 克隆仓库
git clone https://github.com/Fission-AI/OpenSpec.git
cd OpenSpec

# 安装依赖
pnpm install

# 构建项目
pnpm build

# 验证安装
node bin/openspec.js --version
```

**可选: Nix 开发环境**:
```bash
nix develop   # 自动提供 Node.js 20 + pnpm 9
```

### 9.2 日常开发

```bash
# 监听模式编译
pnpm dev

# 编译后运行 CLI
pnpm dev:cli

# 运行测试
pnpm test

# 监听模式测试
pnpm test:watch

# 代码检查
pnpm lint
```

### 9.3 贡献规范

#### 提交信息格式

采用 Conventional Commits 规范，单行格式：

```
type(scope): subject
```

常用 type:
- `feat`: 新功能
- `fix`: 错误修复
- `docs`: 文档变更
- `refactor`: 代码重构
- `test`: 测试变更
- `chore`: 工具或依赖变更

#### 贡献流程

1. **小修复**: 直接提交 PR（bug 修复、拼写错误、小改进）
2. **大变更**: 先提交 OpenSpec 提案以对齐方向
3. **AI 生成代码**: 欢迎，但需经过测试和验证 — 请注明使用的 AI 工具和模型

#### Changesets 流程

```bash
# 本地创建 changeset
pnpm changeset

# 选择变更类型和描述
# CI 会自动创建 "Version Packages" PR
# 合并后自动发布到 npm
```

### 9.4 项目约定

- **模块系统**: ESM（`"type": "module"`）
- **导入路径**: 使用 `.js` 后缀（TypeScript NodeNext 要求）
- **异步风格**: 全面使用 async/await
- **路径处理**: 使用 `path.join()` 确保跨平台兼容
- **交互模式**: 使用 `@inquirer` 的动态导入避免阻塞
- **错误处理**: 使用 `ora().fail()` 显示错误后 `process.exit(1)`

---

## 附录: 文件路径快速索引

| 用途 | 文件路径 |
|------|---------|
| CLI 入口 | `src/cli/index.ts` |
| 可执行文件 | `bin/openspec.js` |
| 包导出 | `src/index.ts` |
| 变更命令 | `src/commands/change.ts` |
| 规范命令 | `src/commands/spec.ts` |
| 验证命令 | `src/commands/validate.ts` |
| 工作流命令 | `src/commands/workflow/index.ts` |
| Zod Schema | `src/core/schemas/` |
| 验证器 | `src/core/validation/validator.ts` |
| 验证常量 | `src/core/validation/constants.ts` |
| Markdown 解析器 | `src/core/parsers/markdown-parser.ts` |
| Change 解析器 | `src/core/parsers/change-parser.ts` |
| Artifact Graph | `src/core/artifact-graph/` |
| AI 工具适配器 | `src/core/command-generation/adapters/` |
| 适配器接口 | `src/core/command-generation/types.ts` |
| 全局配置 | `src/core/global-config.ts` |
| 项目配置 | `src/core/project-config.ts` |
| AI 工具定义 | `src/core/config.ts` |
| Profile 系统 | `src/core/profiles.ts` |
| 归档逻辑 | `src/core/archive.ts` |
| Delta 应用 | `src/core/specs-apply.ts` |
| 初始化逻辑 | `src/core/init.ts` |
| Shell 补全 | `src/core/completions/` |
| 遥测系统 | `src/telemetry/` |
| 默认工作流模式 | `schemas/spec-driven/schema.yaml` |
| 包清单 | `package.json` |
| CI 配置 | `.github/workflows/ci.yml` |
