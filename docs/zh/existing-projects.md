# 在现有项目中使用 OpenSpec

**你不必为了开始而为整个代码库写文档。你只为即将改动的部分写规格。** 这是采用 OpenSpec 时最需要知道的一点，也是 OpenSpec 天生为存量项目（brownfield）而构建的原因。

一种常见的担忧是这样的：“我的应用有 8 万行旧代码。难道我得先为它全部写好规格，OpenSpec 才有用吗？”不必。那样做你会很痛苦，我们也不希望你那样。OpenSpec 让你的规格随每一次变更而增长。你的第一次变更记录它所触及的那一片，下一次变更记录它的那一片，几个月下来，你的规格会自然地围绕你实际在做的工作填满。

本指南展示如何在第一天就起步，而不必“一口吃成胖子”。

## 三十秒版

```bash
$ cd your-existing-project
$ rasen init          # adds openspec/ and your AI tool's commands
```

然后，在你的 AI 聊天里：

```text
/rasen-explore            # optional: have the AI read the area you'll touch
/rasen-propose <a real, small change you actually need>
/rasen-apply-change
/rasen-archive-change
```

现在你的规格精确描述了那次变更所触及的系统部分，仅此而已。这是正确的。其余那 8 万行代码你不必再操心。

## 为什么“增量优先”就是全部诀窍

OpenSpec 的变更以**增量（delta）**的形式编写：`ADDED`、`MODIFIED`、`REMOVED`。增量描述的是相对于当前行为正在改变的部分，而不是整个系统。

这正是存量项目工作所需要的。你很少从零开始构建。你是在加一个字段、修一处重定向、收紧一个超时。增量让你能够精确指定那一次改动，而不必先写一份把周围一切都包进去的 40 页规格。

所以你的 `rasen/specs/` 目录一开始并不是完整填满的。它近乎为空，然后逐步积累。每一次归档的变更都把它的增量并入其中。`auth/` 的规格只在你做过若干次 auth 相关变更之后才变得详尽——而这恰好就是你希望它详尽的时候。

