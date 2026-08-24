# Planning Context — issue-ui-convergence（Phase 7，LEAD 种子，2026-08-23）

## 用户意图（原话）

> 继续推进后续所有slice，每个slice你来direction激活并使用auto推进！

Campaign：本片为 **Phase 7/7 = campaign 最后一片**（Phase 8 平台增强维持可选池不排期）。
交付模式循 #171/#172/#173/#174/#175。

## 本片目标（roadmap §9 Phase 7 界面收敛）

四个面 + 一条完成证据线：
- **9.1 Issue Board**：一卡一 Issue；Planning/Ready/Active/Review/Done 泳道；
  phase、health、progress 分离呈现；项目 chips 作筛选；卡片只显摘要 + 最重要注意事项。
- **9.2 Issue Detail**：背景与验收；Execution Plan；按成员项目分组的 Changes；
  跨项目依赖；Run/Session/报告/交付证据；人工决策与 Needs Attention。
- **9.3 Operations**：活跃与异常 Sessions；实际 cwd；Issue/Change/Run 归属；
  resume/retry/stop；项目级执行筛选。
- **9.4 Unlinked Changes**：无 Issue 关联的历史/临时 Changes；可挂接已有 Issue；
  可创建新单 Change Issue；**不把裸 Change 静默伪装成稳定 Issue**。
- **完成证据**：界面所显示的每项状态都能追溯到 Git 制品或真实运行证据；删除/重建
  UI 缓存后仍能恢复一致视图。

§11 禁做清单（旧看板处理边界）：不把 Task 抽象直接定义成 Issue；不把成员项目 chips
固化为顶层所有权分区；不把 Session cwd 变成项目绑定真相；不为美化卡片提前承诺错误 IA。
旧板处置选项（§11）：experimental 标识/导航隐藏/只读诊断页/新 Board 可用后替换——
**替换放最后一次性做**（P6 交接预分析）。

## P7 预分析（P6 交接档「关键决策」末条，本 LEAD 采认）

Phase 7 是「收敛」非「新建」；约四成可前置（设计/IA、Unlinked Changes、Operations
收敛、Issue 只读骨架）；**派生状态显示必须走 Phase 1–6 投影器**（已全部在位：
status/attention/review/delivery 全是 CLI 侧纯派生）；旧板退休放最后。

## 执行环境

- worktree `.claude\worktrees\issue-layer`，分支 **feat/issue-phase7**（自 dev/0.2.0
  `1afa021f` = P6 close push）。
- `node bin/rasen.js`；版本纪律（绝不 bump）；`src/core/pipeline-registry/` 维持冻结；
  **`packages/ui/**` 本片解冻**（P2–P6 冻结令终止）。
- **UI 测试坑**（实测记忆）：root vitest config 排除 packages/ui——
  `pnpm exec vitest run packages/ui/test/` 会静默跑 0 测试仍报 passed；必须用
  packages/ui 自己的 vitest config 跑。
- 持久 store `issue-registry`（**五个 Issue 全 done**，attention 零项）——本片 UI 的
  真实数据源狗粮；Issue #6（本 portfolio）close 归 LEAD 收官。
- 磁盘 ~3.1GB：临时 fixture 边跑边清。

## 已有地基（勿重复建设）

- **数据侧全在位**：P1–P6 投影器（phase/health/progress/lanes/ready/attention/review/
  delivery/deferral）全是 store issue CLI 的纯派生读——UI 是这些读面的**呈现**，
  不建第二真相（§9 完成证据线 = 溯源 + 缓存可重建）。
- daemon 双 API：config-api（配置键读写 + 静态资产）与 management-api（runs/sessions/
  spaces 运营生命周期）同一 server——**Issue 读面需要新的 daemon 端点桥接 store issue
  投影**（设计关键点：端点是投影的透传，不缓存第二状态）。
- `packages/ui`（@atelierai/rasen-ui，Preact + Vite）既有：spaces/sessions/changes 页
  （worktree-aware-spaces、UI project 作用域先例在案）；canvas 组（#165/#167/#169/#170）。
