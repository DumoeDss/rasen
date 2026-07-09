# OpenSpec 文档

欢迎。这里是 OpenSpec 的一切所在。

OpenSpec 帮助你和你的 AI 编程助手**在写下任何代码之前，就先就“要构建什么”达成一致。** 你描述这次变更，AI 起草一份简短的规格和任务清单，你们看着同一份计划，然后再开始动手。从此不必在写了一半时才发现 AI 做错了方向。

如果只读一页，就读这两页：

1. [快速入门](getting-started.md)：安装、初始化，并交付你的第一个变更。
2. [命令是如何工作的](how-commands-work.md)：你到底在哪里输入 `/rasen:propose`（提示：在你的 AI 聊天里，而不是终端里）。几乎每个人都会在这里绊一次。

第二页的重要性比看起来更大。OpenSpec 有两个部分：你在终端里运行的命令行工具，以及你给 AI 助手下达的斜杠命令（slash command）。分清这两者，能省掉最常见的那次困惑。

> **最值得先养成的习惯：当你不确定要构建什么时，从 `/rasen:explore` 开始。** 它是一个零成本的思考伙伴——会阅读你的代码、权衡各种选项，在任何产物或代码存在之前，把一个模��的想法打磨成具体的计划。[先做探索（Explore First）](explore.md) 这份指南把理由讲得很清楚。

## 按你的情况选路径

**我完全是新手。** 从 [快速入门](getting-started.md) 开始，然后略读 [核心概念一览](overview.md)。当某处让人摸不着头脑时，[FAQ](faq.md) 和 [术语表](glossary.md) 就在附近。

**我有问题，但还没有方案。** 这是最常见的情况，并且有专门的答案：[先做探索](explore.md)。在拍板之前，先用 `/rasen:explore` 和 AI 一起把它想透。

**我有一个庞大的现成代码库。** 你不必为它全部写文档。[在现有项目中使用 OpenSpec](existing-projects.md) 讲解如何在真实的、棕地（brownfield）代码上起步，而不必“一口吃成胖子”。

**我只想让它先跑起来。** [安装](installation.md)，运行 `rasen init`，然后读 [命令是如何工作的](how-commands-work.md)，好让你的第一个斜杠命令落到正确的地方。

**我喜欢看例子学。** [示例与配方（Examples & Recipes）](examples.md) 这一页从头到尾走完了若干真实的变更：一个小功能、一个 bug 修复、一次重构、一次探索。

**AI 刚起草了一份计划——接下来怎么办？** 读它。[评审一次变更](reviewing-changes.md) 展示了那两分钟的过一遍，趁走错还便宜时及时纠偏；[写好规格](writing-specs.md) 则讲清楚一份值得批准的计划由什么构成。

**我在团队中工作。** [团队中的 OpenSpec](team-workflow.md) 展示了一次变更如何映射到一个分支和一个 pull request，以及队友如何在代码之前评审计划。

**我从旧的工作流迁移过来。** [迁移指南](migration-guide.md) 解释了什么变了、为什么变，并保证你既有的工作不会丢失。

**我想把它改造成适合我团队流程的样子。** [自定义](customization.md) 涵盖项目配置、自定义 schema 和共享上下文。

**有东西坏了。** [故障排查](troubleshooting.md) 汇总了人们真正会遇到的各种失败，并附带修复办法。

## 全景地图

### 从这里开始

| 文档 | 你能从中得到什么 |
|-----|-------------------|
| [快速入门](getting-started.md) | 安装、初始化，并端到端跑通你的第一个变更 |
| [先做探索](explore.md) | 在拍板之前，用 `/rasen:explore` 把一个想法想透 |
| [命令是如何工作的](how-commands-work.md) | 斜杠命令在哪里运行、“交互模式”是什么意思、终端与聊天的区别 |
| [核心概念一览](overview.md) | 用一页讲清整套心智模型：spec、变更、delta、归档 |
| [安装](installation.md) | npm、pnpm、yarn、bun、Nix，以及如何确认安装成功 |

### 日常使用

