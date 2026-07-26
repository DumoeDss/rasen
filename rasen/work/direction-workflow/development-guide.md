# Rasen Direction Workflow 开发指导

> 状态：设计已收敛，供后续提案、实现和 dogfood 使用。
>
> 本文描述目标产品契约、当前开发范围和后续评估边界，不代表当前 Rasen 已经提供
> `rasen-direction`、Direction CLI、稳定 `/work` schema 或相关 UI。

## 1. 结论

Rasen 需要一个位于 Change 之上的长期方向治理能力。

这个能力建议命名为 `rasen-direction`。它不是一个推进 Change 的 Pipeline，
也不是每个 Change 都要执行的 Stage。它是一个可选 Workflow，用来维护和使用
长期规划制品：

```text
North Star（可选，长期不变量）
  ↓
Target State（当前 workstream 要达到的产品或领域状态）
  ↓
Roadmap（可随证据调整的纵向切片）
  ↓
Selected Slice
  ↓
Change / auto-decompose portfolio
  ↓
Pipeline Run
  ↓
Result / Evidence
  └──────────────────────────────→ Direction Reconcile
```

最重要的产品约束是：

1. Direction 完全 opt-in。
2. 没有 North Star、Target State 或 Roadmap 时，现有 Rasen 工作必须照常进行。
3. `rasen-goal` 与 Direction 的 Target State 是两个不同概念。
4. North Star 是长期权威制品，不能由单次实施结果自动改写。
5. Roadmap 是当前路径，不是按日期排满的 backlog，也不是 append-only 日志。
6. Result 和真实 Evidence 必须回流 Roadmap。
7. 第一版先在实验性 `rasen/work/` 中 dogfood，不先建设新的 CLI 领域模型、
   数据库或 Dashboard。

## 2. 为什么需要这层能力

当前 Rasen 已经能够可靠推进一个 Change：

```text
proposal
  → specs
  → design
  → tasks
  → implementation
  → verify / review
  → ship / archive
```

`rasen-auto` 回答“如何把这个任务交付”，`rasen-goal` 回答“如何把一个有明确
Gate 的目标迭代到满足”。它们都不负责回答：

- 长期要把产品带到哪里；
- 哪些原则不能被局部实现破坏；
- 当前阶段真正要使什么状态成立；
- 多个候选 Changes 中应该先验证哪个纵向切片；
- 一个 Slice 完成后，证据是否改变了后续路线；
- 已经失效或完成的 Roadmap 何时退出活跃状态。

仓库中已经存在这类真实需求：

- `../issue-centered-automation-platform/north-star.md` 定义了长期方向、开发
  戒律、成熟度 Horizon、健康指标和开放选择。
- `../issue-centered-automation-platform/goal.md`、`roadmap.md` 和
  `current-capabilities-0.1.5.md` 分别承担阶段目标、当前路径和能力基线。
- `../../changes/store-context-unification/planning-context.md` 必须由 LEAD
  手工写入 `north-star > goal > roadmap > portfolio plan` 的权威链，才能
  避免多个子 Change 各自重新解释方向。
- `../simplify-context-and-workspace-model/roadmap.md` 已经展示了缺少
  reconciliation 生命周期时的漂移：Roadmap 膨胀、旧分支引用残留、没有
  下一项但 workstream 仍未明确关闭。

因此缺少的不是“生成一份 `north-star.md`”，而是：

> 把长期方向、当前目标状态、选片、执行证据和路线修订连接成一个可发现、
> 可审查、可关闭的治理闭环。

## 3. 两类用户的体验

### 3.1 人类用户

人类通常通过自然语言提示 Agent，而不是先学习新的文件模型或 CLI。

没有 Direction 需求时，体验保持不变：

```text
explore / office-hours
  → propose / auto / rasen-goal
  → apply / verify / ship
```

有长期方向需求时，用户可以说：

```text
帮我为这个平台建立长期方向和 Roadmap。

从现有 Roadmap 里选择下一条最值得验证的纵向切片。

这批 Changes 完成了，依据结果重新校准路线。
```

用户应能看到并确认：

- 当前继承哪个 North Star；
- 当前 Target State 是什么；
- 为什么选这个 Slice；
- 什么证据才算 Slice 完成；
- 哪些 Changes 会被创建；
- Result 对 Roadmap 产生了什么影响；
- 是否需要修改 Target State 或升级到 North Star 决策。

### 3.2 Agent 用户

Agent 需要能够发现：

