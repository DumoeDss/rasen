# 以 Issue 为中心的自动化平台路线

本文是 `goal.md` 的自下而上实施路线。它不是一次性平台建设清单，而是一组
必须依次通过真实日常开发验证的垂直切片。

终极产品方向、Harness 可继承思想和失败经验见
[`north-star.md`](./north-star.md)。本路线允许随 dogfood 结果调整，但不得
违反其中“闭环先于平台”和“完成必须有运行证据”等开发戒律。

## 1. 路线原则

### 1.1 每个切片必须跑通真实工作

每个阶段至少选择一个 Rasen 自身的真实 Issue 进行 dogfood。以下证据不能
单独作为完成标准：

- 新目录或 schema 已创建；
- API endpoint 已存在；
- UI 页面可以打开；
- 单元测试通过；
- smoke 脚本存在；
- Agent 进程能够启动。

每个切片的最低证据应包括：

- Issue 和 Execution Plan 的真实制品；
- 实际使用的成员项目和 cwd；
- Run 与 Session 记录；
- Pipeline 输出和验证结果；
- Change 的完成或失败状态；
- Issue 汇总状态；
- 人工验收或自动验收结果。

### 1.2 CLI 和现有 Pipeline 先行

- 现有 Change、Pipeline、Run 和 Session 能力继续作为执行基础。
- 新 UI 先做真实文件和运行状态的读模型。
- UI 不创建一套与 CLI、Git 文件并行的状态真相。
- 在核心闭环稳定前，不优先建设评论、通知、权限和 Forge 平台能力。

### 1.3 一次只提高一个复杂度维度

推荐顺序：

```text
单 Issue / 单 Change / 单项目
  -> 单 Issue / 多 Change / 单项目
      -> 单 Issue / 多 Change / 多项目
          -> 自动项目路由
              -> Issue 级验收和交付
```

## 2. Phase 0：锁定语义与真实基线

### 用户能够做什么

用户可以清楚区分：

- Issue：为什么做、什么算完成；
- Change：在哪个项目执行的工程切片；
- Run：一次真实执行；
- Session：一个真实 Agent 进程。

### 系统需要明确什么

- Store 是规划根。
- Change 有唯一主成员项目。
- Agent 从成员项目 cwd 启动。
- Store 作为附加规划上下文。
- 当前 portfolio 被视为 Execution Plan 候选，而不是最终 Issue。
- 当前 UI `Task` 不是稳定领域实体。

### 完成证据

- 选定一个即将真实实施的单项目 Issue。
- 记录它的 Issue 信息、目标项目、Change 和验收条件。
- 从目标项目启动一次现有 Pipeline，确认 cwd、Store 上下文和写入边界。

## 3. Phase 1：单 Issue、单项目、单 Change

### 用户体验

用户创建或登记一个 Issue，将它关联到一个现有 Change，然后启动执行。
看板显示一张 Issue 卡片，状态来自真实 Change Run。

### 最小实现

- 一个稳定的 Issue 身份和最小制品；
- Issue 到单个 Change 的显式引用；
- Change 到成员项目的显式绑定；
- 从绑定项目 cwd 启动 Agent；
- Issue 详情显示该 Change 的 Run 和 Session；
- Issue 的 phase、health 和 progress 从真实状态计算；
- Issue 只有在验收通过后才进入 Done。

### 暂不实现

- auto-decompose；
- 跨项目依赖；
- 评论和通知；
- PR 自动化；
- 复杂看板筛选；
- 完整 DAG 可视化。

### 完成证据

一个 Rasen 自身的真实 Issue 完成：

```text
Issue
  -> 单 Change
  -> 正确项目 cwd
  -> Pipeline
  -> 验证
  -> Issue 验收
```

## 4. Phase 2：单 Issue、单项目、多 Change

### 用户体验

一个较大的 Issue 被拆成同一成员项目中的多个 Changes。用户能看到：

- Changes 的依赖顺序；
- 哪些可以并行；
- 每个 Change 的独立运行和验证；
- Issue 的总体进度和关键阻塞。

