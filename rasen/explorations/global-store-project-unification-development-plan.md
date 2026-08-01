# Rasen Global / Store / Project 统一模型与多机协作开发总计划

> 状态：后续开发的主设计与执行基线
>
> 日期：2026-07-25
>
> 基线分支：`dev/0.1.5`
>
> 基线提交：`d73c1da2 feat(release): publish CLI and UI in lockstep`
>
> 适用范围：`0.1.5` 的 Store / Context 基础工作流，包括 Store 不可变身份、
> 多机 bootstrap、项目成员关系、配置继承、learned-skill
> global/store/project 层级、Store Session planning/execution 上下文、
> adopt/eject 可移植性，以及显式 project knowledge 携带
>
> 后续版本边界：Issue、Execution Plan、Issue acceptance 和 Issue Board
> 属于 `0.2.0`，不进入本轮 `0.1.5`

## 0. 文档地位与使用方式

这是接下来 **Store / Context 基础工作流**相关开发的唯一主入口文档。新
Session 不应只阅读某一个 PR、某一个旧 change 或某一段聊天记录后直接编码。

它不是 Rasen 整体产品方向的最高权威。文档权威顺序为：

```text
rasen/work/issue-centered-automation-platform/north-star.md
  > goal.md
    > roadmap.md
      > 本 Store / Context 基础工作流计划
```

其中：

- [`north-star.md`](../work/issue-centered-automation-platform/north-star.md)
  决定长期产品方向和不可违反的开发戒律；
- [`goal.md`](../work/issue-centered-automation-platform/goal.md)
  决定 Issue / Execution Plan / Change 的目标领域模型；
- [`roadmap.md`](../work/issue-centered-automation-platform/roadmap.md)
  决定 `0.2.0` 起 Issue-centered 能力的纵向演进顺序；
- 本文件决定 `0.1.5` Store / Context 工作流的身份、关系、运行时、迁移和
  landing 路线。

如果本文件将 Store membership、Project pointer 或 Session cwd 描述成
Change 的永久 target authority，应视为本文错误并以上述目标文档为准。

本文件是自包含的，负责记录：

- 当前代码和 PR 的真实落地状态；
- 已经确认正确、应继续保留的设计；
- 已发现的跨 PR 断层；
- Global、Store、Project、Checkout、Session 的统一概念模型；
- Git 共享状态、`~/.rasen` 本机状态和临时执行状态的边界；
- 目标 schema、resolver、命令和运行时契约；
- 兼容、迁移、并发、安全与失败语义；
- 推荐的 Change / PR 执行顺序；
- 每一阶段的代码范围、验收条件和测试矩阵；
- 新 Session 的第一步，以及明确禁止的捷径。

背景设计
[`store-multi-machine-collaboration-design.md`](./store-multi-machine-collaboration-design.md)
仍可用于了解早期多机方案，但如果两份文档在执行顺序、membership 语义、
learned-skill 身份或 Session runtime context 上存在差异，**以本文件为准**。

本文件不是某个已经创建的 Rasen change 的 artifacts。用户会根据实现规模和
依赖关系决定何时、如何拆分 changes。开始任何 change 前，先按本文的阶段边界
选择一个可独立实现、验证和集成的范围，不要把整份计划塞进一个超大 change。

本轮采用“连续开发、集中人工验收”：

```text
每个 Phase 实现
  → 自动化验证
  → 集成
  → 不等待人工，继续下一个 Phase
  → 形成完整 0.1.5 release candidate
  → 用户集中执行真实场景验收
  → 修复验收问题
  → 发布
```

阶段完成表示工程实现和自动化验证已完成，不表示真实用户场景已经验收。
开发过程中不得因等待逐阶段人工操作而中断整个 Store 工作流；但在最终真实场景
验收通过前，也不得把 `0.1.5` 标记为 releasable。

## 1. 新 Session 快速入口

新 Session 开始后必须先执行以下只读检查：

```powershell
git status --short
git branch --show-current
git log -1 --oneline

gh pr view 62 --json number,state,baseRefName,headRefName,mergeCommit,url
gh pr view 65 --json number,state,baseRefName,headRefName,mergeCommit,url
gh pr view 66 --json number,state,baseRefName,headRefName,mergeCommit,url
gh pr view 68 --json number,state,baseRefName,headRefName,mergeCommit,url

git merge-base --is-ancestor da02dd60149510aaa086270f060046764f8e7f37 HEAD
git merge-base --is-ancestor 5fa3230068acbb9ece31e4f843d97279b6322730 HEAD
git merge-base --is-ancestor 481423954b775989373ddb979813da616213951e HEAD
git merge-base --is-ancestor c8dde6aa17f166908e3b1896f61288beb199d171 HEAD
```

在本文记录的基线上，预期结果是：

```text
#62: true
#65: false
#66: false
#68: true
```

如果结果发生变化，不要机械沿用本文的 Git 操作步骤；先更新“事实基线”和后续
阶段的已完成状态。但不要仅因为 GitHub 显示 `MERGED`，就假设提交已经进入
`dev/0.1.5`。

新 Session 的默认第一个开发目标是：

```text
Phase A — store-immutable-identity
```

除非当前 `dev/0.1.5` 已经包含该阶段，否则不要先把 PR #66 原样合入 dev。

建议创建分支：

```powershell
git switch dev/0.1.5
git pull --ff-only
git switch -c feat/store-immutable-identity
```

开始编辑前还必须确认工作区中的已有未提交内容。当前已知用户/前序工作包括：

```text
docs/handoff/                                      # 无关的既有未跟踪目录
rasen/explorations/store-multi-machine-collaboration-design.md
rasen/explorations/global-store-project-unification-development-plan.md
```

不得清理、覆盖或顺手提交无关文件。

## 2. 执行摘要

当前方向并不需要推翻：

- PR #62 正确地区分 planning root 与 knowledge owner；
- PR #65 建立了 Store-scoped learned knowledge 和严格 promotion authority；
- PR #66 的 `project > store > global` 有效集、精确去重、冲突阻断和 ledger
  所有权算法值得保留；
- PR #68 正确地区分 Store planning space 与 Project execution checkout，并支持
  同一 `projectId` 的多个 clone/worktree。

真正的问题是：这些能力没有共享同一套身份、关系和运行时上下文契约，而且
PR #65/#66 实际没有落到当前开发线。

统一后的核心原则是：

1. Store 使用不可变 UUID `storeUid`；现有 `id` 只做可读别名。
2. Project 使用已有 UUID `projectId`；不能再用 Store project namespace alias
   充当项目身份。
3. Checkout 是机器本地绑定：`projectId + canonical root`，绝不进入 Git。
4. 项目的默认 planning/config Store 与 Store 的多对多项目 membership 是两种
   不同关系，必须分别命名和建模。
5. Session 必须同时携带 planning identity、execution project identity 和本机
   checkout binding；不能只依赖 cwd 或 pointer 猜测。
6. 配置 precedence 与 learned knowledge precedence 使用相同身份，但不是同一个
   关系算法。
7. Git 只保存身份、remote locator、membership、planning artifacts 和显式导出的
   portable 数据。
8. `~/.rasen` 不整体同步；只从 Git 声明重建 registry/binding，或通过白名单
   bundle 显式迁移 project knowledge；checkpoint 是 `0.2.0` 或更晚的运行交接
   机制。
9. 普通命令只解析、校验、报错和给出修复命令；只有显式 mutation 命令允许
   clone、register、hydrate、upgrade 或 import。
10. 所有迁移先 plan/dry-run，再 apply；失败必须 fail closed，不能把“声明存在但
    当前不可用”当成“没有 Store”。

版本目标明确分开：

```text
0.1.5
  = 稳定现有 Change / Store 基础
  = Store identity + membership + runtime context
  + learned integration + bootstrap + 必要的 knowledge portability

0.2.0
  = 引入 Issue 契约和 Execution Plan
  = Issue → target-aware Change → Run → Evidence → Acceptance
```

`0.1.5` 的任务是确保未来 `0.2.0` 可以在一套稳定的 Store、Project 和 Session
契约上建立 durable target binding，而不是提前实现 Issue schema、Execution
Plan、Issue Board 或后台 Issue scheduler。

## 3. PR 与提交事实基线

### 3.1 PR #62：已进入 dev

```text
PR:       #62 feat(learned-skills): resolve store-aware knowledge context
commit:   da02dd60149510aaa086270f060046764f8e7f37
merge:    44db4bcfbed30318cc9a16ae3b84afea04a76af2
base:     dev/0.1.5
状态:     已进入当前 dev
```

它提供：

- `KnowledgePlanningRootRef`
- `KnowledgeOwnerRef`
- planning root 与 owner 分离
- typed `--project` / `--store`
- frozen `knowledgeContext`
- 路径不进入 run-state

当前开发线仍保留这些基础类型，但 `LearnedSkillScope` 仍只有
`project | global`，说明 Store scope 的后续提交没有落地。

### 3.2 PR #65：显示 merged，但未进入 dev

```text
PR:       #65 feat(learned-skills): add store-scoped knowledge
commit:   5fa3230068acbb9ece31e4f843d97279b6322730
merge:    868b672ccd4adef70fc5f1f47a0f9b2323823b18
base:     feat/store-aware-learned-skills-context
状态:     只合入堆叠功能分支
```

它提供：

- `store` learned scope；
- Store canonical catalog；
- Store publication approval；
- typed evidence 和 promotion sources；
- Store membership authority；
- manifest/candidate v2。

### 3.3 PR #66：显示 merged，但未进入 dev

```text
PR:       #66 feat(learned-skills): materialize effective scoped knowledge
commit:   481423954b775989373ddb979813da616213951e
merge:    ccd3249d9502a2b777c39ebaef73bcdff4bd5511
base:     feat/store-aware-learned-skills-scope
状态:     只合入堆叠功能分支
```

它提供：

- `project > store > global`；
- 多 Store reverse discovery；
- applicability 之后再做 precedence；
- 多 Store 同 ID 的精确等价去重；
- divergent Store 内容的 order-independent conflict；
- project learned ledger；
- global learned ledger v2；
- unavailable Store 的 degraded/deferred cleanup；
- init/update 共用 planner。

### 3.4 PR #68：已进入 dev

```text
PR:       #68 feat(sessions): separate Store planning and execution context
commits:  c8dde6aa17f166908e3b1896f61288beb199d171
          2da915d2504588addabab52ca77a21666e1eb09f
merge:    86ee5223e1dcde0b27973ac16a651242cb38cfaf
base:     dev/0.1.5
状态:     已进入当前 dev
```

它提供：

- Session `space` 作为 planning attribution；
- `execution: planning | project:<selector>`；
- Store Session 强制显式选择 execution project 或 planning-only；
- 精确 root selector；
- 同一 `projectId` 多个独立 clone；
- linked worktree execution；
- Store root attachment。