如果你想了解更深的机制，参见[概念：增量规格](concepts.md#增量规格delta-specs)。

## 在真实代码库上的第一次变更

挑一个小而真实的东西。不是玩具，也不是重写。一个你这周本来就要做的变更。小的初次变更能让你在低风险下学会这套工作流。

**第 1 步：让 AI 阅读相关区域。** 这正是 `/rasen-explore` 在不熟悉或庞大的代码库上发挥价值的地方。把它指向你即将触及的部分，让它在提出任何建议之前先摸清现状是如何运作的。

```text
You: /rasen-explore

AI:  What would you like to explore?

You: I need to add rate limiting to our public API, but I'm not sure
     how requests currently flow through the middleware.

AI:  Let me trace it... [reads the router, middleware stack, and config]
     Requests hit Express, pass through auth middleware, then your
     controllers. There's no rate-limiting layer today. The cleanest
     insertion point is a middleware right after auth. Want me to scope it?
```

注意，AI 现在理解了你真实的结构，所以它写出的提案会贴合你的代码，而不是一份通用模板。在大型代码库上，单是这一个习惯就能省掉最多的痛苦。参见[先做探索](explore.md)。

**第 2 步：提出变更。** 提案及其增量规格只捕获这一次变更。

```text
You: /rasen-propose add-api-rate-limiting
```

**第 3 步：构建并归档**，使用 `/rasen-apply-change` 和 `/rasen-archive-change`，和任何变更一样。归档之后，你就拥有了一份关于限流行为的真实规格，它诞生于一次你本来就要做的变更。

## 想要一次带讲解的导览？用 onboard

如果你更愿意看着整个循环在你自己的代码上、带着讲解地完整发生一遍，扩展命令 `/rasen-onboard` 正是为此而生：它会扫描你的代码库，找出一处小而安全的改进，然后带着你走完提出、构建和归档，并解释每一步。

先开启扩展命令：

```bash
$ rasen config profile      # select the expanded workflows
$ rasen update              # apply them to this project
```

然后在聊天里：

```text
/rasen-onboard
```

这是在真实项目上最温和的入门方式，而且它最终会留给你一个真实的（小的）变更，你可以保留也可以丢弃。参见[命令：`/rasen-onboard`](commands.md#opsxonboard)。

## “但我已经有需求文档了”

也许你有一份 PRD、一份 SRS、一份正式规格，甚至 TLA+ 模型。很好。你既不必把它们整体导入，也不必把它们扔掉。

把现有文档当作**探索的素材**，而不是要转换的规格。当你开始一次变更时，把相关章节贴给 AI 或指给它看，让它从中梳理出一份聚焦的 OpenSpec 增量。增量以 OpenSpec 可测试的“需求 + 场景”形式，捕获你此刻正在改变的行为。你的原始文档原样留在原地，作为背景。

坦白的原因是：OpenSpec 的规格刻意以行为为先，并以变更为范围。一份 40 页的 PRD 是另一种产物，承担另一种职责。强行做一次性的批量转换，往往会产出一份庞大、过时、没人信任的规格。让规格从真实的变更中长出来，才能保持准确。

```text
You: /rasen-explore
You: Here's the section of our PRD about checkout. I'm implementing the
     "guest checkout" requirement next.
     [paste the relevant requirement]
AI:  [reads it, asks clarifying questions, then helps scope a change]
You: /rasen-propose add-guest-checkout
```

## 在大型代码库中组织规格

规格存放在 `rasen/specs/` 下，按**领域（domain）**分组：领域是一个与你的团队思考系统方式相匹配的逻辑区域。你不必预先把整套分类法设计好。当你在某个区域的第一次变更需要一个领域文件夹时，再创建它即可。

常见的领域划分方式：

- **按功能区域：** `auth/`、`payments/`、`search/`
- **按组件：** `api/`、`frontend/`、`workers/`
- **按限界上下文：** `ordering/`、`fulfillment/`、`inventory/`

挑一种能让新人一看就点头的划分。你以后还可以再调整。参见[概念：规格](concepts.md#规格specs)。

## Monorepo 与跨仓库的工作

对于 monorepo，最简单的模型是在仓库根目录放一个 `openspec/` 目录，其中的领域映射到你的各个 package 或服务。这能满足大多数团队。

如果你的工作确实**横跨多个仓库**（或多个你视作相互独立的 package），OpenSpec 提供了一个 beta 阶段的 **stores** 功能：计划存放在它自己独立的仓库里，你的任何一个代码仓库都可以引用它，这样计划就不必非要住在某一个仓库的 `openspec/` 文件夹内。它处于 beta 阶段，所以请把它的命令和状态视为仍在演进。从 [Store：用户指南](stores-beta/user-guide.md) 开始，了解它的心智模型和最小可用路径。

## 几条坦诚的告诫

- **抵制把一切都回填的冲动。** 为你并没有在改动的代码写规格，感觉很有产出，但通常并非如此。这些规格会过时，因为没有东西逼着它们去追踪现实。让真实的变更来驱动你的规格。
- **让早期的变更保持小。** 你的头几次变更，与其说是在交付，不如说是在学节奏。紧凑的范围能让循环变快、教训变便宜。
- **把 `openspec/` 提交进 git。** 你的规格和归档应当与它们所描述的代码一起纳入版本控制。
- **给 AI 上下文。** 在有着强约定的大型代码库上，把 `rasen/config.yaml` 的 `context:` 填好，这样每一次提案都会尊重你的技术栈和模式。参见[自定义](customization.md#项目配置)。

## 接下来去哪里

- [先做探索](explore.md) - 在你改动代码之前理解它的关键习惯
- [快速入门](getting-started.md) - 完整的“第一次变更”演练
- [编辑与迭代一次变更](editing-changes.md) - 在学习中调整一次变更
- [概念：增量规格](concepts.md#增量规格delta-specs) - 为什么增量能让存量工作变得干净
- [自定义](customization.md) - 把你项目的约定教给 OpenSpec
