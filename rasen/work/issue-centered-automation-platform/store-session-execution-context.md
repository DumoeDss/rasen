# Store 模式的 Session 执行上下文与下一版衔接

> 状态：近期开工设计说明。
>
> 适用范围：`0.1.5` 的 Store Session 修复，以及它与下一版 Issue /
> Execution Plan 的衔接。
>
> 本文不定义最终 Issue 文件格式，也不承诺在 `0.1.5` 实现跨项目调度。

## 1. 结论

Store 模式下，Codex / Claude Code 默认必须从**实际要修改代码的成员项目或
worktree** 启动。

Store 是：

- planning space；
- Change、spec、proposal、tasks 和 run-state 的位置；
- Agent 的附加规划上下文；
- Session 的规划归属。

Store 默认不是：

- 实现代码的 cwd；
- Git、依赖和测试命令的执行根；
- 多项目修改的隐式主项目；
- 一个可以代替 Execution Plan 的“超级 workspace”。

只有用户明确选择“规划模式”时，Store root 才可以成为 Session cwd。

```text
planning space   = store:team-plans
execution root   = member project / selected worktree
attached context = Store root
session space    = store:team-plans
```

## 2. 当前实现中已经确认的冲突

### 2.1 一个 `space` 同时承担了两个职责

当前 `POST /api/v1/sessions` 只有 `space`，没有 execution selector：

- `src/core/management-api/wire-types.ts`
- `packages/ui/src/api/types.ts`

`src/core/management-api/sessions.ts` 解析 `space` 后，直接把
`space.root` 传给 Supervisor 作为 cwd。因此：

```text
space = store:team-plans
  -> cwd = team-plans Store root
```

这把规划归属和代码执行位置错误地合并成了同一个概念。

### 2.2 Session 归属规格支持 cwd 与 Store 分离

`rasen/specs/session-supervision/spec.md` 同时存在两条不同方向的要求：

- pointer repo 中启动的 Session 应根据 cwd 归属于它指向的 Store；
- 显式 `space` 又被规定为 subprocess cwd。

前者是正确的长期语义，后者是本次需要修正的历史兼容设计。

`rasen/changes/ui-space-redesign/planning-context.md` 也已经拍板：

```text
session -> cwd（物理 repo）-> 该 repo 的规划空间
Store view = 成员 Session 汇总
```

### 2.3 Supervisor 还没有附加规划目录

`src/core/management-api/supervisor.ts` 当前固定生成：

```text
claude -p <prompt> --dangerously-skip-permissions
       --output-format stream-json --verbose
```

没有 `--add-dir <store-root>`。因此只把 cwd 改成项目目录还不构成完整修复；
启动上下文还必须把不同于 cwd 的 planning root 作为附加目录传给 Agent。

### 2.4 Workset 已经暴露了同一类问题

`src/core/openers.ts` 暂时关闭了 Claude Code / Codex 的 `attach-dirs`
workset opener，因为多个目录仍然只能选择一个 primary cwd，“修改应该落到哪里”
没有稳定答案。

这证明 primary execution root 必须显式存在，不能从“可访问的目录集合”中猜测。

## 3. 必须分开的三个概念

| 概念 | 含义 | 是否持久化为最终业务事实 |
|---|---|---|
| Planning space | Issue、Change、spec 和 run-state 所在空间 | 是 |
| Execution target | 该次 Change 应在哪个成员项目执行 | 下一版由 Execution Plan 持久化 |
| Session cwd | 某一次具体运行实际使用的本机目录 | 仅运行事实 |

这里最重要的边界是：

> `Session.cwd` 可以证明一次运行发生在哪里，但不能代替
> `Execution Plan.targetProject` 声明工作应该发生在哪里。

因此，`0.1.5` 可以增加显式 Session execution selector，但不应把它直接升级成
Change 的永久 target 字段，更不应让当前 Board 从 Session 历史反推最终业务归属。

## 4. `0.1.5` 的启动请求模型

建议把现有请求拆成：

```yaml
space: store:team-plans
execution: project:<registered-member-selector>
```

纯规划运行显式写成：

```yaml
space: store:team-plans
execution: planning
```

`execution` 的具体 wire shape 可以在实现设计时选择字符串或结构体，但必须满足：

1. `space` 只表达 planning space 和 Session 归属；
2. `execution` 只表达这次运行的 cwd；
3. 项目 selector 必须通过服务端项目注册表解析；
4. Store 场景下，解析出的项目必须仍是该 Store 的有效成员；
5. 服务端不接受客户端直接传入任意 cwd；
6. 客户端不能传入任意 Claude / Codex argv；
7. worktree root 可以复用现有已注册项目的 worktree-aware 解析，但它仍是运行时目录，
   不是持久化项目身份。