### 3.5 实际提交图

```text
dev/0.1.5 ── #62 ─────────────────── #68 ── current HEAD
                 \
                  #65 ── #66
```

因此：

- 不存在“#66 已经在 dev，只需要继续修”的事实；
- 也不能只 cherry-pick #66，因为它依赖 #65；
- 最终迁入时顺序必须是 `#65 commit → #66 commit`；
- 更重要的是，迁入前应先建立 UID、membership 和 runtime context 契约，
  避免先写旧格式再立即迁移。

### 3.6 本轮联合审查证据

已经完成的只读验证：

```text
PR #65 commit 是 PR #66 head 的 ancestor：true
PR #65/#66 是当前 dev ancestor：false
PR #62/#68 是当前 dev ancestor：true
PR #66 与当前 dev 的 merge-tree：无文本冲突
```

无文本冲突不代表可直接合并。已确认的主要冲突是语义层：

- Store alias 与 future Store UID；
- references membership 与 projectId record；
- Session exact checkout 与 frozen projectId-only context；
- clone-specific project knowledge home 与 logical project owner；
- Store planning root 与 Project code edit root。

当前 dev 上已运行：

```text
test/core/effective-config.test.ts
test/core/learned-skills/context.test.ts
test/core/management-api/session-launch-context.test.ts
test/core/management-api/sessions-api.test.ts

结果：4 files、94 tests passed
```

这些测试只能证明当前 #62/#68 基线内部通过，不能证明 #65/#66 与 #68 已联合工作。

CI 证据缺口：

- PR #66 仅挂接 docs-site check；
- PR #68 没有挂接 status check；
- 没有一个 CI commit 同时包含 #65/#66/#68。

因此 Phase D 必须新增同一 commit graph 上的联合验证，不能引用旧 PR 各自的测试
描述代替。

## 4. 当前代码模型

### 4.1 Store identity v1

当前 Store metadata：

```yaml
# <store>/.rasen-store/store.yaml
version: 1
id: elftia-store
remote: git@github.com:org/elftia-store.git
```

当前 `id`：

- 是字符串；
- 使用 kebab grammar；
- 纯数字字符串如 `"123"` 合法；
- 不是自动生成的递增编号；
- setup/register 的来源是 metadata、显式参数或目录 basename；
- 同一机器、同一 namespace 下要求唯一；
- 不同机器无法知道另一个独立 Store 是否使用了同名 ID。

结论：

- 当前不存在“自增 ID 分配冲突”；
- 存在的是“别名被误当作全局身份”的冲突；
- 解决方式是 UUID `storeUid`，不是引入中央自增计数器。

### 4.2 Project identity

项目已经拥有正确的共享身份：

```yaml
# <project>/rasen/config.yaml
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
```

`projectId`：

- 随项目 Git 仓库传播；
- 同一项目的不同 clone/worktree 相同；
- 不同项目离线生成碰撞概率可忽略；
- 应继续作为 Project 的唯一逻辑身份。

问题在于当前 Store project namespace 还存在另一个 alias ID：

```text
project:<alias>
```

它不能再充当 authority，只能作为兼容 locator。

### 4.3 Store pointer

当前：

```yaml
store: elftia-store
```

它同时承担：

- planning root 选择；
- Store config inheritance；
- Store Session member 验证；
- 本机 Store registry 查找；
- bootstrap 提示的隐含来源。

但它只有 alias，没有：

- 不可变 Store identity；
- Store remote；
- alias collision 防护；
- fresh-machine bootstrap 的完整 locator。

### 4.4 Store registry

当前 machine Store registry：

```yaml
version: 1
stores:
  elftia-store:
    backend:
      type: git
      local_path: E:\repos\elftia-store
      remote: git@github.com:org/elftia-store.git
```

它是本机 locator，不应进入 Git。

当前 registry 还混入 `project:<alias>` namespace，用于 Store references。
目标设计会保留兼容读取，但不再把它作为 project identity 或 membership authority。

### 4.5 Project checkout registry

当前 project registry 保存：

```text
checkout root
  → projectId
  → mode
  → name
  → machine home
  → lastSeen
```

同一 `projectId` 可以拥有：

- 多个 linked worktree，共用一个 machine home；
- 多个独立 clone，拥有不同 machine home。

这是 execution/work ephemera 的合理隔离，但与当前 project learned catalog
“身份只记录 projectId、存储却跟 clone-specific home 走”的做法冲突。

### 4.6 Adoption v1

当前：

```yaml
# <store>/.rasen-store/adoptions.yaml
version: 1
adoptions:
  ed2cf5bf-2525-45ed-b665-c47a5b8d5450:
    specs: [...]
    changes: [...]
    sourcePath: E:\old\path\elftia
    timestamp: 2026-07-25T10:00:00Z
```

`sourcePath` 是绝对本机路径，但文件位于 Store Git 仓库。

这不是 `sourcePathHint` 改名就能解决的问题。任何绝对路径，即使叫 hint，
只要进入共享 YAML，就仍然：

- 泄露本机布局；
- 在其他机器无效；
- 可能把 eject 路由到错误位置；
- 让 Git diff 产生无意义机器差异。

目标方案必须从 Git 共享 schema 中彻底移除它。

### 4.7 Learned knowledge v1/current dev

当前 dev 中：

```text
global canonical knowledge:
  <global data dir>/learned-skills/<id>

project canonical knowledge:
  <clone-specific project machine home>/learned-skills/<id>

store canonical knowledge:
  尚未从 #65 落入 dev
```

当前 frozen knowledge context 只保存：

```json
{
  "version": 1,
  "planningRoot": { "type": "store", "id": "team" },
  "owner": { "type": "project", "id": "<projectId>" }
}
```

它正确地不保存绝对路径，但没有本机 checkout binding。

### 4.8 Session v1/current dev

PR #68 的 resolver 能得到：

```ts
{
  planningSpace,
  cwd,
  attachedRoots,
  executionProject: { projectId, root }
}
```

但 Session launch 只继续传递：

```ts
{
  cwd,
  attachedRoots,
  space: planningSpace
}
```

`executionProject` 没有进入：

- Session record；
- 子进程环境；
- 子进程 context 文件；
- learned resolver；
- actionContext。

因此当前精确 checkout 选择只通过 cwd 偶然保留，不能支持 frozen resume、
跨模块重解析或未来非 pointer Store membership。

## 5. 已确认应保留的设计

### 5.1 Planning root 与 execution owner 分离

以下场景必须一等支持：

```text
planning root: Store S
execution owner: Project P
execution checkout: P 在本机的 checkout C
```

Store 不是 Project；planning location 也不是 knowledge ownership。

### 5.2 Typed namespace

以下实体即使显示名相同，也不能混淆：

```text
store:platform
project:platform
```

未来 Store 进一步使用 UID，Project 使用 projectId。

### 5.3 PR #66 的 effective algorithm

保留：

```text
applicability filtering
        ↓
project winner
        ↓
exactly equivalent Store dedup OR Store conflict
        ↓
global fallback
```

禁止：

- 按 registry 顺序选第一个 Store；
- 按 planning Store 优先；
- 按 alias 字典序选赢家；
- 仅凭 knowledgeKey 判定语义相同；
- Store unavailable 时把它当空目录并删除既有 materialization。

### 5.4 精确 ownership ledger

只有同时满足以下条件才能更新或删除生成文件：

- ledger 声明拥有该精确路径；
- on-disk 文件仍是普通文件；
- 文件 hash 与 ledger 相同；
- source identity 仍可验证；
- 没有 symlink/reparse 或人工修改。

### 5.5 Store Session 显式 execution choice

Store planning space 不得猜测 Project：

- 一个成员也不能静默选择，除非 UI 的明确自动选择规则对用户可见；
- 多成员必须由用户选择；
- 可以选择 planning-only；
- server 必须重验 project identity、checkout live 状态和 membership。

### 5.6 普通命令只读

`status`、`list`、`show`、`doctor`、普通 context resolution 不得隐式：

- clone；
- register；
- pull/fetch；
- 创建 projectId；
- 写 pointer；
- 升级 metadata；
- 修复 registry；
- 导入 checkpoint。

## 6. 已排除的方案

以下结论已经锁定，新 Session 不应重新采用：

1. **全局自增数字 ID**
   离线机器无法安全分配；使用 UUID。

2. **继续让 Store alias 充当 identity**
   同名独立 Store 无法区分；alias 只做展示和简写。

3. **把 `sourcePathHint` 提交到 Git**
   改名不能消除机器私有路径；共享 schema 中完全删除。

4. **整体同步 `~/.rasen`**
   其中包含路径、PID、锁、daemon、token、session 和临时输出；只做显式白名单导出。

5. **普通 status/list 自动 clone 或 register**
   隐式网络和本机 mutation 不可接受；只提示 `rasen bootstrap`。

6. **Store unavailable 时静默变成 no Store**
   会错误回退配置、隐藏 planning data 并触发错误 cleanup；必须 fail closed。

7. **直接把 #66 原样合入 dev 再做 UID**
   会先发布 alias-based ledger/manifest/digest，再立即做复杂迁移。

8. **一个巨型 change 一次完成全部工作**
   无法独立审查、迁移和回滚；按本文阶段拆分。

9. **用 run checkpoint 同步全部 project knowledge**
   长期知识与单次运行进度生命周期不同；使用独立 portable knowledge bundle。

10. **把所有 Store membership 都等同于 project pointer**
    pointer 是默认 planning/config binding；Store membership 是多对多关系。

## 7. 目标与非目标

### 7.1 用户目标

1. fresh machine clone 项目后运行一次显式 bootstrap，即可恢复 Store checkout
   和本机 registry binding。
2. clone Store 后可以恢复 Store 中的项目 roster、planning artifacts 和
   Store-scoped learned knowledge。
3. 同一逻辑项目的多 clone/worktree 共享 project identity，但 execution
   checkout 始终明确。
4. Store Session 能在 Store 中规划、在指定 Project checkout 中实施。
5. 多台机器并发向同一 Store 添加不同项目时，不因 alias 或单一 YAML map
   产生静默覆盖。
6. eject 永不使用另一台机器遗留的绝对路径。
7. 多机 bootstrap 只恢复 Git 声明和本机 binding，不伪装成活跃 Run 跨机恢复；
   如发布承诺包含 project knowledge portability，则只通过显式白名单 bundle。
8. global/store/project learned precedence 在同一机器和完整 bootstrap 后可解释、
   可诊断、可重复。

### 7.2 工程目标

1. 不可变 identity 与可读名称分离。
2. durable identity 与 local checkout binding 分离。
3. planning binding 与 Store membership 分离。
4. canonical catalog root、applicability evaluation root 和 materialization target
   分离。
