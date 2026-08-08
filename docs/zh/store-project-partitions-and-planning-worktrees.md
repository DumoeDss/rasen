# Store 项目分区、规划 Worktree 与 Change 终态设计

> 状态：已接受的目标设计，等待实现。
>
> 更新日期：2026-08-04。
>
> 本文定义 Store 模式下一阶段的权威模型，并覆盖
> [《Rasen 文件落点目标设计》](./file-placement-and-planning-roots.md)中有关
> Store 扁平 `rasen/specs`、`rasen/changes`、`rasen/design-docs`，以及
> `--store` 与 `--project` 互斥的旧结论。未绑定 Store 的独立项目仍沿用原有
> in-project 布局。

## 一句话结论

Store 是唯一的规划仓库，也是 planning root；Store 内部必须再按 `projectId`
划分项目规划空间。并行版本线和未合并 Change 不通过额外目录层级区分，而由
Store 自己的 Git branch/worktree 隔离：

```text
执行项目 worktree  <——显式绑定——>  Store 规划 worktree
       代码                           该项目、该目标线的规划
```

所以目标不是“Store 放一部分、项目放一部分规划”，而是：

- 所有长期规划内容集中在一个 Store Git 仓库；
- Store 内部的项目内容按 `projectId` 分目录；
- 项目代码仓库/worktree 只承载代码、probe、执行期状态，以及定位 Store 所需的
  最小 binding；
- Store branch/worktree 承载尚未合并的规划状态；
- Change 只有在 `landed` 终态下才能同步规范。

## 1. 问题与根因

0.1.6 的 Store 实现把以下两个概念合并成了一个：

1. `StoreRoot`：Store Git checkout 的物理根；
2. `ProjectPlanningHome`：某个项目在 Store 中拥有的规划命名空间。

因此 `adopt` 把不同项目的内容都移动到了同一组扁平目录：

```text
<Store>/rasen/specs/
<Store>/rasen/design-docs/
<Store>/rasen/changes/
```

这会造成四类结构性问题：

- 不同项目的同名 Change、spec 或 design-doc 会碰撞；
- 只看路径无法确定内容属于哪个项目；
- ChangeInstance 身份被迫依赖物理目录，跨 worktree 后不稳定；
- archive 默认同步 spec，无法正确表达“废弃 0.1.7、改做 0.2.0”。

这不是在扁平目录里再增加一个命名前缀就能修好的问题。根模型必须从
“一个 Store 等于一个 PlanningHome”改成“一个 Store 包含多个按项目分区的
PlanningHome”。

## 2. 已锁定的不变量

以下规则是实现和评审的硬约束。

1. **Store 模式只有一个规划真相源。** 项目一旦绑定 Store，其长期 specs、
   design-docs、Changes 和 Archive 全部位于 Store；项目仓库不得同时维护另一份
   可写规划树。
2. **每个 Change 恰好属于一个项目。** 跨项目工作用 Store 级 Issue/
   Execution Plan 编排多个项目 Change，不能创建“无项目归属”的普通 Change。
3. **项目分区与版本线隔离是两个维度。** `projectId` 决定内容归属；
   `targetLineId` 与 Store Git branch/worktree 决定尚未合并的时间线。
4. **branch 名不是持久身份。** branch 可改名、删除或重建；持久引用使用稳定的
   `targetLineId`、`changeInstanceId` 和提交 OID。
5. **执行 worktree 与规划 worktree 显式成对。** 所有写命令使用冻结后的绑定，
   不得从当前 branch 名、相邻目录或 Store 主 checkout 猜测目标。
6. **只有 `landed` 同步规范。** `superseded`、`cancelled`、`abandoned` 都不得
   修改 canonical specs。
7. **下游不得拼 Store 内部路径。** CLI、Session、Archive、UI/API 都消费统一的
   `PlanningScope` capability，不能各自执行 `join(storeRoot, "rasen/changes")`。
8. **破坏性操作先 plan 后 apply。** migrate、adopt、finalize/archive 和 worktree
   清理都先生成不可变计划；来源不明确、目标已存在或 Git 证明不足时失败关闭。
9. **不双写。** 迁移期可以兼容读取旧扁平 Store，但任何一次写入只能落到旧模型
   或新模型中的一处；进入新模型后禁止回写旧路径。
10. **Store 主 checkout 是集成面。** 日常 Change 规划不得共享写入同一个 Store
    checkout；并发工作使用独立 Store worktree。

## 3. 术语与身份

| 术语 | 含义 |
| --- | --- |
| `StoreRoot` | 某个 Store Git worktree 的物理根目录 |
| `storeUid` | Store 的稳定身份，不随路径、checkout 或仓库改名改变 |
| `projectId` | Store 成员项目的稳定身份，也是在 Store 内的分区键 |
| `ProjectPlanningHome` | `<StoreRoot>/rasen/projects/<projectId>/` |
| `targetLineId` | 目标发布线/集成线的稳定身份，例如 `line-0.1`、`line-0.2` |
| Store integration ref | `targetLineId` 当前映射的 Store Git ref，可变 |
| Store planning worktree | 从 integration ref 派生、服务于未合并 Change 的 Store worktree |
| execution worktree | 项目代码仓库中实际实现 Change 的 worktree |
| `PlanningScopeId` | Store、项目和目标线三者组成的稳定规划作用域身份 |
| `ChangeInstanceId` | 某个语义 Change 在某规划作用域中的一次具体尝试 |
| `WorktreeInstanceId` | 单个物理 Git worktree 的本地身份；规划侧与执行侧各有一个 |
| `WorkspacePairId` | 某个 Store planning worktree 与 execution worktree 配对的本地身份 |

