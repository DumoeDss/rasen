
# Planning Context — issue-layer-phase1（LEAD 种子，2026-08-17）

## 用户意图（原话）

> auto-decompose 都是用small-feature进行推进吧，创建worktree和开发分支。另一个session在处理ir-compiler的开发，如果有需要的可以在需要的地方检查对方是否完成

上层任务：启动 0.3.0 Issue 层第一条竖切（父级 direction
`rasen/work/issue-centered-automation-platform`，roadmap §12 黄金路径）。

## 执行环境（所有 worker 必读）

- 本 portfolio 全部工作在 worktree
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer`，
  分支 `feat/issue-layer`（自 dev/0.2.0 `2fc92079` 切出）。**所有命令以该目录为 cwd。**
- 一律用 `node bin/rasen.js`（worktree 内），不要用全局 `rasen`（那是 0.1.7 dev-local，与本仓 0.2.0 有版本差）。
- 主 checkout 与另一会话的 worktree 并行工作，**绝不触碰它们的目录**。
- 版本纪律：**不 bump 任何版本号**（package.json / UI 包均不动）。

## 已确认的地基（勿重复建设，先读再用）

- `src/core/store/issues/` — StoreIssues 模块：create / setState / publishPlan / list / show；
  Execution Plan 修订不可变、序数寻址、防覆盖防跳号（spec `store-issue-resources`）。
- `src/core/store/planning-layout-v2/` + layout-migration — 每成员项目独立 planning home。
- coordinator-bridge（issues compiler）— 跨项目 coordinator → Store Issue 端到端已有测试。
- store-session-execution-context — `resolveSessionLaunchContext`：Agent 从成员项目 cwd 启动、
  Store 根只作附加上下文（spec `store-planning-worktree-bindings`）。
- `DISPATCH_ADAPTERS` registry；management-api 已有 Store route family 接缝。
- 相关 specs：`store-issue-resources`、`store-planning-layout-v2`、`store-planning-worktree-bindings`、
  `planning-space-addressing`。

## 路线约束（来自 direction，违反即返工）

- 黄金路径：**单 Issue / 单项目 / 单 Change** 竖切；CLI-first（§1.2），不做 UI 大面。
- Issue 状态三轴：`phase: Planning|Ready|Active|Review|Done` ×
  `health: Healthy|Blocked|Failed|Waiting Human|Stale` × `progress: 完成必需节点数/总数`
  （goal.md §7）。失败/阻塞是 health，不是 phase。
- **Done ≠ "所有 Change archived"**；Issue 完成属于显式验收（Phase 6 的种子）。
- 每片必须真实 dogfood：建议把本 portfolio 自身登记为第一个真实 Store Issue
  （meta-dogfood：issue-layer-phase1 的三个 child 就是它的 Execution Plan 节点）。
- 一次只提高一个复杂度维度：不做 auto-decompose 上移、不做跨项目、不做看板 UI。
- 防 Harness 红线：文件/schema/API/测试存在不是完成证据；真实运行证据才算。

## 协调：ir-compiler 并行会话

- 位置 `.claude/worktrees/canvas-ir-compiler`，分支 `feat/canvas-gesture-ir-compiler`（基线 `74568906`）。
- 其触面：`packages/ui/src/canvas/*`、`packages/ui/src/canvas/draft.ts`、`pipelines-ui` spec、
  冻结的 `src/core/pipeline-registry/`（该目录禁改）。
- 本 portfolio 预期零交集；**若某 child 的提案需要触碰上述区域，先检查对方 worktree
  是否已推进/完成**（看其 `git -C <该worktree> status/log`），再决定等待、绕开或报 LEAD。

## Portfolio 计划（LEAD 已拍板，2026-08-17）

| # | child | 交付 | 依赖 |
| --- | --- | --- | --- |
| g-001 | `issue-status-projection` | Issue 三轴状态投影器（从真实 change run-state + plan 修订推导）+ CLI 状态面（如 `rasen issue list/show` 的状态列/详情） | — |
| g-002 | `issue-execution-binding` | 从 Issue plan 绑定启动 child change 的 pipeline（成员项目 cwd + Store 附加上下文）+ Run/Session/验证结果归属回流到 Issue | g-001 |
| g-003 | `issue-acceptance-close` | Issue 验收 checklist/gate + 显式 accept/close 动作；Done 推导规则（不再由 archived 推导） | g-001, g-002 |

串行执行（三者触面同源于 `src/core/store/issues/` 与 issue CLI 面，无正向独立证明，
按「宁可串行」纪律）。每个 child 走 `small-feature`：propose → apply → verify →
review-loop → ship（local）→ archive 由 parent 统一收口后处理。

## 决策记录

- 2026-08-17 操作者：ECP-7 尾段与 ECP-8 延后，Issue 层即刻启动（父级 roadmap §14 已登记）。
- 2026-08-17 LEAD：分支名用 `feat/issue-layer`（不占用 dev/0.3.0 命名，版本号归操作者管）。

## Planner findings

（g-001 planner 2026-08-17 propose 后追加；供 g-002/g-003 继承，勿重复勘探。）

1. **状态投影模块缝已定为 `src/core/issue-status/`（g-001 交付）**。两条边界理由：run-state
   是机器本地 ephemera，塞进 `store-aggregate-query` 会违反其 "answers come from Store
   content" 契约；`src/core/store/*` 至今零 import pipeline-registry，投影模块独立于
   store/ 之下才能复用 run-state readers 而不开辟新的依赖方向。g-002 的 Run/Session
   归属回流应 import/扩展此模块，不要再开第三处。
2. **run-state 定位配方 = `pipeline resume` 的原样复用**：`ephemeraDir(executionRoot, name)`
   → `resolveChangeWorkDir(…, {ensure:false})` → planning change dir 三段 sticky-legacy 链，
   用 `resolveRunStateLocation` / `resolvePortfolioStateLocation` 走链；portfolio-run.json
   存在时对该 change 的推进度权威（与 resume 同规则）。g-001 的 locator 按 committed
   claimant alias 键入当前 execution root；跨项目/多 worktree 定位须走 workspace index 的
   execution 侧（query 目前只暴露 planning.root，扩它属于 g-002）。
3. **health 语义锚点（写进了 g-001 spec/design，引用出处）**：stage `escalated` = 停给
   人决策（playbook Step H.6）→ `waiting-human`；portfolio child/delivery `escalated` =
   失败升级（Step D.5/D.7）→ `failed`；phase=review ⇒ `waiting-human`（goal.md §7 示例）。
   `blocked`/`stale` 为保留值：今天没有任何 durable 信号，g-002+ 录得真实信号后才准派生。
   `done` 仅认 operator `resolved`，g-003 的验收 gate 落地后替换该规则。
4. **dogfood 现状（g-001 设计 D10 的实证基础）**：本仓没有 layout-v2 store——`rasen-store`
   是 legacy layout、内容停在 7月25、带未提交修改；**不要**在 portfolio 中途 migrate 它。
   全局 workspace index 只有 elftia store 的条目，本仓 changes 零条目 ⇒ 当前 execution
   root 是今天唯一真实的 run-state locator。fresh store 声明 layout v2 只能经
   `store migrate-layout` 或显式写 `layoutVersion: 2`（fixtures/layout-migration 同款一行）；
   `new change --store` 走 resolver 的 store-project 模式、自带 v2 identity 落
   `projects/<projectId>/changes/<alias>`。
5. **活的 dogfood 素材**：本 worktree `.rasen/changes/{issue-layer-phase1,
   issue-status-projection,issue-execution-binding,issue-acceptance-close}/ephemera/` 里
   全是真实 run-state（portfolio 三 child 串行 g-001..g-003，child1 small-feature
   propose in_progress）。portfolio children 以 change name 为键、`node: g-00N` 关联——
   与 Issue plan 节点同名对齐，meta-dogfood 天然成立。
6. **冻结面提醒**：g-001 只 import 不改 `src/core/pipeline-registry/`。若 g-002 的绑定/
   回流需要 run-state 新字段或新 writer，那是 STOP-and-report 项，先报 LEAD 协调，
   不要在本 session 动该目录。

（g-002 planner 2026-08-17 propose 后追加；供 g-003 继承。）

7. **绑定缝定为 `src/core/issue-execution/`（g-002 交付），回流扩展现有 issue-status 缝**。
   L6 `resolveSessionLaunchContext`（management-api/session-launch-context.ts）输入是通用
   selector（`{space, execution:'project:<id>'}`），CLI 直调即 daemon 同款组合，不用重建。
   `start` = resolve+verify+emit，绝不 spawn：`agent dispatch` 只认 leaf/consultable-leaf/
   evaluate 契约，hosted-session 是 daemon 面，均出栏。g-003 的 accept/close 是真变更
   （setState 路径），纪律不同。
8. **frontier/完成判定用 observation 不用 query 的 `blockedBy`**：`blockedBy` 是
   archive-based（run-terminal 未归档的依赖仍显示 blocked）。g-002 spec 已定
   "dependencies' work is complete" = dependsOn 节点 observation ∈ {finalized, run-terminal}。
   g-003 的 Done 资格推导复用同一规则；其验收 gate 替换 `resolved`→done 规则时，须
   MODIFIED `issue-status-projection::Phase derives…` 需求（届时从 C2 合并后的最新 spec
   文本复制，C2 已先 MODIFIED 过 visibility 需求——delta 叠加要看当下真相）。
9. **workspace pair index 就是 instance→execution-root 的机器本地映射**（entry.execution.root；
   执行侧协会文件 `<executionRoot>/.rasen/planning-binding.json`）。唯一合法 writer 是
   `store workspace plan --existing-change` + `apply`；g-002 不加新 writer，g-003 同样不需要。
   本 worktree 已注册为机器 project `issue-layer`（root 即本 worktree）——L6 checkout 路线
   对 dogfood 是活的。
10. **g-002 dogfood 新增 pair 阶段**（设计 D9）：`--execution-worktree` 复用本 worktree 使
    index 的 execution root 指向真实活跑的 run-state（从 store root 读 issue 即见
    in-flight）；两份 receipt：pre-index 的 fresh-launch contract（cwd=本 worktree）+
    post-index 的 attribution/already-running 转变。复用被拒时的两条 fallback 已写进 D9。
    C3 dogfood 直接按 D9 的 Phase A 重建即可（含 C1 陷阱清单）。
11. **`blocked`/`stale` 在 g-002 依旧保留**（未录任何新信号，不fabricate）。g-003 若需要
    "等待验收"信号，review⇒waiting-human 已覆盖，无需新派生。

（g-003 planner 2026-08-17 propose 后追加；portfolio 最后一个 child。）

12. **验收模型定形（g-003 交付）**：两份制品——条件修订 `acceptance/000N.yaml`（复用 plans
    的 ordinal+digest+防覆盖纪律，≥1 条 `{id, requirement, verification?}`，全程
    portable-text）+ 单份 `accepted.yaml`（冻结条件修订 id+digest、gate 快照〔仅计数与
    health，零路径〕、note、自身 digest）。"至多一次 accept"由既有终态生命周期保证
    （resolved/dropped 终态、无 re-open），不是新规则。accept 状态矩阵：open+gate 过→
    写记录+转 resolved；legacy resolved 无记录+gate 过→**只写记录不再转状态**（升级路径）；
    resolved 有记录→拒；dropped→拒。
13. **拓扑守则**：gate+编排在新 `src/core/issue-acceptance/`（C2 组合模式）。关键约束：
    `store/issues` 绝不能 import issue-status——query/issues-read 已 import issues 的
    parsers，那条边会闭出包级环。mutation 只收已求值的可移植快照，锁内零 run-state 读
    （store 纯度）；evaluate-fresh-then-lock 的 TOCTOU 边界靠快照自身标注，不遮掩。
14. **Done 终规则**：`resolved` ∧ 验证过的 acceptance 记录 → done；仅 resolved（含历史
    close）→ review/waiting-human（spec 跟踪的行为变更，C1 的 done 断言测试随之改约）。
    C3 的 delta 面四处：issue-status-projection MODIFIED×2（四输入 + phase 规则）、
    store-issue-resources **RENAMED+MODIFIED**（三→五 mutation；rename 格式按 2025-08-19
    archive 先例 FROM/TO+新头全文）、store-planning-layout-v2 MODIFIED（三个新 address
    kind：conditions 目录/单修订文件/accepted 记录）。
15. **g-003 dogfood 增量**：store 建好先 master→main 再 publish（C2 教训并入）；CLOSE
    receipt 用"归档实例的 plan 修订 2"制造全 finalized 证据（committed evidence 诚实基质，
    与 C1 播种同类）；failed-health 的 HOLD 用标注过的 unit fixture 覆盖（本 portfolio 无
    真失败可开票，伪造即剧场）。dogfood 不需要 start/L6 路线；若临时要执行 worktree，
    一律全新 temp（worktree-share 规则穿透主 checkout，C2 实现 finding 1）。

## Implementer durable findings (C1 → C2/C3, relayed 2026-08-17)

C1 的实现者已退役，权威文档：`rasen/changes/issue-status-projection/handoff/implementer-1.md`。
C2/C3 的 planner 提案前必读。要点（详见原文）：

1. 投影缝只有一条：`src/core/issue-status/` 的 `projectIssueStatus(ProjectIssueStatusInput)`
   （显式路径输入、可注入 `workDirFor`）——C2/C3 import/扩展它，不开第三条状态缝。
2. 节点内观察优先级偏离 D4 视觉行序是**故意的**（escalation 信号压过 activity），已在
   `projection.ts` 注释成文。
3. run-state 定位走 `stateFileSearchChain` + detailed readers（非 resolve* 直调——那会
   ambient read）；同一冻结顺序权威。
4. 查询优先 **committed** 副本：Issue 记录状态变更需 store commit 后才反映到读——
   未来任何 dogfood 步骤都要算上这一点。
5. 轴只在**节点级**边界移动（child terminal → progress；escalated → health；全部 terminal
   → review；`resolved` → done，g-003 将替换该规则）；`blocked`/`stale` 为保留值，等 g-002+
   的真实信号。
6. 死路速查：dogfood store 不能放 `<worktree>/.rasen/` 内（store setup 拒绝嵌套 git repo，
   用 OS temp）；`migrate-layout` 对空 store 不写声明（手写 `layoutVersion: 2`）；
   membership-only 项目的 store-scoped `new change` 会被拒（C2 dogfood 复用 receipt 教训）；
   `add-project` 会写 `rasen/config.yaml` + 残留 `.rasen-store/store.yaml` 两处（记得双清）；
   `validate <name>` 是位置参数形式（`--change` 无效）。

## Implementer durable findings (C2 → C3, relayed 2026-08-17)

C2 实现者交付，详文见其 DONE 与 `rasen/changes/issue-execution-binding/evidence/dogfood-receipt-summary.md`：

1. **worktree-share 规则会穿透**：项目注册表把 linked worktree 归并到主 checkout——注册
   worktree 会替换主 checkout 的真实身份（e2ee72ed）而非新铸。C3 dogfood 应规划全新临时
   执行 worktree，并预期 L6 checkout 路线回答主 checkout。
2. **`store setup` 初始分支是 `master`**：target line 声明 `refs/heads/main` 后每次
   `store issue plan` publish 都 `store_query_ref_unreadable`——publish 前先把 store 分支
   rename 成 main（C1 陷阱清单 +1）。
3. **加 CLI 子命令要三面同步**：commander 树 + locale（en/ja/zh-cn）+ completions 的
   COMMAND_REGISTRY——否则 applyCliPresentation 启动即 'visible subcommand count differs'；
   且 CLI 测试跑 dist/，stale dist 会把这伪装成代码 bug。

## Implementer durable findings (C3 → future portfolios, 2026-08-17)

C3 实现者交付（issue-acceptance-close）。详文见其 DONE 与
`rasen/changes/issue-acceptance-close/evidence/dogfood-receipt-summary.md`：

1. **投影→闸门的唯一 runtime 边必须走直连文件**：`issue-status/projection.ts`
   import 的是 `../issue-acceptance/gate.js`（不是 barrel）。走 barrel 会闭出
   runtime 环（issue-acceptance/index → orchestration → issue-status/index →
   projection → issue-acceptance/index）。gate.ts 保持零 runtime 回边；类型层
   双向 import 无害（擦除）。
2. **accept 快照的 health 是求值时刻的投影值**：全终节点的 open Issue 读
   review/waiting-human，D3 明言 waiting-human 不阻塞闸门（那个 human 就是
   接受者）——所以记录里冻结的快照常是 `waiting-human` 而非 `healthy`。断言
   `healthy` 快照的测试会假红。
3. **JSON 模式的拒绝码在 stdout payload（`status[0].code`）不在 stderr**——CLI
   测试需要 expectJsonRefused 一类 helper；human 模式才是 stderr 的 Error:/Fix:。
4. **`git status --porcelain` 会把未跟踪目录折叠成目录行**——按文件断言要
   `-uall`。
5. **C1 时期的 live auto-run.json 把 openFindings 记成字符串**，当前 reader 期
   待对象 → 本 worktree 里 `issue-status-projection` 的 ephemera 读作
   invalid-run-state problem（observation unknown）。未来 dogfood 读到它属正常
   诚实输出，不是本次缺陷。
6. **locale JSON 是 CRLF + 深嵌套**；插入用文本锚点 + 插入后 JSON.parse 验证 +
   U+FFFD 扫描三保险（multibyte 写入纪律）零损坏通过。
7. **`store setup` 只写 metadata `version: 2`，不写 `layoutVersion`**——layout
   声明仍须手写（C1 陷阱依旧成立）；且 store repo 直接在 `--path` 给的目录，
   不再是 `<path>\store` 子目录。
8. **accept 后断言 done 前必须 commit dogfood store**：query 的 committed-copy
   偏好让未提交的 resolved 记录仍读 open（C1 发现，在 accept 流程里再次承重）。
9. **给 list/show 加每-Issue 读取的代价要算进 CLI 测试预算**：C3 让 show/list
   每命令多做一次 acceptance 读取后，C2 的 status-cli parity 测试逼近 30s 默认
   预算（solo ~27s），并发即超时。新 spawn-heavy 文件要进
   `vitest.config.ts` 的 `KNOWN_SLOW_TEST_WEIGHTS_MS`（按 solo 实测，宁高勿低），
   逼近预算的既有测试在代价合法增长时提 budget（60-90s），别靠拆场景 weakening。

## 协调更新：canvas-ir-compiler 已并入 dev/0.2.0（2026-08-17，操作者通报）

- 并行会话的 canvas-gesture-ir-compiler portfolio 已以 PR #167 全量交付并归档
  （origin/dev/0.2.0 tip `fb243e83`，含 6-child 归档与 specs 同步）。
- 本 portfolio 分支 `feat/issue-layer` 基点 `2fc92079`；经
  `git diff --name-only 2fc92079..origin/dev/0.2.0`（177 文件）与本分支全部触面
  （69 文件）求交：**零重叠**——locale、architecture-index、archive 目录、specs
  目录均无冲突面。
- 交付含义：parent 层统一交付前须先与 `origin/dev/0.2.0`（fb243e83+）合流
  （rebase 或 merge 均为干净面）；「先检查对方是否完成」的协调义务就此解除。
