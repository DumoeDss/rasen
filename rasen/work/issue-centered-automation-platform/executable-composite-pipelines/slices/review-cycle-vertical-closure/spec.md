# ReviewCycle Vertical Closure

> Direction：`executable-composite-pipelines`
>
> 状态：candidate，等待确认

## 用户可见结果

用户对一个真实 Change 启动带独立复审的 ReviewCycle。Reviewer 产生结构化
finding 后，系统在同一个 canonical Change Run 中确定性进入 triage/fix，再由
不同 actor 复审，最终得到明确的 clean、exhausted、escalated 或 cancelled。

中途重启不会重复已提交的 review/fix，不会丢失 open finding，也不会让存在
Blocker/Major 的运行误入 ship。

## 为什么现在验证

当前 root-DAG execution spine 已存在，但 authored v2 和复杂节点不能进入
Runtime。ReviewCycle 是第一个同时需要层级身份、有界循环、结构化领域结果、
独立 actor、安全上限和恢复的真实 Composite。

它以最小的新复杂度证明 ECP 是否真的拥有通用 Composite 内核，而不是继续让
prompt、skill 或命令维护隐藏循环。

## Observable Acceptance

以下条件必须全部由当前代码和运行证据证明：

1. Definition v2 的 `CompositeRef` 与 `BoundedLoop` 能被 prepare、lower 并由
   canonical reconciler 执行，不再返回 `ecp_v2_runtime_unavailable`。
2. ReviewCycle 使用层级稳定身份；round、phase、finding、actor、evidence 和
   exit 均可从 immutable plan + canonical Record 重建。
3. malformed review/triage/fix/re-review result 在 commit 前 fail closed。
4. fixer 与 verifier 为同一 actor 时拒绝提交。
5. open Blocker/Major 存在时，任何正常路径都不能让 ship ready。
6. 达到 max round、stall 或策略上限时明确 exhausted/escalated，不无限循环。
7. 在 review、fix 和 re-review 边界分别重启后，已完成 Action 不重复 admission，
   open finding 和下一 ready action 保持确定。
8. 一个真实 finding 完成
   `review -> triage/fix -> independent re-review -> clean`。
9. `bug-fix` complex 与 `small-feature` 通过同一个 ReviewCycle body 运行。
10. CLI、Management 与 Operations 对 composite path、round、phase、findings、
    actor、evidence、wait 和 terminal 的投影来自同一 ChangeRunView。
11. Canvas 能查看并安全配置该受约束 ReviewCycle/BoundedLoop，不把不可执行形状
    标为可运行。
12. `rasen-review-cycle` 仅作为 launcher/compatibility projection，不拥有
    第二份机械状态。

## Evidence Sources

- Definition/lowerer/reconciler、Run Store 和 projector 的自动化测试；
- malformed result、actor separation、open Major ship guard 和 cap 的失败测试；
- review、fix、re-review 三个边界的 fault-injection 测试；
- CLI、Management、Canvas 和 Operations 使用同一 fixture 的 parity 测试；
- 至少一次真实本地 Change dogfood，记录 revision、RunId、ActionId、actor、
  evidence refs 和最终投影；
- `rasen/changes/ecp-review-cycle/` 的 Change 制品；
- 本 Slice 的 [`result.md`](./result.md)。

## 明确排除

- 通用 Custom Composite 的完整创作体验；
- GoalLoop Measure/Evaluate/Research；
- Choice、FanOut 和 Join；
- `auto-decompose`、Issue Dispatch 和 Issue Board；
- recursive Composite、nested loop 和用户提供的可执行代码；
- Remote Runtime、团队权限、通知和 Forge 集成；
- 完整 ECP 发布收口。

## Authority Alignment

- [`../../target-state.md`](../../target-state.md) 要求机械 loop 由 Reconciler
  所有、一个 Run 只有一份 canonical state；
- [`../../roadmap.md`](../../roadmap.md) 把 ReviewCycle 定为第一个消除
  Composite/BoundedLoop 核心不确定性的纵向 Slice；
- 上位 North Star Horizon 0 要求 Change Pipeline 可恢复、可审计、fail closed，
  并以真实工作闭环而非模块存在作为完成证据。

## Terminal Outcome Vocabulary

Reconcile 本 Slice 时只使用：

```text
passed | partial | failed | superseded | cancelled
```

只有十二项 Observable Acceptance 全部成立时才能记录 `passed`。