推荐的身份推导如下；实际实现使用已有 canonical serialization 与摘要工具，
不得直接拼接未经规范化的字符串：

```text
PlanningScopeId = H("planning-scope/v2", storeUid, projectId, targetLineId)

ChangeInstanceId = H(
  "change-instance/v2",
  PlanningScopeId,
  instanceSeed
)

PlanningWorktreeInstanceId = H(
  "worktree-instance/v2",
  canonicalStoreRepositoryIdentity,
  canonicalStoreWorktreeIdentity
)

ExecutionWorktreeInstanceId = H(
  "worktree-instance/v2",
  canonicalExecutionRepositoryIdentity,
  canonicalExecutionWorktreeIdentity
)

WorkspacePairId = H(
  "workspace-pair/v2",
  ChangeInstanceId,
  PlanningWorktreeInstanceId,
  ExecutionWorktreeInstanceId
)
```

`instanceSeed` 在创建 Change 时生成并写入 Change metadata。它使同一个 Change
在移动 Store worktree、重新 checkout 或 branch 改名后仍保持同一实例身份，
也允许同一目标线废弃一次尝试后重新创建同名 Change。物理目录身份只参与
两侧 `WorktreeInstanceId` 与 `WorkspacePairId`，不再决定 `ChangeInstanceId`。
`changeId` 是 scope 内的人类可读 alias，也不参与实例身份；显式改名不应重写
历史身份。

现有 `.openspec.yaml` 扩展为：

```yaml
schema: spec-driven
created: 2026-08-04
identity:
  version: 2
  instanceSeed: <random-128-bit-or-stronger>
  instanceId: ci_...
  storeUid: store_...
  projectId: elftia
  targetLineId: line-0.2
```

读取时重新推导并核对 `instanceId`；seed、scope 字段或派生结果不一致时禁止
mutation。旧 Change 在 layout migration 中获得 v2 seed/identity，并在 migration
receipt 中记录旧 association alias 到新实例身份的映射。

## 4. Store 的目标目录结构

每一个 Store worktree 都使用相同的相对布局：

```text
<StoreRoot>/
  .rasen-store/
    store.yaml
    projects/
      <projectId>.yaml
    target-lines/
      <targetLineId>.yaml

  rasen/
    config.yaml

    issues/                         # 真正跨项目的目标、计划和依赖
      <issueId>/

    design-docs/                    # 仅放 Store 级、跨项目设计
      <design-name>.md

    projects/
      <projectId>/
        config.yaml                 # 此项目的规划配置覆盖
        specs/                      # 此项目的 canonical specs
          <capability>/spec.md

        design-docs/                # 此项目自己的长期设计
          <design-name>.md

        changes/
          <changeId>/               # 活跃 Change
            .openspec.yaml
            proposal.md
            design.md
            tasks.md
            specs/
            evidence/
            handoff/

          archive/
            <targetLineId>/
              YYYY-MM-DD-<changeId>--<instanceShort>/
                archive.json
                ...
```

`.rasen-store/projects/` 只描述成员身份、代码仓库定位和绑定信息，不存放项目
规划正文。`.rasen-store/target-lines/` 只描述稳定目标线到当前 Git ref、各项目
目标代码 ref 的映射，也不存放规划正文。

新模型中的 Store 根不得再创建以下项目内容路径：

```text
<StoreRoot>/rasen/specs/
<StoreRoot>/rasen/changes/
```

`<StoreRoot>/rasen/design-docs/` 被保留，但语义收窄为 Store 级跨项目设计。
项目设计必须进入 `rasen/projects/<projectId>/design-docs/`。

### 4.1 Store 模式与独立项目模式

两种模式都可以存在，但一个项目在某一时刻只能有一个可写规划真相源：

| 模式 | 规划位置 | 代码位置 |
| --- | --- | --- |
| 未绑定的独立项目 | `<ProjectRoot>/rasen/...` | `<ProjectRoot>` 及其 worktrees |
| 已绑定 Store 的项目 | `<StoreRoot>/rasen/projects/<projectId>/...` | 项目代码仓库及其 worktrees |

Store membership 只表示“Store 知道这个项目”；Store binding 才表示“该项目的
规划真相已转入 Store”。`store add-project` 可以只登记成员；`store adopt` 或
显式 bind 完成迁移后，项目本地规划树变成只读迁移来源并最终移除。若解析器
同时发现两份可写规划树，所有写命令必须以 `split_planning_truth` 拒绝执行。

项目代码仓库中若仍保留 `rasen/config.yaml`，Store 模式下它只能提供
`projectId`、Store locator 和 execution-side 兼容配置；schema、artifact graph
等规划配置的权威值位于 Store 项目分区的 `config.yaml`。本机 worktree 绑定进入
被忽略的 `.rasen/`，不能把完整规划配置复制回代码仓库。

## 5. 版本线、branch 与 worktree