| 文档 | 你能从中得到什么 |
|-----|-------------------|
| [工作流](workflows.md) | 常见模式，以及何时该用哪个命令 |
| [Autopilot 策略](autopilot.md) | `/rasen:auto` 的 opt-in 自主权：`--no-gate`、`--auto-select`、组合式流水线 |
| [示例与配方](examples.md) | 真实变更的完整演练，可直接复制粘贴 |
| [写好规格](writing-specs.md) | 一条强需求和一个好场景长什么样，以及如何给一次变更定准大小 |
| [评审一次变更](reviewing-changes.md) | 在写任何代码之前，用两分钟过一遍起草好的计划 |
| [团队中的 OpenSpec](team-workflow.md) | 变更如何契合分支、pull request 与评审 |
| [在现有项目中使用 OpenSpec](existing-projects.md) | 在庞大的棕地代码库上采用 OpenSpec |
| [编辑与迭代一次变更](editing-changes.md) | 更新产物、回退、调和手动改动 |
| [命令](commands.md) | 每一个 `/rasen:*` 斜杠命令的参考 |
| [CLI](cli.md) | 每一个 `openspec` 终端命令的参考 |

### 深入理解

| 文档 | 你能从中得到什么 |
|-----|-------------------|
| [概念](concepts.md) | 对 spec、变更、产物、schema 和归档的长篇讲解 |
| [OPSX 工作流](opsx.md) | 为什么这套工作流是“流动的”而非“阶段锁死的”，外加一次架构深潜 |
| [术语表](glossary.md) | 每个术语集中在一处定义 |

### 改造成你自己的

| 文档 | 你能从中得到什么 |
|-----|-------------------|
| [自定义](customization.md) | 项目配置、自定义 schema、共享上下文 |
| [多语言](multi-language.md) | 用英文以外的语言生成产物 |
| [支持的工具](supported-tools.md) | OpenSpec 集成的 25+ AI 工具，以及文件落在哪里 |

### 需要帮助时

| 文档 | 你能从中得到什么 |
|-----|-------------------|
| [FAQ](faq.md) | 人们最常问的那些问题的快速解答 |
| [故障排查](troubleshooting.md) | 针对具体失败的具体修复 |
| [迁移指南](migration-guide.md) | 从旧工作流迁移到 OPSX |

### 跨仓库协作（beta）

| 文档 | 你能从中得到什么 |
|-----|-------------------|
| [Store：用户指南](stores-beta/user-guide.md) | 当你的工作横跨多个仓库或团队时，把计划放进它自己的仓库里 |
| [Agent 契约](agent-contract.md) | agent 所驱动的、机器可读的 CLI 接口 |

## 三十秒版

```text
1. 安装          npm install -g @fission-ai/openspec@latest
2. 初始化        cd your-project && rasen init
3. 探索          （在你的 AI 聊天里）  /rasen:explore           ← 可选，但是个好习惯
4. 提案          （在你的 AI 聊天里）  /rasen:propose add-dark-mode
5. 构建          （在你的 AI 聊天里）  /rasen:apply
6. 归档          （在你的 AI 聊天里）  /rasen:archive
```

第 1、2 步在你的终端里发生。其余都在你的 AI 助手的聊天里。这一分工是唯一值得记住的事，[命令是如何工作的](how-commands-work.md) 把其中的道理讲得清清楚楚。第 3 步是可选的，但当你拿不准时从 `/rasen:explore` 开始，是最值得养成的习惯。

## 还能在哪里获得帮助

- **Discord：** [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC)，用于提问、想法和求助。
- **GitHub Issues：** [github.com/Fission-AI/OpenSpec/issues](https://github.com/Fission-AI/OpenSpec/issues)，用于 bug 和功能请求。
- **`rasen feedback "你的留言"`** 直接从你的终端发送反馈（它会打开一个 GitHub issue）。

如果你在这些文档里发现了错误、过时或令人费解的内容，那就是一个 bug。开个 issue 或 PR 吧。文档改进是你能做出的最有价值的贡献之一。