- 当前 workstream 的稳定标识和状态；
- 权威 North Star 的位置；
- 当前 Target State；
- 当前 Roadmap；
- 唯一 Selected Slice；
- 已锁定和仍开放的决策；
- Slice 与 Changes 的投影关系；
- 上次 reconciliation 使用的基线；
- 哪些 Result 和 Evidence 尚未回流。

Agent 不应依赖聊天记录、文件名猜测、旧 PR、旧分支或某个熟悉代码库的人
口头解释这些信息。

## 4. 术语与职责

| 概念 | 回答的问题 | 生命周期 |
| --- | --- | --- |
| North Star | 长期要到哪里，哪些原则不能破坏 | 极少修改，明确人工批准 |
| Target State | 当前 workstream 最终要使什么产品或领域状态成立 | workstream 级，可经证据校准 |
| Roadmap | 从当前能力到 Target State 的当前路径是什么 | 随 Result 和 Evidence 调整 |
| Slice | 下一次可独立验收的纵向能力证明是什么 | 选定、执行、验收、关闭 |
| Change | 一个可独立实施、验证和交付的工程切片 | 使用现有 Change 生命周期 |
| Pipeline Run | 如何推进一次 Change 执行 | 运行时生命周期 |
| Result / Evidence | 实际发生了什么，是否通过验收 | 历史证据，不反向改写 |

### 4.1 `rasen-goal` 与 Target State

长期 workstream 不使用 `goal.md` 作为正式产物名称。使用
`target-state.md`，避免与现有 `rasen-goal` 混淆。

| 概念 | 作用域 | 产物 | 终止方式 |
| --- | --- | --- | --- |
| `rasen-goal` | 一个有明确评估门的迭代任务 | `goal-plan.md`、`goal-run.json` | Gate 满足、轮次耗尽或明确阻塞 |
| Direction Target State | 一个跨 Change 的长期 workstream | `target-state.md` | workstream 完成、暂停或被替代 |
| North Star | 一个长期产品决策作用域 | `north-star.md` | 产品方向被明确修订或废止 |

现有实验性 `/work` 资料中的 `goal.md` 可以作为兼容输入读取，但新的
Direction Workflow 只生成 `target-state.md`。兼容读取不得自动重写旧文件。

### 4.2 Specs 仍然是当前行为真相

Direction 制品描述未来方向和规划，不替代 `rasen/specs/`：

```text
rasen/specs/
  当前已经接受、实现或承诺的行为真相

rasen/work/
  长期方向、目标状态、路线、切片和执行证据
```

Agent 不能因为 North Star 或 Roadmap 描述了未来能力，就把该能力当成当前
已经存在的产品行为。

## 5. Direction Scope、Store 与 Workstream

“每个 Store 一个方向”与“每个 workstream 一个方向”都不准确。

推荐关系是：

```text
Durable Direction Scope
  └─ North Star                         1
       ├─ Workstream A                  N
       │    └─ Target State → Roadmap → Slices
       └─ Workstream B
            └─ Target State → Roadmap → Slices
```

规则：

1. North Star 按长期决策作用域创建，不按 Store 数量创建。
2. Store 或项目 repo 是规划制品的存储根，不自动等于一个产品方向。
3. 每个 Direction workstream 必须有 Target State 和 Roadmap。
4. Workstream 可以没有 North Star。
5. Workstream 通常继承一个已有 North Star。
6. 只有形成独立、长期产品或子系统方向的 workstream 才拥有自己的
   `north-star.md`。
7. 子层可以增加更窄的约束，但不能覆盖父 North Star。
8. 第一版只允许零个或一个主 North Star；多重继承延后。

跨项目 workstream 的制品应位于 Store 等共享 planning root；单项目
workstream 可以位于项目 repo。存储位置不改变上述语义。

## 6. 实验性制品模型

第一版继续使用现有 `rasen/work/` 作为 Git-native dogfood 场所：

```text
rasen/work/
  README.md
  <work-id>/
    work.yaml
    north-star.md          # 可选，也可继承别处
    target-state.md
    roadmap.md
    slices/
      <slice-id>/
        spec.md
        plan.md
        result.md
        log.md             # 可选
```

Direction Workflow 不应要求所有项目创建该目录。目录不存在是正常状态。

### 6.1 `work.yaml`

`work.yaml` 是很薄的发现和状态索引，不是第二套执行系统。

概念形态：

