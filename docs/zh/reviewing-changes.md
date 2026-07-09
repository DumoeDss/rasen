# 审查变更

OpenSpec 的全部承诺在于：你和你的 AI **在写下任何代码之前就构建什么达成一致。** 这份一致只有在你真正读过 AI 起草的内容时才有意义。本页讲的就是你做这件事的那两分钟——打开什么、按什么顺序、找什么。

这个赌注很简单：在一页纸的方案里抓住一个错误方向几乎不花成本。在 300 行代码里抓住同样的错误方向则不然。审查就是你兑现这个赌注的地方。

## 你审查的两个时刻

恰好有两个：

```
/rasen:propose ──► REVIEW THE PLAN ──► /rasen:apply ──► REVIEW THE CODE ──► /rasen:archive
                  (before any code)                    (/rasen:verify)
```

1. **在 `/rasen:propose`（或 `/rasen:ff`）之后、`/rasen:apply` 之前** —— 趁方案还只是一堆文字时读它。
2. **在构建之后**，用 `/rasen:verify` —— 检查代码是否真的做到了方案所说的。

第一次审查为你省下的最多，也是人们最常跳过的一次。本页把大部分篇幅花在它上面。

## 按这个顺序读

一个变更是 `rasen/changes/<name>/` 里的一堆纯 Markdown。按能让你在出错时最早抽身的顺序来读这些文件：

```
rasen/changes/add-dark-mode/
├── proposal.md      1. the intent and scope   ← if this is wrong, stop here
├── specs/…/spec.md  2. the requirements       ← the heart of the review
├── design.md        (only for bigger changes) — the technical approach
└── tasks.md         3. the plan of work
```

你不必逐行读。你需要回答三个问题，每个文件一个。

## 提案：这是正确的问题吗？

先打开 `proposal.md`。它捕捉的是"为什么"和"做什么"——意图、范围、用一两段话讲清的方法。

**好的样子：** 一个清晰的意图、一个你认可的范围、以及一个现在值得做的理由。

**危险信号：**

- 它解决的是一个和你所要求的*略有不同*的问题。
- 范围膨胀了——你要的是一个主题开关，提案却"顺手"也动了认证。
- 它很含糊。"改进设置页面"不是一个范围；"添加一个尊重系统偏好的深色模式开关"才是。

**要回答的问题：** *这和我实际要求的一致吗，有没有什么东西悄悄溜进来？* 如果答案是否定的，就停下——不要再往下读，去修提案（参见[把变更打回去](#把变更打回去很便宜)）。

## 规格增量："完成"被定义对了吗？

这是审查的核心。`specs/` 下的增量规格说明了当变更发布时什么会变成*真的*——以需求及证明它们场景的形式：

```markdown
## ADDED Requirements

### Requirement: Dark Mode Toggle
The system SHALL let a user switch between light and dark themes.

#### Scenario: Respects the OS preference on first load
- GIVEN a user who has never set a theme
- WHEN they open the app on a device set to dark mode
- THEN the app renders in dark mode
```

**一条好需求的样子：** 一条清晰的、你可以交给测试人员的 `SHALL`/`MUST` 陈述，以及至少一个其 GIVEN/WHEN/THEN 真正检验该陈述的场景。

**危险信号：**

- **一条含糊的需求。** "系统 SHALL 要快"无法被构建或测试。什么是快？
- **一条没有场景的需求**，或者一个并不检验它所属需求的场景。
- **所有之中最有价值的发现：缺失了什么。** AI 忠实地写下你*说过*的话。你的工作是注意到你*忘了*说的东西。如果你最在意的是系统偏好的情形，而没有场景提到它，那这次审查就值回票价了。

读增量时问自己：*如果系统恰好做到——并且只做到——这些，我会满意吗？* 这里还没有任何关于代码的内容，所以改动成本仍然很低。

## 任务：工作计划合理吗？

最后打开 `tasks.md`。它是 AI 将要逐步完成的实现清单。

**好的样子：** 有序的步骤，每一步都能追溯到一条需求，没有任何神秘之处。

**危险信号：**

- 一个没有对应需求的任务（它从哪来的？）。
- 一个巨大的"实现这个功能"任务，把所有真正的决策都藏起来了。
- 一个触及你刚批准的范围之外事物的任务。

你在这里不是在做估算或微观管理——你是在检查计划是否匹配你已经接受的需求。

## 把变更打回去很便宜

如果三个问题中任何一个的答案不对，就说出来。没有阶段之分，也没有任何东西被锁死——你修好它然后继续。两种方式，正如[编辑变更](editing-changes.md)中所述：

- **自己编辑文件。** 它是纯 Markdown；改掉范围那一行、收紧一条需求、删掉一个任务。
- **告诉 AI 哪里不对**，让它修订：*"去掉认证的改动——超出范围，"* *"加一个为用户已经选过主题的情形准备的场景，"* *"把任务 3 拆成 schema 和 UI。"*

然后重读你改过的部分。重写直到它成为一份你愿意署名的方案。这种来回拉锯*本身*就是产品在正常工作。

## 代码之后：验证

工作构建完成后，`/rasen:verify` 是你的第二次审查。它重新读一遍产物和代码，并从三个维度报告不匹配之处：

| 维度 | 检查内容 |
|-----------|----------------|
| **完整性（Completeness）** | 每个任务完成、每条需求已实现、场景已覆盖 |
| **正确性（Correctness）** | 实现匹配规格意图、边界情况已处理 |
| **一致性（Coherence）** | 设计决策确实体现在代码中 |

```
You: /rasen:verify

AI:  Verifying add-dark-mode...

     COMPLETENESS
     ✓ All 8 tasks in tasks.md are checked
     ✓ All requirements in specs have corresponding code
     ⚠ Scenario "Respects the OS preference on first load" has no test coverage
```

它把问题标记为 CRITICAL、WARNING 或 SUGGESTION，并且**不会**阻止归档——它把差距摆出来，把决定留给你。这就是"AI 写了代码"和"它构建了我们一致同意的东西"之间的区别。

`/rasen:verify` 属于扩展模式。如果你没有它，用 `rasen config profile`（然后 `rasen update`）开启，或者干脆自己重读一遍变更和 diff。

## 给审查定好大小

并非每个变更都值得完整的通读。一个单文件的拼写修正配得上 20 秒的一瞥。一个触及认证、支付、或你无法恢复的数据的变更，配得上上面的每一个问题。重点从来不是仪式——而是把注意力花在错误会代价惨重的地方，在不重要的地方一扫而过。

## 两分钟清单

- [ ] 提案的意图和我要求的一致。
- [ ] 没有任何额外的东西悄悄溜进范围。
- [ ] 每条需求都具体到可以测试。
- [ ] 每条需求都有一个真正检验它的场景。
- [ ] 我最在意的那个情形已被覆盖。
- [ ] 任务能映射到需求；没有任何神秘之处或超出范围。
- [ ] 如果 AI 恰好构建出这个、且不多做一点，我会感到放心。

如果全部七条通过，就放心地运行 `/rasen:apply`。如果有任何一条失败，那不是挫折——而是这两分钟在发挥作用。

## 下一步去哪

- [编写好的规格](writing-specs.md) —— 另一面：如何起草值得批准的需求和场景。
- [编辑与迭代变更](editing-changes.md) —— 开始之后修改方案的机制。
- [工作流](workflows.md) —— 审查在更大循环中的位置。
