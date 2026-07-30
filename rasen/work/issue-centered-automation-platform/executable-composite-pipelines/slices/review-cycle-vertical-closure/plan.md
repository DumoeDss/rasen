# ReviewCycle Vertical Closure Plan

## Delivery Boundary

- 目标项目：当前 Rasen 仓库；
- Direction：`executable-composite-pipelines`；
- Slice：`review-cycle-vertical-closure`；
- 主要 Change 边界：复用现有 `rasen/changes/ecp-review-cycle/`；
- 前置事实：`ecp-definition-v2` 已完成，`ecp-run-spine` 的未关闭验证项必须先
  核实或明确 disposition；
- Downstream workflow：本 Direction 被确认后，再将 Slice 投影到现有 Change；
- 并行策略：contract 与 runtime 改动串行；只读审查和互不写状态的验证可并行。

本计划只规定 Change 边界、顺序和应返回的证据，不代替 Change proposal、
design、specs 或 tasks。

## Entry Evidence

投影前必须重新核实：

1. Definition v2 当前 wire、normalization 和 compiler contract；
2. root-DAG RuntimePlan、Run Record、reducer、facade 和 projector 的真实接口；
3. `ecp-run-spine` 16.1–16.6 尚未关闭的验证 gate；
4. association runtime archive Action path 的 deferred disposition；
5. `bug-fix` complex、`small-feature` 和 `rasen-review-cycle` 的 prompt-owned 路径；
6. Canvas、Management 和 Operations 对 complex node kind 的当前限制；
7. 架构文档与 Target State 对版本范围是否已统一。

未验证的前置不能因 checkbox、PR merge 或文件存在而视为完成。若 spine 缺陷
阻止 ReviewCycle，必须在同一 canonical seam 修复，不能建立临时 sibling runtime。

## Change Projection

优先复用现有 `ecp-review-cycle` Change shell。投影时只传递：

- 本 Slice 的用户结果；
- 十二项 Observable Acceptance；
- 明确排除项；
- 当前仓库目标上下文；
- Target State、Roadmap、Slice spec/plan 的引用和 revision。

若前置 ledger closure 需要独立交付，可使用一个小的验证收口 Change，但它仍属于
本 Slice 的入口依赖，不能被单独记为 Slice `passed`。

## Delivery Sequence

### 1. Contract and failure-first evidence

- 锁定 ReviewCycle domain result、actor/evidence invariant 和 exit vocabulary；
- 先定义 CompositeRef/BoundedLoop lower、identity、cap、ship guard 和 recovery
  的失败证据；
- 确认公开 facade 与 canonical Record 仍是唯一 runtime seam。

### 2. Generic composite mechanics

- 接入 v2 Composite/BoundedLoop lowering；
- 扩展 closed plan algebra 与 pure reconciler；
- 为 composite frame、round、child path 和 outcome 建立稳定 identity；
- 保持 ActionId/idempotency、CAS commit、engine ownership 和 effect recovery。

### 3. ReviewCycle domain behavior

- 结构化校验 review、triage、fix 和 re-review；
- 维护 finding lifecycle、actor separation、evidence 和 open severity；
- 显式处理 clean、exhausted、escalated 和 cancelled；
- fail closed 阻止 open Blocker/Major 进入 ship。

### 4. Built-in and launcher migration

- 将 `bug-fix` complex 路由到 ReviewCycle；
- 将 `small-feature` 迁移到同一 body；
- 让 standalone review-cycle 入口只选择/启动/投影 canonical Run；
- legacy artifacts 只能派生，不能反向推进。

### 5. Cross-plane parity

- 投影 composite path、round、phase、findings、actors、evidence、limits 和
  decisions；
- CLI 与 Management 消费同一 projector；
- Canvas 提供本 Slice 所需的受约束查看/配置；
- Operations 展示同一状态且不维护独立进度。

### 6. Recovery, verification and dogfood

- 运行 root-spine 回归、Definition、runtime、CLI、Management、UI、typecheck
  和 build；
- 在 review、fix、re-review 三个 quiescent boundary 注入重启；
- 完成 finding -> fix -> independent re-review 的真实本地 dogfood；
- 把命令、revision、稳定标识、结果、限制和 terminal 判断写回 `result.md`。

## Safe Parallelism

本 Slice 不拆分并行代码工作，因为 Definition、runtime、projection 与 UI 共享同一
契约。只允许以下互不写状态的并行活动：

- 独立静态审查；
- 已冻结 fixture 上的测试；
- 只读 support matrix 和 ledger 核对。

## Evidence To Return

- 精确命令、退出码、revision 和对应 acceptance 条目；
- 关键 fixture/Run 的稳定标识与最终 ChangeRunView；
- malformed、same-actor、open-Major、cap 和 crash recovery 的失败证据；
- built-in migration 与 legacy compatibility 的调用图证据；
- Canvas/CLI/API/Operations parity 证据；
- 真实 dogfood 的 actor、workspace revision、result 和 evidence refs；
- 所有尚未满足的条目，不以“没有观察到失败”替代证明。

## Direction Sources

- [`../../target-state.md`](../../target-state.md)
- [`../../roadmap.md`](../../roadmap.md)
- [`../../deterministic-pipeline-kernel-research.md`](../../deterministic-pipeline-kernel-research.md)
- [`../../../../../../docs/architecture/executable-composite-pipelines.md`](../../../../../../docs/architecture/executable-composite-pipelines.md)
- [`../../../../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md`](../../../../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md)