### 4.1 选择规则

1. **项目空间**
   - 未提供 `execution` 时，默认使用该项目空间解析出的 root；
   - 如果当前 UI 明确选择了 worktree，后续可以显式提交该 worktree root selector。

2. **单成员 Store**
   - UI 可以预选唯一成员；
   - 请求仍应显式提交该成员，不让服务端依赖“当前恰好只有一个成员”的静默猜测。

3. **多成员 Store**
   - 用户必须选择成员；
   - 服务端不得使用 Store root 或成员列表第一项作为默认值。

4. **纯规划任务**
   - 用户必须明确选择 `planning`；
   - 此时 cwd 才是 Store root。

5. **跨多个项目的实现**
   - 当前应为每个 primary project 分别启动 Session；
   - 不应默认给一个 Session 同时附加所有代码项目并允许任意写入；
   - 下一版由 Execution Plan 创建多个 target-aware Change 节点。

### 4.2 兼容策略

开发分支当前是 `dev/0.1.5`，现有 Store launch 语义本身就是错误行为。因此建议：

- project space 缺少 `execution` 时保持兼容；
- store space 缺少 `execution` 时返回明确的
  `execution_required`，不再静默从 Store root 启动；
- 需要 Store cwd 的旧用法改为显式 `execution: planning`。

如果发布周期不允许完成完整修复，安全降级方案是：

> 暂时禁用 Store 页面上的 Launch Run，并提示用户从成员项目目录手动启动。

不能保留当前错误默认值后直接发布。

## 5. 一个足够深的启动上下文边界

建议增加一个单一解析边界，名称可以是：

```text
resolveSessionLaunchContext
```

输入：

```text
planning space selector
execution selector
```

输出：

```text
planningSpace  # 冻结在 Session record 上
cwd            # subprocess cwd
attachedRoots  # planning root 与 cwd 不同时包含 Store root
executionRef   # 可选的运行时可观测项目引用
```

该模块统一隐藏：

- space selector 解析；
- 项目注册表解析；
- Store 成员反向枚举；
- pointer 的实时校验；
- worktree 解析；
- 路径 canonicalization；
- planning-only 规则；
- attached root 计算。

HTTP handler、UI 和 Supervisor 不应各自复制 Store 成员判断。

Supervisor 只消费已经解析完成的 `cwd`、`planningSpace` 和
`attachedRoots`，并由服务端构造：

```text
Claude Code:
  cwd = selected member
  --add-dir <store-root>

Codex:
  cwd = selected member
  --sandbox workspace-write
  --add-dir <store-root>
```

当前浏览器监督链路只支持 headless Claude。`0.1.5` 应先修复真实存在的 Claude
链路；Codex 复用同一启动语义，但应由后续 runtime adapter 接入，不能在本修复中
假装已经支持。

## 6. Session record 应保持简单

现有两个字段已经表达了最关键的运行事实：

```text
session.space = Store planning attribution
session.cwd   = actual member project/worktree
```

可以为可观测性增加一个解析后的 `executionRef`，但它不是 `0.1.5` 的必要条件。

不要在 Session record 中提前引入：

- Issue target binding；
- Execution Plan node；
- 跨项目依赖；
- durable Change ownership。

Session registry 继续只保存内存中的进程事实。Planning 和 Pipeline 真相仍然在
磁盘制品中，管理服务仍然只是 reader and launcher。

## 7. 当前 Store 看板如何处理

当前 Store 看板的成员 chip 是：

```text
Session provenance filter
```

不是：

```text
Change / Task ownership partition
```

它只能表达“这个 Task 曾经或正在从哪个成员项目运行”。修复 Session cwd 后，这个
筛选会比现在更有用，但它仍然有明确上限：

- 从未运行的 Task 只出现在 `All`；
- 同一 Task 从多个成员运行后可出现在多个筛选中；
- 归档 Task 通常没有 live Session；
- Session 历史不能声明未来应在哪个项目执行。

### `0.1.5` 建议

- 保留当前四列和成员 chip；
- 在文案上把成员 chip 明确描述为运行来源或成员活动筛选；
- 不把它改造成真正的项目分区；
- 不新增持久化 `change -> member` 字段；
- 不因为看板尚不是最终 Issue Board，就删除它已有的只读观察价值。

如果页面观感或产品定位仍不适合公开，可以标记为 experimental；但 Store launch
错误与看板是否隐藏是两个独立决定。

### 下一版的真实分区

真正的项目分区必须来自：

```text
Issue
  -> accepted Execution Plan
      -> Change A / targetProject: client
      -> Change B / targetProject: server
      -> Change C / targetProject: website
```

