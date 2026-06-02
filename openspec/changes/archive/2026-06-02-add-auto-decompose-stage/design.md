## Context

`/opsx:auto` 在构造上就是单 change 的。`auto.ts` 把任务分类成一条*流水线*；`propose` worker 恰好调用一次 `openspec new change`；`_orchestration.ts` 通过单个 `openspec/changes/<name>/` 黑板进行交接；而 `run-state.ts`（`auto-run.json`）只跟踪一个 change。stage schema（`pipeline-registry/types.ts` 中的 `StageSchema`）没有任何扇出的概念——每个阶段都指定一个 `skill`（必填，`min(1)`），由 LEAD 调用一次。唯一的循环类型是 `review-cycle`。

`docs/opsx-workflow-guide.md` §2.1 已经承诺「不同 change 各自一支 worker 团队、互不串扰」，但实现中没有任何东西真正产出多于一个 change，所以这个承诺目前是空的。本次 change 通过加入一个 **decompose** 扇出点把它变为现实。

被扩展的三项能力（`opsx-pipeline-registry`、`opsx-orchestration`、`opsx-auto-command`）尚未成为正典——它们存在于进行中的 `upgrade-auto-orchestrated-pipelines` change 里。本次 change stack 在其之上，并且只使用 `ADDED` deltas。

## Goals / Non-Goals

**Goals（目标）：**
- 在注册表中提供一个一等公民的 `decompose` **阶段类型**，由 LEAD 解释为扇出点。
- Decompose 作为 **`/opsx:auto` 内部的条件性首步**运行——LEAD 根据任务决定执行还是跳过；没有独立命令。
- 当被执行时，驱动**多个子 change**，每个都走完既有的、按 change 计的流水线（propose → apply → verify → review-loop → …）。
- 沿依赖边**严格串行**执行；**仅当独立性被证明**且宿主为 Tier A 时才**并行**；**保守默认 = 串行**。
- 一份让多 change 运行可观测、可恢复的**组合运行状态**。

**Non-Goals（非目标）：**
- 不提供跨 change 的 `dependsOn`/`parent` 元数据，也不提供 `openspec change split|graph|next` CLI——那是 `add-change-stacking-awareness`（已提出，未构建）的事。此处依赖 DAG 存放在组合运行状态中；我们日后与 stacking 对齐，但不依赖它。
- 没有积极独立性证明就不并行。并行是一项位于保守策略（D5）、LEAD 的方案自审（D4）与 Tier-A 检查之后、可选启用的优化——而非位于人类 gate 之后。
- 启动扇出不强制人类批准。拆分方案由 LEAD 自审并自动继续（D4）；只有在升级上报或用户自己中断时，人类才介入。
- 不改变单个 change 的流水线如何运行（apply/review/fix 循环原样复用）。
- 不支持嵌套拆分（子 change 自身不能再 decompose）。

## Decisions

### D1 —— 把 decompose 建模为 stage schema 上的一个 `kind`（而非独立 block 或流水线）
向 `StageSchema` 增加 `kind: z.enum(['standard','decompose']).default('standard')`，并将其作为一个具名 enum 常量来跟踪（遵循仓库规则「凡是我们生成的东西，就按名字跟踪」）。对于 `kind: 'decompose'`，通过 Zod 的 `superRefine` 放宽 `skill` 要求（decompose 是由 LEAD 解释的编排，而非叶子 skill 调用），并新增可选的 `childPipeline: string`。

*考虑过的备选方案：* (a) 一个独立的 `decompose` 命令——否决；用户希望它作为条件性步骤编织进 auto，而不是一个独立任务。(b) 一个 `fanOut: true` 布尔值——否决；`kind` enum 能干净地扩展到未来的阶段类型，并且在校验里读起来更好。(c) 一个仿照 `loop:` 的专用 `decompose:` block——因为比所需更重而否决；`kind` + 一个字段就够了。

