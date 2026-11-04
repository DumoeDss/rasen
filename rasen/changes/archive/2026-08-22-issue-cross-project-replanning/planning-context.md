
# Planning Context — issue-cross-project-replanning（Phase 5，LEAD 种子，2026-08-21）

## 用户意图（原话）

> 继续推进后续所有slice，每个slice你来direction激活并使用auto推进！
> 继续推进，等g-003完成后直接进Phase 3（解读：portfolio 收官直滚下一片，按路线序）

Campaign：本片为 Phase 5/6。交付模式循 #168/#171/#172/#173。

## 本片目标（roadmap §8 Phase 5 最小实现）

**跨项目重规划**——用户能看到跨项目关键路径，并处理：上游失败 / 节点取消 /
新增工作 / 目标项目调整 / 并行机会 / 节点被替代：
- 跨项目 dependency gate（Phase 3 已有 g-002 跨项目门）；
- **ready 节点的确定性计算**（ready-set：无未满足依赖且自身可跑的节点集）；
- required/optional/cancelled/superseded 语义（Phase 2 已落）；
- **Execution Plan 修订保留已运行历史**（修订=新修订，永不改写——已在位；本片补
  superseded 的真语义消费：被替代节点退出 ready-set 但历史可查）；
- **重规划后保留已运行历史**（新增节点不改旧节点观察）；
- **"Needs Attention" 聚合入口**（失败/阻塞/等待人工的统一视图）；
- 防止一个失败节点被其他运行节点掩盖（健康分离已基成——聚合入口消费它）。

## 执行环境

- worktree `.claude\worktrees\issue-layer`，分支 `feat/issue-phase5`（自 dev/0.2.0 `3f2d1067`）。
- `node bin/rasen.js`；版本纪律；`src/core/pipeline-registry/` 本片冻结（P4 已跨边界）；
  `packages/ui/**` 冻结（P7 前不动 UI）。
- 持久 store `issue-registry`（#1 done 3/3 · #2 done 4/4 · #3 done 2/2）——dogfood
  用 **Issue #4**（本 portfolio 自身）。

## 已有地基（勿重复建设）

- Phase 1-4 全链。**ready-set 的原料都在**：work-basis 阻塞（P3 g-002）、四态节点（P2）、
  跨项目门（P3）、修订 delta 可见性（P4 g-003）、泳道（P3 g-003）、confirm（P4）。
- 本片是把这些**编排成确定性调度面**：ready-set 计算 + superseded 消费 + 聚合入口。

## Phase 4 移交（binding，本片消化）

1. **legacy-seed-reads-fresh 裁决**（g-003 successor finding + Issue #3 close 实撞）：
   确定性调度器必须裁决——seed 时铸造 outcome-bearing v2 记录 vs archived-legacy
   视作 complete。建议方向：后者（archived-legacy = complete——seed 的本意就是已交付），
   但 planner 定夺并成文。
2. pinned-confirmation anchor（P4 拒绝理由即设计输入——调度面若需要确认锚再启）。
3. claimant-alias keying 归属（镜像已三份——调度器消费 run-state，归属未定则每次
   dogfood 都要镜像；本片若触碰定位器顺手裁决）。
4. foreign-repo keying + cleanup 不对称（workspace follow-ups，不阻塞）。
5. 本机全量套件分箱配方：≤25 文件/次；200+ 路径 Windows 命令长死；单进程必死。

## Portfolio 计划（LEAD 已拍板）

| # | child | 交付 | 依赖 |
| --- | --- | --- | --- |
| g-001 | `issue-ready-set-scheduling` | ready 节点确定性计算（跨项目 ready-set；superseded/cancelled 退出；archived-legacy 裁决落地）+ legacy-seed 裁决 | — |
| g-002 | `issue-revision-history-preservation` | 重规划保史：新增/替代节点不改旧观察；superseded 语义真消费（退出 ready-set、历史可查、验收门排除） | g-001 |
| g-003 | `issue-needs-attention` | Needs Attention 聚合入口（CLI 面：失败/阻塞/waiting-human 跨 issue 聚合；失败不被运行掩盖的证据）+ Issue #4 全环 dogfood | g-001, g-002 |

串行链。close 动作只进 evidence。

## 决策记录

- 2026-08-21 LEAD：Phase 5 激活（§14.4 已回写；work.yaml activeSlice 已切）。
- pipeline-registry 冻结恢复（P4 已完成边界跨越；P5 是编排层）。

## Planner findings

### 2026-08-22 — g-001 planner（issue-ready-set-scheduling，PROPOSE 完成）

