
# Planning Context — issue-autodecompose-uplift（Phase 4，LEAD 种子，2026-08-21）

## 用户意图（原话）

> 继续推进后续所有slice，每个slice你来direction激活并使用auto推进！

Campaign：本片为 Phase 4/6（大件）。交付模式循 #168/#171/#172。

## 本片目标（roadmap §7 Phase 4 最小实现）

**auto-decompose 上移**：用户提交 Issue 后，系统给出一份**可审查的执行计划**——
带 target project 的 Change 分解 + 依赖边 + required/optional + 建议 pipeline +
分解理由/不确定性。用户可：接受计划 / 修改目标项目 / 调整依赖 / 合并或继续拆分 /
标记 required-optional / 确认后启动执行。**自动分解是一次可修订的 Dispatch**，
不是持续由 LLM 决定每一个运行步骤；计划确认后由确定性 Pipeline 与依赖规则推进。

现状：`auto-decompose` 是 7 个内置 pipeline 中唯一 fail-closed 的
（`execution_profile_unavailable`，0.2.0 刻意留给 0.3.0 的边界）。

## 执行环境

- worktree `.claude\worktrees\issue-layer`，分支 `feat/issue-phase4`（自 dev/0.2.0 `40551f92`）。
- `node bin/rasen.js`；版本纪律；`src/core/pipeline-registry/` 本片**解冻但要慎改**
  （auto-decompose 的执行 profile 是本片主战场之一——改前先读 `architecture-index`
  的 pipeline-registry 模块说明）；`packages/ui/**` 仍冻结。
- 持久 store `issue-registry` 在位（Issue #1 done、Issue #2 done·4/4）。

## 已有地基（勿重复建设）

- Phase 1-3 全链：投影/验收/执行绑定/plan 发布/四态节点/target-project 绑定/
  跨项目门/项目泳道。**Execution Plan 修订 + publishPlan + --from-portfolio 通道
  就是"可审查执行图"的载体**——本片是把 auto-decompose 的 OUTPUT 接到它上面。
- C2 workspace pair 机器（默认路线可用；`--planning-worktree` 短根参数应对 MAX_PATH）。
- 教训链全量见 Phase 2/3 归档 planning-context（binding）。

## Phase 4 候选清单（accumulated，本片消化）

1. **等式缝（g-001）**：`isContainedIn` 把 equality 当 inside ↔ side-planner 祝福
   main-checkout 执行——真矛盾（receipts: Phase 3 close-workspace-pair-refusal.json）。
   降级为应修（默认路线已可绕）；真实验收 = 此前被拒的 pair plan 变 applicable。
2. membership hint 翻转宿主规划根解析（legacy-flat 宿主无法归档——hint 撤回可解）。
3. add-project 拒绝文案过诺（不 OR-widen）+ `--planning` 旗标候选。
4. partial store planning 缺口（`planningBinding: bound` 采纳门）。
5. claimant-alias keying 归属（镜像已三份）。
6. MAX_PATH：pair 默认目的地对深分区树 store 不可用（文档/默认值改进）。

2–6 为顺手项：能塞进相关 child 就塞，塞不进就记 follow-up，不撑大本片。

## Portfolio 计划（LEAD 已拍板）

| # | child | 交付 | 依赖 |
| --- | --- | --- | --- |
| g-001 | `issue-workspace-containment-fix` | 等式缝修复（equality ≠ inside 当 side-planner 祝福 main-checkout 执行）；验收=被拒 plan 转 applicable + 原有拒绝面（真嵌套）不回退 | — |
| g-002 | `issue-autodecompose-graph` | 主件 A：auto-decompose 的执行 profile 启用 + 分解输出落为**带 target-project 的 Execution Plan 修订**（复用 publishPlan 通道；含分解理由/不确定性字段） | g-001 |
| g-003 | `issue-autodecompose-review-flow` | 主件 B：人工审查/修订流（接受/改项目/调依赖/required-optional/确认启动——落在 plan 修订纪律上，修订=新修订不改历史） | g-002 |

串行链。dogfood 用持久 store 上的**真实 Issue #3**（本 portfolio 自身）走完整
decompose → 审查修订 → 启动路径。

## 决策记录

- 2026-08-21 LEAD：Phase 4 激活；pipeline-registry 对本片解冻（谨慎、逐点说明）。
- close 动作只进 evidence，不进任务清单（自指教训）。

## Planner findings

### 2026-08-21 — g-001 planner（issue-workspace-containment-fix，PROPOSE 完成）

- **等式缝的完整地图**：veto 在 `plan.ts` 的 `${side}-root-outside-repository` 循环
  （约 582-603 行）；祝福在 `planSide` 的 `facts.linked === false`（约 262-279 行，
  `execution-is-linked-worktree` satisfied）。`identity.ts` 的 `isContainedIn`
  **不可改**：module/scope 的 workspace 发现（站在根内要能找到）与
  `pair-roots-disjoint`（同路径 pair 必须拒）都需要 equality=inside。修复只能在
  veto 调用点做 execution 侧豁免（`linked === false` + `samePath` 双钥匙）。
