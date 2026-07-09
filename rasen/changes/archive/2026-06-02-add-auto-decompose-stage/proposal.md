## Why

`/opsx:auto` 始终只针对**单个** change 驱动整个工作流：分类阶段只挑选一条*流水线*（`small-feature` / `full-feature` / `bug-fix`），`propose` worker 只运行一次 `openspec new change`，而且 LEAD 的 playbook 与运行状态都被限定在单个 `openspec/changes/<name>/` 内。整个流程没有任何一步能把一个庞大或多面向的任务拆分成多个内聚、可独立交付的 change。

结果就是：大任务被硬塞进一个过度膨胀的 change。每个 change 的 `apply → review → fix` 循环只能验证那一个巨型 diff——而这恰恰是 OpenSpec 本应避免的、无法 review、无法 merge 的形态。LEAD 应当能够——在运行时、根据任务本身——决定是否把工作扇出（fan out）成多个 change，然后驱动每一个 change 走完它自己的流水线，**严格遵守依赖顺序**，绝不并行化任何无法证明相互独立的工作。

## What Changes

- **在流水线注册表中新增 `decompose` 阶段类型。** 在 stage schema 中增加一个 `kind` 字段（默认 `standard`，新增 `decompose`）。`decompose` 阶段被 LEAD 解释为一个*扇出*点，而非单次 skill 调用。新增/放宽的字段：可选的 `childPipeline`（每个子 change 运行的流水线），以及针对 `kind: decompose` 放宽的 `skill` 要求。注册表校验强制要求：**至多一个** decompose 阶段、它必须是**第一个**阶段，且 `childPipeline` 必须解析到一条已存在且其自身**不含 decompose** 的流水线（递归防护）。

- **Decompose 是 `/opsx:auto` 内部的一个条件性首步，而非独立命令。** 当 auto 运行时，LEAD 评估任务，然后二选一：(a) **跳过** decompose，像今天一样在单个 change 上继续；或 (b) **执行** decompose 并扇出。选择权在 LEAD，依据任务本身得出。当 decompose 被执行时，LEAD **自审**拆分方案（切片内聚性、独立性依据、依赖 DAG）并**自动**继续——**默认无需人类批准**；仅当它无法形成一份安全方案时，才升级给人类。（用户随时仍可中断。）

- **LEAD playbook 中的组合（portfolio）编排。** 当 decompose 被执行时，LEAD 产出一份**拆分方案**：一组子 change（每个对应 `openspec new change <child-id>`）外加它们之间的**依赖 DAG**，随后为每个子 change 运行 `childPipeline`（propose → apply → verify → review-loop → …）。父 change 退化为一个规划容器；其自身的下游阶段被委派给各个子 change。

- **保守的串行/并行执行策略。** 由依赖边连接的子 change **严格按拓扑顺序串行**运行——在每一个前置子 change 都已实现且 review 干净之前，依赖它的子 change 流水线不会启动。相互独立的子 change **仅当** LEAD 能够积极地确证其独立性（无依赖边*且*触及的能力/规格/文件无重叠）**且**宿主为 Tier A（agent-teams）时，才**可以**并行运行。当独立性不确定时，LEAD **默认串行**。并行从来不是默认行为；正确性优先于速度。

- **组合运行状态（多 change 可观测性 + 恢复）。** 在父 change 目录下有一份父级记录，记载拆分方案、子 change 列表、依赖 DAG、执行模式（串行/并行）、每个子 change 的流水线状态，以及当前的前沿（frontier）。每个子 change 仍保留它自己的、按 change 计的 `auto-run.json`。恢复时从组合记录 + 各子状态重建前沿。

- **递归防护 + 子隔离。** 每个组合中 decompose 至多运行一次，且仅在顶层；子流水线运行绝不会再次 decompose。

## Capabilities

### New Capabilities
<!-- 无。本次 change 扩展了由进行中的 `upgrade-auto-orchestrated-pipelines` change 引入的三项能力。 -->

### Modified Capabilities
- `opsx-pipeline-registry`：向 stage schema 增加 `decompose` 阶段类型（`kind` 字段、`childPipeline`、放宽的 `skill`），以及保障其安全的校验规则（唯一、首位、子流水线不含递归）。
- `opsx-orchestration`：增加组合级编排——拆分方案、由依赖 DAG 驱动的严格串行执行、仅在可证明独立时才并行且默认保守串行的规则、组合运行状态，以及递归防护。
- `opsx-auto-command`：将 decompose 加为 LEAD 的条件性首步（执行与否由任务判定）、由 LEAD **自审**拆分方案（默认无需人类批准、仅在无法形成安全方案时升级），以及组合恢复。

## Impact

- **Stacking 顺序**：`opsx-pipeline-registry`、`opsx-orchestration` 与 `opsx-auto-command` 由仍在进行中的 `upgrade-auto-orchestrated-pipelines` change 引入。本次 change **stack 在其之上**，并且必须在它**之后**归档。此处的 deltas 使用 `## ADDED Requirements`（不修改那条 change 尚未成为正典的需求）。
- **自包含、不硬依赖 stacking 元数据**：跨 change 的依赖 DAG 记录在**组合运行状态**中，而非每个 change 的元数据里。已提出但尚未构建的 `add-change-stacking-awareness`（`dependsOn` / `parent` / `openspec change split|graph|next`）**并非**必需。当它落地后，decompose **应当**额外产出 `dependsOn`/`parent` 元数据并复用 `change graph`/`split`；在此之前，组合状态为权威来源。
- **代码**：
  - `src/core/pipeline-registry/types.ts` —— `StageSchema` 上的 `kind` 字段、`childPipeline`、条件性的 `skill` 要求。
  - `src/core/pipeline-registry/graph.ts` / `resolver.ts` —— 感知 decompose 的 build-order + 子流水线解析。
  - `src/core/pipeline-registry/run-state.ts` —— 组合运行状态 schema（或一个同级模块）+ 读写器。
  - `src/commands/pipeline.ts` —— 针对 decompose 阶段的 `validate --type pipeline` 规则；`show` 将其呈现出来。
  - `src/core/templates/workflows/_orchestration.ts` —— 组合编排章节（方案、串行/并行策略、递归防护）。
  - `src/core/templates/workflows/auto.ts` —— 将 decompose 作为条件性首步 + 方案 gate + 组合恢复。
  - `pipelines/*/pipeline.yaml` —— 让某条内置流水线选用一个起首的 decompose 阶段（以及一条不含 decompose 的子流水线）。
- **文档**：`docs/opsx-workflow-guide.md`（§2.1「每个 change 各自一支 worker 团队」的承诺将成真），外加 `docs/commands.md`。
- **测试**：stage-schema 校验（decompose 规则）、组合运行状态往返、含 decompose 阶段的 build-order，以及 resolver 递归防护。