5. 共享 resolver，禁止 config、session、knowledge 各自实现一套 Store lookup。
6. 所有 identity-bearing schema 都版本化。
7. legacy 数据可读；新格式只由显式 migration 或新 mutation 写出。
8. mutation 具备 plan/apply、dry-run、atomic write 和可恢复顺序。
9. Git 并发依赖 UUID 分片和 normal Git conflict，不引入后台中心服务。

### 7.3 非目标

本轮不实现：

- Issue schema、Execution Plan schema 或 Issue acceptance；
- Issue Board、Issue Detail 或后台 Issue scheduler；
- durable `Change → targetProject` binding；该 authority 在 `0.2.0` 的
  accepted Execution Plan 中建立；
- 自动 `git pull` / `git push`；
- 分布式锁服务；
- 跨 Store/Project 两仓强原子事务；
- 实时多人编辑或 CRDT；
- 自动同步凭据；
- 恢复 provider session handle；
- 同步整个 machine global knowledge；
- 自动决定不同 Store 中语义近似但字节不同的 learned skill 哪个正确；
- portable run checkpoint；它等待 `0.2.0` 的 Issue / Execution Plan
  identity 稳定后再实施。

## 8. 统一术语

### 8.1 Identity

逻辑实体的不可变身份：

```text
Store   → storeUid
Project → projectId
Run     → runId
Session → sessionId（机器临时）
```

### 8.2 Alias

人类可读名称：

```text
Store.id
Project.id / display name
change name
```

Alias：

- 可以重命名；
- 可以跨机器碰撞；
- 同一解析域中有多个候选时必须报歧义；
- 不能进入 canonical identity、ownership 或 digest 的主键位置。

### 8.3 Checkout

某台机器上的一个工作副本：

```ts
type ProjectCheckoutBinding = {
  projectId: string
  root: string
  home?: string
}
```

Checkout root：

- 是绝对本机路径；
- 不进入 Git；
- 不进入 portable checkpoint；
- 可以进入 machine registry、Session context 和本机 ledger file path。

### 8.4 Planning binding

Project 的默认 planning/config Store：

```text
Project P → one primary Store S
```

它来自项目 Git 中的结构化 pointer。

### 8.5 Store membership

Store roster 中包含 Project：

```text
Store S ↔ Project P
```

它是多对多关系，由 Store Git 中的 projectId 分片记录作为 authority。

### 8.6 Planning space

Session、change、status 所归属的 planning root：

```text
Project planning space
Store planning space
```

### 8.7 Execution project

本次 Session 要修改代码的逻辑 Project 和本机 checkout。

### 8.8 Knowledge owner

canonical learned knowledge 的拥有者：

```text
global
store:<storeUid>
project:<projectId>
```

Knowledge owner 不是 planning space，也不是 checkout。

## 9. 三个数据平面

### 9.1 Git 共享声明平面

允许：

- storeUid；
- projectId；
- alias；
- 无凭据 remote locator；
- planning binding；
- Store membership；
- adoption ownership；
- specs/changes；
- Store learned catalog；
- 显式 portable project knowledge bundle；
- 显式 portable run checkpoint；
- base commit SHA。

禁止：

- Windows/macOS/Linux 绝对 checkout path；
- PID；
- lock owner；
- daemon socket/port state；
- OAuth token/PAT；
- 带凭据 remote；
- provider session handle；
- machine username/hostname；
- 临时目录。

### 9.2 Machine binding 平面

位置：

```text
~/.rasen
```

包含：

- storeUid → Store checkout；
- projectId → 0..N Project checkouts；
- checkout → machine home；
- logical project knowledge home；
- lastSeen；
- Session context；
- local ledgers；
- imported checkpoint seed。

它可由 Git 声明重建，但不整体同步。

### 9.3 Transient execution 平面

包含：

- child PID；
- live process handle；
- output tails；
- locks；
- timeout；
- daemon；
- provider session ID；
- temporary staging。

不进入 Git，也不通过 checkpoint 恢复。

## 10. Global / Store / Project 统一职责矩阵

| 维度 | Global | Store | Project | Checkout |
|---|---|---|---|---|
| 不可变身份 | singleton | `storeUid` | `projectId` | 本机 binding |
| 可读名称 | global | `id` | display id/name | optional label |
| 配置 | machine global | Store Git config | Project Git config | 无 |
| learned canonical | machine local | Store Git | logical project machine home | 无 |
| learned portability | 默认不提供 | Git 原生 | 显式 bundle | 不适用 |
| planning root | 否 | 是 | 是 | checkout 可承载 |
| execution code root | 否 | 否 | 逻辑 owner | 本机实际 root |
| membership authority | 不适用 | `projects/<projectId>.yaml` | 只保存 locator hints | registry 不是 authority |
| 绝对路径 | machine only | registry only | registry only | machine only |

## 11. Identity 与目标 schema

### 11.1 Store metadata v2

```yaml
# <store>/.rasen-store/store.yaml
version: 2
uid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
id: elftia-store
remote: git@github.com:org/elftia-store.git
```

规则：

1. `uid` 创建后不可修改。
2. `id` 是 alias，可通过显式 rename 流程修改。
3. `remote` 可选，但 bootstrap-ready Store 应提供。
4. remote 不得包含凭据。
5. register 必须读取并验证 metadata，不能用 `--id` 覆盖既有 identity。
6. v1 metadata 可读；写 v2 必须经过显式 setup/upgrade。
7. 新建 alias 如果是纯数字，允许兼容但输出 warning。
8. 同一机器默认一个 Store UID 绑定一个 checkout。

### 11.2 Project primary Store pointer v2

```yaml
# <project>/rasen/config.yaml
schema: spec-driven
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450

store:
  uid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
  id: elftia-store
  remote: git@github.com:org/elftia-store.git
```

职责：

- `uid`：planning/config Store 的 authority；
- `id`：展示和兼容提示；
- `remote`：fresh-machine bootstrap locator。

验证：

- UID mismatch：error；
- alias drift：warning/info，允许刷新 pointer；
- remote drift：info，展示 pointer locator 与 Store canonical remote；
- legacy `store: elftia-store`：兼容读取，但只能在 alias 唯一时解析。

### 11.3 Project-side Store membership locators

为了让项目仓库单独 clone 后仍能发现 PR #66 所需的多个 Store，项目侧需要可移植
locator hints：

```yaml
storeMemberships:
  - uid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
    id: elftia-store
    remote: git@github.com:org/elftia-store.git
  - uid: 24fd3c21-52d8-4c56-9a8d-1d0c8758ff37
    id: platform-knowledge
    remote: git@github.com:org/platform-knowledge.git
```

这些记录是 locator，不是 membership authority。

真实 eligibility 仍要求对应 Store 中存在：

```text
.rasen-store/projects/<projectId>.yaml
```

有效 Store knowledge candidates：

```text
项目声明的 storeMemberships
    ∪
本机已注册且 Store record 包含 projectId 的 Stores
```

如果项目 hint 指向的 Store 未注册：

- effective knowledge 进入 degraded；
- 既有 Store materialization cleanup 延迟；
- 输出 bootstrap guidance。

如果本机 Store 反查到 membership、但项目 hint 缺失：

- 当前机器可以使用；
- Doctor 报 locator drift；
- fresh-machine determinism 不成立，要求显式修复项目 hint。

### 11.4 Store project record

```text
<store>/.rasen-store/projects/
└── <projectId>.yaml
```

示例：

```yaml
version: 1
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
id: elftia
remote: git@github.com:org/elftia.git

roles:
  planningMember: true
  knowledgeMember: true

adoption:
  specs:
    - fundraising
  changes:
    - fundraising-p0-p1
  adoptedAt: 2026-07-25T10:00:00Z
```

说明：

- 文件名和 authority 都是 `projectId`；
- `id` 只做展示；
- `remote` 用于从 Store bootstrap Project；
- `roles` 显式表达该关系允许哪些消费者使用；
- `adoption` 可选；
- 不含 `sourcePath`；
- 一个项目一个文件，降低并发 Git 冲突。

是否最终保留 `roles` 字段，应在 membership Change 的 proposal/spec 中确认。
但必须保留“planning binding 与 knowledge membership 可区分”的能力，不能退回一个
含义不清的 `member: true`。

### 11.5 Store registry v2

```yaml
# ~/.rasen/stores/registry.yaml
version: 2
stores:
  9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7:
    id: elftia-store
    backend:
      type: git
      local_path: E:\repos\elftia-store
      remote: git@github.com:org/elftia-store.git
```

索引：

```text
primary: uid → entry
secondary: alias → 0..N uid
```

解析规则：

- UUID exact match：精确；
- alias 0 命中：not found；
- alias 1 命中：兼容成功；
- alias N 命中：ambiguous；
- v1 registry：兼容读取，显式 mutation 后写 v2。

### 11.6 Project checkout registry

继续允许：

```text
projectId → 0..N independent checkouts
```

必须增加或明确：

- exact root selector 优先；
- projectId selector 在多 checkout 时不得任取第一项；
- linked worktree 可以通过 live Git inventory 解析；
- stale root 只报告，不由 read-only command 自动删除；
- local binding 永不写进 Git。

### 11.7 Logical project knowledge home

当前 project learned catalog 跟 clone-specific machine home 走，导致同一
`projectId` 在一个机器上可以存在多个 canonical catalog。

目标：

```text
~/.rasen/project-knowledge/<projectId>/learned-skills/<skillId>/
```

它与以下目录分离：

```text
clone/worktree-specific workDir
clone-specific archive/work ephemera
project-local tool materialization target
```

迁移规则：

1. 扫描同一 projectId 的旧 machine homes。
2. 只有一个 catalog：迁入 logical home。
3. 多 catalog 完全相同：去重迁入。
4. 多 catalog 同 ID 内容不同：报告 conflict，不选择赢家、不删除原数据。
5. 新 logical catalog 成功写入和验证前，不删除旧目录。
6. migration 可重复、可 dry-run。

## 12. 统一引用类型

目标公共类型：

```ts
type StoreIdentityRef = {
  type: 'store'
  uid: string
  id?: string
}

type ProjectIdentityRef = {
  type: 'project'
  projectId: string
  id?: string
}

type GlobalIdentityRef = {
  type: 'global'
}

type DurableOwnerRef =
  | GlobalIdentityRef
  | StoreIdentityRef
  | ProjectIdentityRef
```

本机解析后：

```ts
type ResolvedStoreRef = StoreIdentityRef & {
  root: string
}

type ResolvedProjectCheckoutRef = ProjectIdentityRef & {
  root: string
  home?: string
}
```

约束：

