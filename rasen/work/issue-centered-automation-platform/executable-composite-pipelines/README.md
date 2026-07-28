# Executable Composite Pipelines

这是独立的 `executable-composite-pipelines` Direction，嵌套在
`issue-centered-automation-platform` 的 Horizon 0 下。它负责从当前 root-DAG
spine 推进到真实完整 ECP，并在完成后把可靠的 Change execution substrate
交还给父级 Issue 路线。

本 Direction 继承父级 North Star，不复制第二份长期原则。权威顺序是：

```text
../north-star.md
  -> target-state.md
      -> roadmap.md
          -> slices/<selected-slice>/spec.md
              -> slices/<selected-slice>/plan.md
                  -> Change planning artifacts
```

## 当前状态

- 当前只完成了 root-DAG execution spine，尚未完成完整 ECP；
- 7 个内置 Pipeline 尚未全部迁移到 canonical reconciler；
- authored v2、CompositeRef、BoundedLoop、GoalLoop、FanOut 和 Join 尚未形成
  Definition → Canvas → Runtime → Operations → E2E 的完整闭环；
- 当前 Direction 状态为 `draft`，尚未激活 Slice；
- 候选首个 Slice 是
  [`review-cycle-vertical-closure`](./slices/review-cycle-vertical-closure/spec.md)。

## 目录内容

- [`deterministic-pipeline-kernel-research.md`](./deterministic-pipeline-kernel-research.md)：
  ECP 领域模型、确定性 Reconciler、Canvas、运行记录和迁移策略的核心研究；
- [`../roadmap.md`](../roadmap.md#0-2026-07-29-校准先完成-ecp再进入-issue-层)：
  ECP 完成判据、五个纵向闭环及其顺序；
- [`../../../../docs/architecture/executable-composite-pipelines.md`](../../../../docs/architecture/executable-composite-pipelines.md)：
  当前架构说明；
- [`../../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md`](../../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md)：
  0.1.6 真实完成度审查和证据基线。

## 当前工作边界

```text
NOW（候选，等待确认）
  ReviewCycle Vertical Closure

LATER
  Custom Composite
    -> GoalLoop
      -> Choice / FanOut / Join
        -> ECP 产品与发布闭环
          -> Issue 层路线

NOT NOW
  auto-decompose、Issue Dispatch、跨项目执行图、
  Remote Runtime、团队权限、通知和 Forge 平台增强
```

所有 ECP Slice 都必须贯穿 Definition、Canvas、Runtime、Operations 和真实
E2E。文件、schema、API、UI mock 或单元测试的存在不能单独证明完成。

## 后续制品放置规则

- ECP 的 Target State、Roadmap、Slice、方向研究和决策说明放在本目录；
- 父级只保留上位 North Star 和 ECP 完成后的 Issue 路线，不复制 ECP active
  Slice；
- 正式 Slice 制品放到本目录的 `slices/<slice-id>/`；
- Change spec、design、tasks 和 run-state 继续由 `rasen/changes/` 及 Runtime
  管理；
- 原始运行、Git、PR、发布和 dogfood 证据留在各自权威来源，本目录只引用，
  不复制成第二份状态真相。

## Direction 文件

- [`work.yaml`](./work.yaml)：薄生命周期索引；
- [`target-state.md`](./target-state.md)：完整 ECP 的产品结果、边界和完成证据；
- [`roadmap.md`](./roadmap.md)：从 ReviewCycle 到产品发布闭环的 Slice 顺序；
- [`slices/review-cycle-vertical-closure/`](./slices/review-cycle-vertical-closure/)：
  候选首个纵向 Slice。