### 最小实现

- 复用现有 auto-decompose、portfolio 和依赖 DAG；
- 将分解结果保存为 Issue 的 Execution Plan；
- 使用显式 Change 引用，不依赖名称前缀推断；
- 每个 Change 独立运行、重试和验证；
- Issue 状态尊重 required、optional、cancelled 和 superseded 节点；
- 失败和阻塞进入 health，而不是破坏 phase。

### 完成证据

一个真实 Issue 至少产生两个 Changes，其中：

- 存在一个依赖关系或一次并行执行；
- 至少一个 Change 独立完成并回流；
- Issue 在部分完成时不误报 Done；
- 全部必需 Change 完成后仍需 Issue 验收。

## 5. Phase 3：单 Issue、多个成员项目

### 用户体验

一个 Issue 同时涉及客户端、服务端或官网等多个成员项目。主看板中只显示
一张 Issue 卡片，详情按成员项目分组。

### 最小实现

- Execution Plan 节点增加稳定的 `target project`；
- 一个 Change 只绑定一个主项目；
- 每个项目可以拥有多个 Changes；
- Agent 从每个 Change 的目标项目 cwd 启动；
- 跨项目依赖可以阻止下游 Change 过早运行；
- Issue 卡片显示项目徽标和各项目进度；
- Issue 详情显示项目泳道或项目分组；
- 项目 chips 作为筛选器，不作为顶层所有权分区。

### 初期允许人工操作

本阶段允许用户手工选择和修正目标项目。不要为了自动路由而延迟跨项目
闭环的首次验证。

### 完成证据

一个真实 Issue 至少涉及两个成员项目，并满足：

- 两个项目中的 Agent 都从正确 cwd 启动；
- Store 规划上下文对两边均可用；
- 任一项目的失败或阻塞会正确回流到同一个 Issue；
- Issue 不会在全局看板中被复制；
- 每个 Change 的 Git 和验证边界保持独立。

## 6. Phase 4：auto-decompose 生成目标项目绑定

### 用户体验

用户提交 Issue 后，系统给出一份可审查的执行计划：

```text
客户端：Change A、Change B
服务端：Change C
官网：Change D
依赖：C -> A；C -> D
```

用户可以：

- 接受计划；
- 修改目标项目；
- 调整依赖；
- 合并或继续拆分 Change；
- 标记 required 或 optional；
- 确认后启动执行。

### 最小实现

auto-decompose 输出至少包含：

- Change 标识和目标；
- target project；
- dependency edges；
- required/optional；
- 建议 Pipeline；
- 分解理由或不确定性。

自动分解是一次可修订的 Dispatch，不是持续由 LLM 决定每一个运行步骤。
计划确认后，后续调度尽量由确定性的 Pipeline 和依赖规则推进。

### 完成证据

- 对一个真实跨项目 Issue 生成执行图；
- 人工至少修正一次目标或依赖，以验证纠正路径；
- 修正后的计划被真实执行；
- 历史计划和实际执行的对应关系可以追踪。

## 7. Phase 5：跨项目依赖、并行和重规划

### 用户体验

用户能看到跨项目关键路径，并能处理：

- 上游 Change 失败；
- 某个 Change 被取消；
- 新发现工作需要增加 Change；
- Change 目标项目需要调整；
- 某些 Change 可以并行；
- 某个节点被新的节点替代。

### 最小实现

- 跨项目 dependency gate；
- ready 节点的确定性计算；
- required、optional、cancelled、superseded 语义；
- Execution Plan 修订或版本；
- 重规划后保留已运行历史；
- “Needs Attention” 聚合入口；
- 防止一个失败节点被其他运行节点掩盖。

### 完成证据

在真实 Issue 中制造并处理一次可恢复失败或重规划，确认：

- Issue phase 和 health 分离；
- 下游节点不会错误启动；
- 已完成节点不被重复执行；
- 计划修订没有改写历史证据；
- Issue 最终仍可通过验收关闭。