### 5.1 为什么 Store 也必须使用 worktree

项目代码的 0.1.7 和 0.2.0 可以同时开发，Store 中对应的 proposal、tasks、
delta specs 和 Archive 也会同时演进。如果两条线共用一个 Store checkout，
规划文件仍会互相覆盖，或者工作区会不断切 branch，正在运行的 Session 也会
失去稳定路径。

因此并发开发时，Store 与代码仓库两边都使用 worktree：

```text
Store repo
  integration ref: release/0.1
    └─ planning worktree: change/line-0.1/elftia/fix-a

  integration ref: release/0.2
    └─ planning worktree: change/line-0.2/elftia/redesign-b

elftia code repo
  target ref: release/0.1
    └─ execution worktree: fix-a

  target ref: release/0.2
    └─ execution worktree: redesign-b
```

“当前 worktree 的任务属于主项目”在这里表示：它的 `projectId` 是该主项目，
所以 proposal/tasks/delta specs 写入配对 Store worktree 中的
`rasen/projects/<projectId>/changes/<changeId>/`；实际代码仍写入当前项目的
execution worktree。它不表示要在代码 worktree 中再保存一份规划 Change。

branch 名是建议性的人类界面，不是协议。实现不能通过解析
`change/line-0.2/elftia/redesign-b` 得出项目或目标线。

### 5.2 稳定目标线记录

每个目标线有稳定记录，例如：

```yaml
id: line-0.2
storeRef: refs/heads/release/0.2
projects:
  elftia:
    codeRef: refs/heads/release/0.2
  rocut:
    codeRef: refs/heads/main
```

ref 更新、改名或转为 tag-based release 时，修改 locator，不改变
`targetLineId`。创建 Change 时把 `targetLineId` 固化进 Change metadata；后续
命令不得因为当前 checkout 碰巧切到了另一个 ref 而静默改变目标线。

### 5.3 一对 worktree 的绑定

启动 Store 模式的 Change 时，Rasen 生成并冻结：

```yaml
storeUid: store_...
projectId: elftia
targetLineId: line-0.2
changeId: redesign-b
changeInstanceId: ci_...
storeWorktree: E:/.../elftia-store-wt/redesign-b
storeHeadAtBind: <oid>
executionRepoUid: repo_...
executionWorktree: E:/.../elftia-wt/redesign-b
codeHeadAtBind: <oid>
```

这个绑定进入 Change metadata 和本机 association registry。Change metadata
提供可移植身份；registry 提供当前机器的路径 locator。Session 启动后再把它
冻结进 session context。任何一层发生不一致都报错，不回退到 Store 主 checkout。

本机实现可把 execution worktree 的精确绑定写入被忽略的
`<executionWorktree>/.rasen/planning-binding.json`，并由 machine association
registry 建索引；Store planning worktree 可使用被忽略的
`.rasen/planning-line.json` 保存当前 `targetLineId` locator。两者都不是可移植
规划事实，不能代替已提交的 Change/target-line metadata。索引、local marker 与
metadata 冲突时失败关闭。

MVP 规定一个 planning worktree 只承载一个活动 `ChangeInstance`。Store 级 Issue
可以关联多个 ChangeInstance，但每个项目 Change 仍有自己的规划/执行 worktree
配对。以后若允许一个 worktree 承载多个 Change，也必须通过显式 workspace
manifest 扩展，不能依赖目录扫描猜测。

## 6. 根解析的深模块

路径选择必须集中在一个深 Module 中。推荐使用 `StorePlanning.open()` 返回一个
已经绑定、不可伪造的 `PlanningScope` capability；业务调用者不再拿到一个裸
root DTO 后自行拼路径：

```ts
interface StorePlanning {
  open(input: OpenPlanningScope): Promise<PlanningScope>;

  planChangeWorkspace(
    input: PrepareChangeWorkspaceInput,
  ): Promise<ImmutableWorkspacePlan>;

  applyWorkspacePlan(token: WorkspacePlanToken): Promise<PreparedChangeWorkspace>;
}

interface PlanningScope {
  readonly token: PlanningScopeToken;
  readonly ref: {
    mode: "standalone" | "store";
    storeUid?: string;
    projectId: string;
    targetLineId?: string;
    planningScopeId: string;
  };

  locate(address: PlanningAddress): Promise<ScopedLocation>;
  createChange(input: CreateChangeInput): Promise<ScopedChange>;
  openChange(selector: ChangeSelector): Promise<ScopedChange>;
  revalidate(intent: "read" | "mutate" | "finalize"): Promise<void>;
  describe(): PlanningScopeDescription;
}
```

`PlanningAddress` 是有限的 typed address，而不是相对路径字符串：

```ts
type PlanningAddress =
  | { kind: "project-home" }
  | { kind: "specs" }
  | { kind: "project-design-docs" }
  | { kind: "active-change"; changeId: string }
  | { kind: "archive"; changeInstanceId: string }
  | { kind: "store-design-docs" }
  | { kind: "issue"; issueId: string }
  | { kind: "execution-plan"; issueId: string; revisionId: string };
```

`open` 隐藏 Store registry、项目 membership/binding、target-line record、Git
worktree、association registry、standalone 兼容和路径规范化。`locate` 是唯一把
语义地址翻译为绝对路径的 Seam，并负责 containment 与 layout-version 校验。
`describe()` 只为 `rasen context --json` 和诊断生成可序列化 projection；业务
mutation 不能取出其中的目录后绕开 capability。