### D2 —— Decompose 是第一个阶段；它对父 change 进行分支
一条启用了 decompose 的流水线是 `[decompose, propose, apply, verify, review-loop, ship, archive]`。LEAD 评估 decompose 阶段的 `condition`（其自身判断，见 D4）：
- **被跳过** → 记录为 `skipped`；父 change 的其余阶段像今天一样在单个父 change 上运行。对未拆分的任务零行为变化。
- **被执行** → 父 change 退化为**规划容器**；其其余阶段被标记为 `delegated`（不在父级运行），LEAD 转而为每个子 change 运行 `childPipeline`。

这种「分支」语义让一份线性的 YAML 保持可读，同时给 LEAD 一个干净的二选一。注册表校验强制 **至多一个** decompose 阶段，且它是**第一个**（build-order 索引 0）。

### D3 —— 通过不含 decompose 的 `childPipeline` 实现递归防护
`childPipeline` 必须通过显式的注册表查找（而非模式匹配）解析到一条已存在且**不含**任何 decompose 阶段的流水线。resolver 拒绝（传递地）包含 decompose 的 `childPipeline`。结合「decompose 仅在顶层」，这把扇出限定为单一层级。省略 `childPipeline` 时的默认值：`small-feature`（一旦我们把 decompose 阶段排除在它之外，它就不含 decompose——decompose 阶段被加到*另一条*入口流水线，从而让 `small-feature` 仍可作为子流水线使用）。

### D4 —— 执行或跳过由 LEAD 判断；方案由 LEAD 自审，而非由人类设 gate
decompose 的 `condition`（例如 `needs-decomposition`）由 LEAD 根据任务来评估：多个相互独立的交付物、若干彼此不同的能力、或大到无法作为单个 diff 来 review 的范围 → 执行；单个内聚的切片 → 跳过。当被执行时，LEAD **自审**这份**拆分方案**（子 change 列表 + 依赖 DAG + 串行/并行计划）——检查切片内聚性、任何并行同批背后的独立性依据，以及 DAG 的正确性——然后**自动**继续；默认无需人类批准。因此 decompose 阶段**不是**人类 gate（`gate: false`）。只有当 LEAD 无法产出一份安全方案时（例如它既无法确证独立性*又*找不到一个安全的串行排序），它才升级给人类。用户仍可像任何 auto 运行一样随时中断。安全依赖于保守的串行/并行策略（D5）加上这次自审，而非依赖一个强制的人类检查点。可选地，LEAD **可以**派一个独立的 reviewer worker 来审查方案（作者≠验证者）以获得额外保障，但这并非必需。

### D5 —— 保守的串行/并行策略（安全的核心）
LEAD 从依赖 DAG 加一份**重叠分析**推导出执行模式：
- 两个有依赖边的子 change → **严格串行**，按拓扑顺序。在**每一个**前置子 change 都已实现且 review 干净（其 review-loop 通过）之前，依赖它的子 change 流水线**绝不能**启动，且 LEAD **绝不能**让前置与其依赖者并发运行。依赖者在**共享工作树**上消费前置的代码即可——**共享工作树 + review 干净就足够**，无需先 ship/archive 前置；仅当依赖的是已落地/已合并的产物时，LEAD 才升级为先 ship/archive 前置。
- 两个子 change **仅当全部成立**时才**可以**并行：(1) 任一方向都没有依赖边，(2) 触及的能力 / 规格目录 / 文件**无重叠**，且 (3) 宿主为 **Tier A**。并行的子 change 获得各自独立的 worker 团队（指南 §2.1 的模型）。**Tier A 下不设并发子团队上限**：满足独立性证明的子 change 可全部并发。
- **独立性不确定 → 串行。** 出于安全，重叠或含糊的触及集被当作依赖处理。这就是那条明确的「宁可串行也不能乱并行」规则：并行需要一份*积极的*独立性证明，而绝非「没有已知冲突」。

*考虑过的备选方案：* 对任何没有显式边的东西自动并行——否决；隐性重叠（两个 change 编辑同一能力）恰恰是并行工作「重新引入另一个 change 已经移除的假设」的方式（`add-change-stacking-awareness` 点出的风险）。

