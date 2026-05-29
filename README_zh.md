<p align="center">
  <a href="https://github.com/Fission-AI/OpenSpec">
    <picture>
      <source srcset="assets/openspec_bg.png">
      <img src="assets/openspec_bg.png" alt="OpenSpec 标志">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/Fission-AI/OpenSpec/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fission-AI/OpenSpec/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/@fission-ai/openspec"><img alt="npm 版本" src="https://img.shields.io/npm/v/@fission-ai/openspec?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="许可证: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://discord.gg/YctCnvvshC"><img alt="Discord" src="https://img.shields.io/discord/1411657095639601154?style=flat-square&logo=discord&logoColor=white&label=Discord&suffix=%20online" /></a>
</p>

<details>
<summary><strong>最受欢迎的规范框架。</strong></summary>

[![Stars](https://img.shields.io/github/stars/Fission-AI/OpenSpec?style=flat-square&label=Stars)](https://github.com/Fission-AI/OpenSpec/stargazers)
[![Downloads](https://img.shields.io/npm/dm/@fission-ai/openspec?style=flat-square&label=Downloads/mo)](https://www.npmjs.com/package/@fission-ai/openspec)
[![Contributors](https://img.shields.io/github/contributors/Fission-AI/OpenSpec?style=flat-square&label=Contributors)](https://github.com/Fission-AI/OpenSpec/graphs/contributors)

</details>
<p></p>
我们的理念：

```text
→ 灵活而非僵化
→ 迭代而非瀑布式
→ 简单而非复杂
→ 为既有项目而生，而非仅适用于全新项目
→ 从个人项目到企业级均可扩展
```

> [!TIP]
> **全新工作流现已推出！** 我们使用全新的工件引导工作流重构了 OpenSpec。
>
> 运行 `/opsx:propose "你的想法"` 即可开始。→ [了解更多](docs/zh/opsx.md)

<p align="center">
  关注 <a href="https://x.com/0xTab">@0xTab（X 平台）</a> 获取更新 · 加入 <a href="https://discord.gg/YctCnvvshC">OpenSpec Discord</a> 获取帮助和提问。
</p>

### 团队

在团队中使用 OpenSpec？[发送邮件](mailto:teams@openspec.dev) 以获取我们 Slack 频道的访问权限。

<!-- TODO: 添加 /opsx:propose → /opsx:archive 工作流的 GIF 演示 -->

## 实际演示

```text
你: /opsx:propose add-dark-mode
AI: 已创建 openspec/changes/add-dark-mode/
    ✓ proposal.md — 为什么要做、有哪些变更
    ✓ specs/       — 需求和场景
    ✓ design.md    — 技术方案
    ✓ tasks.md     — 实施清单
    准备开始实施！

你: /opsx:apply
AI: 正在执行任务...
    ✓ 1.1 添加主题上下文提供者
    ✓ 1.2 创建切换组件
    ✓ 2.1 添加 CSS 变量
    ✓ 2.2 接入 localStorage
    所有任务已完成！

你: /opsx:archive
AI: 已归档至 openspec/changes/archive/2025-01-23-add-dark-mode/
    规范已更新。准备好迎接下一个功能。
```

<details>
<summary><strong>OpenSpec 仪表盘</strong></summary>

<p align="center">
  <img src="assets/openspec_dashboard.png" alt="OpenSpec 仪表盘预览" width="90%">
</p>

</details>

## 快速开始

**需要 Node.js 20.19.0 或更高版本。**

全局安装 OpenSpec：

```bash
npm install -g @fission-ai/openspec@latest
```

然后进入你的项目目录并初始化：

```bash
cd your-project
openspec init
```

现在告诉你的 AI：`/opsx:propose <你想构建的内容>`

如果你需要扩展工作流（`/opsx:new`、`/opsx:continue`、`/opsx:ff`、`/opsx:verify`、`/opsx:sync`、`/opsx:bulk-archive`、`/opsx:onboard`），可以使用 `openspec config profile` 进行选择，然后使用 `openspec update` 应用。

> [!NOTE]
> 不确定你的工具是否受支持？[查看完整列表](docs/zh/supported-tools.md) — 我们支持 20 多种工具，并且还在持续增加。
>
> 同样支持 pnpm、yarn、bun 和 nix。[查看安装选项](docs/zh/installation.md)。

## 文档

→ **[入门指南](docs/zh/getting-started.md)**：第一步<br>
→ **[工作流](docs/zh/workflows.md)**：组合与模式<br>
→ **[命令](docs/zh/commands.md)**：斜杠命令与技能<br>
→ **[CLI](docs/zh/cli.md)**：终端参考<br>
→ **[支持的工具](docs/zh/supported-tools.md)**：工具集成与安装路径<br>
→ **[核心概念](docs/zh/concepts.md)**：整体架构<br>
→ **[多语言支持](docs/zh/multi-language.md)**：多语言支持<br>
→ **[自定义](docs/zh/customization.md)**：定制你的体验<br>
→ **[OPSX 工作流](docs/zh/opsx.md)**：OPSX 工作流详解<br>
→ **[迁移指南](docs/zh/migration-guide.md)**：迁移到 OPSX<br>
→ **[安装](docs/zh/installation.md)**：安装选项

## 为什么选择 OpenSpec？

AI 编程助手功能强大，但当需求仅存在于聊天记录中时，结果往往不可预测。OpenSpec 添加了一个轻量级的规范层，让你在编写代码之前就对构建内容达成共识。

- **先达成共识再构建** — 人类和 AI 在编写代码之前先对规范达成一致
- **保持有序** — 每个变更都有独立的文件夹，包含提案、规范、设计和任务
- **灵活工作** — 随时更新任何工件，没有僵化的阶段门禁
- **使用你的工具** — 通过斜杠命令与 20 多种 AI 助手协同工作

### 对比分析

**与 [Spec Kit](https://github.com/github/spec-kit)**（GitHub）— 全面但笨重。有僵化的阶段门禁、大量 Markdown、Python 环境配置。OpenSpec 更轻量，让你可以自由迭代。

**与 [Kiro](https://kiro.dev)**（AWS）— 功能强大但被锁定在其 IDE 中，且仅限于 Claude 模型。OpenSpec 可与你已有的工具配合使用。

**与什么都不用相比** — 没有规范的 AI 编程意味着模糊的提示和不可预测的结果。OpenSpec 在不增加繁琐流程的前提下带来可预测性。

## 更新 OpenSpec

**升级包**

```bash
npm install -g @fission-ai/openspec@latest
```

**刷新 AI 指令**

在每个项目中运行此命令以重新生成 AI 指导并确保最新的斜杠命令生效：

```bash
openspec update
```

## 使用说明

**模型选择**：OpenSpec 在高推理能力的模型上表现最佳。我们推荐使用 Opus 4.5 和 GPT 5.2 进行规划和实施。

**上下文卫生**：OpenSpec 受益于干净的上下文窗口。在开始实施之前清除上下文，并在整个会话过程中保持良好的上下文卫生。

## 贡献

**小修复** — Bug 修复、拼写纠正和小幅改进可以直接提交 PR。

**大型变更** — 对于新功能、重大重构或架构变更，请先提交 OpenSpec 变更提案，以便我们在实施之前就意图和目标达成一致。

在编写提案时，请牢记 OpenSpec 的理念：我们服务于使用不同编程代理、模型和用例的广泛用户群体。变更应该对所有人都适用。

**欢迎 AI 生成的代码** — 只要经过测试和验证即可。包含 AI 生成代码的 PR 应注明所使用的编程代理和模型（例如，"使用 Claude Code 和 claude-opus-4-5-20251101 生成"）。

### 开发

- 安装依赖：`pnpm install`
- 构建：`pnpm run build`
- 测试：`pnpm test`
- 本地开发 CLI：`pnpm run dev` 或 `pnpm run dev:cli`
- 约定式提交（单行）：`type(scope): subject`

## 其他

<details>
<summary><strong>遥测</strong></summary>

OpenSpec 收集匿名使用统计数据。

我们仅收集命令名称和版本以了解使用模式。不收集参数、路径、内容或个人身份信息。在 CI 环境中自动禁用。

**退出方式：** `export OPENSPEC_TELEMETRY=0` 或 `export DO_NOT_TRACK=1`

</details>

<details>
<summary><strong>维护者与顾问</strong></summary>

查看 [MAINTAINERS.md](MAINTAINERS.md) 获取核心维护者和帮助指导项目的顾问列表。

</details>



## 许可证

MIT
