# ECP ReviewCycle Vertical Closure

> 状态：superseded（仅规划位置被取代；未作交付完成判断）
>
> 所属 Direction：`issue-centered-automation-platform`
>
> 替代位置：
> [`executable-composite-pipelines/slices/review-cycle-vertical-closure`](../../executable-composite-pipelines/slices/review-cycle-vertical-closure/spec.md)

本文件保留为拆分前历史记录。当前 Target State、Roadmap、Slice 边界和验收以
新的 `executable-composite-pipelines` Direction 为准。

## 用户可见结果

用户对一个真实 Change 启动带独立复审的 ReviewCycle。Reviewer 产生结构化
finding 后，系统在同一个 canonical Change Run 中确定性地进入 triage/fix，
再由不同 actor 复审，最终只会得到以下明确结果之一：

- 所有阻断 finding 已关闭，允许继续 ship；
- 达到轮次、stall 或策略上限，明确 `exhausted`；
- 缺少能力、证据或人工决策，明确 `escalated`；
- 用户显式取消，明确 `cancelled`。

中途重启不会重复已提交的 review/fix，不会丢失 open finding，也不会让存在
Blocker/Major 的运行误入 ship。

## 为什么现在验证

当前 root-DAG execution spine 已存在，但 authored v2 和复杂节点仍不能进入
Runtime。ReviewCycle 是第一个同时要求层级身份、有界循环、结构化领域结果、
独立 actor、失败上限和恢复的真实 Composite。它能用最小的新节点集合证明
ECP 是否确实拥有一个通用内核，而不是继续为每条命令维护 prompt-owned loop。

## Observable Acceptance

以下条件必须全部由当前代码和运行证据证明：

1. Definition v2 的 `CompositeRef` 与 `BoundedLoop` 能被 prepare、lower 并由
   canonical reconciler 执行；不再返回 `ecp_v2_runtime_unavailable`。
2. ReviewCycle 使用层级稳定身份，round/phase/finding/actor/evidence/exit 均由
   canonical Run Record 派生。
3. malformed review/triage/fix/re-review result 在 commit 前 fail closed。
4. fixer 与 verifier 为同一 actor 时拒绝提交。
5. open Blocker/Major 存在时，任何 cap、cancel 之外的路径都不能让 ship ready。
6. 在 review、fix 和 re-review 边界分别重启后，已完成 Action 不重复 admission，
   open finding 和下一 ready action 保持确定。
7. 一个真实 finding 完成
   `review -> triage/fix -> independent re-review -> passed`。
8. `bug-fix` complex 与 `small-feature` 通过同一个 ReviewCycle plan 运行。
9. CLI/Management/Operations 对 round、phase、findings、actor、evidence、wait 和
   terminal 的投影来自同一个 ChangeRunView。
10. `rasen-review-cycle` 仅作为兼容 launcher/projection，不拥有第二份机械状态。

## Evidence Sources

- Definition/lowerer/reconciler、Run Store 和 projector 的自动化测试；
- malformed result、actor separation、open Major ship guard 和 cap 的失败测试；
- review/fix/re-review 三个恢复边界的 fault-injection 测试；
- CLI、Management 和 UI 使用同一 fixture 的 parity 测试；
- 至少一次真实本地 Change dogfood 记录，包括命令、RunId、ActionId、证据引用
  和最终投影；
- `rasen/changes/ecp-review-cycle/` 的实现与验证制品；
- 本 Slice 的 `result.md`。

## 明确排除

- 通用 Custom Composite 创作；
- GoalLoop Measure/Evaluate/Research；
- Choice、FanOut 和 Join；
- `auto-decompose`、Issue Dispatch 与 Issue Board；
- recursive Composite、nested loop 和用户提供的可执行代码；
- Remote Runtime、团队权限、通知和 Forge 集成；
- 0.1.6 全产品发布收尾。

## Authority Alignment

- North Star Horizon 0 要求 Change Pipeline 有持久 run-state、确定性 Gate、
  有界反馈、恢复和外部证据；
- legacy Target State input `goal.md` 要求 Change Run 成为后续 Issue 执行层的
  可靠基础；
- Roadmap ECP-1 明确要求先证明 ReviewCycle 纵向闭环，再开放 Custom
  Composite 或其他复杂度维度。

## Terminal Outcome Vocabulary

Reconcile 本 Slice 时只使用：

```text
passed | partial | failed | superseded | cancelled
```

只有十项 Observable Acceptance 全部成立时才能记录 `passed`。