- Operations 的 resume/retry/stop：management-api 已有 sessions 生命周期端点（P0
  session 执行层），UI 侧接线为主。

## Portfolio 计划（LEAD 已拍板，串行链）

| # | child | 交付 | 依赖 |
| --- | --- | --- | --- |
| g-001 | `issue-read-surface` | daemon 端点桥接 store issue 投影（list/show/attention/review 透传、零第二状态）+ Issue Board 只读骨架（泳道/卡片/chips 筛选）+ Issue Detail 只读骨架（9.2 各段），真 store 狗粮 | — |
| g-002 | `issue-operations-and-unlinked` | Operations 收敛（sessions/cwd/归属/resume-retry-stop 接线 + 项目级筛选）+ Unlinked Changes 面（挂接已有 Issue / 创建单 Change Issue，不伪装） | g-001 |
| g-003 | `issue-board-cutover` | 交互补全 + 旧板处置（§11 选项落地，一次性）+ 完成证据线（溯源 + 缓存重建一致收据）+ Issue #6 全环狗粮 | g-001, g-002 |

close 动作只进 evidence（LEAD 四步归收官，任务清单禁写——P4 g-003 自指死锁教训）。

## 决策记录

- 2026-08-23 LEAD：Phase 7 激活（§14.6 已回写；work.yaml activeSlice 已切
  phase-7-ui-convergence）；P6 收官全绿（PR #175、Issue #5 done、五 Issue 全 done）。

## Planner findings

### 2026-08-23 — g-001 `issue-read-surface` propose（完成）

**两个改基线的侦察事实**：① daemon flat Store-aggregate 族已有 raw 读端点
（`/api/v1/stores/issues|issue|issue-references|execution-plan`，`?space=store:<uid>`
寻址，wire 类型 = core 类型 alias 的 unwrapped passthrough 成文纪律，stores.ts 有
run()/statusForIssueCode 统一错误映射）——缺的只是投影层；另有 stores-routes.ts
0.1.7-port 参数化族（手抄 Wire* + 粗错误映射）**弃用不扩展不动**。② packages/ui 已有
两个 Issue-aware 孤儿组件（StoreIssuesView/StoreAggregateBoard，零路由可达、先于投影
层）——g-001 不复用不处置（归 g-003 一次性），新页面全新建。实测 UI 无 Zustand（旧注
有误），页面模式 = fetch-on-mount + refreshNonce，无缓存层。

**端点形状**（3 条 GET，flat 族，space 必填）：issue-projections（=CLI list --json
同体）/ issue-projection（=show --json 同体：issue/plan/status/delivery/review/
complete/unsearchedRefs/problems）/ issue-attention（=attention --json 同体，含
narrowing；未知 id→404 issue_attention_unknown_issue，须补 mapThrown 否则落 500）。
命名取 projection 避开既有 issue-state(POST) 混淆；**review 不设第四端点**——与 CLI
同道作为 detail body 的 review 键（同一 status 同一派生，无第二组合路径）。

**零第二状态落点（D1）**：抽 core 组合模块 `src/core/issue-read/`（composition.ts +
run-context.ts），把 CLI 内联组装（store-issue.ts:1300-1345 show/list、store.ts
attention 扫描环）连同已导出缝下沉；CLI 与 daemon 调同一函数——**parity 由构造保证**。
CLI --json 字节不变（字面量键序保持，既有 CLI 套件当重构守卫）。cwd 耦合收口：
resolveRunStateContext(startPath)，CLI 传 cwd、daemon 传 launchProjectRoot，解不出即
runStateVisibility:'none' 诚实降级且 UI 必须披露。