最终展示应是：

- 全局 Issue Board：一个 Issue 只显示一次；
- Issue Detail：按目标项目分 lane 展示 Changes；
- 项目队列：从 target binding 反向投影相关 Issue；
- Operations：展示 Session、Stage 和异常，不混进产品意图看板。

## 8. `0.1.5` 建议实施范围

建议建立一个独立 Change，例如：

```text
separate-session-planning-and-execution-context
```

只做：

1. 拆分 Session launch 的 planning space 与 execution selector；
2. 实现单一 launch-context resolver；
3. 校验 Store member；
4. Store Task Detail 的 Launch Run 增加成员选择；
5. Supervisor 支持附加 planning root；
6. 保持 Session `space=store`、`cwd=member project`；
7. 更新 main spec、wire mirror、API/UI 测试和用户提示；
8. 用真实双成员 Store 完成一次端到端 dogfood。

明确不做：

- Issue schema；
- Execution Plan schema；
- 持久化 Change target；
- Board 大改版；
- 自动项目路由；
- 跨项目调度器；
- 重启 Workset CLI agent opener；
- 浏览器 Codex Session 支持。

这个切片很小，但它建立的语义可以被下一版复用。

## 9. 下一版的第一个纵向闭环

Store 修复完成后，不应直接开发完整 Issue Board 或 Scheduler。下一版的第一个真实
纵向切片应是：

```text
一个真实 Issue
  -> 一个显式接受的 target project
  -> 一个现有 Change
  -> 复用现有 Change Pipeline 完整执行
  -> 汇总证据
  -> Issue acceptance
```

最小制品只需要表达：

- Issue 的产品目标；
- acceptance criteria；
- 一个 Change reference；
- 一个 durable target project binding；
- Issue phase / health / progress 的可解释派生；
- 最终验收结果和证据引用。

第一轮可以先用 CLI 和只读 projection 证明闭环，再制作 Issue Board。只有这条真实
链路在日常开发中跑通后，才依次增加：

1. 一个 Issue、同一项目的多个 Changes；
2. 一个 Issue、多个项目、人工 target binding；
3. 跨项目依赖与恢复；
4. 自动分解和项目路由；
5. 后台调度、Operations 和外部 Tracker。

这保持了 Rasen 自下而上的开发方法：每增加一层，都必须继续贯穿真实自动化流程。

## 10. 验收证据

### 10.1 API / 单元测试

- project space 缺少 execution 时仍从项目 root 启动；
- store space 缺少 execution 时拒绝且不 spawn；
- Store 的有效成员 selector 解析为成员 cwd；
- 非成员项目被拒绝；
- 失效 pointer 或失效成员被拒绝；
- `execution: planning` 明确从 Store root 启动；
- Session record 同时满足 `space=store`、`cwd=member`；
- Store filtered session listing 仍能找到该 Session；
- run-state join 仍从 Session planning space 读取；
- Store root 只在不同于 cwd 时进入附加目录 argv；
- Windows `.cmd` argv 注入防护测试继续通过。

### 10.2 UI 测试

- 多成员 Store 必须选择执行成员；
- 单成员 Store 预选但提交显式 selector；
- planning-only 是明确选项，不是默认值；
- server validation error 原样显示；
- 项目空间的现有 Launch Run 保持兼容；
- 成员 chip 继续根据实际 Session cwd 过滤。

### 10.3 真实双成员 Store dogfood

至少用一个包含两个成员项目的真实 Store 验证：

1. 从 Store Task Detail 选择成员 A；
2. Agent cwd 是成员 A；
3. Agent 可以读取和写入 Store 中的 Change 制品；
4. Git、依赖和测试命令都在成员 A 执行；
5. 成员 B 没有被修改；
6. Session 在 Store 空间可见；
7. Session 在成员 A 的活动筛选中可见；
8. Pipeline 从启动到完成或明确失败完整走通一次。

未完成这次真实闭环，不能仅凭单元测试宣称 Store 修复完成。

## 11. 不影响总体设计的判断标准

本次和下一版的任何设计，只要满足以下条件，就不会把短期实现固化成错误的长期
架构：

- planning space 与 execution root 永远是两个概念；
- runtime cwd 不等于 durable target binding；
- Change 仍是单 primary project 的执行单元；
- 一个跨项目 Issue 由多个 target-aware Changes 组成；
- Store 是规划根，不是隐式多项目 cwd；
- Board 只投影已有事实，不创造业务状态；
- 当前 member chip 不冒充项目 ownership；
- 先跑通一个真实 Issue 闭环，再增加平台层；
- 不用 Workset 或“附加所有目录”绕过项目路由问题；
- 每个新抽象都必须被真实日常开发链路消费。
