
# Planning Context — issue-level-review-delivery（Phase 6，LEAD 种子，2026-08-22）

## 用户意图（原话）

> 继续推进后续所有slice，每个slice你来direction激活并使用auto推进！

Campaign：本片为 Phase 6/6（P7 界面收敛另列）。交付模式循 #168/#171/#172/#173/#174。

## 本片目标（roadmap §10 Phase 6 最小实现）

**Issue 级 Review、Delivery 与 Acceptance 收口**：多项目 Changes 完成后，Issue 进入
统一 Review，而非各自结束后失去整体上下文：
- Change 级交付证据回流到 Issue（commit/PR/验证报告汇总）；
- Issue acceptance checklist / 可执行 gate（**已在位**——P1 C3 的验收门 + P5 的排除账）；
- 所有必需节点完成的判断（在位——progress/gate）；
- **可选节点延期或取消的明确记录**（延期词汇是缺口：cancelled/superseded 已有，
  DEFERRED 未有——g-003 的题目）；
- Review 和 Waiting Human 状态（在位——phase review/waiting-human）；
- 显式 Issue close/accept 动作（在位）；
- Done 不再由"所有 Changes archived"推导（在位——P1 C3 终格）。

诚实盘点：**Phase 6 的大部分语义已被前五片渐进交付**。本片的真实增量：
1. **交付证据汇总回流**——per-Change 的 ship/PR/验证事实聚合到 Issue 读面（g-001）；
2. **统一 Review 视图**——跨项目 Changes 的验证状态并置 + Issue 级结论（g-002）；
3. **延期记录词汇**——optional 节点的显式延期（含理由）与验收的互动（g-003）。

## 执行环境

- worktree `.claude\worktrees\issue-layer`，分支 `feat/issue-phase6`（自 dev/0.2.0 `5f159f10`）。
- `node bin/rasen.js`；版本纪律；`src/core/pipeline-registry/` + `packages/ui/**` 冻结。
- 持久 store `issue-registry`（**四个 Issue 全 done**）——dogfood 用 **Issue #5**（本 portfolio）。
- 磁盘紧（~3.4GB）：临时 fixture 边跑边清。

## 已有地基（勿重复建设）

P1–P5 全链（投影/门/验收/排除账/ready-set/attention/保史/confirm）。交付证据的原料
（ship-log 的 commit/PR 事实、各 child 的 archive.json）都在盘上——g-001 是**聚合读面**
不是新真相。Phase 6 移交账：attention 直钉、--issue unsearched-refs 语义、常驻开放账
（claimant-alias、pinned-anchor、foreign-repo）——不阻塞本片，能塞则塞。

## Portfolio 计划（LEAD 已拍板）

| # | child | 交付 | 依赖 |
| --- | --- | --- | --- |
| g-001 | `issue-delivery-evidence-rollup` | per-Change 交付证据（commit/PR/验证事实）聚合到 Issue 读面；human/JSON 同构 | — |
| g-002 | `issue-unified-review-gate` | 统一 Review 视图：跨项目验证状态并置 + Issue 级结论（全部必需完成 + 证据齐 → review-ready 的判定叙述） | g-001 |
| g-003 | `issue-deferral-record` | optional 节点显式延期词汇（deferred + 理由；与验收门的互动：延期不阻 Done 但记录在案）+ **Issue #5 全环 dogfood** | g-001, g-002 |

串行链。close 动作只进 evidence。

## 决策记录

- 2026-08-22 LEAD：Phase 6 激活（§14.5 已回写；work.yaml activeSlice 已切）。
- Phase 8（平台增强）维持可选池不排期；P7 界面收敛为本 campaign 最后一片。

## Planner findings

### 2026-08-22 — g-001 `issue-delivery-evidence-rollup` propose（完成）

**事实底账（`issue-registry` 持久 store，只读取证）**：四个 done Issue 共 12 个 change
node = 9 个已归档条目（**全部 v1 ledger 形态**，无一条 v2）+ 3 个 run-terminal 未归档
（`issue-needs-attention`、`issue-persistent-baseline` 在本 worktree 的 ephemera；
`document-multi-project-issues` 在 rasen-site 项目、经 workspace-index 定位——跨项目
absence 样本）。每条 v1 `archive.json` 都带 `codeCommit`（40-hex）、`planningBranch`、
`planningTreeState`、`evidence[]`（path+sha256，含 `evidence/ship-log.md`）、`missing[]`
（9 条全是 `["verification-report"]`）。v2 形态（`codeMerge.commit`/`planning.sourceRef`/
outcome）真实 store 里暂无样本——v2 覆盖只能靠 temp store byte test。

