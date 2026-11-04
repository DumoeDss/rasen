# Executable Composite Pipelines

这是独立的 `executable-composite-pipelines` Direction，嵌套在
`issue-centered-automation-platform` 的 Horizon 0 下。它负责在 **0.2.0** 完成
Change-level ECP，并在通过发布门后把可靠的 execution substrate 交给
**0.3.0** 的 Issue/Dispatch 路线。

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

**已校准：2026-08-01，Git revision
`14ed62bc088197294f4a219ff20e946a6a99691d`，分支 `dev/0.2.0`。**

- ECP-1..5 的实现组合已经合入：ReviewCycle、Custom Composite、GoalLoop、
  Choice/FanOut/Join、Operations 和 Product Closure 的主要 runtime 能力存在；
- **7 个内置 Pipeline 中 6 个由 reconciler 真实执行**（`bug-fix`、
  `small-feature`、`full-feature`、三个 goal-loop），真实 CLI 逐个核过；
  第 7 个 `auto-decompose` 报 `execution_profile_unavailable` 并 fail-closed
  —— 这是 0.3.0 Issue/Dispatch 边界，不是 0.2.0 ECP 缺陷；
- authored v2 与组合原语已经可执行，但**新建入口、空白 Canvas 和全部 built-in
  源仍默认 authored v1**；兼容编译存在，不等于 v2 已成为公开创作真相；
- Canvas 可以创建 `CompositeRef`/`BoundedLoop` 和 declaration body，但
  FanOut/Join、GoalLoop 专用创作、完整 loop policy/exits 仍未达到研究稿要求；
- 通用 `BoundedLoop` contract 尚未完整表达 stalled/blocked/human escalation，
  已授予 agent action 也仍由 launcher 执行，尚无独立 Session executor；
- ECP-5 仍缺真正的自宿主 Change、当前完成度复审、文档/版本/发布一致性证据。

因此 Direction 保持 `active`，总体 Result 为 **partial**。当前没有
`activeSlice`；[`roadmap.md`](./roadmap.md) 已将 ECP-6 列为唯一 NOW 候选。

## 目录内容

- [`deterministic-pipeline-kernel-research.md`](./deterministic-pipeline-kernel-research.md)：
  ECP 领域模型、确定性 Reconciler、Canvas、运行记录和迁移策略的核心研究；
- [`../roadmap.md`](../roadmap.md#0-2026-07-29-校准先完成-ecp再进入-issue-层)：
  ECP 完成判据、五个纵向闭环及其顺序；
- [`../../../../docs/architecture/executable-composite-pipelines.md`](../../../../docs/architecture/executable-composite-pipelines.md)：
  当前架构说明；
- [`../../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md`](../../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md)：
  早期 root-DAG 阶段的历史完成度审查，不再代表当前状态；
- [`../../../../docs/audits/0.2.0-ecp-gap-calibration-2026-08-01.md`](../../../../docs/audits/0.2.0-ecp-gap-calibration-2026-08-01.md)：
  当前缺口、证据和版本边界的校准记录。

## 当前工作边界

```text
NOW（候选，等待确认）
  ECP-6 v2 Authoring and Loop Contract Closure

LATER
  ECP-7 Session Execution and Self-hosting
    -> ECP-8 Completion Audit and Release Truth
      -> 0.3.0 Issue / Dispatch

NOT NOW
  0.3.0 auto-decompose、Issue Dispatch、跨项目执行图、
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
- [`roadmap.md`](./roadmap.md)：0.2.0 剩余 ECP 收口 Slice 与证据顺序；
- [`slices/review-cycle-vertical-closure/`](./slices/review-cycle-vertical-closure/)：
  已交付 ReviewCycle 的历史 Slice 证据。