`planChangeWorkspace` 负责计算 Store worktree 与 execution worktree 的创建、
复用和绑定计划；`applyWorkspacePlan` 只消费已验证的 plan token。Git 和 filesystem
属于 local-substitutable dependency，放在 Module 内部 Adapter 后面；CLI 和业务
流程不得直接调用 `git worktree` 再手工拼规划路径。

这个 Interface 的 Depth 来自它用很小的表面积隐藏了以下复杂性：Store/项目
双重选择、独立/绑定双模式、目标线映射、两个 Git 仓库、Windows 路径规范化、
worktree 身份、并发锁、迁移兼容和诊断。它也是唯一的 root-routing Seam。

### 6.1 Design It Twice 比较

设计阶段比较了三种刻意不同的 Interface：

| 方案 | 优点 | 问题 | 结论 |
| --- | --- | --- | --- |
| 扩充 `ResolvedOpenSpecRoot`，继续返回所有裸目录 | 改动最小，容易接入旧调用者 | 路径、worktree、outcome 规则仍散落在调用者，Module 很浅 | 拒绝 |
| 一个 `PlanningKernel` 同时直接负责 open/finalize/rehome | 公共入口最少，常见命令很短 | 身份、迁移和归档生命周期耦合，容易演变为 god Module | 不采用整体聚合 |
| opaque `PlanningScope` + typed address + 专用 mutation Module | root-routing 保持单一 Seam，又能扩展 Issue/Execution Plan；finalization 与 migration 可独立演进 | 比裸 DTO 多一层类型和 capability 生命周期 | 采用 |

最终方案保留第二种方案对常见路径的优势：从 execution worktree 调用时只需要
一次 `open()`，其余 Store/project/target-line/worktree 细节全部自动解析；同时
采用第三种方案的边界，把 `ChangeFinalizationModule` 和
`StoreLayoutMigrationModule`
作为独立深 Module。这样既不让调用者看见路径算法，也不把全部业务塞进同一个
对象。

### 6.2 失败诊断

至少提供以下稳定错误码：

| 错误码 | 含义 |
| --- | --- |
| `project_scope_required` | 在 Store 聚合上下文执行了项目写命令，但未选项目 |
| `target_line_required` | 无法从 Change、Session 或显式参数确定目标线 |
| `planning_worktree_required` | 写命令只解析到了 Store integration checkout |
| `planning_execution_binding_missing` | 执行 worktree 没有对应的规划 worktree |
| `planning_execution_binding_mismatch` | 显式参数、metadata 与 registry 不一致 |
| `split_planning_truth` | Store 与项目本地同时存在可写规划正文 |
| `legacy_flat_store_requires_migration` | Store 仍是旧扁平布局，该操作须等布局迁移完成（普通读写不受影响） |
| `target_line_mismatch` | 尝试把一个目标线的 Change 归档/合并到另一目标线 |

## 7. CLI 选择语义

`--store` 和 `--project` 不再互斥。它们选择不同维度：

- `--store`：选择哪个 Store 及其 checkout/worktree；
- `--project`：选择 Store 内哪个项目分区；
- `--target-line`：选择或校验稳定目标线；
- Change/Session binding：选择具体 planning/execution worktree 配对。

解析优先级从强到弱为：显式且相互一致的参数、冻结 Session context、
execution-worktree association、当前 Store worktree metadata、项目 binding。
较弱来源只能补空值，不能覆盖较强来源。冲突必须报错。

| 调用位置/参数 | 读命令 | 项目范围写命令 |
| --- | --- | --- |
| execution worktree，无参数 | 从 binding 推导 Store、项目、目标线 | 写入绑定的 Store planning worktree |
| Store planning worktree，无参数 | 当前项目/Change 上下文 | 写入当前绑定分区 |
| Store integration checkout，无参数 | 可做 Store 聚合读取 | 拒绝：缺项目或 planning worktree |
| `--store S --project P` | 读取 S 中 P | 还必须解析/创建目标线 planning worktree |
| `--store S` | Store 聚合读取，包括 Issues/项目列表 | 拒绝 `project_scope_required` |
| `--project P` | 先解析 P 的 binding；未绑定则独立模式 | 写入 P 唯一真相源 |

从 execution worktree 运行日常命令仍是首选用户体验。用户不需要手工 `cd` 到
Store worktree；CLI 经显式 association 将文件写入正确规划 worktree。`rasen
context --json` 必须显示 Store worktree、execution worktree、projectId、
targetLineId、ChangeInstanceId 和每个最终目录，方便审计。

Store 级 Issue/Execution Plan 的写命令是例外：它们使用 Store 级作用域，不要求
`projectId`，但其派生的每个 Change 必须指定项目和目标线。

## 8. Change 终态与 Archive

### 8.1 “归档”分成语义终态和物理封存

现有 Archive 把“把目录移进 archive”和“把 delta spec 合入 canonical spec”
视为同一个动作，因此无法安全表达开发中止。新引擎先决定终态，再生成物理
封存计划：