- **legacy-seed 裁决已落（read-side，basis 分裂）**：`observeNode`（projection.ts:453）
  只认 `archived && outcome !== null`；`readArchiveEntry`（query/module.ts:411）把四个
  null-outcome 分支（无记录 / JSON 不解析 / schemaVersion≠2 / v2 校验失败）全塌缩成
  `legacyRecord: true`。裁决：**archived-legacy = complete-for-scheduling**（observation
  `finalized` + diagnostic 命名 legacy basis；不铸 outcome——四结局模型的 no-inference
  立场管的是 outcome 列，不管 archive 事实本身）；但 **v2-shaped 校验失败 ≠ legacy**——
  损坏字节 fail-closed（`unknown` + 新 problem kind `invalid-archive-record`）。落地 =
  `readArchiveEntry` 记录分支来源（additive `outcomeBasis: 'v2'|'legacy'|'invalid'`）
  穿过 `deriveReadiness` 进 resolution。query 自身的 readiness/blockedBy 刻意不动
  （archive-based 喂 `readyToResolve`——两 basis 并存是 projection spec 已钉的设计）。
- **ready-set = 投影后置 pass（one-seam）**：`withBlockerFacts` 的 `blockedBy` 为空 ⟺
  `binding.ts` 私有 `isRunnable` 的依赖子句（同 observations、同 work-complete basis）
  ——投影早已持有谓词；membership = wanted ∧ not-started ∧ blockedBy 空。**start 的
  candidates 数组就是 ready-set**（frontier_ambiguous 拒绝所列即集合）；**confirm 的
  contracts+unprepared = members**。三个面重构到共享谓词 `deriveIssueReadySet(status)`
  （纯 IssueStatus 输入），等价测试双向钉死（先落 pin 再重构，pin 断言不许改）。
- **对 Phase-4 移交的处置**：#1 本 child 落地（上文）；#2 confirmation anchor 仍缓议
  ——ready-set 是 read-composed，不需要锚；#3 claimant-alias keying **未触碰**——本片
  不动 locator，且裁决使 terminal-legacy 节点不再需要 run-state 镜像，残余镜像压力
  只剩 active-node 可见性，仍归 g-003/LEAD 账本。
- **给 g-002/g-003 的缝**：g-002 消费的入口 = 本片的 exit-reason 闭词汇
  （superseded/cancelled 退出可见+记录理由——历史保全在此之上做）；g-003 的
  Needs-Attention 沿用 health 分离 + 本片 `ready` 动词的 locale(en/ja/zh-cn)+
  completions 三文件同步纪律。
- **Issue #3 形状的复演已进 tasks 3.2**：temp store 上 seeded-legacy 依赖释放下游、
  全程无镜像——这就是裁决的验收测试。
- delta 校验器首行 SHALL 怪癖本片又踩中一次（ADDED "Archived legacy work releases its
  dependents" 首行无 SHALL 被拒），改写首行后过——g-002/g-003 起笔时先自查每个
  requirement 首行。

### 2026-08-22 — g-002 planner（issue-revision-history-preservation，PROPOSE 完成）

- **种子前提已核正**："cancelled 已工作、superseded 待补"过时——`lifecycleAccounting`
  （gate.ts:56-79）对两值对称排除，spec（issue-acceptance-close "A superseded node is
  excluded and named"）与测试（issue-acceptance-gate-lifecycle.test.ts:220）都在。
  g-002 的真实缺口另两处：(1) **durable record 不带 exclusions**——`IssueAcceptedRecordV1`
  只冻结 gate snapshot（completed/total/health/problemsStanding），缩小的 total 无持久
  解释（每次读的 evaluation 才有名）；(2) **连续性/retarget 两个不变量结构性成立但零
  pin**（fixture-coincides 陷阱的教科书形状）。
- **retarget 规则的机理（无需新代码）**：`verifyExecutionPlanReferences`
  （reference-verification.ts:213）拒绝 node 声明与 instance 提交处不一致的
  project/line（`issue_reference_scope_conflict`）⇒ **可发布的 retarget 必带新
  instance** ⇒ 投影按 instance 派生观察 ⇒ 新节点 fresh（除非新 instance 自带 run-state/
  archive 证据），旧 lineage 的事实留在前修订（不可变 + digest 验证 + confirm
  --revision 可组合）+ delta 的 retarget 条目。规则 = 两个既有真值的组合，pin 测试打
  两半：拒绝路径 + fresh 读路径。
- **exclusions carry 用 suggestion-field 先例**（store-issue-resources 钉过的 absent-
  omitted/digest-stable 纪律）：`AcceptedRecordSchema`（.strict()）加 optional 字段；
  空数组省略 ⇒ 无排除的 accept 字节与前字段形状逐字节相同；前字段记录原样读回。
  拒绝 V2 record（additive optional 字段不值一次版本迁移）与顺带持久化 optionalNodes
  （optional 从不进 total，无需解释）。
