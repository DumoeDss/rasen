# 常见问题（FAQ）

以下是大家最常问的问题的简短解答。如果你的问题其实是“某样东西坏了”，[故障排除](troubleshooting.md)页面更合适。如果你想查找某个术语的定义，请参阅[术语表](glossary.md)。

## 基础知识

### 用一句话说，OpenSpec 是什么？

一个轻量级层，让你和你的 AI 编码助手在任何代码编写之前，先以书面形式就“要构建什么”达成一致。

### 为什么我需要它？

因为 AI 助手即使错了也表现得很自信。当需求只存在于某个聊天线程里时，AI 会用猜测来填补空白，而你要等到代码写出来后才发现问题。OpenSpec 把“达成一致”这一步提前到犯错代价很小的时候。完整论述见[核心概念一览](overview.md)。

### 我必须事事都用它吗？

不必。在“达成一致”这件事很重要时使用它，也就是大多数非简单的工作。对于改一个字符的拼写错误，这一套流程大概不值得，那也没关系。

### 我能在大型现有代码库上使用吗，还是只能用于新项目？

现有代码库才是主战场。OpenSpec 是“棕地优先”（brownfield-first）的：你不需要预先为整个应用编写文档。你只为每个变更涉及的部分编写规格，随着你实际开展的工作，规格会逐渐填充起来。这里有一份专门的指南：[在现有项目中使用 OpenSpec](existing-projects.md)。

### 它绑定某一个 AI 工具吗？

不绑定。OpenSpec 兼容 25+ 款助手，包括 Claude Code、Cursor、Windsurf、GitHub Copilot、Gemini CLI、Codex 等等。完整列表及各工具的细节见[支持的工具](supported-tools.md)。

## 运行命令

### 我该在哪里输入 `/rasen:propose`？

在你的 AI 助手的聊天框里，而不是终端里。这是最常见的混淆点，因此它有单独的一页：[命令的工作原理](how-commands-work.md)。简短版：`rasen ...` 在终端运行，`/rasen:...` 在聊天中运行。

### 我怎么“启动交互模式”？

并没有一个需要单独启动的模式。你像平时一样打开 AI 助手，然后在它的聊天框里输入斜杠命令即可。斜杠命令就是你“进入” OpenSpec 的方式。（唯一一个真正交互式的终端功能是 `rasen view`，一个用于浏览规格和变更的仪表板。）完整说明见[命令的工作原理](how-commands-work.md)。

### 我输入了斜杠命令，但什么都没发生。为什么？

