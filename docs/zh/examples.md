# 示例与配方

真实变更，从头到尾。每份配方展示你会输入的命令和你会看到的回显，这样你可以把自己的情况匹配到某个模式并照抄。这些使用默认的 **core** 命令（`propose`、`explore`、`apply`、`sync`、`archive`）；在扩展命令集有帮助的地方会注明。

开始之前的一点提醒：像 `/rasen-propose` 这样的斜杠命令要输入到你的 **AI 助手的聊天**里，而 `openspec` 命令要输入到你的 **终端**里。如果这对你来说是新东西，先读一读[命令如何工作](how-commands-work.md)。在下面的对话记录里，`You:` 和 `AI:` 是聊天，以 `$` 开头的行是终端。

> **还不确定要构建什么？** 这些配方大多数在你先用 `/rasen-explore` 把它想清楚后会更加锋利。[配方 3](#配方-3在承诺之前先探索) 展示了它的实际运作，[先探索](explore.md)指南给出了完整的论证。

## 配方 1：一个小功能，快速路径

**何时使用：** 你清楚自己想要什么，并且这是一块范围可控的工作。这是最常见的配方。

整件事就是三条命令。提案、构建、归档。

```text
You: /rasen-propose add-logout-button

AI:  Created rasen/changes/add-logout-button/
     ✓ proposal.md — why and what
     ✓ specs/      — the new requirement and its scenarios
     ✓ design.md   — technical approach
     ✓ tasks.md    — implementation checklist
     Ready for implementation. Run /rasen-apply-change.
```

现在读这份方案。打开提案和增量规格。这正是 OpenSpec 为之而生的时刻：在错误假设还只是一段话、而不是 400 行代码时抓住它。如果哪里不对就直接编辑任何产物，然后继续。

```text
You: /rasen-apply-change

AI:  Working through tasks...
     ✓ 1.1 Add logout button to header
     ✓ 1.2 Clear session on click
     ✓ 1.3 Add confirmation dialog
     All tasks complete!

You: /rasen-archive-change

AI:  Archiving add-logout-button...
     ✓ Merged specs into rasen/specs/auth/spec.md
     ✓ Moved to rasen/changes/archive/2026-06-22-add-logout-button/
     Done. Ready for the next change.
```

就这样。登出行为现在是你规格的一部分，而这份变更带着完整上下文被归档了。

## 配方 2：一个 bug 修复

**何时使用：** 某个东西坏了，而你希望这次修复被记录为对行为的一次深思熟虑的变更，而不是一个神秘提交。

bug 修复的工作方式和功能完全一样。区别在于你如何框定提案：描述*正确*的行为，而不仅仅是"修掉这个 bug"。

```text
You: /rasen-propose fix-login-redirect-loop

AI:  Created rasen/changes/fix-login-redirect-loop/
     The proposal captures the current broken behavior and the
     intended behavior. The delta spec MODIFIES the redirect
     requirement so it's now precise and testable.
     Ready for implementation.
```

因为这次修复以一条 `MODIFIED` 需求加上一个全新场景落地，下一个人（或下一个 AI 会话）看到的不仅是你修了它，还有"正确"意味着什么。然后照常 `/rasen-apply-change` 和 `/rasen-archive-change`。

提示：对于一个修复，一个好场景就是用散文写成的回归测试。"GIVEN 一个已登出的用户，WHEN 他们提交有效的凭据，THEN 他们落在仪表盘上且不会被再次重定向。"写下它，实现就有了明确的目标。

## 配方 3：在承诺之前先探索

**何时使用：** 你有一个问题，但还没有方案。你不确定要构建什么，或者哪种方法是对的。

从 `/rasen-explore` 开始。它是一个思考伙伴，没有结构、也不创建任何产物。它读取你的代码库并帮你做决定。

```text
You: /rasen-explore

AI:  What would you like to explore?

You: Page loads feel slow but I don't know where the time goes.

AI:  Let me look... I found three likely culprits:
     1. Large unoptimized images on the product list
     2. Synchronous data fetching that blocks render
     3. Re-renders triggered by context changes
     Which should we tackle first?

You: The data fetching one.

You: /rasen-propose optimize-product-list-fetching

AI:  Created the change, with a proposal informed by what we just
     found. Ready for implementation.
```

探索在你为它花费一个变更*之前*澄清你的思路。当洞见结晶时，提案，而 AI 会把上下文延续下去。

## 配方 4：同时处理两个变更

**何时使用：** 你正做到一半的功能被一个紧急修复插了队。

变更之间是独立的文件夹，所以并行工作不会冲突。开始做修复、发布它，然后回到你离开时功能所在的地方。

```text
You: I'm partway through add-dark-mode, but I need to fix a login bug now.

You: /rasen-propose fix-login-redirect

AI:  Created rasen/changes/fix-login-redirect/. Ready for implementation.

You: /rasen-apply-change

AI:  Implemented the fix. All tasks complete.

You: /rasen-archive-change

AI:  ✓ Archived fix-login-redirect.

You: Back to dark mode.

You: /rasen-apply-change add-dark-mode

AI:  Resuming add-dark-mode. Picking up at task 2.3: Update Header...
```

在 `/rasen-apply-change add-dark-mode` 中点名变更，是当有不止一个变更在进行时、你向 AI 指定某个变更的方式。因为任务在 `tasks.md` 中追踪完成情况，AI 准确知道你停在了哪里。

当几个变更同时完成时，扩展的 `/rasen-bulk-archive-change` 会把它们一起归档，并通过检查实际实现的内容来解决规格冲突。参见[工作流](workflows.md#并行变更)。

## 配方 5：一个没有行为变化的重构

**何时使用：** 你在重组代码，而外部可见的行为应当保持完全一致。

这是有意思的情形，因为一个纯粹的重构*没有任何东西要加进你的规格*。行为契约没有变；只有实现变了。所以工作存在于设计和任务里，而规格增量是空的或缺席的。

```text
You: /rasen-propose refactor-payment-module

AI:  Created the change. The proposal states the goal (split the
     payment module, no behavior change) and the design captures
     the new structure. No spec changes, since behavior is identical.
     Ready for implementation.
```

当你归档一个没有触及规格的变更时，你可以让终端命令跳过规格这一步：

```bash
$ rasen archive refactor-payment-module --skip-specs
```

同一个标志对工具化、CI 和仅文档的变更也很方便。原则是：规格描述行为，所以如果行为没变，规格也不应变。参见[概念](concepts.md#规格是什么以及不是什么)。

## 配方 6：逐步控制（扩展命令）

**何时使用：** 一个复杂或有风险的变更，你想在每个产物落地后再继续之前先审查它。

核心的 `/rasen-propose` 一次性起草所有东西。当你更想一步一步来时，开启扩展命令：

```bash
$ rasen config profile      # select the expanded workflows
$ rasen update              # apply them to this project
```

现在你可以增量地搭建和构建：

```text
You: /rasen-new-change add-2fa

AI:  Created rasen/changes/add-2fa/. Ready to create: proposal.

You: /rasen-continue-change

AI:  Created proposal.md. Now available: specs, design.

You: /rasen-continue-change

AI:  Created specs/auth/spec.md. Now available: design.
```

在每个产物落地时审查它，自由编辑，满意了再继续。如果你想一次性起草全部内容，`/rasen-propose` 涵盖了与「`/rasen-new-change` 加上其余所有产物」相同的范围。在归档之前，`/rasen-verify-change` 检查实现是否确实匹配规格。参见[工作流](workflows.md#rasenpropose-与-rasencontinue-的对比)。

## 配方 7：亲手学习整个循环

**何时使用：** 你已经安装了 OpenSpec，想在自己的代码上、而不是一个玩具示例上*感受*这个工作流。

开启扩展命令（见配方 6），然后：

```text
You: /rasen-onboard

AI:  Welcome to OpenSpec! I'll walk you through a complete change
     using your actual codebase. Let me scan for a small, safe
     improvement we can make together...
```

`/rasen-onboard` 找到一个真实的（小的）改进、为它创建一个变更、实现它、并归档它，每一步都配上讲解。它耗时 15 到 30 分钟，留给你一份你可以保留或丢弃的真实变更。这是最温和的学习方式。参见[命令](commands.md#opsxonboard)。

## 从终端检查你的工作

任何时候，你都可以从终端检查事物的状态：

```bash
$ rasen list                      # active changes
$ rasen show add-dark-mode        # one change in detail
$ rasen validate add-dark-mode    # check structure
$ rasen view                      # interactive dashboard
```

这些是���取和检查工具。提案和构建仍然通过聊天里的斜杠命令进行。完整细节见 [CLI 参考](cli.md)。

## 下一步去哪

- [先探索](explore.md)：不确定时推荐的开始方式
- [工作流](workflows.md)：上面的模式，以及每种何时使用的决策指引
- [命令](commands.md)：每条斜杠命令的详解
- [快速入门](getting-started.md)：权威的首次变更演练
- [概念](concepts.md)：为什么这些部分以现在的方式拼合在一起
