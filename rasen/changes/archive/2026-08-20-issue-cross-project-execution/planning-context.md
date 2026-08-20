
# Planning Context — issue-cross-project-execution（Phase 3，LEAD 种子，2026-08-20）

## 用户意图（原话）

> 继续推进后续所有slice，每个slice你来direction激活并使用auto推进！

Campaign 进行中：本片为 Phase 3/6。交付模式循 PR #168/#171（PR → CI 监控 → 绿即合并）。

## 本片目标（roadmap §5 Phase 3 最小实现）

单 Issue / **多成员项目**：
- Execution Plan 节点增加稳定的 `target project`；
- 一个 Change 只绑定一个主项目（改变目标=新修订，不静默改历史）；
- 每个项目可拥有多个 Changes；
- Agent 从每个 Change 的目标项目 cwd 启动（L6 `resolveSessionLaunchContext` 已在位）；
- 跨项目依赖可阻止下游 Change 过早运行；
- CLI 读面按成员项目分组（项目泳道/分组 + 各项目进度）；项目 chips 作筛选器属 UI 阶段。
- **初期允许人工选择目标项目**——不做自动路由（§5 明文；自动路由是 Phase 4 之后）。

## 执行环境

- worktree `.claude\worktrees\issue-layer`，分支 `feat/issue-phase3`（自 dev/0.2.0 `24d7f58e`）。
- `node bin/rasen.js`；版本纪律；`src/core/pipeline-registry/` 与 `packages/ui/**` 冻结。
- **持久 store `issue-registry` 已存在**（`Reference\rasen-issue-store`，本仓已注册为成员）——
  本片 dogfood 直接在它上面做 Issue #2（本 portfolio），并需要一个**真实的第二成员项目**
  （规划时决定：小型真实 git+rasen 仓库，或机器上已存在的合适仓库；勿用 store 自身）。

## 已有地基（勿重复建设）

- Phase 1：三轴投影（`src/core/issue-status/`）、`store issue start` 发射（L6 组合 +
  workspace-index 定位器 + 归属回流）、验收门（`src/core/issue-acceptance/`）。
- Phase 2：`--from-portfolio` plan 发布（`src/core/issue-publication/`，name→instance
  解析、archived=证据）、四态节点语义、`store setup --layout 2`、Issue #1 全环闭环先例
  （archive/2026-08-20-issue-multi-change-execution/evidence/close-summary.md 是 close 模板）。
- store 域：membership（`store add-project`）、layout-v2 每项目 planning home、
  workspace pair 索引、target-lines（line-0.2 已建）。

## Phase 2 移交的三条 findings（binding）

1. claimant-alias keying 归属未定（dated vs undated run-state 键；g-003 用机器本地镜像
   补——本片若触碰投影定位器，须决定真正归属：locator undated-fallback vs store 侧
   v2 outcome records）；
2. openFindings 字符串→对象 schema 容差（历史 run-state 被严格解析整体拒绝）；
3. seeding 仍是 operator 工具无产品面（"store seed" 形态 follow-up；两个拒绝已钉）。

## 教训链（binding，全量见 Phase 2 归档 planning-context）

validate 位置参数；CLI 三面同步（commander+三语+completions）；CLI 测试跑 dist 先 build；
scenario 标题=身份标签禁改；引擎 EOF 双坑预修剪；child 门=受影响+store 族+三面同步三件套；
全量门 child 级上提 portfolio 级（本机用户态簇 08-17 裁决）；committed-优先（store 写后
须 commit 才反映到读）；任务清单里别写 LEAD-loop 动作（引擎 tasks 门自指死锁——写进
evidence 的 close checklist）。

## Portfolio 计划（LEAD 已拍板）

| # | child | 交付 | 依赖 |
| --- | --- | --- | --- |
| g-001 | `issue-target-project-binding` | plan 节点 `target project` 字段 + membership 校验 + 一 Change 一主项目约束（发布与手写双路径）| — |
| g-002 | `issue-cross-project-gating` | 跨项目依赖边：downstream 在 upstream（他项目）terminal 前不可启动——start 拒绝 + 投影可见 | g-001 |
| g-003 | `issue-project-grouped-views` | CLI 读面按项目分组（show 泳道、list 各项目进度）+ **Issue #2 真实多项目 dogfood**（本 portfolio + 真实第二成员项目）| g-001, g-002 |

