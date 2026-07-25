# 以 Issue 为中心的自动化平台目标

> 状态：产品与架构方向探索。本文描述目标模型，不代表当前产品已经实现。
>
> 背景：Rasen 正从 Change 级自动化继续向上生长，最终目标是形成一个以
> Issue 为单位、能够协调多个成员项目的自动化平台。
>
> 长期北极星、Harness 设计遗产和永久开发戒律见
> [`north-star.md`](./north-star.md)；本文只固定当前已经收敛的目标模型。

## 1. 为什么需要重新定义上层模型

### 1.1 Harness 的失败教训

此前的 Harness 项目采用从上向下的开发方式。平台框架、服务边界、API、
调度与界面的大部分结构已经搭建，但核心自动化流程没有真正完整运行过。
项目审计因此高估了完成度：它验证了组件、入口和文件是否存在，却没有把
一次真实的端到端运行作为完成条件。

Harness 的迁移审计曾把以下链路标记为基本完成：

```text
Issue -> Pipeline -> Repository -> daemon push -> PR
```

但同一份审计也说明：

- 完整 E2E 仍需运行时确认；
- smoke 脚本存在不等于真实用户旅程已经跑通；
- 审计方法本身不依赖运行时验证。

相关历史材料：

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\migration-completion-review.md`
- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\linear-harness-design.md`

因此，本目标采用与 Harness 相反的完成标准：

> 组件存在不是完成；只有真实 Issue 从进入系统到验收关闭完整跑通，系统
> 才算具备相应能力。

### 1.2 Rasen 当前的优势

Rasen 采用从下向上的路线：

- 自动化 Pipeline 一直参与自身的日常开发；
- 改进、修复和需求来自真实使用；
- Change 的创建、执行、验证和归档已经是可运行的基础；
- auto-decompose 已经能够把较大的工作分成多个可独立处理的 Changes；
- 上层模型可以建立在被持续验证的执行能力上，而不是预先搭建一整套平台。

下一步不是给当前看板增加更多装饰，而是确定 Issue、Change、成员项目和
运行实例之间真正稳定的关系。

## 2. 核心结论

最终形态不应是：

```text
Store
  ├─ 客户端分区 -> Changes
  ├─ 服务端分区 -> Changes
  └─ 官网分区   -> Changes
```

而应是：

```text
Store / Planning Space
  └─ Issue
       └─ Execution Plan
            ├─ 客户端项目
            │    ├─ Change A
            │    └─ Change B
            ├─ 服务端项目
            │    └─ Change C
            └─ 官网项目
                 └─ Change D
```

由此得到以下产品原则：

1. 看板顶层以 Issue 为单位。
2. 一个 Issue 无论涉及多少成员项目，在主看板中都只出现一次。
3. Issue 表达用户意图、背景和验收目标，不归属于某个代码仓库。
4. 成员项目属于执行维度，在 Issue 详情和项目级执行视图中出现。
5. Change 是可以独立执行、验证和交付的工程切片。
6. Run、Stage 和 Session 是执行状态，不与产品规划卡片处于同一层。
7. Store 是规划空间；执行某个 Change 时，Agent 从该 Change 绑定的成员
   项目目录启动，Store 作为附加规划上下文。

## 3. 从 Harness 继承什么

Harness 的正确设计判断是：

> 任务组织维度与代码组织维度不同。

其设计已经区分：

- Planning Domain：面向 Issue，不感知 Repository；
- Execution Domain：面向实际执行，感知 Repository；
- Dispatch：把 Issue 转换成绑定到不同 Repository 的执行任务；
- 一个跨前后端的功能仍然是一个 Issue，而不是两个互不相关的 Issue。

Rasen 应继承这项“规划域/执行域分离”的原则，但不继承 Harness 的平台优先
开发顺序，也不把“模块已经搭建”作为完成证据。

Harness 早期的“一条 Issue 对应一条 Pipeline”也不适合作为最终模型。对
跨项目 Issue，更准确的关系是：

```text
Issue
  -> Execution Plan / Dependency Graph
      -> 多个目标项目上的 Change
          -> 每个 Change 自己的 Pipeline Run
```