最可能的原因是你在终端里输入了它，而不是在 AI 聊天里；或者命令还没安装。在你的项目中运行 `rasen update`，重启助手，然后在聊天里输入 `/opsx`，看看是否出现自动补全。[故障排除](troubleshooting.md#命令没有出现)里有完整的检查清单。

### 为什么在一个工具里语法是 `/rasen:propose`，而在另一个里是 `/opsx-propose`？

每个 AI 工具呈现自定义命令的方式略有不同。意图完全相同，只是标点符号不同。在聊天里输入一个斜杠，自动补全会显示你的工具所期望的形式。各工具的对照表见[命令的工作原理](how-commands-work.md#各工具的斜杠命令语法)。

### skill（技能）和 command（命令）有什么区别？

两者都是 OpenSpec 写出的文件，好让你的助手能运行这套工作流。Skill（`.../skills/openspec-*/SKILL.md`）是较新的跨工具标准；command（`.../commands/opsx-*`）是较早的、按工具区分的斜杠文件。你不需要二选一，只管输入斜杠命令，OpenSpec 会安装你的工具所使用的那一种。

## 工作流

### 如果我不确定要构建什么，该从哪里开始？

从 `/rasen:explore` 开始。它是一个零成本的思考伙伴，会阅读你的代码库、列出可选方案，把一个模糊的问题变成具体的计划——这一切都发生在任何变更或代码存在之前。它在默认配置中，所以总是可用。当计划清晰后，它会交接给 `/rasen:propose`。这是最值得养成的习惯，因为它能阻止一个急于求成的 AI 自信满满地构建出错误的东西。参见[先探索](explore.md)。

### 最简单的流程是什么样的？

```text
/rasen:explore (optional)   then   /rasen:propose <what you want>   then   /rasen:apply   then   /rasen:archive
```

用 explore 把思路理清，用 propose 起草计划，用 apply 构建实现，用 archive 归档收尾。当你已经确切知道自己想要什么时，可以跳过 explore。

### `/rasen:propose` 和 `/rasen:new` 有什么区别？

`/rasen:propose` 是默认的一步式命令：它创建变更并一次性起草所有规划产物。`/rasen:new` 属于扩展命令集，只搭建一个空的变更框架，然后由你用 `/rasen:continue` 逐个创建产物（或用 `/rasen:ff` 一次性全部创建）。除非你想要逐步控制，否则就用 propose。参见[命令](commands.md)。

### 什么是 `core` 和扩展配置（profile）？

profile（配置）决定了安装哪些斜杠命令。**Full**（完整，默认）安装所有工作流。**Core**（精简）缩减为 `propose`、`explore`、`apply`、`sync`、`archive`，而 **custom**（自定义）让你挑选任意子集。用 `rasen config profile` 切换，然后用 `rasen update` 应用。

### 我需要运行 `/rasen:sync` 吗？

通常不需要。Sync 会把一个变更的增量规格合并进你的主规格，而 `/rasen:archive` 会主动提出替你完成这一步。只有当你想在归档之前就让规格合并时（例如一个长期运行的变更），才手动运行 sync。参见[命令](commands.md#opsxsync)。

### 开始之后，我怎么编辑提案、规格或任务？

直接编辑文件就好。每个产物都是 `rasen/changes/<name>/` 下的纯 Markdown 文件，没有锁定的阶段，也没有特殊的编辑模式。你可以手动修改，也可以让你的 AI 来修订（“把设计改成使用队列”），然后继续。AI 总是基于文件的当前内容工作。完整指南见[编辑与迭代变更](editing-changes.md)。

### 实现了一部分之后，我还能回去修改计划吗？

可以，随时都行。工作流是灵活的，所以审阅和编辑并不是你会被锁在外面的阶段。编辑产物，然后继续。如果你想要一个结构化的检查，确认代码仍然与计划一致，运行 `/rasen:verify`。参见[编辑与迭代变更](editing-changes.md#实现之后我怎么回到审查)。

### 我手动改了代码。怎么让它和规格对齐？

在归档之前把它们重新对齐，因为归档会让你的规格成为事实记录。如果现在代码是对的，就更新增量规格以匹配你实际交付的内容；如果规格是对的，就继续构建直到代码与之吻合。`/rasen:verify` 会指出不一致之处。参见[编辑与迭代变更](editing-changes.md#我亲手改了代码怎么把它和-openspec-对账)。

### 什么时候该更新现有变更，什么时候该新建一个？

当是同一项工作的改进时，就更新。当意图发生了根本改变，或范围膨胀成了不同的工作时，就重新开始。[工作流](workflows.md#何时更新已有变更-vs-重新开始)里有决策流程图和示例。

### 如果我的会话上下文耗尽了，或者实现过程中需求发生了变化怎么办？

这正是规格发挥作用的地方。因为计划存在于文件中（而不仅仅在聊天历史里），你可以清空上下文、开启一个全新的 AI 会话，然后用 `/rasen:apply` 接续；它会读取产物并从第一个未勾选的任务继续。如果需求变化了，就编辑产物以匹配新的现实，然后继续。保持一个干净的上下文窗口也会带来更好的结果；在实现之前先清空它。

### 我应该把 `openspec/` 文件夹提交到 git 吗？

应该。你的规格、进行中的变更以及归档，都是你项目历史的一部分。像对待其他源码一样提交它们。尤其是归档，它会成为一份持久的记录，说明你的系统为什么会是现在这样运作。

## 规格与变更

### 规格里写什么，设计里写什么？

规格描述可观察的行为：系统做什么、它的输入、输出以及错误条件。设计描述你将如何构建它：技术方案、架构决策、文件改动。如果某种实现方式可以在不改变外部可见行为的前提下发生变化，那它就属于设计，而不属于规格。更深入的讨论见[概念](concepts.md#规格是什么以及不是什么)。

### 什么是增量规格（delta spec）？

一种只描述“正在发生什么变化”的规格，它使用 `ADDED`、`MODIFIED` 和 `REMOVED` 段落，而不是重述整份规格。这就是 OpenSpec 用来干净利落地处理对现有系统进行编辑的方式。参见[概念](concepts.md#增量规格delta-specs)。

### 归档的变更去哪了？

到 `rasen/changes/archive/YYYY-MM-DD-<name>/`，所有产物都保留下来。什么都不会被删除；变更只是从你的进行中列表里移走了。

## 配置与自定义

### 我怎么告诉 AI 我的技术栈？

把它写进 `rasen/config.yaml` 的 `context:` 下。这段文字会被注入到每一个规划请求中，所以 AI 始终知道你的技术栈和约定。参见[自定义](customization.md#项目配置)。

### 我能用英语以外的语言生成规格吗？

可以。在你的配置的 `context:` 中加一条语言指令。[多语言](multi-language.md)里提供了几种语言的可直接复制粘贴的代码片段。

### 我能改变工作流本身吗？

可以，用自定义 schema。schema 定义了存在哪些产物以及它们如何相互依赖。用 `rasen schema fork spec-driven my-workflow` 复制默认 schema 作为起点，然后编辑它。参见[自定义](customization.md#自定义-schema)。

## 模型、隐私与升级

### 我该用哪个 AI 模型？

OpenSpec 在高推理能力的模型上表现最好。README 推荐在规划和实现两阶段都使用 Codex 5.5 和 Opus 4.7 等模型。另外要保持上下文窗口干净：在实现之前先清空它，效果最好。

### OpenSpec 会收集数据吗？

它会收集匿名的使用统计：仅命令名和版本号。不包含参数、路径、内容或个人数据，并且在 CI 中会自动关闭。可用 `export OPENSPEC_TELEMETRY=0` 或 `export DO_NOT_TRACK=1` 来退出。

### 我该怎么升级？

两步。先升级包（`npm install -g @fission-ai/openspec@latest`），然后在每个项目里运行 `rasen update` 来刷新生成的 skill 和命令。

### 我怎么卸载 OpenSpec？

没有卸载命令，因为它只是一个全局包加上你项目里的一些文件。移除这个包（`npm uninstall -g @fission-ai/openspec`），并视情况删除 `openspec/` 目录以及生成的工具文件。详细的分步说明（包括哪些东西可以安全保留）见[安装：卸载](installation.md#卸载)。

## 获取帮助

### 我该去哪里提问或报告 bug？

- **Discord：** [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC)
- **GitHub Issues：** [github.com/Fission-AI/OpenSpec/issues](https://github.com/Fission-AI/OpenSpec/issues)
- **从终端：** `rasen feedback "your message"` 会为你打开一个 GitHub issue。

### 这些文档有错或让人困惑。我该怎么办？

告诉我们，或者直接修复它。文档 PR 欢迎且受重视。开一个 issue 或提交一个 pull request。