- durable ref 不含 root；
- resolved ref 只在 machine/runtime API 中使用；
- manifest、ledger、checkpoint、digest 使用 durable identity；
- UI wire response 可以同时提供 durable identity、display alias 和 local root；
- 不再使用模糊 `{type, id}` 同时表达 Store UID、Store alias、projectId 和
  project namespace alias。

## 13. 两种关系与各自消费者

### 13.1 Planning binding

Authority：

```text
Project rasen/config.yaml structured store pointer
```

消费者：

- 默认 `status/list/new change` root selection；
- Store config inheritance；
- 从 Project cwd 启动且未显式选择 space 的 Session；
- primary Store bootstrap；
- planning root frozen identity。

### 13.2 Store membership

Authority：

```text
Store .rasen-store/projects/<projectId>.yaml
```

消费者：

- Store portfolio/project roster；
- Store Session 可选 execution projects；
- Store-scoped learned knowledge eligibility；
- promotion source membership；
- adoption/eject ownership；
- Store-first bootstrap。

### 13.3 Project-side membership locator

Authority：无，仅为 locator。

消费者：

- Project-first bootstrap；
- missing Store diagnostics；
- fresh-machine effective knowledge completeness。

### 13.4 一致性规则

对于 primary planning Store：

```text
Project pointer.uid
  应对应
Store project record(projectId)
```

缺失时：

- read-only planning resolution 可以定位 Store，但报告 membership drift；
- 会修改 Store planning artifacts 的操作应 fail closed，或要求显式 repair；
- bootstrap 可提供生成/补全 record 的 plan，但不得由 status 自动创建。

对于 secondary knowledge Store：

- 不要求 Project primary pointer 指向该 Store；
- 要求 Store project record 允许 `knowledgeMember`；
- 项目侧应有 locator hint，保证新机器可发现；
- Store Session 如果选择该项目，必须通过 Session context 显式覆盖默认 planning
  binding，不能依赖 Project cwd pointer。

### 13.5 与 `0.2.0` Execution Plan 的 authority 边界

必须永久区分以下三层：

```text
Store membership
  = Project 是否属于 Store roster，以及是否具备被选择为执行候选的资格

accepted Execution Plan targetProject
  = 某个 Change 应在哪个逻辑 Project 执行的 durable 业务真相

Session execution checkout
  = 某一次 Run 实际使用的本机 checkout，是运行事实和本机 locator
```

因此：

1. Store membership 不能自动生成或替代 `Change.targetProject`。
2. Project primary Store pointer 不能决定 Change target。
3. `0.1.5` 的手工 Session execution selector 是启动选择和兼容能力，不是永久
   ownership 字段。
4. `0.2.0` 中，当 Session 为 accepted Execution Plan node 启动时，服务端必须
   验证 execution project 与该 node 的 `targetProject` 一致；不得由 Session
   静默改写目标。
5. 一个 Change 仍然只有一个 primary target Project；跨项目 Issue 由多个
   target-aware Changes 组成。
6. `Session.cwd` 只证明实际运行位置，不能反向成为 Change target 的来源真相。

本轮 Store project record 的 `roles` 即使未来增加 execution 相关字段，也只能
表达 `executionEligible` 一类候选资格，不能命名或解释成 execution assignment。

## 14. 配置层级

配置有效值：

```text
env override
    >
project config
    >
primary planning Store config
    >
global config
    >
default
```

注意：

- secondary knowledge Stores 不参与 config inheritance；
- Store membership 不等于 config parent；
- Store root 自身不从自己的 pointer 递归继承；
- Store-to-Store config transitivity 不在本轮范围；
- global config 是 machine-local，因此不同机器允许有不同的非关键偏好；
- 需要跨机器确定性的关键值应写在 Project 或 Store layer。

Store binding resolver 必须返回：

```ts
type StoreBindingResolution =
  | { kind: 'absent' }
  | { kind: 'resolved'; store: ResolvedStoreRef; pointer: StorePointerV2 }
  | {
      kind: 'unavailable'
      expected: StoreIdentityRef
      reason:
        | 'not-registered'
        | 'metadata-missing'
        | 'uid-mismatch'
        | 'root-unhealthy'
        | 'alias-ambiguous'
        | 'pointer-malformed'
      repair: string[]
    }
```

禁止把 `unavailable` 转换成 `null` 后继续 global/default fallback。

## 15. Learned knowledge 层级

### 15.1 Canonical storage

```text
global:
  ~/.rasen/learned-skills/<id>

store:
  <store>/rasen/learned-skills/<id>

project:
  ~/.rasen/project-knowledge/<projectId>/learned-skills/<id>
```

### 15.2 Effective precedence

每个 skill ID：

```text
1. 过滤 active、managed、applicable
2. project record 存在 → project winner
3. 否则解析所有 eligible Store records
4. Store records 完全等价 → 一个 winner，记录所有 Store UIDs
5. Store records 不同 → conflict
6. 没有 Store winner → global fallback
```

即：

```text
project > all eligible Stores > global
```

这里的 `Store` 来源于 `storeMembership`，不是 primary planning pointer。

### 15.3 Store equivalence

只有同时满足以下条件才去重：

- skill ID 相同；
- knowledgeKey 相同；
- canonical content bytes 相同；
- canonical content digest 相同；
- manifest 是有效 managed record。

输出 sources：

```json
[
  {
    "owner": {
      "type": "store",
      "uid": "..."
    },
    "id": "typescript-cli-routing"
  }
]
```

排序使用 UID 或稳定 canonical serialization，不使用 alias。

### 15.4 Store conflict

不同 Store 发布同 ID 但内容不同时：

- 收集完整参与者；
- 顺序无关；
- project winner 存在时为 latent conflict；
- 无 project winner 时阻断整个 learned reconciliation；
- 不影响普通 workflow generation；
- 不写 learned files/ledger 的部分结果。

### 15.5 Unavailable Store

以下 Store 被视为 relevant：

- project `storeMemberships` 声明；
- 上次 ledger 的 source；
- frozen planning/membership fact；
- 当前 primary pointer；
- 本机反查到 project record。

Relevant Store unavailable：

- 不视为 empty；
- cleanup/replacement 进入 deferred；
- 新增的无关高层 project winner可以安全覆盖；
- 输出明确 degraded diagnostics。

### 15.6 Project canonical root、evaluation root、target root

必须分开：

```text
canonicalOwnerRoot:
  ~/.rasen/project-knowledge/<projectId>

evaluationRoot:
  当前明确选择的 Project checkout

materializationTarget:
  当前 checkout 中某个工具的 project-local skill home
```

Applicability 使用 `evaluationRoot`。

Canonical project catalog 使用 `canonicalOwnerRoot`。

Tool files 和 project learned ledger 使用 `materializationTarget` 所属 checkout。

### 15.7 Ledger v2

Project learned ledger 的 Store facts 和 source owner 必须使用 UID：

```json
{
  "version": 2,
  "stores": {
    "<storeUid>": {
      "lastMembership": "member",
      "relevant": true,
      "id": "display-alias"
    }
  },
  "tools": {
    "claude": {
      "learned": {
        "typescript-cli-routing": {
          "effectiveScope": "store",
          "sources": [
            {
              "owner": {
                "type": "store",
                "uid": "<storeUid>"
              },
              "id": "typescript-cli-routing"
            }
          ],
          "canonicalContentDigest": "sha256:...",
          "resolutionDigest": "sha256:...",
          "file": {
            "scope": "project",
            "path": ".claude/skills/...",
            "sha256": "sha256:..."
          }
        }
      }
    }
  }
}
```

V1 alias-based ledgers如果只存在于未发布分支，可以不作为公开兼容承诺；但开发机
和 dogfood 环境可能已有数据，因此 migration 仍应：

- 检测；
- dry-run；
- 能唯一 alias→UID 时升级；
- alias 多义时阻断；
- 不静默丢 source provenance。

### 15.8 Resolution digest

V2 digest 输入至少包含：

```text
schema version
skill ID
knowledgeKey
effective scope
sorted durable source identities
canonical content digests
rendered managed body
```

Store alias 不进入 identity portion。

Alias rename 不应导致纯 provenance identity 改变。

V1→V2 digest 改变必须作为 migration 记录，不能伪装成内容变更。

## 16. Session runtime context

### 16.1 目标上下文

```ts
type RuntimePlanningRef =
  | {
      type: 'project'
      projectId: string
      root: string
    }
  | {
      type: 'store'
      uid: string
      id?: string
      root: string
    }

type RuntimeExecutionRef =
  | {
      kind: 'planning-only'
    }
  | {
      kind: 'project'
      projectId: string
      root: string
      home?: string
    }

type RuntimeContext = {
  version: 1
  planning: RuntimePlanningRef
  execution: RuntimeExecutionRef
}
```

### 16.2 Session-local context 文件

建议：

```text
~/.rasen/sessions/<sessionId>/context.json
```

内容允许绝对路径，因为它不进 Git：

```json
{
  "version": 1,
  "sessionId": "...",
  "planning": {
    "type": "store",
    "uid": "...",
    "id": "team",
    "root": "E:\\repos\\team-store"
  },
  "execution": {
    "kind": "project",
    "projectId": "...",
    "root": "E:\\repos\\project-clone-b"
  }
}
```

Supervisor 启动子进程时设置：

```text
RASEN_SESSION_CONTEXT=<absolute context file>
```

不要把整个 JSON 塞进环境变量，避免 quoting、长度和日志泄露问题。

### 16.3 子进程解析优先级

对于初次命令：

```text
explicit CLI selector
    → Session context
    → launch cwd / project pointer fallback
```

对于 frozen run-state：

```text
frozen durable identity 是 authority
    +
Session context/current checkout 是本机 locator
    +
explicit selector 只做一致性校验
```

如果 frozen `projectId` 与 Session execution checkout 的 config 不一致：

- fail closed；
- 不退回 registry 任取其他 clone。

如果 Session context 不存在：

- 当前 cwd config 匹配 frozen projectId 时使用 cwd；
- 否则 registry 唯一命中时使用；
- 多命中时报 `project_binding_ambiguous`。

### 16.4 Session record

Session record 至少应保留：

```ts
{
  space: durable planning identity + local root
  execution?: durable project identity + local root
  cwd: local execution root
}
```

仍然是 machine-local/in-memory 或本机持久状态，不进入 Git。

### 16.5 Store Session membership

当用户在 Store S 选择 Project P：

1. Store S UID 必须健康；
2. Project P checkout 必须存在；
3. checkout config 的 projectId 必须匹配；
4. Store project record 必须允许 execution/planning membership；
5. primary pointer 可以指向别的 Store，但此时 Session context 必须显式把 planning
   固定为 S；
6. 子进程的 Rasen 命令必须读取 Session context，而不是从 cwd pointer 重新猜。

### 16.6 Planning-only

Planning-only Store Session：