## 4. 领域模型

最终应固定以下一级概念，避免继续使用含义过载的 `Task`。

| 概念 | 责任 | 是否感知成员项目 |
| --- | --- | --- |
| Issue | 产品意图、背景、验收标准、优先级和产品依赖 | 否 |
| Execution Plan | Issue 的分解结果、目标项目和跨 Change 依赖图 | 是 |
| Change | 可独立执行、验证和交付的工程切片 | 是 |
| Run | 对一个 Change 的一次 Pipeline 执行尝试 | 是 |
| Session | Codex、Claude Code 等真实 Agent 进程 | 是 |

推荐的稳定层级为：

```text
Issue
  └─ Execution Plan
       └─ Change
            └─ Pipeline Run
                 └─ Stage / Session
                      └─ 实施检查项
```

### 4.1 Issue

Issue 属于规划域，应包含：

- 稳定身份；
- 标题和背景；
- 用户价值或问题陈述；
- 验收标准；
- 优先级；
- Issue 级依赖；
- 取消、关闭等人工意图状态。

Issue 不直接保存 `repository_id` 或工作目录。界面上显示的项目徽标是从
Execution Plan 派生出来的，而不是 Issue 的归属字段。

### 4.2 Execution Plan

Execution Plan 是 Issue 和执行域之间的桥梁。它记录：

- Issue 被分成哪些 Change；
- 每个 Change 的目标成员项目；
- Change 之间的依赖；
- 哪些 Change 是必需的，哪些是可选的；
- 使用哪条 Pipeline；
- 节点被取消、替换或重新规划的历史。

auto-decompose 应从“生成子 Changes 和 DAG”演进为“生成带目标项目绑定的
执行图”。自动结果必须允许人工检查和修正，再进入实际执行。

概念示例：

```yaml
issue: ISSUE-42

nodes:
  - id: server-contract
    project: server
    change: add-session-contract
    required: true

  - id: client-session
    project: client
    change: consume-session-contract
    depends_on:
      - server-contract

  - id: website-docs
    project: website
    change: document-session-flow
    depends_on:
      - server-contract
```

### 4.3 Change

一个 Change 应只绑定一个主成员项目。

如果一个 Change 必须同时修改客户端和服务端，它应在项目边界处分解成两个
Change，并由 Execution Plan 协调。该约束使以下信息保持确定：

- Agent 启动 cwd；
- Git 和工作树边界；
- 权限边界；
- 验证命令；
- Commit 和 PR 的归属；
- 重试、暂停和恢复的范围。

Change 可以读取其他项目作为上下文，但其主要写入目标应保持唯一。确需
改变目标时，应产生新的 Execution Plan 修订或替代节点，而不是静默改变
已经运行过的历史。

### 4.4 Run 与 Session

Run 是一次执行尝试，Session 是该尝试中的真实进程。二者负责记录：

- 实际 cwd；
- 使用的工具和模型；
- Pipeline 与 Stage；
- 运行状态；
- 日志、报告和验证证据；
- Commit、PR 或其他交付证据；
- 失败、重试和恢复关系。

Session cwd 是运行来源证据，不是 Change 项目归属的来源真相。

## 5. Store 模式下的工作目录

Store 模式应明确区分两个根：

```text
Planning root = Store
Execution root = Change 绑定的成员项目
```

启动 Codex 或 Claude Code 时：

```text
cwd              = 目标成员项目目录
planning context = Store
change reference = Store 或目标项目中的 Change
```

Agent 可以从 Store 读取 Issue、验收标准、Execution Plan 和关联 Changes，
但默认写入范围、Git 状态和项目命令应以成员项目为准。

从 Store 目录直接启动 Agent 只适用于工作目标本身就是 Store 内容的情况，
例如修改规划文档或 Store 自身配置。它不应是 Store 模式的通用默认值。

## 6. 最终界面结构

最终产品应拆成三个互相配合、但语义不同的界面。

### 6.1 Issue Board：规划与推进

主看板只显示 Issue：

