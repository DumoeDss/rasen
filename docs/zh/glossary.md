# 术语表

所有 OpenSpec 术语汇集于一处，用通俗的语言加以定义。先浏览一遍，之后阅读其余文档会顺畅许多。

术语按主题分组，每组内部按字母顺序排列。

## 核心名词

**规格（Spec）。** 一份描述系统某一部分如何运作的文档。规格存放在 `rasen/specs/`，按领域组织，由需求和场景构成。规格是对"这个软件做什么？"这一问题已达成共识的答案。参见[概念](concepts.md#规格specs)。

**唯一事实来源（Source of truth）。** 即 `rasen/specs/` 目录整体。它保存系统当前已达成一致的行为。变更（change）会提议对它的修改；归档（archive）则把这些修改应用上去。

**变更（Change）。** 一个工作单元，打包为 `rasen/changes/<name>/` 下的一个文件夹。一个变更容纳了与该工作有关的一切：它的提案、设计、任务，以及它所引入的规格修改。一个变更，对应一个功能或修复。

**产物（Artifact）。** 变更内部的一份文档。标准产物包括提案、增量规格、设计和任务。它们按依赖顺序创建，并彼此承接。

**增量规格（Delta spec）。** 变更内部的一份规格，只描述正在改变的内容，使用 `ADDED`、`MODIFIED` 和 `REMOVED` 区段，而不是把整份规格重述一遍。这正是让 OpenSpec 能干净地修改既有系统的关键。参见[概念](concepts.md#增量规格delta-specs)。

**领域（Domain）。** 规格的逻辑分组，比如 `auth/`、`payments/` 或 `ui/`。你可以选择与自己思考系统的方式相匹配的领域划分。

## 规格内部

**需求（Requirement）。** 系统必须具备的单项行为，通常用一个 RFC 2119 关键字来书写："The system SHALL expire sessions after 30 minutes."。需求陈述的是*做什么*，而不是*怎么做*。

**场景（Scenario）。** 需求在行动中的一个具体、可测试的示例，通常采用 Given/When/Then 形式。场景让需求变得可验证：你可以基于一个场景写出自动化测试。

**RFC 2119 关键字（RFC 2119 keywords）。** MUST、SHALL、SHOULD 和 MAY 这几个词，它们对"需求的严格程度"承载了标准化的含义。MUST 和 SHALL 表示绝对要求。SHOULD 是推荐，但允许例外。MAY 是可选。这个名字来源于定义了它们的互联网标准文档。

## 产物

**提案（`proposal.md`，Proposal）。** 一个变更的*为什么*和*做什么*：它的意图、范围和高层次的方法。是你创建的第一份产物。

**设计（`design.md`，Design）。** *怎么做*：技术方法、架构决策，以及你预期会改动的文件。对于简单变更是可选的。

**任务（`tasks.md`，Tasks）。** 实现清单，带复选框。AI 会在 `/rasen:apply` 期间逐项推进，并随着进展勾选条目。

## 生命周期

**归档（Archive）。** 结束一个变更的动作。它的增量规格会合并进主规格，变更文件夹则移动到 `rasen/changes/archive/YYYY-MM-DD-<name>/`。归档之后，你的规格描述的就是新的现实了。参见[概念](concepts.md#归档archive)。

**同步（Sync）。** 把一个变更的增量规格合并进主规格，但*不*归档该变更。通常是自动进行的（归档时会主动提议同步），不过对于长期推进的变更，也可以单独通过 `/rasen:sync` 来执行。参见[命令](commands.md#opsxsync)。

## 工作流与命令

**OPSX。** 当前 OpenSpec 的标准工作流，围绕灵活的动作而非僵化的阶段构建。它的斜杠命令都以 `/rasen:` 开头。参见 [OPSX 工作流](opsx.md)。

**斜杠命令（Slash command）。** 你在 AI 助手聊天里输入的命令，例如 `/rasen:propose`。斜杠命令驱动整个工作流。它们不是终端命令。参见[命令如何运作](how-commands-work.md)。

**探索（`/rasen:explore`，Explore）。** 思考伙伴命令。它会阅读你的代码库、对比各种选项，把一个模糊的想法厘清为一份具体的计划，期间不创建任何产物、也不写任何代码。当你有一个问题、却还没有成形的计划时，推荐把它作为起点。参见[先做探索](explore.md)。

**CLI。** 你在终端里运行的 `openspec` 程序。它负责初始化项目、列出并校验变更、打开仪表盘、执行归档。它是 OpenSpec 的"终端那一半"。参见 [CLI](cli.md)。

**技能（Skill）。** 一个指令文件夹（`.../skills/openspec-*/SKILL.md`），你的 AI 助手会自动探测并遵循它。技能是把 OpenSpec 工作流交付给助手的、正在兴起的跨工具标准。

**命令文件（Command file）。** 针对某个工具的斜杠命令文件（`.../commands/opsx-*`）。当 delivery 为 `both` 时，与技能一并安装的可选补充。你很少需要直接改动这些文件。

**配置方案（Profile）。** 安装到你项目里的那套斜杠命令集合。**Full**（默认）会安装全部工作流。**Core** 会精简为 `propose`、`explore`、`apply`、`sync`、`archive`；**custom** 则是你任意挑选的子集。可以通过 `rasen config profile` 来更改。

**交付方式（Delivery）。** 决定 OpenSpec 是否在技能之外再装命令文件——`both`（默认，技能 + 命令）或 `skills`（仅技能）。技能始终安装。它按全局配置，并通过 `rasen update` 应用。

## 自定义

**模式（Schema）。** 定义一个工作流拥有哪些产物，以及它们彼此如何依赖。内置默认是 `spec-driven`（proposal → specs → design → tasks）。你可以 fork 它，或者自己写一个。参见[自定义配置](customization.md#自定义-schema)。

**模板（Template）。** 模式内部的一个 Markdown 文件，用来塑造 AI 为某个产物所生成的内容。编辑模板会立即改变 AI 的输出，无需重新构建。

**项目配置（`rasen/config.yaml`，Project config）。** 针对项目的设置：默认模式、注入到每次规划请求中的 `context:`，以及针对单个产物的 `rules:`。这是把你的技术栈和约定告诉 OpenSpec 最简单的方式。参见[自定义配置](customization.md#项目配置)。

**上下文注入（Context injection）。** 把项目背景放进 `config.yaml` 的 `context:` 字段，从而让它被自动加到 AI 生成的每一份产物里。这比寄望 AI 去读另一个单独文件要可靠得多。

**依赖图（Dependency graph）。** 由产物的 `requires:` 关系形成的有向图。它是一个 DAG（有向无环图：箭头只向前指、绝不形成环），OpenSpec 借助它来判断你接下来可以创建什么。

**启用条件，而非门禁（Enablers, not gates）。** 这样一条原则：产物的依赖展示的是接下来*可以*做什么，而不是接下来*必须*做什么。你随时都可以回过头来编辑任意一份产物。参见[核心概念一览](overview.md#赋能者而非关卡)。

## 跨仓库协作（beta）

这些术语仅在规划工作跨越多个仓库时才适用。它们处于 beta 阶段。大多数用户可以忽略。参见 [Stores 用户指南](stores-beta/user-guide.md)。

**Store。** 一个独立的仓库，其全部职责就是规划。它拥有你早已熟悉的同样的 `openspec/` 结构（specs 和 changes），外加一个小型的身份文件。你在自己的机器上按名字注册它一次，之后任何 OpenSpec 命令都可以从任何地方在其中运作。

**Reference。** 在某个代码仓库的 `rasen/config.yaml` 中，声明该仓库所依赖的一个 store。引用是只读的：该仓库保留自己的根，而 `rasen instructions` 会获得一份被引用 store 的规格索引，每条都附带获取它的确切命令。

**工作上下文（Working context）。** `rasen context` 为当前仓库组装出来的内容：它的 OpenSpec 根，加上它引用的每一个 store，以及各自如何获取。这是"我正在和什么打交道？"的答案。

**Workset。** 一组你个人、本机本地的文件夹集合，你会把它们一起打开（一个 store 连同你工作的那些代码仓库）。通过 `rasen workset create` 显式创建；这些本地路径的任何信息都不会被提交到共享的规划仓库中。

## 另请参阅

- [核心概念一览](overview.md)：五个理念，浓缩一页
- [概念](concepts.md)：长文详解
- [命令如何运作](how-commands-work.md)：斜杠命令与 CLI 之别