- **apply 无第二道 veto**：`apply.ts` 只查 marker 落在 planned root 内（严格内含，
  恒真），reuse 侧不会被 addWorktree——plan 变 applicable 后 apply 路径即通。
- **cleanup 后果（已记为 follow-up 候选，g-001 不碰）**：cleanup 全有或全无 +
  自带 main-checkout 守卫（`-2-linked-worktree`）⇒ 绑定 main checkout 的 pair 无法
  经 `workspace cleanup` 拆除。只写 association 文档（本 Module 自己的 run state）。
- **测试盲区模式（对 g-002/g-003 直接可复用）**：旧测试只断言了兄弟 precondition
  （`execution-is-linked-worktree.satisfied === true`），从不断言整 plan
  `applicable`——两个互相矛盾的 precondition 因此全绿过审。教训：**凡测试祝福某个
  shape，必须断言完整 applicable/token 面**，单一 precondition 通过不构成证据。
- **pinned-token 纪律**：precondition 文本进 plan 体摘要；改动循环里的字符串排版会
  平移 plan id 并击穿 pinned-digest 测试——未变 case 必须字节同一。
- **spec 归属**：workspace-pair 机器的规范家 = `store-planning-worktree-bindings`
  （pair 机器）+ `store-planning-identity-v2`（身份派生）。嵌套目的地拒绝此前
  **没有显式 scenario**（只活在代码+测试里）；g-001 delta 把它和 main-checkout
  祝福一起钉进规范。
- g-001 全程未动 `src/core/pipeline-registry/`（解冻是 g-002 的事）与
  `packages/ui/**`。

## g-001 交付追加（2026-08-21，reviewer 移交）

7. **Minor-1 入账**：豁免祝福**任意**仓库的 main checkout（codeRepositoryRoot 从
   worktree 自身 repo 推导）——外国仓 S 嵌在 R 检出内作 --execution-worktree 时，
   污染理由隔一仓而存。与既有 execution-is-linked-worktree 祝福一致（它也从未限定
   本项目仓）。g-002/g-003 触碰 workspace 面时评估是否收紧（keying 加项目仓限定）。
8. 变异证明的教训：**假设的钉与实际的钉可以不同**——性质成立即可，报告里写清
   到底哪条测试证哪个性质（本次：bare-side 突变证嵌套拒绝；pair-roots-disjoint
   证 helper；digest 不动因为 blessed-case 字节来自 samePath）。

### 2026-08-21 — g-002 planner（issue-autodecompose-graph，PROPOSE 完成）

- **(a) 的设计决策 = 上移，不伪造支持（design D1）**：`auto-decompose` 保持 v1 字节
  不变；fail-close 由 Issue-dispatch 后继面解决（分解文档 → `--from-decomposition`
  → intent-node 修订）。证据链：`pipeline-registry/builtins.ts` 钉了后继名
  `issue-dispatch-0.3.0`；fail-close 机理 = `normalizeV1` 给 decompose stage 合成
  `pipeline:<child>` capability → `resolveCapabilityBindings` 抛 → discovery profile
  null → `execution_profile_unavailable`（`execution-plan-internal.ts` requiresV2
  分支 964-989 先查 profile null，live 验证过）；kernel research §7.5 明确三层图
  （Issue Plan / Change Pipeline / Composite）身份与事务边界不许混淆 + 上移方向。
  v2 化不可行：v2 图没有"扇出 N 个独立子 Change run"的构造，FanOut 成员是单 Run
  内节点；把合成 capability 弄成可绑定 = 准入一个引擎派不出的节点（说谎的支持面）。
- **裁决改名是唯一 pipeline-registry 语义改动（D2）**：decompose-bearing v1 →
  `unsupported_pipeline_semantics`（在 null-profile 短路前检查）。两个 pinned 测试
  要跟着改：`test/acceptance/session-cache/pipeline-binding.test.ts:138` +
  `test/core/change-run/engine-product-surface.test.ts:275`；
  `session-host-lifecycle` 的 expected-behavior scenario 同步 MODIFIED——这正是
  方向预留的 0.3.0 跨越本身。task-loop 与六个 v2 built-in 的裁决不受影响。
- **delta 校验器怪癖（会再咬人）**：requirement 的 description 只取**第一行**，
  SHALL/MUST 检查也只看那一行——段落首行必须含 SHALL，否则报
  "must contain SHALL or MUST"（本 child 已踩一次）。