**缝的决定（design D1）**：交付事实**零新增 blob 读**——全部就在 `readArchiveEntry`
（module.ts:418）为 outcomeBasis 已经 parse 的同一个 `archive.json` 里，只是今天被丢弃；
线程走 `AggregateArchiveEntry → PlanNodeResolution → IssueNodeStatus.delivery`（正是
`outcomeBasis` 的 additive 线，module.ts:709-715），rollup = 纯后置 pass
`deriveIssueDeliveryEvidence(status)`（attention/ready-set 同款单输入纪律）。

**诚实边界（g-002 必须照此组合）**：两种 record 形态都**没有结构化 PR 事实**；ship-log
按 inventory 事实呈现（path+digest、在场/缺席点名），**散文永不解析**——store 粒度的
"验证故事" = evidence 清单 + 记录在案的 missing 名，**不存在 store 侧验证裁决**（verdict
在 review-report.md 散文里）。g-002 的 review-ready 叙述只能组合这些事实，不能提炼不
存在的 verdict。rollup 形状（entries + 五态 counts：record/no-record/not-archived/
unreadable/unattributed）即 g-002 的消费缝；未内置 "evidence-complete" 谓词（留给 g-002
拍板）。改动面：query/{module,types}、issue-status/{types,projection,delivery.ts(新)}、
store-issue.ts show 段；**list 不动**、无新命令/flag（零 completions/locale churn）、
frozen 区不碰。proposal/design/specs/tasks 4/4 齐且 validate 绿。

### 2026-08-23 — g-002 `issue-unified-review-gate` propose（完成）

**判定 = 门映射，不是门重算（design D1）**：determination 七值闭词汇**一一映射**自
`status.acceptance.gate`（eligible→review-ready 带 conditions 版本；already_accepted→
accepted 带 record 日期+版本；blocked→not-ready 只带 blocker 计数、清单留在 gate 里
不复制；conditions_required→conditions-missing；requires_plan→no-plan；dropped→dropped；
`status.acceptance===null`→acceptance-unknown——attention 的"item 照发"先例）。**没有第
二 blocking basis**：delivery 状态/lifecycle/thread/counts 都不翻判定（有专项 pin）。
LEAD 消息里 "all wanted nodes terminal" 的措辞按 roadmap 原文（全部**必需**完成）与
gate 已裁定收敛为 **required 域**，optional 未完走 `optional-open` thread——这也正好给
g-003 留位：deferred 词汇落地后该 thread 消失，判定从未需要第二 basis。

**Thread 词汇（design D2）**：optional-open（带 observation；failed/waiting 的 optional
节点同时出 attention thread——两种事实并列是诚实重叠）/ archive-pending（not-archived =
expected progress，绑定结论）/ record-absent / evidence-missing（missing[] 是 recorded
事实，inform 不 block）/ attention 映射 failure·blocked-behind·waiting-human（**排除**
acceptance-awaiting=判定本身、problem=已是 gate blocker，复制反而像不 block）。排序：
attention fail-first 在前，其余 (kind,nodeId) 码点序。

**缝与形状（D3/D4）**：`deriveIssueReview(issueId, revisionId, status)` —— g-001 落地
的 **plain-strings-beside-status 签名先例**；never-null（no-plan 也是答案）；内部调
`deriveIssueDeliveryEvidence` + `deriveIssueAttention`（同一 status 出一致三元组）；
verification summary 按**引用**（status.progress + delivery counts），不复制 entries/
blockers。show 末段 `review:`（delivery 段之后）+ `--json` 增 `review` 键；list 不动；
结尾行 "review derives; accepting remains the operator's act"。spec 能力名
`issue-unified-review`（沿 g-001 缩词先例），零 MODIFIED。dogfood 预期：四 Issue 全读
`accepted` + threads（evidence-missing×9、archive-pending×3 含跨项目那条）= 回顾性
review 视图。proposal/design/specs/tasks 4/4 齐且 validate 绿。

### 2026-08-23 — g-002 `issue-unified-review-gate` apply+verify+ship+archive（完成；g-003 输入）

**Apply**：13/13 任务；17/17 unit + 7/7 CLI + 9/9 guard；四 Issue dogfood 收据入 evidence/
（verify 活体亲读零偏差）。**Verify**（fresh reviewer，CLEAN 0B/0M/0m/4 Info，报告
evidence/review-report.md）：判定唯一基 exhaustive（switch 无 default、返回类型钉穷尽）、
活体 `--json` parity 与 dogfood-5 deep-equal、词汇封闭 spec 钉死、list 围栏 CLI 测试守、
变异抽查 ×3 红后 sha256 还原。**Ship** e5c88225（local，21 文件）；**Archive** 62553fe0
（specs synced：`rasen/specs/issue-unified-review/`；纯 ADDED delta 无 Purpose 可抄，
Purpose 由 archiver 按 proposal 事实撰写）。

