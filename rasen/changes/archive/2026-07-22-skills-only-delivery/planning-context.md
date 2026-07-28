# Planning Context — skills-only-delivery portfolio

## 用户意图(逐字)
实现已批准的开发文档 `rasen/office-hours/skills-only-delivery-runtime-next-steps.md`(Status: APPROVED,经对抗审查 8.5/10):1) 移除 commands 交付面只保留 skills;2) skill 上下游衔接改由 CLI 运行时提供 nextSteps。运行参数:--no-gate,auto-decompose,worktree `OpenSpec-wt-skills-only`,分支 `feat/skills-only-delivery`(自 feat/ui-config-redesign)。

## 权威输入
**开发文档是唯一权威规格来源**:`rasen/office-hours/skills-only-delivery-runtime-next-steps.md`(已复制进本 worktree)。所有决策已拍板、经审查修正,proposal 阶段的职责是把它转译为 change 工件(proposal/specs/tasks),不是重新设计。文档中的行号引用已逐一对照源码核验过(基于 feat/ui-config-redesign)。

## Decompose 计划与依赖
- child 1 `skills-only-remove-commands` = 文档 Phase A(A1-A12):delivery 配置整个退役、删 command-generation(先抽静态清理模块 retired-command-paths)、init/update 接线、specs/locales/docs/tests。
- child 2 `skills-only-cli-next-steps` = 文档 Phase B(B1-B5):新建 workflow-chain 链条表、instructions/status 输出 nextSteps、stdout hint、i18n、测试矩阵。
- child 3 `skills-only-template-cleanup` = 文档 Phase C(C1-C4):模板剔除写死 steering、交叉引用统一 canonical skill 名、dispatched 契约不动(non-goal)、grep 断言测试。依赖 child 1(引用改名)+ child 2(nextSteps 槽位)。
- 执行序:**全串行 1 → 2 → 3**(共享工作树 + locale/update.ts 触碰重叠,不满足并行正性证明)。

## 关键约束(全部来自文档,violating = 审查 Blocker)
- 版本号不动;legacy delivery 值读取绝不报错(映射+一次性 notice+回写);三语 locale 同步;spec 场景改名/删除须 REMOVED+ADDED。
- Phase A 陷阱:清理涉及 removeCommandFiles(update.ts:564-590)与 removeUnselectedCommandFiles(:597-637)两个方法;删 command-generation 前先冻结 19 个内置 command ID+路径 helper 进静态模块;migration.ts:48 与 profile-sync-drift.ts 也是消费者;quoteYamlValue 迁移。
- Phase B 陷阱:已装集合主源必须是 resolveDesiredWorkflowSelection(update.ts:154-160),**不得用 workflow artifact ledger**(只含 source==='user')。
- Phase C non-goal:expert _shared.ts PREAMBLE/dispatched 契约零改动。

## 运行时/模型指令(用户本次调用指定)
planner/reviewer=opus;implementer/fixer/shipper=sonnet;ship+archive 复用 implementer 会话(sessionReuse 指令)。

## 交付
子 change 全部 local 模式(只 commit,不 push);组合层一次交付,模式届时由用户/父级决定。commit 用 pathspec 显式提交(共享树纪律)。

## Child 1 propose 阶段发现(2026-07-22,line 号已对当前 worktree feat/skills-only-delivery 复核)
- **command-generation 消费者比 dev 文档多**。文档只点名 migration.ts:48 + profile-sync-drift.ts;实测 `grep -rln command-generation src/` 还牵出 3 个:`workflow-artifact-ledger.ts`(:7/:138-140/:248-250,CommandAdapterRegistry+getCommandFileId 解析命令路径)、`profile-editor.ts`(:17/:200,getCommandFileId)、`workflow-registry/types.ts`(:1/:39,definition 的 `command` 字段=CommandContent)。`codex-home.ts:7` 只是 stale 注释(无代码依赖,被 codex 模块广用,勿删勿动)。类型删除会在编译期把这些全逼出来(设计 D5),但 tasks 已逐条列明(task 2.3-2.6/4.4)避免实现者漏。
- **adapters 目录 27 项含 index.ts = 26 个真 adapter**(与文档"26"一致);`get*CommandTemplate` 导出 grep 实测正好 19 个(命令 ID 静态清单据此冻结)。
- **delta spec 面比文档 A9 大**:除 profiles/cli-init/cli-update 外,命令交付面在需求级还污染 5 个 spec,已一并做 delta 保持归档时套件自洽:cli-config(delivery picker + config set delivery 一致性)、config-key-registry(delivery 键从 registry 删)、workflow-template-parity(命令模板 hash 条目删)、workflow-library(definition command 字段/模板退役,泛化 ff 子句)、methodology-expert-fusion(scenario "skill and command templates"→仅 skill)。command-generation 整能力 REMOVED;新命令清理行为 ADDED 进 legacy-cleanup(不新建能力,循 RETIRED_WORKFLOW_COMMAND_IDS 先例)。共 10 个 delta spec。
- **legacy-cleanup 已有完美先例**:"Retired built-in workflow artifacts are pruned"(rasen-ff-change + ff command,spec :184-209)。新 ADDED 需求就是把它从"单个 ff"泛化到"全 19 内置命令 + -command/opsx 变体",实现者可直接照抄该 prune 的骨架。