| outcome | 含义 | 同步 canonical specs | 需要代码合并证明 | 需要后继 Change |
| --- | --- | --- | --- | --- |
| `landed` | 实现已进入目标代码线 | 是 | 是；planning-only Change 除外 | 否 |
| `superseded` | 由另一 Change/目标线取代 | 否 | 否 | 是，`supersededBy` |
| `cancelled` | 在实施前主动取消 | 否 | 否 | 否 |
| `abandoned` | 已开始实施但决定丢弃 | 否 | 否 | 否 |

`superseded`、`cancelled`、`abandoned` 都必须记录非空 reason；`supersededBy`
可以指向同一 Store、同一项目的另一目标线，但不能跨项目偷换所有权。

Store 模式禁止隐式 outcome：

```text
rasen archive <change> --outcome landed
rasen archive <change> --outcome superseded --by <changeInstanceId> --reason <text>
rasen archive <change> --outcome cancelled --reason <text>
rasen archive <change> --outcome abandoned --reason <text>
```

`landed` 必须提供或解析出代码合并提交，并验证该提交可从该项目在
`targetLineId` 中声明的目标 code ref 到达。纯规划 Change 必须在创建时显式声明
`implementation: none`，不能在归档时临时绕过证明。

### 8.2 Archive v2 记录

`archive.json` 至少包含：

```json
{
  "schemaVersion": 2,
  "storeUid": "store_...",
  "projectId": "elftia",
  "targetLineId": "line-0.2",
  "changeId": "redesign-b",
  "changeInstanceId": "ci_...",
  "workspacePairId": "wp_...",
  "outcome": "landed",
  "reason": null,
  "supersededBy": null,
  "planning": {
    "worktreeInstanceId": "wt_...",
    "sourceRef": "refs/heads/change/line-0.2/elftia/redesign-b",
    "sourceHead": "<oid>",
    "targetRef": "refs/heads/release/0.2"
  },
  "codeMerge": {
    "repoUid": "repo_...",
    "worktreeInstanceId": "wt_...",
    "targetRef": "refs/heads/release/0.2",
    "commit": "<oid>",
    "reachable": true
  },
  "specSync": {
    "applied": true,
    "actions": []
  },
  "evidence": [],
  "missing": [],
  "archivedAt": "2026-08-04T00:00:00.000Z"
}
```

非 `landed` 记录的 `specSync.applied` 必须为 `false`，`actions` 必须为空；
校验器把任何不一致视为 archive 损坏。Archive 先按稳定 `targetLineId` 分区，
目录名称再加入实例短 ID，以消除同日同名、重试和跨 worktree 的碰撞。这里使用
的是稳定目标线身份，不是可变 branch 名。

Archive 是被动历史，list/show 可以读取，但任何 checkout、Git merge、索引重建
或 Issue 聚合都不得从 Archive 重放 delta specs。canonical specs 只在
`ChangeFinalizationModule.apply()` 处理 `landed` 的当次事务中修改。后续版本线
继承 specs 是普通 Git 合并结果，不是 Archive 的副作用。

### 8.3 最终化深模块

Archive engine 暴露 plan/apply Interface：

```ts
interface ChangeFinalizationModule {
  plan(input: FinalizeChangeInput): Promise<ImmutableFinalizationPlan>;
  apply(token: FinalizationPlanToken): Promise<FinalizationResult>;
}
```

`plan` 内部完成 scope 校验、Git reachability、outcome 规则、spec action、目标冲突、
evidence/accounting 和恢复 manifest 计算。`apply` 不重新解析 cwd 或 branch，
只加载 content-addressed plan，并消费其中冻结的路径、OID、身份和预条件。这条
Interface 由 direct archive、bulk archive、ship 和管理 API 共用。

## 9. 合并协议

### 9.1 正常 landed

1. 从目标代码线和对应 Store integration ref 创建一对 worktree。
2. Change 规划只写 Store planning worktree；实现只写 execution worktree。
3. 验证通过后，先把代码提交合入 Change 声明的目标代码线。
4. 在 Store planning worktree 执行 `archive --outcome landed`。
5. Archive engine 验证代码提交可达，应用 delta specs，封存 Change。
6. 把规划 branch 合入同一个 `targetLineId` 的 Store integration ref。
7. 合并成功且无活跃 Session 后，按可恢复清理流程移除两边 worktree。

顺序上先有代码落地证明，再更新 canonical specs。这样 Store integration ref
不会声称一个尚未进入目标代码线的行为已经成立。

### 9.2 0.1.7 开发一半，改做 0.2.0

若 0.1.7 的目标线整体废弃：

1. 在 `line-0.1` 的规划 branch 上把 Change 标为 `abandoned` 或
   `superseded`；若是后者，指向 0.2.0 的新 ChangeInstance。
2. 不执行 spec sync，不把 0.1.7 规划 branch 合入 `line-0.2`。
3. 在 `line-0.2` 从它自己的 Store integration ref 创建新的 ChangeInstance 和
   新的一对 worktree。
4. 若需要复用设计或代码，使用显式 port/cherry-pick/import，并记录来源；不能
   把旧 branch 改名后冒充新目标线。

0.1.7 的 Archive 对 0.2.0 没有影响，因为二者属于不同 `targetLineId`，且非
`landed` outcome 没有 spec action。是否把 0.1.7 的终态 Archive 合入
`line-0.1` 取决于该发布线是否还保留审计历史；也可以只保留 branch/tag 后关闭
worktree。它不得为了“集中归档”而合入 `line-0.2`。

