# Planning Context — concept-coherence portfolio

## User intent (verbatim essence)
用户经过一场完整 office-hours 讨论后指示:"你来根据这些讨论的全部内容推进修改落地吧!使用worktree,开新的分支工作。" 即:把讨论收敛出的全部设计决策实现落地。工作树 `feat/concept-coherence`(基于 dev/0.1.5 @ 7fa4966,含 PR #13 workflow library + PR #15)。

## The converged conceptual model (write this down, it drives everything)
rasen 三概念是**两根轴**,不是一根轴上的三档:
- **schema**(`rasen schemas`)= 内容层,回答 what:方法论产出哪些文档、产物 DAG(目前唯一实例 spec-driven)。
- **workflow**(`rasen workflow list`)= 执行层·内循环,回答 how:一个任务单元在一个 session 里怎么跑(agent 自主规划,含调 subagent)。
- **pipeline**(`rasen pipeline list`)= 执行层·外循环,回答 when/sequence:多个内循环任务怎么被 harness(LEAD/autopilot)串起来推进。
命名决策:**三个名字都不改**(workflow 虽从外循环视角显大,但上游遗产 + GitHub Actions 同粒度先例 + 改名成本倒挂)。解法是把这个模型写成文档,不是换词。

## Decisions (all settled in discussion — do NOT relitigate)
1. **kind 分类(呈现层修复,非结构性搬家)**:WorkflowDefinition 加 `kind: 'task' | 'driver' | 'internal'`(未来收编专家后再加 `'expert'`)。auto-command/goal-command = driver(外循环引擎,消费 pipeline,不"属于"pipeline);goal-plan/goal-iterate/goal-report = internal(`workflow list` 默认隐藏);其余 = task。`list` 按 kind 分组展示。归属不动——它们必须留在 workflow library(唯一有安装能力的机制),搬进 pipeline 侧=再造第二套安装器,违背统一目标。
2. **删除 ff**:ff 的真实镜像是 propose(都是一口气生成全部 artifact,上游 PR #448 遗产),与 small-feature 的冲突是间接的。从 BUILT_IN_WORKFLOW_IDS/BUILT_IN_ADAPTERS 移除,不留 deprecation stub(不在 CORE 集合,propose 全覆盖)。迁移面:项目配置选装列表可能存 `ff`——未知 id 须容忍(警告不报错);update/drift-healing 清掉已装机器的 rasen-ff-change 残件;docs/help 里的引用清扫。上游 cherry-pick 摩擦接受(ff 模板品牌化时已全文改写,本来必冲突)。
3. **显式依赖图取代"必装公理"**:
   - 现状:`WorkflowDefinition.requires` 存在但 builtins 全空;真实依赖边在 pipeline YAML 的 `skill:` 字段(机器可读)+ skill 正文散文(须人工盘点一次,如 review-cycle 正文调 rasen:review)。"专家必装不可删"本质是"依赖图缺失的廉价兜底"(skill-generation.ts:139 "always installed regardless of workflowFilter")。
   - 目标:(a) 盘点并填充每个内置 workflow 的 requires.skills;(b) requires 槽位扩为 `{workflows, skills, pipelines, schemas}`(decompose stage 有 pipeline→pipeline 边,DEFAULT_CHILD_PIPELINE='small-feature';driver→pipeline 边;pipeline→schema 隐含边——schemas 槽本轮只做存在性校验,预留避免包格式 breaking);(c) 安装时解析依赖闭包连带安装;(d) `workflow delete` 引用计数守卫(被引用者拒删);(e) 质量底线语义从"全体必装"降级为"被依赖者受保护"+ 默认 profile 勾选。
4. **pipeline 外置 = 统一容器,不是第二个 PR #13**:`.rasenpkg` 扩展为可携带 pipeline(pipeline 本来就是 data-driven YAML,3f824ff)。要点:(a) CLI 动词对称——workflow 有 init/validate/import/export/delete,pipeline 组补齐同一动词组;(b) 版本兼容——包格式 min-rasen-version/manifestVersion 门禁,旧版导入给清晰拒绝;(c) 运行时前置探测——validatePipelineForExecution 扩展:扫全 stage(含 decompose 子 pipeline)生效 runtime,出现 codex 探测 CLI 可用性(codex --version 级),缺席则开跑前报错并提示角色覆盖/安装两条出路(现状:preflight 只查 skill 与子 pipeline,runtime 缺席会挂在 run 中途);(d) 信任模型写入文档——社区包=可执行 prompt,复用事务安装+digest+validate,workflow-author/workflow-review 专家扩展覆盖 pipeline authoring/审查,import 展示出处与 digest;不做签名体系。
5. **专家收编(殿后)**:21 个专家(experts.ts)迁入注册表挂 kind:'expert'。已缝合部分:碰撞检测已认 expert(registry.ts:118-122)、pipeline 校验认专家名单。要还的账:(a) 必装语义→改为依赖保护+profile 默认(靠 change 4 的引用计数);(b) sidecar 模型——专家 sidecar 是包内真实目录树(skills/experts/<id>/)+ sidecarSourceId 别名(qa-only 借 qa),workflow 单元是内联 files[];收编前须先决定 sidecar 进包格式的方式(内联=包膨胀 vs 目录拷贝=留特例),这是该 change 设计阶段的核心问题;(c) digest/drift-healing 扩覆盖;(d) spec+测试面。
6. **需求诚实度**:社区共享的现有证据=一位贡献者(pashifika/PR #13)。按"包=文件、分发=git/PR"设计,registry/marketplace 显式划出范围。

## Scope exclusions (declare in docs, do NOT implement)
- `-command` 后缀改名(ship-command→ship 等):兼容面大,单独排期,本轮不做。
- schema 收编进统一容器:本轮只在 requires 预留 schemas 槽,三层覆盖机制维持现状,文档里声明。
- 签名/marketplace 级信任基建:不做。

## Key code pointers (verified in discussion)
- `src/core/workflow-registry/builtins.ts` — BUILT_IN_WORKFLOW_IDS/CORE_WORKFLOW_IDS/BUILT_IN_ADAPTERS(ff 在 :67/:102;auto-command :78/:113;goal 三件套 :81-83/:116-118 skill-only)。
- `src/core/workflow-registry/experts.ts` — 21 专家简化表(id/dirName/template,无 digest/requires;sidecarSourceId :50)。
- `src/core/workflow-registry/registry.ts` — 碰撞检测,bySkill 已带 kind:'workflow'|'expert'(:112-122)。
- `src/core/shared/skill-generation.ts` — 专家无条件全装(:139-147);copySkillSidecars 目录拷贝+别名(:99-118)。
- `src/core/pipeline-registry/execution-validation.ts` — preflight 只查 skill+decompose 子 pipeline,不查 runtime。
- `src/core/pipeline-registry/types.ts` — AgentRuntimeSchema(claude|codex)、StageSchema、DEFAULT_CHILD_PIPELINE、PipelineYamlSchema。
- `pipelines/*/pipeline.yaml` — 7 条内置;full-feature 引用专家 rasen:review/cso/qa/qa-only/benchmark/design-review;small-feature 引用 rasen:review。
- `docs/workflow-packages.md` + `rasen/specs/workflow-library/spec.md` — PR #13 契约。
- 上游事实:ff 源自上游 PR #448(commit 1bc8495);"pipeline"概念纯 fork 自建(3f824ff)。

## Portfolio DAG (serial chain; rationale)
1. `concept-coherence-remove-ff` — 最小、可逆、无前置。
2. `concept-coherence-kind-taxonomy` — 与 1 同触 builtins.ts(文件重叠→串行),故依赖 1。
3. `concept-coherence-concept-docs` — 二轴模型文档(EN docs/ + zh docs/zh/ 对齐现有双语惯例);依赖 1、2(文档记述的是落地后状态;docs/ 目录与 1 的清扫可能重叠)。含 scope exclusions 声明。
4. `concept-coherence-dependency-graph` — 依赖 1(ff 出图)、2(kind 语义入 requires 校验);触 builtins/registry。
5. `concept-coherence-pipeline-library` — 依赖 4(requires 槽位与闭包解析是包依赖声明的地基)。
6. `concept-coherence-expert-integration` — 依赖 2(kind:'expert')、4(引用计数)、5(sidecar 进包格式的决定);殿后。

## Durable findings (appended by planners as siblings are proposed)
### remove-ff (change 1) — verified touchpoints & conventions
- **ff 模板是独立文件**:`src/core/templates/workflows/ff-change.ts` 只导出 ff 两模板,整文件可删;barrel 唯一 re-export 在 `src/core/templates/skill-templates.ts`(项目无 command-templates.ts,skill+command 都走这一个 barrel)。ff skill 名 `rasen-ff-change` 还硬编码在 `src/core/shared/tool-detection.ts` 的 `SKILL_NAMES`。
- **stale-id 现状=throw 非 warn**:`resolveWorkflowSelection`(workflow-registry/selection.ts:25)对未知 id 直接 `throw WorkflowSelectionError('unknown_workflow')`。`update.ts:118` 与 `init.ts:186,643` 直接拿 stored 全局配置喂它→删 id 后会崩。已存在的容忍先例:`skill-generation.ts:128,160` 用 `roots.filter((w)=>catalog.has(w))` 静默丢弃。方案:边界处 pre-filter+warn(建议抽 `filterKnownWorkflowRoots` 复用给后续 siblings),保持 resolver 本身严格;named-profile `.yaml`(named-profiles.ts:47-60)保持严格报错(显式创作即时反馈)。**后续 siblings 删 id 时同一坑**。
- **两套清理机制**:registry-derived `removeUnselectedSkillDirs`/`removeUnselectedCommandFiles`(update.ts:426/489)遍历 `getBuiltInWorkflowDefinitions()`——id 一旦离开 registry 就够不着,只能清"取消勾选但仍注册"的。**删除**的 id 必须走硬编码 retired-prune:先例 `pruneRetiredExpertSkillDirs`(legacy-cleanup.ts:31,前缀匹配)接在 update.ts:172-176 短路前、对每个 configured tool 跑。command 文件路径 adapter 相关,须经 command adapter 解析。建议抽 `RETIRED_WORKFLOW_SKILL_DIRS`/`RETIRED_WORKFLOW_COMMAND_IDS` 常量,后续 siblings 追加即可。
- **golden fixture 是变更探测器**:`test/fixtures/workflow-registry/builtins-v1.json` 被 `toEqual getBuiltInWorkflowDefinitions()`;`skill-templates-parity.test.ts` 钉每模板 SHA。改 builtins 必同步这两处(kind-taxonomy 同样会撞)。
- **delta rename 守卫**:改 requirement header/去引用=REMOVED 旧+ADDED 新(propose-workflow 用此);仅改 scenario 保留 header=MODIFIED 带全文(opsx-onboard-skill 用此)。`rasen validate --strict` 通过。
- **false positive**:`expert-dialogue-override` 的 "fast-forward" 是对话逃逸,非 ff 工作流,勿动。

### remove-ff apply/review (change 1) — implementer durable findings for siblings
- `src/locales/en.json`/`ja.json` 有按 workflow id 键控的 `profile.prompt.workflows` 平行表,被 `test/locales/catalog.test.ts` 1:1 对照 `ALL_WORKFLOWS`——builtins 增删 id 必须镜像,否则远处测试非直观地挂。
- `tool-detection.ts` 的 `SKILL_NAMES` 与 `COMMAND_IDS` 两张平行表都要与 builtins 联动;`COMMAND_IDS` 不被 golden fixture 覆盖,极易漏。
- golden fixture + parity SHA 是有意的变更探测器;模板正文变更(非仅注册表)还须重生成 `EXPECTED_FUNCTION_HASHES`/`EXPECTED_GENERATED_SKILL_CONTENT_HASHES`。
- 退役 id 的 docs 清扫别只按 tasks.md 点名文件——收尾必跑 `grep -rn '\bff\b' docs/`(滤掉历史/事故记录文档)级别的全量 sanity pass;zh 镜像文件会整个漏掉。
- 基线 7fa4966 存在 32 个确定性失败测试(management-api/daemon-lifecycle/file-system 诊断),与本 portfolio 无关,已记 portfolio 级 open item 待呈报用户。

### kind-taxonomy (change 2) — verified digest/package facts for siblings
- **两个 digest 各自 preimage 都不含 requires/recommends/kind**:`digestBuiltIn`(builtins.ts)=`{format,version,id,dirName,skill,command}`;`computeWorkflowDigest`(digest.ts)=`{format,version,id,files}`。→ 给 WorkflowDefinition 加 catalog 级字段(kind,及后续 requires 填充)只要不进这两个 preimage,digest 就零变、golden fixture 零变(fixture 只投影 id/skillName/dirName/commandId)、parity SHA 零变。**dependency-graph(change 4)填 requires 时同理:requires 已在 preimage 之外,填充不会引发 digest churn**——这是有意的先例,别把 requires/kind 塞进 digest。
- **package codec 只序列化 `{id,files,digest}`/workflow**(workflow-package/codec.ts;canonical fixture 证)。workflow 分类/依赖若来自 `workflow.yaml`(已在 files[] 内被 hash),就不新增序列化字段、不破包格式、不需 manifestVersion bump。**pipeline-library(change 5)携带 pipeline 时可复用此思路:数据进 yaml/文件即随 digest 走**。注意:codec 的 `kind`('workflow'|'profile')是包类型,与 WorkflowDefinition.kind('task'|'driver'|'internal')同名不同物,勿混。
- **manifest 是 z.strictObject**:加可选字段(default 值)对旧→新兼容;但新包声明新字段会被旧 CLI strict 拒——forward-compat 缺口正是 change 5 的 min-rasen-version/manifestVersion 门禁要解的。
- **深 equal 全 WorkflowDefinition 的测试**:`validator.test.ts` + `workflow-package/codec.test.ts` 构造期望定义——给定义加字段必同步这两处(非 golden-fixture 路径)。
- **locale 平行表二类**:除 `profile.prompt.workflows`(按 id,catalog.test 1:1 守)外,workflow UI 文案(section 标题等)也走 en.json/ja.json 双份,须 lockstep。

### kind-taxonomy apply (change 2) — implementer durable findings
- **第三个变更探测器**:`test/core/completions/command-registry.test.ts` 快照全部 CLI flag——新增任何 flag 必须同步 `src/core/completions/command-registry.ts` + en/ja locale 翻译表里的 flag 描述键,否则远处非直观地挂。change 4/5 大概率加 flag,必踩。
- 代码库里有三个互不相关的 "kind":WorkflowDefinition.kind(task/driver/internal)、.rasenpkg codec 的 kind(workflow/profile)、registry.ts bySkill 的 kind(workflow/expert)——触碰任一处时勿混淆。
- 实测确认 requires/recommends/kind 均在两个 digest preimage 与 golden fixture 投影之外——change 4 填 requires 零 fixture 扰动(跑测试验证过,非仅读码)。
- **LEAD 裁决**:docs/cli.md 与 docs/workflow-packages.md 从无 zh 镜像;kind 小节的 zh 化改道给 change 3(concept-docs),连同这两个文件是否全文翻译由 change 3 的 planner 定夺(最小方案:只译新增 kind 小节所在的上下文,不整文件翻译)。

### concept-docs (change 3) — verified docs-layer facts for siblings
- **docs 唯一自动化 tripwire**=`test/vocabulary-sweep.test.ts`:扫 `src/test/docs/scripts/.codex`,禁字面量 `context[-_ ]?store`(任何大小写/连字符);无品牌词表、无 docs 1:1 parity 测试。docs 改动只需躲开 "context store"。
- **docs 无机器强制 zh 镜像**:parity 是惯例非门禁,且已松(docs/workflow-packages.md 无 zh、docs/zh/ 有独有文件)。site l10n(`website-docs-l10n` spec)缺翻译回退英文+marker、build 仍过——新增英文 doc 不硬性要求 zh 对应文件。
- **发布门禁=`docs/website-manifest.json`**(`website-docs-manifest` spec):只有登记的文件才发布。**扩写已登记文件(如 concepts.md=slug core-concepts)零 manifest 改动;新增文件必须加 manifest 条目**——故 docs 优先扩写不新建。
- **概念术语坑**:`docs/concepts.md` 已定义 Schema(artifact-graph 义,L407+glossary),`glossary.md:61` 已有 "distinct from artifact schema and orchestration pipeline" 种子——写新概念别与之矛盾,引用勿重定义。**"two-axis" 已被 Standards+Spec 代码审查模型占用**,勿用作 schema/workflow/pipeline 模型名(改用 content/execution 层 + inner/outer loop)。"outer loop"/"harness" 在 README/faq 已是既有面向读者词汇,可锚定复用。
- **kind zh 改道处置**:docs/zh/cli.md 存在→就地补 kind 段;docs/zh/workflow-packages.md 不存在→整文件翻译显式 out-of-scope(英文回退),未来翻译 pass 再补。

### concept-docs apply (change 3) — implementer durable findings
- docs/zh/cli.md 原本整缺 `### rasen workflow` 与 `### rasen profile` 两节(英文-only PR 的既有欠账);本 change 补译了 workflow 节(kind 内容需要落点),profile 节仍缺——未来 docs pass 项。
- 除 vocabulary-sweep 外无任何 docs 对齐自动化(无 manifest/parity 测试)——zh 漂移只有人审能抓。
- `rasen pipeline list/show/agents/classify/resume` 是真实 CLI 子命令(src/cli/index.ts:604-710)但 docs/cli.md 完全未记载——pipeline-library(change 5)落地时应顺带补文档。

### dependency-graph (change 4) — audited edge inventory + pre-existing infra
- **审计出的真实依赖边**(design.md 有带 file:line 全表,复审据此):
  - pipeline→skill(7 条 pipeline.yaml 的 `skill:` 字段):full-feature 扇出最广(review/cso/benchmark/design-review/qa/qa-only + propose/apply/review-cycle/ship/archive/office-hours/retro);small/bug-fix/auto-decompose 走 propose→apply→(review)→(review-cycle)→ship→archive;goal-loop-{measure,evaluate,research}=goal-plan→goal-iterate→(ship/archive 或 report)。
  - pipeline→pipeline:仅 `childPipeline`(auto-decompose→small-feature 显式;`DEFAULT_CHILD_PIPELINE='small-feature'` 兜底)。driver 选 pipeline 在散文(auto.ts 选 small/full/bug-fix/auto-decompose;goal-command.ts 选三 goal-loop)。
  - 散文 dispatch(skill 正文):review-cycle⇒rasen-review;verify-enhanced⇒review/cso/qa/design-review/qa-only;`_orchestration.ts`(内联进 auto/goal-command/review-cycle)⇒rasen-review。
  - **导出的内置 requires 填充**:review-cycle.skills=[review];verify-enhanced.skills=[review,cso,qa,design-review,qa-only];auto-command.skills=[review]+pipelines=[small/full/bug-fix/auto-decompose];goal-command.pipelines=[三 goal-loop];其余全空。requires.workflows 内置全空(propose→apply 序列是 pipeline 表达非 workflow 硬边)。
  - 专家 21 个,唯一 sidecar 别名 qa-only→qa(experts.ts:50)。navigation 边(help、apply→verify→ship 等 `/rasen:x` 下一步提示)是软边,本轮不进 requires(保持"硬 requires=没它不能跑")。
- **两个使能设施已存在,大幅缩小本 change**:(1) `resolveWorkflowSelection`(selection.ts:38)**已**递归闭包 requires.workflows 并连带安装,内置/用户通吃、与 profile/workflowFilter 组合;(2) **delete refcount 守卫已存在**——`deleteWorkflow`(workflow-library.ts:525)拒删内置 + `scanWorkflowUsage`/`createWorkflowUsageContext`(:421)已扫 用户 requires.workflows + pipeline stage `skill:` 引用(workflowIdBySkillName)+ 全局配置 + named profiles + ledger,命中即抛 `workflow_in_use` 且列出 referrers。→ 本 change 真正新增只有:requires 加 pipelines/schemas 两槽 + 内置填充 + 新槽存在性校验 + delete `--force` 覆写。**child 6(专家收编)据此翻转 always-install**:装 requires.skills 并集+默认 profile,靠此守卫护住被依赖专家。
- **存在性校验 helper**:`listPipelines(projectRoot)`/`resolvePipelinePath`(pipeline-registry/resolver.ts)、`listSchemas(projectRoot)`(artifact-graph/resolver.ts)。requires.schemas 本轮仅存在性、预留,内置全空。
- **第三/四变更探测器复盘**:requires 在两 digest preimage 与 golden fixture 投影之外(kind 已实测证)→填充零 churn;但 `validator.test.ts`+`codec.test.ts` 深 equal 全 WorkflowDefinition,requires 加两槽必同步;`--force` 新 flag 必同步 `completions/command-registry.ts` 快照 + locale flag 描述键。

### dependency-graph apply (change 4) — implementer durable findings
- **skill 身份双形式陷阱**:碰撞映射同时认 `rasen:review`(template.name)与 `rasen-review`(dirName),但 catalog.ts:207 的 requires.skills 存在性校验只认冒号形式——用户 workflow 声明 hyphen 形式今天会校验失败。child 5 若复用/收紧此检查须知。
- **projectRoot 校验缺口**:validator.ts 调 resolvePipelinePath/listSchemas 时不带 projectRoot(目录级校验无项目上下文)→ requires.pipelines/schemas 只对 built-in+user 覆盖解析,项目本地 pipeline 不满足。child 5 要么给 validateWorkflowDirectory 加可选 projectRoot 参数,要么把检查挪到 catalog 期。
- `deleteWorkflow` 签名已变:`Promise<void>` → `Promise<DeleteWorkflowResult{forcedReferrers}>`;新增调用方必须处理返回值。

### pipeline-library (change 5) — packaging facts + SCOPE SPLIT recommendation
- **建议拆分**:decision #4 (a)-(d) 是两坨活。本 change 只提 **(a) 容器+CLI动词+delete守卫 + (b) 版本门禁 + child-4 projectRoot 缺口修复 + pipeline CLI 文档**(主题="打包/版本/装/删 pipeline",依赖 child 4)。**(c) 运行时 codex preflight + (d) author/review 专家扩展+信任文档** 建议另起 sibling `concept-coherence-pipeline-preflight-trust`(不同风险面:执行期行为 + 改专家模板会重生成 parity hash;(c) 基本独立可先行,(d) 依赖本 change 的 CLI 动词)。design.md 末尾有 sibling sketch。
- **codec 复用干净**:`RasenPackageSchema` 是 kind 判别联合(schema.ts:44),`computePackageDigest` 已把 kind 纳入摘要域(digest.ts:36)——加第三 kind='pipeline' 是联合插入。**profile 打包是精确先例**:无独立 importProfile,复用 `stagePackageWorkflows`+`commitWorkflowInstall({afterInstall})`,afterInstall 拿第二把锁写 kind 专属产物(named-profiles.ts:561-579)。pipeline 版:afterInstall 写 `getUserPipelinesDir()/<name>/pipeline.yaml`。**但** `validatePackageDomain`(codec.ts:291-430)是 workflow 形状,每个 `kind==='profile'` 分支(:208/245/395)都要加 `'pipeline'` 兄弟分支——主集成风险点。
- **pipeline = 目录含 pipeline.yaml**(非裸 .yaml);user 层=`getUserPipelinesDir()`=<globalData>/pipelines;三层优先级 project>user>package(resolver.ts:63)。user pipeline 今天无 manifest/无 digest——包携带即随文件 hash 走(复用"数据进文件、digest 覆盖")。
- **版本门禁现状=exact `formatVersion:z.literal(1)`,无 minRasenVersion 字段**。方案:加可选 minRasenVersion(semver)+ decodePackage 在 strict safeParse 前做 raw-json 版本预检,超版给清晰"升级 rasen"消息。formatVersion 保持 1(pipeline kind 是 v1 内联合扩展)。**诚实局限**:已发布旧 CLI 收到 kind:'pipeline' 包仍会在 discriminatedUnion 处不透明拒绝,无法回改——预检只让本/未来 CLI 成为好的前向兼容公民。
- **codex 可用性探测代码里不存在**(只有专家模板里的 shell 片段 `which codex`);preflight 探测是净新增,插入点 `validatePipelineForExecution`(execution-validation.ts:47,现只查 skill+decompose 子 pipeline,完全不扫 runtime)。→ 归 sibling (c)。
- **runtime 解析**:`resolveStageRuntimeConfig`(types.ts:449)优先级 stage.runtime→pipeline agents.<role>→'claude';无内置 pipeline 用 agents/codex。
- **skill 双形式**:pipeline.yaml 的 skill: 字段混用 `rasen-propose`(hyphen)与 `rasen:review`(colon)——pipeline validate/包域校验必须两形式都认(接 child-4 的双形式陷阱发现)。

### pipeline-preflight-trust (change 5b) — expert-hash churn + preflight seam
- **专家模板双钉**:`workflow-author`/`workflow-review` 在 `skill-templates-parity.test.ts` 被钉两处——`EXPECTED_FUNCTION_HASHES`(:139-140,函数体 hash)+ `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`(:186-187,按 dirName `rasen-workflow-author`/`rasen-workflow-review`)。改任一专家正文=重生成 4 个值。**child 6 收编专家也改这些模板→同样 4 值再动**(本 change 先行,child 6 后)。当前值(供实现者确认只这 4 个动):author fn=2070707436…/review fn=341e9e8c…;author content=6c220e31…/review content=4bb0575e…。
- **preflight 注入 seam**:`validatePipelineForExecution(pipeline, projectRoot, options?)` 加 `probeCodex` 可注入(默认真探测),按本仓既有约定(pipeline.ts:226"SEPARATE function accepts injected set"可测)。runtime 扫描复用 skill-loop 对 decompose 子 pipeline 的同一递归(execution-validation.ts:55-59)。**codex 探测函数净新增**放 `src/core/codex/availability.ts`(codex 模块已有但无探测)。每次调用最多探一次(memoize)。
- **依赖漂移标注**:5b 专家正文 + preflight 报错都引用 pipeline-library(5a)的 CLI 动词(`pipeline agents/init/validate/import`),5a apply 并发中——实现者须按 5a 最终动词面复核。
- **信任边界诚实语言**:digest=字节完整非安全;validate=结构非行为;review 专家=缓解非保证;无签名/无市场。child 3 在 concepts.md 声明位置,5b 在 docs/workflow-packages.md 落实操作面(zh 该文件不存在,整译 out-of-scope)。

### expert-integration (change 6) — capstone + SPLIT recommendation
- **建议再拆**:decision #5 = 收编 + 必装翻转,两坨。本 change=**6a 注册表统一(行为保持)**:21 专家进统一 catalog 挂 kind:'expert'+digest+sidecarSourceId、两 catalog 合一、callers 迁移、list 加 expert 组(默认可见)、delete 守卫扩到 requires.skills、golden fixture +21 行(有意 churn)。**装机行为不变**(仍全装,always-install 分支留着)。**建议 sibling `concept-coherence-expert-install-flip`(6b)= 必装翻转**:profile 默认∪依赖闭包 取代 skill-generation.ts:140,含既有装机迁移。6b 是全组合最险行为变更,隔离审。6b 设计已在本 change design.md "6b sibling design" 全落定(profile 集、迁移规则、测试面)。
- **sidecar 模型裁决=HYBRID**:保留目录拷贝物化(复用 copySkillSidecars 读 skills/experts/<sidecarSourceId??id>/)、built-in 专家 files[] 留空但 digest 覆盖 template+sidecar 树、**本轮专家不可 .rasenpkg 导出**(去掉内联的唯一驱动力)。inline files[] 会包膨胀+破 qa-only→qa 别名;若将来专家社区化可再内联(files[] 字段已在,前向兼容)。专家 digest preimage=`{format:'rasen-expert-digest',version:1,id,dirName,template,sidecars:[{path,sha256}]}`(第三种 preimage,别混 digestBuiltIn/computeWorkflowDigest)。
- **golden fixture 本轮真动**:合并后 built-in catalog 投影 +21 专家行(commandId:null,kind:expert)——`builtins-v1.json` 有意重生成。但专家模板 parity hash(author/review 那 4 个)本轮不动(6a 只改 wiring 非正文);若动=改动泄漏进模板。
- **delete 守卫缺口**:child 4 的 `createWorkflowUsageContext` 扫 requires.workflows + pipeline stage skill: 但**不扫 requires.skills**——6a 补上,专家(rasen-review 经 review-cycle/verify-enhanced/auto)才受保护。built-in 专家恒不可删(source:'built-in')。
- **21 专家/唯一别名**:experts.ts 全表 id/dirName/template/sidecarSourceId,唯一 qa-only→qa(:50);callers 8 处(execution-validation/skill-generation/transaction/registry/index + 测试 builtins.test/workflow-author-review)。

### planner retirement digest — cross-change conventions 5b/6/6b 的实现者与复审不可丢
1. **三个 digest preimage 互不相同,catalog 级字段(kind/requires)一律在外**:`digestBuiltIn`{format,version,id,dirName,skill,command}、`computeWorkflowDigest`{format,version,id,files}、新 `rasen-expert-digest`{...template,sidecars}。给定义加 kind/requires 零 digest/golden-fixture/parity churn——**唯一例外是 6a 的专家并入(有意 +21 fixture 行)**。别把分类/依赖塞进任何 preimage。
2. **四个变更探测器,改哪个必同步**:(a) `builtins-v1.json` golden fixture(投影 id/skillName/dirName/commandId;6a +kind);(b) `skill-templates-parity.test.ts` 的 `EXPECTED_FUNCTION_HASHES`+`EXPECTED_GENERATED_SKILL_CONTENT_HASHES`(改任何模板正文必重生成;5b/6 动 author/review 那 4 个);(c) `completions/command-registry.test.ts` 快照(新增任何 CLI flag/verb 必同步 command-registry.ts + en/ja flag 描述键);(d) `validator.test.ts`+`workflow-package/codec.test.ts` 深 equal 全 WorkflowDefinition(定义加字段必同步)。
3. **locale lockstep 两类**:`profile.prompt.workflows`(按 id,catalog.test 1:1 守 ALL_WORKFLOWS)+ workflow UI 文案/section 标题/flag 描述——en.json 与 ja.json 必须双份同改。
4. **五个同名不同物,勿混**:WorkflowDefinition.kind(task/driver/internal/expert)、.rasenpkg codec kind(workflow/profile/pipeline)、registry.ts bySkill kind(workflow/expert)、skill 身份双形式(`rasen:x` template.name vs `rasen-x` dirName——校验须两认)、package version(formatVersion vs minRasenVersion)。
5. **已存在设施复用,别重造**:workflow→workflow 闭包+连带安装=`resolveWorkflowSelection`(selection.ts:38);delete refcount 守卫=`deleteWorkflow`+`createWorkflowUsageContext`(6a 补 requires.skills 扫描);第三 package kind 复用 profile 打包先例(stagePackageWorkflows+commitWorkflowInstall({afterInstall}));存在性 helper listPipelines/resolvePipelinePath/listSchemas。
6. **诚实局限,复审别当 bug**:旧 CLI 收新 kind 包不透明拒(无法回改,minRasenVersion 只利本/未来 CLI);digest=完整性非安全;codex 探测净新增无既有 helper;专家必装翻转(6b)是最险变更须穷举测试。
7. **版本号归用户**:package.json 不 bump;minRasenVersion 从 package.json 读(版本无关)。每子 change 本地 ship 只 commit 不 push;父级一次性交付。
8. **worktree 并发**:planning-context.md 常被并发 session 改;append 型编辑先 Read 尾部再改;pathspec 提交防吞对方暂存。

### pipeline-library apply (change 5a) — implementer durable findings
- **staging 机器 root-check 有两个独立调用点**:stagePackageWorkflows 内部 + commitWorkflowInstall 对 plan.roots 的复验——pipeline 包必须让返回的 plan.roots=[](pipeline 名与 workflow root 不同 ID 空间)。6a 若为 expert 包复用此机器,两处都要查。
- **STORE_SELECTION_GUIDANCE 常量禁触**:被插值进 ~45 个 skill 模板、由 parity 测试钉哈希;新 CLI 动词加 --store/--project 时不能改它,改为在 command-registry.test.ts 的 guidance-completeness 断言里带理由豁免。未来所有 CLI 面工作同此。
- **pipeline 包校验刻意只做结构校验**(parsePipeline),不查 skill 存在性——import 时引用未装 skill 合法;这正是 5b 运行时 preflight 要在执行时收口的缺口(设计如此,非 bug)。

### preflight-trust apply (change 5b) — implementer durable findings
- **stale-id 第三调用点(真缺陷)**:resolvePipelineExecutionSkillSets(execution-validation.ts)经 getProfileWorkflows→resolveWorkflowSelection 读真实全局配置——存有已退役 `ff` 的机器跑 pipeline preflight 会 throw WorkflowSelectionError。remove-ff 只在 update/init 边界加了 filterKnownWorkflowRoots;此处同坑,5b review 轮修复。
- **测试隔离陷阱**:resolver.test.ts 的 `delete process.env.RASEN_HOME` 惯例会让 getGlobalConfig 落到本机真实 ~/.rasen;调 validatePipelineForExecution 的测试不得删 RASEN_HOME,只传 projectRoot。6a/6b 测试同防。
- **probe-once 靠单调用点性质成立**(先扫全 stage 得单布尔,再唯一调用点探测)——6a/6b 若改此函数形状,必须保持单调用点,否则 probe-once 契约静默破坏。

### expert-integration apply (6a) — implementer durable findings
- **目录统一的隐式假设面**:catalog.definitions 含专家后,三处"全目录=可选装 workflow"假设破裂并已修:skill-generation 双计入(过滤 kind!=='expert')、profile-editor 选择器(过滤)、profile-sync-drift 5 处 filter(source==='built-in' && kind!=='expert',否则全工具永久假阳性 drift)。**6b 翻转安装语义时这三处要反向重审**。
- requires.skills 双形式(冒号/连字符)解析已在 delete-guard 用 portablePathCollisionKey 映射统一;6b 闭包安装读 requires.skills 时复用同一解析,勿重推。
- getExpertSkillDefinitions/getExpertSkillNames 刻意保持静态表纯派生(不走 getBuiltInExpertDefinitions)避免热路径重复哈希 sidecar 树;要完整 WorkflowDefinition 形状时从已加载 catalog 过滤,别新鲜调用。

### 6a review — carried-forward items for 6b(install-flip)
- M1:named-profile 校验(validateProfileMembership 走 catalog.has)现静默接受 expert id 进 profile workflows 列表——今天功能惰性(getSkillTemplates 反正过滤),6b 翻转时必须显式定夺(专家可选装后此路径变实)。
- M2:getBuiltInExpertDefinitions 每次 loadWorkflowCatalog 重哈希 21 个 sidecar 文件,无 memo——6b 增加 catalog 载入前先加 memo。
- update.ts 的 removeUnselected* 仍绕过 catalog 直调 getBuiltInWorkflowDefinitions()——今天正确,6b 的天然接缝。
- T1:resolvePipelineExecutionSkillSets 对专家名重复入 Set(无害),顺手可简化。

### expert-install-flip (6b) — planner findings for implementer/reviewer
- **6a landed clean, verified against tree**:`getBuiltInCatalogDefinitions()`(registry.ts:73)=workflows+`getBuiltInExpertDefinitions()`;experts 在 catalog.definitions,靠 `kind==='expert'` 辨识;三处保持行为的过滤器就是本轮要反转的翻转点——skill-generation.ts:142-151(专家分支)、profile-editor.ts:145(picker `kind!=='expert'`)、profile-sync-drift.ts 五处 `source==='built-in' && kind!=='expert'`(:122,146,166,209,222)。
- **闭包边真值**(builtins.ts requires.skills):verify-enhanced-command→[review,cso,qa,design-review,qa-only];auto-command→[review];review-cycle→[review];goal-command 无专家。**benchmark 无任何 workflow requires.skills 引用**(只 full-feature pipeline.yaml 的 stage skill: 提)——闭包永远拉不到 benchmark,必须靠 profile default(quality floor)带入。这是矩阵 row5 的关键。
- **存储模型裁决=S1 统一**:专家 id 与 workflow id 同住 config.workflows/named-profile workflows 数组(不加平行 config.experts 字段)。validateProfileMembership 的 catalog.has 已接受(M1);本轮把它显式化+加测。**代价**:picker 专家元数据走新 `profile.prompt.experts` 表(按 id,新加 1:1 catalog-test 守卫);`ALL_WORKFLOWS`/`profile.prompt.workflows` 不动——catalog.test.ts:46 那条精确 1:1 断言绝不能碰(专家进 ALL_WORKFLOWS 会炸它)。专家保持独立 id 空间(digest #4 五同名不同物)。
- **闭包解析=opt-in**:`resolveWorkflowSelection` 只跟 requires.workflows;本轮加 `{includeSkillDependencies?:boolean}` 二签名,置位才跟 requires.skills(双形式经 portablePathCollisionKey 映射到 catalog 单元 id,复用 delete-guard workflow-library.ts:490-507 那套)。**必须 opt-in**:该 resolver 被 named-profiles normalize/export 复用,无条件加宽会把专家注入序列化快照;仅 install/remove/drift 的 desired-set 传该 flag,normalize/export 不传(快照保持精确所选)。
- **非回归迁移裁决=marker,不改 profile 标签、不改 config 读路径**:加机器管理布尔 `expertSelectionExplicit?:boolean`(global-config.ts,缺省=legacy,类比 telemetry.noticeSeen)。仅门控专家维度:未置位→`ALL_EXPERTS∪closure`(**与 profile 无关**),置位→D2 profile 默认∪closure。marker 只由显式写路径置位(applyProfileState/profile use/new/import/init 全新装),**update 绝不置位**(纯读→纯装,重跑 update 永保 21)。首次 legacy 分支 update 打一次性提示。这样 row1-3(存量 full/core/custom)全零回归。选 marker 而非 heuristic sentinel:post-flip `profile use core` 写 CORE+floor(有专家 id)vs 用户全去勾专家写 0——sentinel 二义,marker 无盲点。**诚实局限**:legacy core/custom 保 21 直到用户开一次 picker 才变精简(安全方向,永不静默删)——这是把 6a design 的 6b sketch(full 不变/core-custom 受 profile+closure 治理)与 lead 更严的"存量保 21"调和的方式:治理推迟到首次显式重选。
- **desired-set 单点**:init.ts:131 与 update.ts:131 已各自 `getProfileWorkflows→filterKnownWorkflowRoots→resolveWorkflowSelection.map(id)` 出一个 string[] 同喂 install(getSkillTemplates)+remove(removeUnselectedSkillDirs)+drift+ledger。把 expertSelectionExplicit 塞进 getProfileWorkflows、把 includeSkillDependencies 塞进 resolveWorkflowSelection,一处闭包全链一致——install 与 remove 永不打架。
- **removeUnselectedSkillDirs 今天只遍历 getBuiltInWorkflowDefinitions()(workflow-only),够不到专家目录**——本轮改遍历 getBuiltInCatalogDefinitions() 删 desired 外的内置单元;因 desired 已含所有 profile+closure+legacy 专家,受保护者永不被删。removeUnselectedCommandFiles 专家无 command(definition.command 检查自然跳过),无行为变化。
- **golden fixture + parity hash 本轮零动**:改的是 resolution/wiring,非模板正文/catalog 投影。若 builtins-v1.json 或 author/review 那 4 个 hash 动了=编辑漏进模板/投影,是缺陷信号——加断言钉住 byte 相同。
- **矩阵**:design.md 有 14 行 before/after install-set 全表(profile×marker×closure),复审据此当验收清单;row1-3+14=迁移非回归,row5-11=翻转语义,row12=6a delete 守卫交互,row13=qa-only→qa 别名选装。
- **delta 结构**:workflow-library(REMOVED 6a"install unchanged"+ADDED 翻转两 req)、profiles(MODIFIED Profile definitions/Named profile validation + ADDED picker 专家/迁移两 req)、cli-update(ADDED 专家装删+一次性迁移提示)。`rasen validate --strict` 已过。
- **测试隔离**:调 resolution 的测试**设** RASEN_HOME(别 delete,否则读真实 ~/.rasen);catalog.test.ts:46 1:1 断言、skill-generation.test.ts、profile-editor/drift、named-profiles/profiles 测试均须随专家装机改动同步。

## Constraints
- **版本号归用户管**:package.json 0.1.4 不动,任何发布性字符串版本无关。
- Windows 测试 flake:CLI-spawning 测试偶发 EBUSY/超时,隔离重跑确认,非逻辑回归不追。
- 全局 rasen 是 npm link 态指向主工作树 dist——worktree 里的构建不影响全局 CLI;测试用 worktree 内 pnpm test。
- 每个子 change 本地 ship(只 commit 不 push);全部完成后父级一次性交付(用户再定 push/PR)。