### D6 —— 组合运行状态与每个子 change 的 `auto-run.json` 并存
在父 change 目录下增加一份组合记录（路径用 `path.join` 构建，文件名作为具名常量跟踪，例如 `portfolio-run.json`）。它记载：拆分方案、子 change 列表、依赖 DAG、每个子 change 的执行模式（串行/并行）+ 并行同批（cohort）、**每个子 change 实际运行的流水线**（允许逐个子 change 覆盖，默认取该 decompose 阶段的 `childPipeline`）、每个子 change 的流水线状态，以及当前前沿（哪些子 change 现在可运行）。每个子 change 保留它自己的 `auto-run.json`（今天的 schema，不变）。`openspec pipeline resume <parent>` 读取组合记录 + 各子状态来计算下一个可运行的子 change；运行状态为权威，子目录/产物的存在性作为交叉校验。

### D7 —— 子 change 的身份
子 change 用 `openspec new change <child-id>` 创建，命名采用从父派生的前缀以便追溯（例如 `<parent>-<slice>`），并记录在组合方案中。父→子的关联如今存放在组合状态里；当 `add-change-stacking-awareness` 落地后，decompose 额外写入 `parent` + `dependsOn` 元数据，使 `openspec change graph` 反映同一个 DAG。

## Risks / Trade-offs

- **不安全的并行破坏共享代码** → 缓解：D5——仅在积极证明独立时并行、重叠分析、Tier-A 要求、保守串行默认，外加 D4 的 LEAD 方案自审。
- **过度拆分（太多琐碎 change）** → 缓解：D4 的 LEAD 自审 + 启发式「可独立交付、可 review 的切片」；用户仍可中断以合并方案或跳过 decompose。
- **无限/嵌套扇出** → 缓解：D3 不含 decompose 的 `childPipeline` + 仅顶层不变式，在注册表校验和 resolver 中强制执行。
- **组合部分失败（某个子 change 中途失败）** → 缓解：D6 组合运行状态 + 恢复；LEAD 停止受影响的串行链，保留已完成的独立子 change，并连同前沿一起升级上报。
- **Schema 向后兼容** → 缓解：`kind` 默认 `standard`；既有流水线及其校验不受影响；decompose 阶段只被加到新的/选用的入口流水线。
- **Stacking 顺序** → 缓解：在 `upgrade-auto-orchestrated-pipelines` 之后归档；仅 `ADDED` 的 deltas 避免修改它尚未成为正典的需求。

## Migration Plan

1. 落地 schema（`kind`、`childPipeline`、放宽的 `skill`）+ 校验 + resolver 递归防护，全部向后兼容。
2. 在 `pipeline resume` 中增加组合运行状态模块 + 读取器。
3. 扩展 `_orchestration.ts`（组合章节）与 `auto.ts`（条件性 decompose 步骤 + LEAD 方案自审 + 恢复）。
4. 增加一条启用 decompose 的入口流水线（保持 `small-feature` 不含 decompose 以供子用途）；在 `docs/opsx-workflow-guide.md` 中记录。
5. 仅在 `upgrade-auto-orchestrated-pipelines` 归档之后再归档。

回滚：从入口流水线中移除 decompose 阶段；`kind` 默认为 `standard` 使这些 schema 增补变为惰性无影响。

## Resolved Questions

- **依赖者屏障的严格程度** → **已定**：**共享工作树 + review 干净**即足够。依赖者可在共享工作树上消费前置的代码，无需强制前置先 ship/archive；仅当依赖的是已落地/已合并的产物时才升级。（见 D5）
- **每个子 change 的流水线选择** → **已定**：**允许逐个子 change 覆盖**，默认取该 decompose 阶段的 `childPipeline`。组合运行状态按子 change 记录其实际运行的流水线，因此一个子可以是 `bug-fix` 而其同级是 `full-feature`。（见 D6）
- **并行同批上限** → **已定**：**不设上限**。在 Tier A 下，所有能通过独立性证明的子 change 都可并发；并发度仅由独立性与宿主能力约束，而非一个固定的 N。（见 D5）