- cwd = Store root；
- execution.kind = planning-only；
- 不允许 project-scoped materialization；
- 不允许代码 apply；
- 允许 planning artifact 操作；
- UI 和 agent instructions 必须明确限制。

## 17. ActionContext 与文件能力

当前单一：

```ts
allowedEditRoots: string[]
```

无法表达 Store planning + Project execution。

目标 v2：

```ts
type ActionContextV2 = {
  version: 2
  planningWriteRoots: string[]
  codeWriteRoots: string[]
  readRoots: string[]
  requiresAffectedAreaSelection: boolean
  constraints: string[]
}
```

Store + Project execution：

```text
planningWriteRoots = [Store planning root 的允许子域]
codeWriteRoots     = [selected Project checkout]
readRoots          = [Store root, selected Project checkout]
```

Planning-only：

```text
planningWriteRoots = [Store planning root]
codeWriteRoots     = []
```

安全要求：

- 不把 Store 的所有成员 checkout 加入 codeWriteRoots；
- 不把整个 home directory 加入；
- planning write 最好进一步限制到 `rasen/specs`、`rasen/changes` 等确切子域；
- `--add-dir` 是可见性/进程能力，不等同于业务授权；
- agent instructions 必须消费结构化 action context；
- 旧 `allowedEditRoots` 的兼容投影不得静默放宽权限，必要时版本化 API。

## 18. Resolver 架构

### 18.1 单一 Store identity resolver

职责：

- parse v1/v2 metadata；
- parse v1/v2 pointer；
- resolve UID；
- alias 兼容；
- registry lookup；
- metadata UID 验证；
- root health；
- remote drift；
- 返回 resolved/absent/unavailable。

消费者：

- root selection；
- effective config；
- bootstrap；
- Doctor；
- Session launch；
- learned context；
- Store commands。

禁止每个消费者自行 `listRegisteredStores().find(id)`。

### 18.2 单一 Project checkout resolver

输入：

```text
projectId
absolute checkout root
linked worktree root
legacy project namespace alias
```

输出：

```ts
{
  identity: { projectId }
  checkout: { root, home, kind }
}
```

规则：

- exact canonical root 最精确；
- projectId 多 checkout 时必须显式选择；
- worktree 解析到 logical projectId，但保留当前 worktree root；
- legacy alias 仅作 locator；
- resolver 无副作用。

### 18.3 Store membership provider

唯一 authority reader：

```text
<store>/.rasen-store/projects/*.yaml
```

兼容期可读取：

- legacy `references: [project:<alias>]`；
- `adoptions.yaml`；
- store project namespace registry。

但兼容结果必须规范化为：

```ts
{
  storeUid
  projectId
  roles
  provenance: 'v2-record' | 'legacy-reference' | 'legacy-adoption'
  diagnostics
}
```

新写入只写 projectId 分片。

### 18.4 Runtime context resolver

统一：

- CLI knowledge context；
- Session launch context；
- pipeline frozen context；
- actionContext roots；
- change planning root；
- execution checkout。

不要求所有模块依赖一个巨型类，但必须共享：

- identity types；
- Store resolver；
- Project checkout resolver；
- membership provider；
- resolution result/error codes。

## 19. Bootstrap

### 19.1 命令

```text
rasen bootstrap
  [--store-path <path>]
  [--project-path <path>]
  [--clone-root <path>]
  [--check]
  [--dry-run]
  [--json]
  [--yes]
```

`--check`：

- 完全只读；
- 不 clone；
- 不 register；
- 不 mint；
- 输出当前 state 和 exact repair plan。

`--dry-run`：

- 可以解析 remote 和目标路径；
- 不创建目录；
- 不执行 git；
- 不写 registry/pointer。

### 19.2 Project-first bootstrap

用户：

```bash
git clone <project-remote>
cd <project>
rasen bootstrap
```

状态机：

1. 读取并验证 `projectId`。
2. 读取 primary Store pointer v1/v2。
3. 读取 `storeMemberships` locator hints。
4. 构造 expected Store UID 集合。
5. 对每个 Store：
   - 已注册：验证 UID/root；
   - 已 clone 未注册：建议/执行 register；
   - 未 clone、有 remote：建议/执行 clone；
   - 无 remote：要求 `--store-path` 或补 metadata。
6. 注册当前 Project checkout。
7. 验证每个 Store 的 project record。
8. hydrate logical project knowledge home 基础目录。
9. 如果存在显式 portable knowledge bundle，单独计划 import。
10. 输出完成、degraded 或 blocked。

### 19.3 Store-first bootstrap

用户：

```bash
git clone <store-remote>
rasen store register <store-path>
rasen bootstrap --store-path <store-path>
```

Rasen：

1. 验证 Store UID；
2. 注册 Store checkout；
3. 读取 `projects/*.yaml`；
4. 展示哪些 Project 已在本机、哪些可 clone；
5. 只有用户显式选择或提供 `--project-path` 时才 clone/register Project；
6. 不自动 clone Store 中所有项目。

### 19.4 Clone 目标

优先级：

```text
显式 --store-path / --project-path
    >
显式 --clone-root + safe basename
    >
交互选择
```

禁止：

- clone 到非空目录；
- 覆盖现有 checkout；
- 根据旧 `sourcePath` 选择；
- shell 拼接 remote；
- 自动删除 clone 失败目录，除非能证明是本次创建且为空/安全。

### 19.5 幂等

相同身份和相同 checkout 重跑：

- 不重写 UID；
- 不创建重复 registry entry；
- 不改变路径；
- 不重复 import；
- JSON 标记 `already_registered`、`already_hydrated`；
- alias/remote drift 只报告。

## 20. 普通命令与 Doctor

### 20.1 普通命令

| 状态 | 行为 |
|---|---|
| pointer UID 已注册且匹配 | 正常 |
| pointer UID 未注册、有 remote | fail，提示 `rasen bootstrap` |
| pointer UID 未注册、无 remote | fail，要求 Store path/remote |
| UID mismatch | fail closed |
| legacy alias 唯一 | 兼容工作并提示升级 |
| legacy alias 多义 | fail ambiguous |
| membership Store 未注册 | learned degraded，cleanup deferred |

### 20.2 Doctor

Doctor 保持只读并检查：

```text
Project identity
Project checkout binding
Primary planning Store pointer
Store UID/alias/remote
Store checkout registry
Store project membership
Project-side membership locators
Adoption ownership
Legacy local paths in Git
Learned ledger identity version
Session/run frozen context version
Logical project knowledge conflicts
```

建议诊断码：

| code | 含义 |
|---|---|
| `store_bootstrap_required` | Store 声明存在但本机未绑定 |
| `store_uid_mismatch` | checkout 不是预期 Store |
| `store_alias_ambiguous` | alias 对应多个 UID |
| `store_pointer_legacy` | v1 string pointer |
| `store_pointer_remote_divergence` | locator 与 canonical remote 不同 |
| `project_binding_missing` | 当前 checkout 未注册 |
| `project_binding_ambiguous` | projectId 有多个 checkout |
| `store_project_record_missing` | Store 无 projectId record |
| `project_membership_locator_missing` | Store 有 record，Project 无 locator |
| `project_membership_unverified` | Project 有 locator，Store 无 record |
| `shared_metadata_contains_local_path` | Git 数据含绝对路径 |
| `learned_owner_legacy_alias` | learned identity 仍使用 Store alias |
| `project_knowledge_catalog_conflict` | 同 projectId 多旧 catalog 冲突 |

## 21. Adopt / Add-project / Eject

### 21.1 Add-project

目标写入：

```text
Store:
  .rasen-store/projects/<projectId>.yaml

Project:
  storeMemberships locator
  primary store pointer（只有用户选择绑定时）
```

跨两仓不能强原子，因此使用 plan + ordered apply。

新增顺序：

1. 验证两仓 identity 和 base SHA；
2. 写 Store authority record；
3. 验证；
4. 写 Project locator hint；
5. 验证双向一致；
6. 输出两个仓各自需要 commit 的文件。

如果步骤 4 失败：

- Store record 保留；
- 报 `project_membership_locator_missing`；
- 不回滚已存在的合法 authority；
- 给出 repair 命令。

### 21.2 Adoption

推荐顺序：

1. 完整 preflight；
2. 确定 projectId；
3. 写/升级 Store project record ownership；
4. 验证 record；
5. 搬移 specs/changes；
6. 更新 Project primary pointer；
7. 更新 Project membership locator；
8. 更新本机 registry mode；
9. 验证源、目标和 ownership；
10. 输出 Git 操作建议，不自动 commit/push。

保持“ownership 先于源删除”的可恢复原则。

### 21.3 Eject 目标解析

优先级：

```text
显式 --into
    >
当前命令所在 checkout 且 projectId 匹配
    >
本机 project registry 唯一 live checkout
    >
失败并要求 --into
```

禁止使用：

- legacy `sourcePath`；
- Store record 中的 remote 直接推断本机路径；
- alias 猜测；
- 多 checkout 时任选第一个。

### 21.4 Legacy sourcePath 迁移

Migration：

- 读取旧 adoptions；
- 按 projectId 生成 `projects/<projectId>.yaml`；
- 拷贝 specs/changes ownership；
- 丢弃 `sourcePath`；
- 保留 timestamp 为 `adoptedAt`；
- 先 dry-run；
- v2 写成功并验证后才删除/归档旧 manifest；
- eject 从此不读取 sourcePath；
- Doctor 在迁移前持续警告。

## 22. 多机并发

### 22.1 Identity

Store、Project、Run 使用 UUID，不请求中央“下一个编号”。

### 22.2 Project membership 分片

机器 A：

```text
.rasen-store/projects/<project-A-uuid>.yaml
```

机器 B：

```text
.rasen-store/projects/<project-B-uuid>.yaml
```

正常情况下修改不同文件。

同 alias 不会覆盖，因为主键是 projectId。

### 22.3 同 projectId 并发

双方修改同一个 project record：

- 这是同一逻辑实体的正常 Git 并发；
- 使用 normal merge/rebase；
- 合并后重新运行 schema/ownership validator；
- 不做 last-writer-wins。

### 22.4 Planning artifacts

Store 中 specs/changes 仍是平铺 namespace。

两台机器并发创建同名内容：

1. 本地可能都通过 preflight；
2. 第一方 push；
3. 第二方 non-fast-forward；
4. fetch/rebase；
5. 同路径产生 Git conflict 或重新验证失败；
6. 用户解决。

Rasen 不提供分布式锁。

### 22.5 两仓 operation

Mutation 结果记录：

```json
{
  "projectBaseCommit": "<sha>",
  "storeBaseCommit": "<sha>",
  "projectWrites": [],
  "storeWrites": [],
  "repairNeeded": []
}
```

Apply 前后验证 base SHA；不自动 pull/push。