串行链。人工选择目标项目（无自动路由）。

## 决策记录

- 2026-08-20 LEAD：Phase 3 激活（work.yaml activeSlice 已切；roadmap §14.2 已回写）。
- dogfood 的第二成员项目由 planner 决定并写入提案（真实、小型、可复用）。

## Planner findings（g-001 planner，2026-08-20）

**Schema 事实（兄弟别重考）**：plan 节点自 Phase 1 起就带**必填** `projectId`
（digest 覆盖），Phase 2 的 portfolio 通道已按 committed claimant 派生它。
g-001 **不加新字段**——target project 就是 `projectId`，本次让它变成
authoritative + visible。修订字节、digest、序列化零变化（golden 钉死）。
g-002/g-003 直接读节点的 `projectId`，勿另造字段。

**g-001 交付的缝（下游直接用）**：
1. 发布门：`verifyExecutionPlanReferences`（双源共用的唯一 verifier，
   `publishPlan` 内）新增 planning-member 门——`roles.planning: true` 才可作
   目标；新码 `issue_reference_target_not_planning_member`（点名项目+roles+
   planning members+修复）。**读路径永不复查 membership**（旧修订照读，
   Phase-2 时代修订含 knowledge-only 目标也照读）；migration replay 用冻结
   member 集豁免（grandfathered）。
2. 读面：`IssueNodeStatus` 增 `projectId`/`targetLineId`（唯一投影缝加宽）；
   `show` 节点行显示 project；`list` 未动（g-003 的分组从 IssueNodeStatus 取数）。
   无新命令/option/locale key——三面同步 N/A（PR 描述里说明）。

**g-003 的硬前置（g-001 只标记不执行）**：持久 store `issue-registry` 的
rasen 成员记录是 `roles.planning: false / knowledge: true`——Issue #2 的 plan
发布前必须先 widen 成 planning member（`rasen store add-project` 重跑即
OR-widen）+ 添加第二成员。**第二成员项目已定：`rasen-site`**
（`Reference\rasen-site`；真实、小、活跃、已带 rasen/ workspace；site+core
是自然的跨项目 Issue 形态。备选 telemetry-backend 已否：体量大、运维重）。
g-001 的拒收信息会点名修复命令，撞到时照做即可。

**g-002 注意**：start binding 已按节点 projectId 组合成员项目 cwd
（L6 `resolveSessionLaunchContext`），gating 门加在 start + 投影即可；
g-001 之后新发布的 plan 不可能再含 knowledge-only 目标。

**坑（本次踩到）**：validator 要求 requirement 正文**第一行**就含 SHALL
（"must contain SHALL or MUST" 报错看首行）——ADDED 需求首句先给 SHALL。
scenario 标题一律照抄既有（身份标签）。dogfood 临时 store 的
fixture（`store-workspace-fixture.ts`）已写 `planning: true`，门不会炸主
测试群；knowledge-only 拒收测试需专设 fixture 成员。


## g-001 implementer 记录（2026-08-20，APPLY 完成时）

- **门已落地**：`verifyExecutionPlanReferences` 内 planning-member 门
  （`roles.planning: true`），新码 `issue_reference_target_not_planning_member`，
  双源（--from-file / --from-portfolio）经 `publishPlan` 一处继承；
  migration replay 用冻结 member 集（`plan.ts` 传入 planning-eligible），
  knowledge-only 成员带存量 plan 的迁移回归已钉
  （layout-migration-plan-gates「replays a store-issue plan for a knowledge-only member」）。
- **读面**：`IssueNodeStatus` 增 `projectId`/`targetLineId`（`withLifecycle`
  单点填充）；`show` 节点行格式变为 `<nodeId> <kind> <projectId> <alias> — <obs>`
  ——**兄弟测试断言节点行字符串的须按新格式**（已同步
  store-issue-status/start/lifecycle-cli 三处）。`--json` 结构性携带；`list` 未动。
  无新命令/option/locale key——三面同步 N/A（cli-presentation + command-registry 18 绿证明无漂移）。