若只是 0.1.7 中的一个方案被替代、发布线仍继续，则把终态 Archive 合回
`line-0.1` 是允许的。它只增加审计记录，不改变 specs。新方案创建新的
`ChangeInstanceId`。

Rasen 无法阻止用户用原生 Git 手工合错 branch，因此 `rasen doctor` 与 CI 必须
校验新增/修改的 Change、Archive、canonical specs 与当前 target-line record
是否一致。跨发布线继承应是显式 release-line merge；把废弃线 feature branch
直接合进新线必须被门禁报告。即使一个非 landed Archive 被手工合入，它也只是
被动历史、不会触发 spec 重放；但 Git 实际带入的其他文件仍按普通 merge 审查。

### 9.3 跨项目工作

一个 Store Issue 可以同时指向：

```text
Issue I
  ├─ Change A: project=elftia, targetLine=line-0.2
  ├─ Change B: project=rocut, targetLine=main
  └─ Change C: project=elftia-website, targetLine=main
```

每个 Change 独立验证、归档和合并；Issue 根据依赖图决定何时完成。某个项目
Change 失败不能通过共享扁平 Change 目录污染其他项目的 canonical specs。

## 10. 并发、锁与恢复

锁键必须包含语义作用域和实例，不能只使用 change 名：

```text
scope lock       = (storeUid, projectId, targetLineId)
change lock      = (changeInstanceId)
workspace lock   = (workspacePairId)
integration lock = (storeUid, targetLineId)
```

- 同一 ChangeInstance 的 finalize 互斥；
- 不同项目或不同目标线可以并行；
- 合入同一 Store integration ref 时串行；
- plan 记录目标文件摘要和 Git OID，apply 前再次校验，变化则作废并重新 plan；
- Windows 下 worktree/registry 锁竞争沿用有界重试，但语义冲突不重试；
- crash recovery 使用 immutable plan 与 publish manifest，不扫描目录猜测“完成到哪”。

## 11. 迁移旧扁平 Store

### 11.1 迁移目标

```text
旧：<Store>/rasen/changes/<change>
新：<Store>/rasen/projects/<projectId>/changes/<change>

旧：<Store>/rasen/changes/archive/<archive>
新：<Store>/rasen/projects/<projectId>/changes/archive/<targetLineId>/<archive>

旧：<Store>/rasen/specs/<capability>
新：<Store>/rasen/projects/<projectId>/specs/<capability>

旧：<Store>/rasen/design-docs/<design>
新：项目设计进入项目分区；真正跨项目的设计保留 Store 级目录
```

### 11.2 归属判定

迁移只能依据可审计证据，按以下优先级确定 `projectId`：

1. Change/archive 中已经记录的稳定 projectId；
2. Store adoption manifest 或迁移 journal 的来源项目记录；
3. ChangeInstance/Session association 中与 Store membership 一致的记录；
4. 用户提供并提交审计的显式 mapping file。

不能依据 change 名前缀、Git branch 名、目录相邻关系或“唯一看起来相似的项目”
猜测。证据冲突或未知时，plan 把条目标为 `unresolved` 并阻止 apply。

对当前 `elftia-store`，只能自动迁移其 adoption/membership 证据明确声明归属于
`elftia` 的条目；不能因为 `rocut` 和 `elftia-website` 也是成员，就把剩余扁平
Change、Archive 或 spec 猜给它们。剩余条目必须进入显式 mapping review。

spec 的归属不能仅从当前 Change 推导，因为多个已归档 Change 可能共同修改同一
capability。迁移器必须构建 provenance 图；若一个旧 canonical spec 确实由多个
项目共享，则要求用户选择一个权威 owner 并让其他项目引用，或显式拆成各项目
spec。当前模型不定义 Store 级 canonical spec；如果两种选择都不成立，迁移保持
blocked，先另行设计共享 contract。新模型绝不保留匿名共享 spec。

### 11.3 迁移协议

1. 检测 Store schema/layout version，冻结旧 Store ref 与工作树摘要。
2. 扫描所有 active Change、Archive、spec、design-doc、membership、adoption 和
   association 证据，生成只读 inventory。
3. 输出 mapping plan：每个来源、目标、projectId、证据、冲突和 no-clobber
   前置条件。
4. 所有条目已解析后才允许 apply；apply 写入临时 staging 并验证完整性。
5. 原子发布项目分区与 layout version，保留 recovery manifest。
6. 严格 UTF-8、schema、引用、ChangeInstance 和 spec provenance 验证通过后，
   才把旧路径标记为 retired。
7. 在单独提交中移除旧扁平树；任何失败都恢复到发布前可读状态。

迁移按 Store Git target line/branch 分别执行。不能只迁移当前 checkout 后就宣称
整个 Store 已完成；工具应列出包含旧布局的 refs。历史 branch 可以保持旧 schema
只读，但一旦在该 branch 上继续开发，必须先迁移该 branch。

### 11.4 兼容边界