```yaml
version: 1
id: issue-centered-automation-platform
status: active

authority:
  northStar: ./north-star.md

targetState: ./target-state.md
roadmap: ./roadmap.md
activeSlice: single-issue-single-change

lastReconciled:
  at: 2026-07-26T00:00:00Z
  revision: abc1234
```

字段约束：

- `status` 为 `draft | active | paused | completed | superseded`。
- `authority.northStar` 可省略，也可以指向同一 planning root 中的其他
  North Star。
- `activeSlice` 最多一个。一个 Slice 内部可以投影为并行 Changes。
- `lastReconciled.revision` 记录 planning root 的已核对 revision；多项目
  运行使用的具体 revisions 记录在 Slice Result 中。
- Manifest 只保存引用和生命周期选择，不复制 North Star、Roadmap、Change
  或运行状态。

在两次真实 dogfood 证明结构稳定前，不把该概念形态承诺为公开 schema。

### 6.2 `north-star.md`

North Star 至少回答：

- 一句话长期产品结果；
- 服务谁以及用户最终获得什么；
- 不可违反的产品或架构原则；
- 明确非目标；
- 必须永久记住的失败模式；
- 能力成熟度 Horizon；
- 长期健康指标；
- 仍保持开放的长期选择。

North Star 不是：

- 当前版本规格；
- 功能 backlog；
- 版本承诺；
- 实施任务清单；
- 一次性由 Agent 自动生成后永不复审的愿景文案。

### 6.3 `target-state.md`

Target State 至少回答：

- 当前 workstream 为什么存在；
- 结束时什么产品或领域状态必须成立；
- 当前已收敛的概念和关系；
- 成功标准；
- 非目标和边界；
- 哪些决策已经锁定；
- 哪些问题仍允许由 Slice 决定。

Target State 应足够具体，使 Roadmap 可以判断是否已经到达；但它不描述每个
Change 的实施细节。

### 6.4 `roadmap.md`

Roadmap 是当前路径的简洁投影，至少包含：

- 当前能力基线；
- 当前所处 Horizon 或阶段；
- Selected Slice；
- 后续候选 Slices；
- 每个候选 Slice 的用户价值和退出证据；
- Later / Not Now；
- 触发重新规划的条件。

Roadmap 不应包含：

- 按日期排满的长期任务表；
- 所有实施提交的流水账；
- 已经由 `result.md`、`log.md` 或 Git 保存的详细历史；
- 与当前状态矛盾的旧 branch、PR 或 Change 引用；
- 没有下一步但仍声称 `active` 的模糊状态。

### 6.5 `slices/<id>/spec.md`

Slice Spec 定义一次纵向能力证明：

- 用户能够完成什么；
- 为什么这一步值得现在验证；
- 可观察的验收条件；
- 本 Slice 明确不提高哪些复杂度维度；
- 与 North Star 和 Target State 的关系。

一个 Slice 应可独立验收、暂停、失败、替代或完成。

### 6.6 `slices/<id>/plan.md`

Slice Plan 只描述执行包络：

- 投影为一个 Change 还是 auto-decompose portfolio；
- 目标项目和 Change 边界；
- Change 之间的依赖；
- 哪些工作可以安全并行；
- Slice 级验收和 dogfood 方式；
- 需要回流的 Evidence。

技术设计和实施任务仍由各 Change 的 `design.md`、`specs/` 和 `tasks.md`
承担。Slice Plan 不复制第二套实现计划。

### 6.7 `slices/<id>/result.md`

Result 记录实际发生的事情：

- `passed | partial | failed | superseded | cancelled`；
- 创建和执行了哪些 Changes；
- 实际运行目录和项目 revisions；
- Gate、Review、测试、PR、发布和 dogfood 证据；
- 未完成前沿；
- 发现的新事实；
- 对 Roadmap、Target State 或 North Star 的建议影响。

Result 不是当前意图的来源真相。后续重试可以追加新的证据，但不能静默改写
已经发生的失败或历史运行。

### 6.8 `slices/<id>/log.md`

只有当重要 pivot 无法从最终 Spec、Plan、Result 和 Git 历史理解时才使用
`log.md`。它不能成为通用聊天记录或无限增长的 Roadmap Change Log。

## 7. Workflow 动作

第一版可以表现为一个自然语言 Skill，无需立即暴露五个 CLI 子命令。内部
仍应保持以下动作边界。

### 7.1 Establish

用于建立新的长期 workstream：