## Child 2 propose 阶段发现(2026-07-22,child 1 已 ship 00451080 + archive 807e5431,tree 变化后复核)
- **nextSteps 字段名撞车 → 用 nextWorkflows**。`ChangeStatus.nextSteps: string[]` 早已存在(`instruction-loader.ts:159`,artifact 创作引导串)。dev 文档 B2 说加 `nextSteps:[{workflow,reason}]` 会重载同名字段炸既有消费者/测试。故新字段命名 **nextWorkflows**(语义仍是文档的),apply-instructions + status 两面统一用它。设计 D1 已记此偏离。
- **canonical 链条 id 是带后缀的真 id**:`ship-command`/`office-hours-command`/`verify`/`auto-command`(`workflow-registry/builtins.ts` BUILT_IN_WORKFLOW_IDS),不是 `ship`/`verify-change`。链条表节点必须用真 id 才能与 installed 集过滤对上。core 集(CORE_WORKFLOW_IDS)= propose/explore/apply/sync/archive/auto-command/help——**无 new/continue/verify/ship-command**,故 skip-ahead 是核心:apply.all_done→verify(缺)→ship-command(缺)→archive(装)=[archive]。展示层剥 `-command`(profiles picker 已有先例)。
- **installed 集配方**(= review Blocker 约束落地):`getGlobalConfig()`+`loadWorkflowCatalog()`+`resolveDesiredWorkflowSelection(catalog,profile,globalConfig.workflows,expertSelectionExplicit).ids`(照抄 `update.ts:140-181`;函数在 `profiles.ts:114`)。**严禁用 ledger**:`workflow-artifact-ledger.ts:262/310` 的 `source==='user'` filter 使其永不含内置链条 workflow,用它会把全部内置判为未装。tasks 2.1-2.2 建 helper + 回归断言钉死。
- **两面 state 映射**(设计 D4):apply-instructions 有真 `state`(blocked/ready/all_done)→ `resolveNextSteps('apply',state,...)`,是文档唯一验收面;status 只有 `isComplete`(artifact 级,看不到 task 状态)→ `resolveNextSteps('propose', isComplete?'artifacts-complete':'artifacts-pending',...)`,complete→[apply],pending→[](既有 nextSteps 串已引导创作)。status 不谎报它观测不到的 lifecycle 位。
- **模板正文里的 delivery/steering 是 child 3,不是这里**:`apply-change.ts:56/94/125`(硬编码 `/rasen:verify`→`/rasen:ship` steering,Phase B 运行时 nextSteps 要取代它、Phase C 删它)、`help.ts:98/125`(delivery both/skills 文案)=child 3 skill body 清洗。注意 `ship.ts`/`archive.ts`/`auto.ts` 里的 "delivery" 是**发布模式**(pr/push/local)另一义,正确,勿动。

## 残留 delivery-scrub backlog(child 1 Phase-A 未清干净,shipper-1 抽查发现;child 2 只折入 LEAD 点名的 2 处,其余待专项 sweep)
child 2 已折入(spec-only):cli-update REMOVE "Update respects delivery setting";profiles 命名档三需求(Named profile management / storage-validation / import-export)去 delivery(named-profiles.ts:46 保留 `delivery: z.unknown().optional()` 仅容忍旧 YAML,故 spec 改为"读时容忍并忽略")。**仍悬空、未清(判为陈旧措辞而非假硬契约,全清会撑爆 Phase-B change,建议专项 residual-delivery-scrub change 或并入 child 3 文档面)**:
- cli-update:`Config Application` scenario "generate skill/command files"(:65 应去 /command);`Smart Update Detection` 的 "delivery setting matches installed files" 门槛(:78)、"Profile or delivery drift"(:81-86)、"Removed: 4 command files (if delivery changed)"(:93);`Update detects configured tools from skills or commands` 的 "apply profile and delivery sync"(:126);`One-time migration` **写 `delivery:"both"` 进 config**(:138,唯一算假硬契约的一条——写退役键,建议优先清);`Extra workflows synchronized` 的 "respecting active delivery mode"(:247)+ "Delivery change with extra workflows" scenario(:250-255)。
- profiles:Purpose 散文 "with a delivery dimension independent of profile"(:4,delta 无法干净改散文);`Drift detection` 需求标题/正文 "Profile and delivery drift detection"(:26);`Config changes applied via update` scenario "updates profile or delivery via rasen profile"(:185)。
- **DEFAULT_CONFIG.delivery 实际在 :176**(文档写 :158,已漂;normalizeDelivery :61-68、update removeCommandFiles :564-590 / removeUnselectedCommandFiles :597-637 均核对无误)。
- **跨 child 边界(留给 child 3 / 组合层)**:skills-only 后 Claude Code 上 `/rasen:*` 冒号名不再解析(只剩 `/rasen-*` skill 目录名)。本 change 未改 CLI 输出里的 `/rasen:new` 等提示与 profiles/spec 的 `/rasen:*` 命名空间需求——按文档 C2 归 child 3 的 canonical-name 统一;组合层一次交付吸收此过渡态。若 reviewer 质疑 init 提示悬空,答:portfolio 序列 A→B→C 合并交付,C 收口。
- **config set delivery 的写路径**(设计 D4,文档未明说):registry 删 delivery 后裸删会让 `config set delivery` 报 unknown-key(比今天的优雅合并更差)。决定=delivery 进 retired-keys 集,写入=退役 notice + 不落盘,不崩。cli-config delta 已钉此可观测契约;具体机制留实现者裁量。