- **降级实证（持久 store 只读 receipts，evidence/dogfood-persistent-*)**：
  `issue-multi-change-execution` 读回轴完全一致（done/healthy/3/3），节点行
  现显示 knowledge-only 成员 `e2ee72ed-…`；revision sha256 前后同为
  `477f8962…`（读零字节改动）。Phase-2 时代修订（含 knowledge-only 目标）照读。
- **g-003 硬前置确认（仍未执行，归 g-003）**：`issue-registry` 的 rasen 成员
  仍是 `planning: false / knowledge: true`——Issue #2 plan 发布前先 OR-widen
  （重跑 `rasen store add-project`）+ 添加 `rasen-site`。拒收文案会点名该命令。
- **golden 钉死**：序列化字节 + digest 双字面量
  （`store-issue-plan-canonicalization`「serializes the same node inputs…」，
  digest `7382cf19…`；既有 `d35cf8f0…`/`0961437e…` 字面量继续通过＝公式未动的独立证人）。

## Planner findings（g-002 planner，2026-08-20）

**核查结论（别重考）**：start 的依赖门 Phase 2 起就存在且**本就跨项目**
——`binding.ts` `workComplete`（=`finalized`|`run-terminal`）对每条
`dependsOn` 边生效、`unknown` fail-closed、frontier 与 `--node` 同规则；
跨项目 run-state 可见性 Phase 1 的 workspace-index locator 已解决。
g-002 只补**命名与读面**，不动门规则（behavior byte-identical）。

**g-002 交付的缝（g-003 直接用）**：
1. `IssueNodeStatus.blockedBy` 从 `string[]` 加宽为结构条目
   `{nodeId, projectId, observation}`，**显示基准从 archive-based 切到
   work-complete**（与 start 同一条规则）——g-003 的分组视图直接按
   blocker.projectId 聚合"该项目待完成的等待"。节点行格式：
   `(blockedBy y@elftia: in-flight[, not-started, no local run-state][, unknown (<diag>)])`。
2. start 拒收信息逐 blocker 名 `节点@项目 (状态)`；拒收 taxonomy/CLI
   envelope 不变（facts 在 message 里，双 form 都带）。

**两条真相并存是有意的（勿"修"）**：store query 的 `readiness`/
`readyToResolve` 保持 **archive-based**（验收语义），读面 blockedBy 是
**work-complete**（gating 语义）——一个答"都归档了吗"，一个答"启动在等
谁"。design.md D2 已写明，别在后续 slice 里把一边改成另一边。

**health 不动**：依赖等待=healthy（spec 已钉），`blocked`/`stale` 仍
reserved——g-003 的分组进度也别虚构 health 信号。

**g-003 提醒不变**：`issue-registry` 成员 widen 成 planning + 添加
`rasen-site` 仍在 g-003（Issue #2 发布前）；g-002 的临时 store dogfood
配方（双 planning member + 跨项目边）可直接复用做 Issue #2 的底稿。

**坑**：断言旧 `(blockedBy x)` 裸 id 格式的测试在 g-002 自身提交里同步
更新（同 g-001 node-line 格式纪律）；binding 消费的是投影 facts
（`status.nodes` 的 projectId/observation），不读 blockedBy——两处命名
编辑别互相踩。

## Planner findings（g-003 planner，2026-08-20 — Phase 3 收官，Phase 4 记忆）

**Phase 3 交付全景（Phase 4 直接消费的缝）**：
1. 节点 `projectId` = authoritative target（g-001：发布期 planning-member
   门 + 读面显示）；Phase 4 的 auto-decompose 生成目标绑定时**必须**过同一
   道门——membership 只赋 eligibility，永不代替路由决策（spec fence 原话）。
2. `IssueNodeBlocker {nodeId, projectId, observation}` + `issueBlockerState`
   共享词汇（g-002）——下游一律 import，勿重写状态拼写。