1. 检查是否已经存在相关 Direction，避免重复创建。
2. 调研当前 Specs、Changes、能力和失败证据。
3. 判断是否需要 North Star；默认不创建。
4. 创建 Target State。
5. 创建简洁 Roadmap。
6. 提议第一个可验收 Slice。
7. 由人类确认 Target State、可选 North Star 和 Selected Slice。

Establish 不创建代码，不自动进入实施。

### 7.2 Calibrate

用于在选片前核对真实基线：

1. 读取权威链和上次 reconciliation revision。
2. 检查当前 Specs、Changes、Git 和运行证据。
3. 找出文档与现实的差异。
4. 更新能力基线或提出 Target State 修订。
5. 不依据旧 Roadmap 文本假定某项能力已经存在。

### 7.3 Select

用于选择下一条纵向切片：

1. 从当前 Roadmap 候选中选择一个 Slice。
2. 确认它一次只提高必要的复杂度维度。
3. 明确退出证据和 dogfood 路径。
4. 确认与 North Star、Target State 和当前 Specs 不冲突。
5. 经用户确认后写入 `activeSlice`。

第一版一次只选择一个 Slice。需要并行时，由该 Slice 的 Execution Plan 或
auto-decompose portfolio 表达。

### 7.4 Project

用于把 Selected Slice 交给当前可执行 Rasen 生命周期：

```text
Slice Spec + Slice Plan
  → one Change / auto-decompose portfolio
  → existing proposal/spec/design/tasks
  → existing Pipeline
```

Project 应：

- 把 Slice 的目标、边界和验收作为提案输入；
- 允许 Change 按目标项目拆分；
- 在 Change 的 planning context 中留下轻量来源引用；
- 不创建带双向状态耦合的 Direction link object；
- 不让 Slice Plan 替代 Change Design；
- 不把整份 Roadmap 交给 auto-decompose 让它自行选择产品方向。

Direction Workflow 自身不实现代码。

### 7.5 Reconcile

Reconcile 是最重要的持续动作：

1. 读取 Active Slice、Result 和所有可用 Evidence。
2. 核对 Changes、Run、Git、PR、发布和 dogfood 的真实状态。
3. 判断 Slice 是通过、部分通过、失败、取消还是被替代。
4. 更新 Roadmap 当前能力位置和候选顺序。
5. 选择下一 Slice、暂停、关闭或请求人类决策。
6. 更新 `work.yaml` 的状态、`activeSlice` 和 reconciliation 基线。
7. 压缩 Roadmap 中已经有 Result、Log 或 Git 历史承载的流水账。

Reconcile 可以草拟 Target State 变更，但重大语义变化必须由人类确认。
Reconcile 永远不能自动修改 North Star。

## 8. 非阻断契约

Direction 的缺失必须是中性状态。

| 状态 | 普通 `propose` / `auto` / `rasen-goal` | `rasen-direction` |
| --- | --- | --- |
| 没有 Direction 制品 | 完全正常，无警告 | 按用户请求创建 |
| 有 Direction，但当前 Change 未关联 | 完全正常 | 可以选择或投影 Slice |
| 用户显式关联 Direction | 读取并报告对齐情况 | 正常治理 |
| Direction 引用损坏 | 警告后继续，不静默猜测 | 停止 Direction 操作并给出修复方式 |
| 疑似违背 North Star | 提醒并请求确认，不机械阻断 | 记录例外或经人确认修订方向 |

实现必须满足：

- `rasen init` 不自动创建 Direction 制品。
- `rasen update` 不自动创建 Direction 制品。
- 没有 `rasen/work/` 不产生诊断噪音。
- `core` 日常主链不增加 Direction 前置步骤。
- 即使 Direction Skill 已安装，也不会自动接管普通工作。
- 即使 Direction Skill 未安装，现有 Workflow 行为不变。
- 不因为识别到“大任务”而自动写文件或改道。

Agent 检测到工作可能跨多个 Changes、版本、Horizon 或项目时，最多给出一次
非阻塞建议：

> 这项工作可能适合建立长期方向和 Roadmap。需要我先用
> `rasen-direction` 整理吗？

用户拒绝、忽略或直接要求执行时，继续当前 Workflow。

## 9. 权威顺序与修改规则

对于显式关联 Direction 的工作，规划语义按以下顺序解释：

```text
North Star（若存在）
  > Target State
    > Roadmap
      > Selected Slice Spec
        > Slice Plan
          > Change planning artifacts
```

该顺序不允许下层静默覆盖上层。发现冲突时：