## Child 3 propose 阶段发现(2026-07-23,children 1-2 已 ship+archive:child1 00451080/807e5431,child2 2b336a47/e0aa036c)
- **C3/C4 张力已解**:C4 grep(生成 skill body 无 `/rasen:` 冒号)vs C3(_shared.ts 冻结,但其 :141-146/:349-351/:1533-1598 有冒号 dispatched-report 表)。关键实测:**workflow 模板不 import _shared.ts**(`grep _shared src/core/templates/workflows/` 空),故 C4 grep 只钉 **workflow skill body + navigator router body**,expert skill(含冻结 _shared)排除、历史档白名单。设计 D3 记此。
- **C1 steering 契约的家是 `lifecycle-stage-sequencing` spec**(两需求硬编码 `/rasen:verify`+`/rasen:ship`/`/rasen:apply`,且仍写 "skill and command" 未随 child1 更新)。C1 = MODIFY 这两需求为"转述 CLI nextWorkflows + 零 CLI 回退",不再编码链条顺序(顺序只活在 workflow-chain.ts)。站点:apply-change.ts:56/94/125、continue-change.ts:53。goal-iterate.ts:28 的 "steer" 是回合指导非链条,勿动。
- **冒号面比预想大**:除 workflow 模板(help.ts 19/onboard.ts 20/ship.ts 13/office-hours 8…)外,冒号 mandate 还写死在 5 个 spec 需求里,全 MODIFY 掉冒号强制以免与 C4 grep 矛盾:lifecycle-stage-sequencing、cli-init("Init output uses the rasen namespace" + "Smart defaults init flow" 成功消息 colon/hyphen 分支——顺带清 delivery(both)残留)、workflow-help-command、navigator-router-skill、methodology-expert-fusion(`/tdd`→rasen-tdd 等,bare-slash 非冒号但文档 C2 点名)。共 8 个 delta spec。
- **CLI 输出冒号**:init.ts:927/930 输出 `/rasen:propose`/`/rasen:new`(无条件冒号,且与 cli-init spec 的 colon/hyphen 分支本就不符)→ 改 canonical skill-dir 形(rasen-propose/rasen-new-change)全工具统一。
- **残留 delivery 已在本 change 清完**:cli-update 4 需求(Update-respects-global-profile-config 门槛、detects-configured-tools、One-time-migration 的 `delivery:"both"` 写 + `/rasen:propose` 冒号消息、Extra-workflows-synchronized 删 "Delivery change" scenario)+ profiles 2 需求(drift 标题、config-changes scenario)全 MODIFY。**代码早已 delivery-free**(grep 无 `delivery:"both"` 写),故纯 spec 面。
- **parity 金master 必更**:每碰一个模板 body,skill-templates-parity.test.ts 的 function-payload 与 generated-content 两张 hash 都变;已列为显式 task(5.3)避免实现者踩红。既有 grep 型断言先例:该测试的 "generates no workspace-planning residue (4.1)"。

## 组合层/后续 backlog(children 1-3 均未纳入,交用户/后续决策)
- **rasen-cli-identity:59 + spec-brand-consistency 的 `/rasen:` 冒号品牌治理**:identity spec 说 "slash-command prefix SHALL be `rasen:`(hyphen form for tools without colon support)"——已有 hyphen 回退子句故非假硬契约,但 skills-only 后全工具走 hyphen,冒号-primary 措辞陈旧。**未改**:重写品牌治理 spec 是独立品牌决策,应用户拍板(child 3 设计 D4)。
- **profiles/spec Purpose 散文 :4** "with a delivery dimension independent of profile"——delta 无法干净改 Purpose 散文层,遗留。
- 若干 docs 历史/archive 档仍带 `/rasen:` 冒号——C4 白名单有意保留为历史。