```text
Planning          Ready             Active              Review          Done

┌ ISSUE-42 ─────────────────────────────────┐
│ 登录会话重构                              │
│ Client 1/2 · Server 2/3 · Website ✓       │
│ 2 running · 1 blocked                     │
│ 主要阻塞：客户端等待服务端契约            │
└───────────────────────────────────────────┘
```

Issue 卡片只表达：

- Issue 身份、标题和优先级；
- 涉及的成员项目；
- 各项目 Change 完成度；
- 当前活跃 Run 或 Session 数量；
- 最重要的一个阻塞或待人工决策；
- 总体验收状态。

不要把 Pipeline Stage、Session 日志、重试按钮和详细产物全部塞入 Issue
卡片。这些属于执行详情。

成员项目 chips 可以保留，但其语义是：

> 筛选 Execution Plan 中包含该成员项目的 Issue。

它们不是 Issue 归属选择器，也不是将跨项目 Issue 复制到多个主分区的依据。

### 6.2 Issue Detail：按成员项目组织执行图

进入 Issue 后，按成员项目分组显示 Changes：

```text
ISSUE-42  登录会话重构
验收：客户端可刷新会话，服务端兼容旧 Token，官网文档完成更新

需要关注：客户端 Change 正在等待 server-contract

Client
  ├─ CH-102 更新登录状态机       Active
  └─ CH-104 增加刷新失败 UI      Ready
             ↑ depends on

Server
  ├─ CH-98 新增 session contract Done
  └─ CH-99 兼容旧 token          Review

Website
  └─ CH-31 更新开发文档           Done
```

这里的“项目分区”是合理的，因为用户已经进入单个 Issue，需要理解其执行
结构，而不是决定该 Issue 在全局看板中应该被放到哪里。

当 Change 数量很多时：

- 默认使用按项目分组的树形或列表视图；
- 需要分析跨项目依赖时再切换到 DAG；
- 不在主看板上直接铺开复杂依赖图。

每个 Change 展开后显示：

```text
Change
  └─ Pipeline Run
       ├─ Stage
       ├─ Agent Session
       ├─ 验证结果
       └─ Commit / PR / Report
```

### 6.3 Operations：运行控制面

Operations 页面单独回答：

- 哪些 Agent 正在运行；
- 实际 cwd 是什么；
- 属于哪个 Issue 和 Change；
- 当前处于哪个 Stage；
- 是否失联、失败、等待输入或等待人工；
- 是否可以 resume、retry 或 stop。

Operations 是系统运行控制面，不是产品规划看板。

还可以提供项目级执行页：

```text
Server 项目
  ├─ 当前 Changes
  ├─ Active Runs
  ├─ 待审查 PR
  └─ 关联 Issues
```

项目级页面是二级执行视图。它不能取代全局 Issue Board。

## 7. Issue 状态模型

Issue 状态不能只使用一个 Change 状态优先级进行聚合。最终应拆成三个正交
维度：

```text
phase:    Planning | Ready | Active | Review | Done
health:   Healthy | Blocked | Failed | Waiting Human | Stale
progress: 已完成必需节点数 / 必需节点总数
```

示例：

- 两个 Change 正在运行，同时一个 Change 失败：
  - `phase = Active`
  - `health = Failed`
- 所有实现 Change 已完成，但 PR 尚未合并或验收未通过：
  - `phase = Review`
  - `health = Waiting Human`
- 所有必需 Change 已交付，且 Issue 验收条件满足：
  - `phase = Done`
  - `health = Healthy`

推荐的阶段推导原则：

1. 没有可接受的 Execution Plan：`Planning`。
2. 执行图已确认，存在可运行节点但尚未开始：`Ready`。
3. 任意必需节点正在运行，或执行图已经部分推进：`Active`。
4. 所有实现节点完成，但仍待合并、发布或 Issue 验收：`Review`。
5. 所有必需节点交付，且 Issue 验收满足：`Done`。

失败、阻塞和待人工不应被硬塞成生命周期阶段，而应作为 health 和统一的
“Needs Attention”入口显示。

“所有 Change 已 archived”不能自动等同于“Issue 完成”。Issue 的最终完成
标准属于 Issue 验收。