- **为何必须新源（D3）**：`issue-plan-publication` 明文禁止 from-portfolio 把
  pipeline 事实写进节点（portfolio run-state 不是 pipeline 的权威）；分解恰是反面
  形状——什么都没发生、一切都是提案。`--from-decomposition` = intent-only +
  每节点 `suggestedPipeline` + `rationale`/`uncertainty` 至少其一（--from-file 下
  三字段保持可选）。
- **digest 纪律沿用 lifecycle 先例（D4）**：新字段 absent 即从 canonical 形省略 →
  旧修订字节/摘要不变；pinned-digest 测试保持绿不动。
- **对 g-001 追加 item 7 的答复（LEAD 点名要表态）**：g-002 **不收紧**——本 child
  全程未触碰 workspace/execution-root 组合面（上移发生在 publication 层，
  `store issue start` 的 launch-context 组合一字未动）。收紧评估顺延到 g-003：
  它的 confirm→start 流会真正组合 execution root，届时把 keying 限定到项目仓的
  成本/收益才有实感。已写入 g-002 design 的 Open Questions + 给 g-003 的移交清单。
- **给 g-003 的移交**：(1) confirm 动作 + `store issue start` 是否把节点记录的
  `suggestedPipeline` 当 launch contract 的 "pipeline when one is known"（规范里
  已有该措辞缝）；(2) merge/split 修订的词表（修订=新修订）；(3) 上面的 keying
  收紧评估；(4) dogfood 的"人工至少修正一次目标或依赖"完成证据归 g-003。

### 2026-08-21 — g-003 planner（issue-autodecompose-review-flow，PROPOSE 完成；Phase 4 收官）

- **五个移交全部拍板（proposal What Changes 逐条对应）**：
  1. Minor-1：required/optional **上节点**——intent 节点收 `required|optional` 两值
     （absent=required、canonical 省略、旧修订字节不动）；cancelled/superseded 仍
     change-only，拒绝的 intent 工作用"下一修订删除节点"表达。g-002 归档钉的
     "document ALONE" 措辞由本 child 的 delta 正式修订：文档回到纯输入，
     修订才是 durable record。copy-at-confirm 被否：会让 confirm 变 writer、
     把 lifecycle 真相劈成两半、且审查面（标记发生处）显示不出它。
  2. Finding 1：**采纳**。fresh 链 = `--pipeline` > run-state 记录 > 节点
     `suggestedPipeline`（binding.ts:437-442 的 seam）；contract 报 pipeline 来源；
     flag 压 suggestion 不拒绝（manual selection 围栏）；running 链与分歧拒绝不变。
  3. Finding 3：**修**。`planNodeCandidate`（plans.ts:587-612）只转发已知字段→
     未知字段进不了 `.strict()`、静默蒸发；加 extra-keys 检查，throwing 路径与
     reporting 路径都按"节点+字段名"拒绝——authored 面与 stored 面的 strict 终于对称。
  4. g-001 item 7：**保持不收紧，评估闭环**。g-003 不碰 containment 现场
     （confirm 走既有 launch-context seam，不给外国仓 execution root 新入口）；
     收紧需要 pair planner 跨模块验证项目仓，属"真改 pair-planning 面的 child"，
     与 g-001 cleanup 不对称一起记 portfolio follow-up。
  5. merge/split：**无新词表**——就是下一修订（nodeId 连续性约定：合并可保留
     一个组成者的 id，拆分铸新 id 并重接边）；新增的是**可见性**：`show` 派生
     最新修订对 `supersedes` 前任的节点级 delta（增/删/改目标/改边/改 lifecycle/
     改 suggestion），读时派生、不持久化、不驱动任何轴、双形态一致。
- **confirm 的定位（D6）**：read-compose-report 动词（`store issue confirm
  <id> [--revision]`：解析修订→对 committed 证据验 change 节点→为可启动 frontier
  组合同 start 规则的 contract（含 suggestion）→intent 节点报 pending-Change→
  一字不写）。**不落地 confirmed.yaml、不加 start 门**：五个 mutation 保持五个、
  不添第二持久真相；plan↔execution 的追踪由不可变修订 + run-state attribution
  承担；Phase 5 确定性重规划要锚时再设计。否掉的备选：persisted 确认记录
  （六 mutation + 兼容门 + 重确认杂务）、confirm 铸 Change（复制 propose 机器）。
- **给 Phase 5+ 的 follow-up 清单（终局移交）**：(1) pinned-confirmation 锚
  （D6 否决理由即它的设计输入）；(2) 外国仓 main-checkout keying 收紧 + g-001
  cleanup 不对称（同属 pair-planning 面）；(3) Phase 4 完成证据的"人工至少修正
  一次"由 g-003 dogfood 6.1 的修订回执落账；(4) playbook 修订词表 nodeId 连续性
  已写进 opsx-auto-command 措辞——将来 UI 化时同规则。
- **delta 校验器第一行 SHALL 怪癖再次全程规避**（g-002 教训直接复用，本次零返工）。