3. `IssueStatus.projects: IssueProjectLane[]`（g-003：`{projectId, alias,
   nodeIds, progress}`，lane 按 projectId 码点序、nodeIds 按修订规范序；
   **lane progress 与 Issue progress 共一个 completion 谓词**，work-complete
   基准）。alias 是 CLI 组合的 display 输入（`listProjectEntries` over
   storeRoot），identity 永远是 projectId；daemon/API 要不要更宽的 alias 缝
   留给 Phase 4。

**自指 portfolio issue 的模式（Issue #2 用了，Phase 4 会再用）**：change
节点要求 committed evidence，而本 change 未 ship 前不可能 committed——
**先发 intent 节点，ship 后用 revision N+1 提升为 change 节点**（0001 字节
永不动）；验收门会 fail-close 到提升为止（intent 未终态 → 拒 accept），
所以 close 不可能静默漏掉提升步。

**Issue #2 暂存状态（propose 时点）**：4.1–4.6 全部未执行——成员 widen、
`rasen-site`（projectId `6ca78b98-777f-45bc-8d9b-b84c34e1a531`，main 分支）
add、line-0.2 projects map 扩展、site 变更 `document-multi-project-issues`
（Store 站点分区 store-scoped 规划根 authoring）、Issue 创建+0001 发布、
loop receipts、staged-close 文档（release 腿+accept 步）都是 g-003 apply 的
活；**release/accept 两腿由 portfolio close 时序执行**（LEAD），不是
engine 任务。

**坑（本片新增/复现）**：validator 仍要求 requirement 正文首行含 SHALL；
scenario 标题=身份标签照抄；lane 的 nodeIds 按 nodeId 寻位（`normalizePlanNodes`
已排序），勿按位置索引；alias 读 checkout catalog 是 display-only——缺失
降级为裸 id，grouping/gating/progress 不受影响。



## g-002 implementer 记录（2026-08-20，APPLY 完成时）

- **门零改动**：`workComplete`/`isRunnable`/frontier 行为不变；g-002 只加命名与读面。
  start 拒收与 frontier "awaits" 逐 blocker 渲染 `<id>@<project> (<state>)`，两项诚实细化：
  `not-started, no local run-state`（locatedBy===null）与 `unknown (<diag>)`。refusal
  taxonomy / `refusalFix` / CLI envelope 零变化（blockers 字段仍是裸 id 身份列表，
  富命名在 message 里，双 form 都带——1.3 裁定为不改 fix 文案）。
- **投影缝**：`IssueNodeStatus.blockedBy` 加宽为 `{nodeId, projectId, observation}`
  （`IssueNodeBlocker`），基准切到 **work-complete**；`withBlockerFacts` 后处理是唯一写者
  （观察分支不再复制 query 的 archive 列表——`ObservedNode` 连 blockedBy 字段都没有）。
  状态标签词汇 `issueBlockerState(status)` 从 issue-status 导出，节点行与 start 拒收
  **共用一个定义**（一处改词两处同步）。query 自己的 `blockedBy`/`readiness` 保持
  archive-based（135 测试 store-family 全绿证明未动）。
- **渲染**：show 节点行段 = `(blockedBy y@<project>: <state>[, …])`（细化查依赖自身行）；
  `--json` 携带结构数组（raw observation，细化事实在依赖自身行的 locatedBy/diagnostic 上）。
  无新命令/option/locale key——三面同步 N/A（cli-presentation + command-registry 绿证无漂移）。
- **持久 store 实证（只读）**：`issue-multi-change-execution` 三节点 run-terminal——旧
  archive-based 列表把未归档依赖仍列为 blocker，新 work-complete 基准下这些段**消失**；
  与 g-001 after-receipts 的 diff **零 axis 行**，revision sha256 仍 `477f8962…`。
  这是"work 完成即不再是 blocker"的地面真值回执（evidence/dogfood-persistent-*）。
