# Rasen 0.1.5 当前能力与边界

> 状态：当前实现基线。
>
> 本文描述当前 `0.1.5` 代码实际能够完成的工作，以及它与终极 Issue
> 自动化平台之间的边界。它不是未来能力规划；长期方向见
> [`north-star.md`](./north-star.md)。

## 1. 当前版本的准确定位

Rasen `0.1.5` 已经是：

> 一个 Git-native、以 Change 为单位、由 Agent Session 驱动的自动化开发
> Harness，具备可组合 Pipeline、角色隔离、质量 Gate、恢复能力、Store
> 规划模式，以及本地 Web 管理控制面。

它还不是：

> 一个以 Issue 为单位、能够协调多个成员项目的自治开发平台。

当前三个核心边界是：

```text
工作单位：Change，不是 Issue
执行范围：一个选定项目 / 规划根，不是跨项目执行图
自动化宿主：Agent Session，不是后台 Issue Scheduler
```

当前成立的主链路是：

```text
用户提出任务
  ↓
Claude / Codex 会话调用 /rasen-auto 或 /rasen-goal
  ↓
选择 Pipeline
  ↓
创建并完善 Change 制品
  ↓
实施、验证、独立审查、修复循环
  ↓
Ship / Archive
  ↓
运行状态和证据保存在磁盘
```

## 2. 单项目 Change 的完整开发闭环

当前可以处理一个真实项目中的：

- Bug 修复；
- 小功能；
- 完整功能；
- 重构；
- 研究和评估任务；
- 性能或质量指标优化。

对应能力包括：

- Explore；
- Proposal / Design / Specs / Tasks；
- Apply；
- Verify；
- Review；
- Review -> Fix 循环；
- Ship；
- Archive；
- 主规格同步。

真正驱动 Pipeline 的是当前 Codex 或 Claude Code 会话。Rasen 提供制品、
Skills、Pipeline、run-state、Gate 和角色约束。

当前没有独立的 `rasen pipeline run` 程序化执行引擎。`rasen pipeline`
命令负责查看、配置、校验、保存和恢复运行信息；实际推进由 `/rasen-auto`
对应的 LEAD Agent 完成。

## 3. 角色隔离的自动 Pipeline

当前 Pipeline 支持：

- planner、implementer、reviewer 等角色隔离；
- author != verifier；
- Stage dependency DAG；
- 条件 Stage；
- parallel group；
- 人工 Gate；
- 有界 review/fix loop；
- 失败后升级，而不是静默通过；
- 持久化 run-state；
- 跨 Session 恢复；
- project、store、global 多层配置；
- 每个 Stage 的 model、runtime、gate 和 handoff 配置。

当前内置 Pipeline 包括：

- `bug-fix`
- `small-feature`
- `full-feature`
- `auto-decompose`
- `goal-loop-measure`
- `goal-loop-evaluate`
- `goal-loop-research`

这些能力已经持续用于 Rasen 自身开发，而不是只存在于设计或接口中。

## 4. 大任务自动拆成多个 Changes

`auto-decompose` 当前可以：

```text
较大任务
  ↓
拆分方案
  ├─ Child Change A
  ├─ Child Change B
  └─ Child Change C
  ↓
Dependency DAG
  ↓
可证明独立时并行，否则串行
  ↓
每个 Child Change 运行自己的 Pipeline
  ↓
组合级统一交付
```

每个子 Change 都要求可独立交付、可独立审查。拆分只允许发生在顶层一次，
避免递归分解失控。

当前解决的是：

> 一个规划根中的多个 Changes。

当前尚未解决：

> 一个 Issue 的不同 Changes 分别绑定客户端、服务端、官网等多个成员项目，
> 并从各自 cwd 执行。

## 5. Goal Loop

当前可以针对一个明确目标反复迭代：

```text
定义目标
  ↓
实施
  ↓
Measure 或 Evaluate
  ↓
未达到目标 -> 下一轮
  ↓
达到目标或耗尽 maxRounds
```

支持三类目标：

- 可量化目标：性能、延迟、评分、体积；
- 评价型目标：代码质量、设计质量、满足 rubric；
- 研究型目标：反复研究、撰写和评审报告。

