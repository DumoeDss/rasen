# Design: ship-delivery-modes

## Decision 1: 三模式而非"仅 commit"

砍成"仅 commit"会丢掉 pr 模式对其他项目的价值（本工具的模板面向所有使用者，不只本仓库惯例）。ship 的职责拆解为固化（commit）→ 集成（merge base，仅当真的要向该 base 合并时才有语义）→ 交付（push/PR/延迟），三种模式是这三件事的合法组合：

| mode | commit | merge base | test | push | PR |
|------|--------|-----------|------|------|----|
| pr | ✓ | ✓（解析出的 base） | 合并态必测；无新提交时走证据门 | ✓ | ✓ |
| push | ✓ | ✗ | 证据门 | ✓ | ✗ |
| local | ✓ | ✗ | 证据门 | ✗ | ✗ |

解析顺序：显式参数/stage metadata > 现存 PR（mode=pr，base=该 PR 的 base）> 仓库惯例（项目指引、当前分支的 git 历史——一直被直推的分支意味着 push 模式）> 询问用户。**任何一步都不允许"默认 repo 默认分支"**——原实现的 bug 正源于此。

## Decision 2: 证据门的证据定义

绿色测试证据 = 任一持久记录（`review-report.md` / `review-cycle-report.md` / 验证报告 / run-state）中记载的**通过**的测试运行 + **自那次运行以来代码未变**。关键点：

- 证据绑定**代码内容**而非 commit hash——ship 自己的 commit 步骤改变 HEAD 但不改变代码，不作废证据。
- 判定"代码未变"用记录中的 git 状态（运行时的 HEAD + working tree 是否 dirty）对照当前状态；lint 修复、review 修复等任何代码改动作废证据（即原 3e fresh-verification gate 的原则，推广到 3c）。
- 证据缺失时**跑测试**（保守默认）——证据门是"有证据才跳过"，不是"没证据也跳过"。

记录侧契约（本 change 一并落地）：review-cycle 的 cycle report 记录最终 clean 轮的测试/门禁命令、结果、git 状态；bug-fix adaptive verify 把单测门证据记入 run-state。

## Decision 3: decompose 子 change 固定 local，组合级统一交付

子 change 共享工作树（playbook Step G.4），按子逐个 push/PR 既无意义（同一分支）也危险（把半成品组合推出去）。规则：

- 子 change 的 ship 阶段 = local 模式（仅 commit）。
- 全部子 change 完成后，LEAD 在父/组合层解析交付模式并执行**恰好一次** push/PR。
- 部分失败时：已完成子 change 的 commit 保留在本地，**不 push**——升级上报，绝不交付半个组合。

## Decision 4: 范围排除

- `verify-change.ts` 不动：在 parity 哈希白名单内（函数×2 + 内容×1），且其验证是静态分析（completeness/correctness/coherence），不运行测试，本来就不是证据来源。
- PR Body from Proposal、Optional Land-and-Deploy 两个需求不动：本就仅在 pr 模式路径上执行，语义不变。
- pipeline registry / schema 不动：模式解析写在指令契约里（这些模板是给 agent 的自然语言契约），stage metadata 传参属于"显式参数"一档，无需 schema 字段变更。