- **临时 store dogfood**（evidence/dogfood-temp/，脚本在 ephemera/research/，双清干净）：
  跨边 alpha-work@alpha-core ← beta-work@beta-site；三拍全断言——未观测拒收
  `beta-work@beta-site (not-started, no local run-state)`、在 B 侧 in-flight 拒收、
  B 侧 run-terminal **未归档**即发射 A 的 checkout contract（project-checkout + store
  planning root attached）。Phase-2 形状单项目串行修订照读 ready/healthy 0/2。
- **g-003 直接可用**：分组视图按 `blockedBy[].projectId` 聚合；人类行/`--json` 都已结构化。
  注意 `issueBlockerState` 是共享词汇——g-003 若给分组行配文案，import 它而非重写。
- **坑（本次踩到）**：`normalizePlanNodes` 会按 nodeId 排序节点——测试断言按位置取
  nodes[i] 时，`g-down` 可能排在 `g-up` 前面；跨形状测试一律 find(nodeId) 取行。
  另：runCLI 的 `expectRefused` 只吃 json form，human 拒收（stderr）要单独断言 exit 1。


## g-003 implementer 记录（2026-08-20，APPLY 完成时）

- **投影缝**：`IssueStatus.projects: IssueProjectLane[]`（`{projectId, alias, nodeIds,
  progress}`）由 `deriveProjectLanes` 后处理派生；lane progress 与 Issue progress 共
  `progressOver` 一条完成谓词（required change 节点 + work-complete）；lanes 驱动零轴
  （两项目与节点等价单项目修订 axes 全等的对照测试钉死）；修订读不回 → `[]`。
  alias 是 `ProjectIssueStatusInput.projectAliases` 输入（CLI 从项目 catalogs 组合，
  缺失降级裸 id）。
- **读面**：show `nodes:` 块 = 每项目一个泳道头 `project <alias|id> (<id>): x/y` +
  其下节点行（格式不变）；list 行尾追加 `[<alias|id> a/b · …]`（无 lanes 整体省略，
  append-only——既有 toContain 断言零 churn）；`--json` = `status.projects`。
  无新命令/option/locale key——三面同步 N/A（cli-presentation + completion 绿证）。
- **持久 store dogfood（Issue #2 全环）**：store 侧 5 个真实 commit（成员 widen +
  site 成员 + line map 扩展 + 两个已 ship 子项归档证据 seeding + site 变更
  authoring + Issue 创建/0001 发布）；lanes 回执 rasen 2/2 / site 0/1，跨项目 gating
  拒收回执（双 form），Issue #1 降级回执（单 lane、axes/digest 与 g-001 receipts
  一致）。**三条 engine-reality 缺口**（design 假设 vs 实际，全记录在
  evidence/dogfood-summary.md）：
  1. `add-project` 重跑**不会** OR-widen 到 planning（只有 setPrimary/已声明才 assert
     planning；g-001 拒收 fix 文案 overpromise）——经 `applyMembershipMutation` 显式
     roles 的 composing seam 解决（operations.ts:1270 注释明文准许）。
  2. store-scoped 项目 authoring 要求 `planningBinding: bound`（adoption 门）——
     site 变更按 Phase-2 seeding 纪律 authored（发布门照常真验证，未绕过）。
  3. legacy v1 archive 记录无 outcome → seeding 的归档子项靠 run-state 读 run-terminal
     （work-complete 基准如设计成立）；dated claimant 名 vs 未 dated ephemera 名的
     claimant-alias 键差用机器本地镜像补（Issue #1 先例同款，Phase-2 finding #1 维持）。
- **staged close（evidence/staged-close.md）**：0002 提升意图节点 → site 节点释放 →
  site 真实管线跑 terminal → gate-holds 回执 + `acceptance --from-file` + `accept`，
  全部由 portfolio close 时序执行（LEAD），不是引擎任务。
- **Phase 4 直接可用**：lanes 是 auto-decompose 路由决策的显示侧（membership 只赋
  eligibility 的 spec fence 原话仍然成立）；alias 缝要不要放宽到 daemon/API 留给
  Phase 4；三条缺口里的 CLI 修补（`--planning` role flag / widen fix 文案）是低垂
  的 Phase 4 候选。