- 实施发现只影响路径：更新 Slice Plan 或 Change Design。
- Slice 结果改变后续顺序：更新 Roadmap。
- 证据否定当前阶段目标：提出 Target State 修订并请求确认。
- 产品长期方向改变：单独提出 North Star 修订并明确请求人类批准。

修改规则：

- North Star：只允许明确的人类批准或重大产品转向。
- Target State：允许基于证据修订，但必须确认实质性范围变化。
- Roadmap：允许在 Reconcile 中随证据调整。
- Slice Spec：期望结果变化时修改，并保留 pivot 说明。
- Slice Plan：实现路径变化但结果不变时修改。
- Result：记录实际事实，不用来改写当前意图。

## 10. Reconciliation 健康检查

每次 Reconcile 至少检查：

### 10.1 引用健康

- North Star、Target State、Roadmap 和 Active Slice 是否存在；
- branch、Change、PR 或项目引用是否仍可解析；
- 引用是否已经被 supersede；
- planning root revision 是否明显落后于实际结果。

### 10.2 状态一致性

- `activeSlice` 是否唯一；
- Active Slice 是否已有 Result；
- 所有 Change 完成是否真的满足 Slice 验收；
- “没有下一项”是否应该将 workstream 标记为 `completed` 或 `paused`；
- Roadmap checkbox、文字状态和真实 Change 状态是否冲突；
- 已完成 workstream 是否仍被新 Agent 误识别为当前方向。

### 10.3 内容健康

- Roadmap 是否仍能快速回答“现在在哪里、下一步是什么、如何知道完成”；
- 是否混入大量应属于 Result、Log 或 Git 的历史；
- 是否保留了被证据推翻的实施顺序；
- 是否把模块存在、文件数量或测试桩误当成纵向能力证明。

### 10.4 收口动作

当没有下一 Slice 时，不能保持模糊的 `active`：

- Target State 和验收已满足：`completed`；
- 等待外部条件或人类决策：`paused`；
- 被新的 workstream 取代：`superseded`；
- Target State 尚未满足但无可信路径：请求重新规划，不得误报完成。

## 11. Source of Truth 边界

Direction 不能建立第二套执行真相。

```text
当前产品行为
  → rasen/specs/ 与实现

长期方向、目标状态和选片
  → rasen/work/ Direction 制品

Change 计划与交付
  → Change artifacts 与 Git history

Run / Session 活跃状态
  → machine-local runtime state

Gate、Review、PR、dogfood
  → 可归档 Evidence
```

Board、搜索索引和未来 Roadmap UI 都只能是可重建 Projection。

## 12. 与现有 Rasen 表面的关系

### `rasen-explore`

用于发现问题、研究选择和澄清需求。只有当用户决定把探索固化为长期方向时，
才进入 `rasen-direction`。

### `rasen-office-hours`

用于压力测试需求和设计。它可以成为 Establish 或 Target State 修订的输入，
但不直接拥有 Direction 生命周期。

### `rasen-propose`

用于把一个已选 Slice 投影成正式 Change artifacts。没有 Direction 时继续
独立工作。

### `rasen-auto-decompose`

用于分解一个已选 Slice，不用于从整个 Roadmap 中自主选择产品方向。

### `rasen-goal`

保持现有 measure/evaluate/research 目标循环，不读取或创建
`target-state.md`，除非用户显式把某个 Slice 的工作产品交给 Goal Loop。

### `rasen-retain`

可以产生回顾和项目知识，但不能自动修改 Direction。Reconcile 可以把其
可审查证据作为输入。

### `rasen work`

当前 CLI 的 `rasen work` 已用于 machine-home work-directory 维护。Direction
第一版不得未经命名设计就复用该 CLI 命名空间。未来需要 first-class CLI
时优先评估独立的 `rasen direction` 命名空间。

## 13. 非目标

第一版明确不做：

- 强制每个项目创建 North Star 或 Roadmap；
- 自动为普通 Bug 和小功能创建 Direction；
- Issue Tracker、团队 Project Management 或日期型 backlog；
- Roadmap Dashboard；
- Direction 数据库或 Event Store；
- 多 North Star 继承和冲突解析；
- 跨 Store 自动同步 Direction；
- 自动从 Result 改写 North Star；
- Direction 与 Change 的双向生命周期耦合；
- 用 Direction 取代 Specs、Change、Pipeline 或 Run；
- 在没有真实 dogfood 状态前建设 UI。

## 14. 当前开发范围

### Phase 1：`rasen-direction` Skill