## 23. Project knowledge portability

### 23.1 默认语义

Project knowledge：

- 逻辑 owner 是 projectId；
- 同一机器多个 clone 共用 logical project knowledge home；
- 默认不自动跨机器同步；
- 不进入普通 run checkpoint。

### 23.2 显式 bundle

建议命令面：

```text
rasen knowledge bundle export
  --project <projectId|root>
  --to <path>
  [--to-store <store>]
  [--json]

rasen knowledge bundle import <bundle>
  --project <projectId|root>
  [--dry-run]
  [--json]
```

Bundle：

```yaml
version: 1
bundleId: <uuid>
projectId: <uuid>
createdAt: ...
baseProjectCommit: ...
records:
  - id: ...
    knowledgeKey: ...
    contentDigest: ...
    manifest: ...
```

必须：

- 不含本机路径；
- 不含 target ledger；
- 不含 tool materialization；
- 不含 token/session；
- import 验证 projectId；
- 与本机 catalog 冲突时 fail，不覆盖；
- Store 只作为 transport，不把 project record 改成 Store scope。

### 23.3 是否自动随 bootstrap import

默认不自动。

只有 Project config 或 Store project record 显式声明某个 portable bundle 时，
bootstrap 才把它列为独立 plan action，并要求确认或 `--yes`。

## 24. Portable run checkpoint

> 状态：`0.2.0` 或更晚的设计草案，不属于 `0.1.5` 发布范围。
>
> 原因：portable run checkpoint 最终必须引用 Issue、accepted Execution Plan
> revision、plan node、Change target 和 evidence。现在发布 Change-only 协议会在
> Issue 模型落地后立刻产生第二轮迁移。

本节保留多机运行交接的安全边界，但后续不得按当前示例直接开工。开始实现前
必须先读取 `rasen/work/issue-centered-automation-platform/`，并以当时已经
接受的 Issue / Execution Plan schema 更新 identity 和 lineage。

### 24.1 命令

```text
rasen checkpoint export <change> [--to <path>|--to-store]
rasen checkpoint import <file>
rasen checkpoint list <change>
```

### 24.2 建议位置

```text
<store>/.rasen-store/checkpoints/
└── <projectId>/
    └── <change>/
        └── <runId>.yaml
```

### 24.3 Schema

以下仅为 `0.1.5` 讨论阶段留下的 Change-level 示例，不是可直接发布的最终
schema：

```yaml
version: 1
runId: a40c5a72-55d3-48e9-8f59-0b1eaa31216f
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
planning:
  type: store
  storeUid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
change: fundraising-p0-p1
pipeline: auto
stage: implement
createdAt: 2026-07-25T10:30:00Z

bases:
  projectCommit: 86ab...
  storeCommit: e092...

progress:
  completedTasks:
    - 1.1
    - 1.2
  currentTask: 1.3
  decisions:
    - Use projectId-keyed records.
  blockers: []
  nextAction: Implement pointer v2 parsing.
```

### 24.4 白名单

允许：

- durable identity；
- change/pipeline/stage；
- task progress；
- decisions/blockers/next action；
- base SHA；
- root-relative artifact references；
- 非敏感结构化摘要。

禁止：

- checkout absolute root；
- PID/lock/socket；
- provider session；
- token/cookie/env secrets；
- transcript 原文，除非用户另行明确导出；
- machine username/hostname。

### 24.5 Import

1. bootstrap Store/Project；
2. 验证 projectId/storeUid；
3. 比较 base commits；
4. 落后时提示同步；
5. divergence 时标记 conflict；
6. 新建本机 Session/run；
7. 原 runId 只作为 lineage；
8. 不恢复旧 PID/lock/provider session；
9. exact checkout 由当前机器重新选择。

Checkpoint 是 portable handoff seed，不是进程快照。

未来 schema 还必须能够记录或引用：

- Issue identity；
- accepted Execution Plan revision/hash；
- plan node identity；
- durable Change reference 和 target Project；
- 实际读取的 planning revision；
- 可归档 evidence references。

这些字段的确切名称由 `0.2.0` Issue change 决定。无论最终格式如何，import
始终新建本机 Run/Session，旧 runId 只作为 lineage，不能把 Git checkpoint
升级为活跃 Run 的第二份真相。

## 25. 兼容与迁移矩阵

| 数据 | Legacy | 目标 | 行为 |
|---|---|---|---|
| Store metadata | v1 `{id,remote?}` | v2 `{uid,id,remote?}` | v1 读；显式升级 |
| Project pointer | `store: <id>` | object `{uid,id,remote}` | 唯一 alias 兼容 |
| Store registry | alias key | UID key + alias index | v1 读；mutation 写 v2 |
| Project namespace | `project:<alias>` | projectId | locator-only 兼容 |
| Membership | references/registry/pointer | projectId record | legacy normalization |
| Adoption | map + sourcePath | projectId record | 显式迁移 |
| Knowledge owner | Store alias | Store UID | v2 refs |
| Frozen context | `{type,id}` | UID/projectId typed refs | v1 读 + revalidate |
| Project learned home | clone-specific | projectId logical home | conflict-safe migration |
| Learned ledger | alias source | UID source | versioned upgrade |
| Session | space + cwd | planning + execution + binding | machine-local |

### 25.1 Migration 命令建议

```text
rasen store upgrade-identity <store>
  [--dry-run]
  [--apply]
  [--json]

rasen store migrate-membership <store>
  [--dry-run]
  [--apply]
  [--json]

rasen knowledge migrate-project-home <project>
  [--dry-run]
  [--apply]
  [--json]
```

是否合并成一个命令由具体 Change 决定，但 core planner 应分离，避免一个失败导致
所有迁移不可诊断。

## 26. 开发路线

### 26.0 版本、节奏与完成状态

本节的 `0.1.5` 主线是：

```text
Phase A → Phase B → Phase C → Phase D → Phase E
                                      → Phase F（按发布承诺）
→ integrated release candidate
→ 用户集中真实场景验收
→ 修复
→ 发布 0.1.5
```

纳入 `0.1.5` 的 Phase A～F 是同一个 Store 用户能力切片内部的工程依赖和
Change/PR 边界，不是多个需要分别进行人工验收的独立产品切片。对 north-star
中“每个切片必须 dogfood”的满足点，是完整 Store 能力形成 integrated release
candidate 后的集中真实场景验收，而不是每合入一个内部 schema/resolver Change
就暂停等待用户。

开发人员/Agent 不需要在每个 Phase 完成后暂停等待用户手工操作。每个 Phase
达到以下工程 Gate 后，继续下一阶段：

- 实现完成；
- 单元测试通过；
- 相关集成测试和 CLI fixture 通过；
- migration/dry-run/compatibility 证据完整；
- 没有已知 P0/P1 correctness 或数据安全问题；
- 阶段提交已经进入预期 integration ancestry。

统一状态语言：

```text
implemented
  → automated-verified
  → integrated-candidate
  → human-scenario-accepted
  → releasable
```

只有最后两步由用户在完整 Store 需求集成后集中完成。自动测试、fixture 或
开发人员自述不能冒充 `human-scenario-accepted`；反过来，尚未到最终集中验收
也不应阻塞已经自动验证通过的后续 Phase 开发。

`0.2.0` 在 `0.1.5` 发布后单独开始，第一条主线遵循：

```text
单 Issue / 单 Change / 单项目
  → 单 Issue / 多 Change / 单项目
  → 单 Issue / 多 Change / 多项目
  → 自动 Dispatch
  → Issue-level delivery and acceptance
```

### Phase 0：恢复事实与建立 integration rehearsal

目的：

- 防止再次误判 PR landing；
- 保存 #65/#66 算法来源；
- 预演与当前 dev 的文本合并；
- 不向 dev 发布旧 schema。

操作：

```powershell
git fetch origin
git switch dev/0.1.5
git pull --ff-only

git switch -c integration/store-context-rehearsal
git merge --no-ff 481423954b775989373ddb979813da616213951e
```

该分支：

- 只用于编译、测试、阅读和记录语义冲突；
- 不作为最终 PR；
- 不要求长期维护；
- 不得替代下面按阶段落地的分支。

如果不需要预演，可跳过，不影响正式开发。

### Phase A：Store immutable identity

建议 Change：

```text
store-immutable-identity
```

建议分支：

```text
feat/store-immutable-identity
```

目标：

- Store metadata v2；
- pointer v2；
- registry v2；
- UID-first resolver；
- tri-state binding；
- alias ambiguity；
- read-only diagnostics。

主要文件：

```text
src/core/store/foundation.ts
src/core/store/registry.ts
src/core/store/operations.ts
src/core/project-config.ts
src/core/root-selection.ts
src/core/effective-config.ts
src/core/config-api/project-addressing.ts
src/core/relationship-health.ts
src/commands/store.ts
src/commands/doctor.ts
```

明确不包含：

- #65/#66 Store learned materialization；
- project membership 分片；
- bootstrap clone；
- checkpoint；
- sourcePath migration。

验收：

- 新 Store 创建 UUID；
- legacy Store 可读；
- UID mismatch fail closed；
- alias 0/1/N 正确；
- effective config 不再静默忽略 unavailable Store；
- read-only commands 零写入；
- JSON/human diagnostics 对齐。

合入要求：

- PR 最终 target 必须是 `dev/0.1.5`；
- merge 后验证 Phase A commit 是 dev ancestor；
- 不仅依赖 docs-site check。

### Phase B：Project-keyed Store membership

建议 Change：

```text
project-keyed-store-membership
```

目标：

- `projects/<projectId>.yaml`；
- roles；
- project-side locator hints；
- legacy references/adoptions normalization；
- add-project/adopt/eject 新语义；
- sourcePath removal；
- membership Doctor。

主要文件：

```text
src/core/store/migration.ts
src/core/store/migration-ops.ts
src/core/references.ts
src/core/project-config.ts
src/core/relationship-health.ts
src/core/management-api/spaces.ts
src/commands/store.ts
src/commands/doctor.ts
new: src/core/store/project-records.ts
new: src/core/store/membership.ts
```

验收：

- 同 alias 不同 projectId 共存；
- 不同机器添加不同项目写不同文件；
- primary pointer 与 membership 分离；
- Store member listing 使用统一 provider；
- legacy sourcePath 不参与 eject；
- 新写入不含绝对路径；
- 两仓中断状态可诊断、可修复。

### Phase C：Unified Session runtime context

建议 Change：

```text
unified-session-runtime-context
```

目标：

- Session 保存 planning + execution；
- 子进程 context file；
- exact checkout binding；
- learned/run resolver 消费 Session context；
- ActionContext v2；
- planning-only 限制。

主要文件：