## 8. Phase 6：Issue 级 Review、Delivery 与 Acceptance

### 用户体验

多个项目的 Changes 完成后，Issue 进入统一 Review，而不是各自结束后失去
整体上下文。

用户可以检查：

- 每个项目的验证报告；
- Commit 或 PR；
- 跨项目契约是否一致；
- 是否满足 Issue 验收标准；
- 是否允许部分可选节点延期；
- 是否可以关闭 Issue。

### 最小实现

- Change 级交付证据回流到 Issue；
- Issue acceptance checklist 或可执行 gate；
- 所有必需节点完成的判断；
- 可选节点延期或取消的明确记录；
- Review 和 Waiting Human 状态；
- 显式 Issue close/accept 动作；
- Done 不再由“所有 Changes archived”直接推导。

### 完成证据

一个真实跨项目 Issue 从 Planning 完整推进到 Done，且关闭证据包含：

- Execution Plan；
- 所有必需 Changes；
- 每个 Change 的运行和验证结果；
- 交付证据；
- Issue 验收结果；
- 最终状态推导说明。

## 9. Phase 7：界面收敛

本阶段只在前述闭环已经真实运行后进行。

### 9.1 Issue Board

- 一张卡对应一个 Issue；
- Planning、Ready、Active、Review、Done；
- phase、health、progress 分离；
- 项目 chips 作为筛选；
- 卡片只显示摘要和最重要的注意事项。

### 9.2 Issue Detail

- Issue 背景和验收；
- Execution Plan；
- 按成员项目分组的 Changes；
- 跨项目依赖；
- Run、Session、报告和交付证据；
- 人工决策和 Needs Attention。

### 9.3 Operations

- 活跃和异常 Sessions；
- 实际 cwd；
- Issue/Change/Run 归属；
- resume、retry、stop；
- 项目级执行筛选。

### 9.4 Unlinked Changes

- 没有关联 Issue 的历史或临时 Changes；
- 允许挂接到已有 Issue；
- 允许创建新的单 Change Issue；
- 不把裸 Change 静默伪装成稳定 Issue。

### 完成证据

界面所显示的每项状态都能追溯到 Git 制品或真实运行证据。删除或重建 UI
缓存后，仍能恢复一致视图。

## 10. Phase 8：平台增强能力

只有核心闭环稳定后，才按真实需求选择以下能力：

- GitHub/GitLab Issue 同步；
- PR 自动创建、合并和关联；
- 评论与决策线程；
- 通知和订阅；
- 团队权限；
- 远程 daemon；
- 发布协调；
- 审计与统计；
- 更丰富的移动端或 Web 操作。

每一项仍需以真实 Issue 旅程为切片，不建立独立于核心领域模型的第二套
状态系统。

## 11. 当前看板的处理边界

当前看板的发布策略与本路线分开决定。可选方案包括：

- 保持 experimental 标识；
- 从默认导航隐藏；
- 继续作为只读 Change/Session 诊断页；
- 在新 Issue Board 可用后替换。

无论 0.1.5 如何处理，都不应：

- 为保留当前 `Task` 抽象而把它直接定义成 Issue；
- 将成员项目 chips 固化为顶层所有权分区；
- 把 Session cwd 变成项目绑定真相；
- 为美化当前卡片而提前承诺错误的信息架构。

## 12. 第一条推荐的真实黄金路径

下一步最值得验证的不是完整平台，而是：

```text
1. 选择一个真实的 Rasen 单项目 Issue。
2. 创建最小 Issue 制品和验收条件。
3. 显式绑定一个已有 Change 和目标项目。
4. 从目标项目 cwd 启动现有 Pipeline。
5. Store 作为附加规划上下文。
6. 将 Run、Session 和验证结果回流到 Issue。
7. 在验收通过前保持 Review。
8. 显式接受后进入 Done。
```

这条黄金路径通过后，再进入“单项目多 Change”；不要同时建设跨项目路由、
复杂看板和 Forge 集成。