这是当前唯一确定的开发任务。目标是把本文已经收敛的手工纪律封装成可复用
Workflow：

- 实现 Establish、Calibrate、Select、Project、Reconcile 的提示契约。
- 只读写 Git-native Markdown 和实验性 `work.yaml`。
- 使用当前 Rasen CLI 获取 Specs、Changes、Pipeline 和运行证据。
- 对普通 Workflow 保持非阻断、零自动创建。
- 不增加数据库、daemon 调度、first-class Direction CLI 或 UI。
- 用一个现有或新出现的真实长期 workstream 完成端到端 dogfood，作为本
  Skill 的实施验收，而不是独立的前置阶段。
- 在 dogfood 中记录 fresh Agent 是否能发现权威链和下一动作，以及普通无
  Direction 工作是否完全不受影响。

本文和已有调研是 Phase 1 的设计输入，不构成需要实施的 Phase 0。

### 完成后的评估触发项

Phase 1 完成后的持续使用、模型校准和 first-class 化不是当前已确定的开发
阶段。它们只能由真实使用体验触发新的独立提案。

使用证据可能触发：

- 调整 Skill 的提示、制品关系或 reconciliation 规则；
- 稳定或修改 `work.yaml` schema；
- 增加 Direction 引用的结构化验证；
- 评估 `rasen direction list/show/status/reconcile` 等 CLI；
- 评估 Project / Store 级发现、Workflow profile 和帮助系统入口；
- 在存在真实稳定状态后评估可重建的只读管理 Projection。

在 Phase 1 完成前，不为这些可能性创建 Phase 2、Phase 3 或预排实现任务。

## 15. MVP 验收标准

Direction Workflow 的第一版成立，需要真实证明：

1. 一个没有任何 Direction 制品的项目可以照常完成普通 Change。
2. `rasen init`、`rasen update`、`rasen-propose`、`rasen-auto` 和
   `rasen-goal` 不因 Direction 缺失改变行为。
3. 用户可以主动建立一个包含 Target State、Roadmap 和第一个 Slice 的
   workstream，而不被迫创建 North Star。
4. 一个 fresh Agent 可以仅从 Git 制品发现权威链、Active Slice 和下一动作。
5. Selected Slice 可以投影成真实 Change 或 portfolio，并完成现有 Pipeline。
6. Result 包含可检查的运行、验证和 dogfood 证据。
7. Reconcile 根据 Result 更新 Roadmap，并保存实际使用的基线。
8. Reconcile 能识别至少一种 stale 引用或状态矛盾。
9. 所有必需 Changes 完成但 Slice 验收未满足时，不误报 Slice 通过。
10. North Star 在没有明确人类批准时保持不变。
11. Roadmap 没有演化成执行日志或第二套 Change tasks。
12. Workstream 能明确进入 `completed`、`paused` 或 `superseded`，不会以
    “下一项为空”的活跃 Roadmap 永久漂移。

## 16. 评估指标

优先评估：

- fresh Agent 发现当前方向和下一动作所需时间；
- 多 Change 工作中的重复研究次数；
- 子 Change 重新解释或偏离上层方向的次数；
- 人类修正 Selected Slice 或 Change 分解的次数和原因；
- Result 触发 Roadmap 调整的频率；
- stale 引用被自动发现的比例；
- 已完成 workstream 仍被误识别为 active 的次数；
- 没有 Direction 的普通工作出现回归或额外摩擦的次数；
- 为维护 Direction 制品付出的人工时间。

最重要的成功判断不是文档数量，而是：

```text
长期工作是否更少漂移，
下一条切片是否更容易选择和验收，
普通工作是否保持零额外负担。
```

## 17. 开发戒律

1. Direction 可选，缺失不报错。
2. North Star 可选，Target State 只在启用 Direction 时必需。
3. 不把 Target State 称为 Goal，不混淆 `rasen-goal`。
4. Workflow 维护制品；North Star 本身不是 Workflow 或 Pipeline。
5. 先选 Slice，再调用 propose 或 auto-decompose。
6. 一个 Active Slice 可以拥有多个 Changes，但只能有一个 Slice 级验收。
7. Change 完成不等于 Slice 自动通过。
8. Result 记录事实，Roadmap 表达当前路径。
9. North Star 不接受自动修改。
10. Roadmap 必须能关闭、暂停、替代和压缩。
11. 不复制第二份 Specs、Change 或运行状态真相。
12. 没有真实闭环，不建设 Direction Dashboard。