```text
src/core/management-api/session-launch-context.ts
src/core/management-api/sessions.ts
src/core/management-api/supervisor.ts
src/core/management-api/session-registry.ts
src/core/management-api/wire-types.ts
src/core/management-api/spaces.ts
src/core/learned-skills/context.ts
src/core/pipeline-registry/run-state.ts
src/core/change-status-policy.ts
src/core/artifact-graph/instruction-loader.ts
packages/ui/src/components/LaunchSessionDialog.tsx
packages/ui/src/api/types.ts
```

验收：

- Store S + Project P checkout B 启动后，子命令解析仍是 S/P/B；
- 同 projectId clone A/B 同时注册，resume 不歧义；
- linked worktree 保留 exact root；
- secondary Store membership 不依赖 P 的 primary pointer；
- planning-only 没有 codeWriteRoots；
- Session context 不进入 Git；
- malformed/stale context fail closed。

### Phase D：Integrate PR #65/#66 on new contracts

建议 Change：

```text
store-aware-learned-skills-integration
```

来源提交：

```text
5fa3230068acbb9ece31e4f843d97279b6322730
481423954b775989373ddb979813da616213951e
```

迁入策略：

- 可以 cherry-pick 到工作分支作为起点；
- 不允许未经适配直接提交；
- 保留算法和测试意图；
- 将 Store alias identity 改为 UID；
- 将 membership authority 改为 Phase B provider；
- 将 execution/evaluation root 改为 Phase C runtime context；
- 将 project canonical catalog 改为 logical project knowledge home；
- ledger 升级到 v2。

主要文件：

```text
src/core/learned-skills/types.ts
src/core/learned-skills/schema.ts
src/core/learned-skills/context.ts
src/core/learned-skills/stores.ts
src/core/learned-skills/authority.ts
src/core/learned-skills/effective.ts
src/core/learned-skills/mutate.ts
src/core/learned-skill-materialization.ts
src/core/project-learned-skill-ledger.ts
src/core/global-learned-skill-ledger.ts
src/core/init.ts
src/core/update.ts
src/commands/knowledge.ts
```

验收：

- project > stores > global；
- Store sources 使用 UID；
- alias rename 不改变 canonical identity；
- multi-Store exact dedup；
- divergent conflict；
- unavailable relevant Store deferred；
- global-only tool 不接收 Store/Project records；
- same projectId 多 checkout 使用同 logical catalog、不同 evaluation/target；
- Session Store execution 与 CLI knowledge context 一致。

### Phase E：Bootstrap and hydration

建议 Change：

```text
store-bootstrap-and-hydration
```

目标：

- Project-first bootstrap；
- Store-first bootstrap；
- remote locator；
- clone/register/hydrate state machine；
- membership completeness；
- logical project knowledge home init；
- Doctor guidance。

主要文件：

```text
new: src/core/store/bootstrap.ts
new: src/commands/bootstrap.ts
src/core/store/operations.ts
src/core/project-home.ts
src/core/project-registry.ts
src/core/root-selection.ts
src/core/relationship-health.ts
src/commands/doctor.ts
src/core/completions/command-registry.ts
locales/docs
```

验收：

- 空 `RASEN_HOME` 双机 fixture；
- 只 clone Project 后可完整 plan；
- 显式同意后 clone/register Store；
- UID mismatch 零 registry 写入；
- `--check` 和 `--dry-run` 零写入；
- 重跑幂等；
- secondary Store locator 缺失可诊断；
- status/list 在未 bootstrap 时 fail closed。

### Phase F：Portable project knowledge

建议 Change：

```text
portable-project-knowledge
```

目标：

- logical project knowledge home migration；
- bundle export/import；
- conflict handling；
- optional Store transport；
- bootstrap integration。

范围分为两部分：

1. 同一机器按 `projectId` 唯一的 logical project knowledge home 是 Phase D
   正确处理多 checkout 的必要条件；如有需要，应随 Phase D 落地。
2. 跨机器 bundle export/import 只有在 `0.1.5` 发布承诺明确包含“project
   learned knowledge 可携带”时才进入 release scope；否则保留为独立后续
   `0.1.x` Change，不阻塞基本 Store bootstrap。

无论是否包含 bundle，发布说明都必须准确区分：

```text
Store Git knowledge     = clone Store 后天然共享
Project machine knowledge = 默认本机
Portable project bundle  = 只有实现并显式 export/import 后才跨机器
```

### Phase G：Portable run checkpoint（移出 `0.1.5`）

建议 Change：

```text
portable-run-checkpoints
```

目标：

- export/import；
- whitelist filtering；
- base SHA divergence；
- lineage；
- warm-seed continuation；
- 不恢复 transient state。

它不阻塞基本多机 Store bootstrap 发布，也不进入本轮 `0.1.5`。默认在
`0.2.0` accepted Execution Plan identity 稳定后重新设计和实施；不得因为本节
保留了旧示例就提前发布 Change-only checkpoint。

### Phase Release：集中真实场景验收

完成所有纳入 `0.1.5` scope 的 Phase 后，生成一个 integrated release
candidate 和一份一次性验收清单。用户集中验证至少包括：

1. fresh machine / fresh `RASEN_HOME`；
2. clone Project 后发现 Store bootstrap requirement；
3. 显式 clone/register Store；
4. Store roster 正确恢复；
5. 从 Store planning space 选择准确的 Project checkout；
6. 启动真实 Agent；
7. 完成一个真实 Change Pipeline，或产生可解释、可恢复的真实失败；
8. Store/Project/global learned resolution 与承诺一致；
9. eject 不读取其他机器路径；
10. Git 中不存在本机绝对路径、凭据或 transient state。

验收发现问题时，进入同一开发 Session 或后续修复 Session 完成修复和自动化
回归，再由用户复测受影响路径。通过前不发布；通过后才将候选状态从
`integrated-candidate` 更新为 `human-scenario-accepted` 和 `releasable`。

## 27. PR 与分支纪律

### 27.1 不再重复 #65/#66 的 landing 错误

允许开发期 stacked branches，但每个功能被宣称“进入 dev”前必须：

1. PR 最终 base 是 `dev/0.1.5`，或存在一个明确的最终 integration PR；
2. predecessor 合并后 retarget/rebase；
3. GitHub 显示 merged 后运行：

```powershell
git fetch origin
git merge-base --is-ancestor <feature-commit> origin/dev/0.1.5
```

4. 结果必须为 true；
5. 当前 dev 中应存在预期文件/类型；
6. 联合测试在 dev ancestry 上运行。

### 27.2 每个阶段独立可集成，整包统一验收

每个阶段：

- legacy 仓库仍可读；
- 不要求后续阶段才能修复已写坏的数据；
- 有明确 feature boundary；
- 有 rollback/compat reader；
- 不将未完成 schema 默认写入；
- 自动化 Gate 通过后可以继续后续阶段，不等待逐阶段人工测试；
- 只有完整 `0.1.5` release candidate 通过用户集中真实场景后才可发布。

### 27.3 Integration rehearsal 不进入 release

预演分支仅用于：

- merge-tree；
- compiler；
- combined test discovery；
- 迁移代码参考。

不要从 rehearsal 分支直接开最终 release PR。

## 28. 测试策略

本节测试由开发人员/Agent 在各 Phase 内连续执行，不要求用户逐阶段介入。它们
负责尽早发现实现、兼容、迁移和安全问题，但不能替代 Phase Release 的集中真实
用户场景验收。

### 28.1 单元测试

Identity：

- metadata v1/v2；
- pointer string/object；
- UUID round-trip；
- alias 0/1/N；
- UID mismatch；
- numeric alias warning；
- credential-bearing remote rejection/redaction；
- tri-state binding。

Membership：

- projectId filename/schema；
- alias collision；
- roles；
- locator-only 不产生 authority；
- legacy references/adoption normalization；
- no sourcePath writes。

Runtime：

- planning/execution split；
- exact clone root；
- worktree；
- frozen context + Session binding；
- stale checkout；
- planning-only；
- ActionContext roots。

Learned：

- project > Store > global；
- two equivalent Stores；
- divergent Stores；
- Store alias rename；
- relevant unavailable Store；
- project logical catalog migration；
- ledger v1/v2；
- resolution digest。

### 28.2 双机 CLI fixture

目录：

```text
temp/
├── machine-a/home
├── machine-b/home
├── remotes/project.git
├── remotes/store-primary.git
├── remotes/store-secondary.git
├── machine-a/checkouts/...
└── machine-b/checkouts/...
```

场景：

1. A 创建 Store v2；
2. A 创建/注册 Project；
3. A add-project/adopt；
4. A push 两仓；
5. B 只 clone Project；
6. B `bootstrap --check`；
7. B bootstrap Store；
8. B status/list/new change；
9. B Store Session 选择 Project；
10. B learned effective set 与 A 的共享层一致；
11. B eject 不读取 A 的路径。

### 28.3 多 checkout

1. 同一 projectId 两个独立 clone；
2. 两个 linked worktrees；
3. UI exact root；
4. Session context；
5. frozen knowledge resume；
6. logical project catalog 单一；
7. materialization target 分离；
8. projectId-only selector 报歧义。

### 28.4 多 Store

1. Project primary pointer → Store A；
2. membership → Store A/B；
3. A 提供 config；
4. A/B 都提供 learned knowledge；
5. Session 从 Store B 规划、Project 执行；
6. 子进程不能退回 Store A；
7. Store B unavailable 时 degraded；
8. alias 相同、UID 不同。

### 28.5 Git 并发

1. A/B 添加不同 projectId；
2. 文件分片无冲突；
3. 同 alias 保留两条；
4. 同 projectId 修改产生正常冲突；
5. 合并后 schema validator；
6. planning 同名内容 conflict；
7. non-fast-forward 后重新 preflight。

### 28.6 安全

- clone 不经 shell；
- remote 凭据不写 metadata；
- context/bundle 拒绝不允许的绝对路径；
- checkpoint 安全测试仅在 Phase G 于 `0.2.0` 或更晚启动时执行；
- UID mismatch 不更新 registry；
- malformed YAML 零部分写入；
- symlink/reparse target 不覆盖；
- atomic temp + rename；
- planning-only 无 code root；
- `--check` 快照零变化。

### 28.7 回归

- standalone Project 无 Store；
- v1 Store pointer；
- v1 metadata；
- Store root no-transitivity；
- current config precedence；
- worktree registry self-heal；
- human/JSON parity；
- init/update workflow generation；
- global-only Hermes；
- Store commands 不自动 commit/push。

### 28.8 联合测试矩阵

PR #65/#66 和 #68 必须在同一 commit graph 上至少覆盖：