- 旧扁平 Store：允许 list/show/export 和 migrate plan；禁止 new/apply/archive。
- 新分区 Store：只写新路径，不回读同 checkout 中的旧路径作为合并来源。
- 独立项目：保持现有路径，直到显式 bind/adopt。
- 已绑定项目中的残留本地 planning tree：只允许 doctor/migrate 读取。
- 不提供长期 dual-read/dual-write；兼容层在一个明确版本窗口后删除。

## 12. 管理 API 与 UI

Store 聚合视图与项目写入视图必须分开建模：

```text
GET  /stores/:storeUid/issues
GET  /stores/:storeUid/projects
GET  /stores/:storeUid/projects/:projectId/lines/:targetLineId/changes

POST /stores/:storeUid/projects/:projectId/lines/:targetLineId/changes
POST /stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize
```

聚合 board 可以跨项目和目标线读取，但每个卡片都必须显示项目、目标线、outcome
和 ChangeInstance。所有项目 Change mutation 都要求完整 scope；后端不能从前端
当前筛选器推断缺失字段。

Issue/Execution Plan 是 Store 级资源，其节点引用 ChangeInstance，而不是引用
易变的目录路径。API 返回路径时只作为本机 locator，持久引用使用 UID。

## 13. 模块边界与依赖

| Module | 责任 | 公共 Interface | 不应泄露的 Implementation |
| --- | --- | --- | --- |
| StorePlanning | 打开 scope，规划/创建 worktree 配对 | `open`、`planChangeWorkspace`、`applyWorkspacePlan` | registry、路径规范化、Git 命令、layout version |
| ChangeIdentityModule | 创建/校验稳定身份 | `createInstance`、`verifyInstance` | canonical serialization、摘要算法、物理身份适配 |
| ChangeFinalizationModule | outcome、spec sync、archive plan/apply | `plan`、`apply` | reachability、文件事务、恢复 manifest |
| StoreLayoutMigrationModule | 扁平 Store inventory、归属、迁移 | `inventory`、`plan`、`apply` | provenance 图、staging、no-clobber 发布 |
| StoreQueryModule | Store/项目/目标线聚合读取 | typed query methods | 目录遍历、兼容读取、索引缓存 |

Git、filesystem、clock、lock 和 machine registry 都是 local-substitutable
dependencies，通过 Adapter 注入。业务 Module 可依赖稳定的数据契约，不依赖
具体命令行输出或操作系统路径格式。UI/CLI/API 是 Module 的消费者，不是另一套
root resolver。

### 13.1 现有实现的改造落点

这次开发不能只修改 `adopt`。以下调用链共同依赖旧的扁平 root 契约，必须收敛
到同一个 `PlanningScope` Seam：

| 现有位置 | 当前问题 | 目标改造 |
| --- | --- | --- |
| [`root-selection.ts`](../../src/core/root-selection.ts) | `makeRoot` 固定返回 `rasen/{changes,specs}`，Store/project selector 互斥 | 降为 CLI compatibility Adapter，调用 `StorePlanning.open` |
| [`planning-home.ts`](../../src/core/planning-home.ts) | 只有单 repo、单 changes 目录 | 改成由 `PlanningScope` 派生的只读 view，不再成为路径权威 |
| [`new-change.ts`](../../src/commands/workflow/new-change.ts) | 把 root path 同时当 project/planning root | 使用 `PlanningScope.createChange`，不得直接传裸 `changesDir` |
| [`migration-ops.ts`](../../src/core/store/migration-ops.ts) | `adopt` 明确移动到 Store 扁平布局 | 新 adoption 直达项目分区；旧布局只走 Migration Module |
| [`project-records.ts`](../../src/core/store/project-records.ts) | adoption 以名称列表补充归属 | membership 只存身份/locator；迁移 provenance 进入独立 receipt |
| [`identity.ts`](../../src/core/change-run/internal/identity.ts) | ChangeInstance 依赖物理 change 目录 | 改用持久 `instanceSeed` 与 scope 身份；物理身份只属于 worktree/pair |
| [`session-runtime-context.ts`](../../src/core/session-runtime-context.ts) | 未冻结 target line 与规划 worktree 身份 | Session context v2 冻结完整 worktree pair |
| [`archive-engine.ts`](../../src/core/archive-engine.ts) 与 [`archive-accounting.ts`](../../src/core/archive-accounting.ts) | 外部 Interface 接受裸 root/spec action，accounting 没有 outcome/scope | 保留事务 Implementation，外部升级为 outcome-aware Finalization Module 与 Archive v2 |
| [`archive.ts`](../../src/core/archive.ts) | 文件归档成功后 best-effort 更新 association | association 终态成为同一可恢复事务的完成条件 |
| [`file-placement.ts`](../../src/core/file-placement.ts) | Store 模式仍可能从 cwd 猜 execution root | 只消费冻结的 scope/worktree pair |
| [`management-api/changes.ts`](../../src/core/management-api/changes.ts) 与 [`management-api/archive.ts`](../../src/core/management-api/archive.ts) | 从裸 root 枚举扁平 changes/archive | 接收 typed scope/query，聚合结果显式按项目和目标线分组 |

旧 resolver 可以在迁移窗口内保留读取 projection，但所有 Store v2 mutation
调用点切换完成前必须拒绝写入；不能在旧 resolver 外包一层路径修正后让两套
Implementation 同时存在。

## 14. 开发切片

按以下顺序实现，避免新旧模型交叉写入：

