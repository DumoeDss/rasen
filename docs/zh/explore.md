# 先做探索

**`/opsx:explore` 是你的思考伙伴。每当你遇到问题、却还没有成型的方案时，就去找它。** 它会调查你的代码库、和你一起权衡各种选项、帮你理清你真正想要的是什么——而这一切都发生在任何产物或一行代码被创建之前。等思路清晰之后，它会交接给 `/opsx:propose`。

如果你只从这些文档里带走一个习惯，那就带走这一个：**不确定时，先探索再提议。**

下面说说为什么这很重要。AI 编程助手总是很“积极”。你问得模糊，它们就会自信满满地构建出*某个东西*——只不过未必是你需要的那一个。Explore 正是解药。它是一场零成本的对话，你和 AI 一起商量出正确的做法，这样等到你提议时，你提议的就是对的东西。

## 何时探索

Explore 往往是正确的第一步，频率比人们预想的更高。当以下任何一种情况成立时，就使用它：

- 你知道*问题*是什么，但不知道*解决方案*。（“页面感觉很慢。”“认证逻辑一团糟。”“我们总是出现重复订单。”）
- 你正在几种方案之间做选择，希望对照你真实的代码看清各自的取舍。
- 你刚接手一个代码库，在改动之前需要先搞懂某部分是怎么运作的。
- 需求还很模糊，你想在投入之前把它打磨清楚。
- 你怀疑这项工作比看上去更大或更小，想诚实地界定它的范围。

只有当你已经确切知道自己想要什么、以及怎么做时，才跳过 explore。那种情况下直接用 [`/opsx:propose`](commands.md#opsxpropose)。

## 它做什么（以及不做什么）

Explore 是一场**对话**，而不是一个生成器。

**它会：**
- 阅读并搜索你的代码库，回答真实的问题。
- 比较各种选项，并点明每一种的取舍。
- 画图，让设计变得清晰可读。
- 帮你把模糊的想法收敛成一个具体、可构建的范围。
- 当你准备好时，过渡到 `/opsx:propose`。

**它不会：**
- 创建变更文件夹。
- 写任何产物（不写 proposal、specs、design 或 tasks）。
- 编写或修改代码。

这正是重点。探索不花你任何成本，也不让你承担任何承诺。你可以探索出三个死胡同，从每一个里都学到东西，然后再去提议那条活下来的路径。

## 它已经装好了

好消息：`/opsx:explore` 默认就随 **core** 配置文件一同安装，和 `propose`、`apply`、`sync`、`archive` 并列。你不需要启用任何东西。只要你的项目里设置好了 OpenSpec，explore 就已经在你的 AI 聊天里就绪了。（和所有 `/opsx:*` 命令一样，你要把它打在助手的聊天里，而不是终端里。参见[命令是如何工作的](how-commands-work.md)。）

## 一个完整示例

看看一个模糊的担忧如何变成一个精准、可构建的变更。

```text
You: /opsx:explore

AI:  What would you like to explore?

You: Our checkout sometimes creates duplicate orders. I don't know why
     and I don't know how to fix it safely.

AI:  Let me dig into the checkout path...
     [reads the order service, the payment webhook handler, and the
      client submit logic]

     Here's what I found. There are two ways a duplicate can happen:

     1. The client can submit twice (double-click, retry on slow network).
        Nothing debounces it.
     2. The payment webhook can fire more than once, and the handler
        creates an order each time. There's no idempotency key.

     Cause #2 is the dangerous one: it can charge and fulfill twice.

     Three ways to fix it, roughly in order of robustness:
     - Idempotency key on the order-creation endpoint (handles both causes)
     - Dedup on the webhook by payment-intent id (handles #2 only)
     - Client-side debounce (handles #1 only, papers over the real bug)

     Given your code already stores the payment-intent id, the
     idempotency-key approach is a small change with the biggest payoff.
     Want me to scope that?

You: Yes, let's do the idempotency key.

You: /opsx:propose add-order-idempotency-key

AI:  Created openspec/changes/add-order-idempotency-key/, with a proposal
     and delta spec grounded in what we just found. Ready for implementation.
```

注意这里发生了什么。起点是“出问题了，我害怕去碰它”。二十秒的探索把它变成了一个被命名的根因、三个排序好的选项、一个与你现有代码挂钩的建议、以及一个精确的变更。随后产出的 proposal 之所以犀利，正是因为思考已经先一步完成了。

## 交接给 propose

Explore 不会被归档进任何东西。当你准备好时，你只需开启一个变更，AI 会把你对话中的上下文带进产物里。

```text
explore  ──►  propose  ──►  apply  ──►  archive
 (think)     (agree)       (build)     (record)
```

你可以用大白话说（“我们把这个变成一个变更吧”），也可以直接运行 `/opsx:propose <name>`。无论哪种方式，你刚刚完成的探索都会成为 proposal 的基础，而不是一次性的闲聊。

如果你使用的是扩展命令集，explore 也可以交接给 `/opsx:new`，用于逐步创建产物。参见[工作流](workflows.md)。

## 一次好的探索的诀窍

- **带上问题，而不是解决方案。** “登录感觉很慢”给了 AI 去调查的空间；“加一个 Redis 缓存”则提前把你绑死在一个你还没验证过的答案上。
- **大声地把取舍问出来。** “每种选项的缺点是什么？”能让你得到更诚实的对比。
- **让它先读代码。** 最好的探索都是 AI 真正去看你的代码、而不是瞎猜开始的。如果有帮助，把它指向相关的区域。
- **随时可以收手。** 如果探索发现这个想法不值得做，那就是一种胜利。你以很低的代价学到了这一点。
- **变更中途也可以再次探索。** 在 `/opsx:apply` 时卡住了？你可以退回来探索一个子问题，然后再回去。

## 诚实的取舍

**你得到的是：** explore 在最廉价的时刻——任何产物出现之前——就抓住错误的方向。它在不熟悉的代码库里尤其强大，因为 AI 阅读、归纳整个系统的能力能帮你省下半天去钻代码的时间。

**你付出的是：** 一点耐心。Explore 是一场对话，所以它比你直接甩出 `/opsx:propose` 然后祈祷要慢。对于你确实已经理解透的工作来说，这一步纯属额外开销，你应该跳过它。

经验法则：任务越模糊，explore 越值得；任务越清晰，你越可以直接跳到提议。

## 接下来去哪

- [命令：`/opsx:explore`](commands.md#opsxexplore)：精确的参考说明
- [工作流](workflows.md)：explore 作为日常循环的一部分
- [示例与配方](examples.md#recipe-3-exploring-before-you-commit)：一次完整走查中的 explore
- [快速入门](getting-started.md)：首次变更指南，包含探索