| Planning | Execution | Knowledge | 预期 |
|---|---|---|---|
| Project P | P checkout | project/global | 正常 |
| Store S | P checkout | P/S/global | 正常 |
| Store S | planning-only | Store/global read；无 project materialize | 限制明确 |
| Store S | P clone B | frozen P context | 不歧义 |
| Store S2 | P，primary=S1 | S1/S2 knowledge | context 固定 S2 |
| Store unavailable | P | prior Store source | deferred |
| fresh machine | hydrated P/S | shared Store knowledge | 可重复 |

## 29. 验收与发布 Gate

### Gate 1：Identity

- Store UID 稳定；
- alias rename 安全；
- legacy 兼容；
- unavailable 不静默；
- 无本机路径入 Git。

### Gate 2：Relationship

- planning binding 与 membership 可独立表达；
- projectId authority；
- Store/Project locator 双向可诊断；
- sourcePath 已移除。

### Gate 3：Runtime

- selected checkout 全生命周期保留；
- 子进程读取 Session context；
- ActionContext 正确；
- planning-only 限制。

### Gate 4：Learned

- PR #65/#66 实际进入 dev；
- UID-based sources；
- membership provider 统一；
- logical project catalog；
- combined tests。

### Gate 5：Bootstrap

- 空机器端到端；
- explicit mutation；
- idempotent；
- fail closed；
- Doctor 可复制修复命令。

### Gate 6：Project knowledge portability（按发布承诺）

- logical project catalog 在同机多 checkout 下唯一；
- 如果纳入 `0.1.5`：bundle 白名单；
- divergence；
- 无 transient state；
- import 不覆盖冲突数据；
- 未纳入时，CLI 和发布说明不声称 project knowledge 已跨机同步。

Portable run checkpoint 不属于本 Gate，也不属于 `0.1.5`。

### Gate 7：集中真实场景

- 完整 release candidate 已生成；
- 用户按 Phase Release 清单完成真实 Store/Project/Agent 流程；
- 真实执行目录、规划上下文、Git 边界和 learned resolution 均符合预期；
- 所有验收问题已经修复并完成受影响路径复测；
- 状态已明确记录为 `human-scenario-accepted`。

### Release 最终检查

```powershell
git status --short
git log --graph --oneline --decorate -n 40
git merge-base --is-ancestor <phase-commit> origin/dev/0.1.5
pnpm lint
pnpm build
pnpm test
git diff --check <base>...HEAD
```

还要检查：

- PR status checks；
- docs/CLI/locales；
- JSON schema/version；
- migration dry-run；
- integrated candidate 的联合测试证据；
- 用户集中真实场景验收结果；
- `0.1.5` release notes 明确说明 project knowledge portability 是否包含；
- release notes 明确说明不包含 Issue / Execution Plan 和 portable run checkpoint；
- workspace 无测试遗留；
- 未跟踪用户文件未被误提交。

## 30. 风险与回滚

### 30.1 最大风险

1. alias→UID 迁移改变 ledger/digest identity；
2. legacy Store references 无法唯一映射 projectId；
3. 同 projectId 多旧 project knowledge catalog 冲突；
4. Session context 注入与 frozen run-state precedence 冲突；
5. 两仓 membership mutation 中途失败；
6. unavailable Store 被错误当作 absent；
7. stacked PR 再次未真正进入 dev。

### 30.2 回滚原则

- reader 先于 writer；
- 新 schema 写入由 feature stage 明确控制；
- migration 保留旧数据直到新数据验证；
- 不使用 destructive Git reset；
- 不自动删除用户修改；
- registry mutation atomic；
- Store/Project Git 文件让用户自行 commit；
- 失败输出 repair plan。

### 30.3 Feature release

如果需要阶段性 feature flag：

- flag 只能控制新 writer/command surface；
- reader/diagnostic 应始终可用；
- 不允许同一数据在 flag 开关时被不同 schema 反复重写；
- 不用 feature flag 掩盖 identity mismatch。

## 31. 代码地图

| 模块 | 目标职责 |
|---|---|
| `src/core/store/foundation.ts` | metadata/registry schema v2、UID |
| `src/core/store/registry.ts` | UID primary key、alias index |
| `src/core/store/operations.ts` | setup/register/upgrade |
| `src/core/project-config.ts` | pointer v1/v2、membership locators |
| `src/core/root-selection.ts` | Store binding tri-state |
| `src/core/effective-config.ts` | config precedence、unavailable diagnostics |
| `src/core/project-registry.ts` | multi-checkout locator |
| `src/core/project-home.ts` | clone work home；不再拥有 project knowledge canonical |
| 新 `src/core/project-knowledge-home.ts` | projectId logical catalog root/migration |
| 新 `src/core/store/project-records.ts` | projectId 分片 schema/read/write |
| 新 `src/core/store/membership.ts` | unified membership provider |
| `src/core/store/migration.ts` | legacy adoption parser |
| `src/core/store/migration-ops.ts` | adopt/eject ordered plan |
| 新 `src/core/store/bootstrap.ts` | bootstrap planner/state machine |
| `src/core/relationship-health.ts` | identity/binding/membership health |
| `src/core/learned-skills/types.ts` | durable v2 refs |
| `src/core/learned-skills/context.ts` | runtime/frozen identity resolution |
| `src/core/learned-skills/stores.ts` | canonical global/store/project roots |
| `src/core/learned-skills/authority.ts` | projectId membership/promotion |
| `src/core/learned-skills/effective.ts` | PR #66 effective algorithm |
| `src/core/learned-skill-materialization.ts` | exact target reconciliation |
| `src/core/project-learned-skill-ledger.ts` | UID source ledger v2 |
| `src/core/global-learned-skill-ledger.ts` | global-only ownership |
| `src/core/management-api/session-launch-context.ts` | planning/execution selection |
| `src/core/management-api/sessions.ts` | propagate full context |
| `src/core/management-api/supervisor.ts` | context file/env |
| `src/core/management-api/session-registry.ts` | record planning/execution |
| `src/core/management-api/spaces.ts` | unified Store roster |
| `src/core/change-status-policy.ts` | ActionContext v2 |
| `src/core/artifact-graph/instruction-loader.ts` | publish capability roots |
| `src/core/pipeline-registry/run-state.ts` | frozen durable refs |
| `src/commands/store.ts` | identity/membership migration |
| 新 `src/commands/bootstrap.ts` | explicit bootstrap |
| 新 knowledge bundle 模块 | `0.1.5` 按发布承诺提供 project knowledge export/import |
| 新 checkpoint 模块 | `0.2.0` 或更晚；等待 Issue/Execution Plan identity |

## 32. 文档与用户体验

每个阶段需要同步：

- `docs/cli.md`；
- `docs/retention-and-learned-skills.md`；
- Store/bootstrap troubleshooting；
- agent contract；
- en/zh-cn/ja locales；
- CLI completion registry；
- JSON examples；
- migration guide；
- 一份由用户在完整 release candidate 上集中执行的真实场景验收清单；
- `0.1.5` 与 `0.2.0` 的明确能力边界。

用户消息必须说明：

- 当前解析的是 UID 还是 alias；
- planning Store；
- execution Project/checkout；
- 哪些数据进入 Git；
- 哪些只是本机；
- 命令是否会联网/写入；
- 下一条可复制修复命令。

## 33. 锁定决策

以下决策无需在后续 Change 中重新讨论：

1. Store 新增 UUID `storeUid`。
2. Store `id` 降级为 alias。
3. 不使用全局自增编号。
4. Project 继续使用 `projectId`。
5. Checkout root 永不进 Git。
6. `sourcePath` 从共享 schema 删除。
7. planning binding 与 membership 分离。
8. Store membership authority 使用 projectId 分片。
9. 项目侧 membership list 只是 locator。
10. Session 必须携带 exact checkout binding。
11. 配置 precedence 是 project > primary Store > global。
12. learned precedence 是 project > eligible Stores > global。
13. Project canonical knowledge 在同一机器按 projectId 唯一。
14. `~/.rasen` 不整体同步。
15. Project knowledge 跨机使用独立显式 bundle。
16. 运行态跨机未来使用显式 checkpoint，但 Phase G 不进入 `0.1.5`。
17. 普通命令不隐式 bootstrap。
18. Doctor 只读。
19. 两仓 mutation 不声称强原子。
20. PR #65/#66 适配新契约后才进入 dev。
21. Store membership 只表达 roster/eligibility，不是 Change target authority。
22. `0.2.0` 中 accepted Execution Plan 是 Change targetProject 的 authority。
23. Session checkout 是本机运行事实，不能反向决定 durable target。
24. `0.1.5` 不实现 Issue、Execution Plan、Issue acceptance 或 Issue Board。
25. 各 Phase 自动验证后连续推进，不逐阶段等待人工操作。
26. 完整 release candidate 必须通过用户集中真实场景后才能发布。

## 34. 允许具体 Change 决定的细节

以下不是架构方向，可以由对应 Change 在 proposal/design 中选择：

- Store project record 的 `roles` 精确字段名；
- membership locator 放在 `rasen/config.yaml` 的最终 key 名；
- Session context file 的最终目录名；
- ActionContext v2 是否保留一个 deprecated v1 projection；
- knowledge bundle 在 Store 中的最终路径；
- identity/membership migration 是一个命令还是多个命令；
- bootstrap 的交互 UI 文案；
- project knowledge logical home 的精确目录层级；
- feature rollout 是否需要临时 writer flag。

选择时必须满足本文的不变量，不能改变 identity、authority、路径边界和失败语义。

## 35. 下一 Session 的单一第一步

如果 Phase A 尚未完成：

1. 阅读本文件第 0～18、26、27、28 节，以及
   `rasen/work/issue-centered-automation-platform/` 的权威边界。
2. 确认当前工作属于 `0.1.5` Store / Context scope，不创建 Issue/Execution
   Plan schema。
3. 重新验证 PR ancestry。
4. 从最新 `dev/0.1.5` 创建 `feat/store-immutable-identity`。
5. 创建一个只覆盖 Phase A 的 Rasen change。
6. 先写 metadata/pointer/registry/resolver 的 proposal/spec/design，不触碰 #66。
7. 以 tri-state resolver 和兼容 reader 为第一批实现。
8. Phase A 合入 dev 并验证 ancestor 后，直接开始 Phase B，不等待逐阶段人工测试。

不得把第一步改成：

```text
merge #66 into dev
```

也不得在 Phase A 中顺手实现：

- Store learned materialization；
- bootstrap clone；
- portable checkpoint；
- 全部 membership migration。

本文的执行目标不是让每一个 PR 单独“看起来合理”，而是保证最终系统只有一套
身份模型、一套关系语义、一套 runtime context 和一条可验证的 landing 路径。
完成全部 `0.1.5` scope 后生成统一 release candidate 和人工验收清单；用户验收
通过后发布。`0.2.0` 再从单 Issue / 单 Change / 单项目的真实黄金路径开始。

---