### Slice 1：schema、身份与纯路径契约

- Store layout version v2；
- project/target-line/change metadata schema；
- `PlanningScopeId`、portable `ChangeInstanceId`；
- 纯函数式 `ProjectPlanningHome` 计算与路径越界校验；
- Archive v2/outcome schema。

完成标准：无需真实 Git 即可用跨平台 fixture 验证所有身份和路径。

### Slice 2：统一 root-routing

- 实现 `StorePlanning.open` 与 typed address locator；
- 允许 `--store` 与 `--project` 组合；
- 改造 context、new/change/show/list 和所有 planning-home 调用者；
- Store 聚合读取与项目 mutation guard；
- 删除业务层手工拼接 `rasen/changes` 的能力。

完成标准：所有写命令的测试都通过同一个 `PlanningScope` capability 定位，
不存在第二条 Store 路径算法。

### Slice 3：新 Store 写入与安全迁移

- new/add/adopt/bind 写入项目分区；
- 旧扁平 Store detector 与只读 guard；
- inventory/mapping/plan/apply/recovery；
- spec provenance 与显式 mapping file；
- doctor 输出 split truth、未知归属与碰撞。

完成标准：迁移失败或中断后旧 Store 仍可完整读取，且不存在部分发布的新树。

### Slice 4：规划/执行 worktree 配对

- target-line registry；
- immutable workspace plan/apply；
- Store worktree 与 execution worktree association；
- Session context 冻结与 `rasen context --json`；
- 并发锁、branch/ref mismatch 和安全清理。

完成标准：0.1 与 0.2 两组 Change 可并发运行，互不看到对方未合并规划写入。

### Slice 5：终态 Archive 与合并门禁

- 四种 outcome；
- landed reachability proof；
- landed-only spec sync；
- Archive v2、唯一目标目录、恢复发布；
- direct/bulk/ship/API 全部共用 finalization Module；
- 目标线 mismatch 门禁。

完成标准：abandoned/superseded fixture 的 canonical specs 字节级不变，landed
fixture 只有在代码提交可达后才能同步。

### Slice 6：Store 级 Issue/Execution Plan 与管理面

- Store 聚合 query；
- Issue 到多个项目 ChangeInstance 的引用；
- 项目/目标线过滤、终态展示；
- API scope 验证和 UI 防误操作。

这一步建立在正确的分区和身份之上，不反向改变底层路径模型。

## 15. 必须覆盖的验收矩阵

### 路径与归属

- 三个项目拥有同名 Change，目录和身份均不碰撞；
- 同一项目在两个 target line 拥有同名 Change，Git 时间线隔离、实例身份不同；
- projectId 含路径分隔符、`.`、`..`、大小写碰撞或 Windows 保留名时拒绝；
- Store 级 design-doc 与项目 design-doc 的 resolver 不混淆；
- 已绑定项目出现本地规划写入时拒绝。

### worktree 与 Git

- 从 execution worktree 无参数调用可解析正确 Store planning worktree；
- Store integration checkout 上的项目写命令拒绝；
- branch 改名后依靠 metadata/registry 仍解析同一 ChangeInstance；
- Store HEAD、代码 HEAD 或目标 ref 在 plan/apply 间变化时 plan 失效；
- 0.1 规划 branch 不能 finalize 到 0.2 target line；
- worktree 锁、脏工作树和未推送提交有明确诊断且不自动丢弃。

### Archive outcome

- `landed` 且代码提交不可达时拒绝；
- `implementation: none` 的 landed 不伪造 code commit；
- `superseded` 缺 `supersededBy` 时拒绝；
- `cancelled`、`abandoned`、`superseded` 不产生 spec action；
- 同日同名重试不会覆盖 Archive；
- direct、bulk、ship 和 API 生成完全相同的 plan schema。

### 迁移

- adoption journal 能唯一恢复 projectId；
- 两个项目的同名 Change no-clobber；
- 未知归属、证据冲突和共享 spec 阻止 apply；
- Windows 路径大小写/盘符、UTF-8 中文名和长路径 fixture；
- 任意文件复制/rename/manifest 发布故障可恢复；
- 多个含旧布局的 target refs 会被完整报告。

## 16. 明确不做的事

- 不在 Store 根恢复一个“方便”的共享 `rasen/changes`；
- 不按 branch 名或版本字符串创建永久内容目录；
- 不把 Store 规划正文复制回每个项目仓库；
- 不让一个普通 Change 同时归属多个项目；
- 不让 abandoned/superseded Change 通过 archive 修改 canonical specs；
- 不自动 merge、rebase、force-delete branch 或 worktree；
- 不把 Store Git 历史当作 machine registry，二者分别承担可移植事实和本机 locator；
- 不用长期兼容层掩盖尚未迁移的扁平 Store。

## 17. 最终判断标准

实现完成后，下面这句话必须始终成立：

> 给定 `storeUid + projectId + targetLineId + changeInstanceId`，Rasen 能唯一确定
> 规划归属；给定当前机器上的 association，又能唯一确定规划 worktree 与执行
> worktree。没有任何调用者需要猜路径、解析 branch 名或访问另一份规划真相。

这才是“所有内容集中在一个仓库，但内部按项目分目录”，同时又能安全支持
0.1.7、0.2.0 等多条开发线并行的完整含义。