- **pin 必须被证明会咬**（D4）：三组 pin 各带一个 mutation check——连续性组在两次读
  之间扰动 run-state 证明 pin 读的是真证据；lineage 组打拒绝路径；carry 组剥字段/
  改 reason 走 digest 拒绝。立即绿的 pin 是交付物本身，但无失败路径的 pin 什么也不守。
- **alias 碰撞显式出圈**：两 instance 跨项目同 alias 会 key 同一 run-state 文件——
  连续性不受影响（碰撞污染新节点的归因，不动旧节点的观察），但归因错乱本身仍是
  claimant-alias keying 账目项（P4 移交 #3，g-003/LEAD）——本片绿 pin 不得被读作它的解决。
- **历史可查 = 三真值组合**（D5，无新面）：当前修订节点线仍报观察（P2）+ delta 以稳定
  nodeId 报 lifecycle 变更（P4）+ 前修订经 `confirm --revision` 可组合。若将来要一等
  历史读面，是独立 change。
- g-003 起笔自查：本片 requirement 首行全部带 SHALL（零返工，怪癖预防生效）。

### 2026-08-22 — g-003 planner（issue-needs-attention，PROPOSE 完成；Phase 5 收官）

- **"blocked" 陷阱已拆（D1 核心裁决）**：health 的 `blocked`/`stale` 是保留值、串行等待
  刻意 `healthy`（P1 spec 明文）——聚合若设 "blocked" 类目收纳普通依赖等待，既淹没答案
  又从侧门走私保留词。裁决：五类闭词汇 failure / **blocked-behind**（直接 blocker 观察到
  failed/waiting-human/unknown 才入列——失败的爆炸半径，一跳；更深的链每跳各自成列、
  各自命名 blocker，无需图遍历）/ waiting-human / acceptance-awaiting（review 相位——
  验收天然是人的事，gate 评估随行）/ problem（全部 standing problems 含 g-001 的
  invalid-archive-record）。
- **缺席纪律进 spec（D4）**：被排除的观察（in-flight/advanced/terminal/ready/串行等待）
  逐项枚举为 REQUIREMENT；scan summary 让"扫过但无需关注"可见（in-flight 收据就靠它）；
  空态明说"N scanned, none need attention"。这是对聚合面 scope creep 的常驻栅栏。
- **动词落 store 级（D3）**：`rasen store attention [--issue] [--json]`——不进
  `store issue`（那里都是 per-Issue 面）；per-Issue 组合**逐字复用 show 的 CLI 组合**
  （同输入同投影 ⇒ attention 与 show 不可能对同一 Issue 各执一词）；unknown --issue 拒收
  而非空扫。locale+completions 沿 ready 动词纪律。
- **Issue #4 dogfood 分期（D5）**：已 ship 的 g-001/g-002 从归档证据以 derived v2 身份
  种入 store（与 Issue #3 不同：它们的 v2 outcome 记录**存在**，天然读 finalized，不走
  legacy 裁决路径）；本 change 自身 = 诚实 in-flight 节点。收据三段：authoring→ready 扫描、
  children-terminal+finale-in-flight（active/healthy 诚实缺席）、temp-store 孪生上的
  staged failure（不被掩盖 surfaced）。close 只 STAGE：conditions 对真标准撰写、accept
  步骤成文，仅在 implementer 手上真 terminal 才执行（LEAD close 先例）。
- **P5 §8 退出证据落位（D6）**：三张收据归本 change evidence 一处（保史引用 g-002 已 ship
  的 pins 不重造；防掩盖 = 集成测试+收据 4.4；聚合入口 = 4.2–4.3）——portfolio close
  summary 从一处读全 §8。
- **Phase 6 继承账本（campaign memory）**：(1) claimant-alias keying 归属仍开放（P4 移交
  #3——g-001 裁决消了 terminal-legacy 的镜像压力，active-node 可见性归 g-003/LEAD 处置，
  g-003 未触碰 locator）；(2) pinned-confirmation anchor 仍缓议（P4 移交 #2——等待真正的
  消费者）；(3) foreign-repo workspace follow-ups（P4 移交 #4）原样；(4) scan 无缓存是
  刻意的（缓存 attention = 第二可变真相）；fleet 规模若逼出缓存需求，是新 capability 带
  自己的失效真相。
- 流程：WHEN-bullet 空格 + 首行 SHALL 均起笔自查，零 validator 返工。