**实现者 3 条 findings（g-003 直接输入；源自其 DONE 摘要，全文随前会话失效，展开须回读
代码/测试）**：
1. **optional-open seam**：deferred 词汇落地后 optional-open thread 应消失的缝已就位
   （判定从未需要第二 basis）——g-003 落 deferred 时按此缝收敛，勿另开判定分支。
2. **gate refusal ORDER shadows**：acceptance gate 的 refusal code 有顺序遮蔽（多因并存
   仅首因呈现）——g-003 若动 gate 词汇/新增 refusal 须核对遮蔽序。
3. **accepted-with-null-facts pinned**：accepted 判定在 facts 为 null 时的行为已被专项
   测试钉住——g-003 改动不得松动该 pin。

**Verify Info 中与 g-003 相关**：I-1 design D2 "(kind,nodeId) 码点序" 措辞与实现（枚举
kind 序）不符——spec 只钉 stable，若触及该文可顺手校正措辞；I-3 环境坑：`pnpm run build`
曾 exit 0 却漏 emit dist 文件致 CLI 套件幻影红——CLI 验证前确认 dist 新鲜，整片红先重建。

### 2026-08-23 — g-003 `issue-deferral-record` propose（完成）

**词汇形状（design D1）**：`deferred` = 第五个 Change-node lifecycle（required|optional|
cancelled|superseded|deferred），语义"仍打算做、但明确推迟到本 Issue 完成之后"——
postponed ≠ abandoned ≠ replaced。机制与 cancelled/superseded 完全同构：Change-node-only、
reason 必填（schema 拒绝）、canonical form 只省略 required（老 revision digest 逐字节
不动）、改 lifecycle 只能走新 revision。plans.ts 的 dangling-reason 拒绝语须改词：
"work the plan no longer wants"→"work the plan does not demand toward Done"（deferred
仍被想要，旧措辞会变假）。

**与门/判定/attention 的互动 = 一族两式（design D2，核心发现）**：lifecycle 消费恰两种
形状——**正向检查**（isWanted=required||optional 三拷贝 projection.ts:661/attention.ts:55/
ready-set.ts:38 + binding/confirm、isRequired、review.ts:151）第五值**自动落出**：phase/
health/progress/lanes/attention/review threads/ready 成员/start frontier/confirm scope
零逻辑改动；**负向枚举**（gate.ts:68,176、ready-set.ts:54、binding.ts:299、plans.ts:209、
acceptance.ts:124 的 cancelled||superseded）第五值**落穿**，两处落穿是谎言：deferred 节点
ready exit 读成 "blocked 零 blockers"、`start --node` 会真发 launch contract（唯一实际
漏洞）→ 新 exit kind `deferred`+reason、新 refusal `issue_start_node_deferred`。gate 两处
小改：lifecycleAccounting 把 deferred 入 exclusions（两个 lifecycle union 各扩一值）、
failing-node loop skip 加 deferred。

**记录在案 = 三个既有面零新形状（design D3）**：(1) 不可变 plan revision（delta 的
lifecycleChanges 泛型自动报 required→deferred）；(2) gate exclusion 账（渲染全泛型，
`excluded <node> (deferred): <reason>` 零改动）；(3) accepted.yaml 冻结 deferred exclusion
（RecordExclusionSchema enum +1；absent-when-none/digest/去重纪律不动）。

**g-002 三 findings 落点（design D4）**：①optional-open seam——review.ts 不改一行，defer
后 thread 因 lifecycle!=='optional' 自然消失，不加 deferral thread kind（deferral 已在
acceptance 段 exclusion 账全量呈现，复制进 threads = g-002 拒绝 problem 项的同款反模式）；
②refusal ORDER shadows——零新 refusal code 进 gate 五段（顺序逐字节不动，tasks 2.1/2.2
专项 pin；issue_start_node_deferred 在 execution-binding 侧）；③accepted-null-facts
pin——determination 映射零触碰，pin 原样跑。

**Delta 形态：6 spec 全 MODIFIED、零 ADDED、无新 capability spec**。理由：deferral 本质
是既有闭词汇加宽，真相分属六个 owner spec（store-issue-resources 词汇本体 /
issue-acceptance-close 门+record / issue-status-projection 四个 requirement /
issue-ready-set-scheduling exit 词汇 / issue-execution-binding start 拒绝 /
issue-unified-review threads 不出现）；第七个新 spec = two-witness drift。先例：原
issue-node-lifecycle change 即分布式 delta。纪律自检 ALL CLEAN：10 个 MODIFIED
requirement 标题逐字匹配 main specs、既有 83 scenario 原字保留零 drop、14 新 scenario
纯增。

