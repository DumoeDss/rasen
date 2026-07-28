# ECP ReviewCycle Vertical Closure Plan

> 状态：superseded。当前计划见
> [`executable-composite-pipelines/slices/review-cycle-vertical-closure/plan.md`](../../executable-composite-pipelines/slices/review-cycle-vertical-closure/plan.md)。
>
> 本文件仅保留拆分前历史，不再用于 Change 投影。

## Delivery Boundary

- 目标项目：当前 Rasen 仓库
- Direction Slice：`ecp-review-cycle-vertical-closure`
- 主要 Change 边界：现有 `rasen/changes/ecp-review-cycle/`
- 前置实现：`ecp-definition-v2` 与 `ecp-run-spine`
- 执行方式：Codex 直接修改并运行项目测试；不调用 `rasen pipeline`
- 并行策略：串行。Definition、runtime、projection 和 UI 共用同一契约，不存在
  可信的无重叠并行分组。

## Entry Evidence

开始 ReviewCycle 实现前必须核实：

1. Definition v2 当前 wire/normalization/compiler contract；
2. root-DAG RuntimePlan、Run Record、reducer、facade 和 projector 的真实接口；
3. `ecp-run-spine` 16.1–16.6 尚未关闭的验证 gate；
4. current `bug-fix` complex 和 `small-feature` 的 legacy/prompt-owned 路径；
5. Canvas 与 Management API 对 later-slice node kind 的当前限制。

未验证的前置不能因 tasks checkbox 或文件存在而视为完成。若 spine 缺陷阻止
ReviewCycle，先修复同一 canonical seam；不建立临时第二 Runtime。

## Implementation Sequence

### 1. Contract and failing tests

- 固定 ReviewCycle domain result schema、actor/evidence invariants 和退出词汇；
- 为 `CompositeRef + BoundedLoop` lowering 写失败测试；
- 为层级 identity、round admission、cap、ship guard 和恢复边界写失败测试；
- 复用现有 ChangeRun facade，不增加公开 sibling runtime。

### 2. Generic composite mechanics

- 将 v2 composite/loop lowering 接入 immutable ChangeRunPlan；
- 扩展 closed plan algebra 和纯 reconciler；
- 在 canonical Record 中记录 loop frame、round、child path 和 outcome；
- 保持 ActionId/idempotency、CAS commit 和 engine ownership 约束。

### 3. ReviewCycle domain reducer

- 实现 review、triage、fix、re-review 的 typed result validation；
- 维护 findings lifecycle、actor separation、evidence 和 open severity；
- 实现 passed/exhausted/escalated/cancelled 的显式退出；
- fail closed 地阻止带 open Blocker/Major 的 ship。

### 4. Built-in migration

- 将 `bug-fix` complex 路径 lower 到 ReviewCycle；
- 将 `small-feature` 迁移到相同 ReviewCycle body；
- legacy wrapper 只读取或启动 canonical Run，不再机械推进自己的循环。

### 5. Cross-plane projection

- 扩展 ChangeRunView 的 composite path、round、phase、findings、actors、
  evidence、limits 和 decisions；
- CLI 与 Management 消费同一 projector；
- Canvas 支持 ReviewCycle/BoundedLoop 的受约束编辑；
- Operations 展示同一投影，不推导或回写第二份状态。

### 6. Verification and dogfood

- 运行 spine focused/regression suites，补齐其未关闭 gate 中与本 Slice 相关的
  真实证据；
- 运行 Definition、runtime、CLI、Management、UI、typecheck 和 build；
- 执行 finding -> fix -> independent re-review 的真实本地 dogfood；
- 在三个 quiescent boundary 注入重启并验证无重复 admission；
- 将命令、结果、已知限制和 terminal 判断追加到 `result.md`。

## Safe Parallelism

本 Slice 不拆并行代码工作。只允许互不写状态的只读检查并行执行，例如独立
测试命令或静态搜索；任何共享 contract 修改保持串行。

## Evidence To Return

- 精确测试命令、退出码和覆盖的 acceptance 条目；
- 关键 fixture/Run 的稳定标识和最终 ChangeRunView；
- malformed、same-actor、open-Major、cap 和 crash 恢复的失败证据；
- built-in migration 与 legacy compatibility 的调用图证据；
- 尚未达到的 acceptance 条目，不以“无失败”替代证明。

## Direction Sources

- `rasen/work/issue-centered-automation-platform/north-star.md`
- `rasen/work/issue-centered-automation-platform/goal.md`
- `rasen/work/issue-centered-automation-platform/roadmap.md`
- `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/README.md`
- `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/deterministic-pipeline-kernel-research.md`
- `docs/architecture/executable-composite-pipelines.md`
- `docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md`