Goal Loop 已经能够把“一次性让 AI 改代码”变成有上限、有 Gate、有证据的
连续优化过程。

## 6. Store 规划模式

当前 Store 可以作为独立的 Git-native 规划仓库：

- 创建和注册 Store；
- 把项目内规划迁移到 Store；
- 从 Store 恢复到项目；
- 注册成员项目；
- 保存 specs、changes 和 archive；
- 通过 `--store` 或 `--project` 选择命令作用根；
- Store -> Project -> Global 配置继承；
- 检查 Store 健康和漂移；
- 项目引用 Store 作为规划上下文；
- 在项目内规划与 Store 规划之间执行 adopt/eject；
- 调整 archive 位置并清理失去所有权的 machine home。

正常的手动使用形态可以是：

```text
Agent 从真实项目目录启动
  +
Rasen 命令使用 --store <id>
  =
代码修改发生在项目中，Change 制品位于 Store
```

因此，“规划位置和代码位置分离”已经基本成立。

但当前 Store 尚未成为：

> 能从一个 Issue 自动生成并调度多个成员项目执行图的协调器。

## 7. Pipeline、Workflow 和 Profile 扩展

当前可以：

- 用 YAML 定义 Pipeline；
- 查看 Pipeline DAG；
- 校验循环依赖、角色、Skill、条件和 Stage；
- 导入、导出、安装和删除 `.rasenpkg`；
- 安装带依赖的 Workflow；
- 使用 Profile 选择一组 Workflow；
- 按 global/store/project 配置模型、runtime、Gate、handoff；
- 为不同角色选择 Claude 或 Codex runtime；
- 在 Web Pipeline Canvas 中拖入 Skill、连接依赖和编辑 Stage；
- 在保存前执行服务器端校验；
- 安装用户 Pipeline，而不修改内置定义。

当前版本不仅能够使用内置流程，也具备流程分发和扩展基础。

## 8. 本地 Web 管理面与 daemon

`rasen ui` 和常驻 daemon 当前提供：

- Projects / Stores 空间切换；
- Spaces 搜索、固定和创建；
- Change/Task 看板；
- Task 详情；
- Archive；
- Config；
- Pipelines；
- Pipeline Canvas；
- Workflows；
- Profiles；
- Token Audit；
- 运行 Session 列表和输出尾部；
- 启动、观察和终止后台 Agent Session。

daemon 可以在关闭启动它的终端后继续运行 Session，并支持：

- Session 超时；
- 无输出 watchdog；
- 进程树终止；
- 默认最多三个并发 Session；
- 结束状态的有界保留；
- 磁盘 run-state 联查；
- Windows `.cmd` / `.bat` Agent CLI 启动。

当前浏览器监督启动只支持 headless Claude。

Session 事实主要保存在 daemon 内存中：

- daemon 正常停止会终止其 Session；
- daemon 重启后，磁盘 Pipeline 状态仍在；
- 但过去的 Session 注册信息不再存在；
- 强制杀死 daemon 仍可能留下孤儿进程，需要依赖 run-state 手工恢复。

管理服务器坚持“reader and launcher”原则，不另建一套 Pipeline 状态真相。

## 9. Token 审计与 Prompt Cache Keepalive

当前支持：

- 分析 Claude Code transcript；
- 分析 Codex rollout；
- 分析 Zed thread；
- 识别 cache 重建、TTL 过期、compaction、rollback、idle gap；
- 输出本地 HTML 报告；
- 数据完全本地处理；
- Claude subagent 空闲期间使用 keepalive beat；
- 按 global/project 开关和配置 beat 时长；
- 限制 beat 次数，避免永久占用 worker。

这些属于运行效率和诊断能力，不是简单的项目管理功能。

## 10. 当前看板实际表达的内容

当前看板不是 Issue Board，而是 Change projection：

- 裸 Change 被显示为单项 `Task`；
- Portfolio 的多个子 Changes 合并成一张 `Task` 卡片；
- 卡片进入 Planning、Ready、In Progress、Done；
- 状态从 Change 制品、实施任务和 run-state 派生；
- 可以创建新的 Change；
- 可以进入 Task 详情；
- 可以看到关联 Session；
- 项目空间可以切换 worktree；
- Store 空间可以按成员 chip 筛选。