**IA**：路由 /s/:storeId/issues（Board）+ /s/:storeId/issues/:issueId（Detail），
store 空间专属无 /p/ 对；不进 SWITCHABLE_SECTIONS（空间切换回落 board 是文档化安全
行为，g-003 再议）。Board = 5 固定 phase 泳道（闭词汇 verbatim）+ 卡片（标题/health
徽章/progress 对/attention 首条 fail-first）+ **不完整性通告条**（problems/
complete:false/unsearchedRefs/divergence/visibility-none 全可见不吞）+ 复用
MemberChips 纯过滤不持久化。Detail 七段对应 §9.2；UI「仅呈现映射」红线成文（闭词汇
→label 字面查表，不派生 phase/health/progress/determination）。§11 四禁结构性满足。

**Delta**：零 MODIFIED。① management-http-api ADDED 两 requirement（投影路径 + 每请求
新鲜派生/双通道诚实：refusal=错误信封带 store 自有码、unreadable=200 载 problems 互不
转换；mutation-between-reads 无失效步骤钉零缓存）；② 新 capability issue-board-ui
ADDED 六 requirement（五泳道/不完整性显影/chips 纯过滤/Detail 全读面/零第二状态/store
空间可达）。核心派生 specs 零改动（纯消费）。

**狗粮**：CI 全 temp fixture（superseded 修订钉 delta 输入 + unreadable-plan 钉
problems 通道）；issue-registry 只读取证 CLI --json ↔ HTTP deep-equal 收据 + Board
实渲五张 Done 卡零 attention；真 payload 蒸馏为 satisfies UI fixture（truthful
crossing）。

**改动面**：core issue-read 新模块 3 文件；store-issue.ts/store.ts 接线；stores.ts
+3 handler+mapThrown；router.ts +3；wire-types.ts +3 alias；ui types.ts 镜像（同步
wire-mirror floor list）+client 3 方法+3 组件+app/Layout+三语 i18n；测试
test/core/management-api/issue-projection.test.ts（补 vitest 慢测权重表）+ packages/ui
两组件测试（**必须 `pnpm --filter @atelierai/rasen-ui test`**，root config 静默 0 测试
陷阱已入 tasks）。22 tasks，validate 绿一次过。

**风险**：CLI 抽取回归（既有套件字节钉 + wire parity witness 双保险）；wire 镜像量大
（机械，drift 测试守）；daemon launch-root ≠ 操作者 cwd（诚实降级+披露+真店收据显影）；
两套 Issue UI 短暂并存（接受，g-003 处置）；zh-cn.json 多字节 Write 损坏（小跨度
Edit + U+FFFD 检查纪律入 tasks）。

### 2026-08-24 — g-002 `issue-operations-and-unlinked` propose（完成）

**Operations 复用边界**：现有 reconciler Run 详情/控制已经给出 `allowedControls`、
`recordVersion` 与 409 后重读的完整并发契约；g-002 不建新生命周期。Store Operations
按 Store 当前项目 roster 扇出既有 `sessions`/`runs` 读，每个 Run 保留产生它的精确
`project:<root>` selector 供详情/控制复用；cwd 只显示为实际进程 locator，项目归属只读
冻结 `execution.projectId`。retry = retryable infrastructure wait 的既有 resume，stop =
既有 confirm-first Run cancel / Session kill。新页固定为 Store-only
`/s/:storeId/operations`；项目侧继续由 Task detail 承担。

**Unlinked 真值与写安全**：新增一个 flat Store GET
`/api/v1/stores/change-issue-links`，在 `src/core/issue-read/` 一次扫描 grouped active/archive
Changes + 每个 Issue 的最新可读 plan；闭结果为 linked/unlinked/unknown，只有单一稳定
instance、零 link、全证据完整才是 attachable，缺 instance/重复 claimant/不可读 plan 或 ref
一律 unknown，零缓存零索引。attach/create 继续只用五种既有 Issue mutation；plan POST
新增可选 `expectedRevisionId`（absent=兼容旧行为、null=须无 plan、string=须是当前 latest），
在既有 Issue lock 内 compare-and-publish，陈旧写 409 且零字节。create record 成功而首 plan
失败不伪装原子：保留 Issue、明确 Change 仍 unlinked、提供 attach recovery，绝不静默删除。