## 8. 物理存储方向

逻辑关系应先固定，文件最终放在 Store 还是成员项目可以渐进演化。

近期 Store 模式可以采用：

```text
store/
  issues/
    ISSUE-42/
      issue.yaml
      description.md
      acceptance.md
      execution.yaml

  changes/
    server-contract/
    client-session/
```

其中：

- `issue.yaml`、`description.md` 和 `acceptance.md` 属于 repo-blind 规划域；
- `execution.yaml` 保存项目绑定、Change 引用和依赖图；
- Changes 在近期仍可位于 Store；
- 执行 Change 时，根据 Execution Plan 从对应成员项目 cwd 启动 Agent。

以后如果决定 Change 应存回成员仓库，Execution Plan 只需把 `changeRef`
指向目标项目中的 Change。Issue 模型和 UI 不需要因此重做。

原则是：

> 先确定 Issue、Execution Plan、Change 和成员项目之间的逻辑关系，不让
> 当前文件位置绑架顶层模型。

## 9. 对当前看板模型的判断

当前 UI 把 portfolio 或裸 Change 聚合成顶层 `Task`。这可以作为临时只读
投影，但不适合直接升级成最终 Issue 模型。

当前依据包括：

- `rasen/changes/ui-space-redesign/planning-context.md`
- `rasen/specs/board-ui/spec.md`
- `packages/ui/src/board/columns.ts`

主要问题：

1. `Task` 含义过载：
   - UI 顶层工作项；
   - `tasks.md` 中的实施检查项；
   - 旧 Harness 中的执行任务。
2. 裸 Change 被显示为单项 Task，只是显示便利，不代表它拥有 Issue 的背景、
   验收和稳定身份。
3. Portfolio 更接近 Execution Plan，而不是 Issue。
4. Portfolio 的部分父子识别依赖目录或命名推断，跨项目执行需要显式引用。
5. 当前 Store 成员归属主要来自 Session cwd，只能说明“曾从哪里运行”，
   不能说明 Change 应在哪个项目执行。
6. 当前状态聚合没有表达失败、人工等待、依赖、关键路径和 Issue 验收。

因此：

- 保留并演进现有 portfolio/decompose/DAG 能力；
- 将 portfolio 的长期语义收敛为 Issue 的 Execution Plan；
- 不把当前 UI `Task` 简单重命名为 `Issue`；
- 允许裸 Changes 出现在 `Unlinked Changes` 或 `Inbox`；
- 单 Change Issue 可以在 UX 上做到零额外操作，但底层仍应有稳定 Issue 身份；
- Session cwd 继续作为运行审计信息，而不是项目绑定的真相来源。

当前卡片、Session 状态、部分列组件可能复用于后续界面，但最终顶层信息
架构应重建为：

```text
Issue Board
  + Issue Execution Detail
  + Operations
```

## 10. 非目标与边界

本目标暂不决定：

- 0.1.5 是否隐藏、标记 experimental 或继续展示当前看板；
- 最终使用数据库还是完全 Git-native 的 Issue 索引；
- Change 最终必须位于 Store 还是成员项目；
- 评论、通知、权限和远程协作的完整平台设计；
- GitHub、GitLab 等 Forge 的最终集成方式。

这些问题不应阻塞核心垂直闭环，也不应迫使最终模型迁就当前占位看板。

## 11. 成功标准

目标成立时，一个真实用户可以表达：

```text
我提交了一个 Issue。
系统把它分成客户端、服务端和官网的多个 Changes。
我检查并修正了项目绑定与依赖。
每个 Agent 都从正确的项目目录启动。
所有运行状态和交付证据回流到同一个 Issue。
当全部必需工作完成且验收通过后，Issue 才关闭。
```

系统证据必须来自一次真实闭环：

```text
真实 Issue
  -> 真实分解与项目绑定
  -> 从正确成员项目 cwd 启动
  -> 真实 Pipeline 执行
  -> 结果与证据回流
  -> Issue 状态正确
  -> 验收关闭
```

任何只证明“API、页面、文件、测试桩或调度组件存在”的结果，都不足以证明
该目标已经完成。