**Dogfood 设计**：tasks 5.x = 临时 v2 store 真 CLI 全环（rev1 required+optional → rev2
defer with reason → show 节点行/delta/exclusion → ready exit → start 拒绝 → accept 冻结
→ --json parity → write-nothing；hermetic HOME/XDG、deriveChangeInstanceId 种子、.rasen/
即跑即清）；tasks 6.1 = issue-registry **只读**回归取证（Issue #5 + 一个老 done Issue，
pre-deferral 字节零变化、与 g-002 receipts 判定一致）。**Issue #5 close 四步不在
tasks.md**（LEAD 收官动作，避免 P4 g-003 自指死锁）。

**改动面（文件级）**：src/core/store/issues/{types,plans,acceptance}.ts、
src/core/issue-acceptance/{gate,types}.ts、src/core/issue-status/{types,ready-set}.ts、
src/core/issue-execution/{types,binding}.ts、src/commands/store-issue.ts（仅
renderReadyExit 一个 case）+ 注释。**明确不碰**：review.ts/attention.ts/projection.ts
逻辑（正向检查吸收，测试钉）、delivery.ts、wire-types（其 superseded/cancelled 是
finalization outcome 另一词汇）、locales/completions（零 churn）、skill 模板（
_orchestration "required and optional only" 规范短语已排除 deferred，不为一词拖动哈希/
pipeline 钉协调尾巴）、冻结区。

**风险**：①6-spec MODIFIED 归档一次落六处（已预核验，tasks 6.2 钉 validate）；②deferred
required node 可表达（per-revision authoring 本就允许 = 带记录的降级 descope，delta 显示
required→deferred，gate 账解释小计，有意无跨 revision 守卫）；③旧 build 读新 bytes →
fail-closed 具名 unreadable（历次词汇加宽同类）；④deferred 节点 terminal-未归档仍出
archive-pending/evidence-missing threads——lifecycle-blind 的 delivery 事实，故意保留。

四制品齐且 validate 绿（两次，含清理后复跑）。

### 2026-08-23 — g-003 `issue-deferral-record` apply+verify+ship+archive（完成；portfolio 3/3）

**Apply**（18/18）：五值 lifecycle 落地，正向检查零逻辑改动（review.ts 零 diff、projection/
attention/confirm 纯注释）、负向枚举补五值（gate exclusions+skip、ready exit `deferred`、
binding 拒绝 `issue_start_node_deferred`、plans 措辞、record enum）；4 新套件 39 pin；
dogfood 6 收据 + issue-registry 只读 5 收据（HEAD 3af7041e 恒定，四 Issue 判定与 g-002
收据逐一相同）。实现者 7 findings 中重要者：Issue #5 不在注册表（按超集取证四既有
Issue——正确，#5 创建/close 归 LEAD 收官）；D5 共享拒绝语改词 "does not demand … now"
（旧句对 deferred 为假）；accepted.yaml 长 reason 会 YAML 折行（字节断言用短 reason）。

**Verify**（fresh reviewer，FINDINGS 1 Minor/2 Info 无 Blocker/Major，报告
evidence/review-report.md）：独立负向枚举全仓清扫 = 9 个运行时判断点全处理**无第七漏点**；
变异 3/3（gate.ts:74/binding.ts:308/ready-set.ts:58）红→sha256 还原→绿；独立 hermetic
店四环 40/40；refusal 梯 shadow-walk 真 pin。F1（Minor，唯一"前提可满足+THEN 假"型矛盾）
= acceptance-close 既有 scenario "A record with no exclusions writes the absent form" 的
WHEN 前提未含 deferred——由 delta 作者 planner 一行修正（标题不动），validate 复绿；
同族句裁决为欠覆盖非矛盾，维持原文。F2/F3 Info 无动作。

**Ship** a0d4d6b2（local，43 文件 +5444/-81）；**Archive** 8c70ac7e（6 主 spec MODIFIED
合并：10 处正文并列 deferred + 新 scenario 块 + F1 行；引擎 EOF 缺陷这次反向——合并时
删 Purpose/Requirements 间空行 + EOF 多加空行，6/6 修齐；零标题丢失；validate --all
spec/* 全绿，change/* 陈旧失败基线 35 项无新增）。

**归档教训（新）**：MODIFIED 合并与 ADDED 新建的引擎 EOF 缺陷方向相反——ADDED 是"多尾部
空行"，MODIFIED 合并是"删段间空行 + 多尾部空行"；两向都要查。