**g-003 固定接缝**：第二个 Store-only 路由为
`/s/:storeId/unlinked-changes`；两个新路由都不进 `SWITCHABLE_SECTIONS`，避免 Store→project
制造死链。g-002 明确保留旧 Board、`StoreIssuesView`、`StoreAggregateBoard`、
`RunningSessionsMenu`，由 g-003 一次性处置/重排；g-003 可把上述两路由、bulk link payload
与 g-001 Issue routes 当稳定输入，不再改写 Operations/Unlinked 的数据真值。

### 2026-08-24 — g-002 实现固定接缝与 g-003 cutover 清单

g-002 已把以下接缝实现并测试，g-003 可直接消费，不应重新发明数据真值或项目级副本：

- Store-only 路由：`/s/:storeId/operations` 与 `/s/:storeId/unlinked-changes`。两者有
  Store-only 导航和路径前缀 `aria-current`，无 `/p/` 对，也不进入
  `SWITCHABLE_SECTIONS`；Store→project 仍按既有 Board fallback。
- flat Store 端点：`GET /api/v1/stores/change-issue-links?space=store:<id-or-uid>`。
  unwrapped payload 为 `{entries,unsearchedRefs,problems,complete}`；每个 active/archive
  occurrence 携带闭合的 `linked|unlinked|unknown` association、五值 eligibility 与已证明的
  Issue/revision/node links。只有单一稳定 instance、零 link、完整扫描才是 attachable；该读
  每请求重算，不持有 cache、index 或持久反向 link。
- attach/create 写面继续组合既有 Issue create + complete-plan publication；plan POST 的
  `expectedRevisionId` 支持 omitted/null/canonical revision，并在 Issue lock 内 compare-and-
  publish。冲突为 409 `execution_plan_revision_conflict` 且零修订写入；partial create 保留已
  创建 Issue 并提供明确 attach recovery。

g-003 的一次性 orphan/cutover 清单是：旧 Board、`StoreIssuesView`、
`StoreAggregateBoard`、`RunningSessionsMenu`。本 child 只保留并回归它们，未删除或改作新
真值。现有 Task Detail **不是 orphan**：它继续是 project-scoped operations surface；g-003
处置旧导航时必须保留其 Run detail/control 可达性，且不得新增 project-wide Operations 路由。

### 2026-08-24 — g-003 `issue-board-cutover` propose（完成）

**§11 处置与路由矩阵已锁定**：选择“新 Issue Board 可用后替换”。Project 继续以
`/p/:projectId/board` + `/p/:projectId/task/:changeName` 承担 Change/Task 与 Run
detail/control；Store 的 canonical home 改为 `/s/:storeId/issues`，旧 Store `/board`
replace-redirect 到 Issues、旧 Store `/task/:changeName` replace-redirect 到 Operations。
Store-only 三路由仅 Store→Store 切换时保留，Store→project 回落 project Board，绝不加入
`SWITCHABLE_SECTIONS` 或创建 `/p/` 镜像。

**同步所有权与溯源线**：g-001 Board/Detail 采用 full Store selector（Detail 再加 issue id）
keyed 的 stateful child，作为 `preact-iso` 参数切换的同步边界；cancelled effect 只作纵深防御。
溯源不新增 endpoint/cache/index：在 Detail 内从同一 projection/attention payload 即时渲染
Git/runtime provenance map，Board/Detail 状态链接到稳定 anchor，路径/hash/ref/Session 等字段
逐字展示，缺失/不可读也有 diagnostic target。浏览器清 cache/storage 后以 fresh reads 重建并
比较 normalized DOM digest。

**一次性删除清单**：`RunningSessionsMenu`（现为有效 header 重复面）从 Layout 与专属
test/style/locale 移除；无生产 route/import 的 `StoreIssuesView`、`StoreAggregateBoard` 连同
专属资产删除；`BoardPage` 只保留 project 分支。raw Store API/type 不是因组件删除就自动删除，
须按 consumer/public-contract reference sweep 决定保留。32 tasks，四个 delta capability，
validate 绿。