卡片不可拖动，因为状态来自磁盘，而不是看板字段。

Store 成员筛选当前使用 Session 溯源：

```text
Session cwd 位于 member.root 下
  -> 推断该 Task 涉及这个成员
```

它不是持久的 Change -> member project 绑定，也没有真正的成员项目分区。

因此：

- 从未运行过 Session 的 Task 只出现在 `All`；
- 从 Store 根启动的 Session 不属于任何成员项目；
- 一个 Task 在多个项目启动过，可能同时出现在多个成员筛选中；
- member chip 是运行来源筛选，不是工作归属。

## 11. 当前尚不能可靠完成的事情

### 11.1 没有真正的 Issue 实体

当前最高层仍是 Change 或 Portfolio，没有独立的产品意图、Issue 验收和稳定
身份。

### 11.2 没有跨项目 Execution Plan

当前不能稳定表达：

```text
Client / Change A
Server / Change B
Website / Change C
```

以及三者之间的 target binding 和 dependency。

### 11.3 Change 没有稳定目标项目绑定

当前主要依靠命令选择、当前 cwd 或 Session 来源推断。Session cwd 是运行
证据，不是 Change 应在哪个项目执行的声明。

### 11.4 Store UI 的启动目录不正确

当前从 Store 页面选择 Store space 启动 Session 时，Session API 会把
Store root 用作 subprocess cwd。

这适合：

- 修改 Store 规划内容；
- 纯研究或规格任务。

它不适合：

- 实施客户端代码；
- 实施服务端代码；
- 根据成员项目执行测试和 Git 操作。

### 11.5 Workset 暂不能启动 CLI Agent

Workset 可以在 VS Code、Cursor 等 IDE 中打开多目录，但 Claude/Codex 的
`attach-dirs` opener 当前被主动禁用，因为尚未解决：

- 唯一 primary cwd；
- 代码修改落点；
- Store 与项目的职责；
- 多项目写入权限。

### 11.6 没有 Issue 级验收

所有 Changes 完成或归档，还不能表达“整个产品目标是否满足”。

### 11.7 没有后台 Issue 调度器

daemon 可以启动和监督 Agent Session，但不会持续扫描 Issue 队列、创建跨
项目 Execution Plan 和调度 Changes。

自动化大脑仍然存在于某个 LEAD Agent Session 中。

### 11.8 没有完整团队协作平台

当前尚无完整的：

- 多用户权限；
- Issue Comment / Decision Timeline；
- Inbox / 通知；
- Remote Runtime；
- 跨机器任务认领；
- 外部 Issue Tracker 双向同步；
- PR Review 反馈自动回流；
- 跨项目统一发布。

## 12. 当前版本最适合解决的问题

当前 `0.1.5` 最适合：

1. 在一个真实项目中，把 Bug 或功能从规格推进到交付。
2. 把较大任务拆成同一规划根中的多个 Changes。
3. 用独立 Agent 角色、Gate 和 Review Loop 提高质量。
4. 用 Goal Loop 持续优化一个可度量或可评估目标。
5. 把规划放进 Store，同时从真实项目目录实施代码。
6. 建立和分发团队自己的 Workflow、Pipeline 和 Profile。
7. 在本地 Web 控制面观察和管理 Change 级运行。
8. 分析 Token 消耗、Cache churn 和 Session 效率。

## 13. 当前版本与下一阶段的连接点

当前最有价值的底座是：

> 一个真实 Change 可以持续经过真实自动化流程。

下一阶段不应替换这条链路，而应在它上面增加：

```text
Issue contract
  -> explicit target project
      -> existing Change Pipeline
          -> Issue-level evidence and acceptance
```

短期修复应优先让现有 Store 模式遵守这个方向：

- planning space 与 execution root 分离；
- Agent 从实际项目 cwd 启动；
- Store 作为附加规划上下文；
- 运行归属与目标项目可解释；
- 不把当前 Task、member chip 或 Session cwd 固化成最终 Issue 模型。

详细的近期开工设计和验收边界见
[`store-session-execution-context.md`](./store-session-execution-context.md)。
