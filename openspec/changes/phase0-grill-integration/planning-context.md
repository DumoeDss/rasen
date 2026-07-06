# Planning Context — phase0-grill-integration（父级规划容器）

> LEAD 播种（2026-07-06）。持久 planner：每次 propose 前先读本文件，researcher 只补缺口；每轮 propose 后把新决策 APPEND 到本文件。

## 用户意图（逐字要点）

在把本 fork（OpenSpec-code）产品化为 Elftia 的 elfspec 之前，先在 fork 本身做 Phase 0「清理 & 融入 grill skills」——fork 是用户日常开发在用的工具，清洗与瘦身立刻受益，且 elfspec 后续 vendor 直接继承干净内容。用户指令：按 0a→0b→0c 顺序；0c 只做**新增**（合并/吸收类推到 0d 用户细看后再做）；不停下来问；**每阶段结束提交代码（git commit，不 push）**。

## 权威输入（planner 必读）

1. **清算调研文档**（分级矩阵+清洗清单+吸收矩阵的 SSOT）：
   `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia\elftia\docs\dev\73_openspec_workflow_integration\skills-audit-gstack-grill.md`
2. **grill skills 源**（MIT，Matt Pocock）：`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\skills\skills\`
   - engineering/domain-modeling、engineering/codebase-design、engineering/tdd、engineering/prototype
   - productivity/writing-great-skills（作写作规范文档）
3. **本仓关键机制**：gstack 专家 = `skills/gstack/<name>/SKILL.md.tmpl` → `bun run gen:skill-docs`（`scripts/gen-skill-docs.ts`）渲染 SKILL.md；专家注册在 `src/core/templates/experts/*.ts`（运行时 readFileSync 读渲染后的 SKILL.md）+ installer 接线（`src/core/shared/skill-generation.ts::getSkillTemplates()`）。

## 三个子 change 的边界（不可越界）

### phase0a-cleanse（品牌/私仓/遥测/死桩清洗）
- Garry Tan / GStack 个人品牌、`ycombinator.com/apply?ref=gstack` 链接（office-hours、retro 卡片 "Powered by gstack · github.com/garrytan/gstack"）
- ship 的私仓细节：`bin/test-lane`、`RAILS_ENV=test`、`bin/rails db:migrate`、`structure.sql`、`test/evals/*_eval_runner.rb`、`EVAL_JUDGE_TIER`、`config/system_prompts/*.txt` → 改为通用多语言探测写法；co-author trailer 硬编码 `Claude Opus 4.6` → 去硬编码
- `~/.openspec/analytics/eureka.jsonl` 遥测路径：删除相关段落
- `# ... pending OpenSpec integration` 死桩 bash 块（review-log/dashboard/diff-scope/config-check 等）：删段（fork 里就是死代码）；retro 的 global 模式 pending 桩同理处理（删段或明确标注不可用，倾向删段）
- ⚠️ 清洗对象是 `skills/gstack/**/*.tmpl`（源）——SKILL.md 是生成物，改完跑 `gen:skill-docs` 重渲染；若 bun 不可用则同步手改 .tmpl 与 SKILL.md 并在 tasks 里注明
- ⚠️ `.claude/skills/review/*.md` 四个隐藏清单文件（checklist/design-checklist/greptile-triage/TODOS-format）若含品牌/私仓内容一并清洗
- 不改 openspec 自身品牌（fork 继续叫 openspec）

### phase0b-slim（瘦身硬删）
- 删 `skills/gstack/setup-browser-cookies/`、`skills/gstack/gstack-upgrade/`、`skills/gstack/conductor.json`
- 删除各 skill preamble 的 ETHOS 注入（用户已批准删）：`docs/ETHOS.md` + gen-skill-docs 的 `{{PREAMBLE}}` 机制处理——preamble 占位符改为空/移除，重渲染全部 SKILL.md
- 同步清理：expert 注册表 / installer / docs（AGENTS.md 目录表）里对被删 skill 的引用；upgrade preamble 内联调用 gstack-upgrade 的段落
- 不删部署三件套（land-and-deploy/setup-deploy/canary）、不删 plan 四件套（elfspec 项目类型覆盖储备）

### phase0c-grill-add（grill 新增，只做新增）
- 新增 4 个专家 skill（从 grill 源改写为 gstack .tmpl 形态）：`domain-modeling`、`codebase-design`、`tdd`、`prototype`
  - 保持 grill 原文精髓（leading words、可检验完成判据），去 Matt Pocock 个人化引用（issue tracker 配置引用改为通用措辞或指向本仓约定）
  - 注册进 `src/core/templates/experts/`（新 4 个 ts）+ `getSkillTemplates()`（生成为 `openspec-gstack-*`）+ 相关文档目录表
- `writing-great-skills` → 放 `docs/skill-authoring.md`（写作规范，非安装 skill），注明源自 mattpocock/skills（MIT）
- MIT 归属：新增内容含 Matt Pocock 版权归属注记（文件头注释或 docs 内 NOTICE 段）
- **不做**（0d 范围）：investigate×diagnosing-bugs 合并、review 双轴吸收、office-hours grilling 纪律、ask-matt 路由器

## 已定决策
- ETHOS preamble：删（用户批准）
- ship=每子 change 完成后 git commit（不 push）；commit message 常规规范，无硬编码模型 co-author
- 测试：改动后跑 gen:skill-docs 校验渲染 + 仓内相关测试（vitest 有 skill 生成断言，注意 delivery 全局配置影响的已知测试隔离问题）

## planner 调研纪要（0a）

> APPEND 于 2026-07-06（0a propose 完成后）。实地在 fork 仓（dev-harness）grep 落位，供后续兄弟 change propose 复用。

### 环境事实
- **bun 1.2.2 可用** → 无需手改双份；流程 = 改 `.tmpl`/`gen-skill-docs.ts`/`review/*.md` → `bun run gen:skill-docs` 重渲染 → `bun run skill:check`（dry-run 新鲜度门禁，exit 0 即 SKILL.md 与源一致）。
- 生成管线：`gen-skill-docs.ts` 从 `skills/gstack/<name>/SKILL.md.tmpl` 渲染 `SKILL.md`；`{{PLACEHOLDER}}` 由 generator 函数解析。**三类源**：(a) `.tmpl` 文件；(b) `gen-skill-docs.ts` generator 函数（注入内容 SSOT）；(c) `skills/gstack/review/*.md` **静态、非生成**（这就是上一轮 branding-migration「生成物无 CC+gstack」断言仍留 CC+gstack 残留的原因——静态文件从不重渲染）。

### 各污染类精确落位（dev-harness 快照行号）
- **Garry Tan/GStack 个人品牌**：`office-hours/SKILL.md.tmpl` 三张「A personal note from me, Garry Tan, the creator of GStack」founder card（~574/587/597）+ ycombinator ref（~580/591/601）；`retro/SKILL.md.tmpl` 「Powered by gstack · github.com/garrytan/gstack」card（~619）、garrytan EUREKA 例子（在 Eureka Moments 段内 ~178-179）、example JSON remote `garrytan/gstack`+name `gstack`（~748）、example 贡献者行「Garry Tan」（~364）；`review/greptile-triage.md` 「GStack reply」措辞（137/158/160/162/164/166）、`garrytan/myapp` 例子行（202-204）、`~/.gstack` 目录（188）；`review/checklist.md` 残留 `CC+gstack`（89）。**结构性命名 `skills/gstack/`、`openspec-gstack-*`、`gstack-diff-scope`/`browse/bin/remote-slug` bin 名——不清洗**。
- **ycombinator ref 链接**：仅 office-hours（上）。
- **ship 私仓细节**：`ship/SKILL.md.tmpl` Step 3 测试运行（108-118：`RAILS_ENV=test bin/rails db:migrate`/`bin/test-lane`/`structure.sql`/`npm run test`）+ Step 3.25 eval 套件整段（130-193：`test/evals/*_eval_runner.rb`/`EVAL_JUDGE_TIER`/`config/system_prompts/*.txt`/`app/services/*_prompt_builder.rb`/tier 成本表）。**关键**：`gen-skill-docs.ts::generateTestBootstrap`（~1216）**已经是全语言 runtime 检测**（Gemfile/package.json/go.mod/…），ship 硬编码 prose 与之自相矛盾——改写方向=复用该检测约定。
- **co-author 硬编码模型名**：`Claude Opus 4.6` 仅两处——`ship/SKILL.md.tmpl`（~408）、`document-release/SKILL.md.tmpl`（~282）。retro tmpl 274/483 只是通用「解析 Co-Authored-By trailer」描述，不含硬编码模型，**不动**。
- **eureka.jsonl 遥测**：**写**在 `gen-skill-docs.ts::generateSearchBeforeBuildingSection`（~323-327 jq append `~/.openspec/analytics/eureka.jsonl`）；**读**在 `retro/SKILL.md.tmpl` Eureka Moments 段（~170-183）；**clause**「Log the eureka moment (see preamble)」在 `office-hours`（322/324）、`design-consultation`（120）。EUREKA 命名法本身是推理技巧，保留；只删文件落盘。**注意**：与 PostHog `telemetry` capability（`src/telemetry/`）完全无关，勿碰。
- **pending OpenSpec integration 死桩**：8 个 tmpl（autoplan×3=393/395/400、codex=129、land-and-deploy=130+335、plan-ceo=750、plan-design=278、plan-eng=245、retro=512、ship=75）+ 2 个非-preamble generator（`generateReviewDashboard` ~1108、`generateDesignReviewLite` 736/761）。retro 512 是 global-mode「not yet available…stop」死路段。**design-review-lite 736 死注释上方有可用 `git diff|grep` fallback，只删死注释保留逻辑**。
- **preamble 边界（与 0b 协调）**：eureka 写块在 `generateSearchBeforeBuildingSection`（preamble bundle 内，0b 整删 preamble）。0a 只外科删该函数里的 jq 落盘 3-5 行，留周边 prose 给 0b；`generateCompletionStatus` 的 Plan Status Footer 死桩（~369）**preamble 内，留给 0b**。`generateReviewDashboard`/`generateDesignReviewLite` 是独立 `{{REVIEW_DASHBOARD}}`/`{{DESIGN_REVIEW_LITE}}` placeholder（**非 preamble**），preamble 删了仍在→0a 负责。两阶段顺序编辑同一函数但行区不重叠，无冲突。office-hours ~295「Read ETHOS.md…」是 ETHOS 删后悬挂引用，**归 0b**。

### review 隐藏清单文件更正
- 审查文档 §5 说的 `.claude/skills/review/*.md` **在本 fork 实际位于 `skills/gstack/review/`**（checklist.md / design-checklist.md / greptile-triage.md / TODOS-format.md 均存在）；它们是静态 md（非 .tmpl），直接改。ETHOS/AGENTS 也在 `skills/gstack/docs/`（非顶层 `docs/`）。

### 测试注意点
- 两个 vitest skill-gen 套件 `test/core/shared/skill-generation.test.ts` + `test/core/templates/skill-templates-parity.test.ts` **只覆盖 OPSX-core workflow 模板**（explore/propose/apply/…，`EXPECTED_FUNCTION_HASHES` 里全是 getExplore/New/… 无 gstack）→ 清洗 gstack 不会动它们；它们是「误伤 core」的回归哨兵，应保持绿。**真正门禁是 `bun run skill:check`**（新鲜度）。full `npm run test` 有已知 global-config 隔离 flake，targeted 跑上述两文件。
- 既有 capability `branding-migration` 已做过 CC+gstack→AI-assisted + garryslist.org；0a 是**扩展**它到个人品牌 prose/example data/静态 review 文件（MODIFIED 既有 CC+gstack 需求扩到静态文件 + ADDED 个人品牌需求）。`gstack-skills-integration` 有「~/.gstack→~/.openspec 路径迁移 + 非路径内容保留」需求——0a 的 greptile `~/.gstack` 归一化与之一致。

### 0a 产物（已 validate --strict 通过）
- proposal.md / design.md / specs（4 capability：MODIFIED `branding-migration` + ADDED `ship-portability`/`eureka-telemetry-removal`/`dead-stub-removal`）/ tasks.md（9 组，按文件分，§9 重渲染+验证收尾）。4/4 artifacts complete。

## planner 调研纪要（0b）

> APPEND 于 2026-07-06（0a 已归档 commit 0deed40 后、0b propose 完成）。**核心：实地核查发现现状与原始规划模型有两处 load-bearing 偏差，已在 0b design.md 的 D1/D2 落定并在 proposal「Scope reconciliation」flag。**

### ⚠️ 两处偏差（务必知悉，影响 0b 及后续对「preamble」的理解）
1. **ETHOS 不是文件注入，是 inline**：`skills/gstack/docs/ETHOS.md` 自称「injected into every skill preamble automatically」——**过时**。`gen-skill-docs.ts` 里**零** ETHOS 引用（grep 证实）。ETHOS 内容早已 inline 进两个子 generator：`generateCompletenessSection`（=ETHOS §1「Boil the Lake」/Completeness Principle）+ `generateSearchBeforeBuildingSection`（=ETHOS §2「Search Before Building」/三层/eureka）。所以「删 ETHOS preamble 注入」= 删这两个子 generator + 删 ETHOS.md 冗余 doc + 清 office-hours/plan-ceo-review/ARCHITECTURE.md 三处「Read ETHOS.md」文字引用。**`{{PREAMBLE}}` 占位符/机制不整删**（preamble-migration 早已把它 minimize 过）。原 planning-context「preamble 占位符改为空/移除」的表述基于 ETHOS=注入 的旧模型，不准确。
2. **LEAD 任务里的 `generateCompletionStatus` 疑为口误**：真正的 ethos 段是 `generateCompletenessSection`（Completeness/Boil-the-Lake），而 `generateCompletionStatus` 是功能性 DONE/BLOCKED 状态协议（非 builder-creed）。0b 采语义正确解：删 `generateCompletenessSection`+`generateSearchBeforeBuildingSection`，**保留** `generateCompletionStatus`/`generateAskUserFormat`/`generatePreambleBash`/`generateRepoModeSection`。已 flag LEAD 确认；若要更素的 preamble（连状态协议/AskUser 格式也删）是后续决定。

### 现状核查（prior changes 已部分施工）
- 既有 capability `preamble-migration`/`remove-gstack-features`/`remove-gstack-upgrade-skill` **已同步进 main specs 且已施工**：`generateUpgradeCheck`/`generateLakeIntro`/`generateContributorMode` 早删（gen-skill-docs 里是 `// REMOVED` 注释）；preamble 已 minimize；**`gstack-upgrade` expert `.ts` + 4 处 registration 已删**——但 `skills/gstack/gstack-upgrade/` 源目录、`scripts/skill-check.ts` 条目、docs 引用**仍残留**（半删状态）。
- `setup-browser-cookies` **完全在册**（与 gstack-upgrade 不同）：expert `src/core/templates/experts/setup-browser-cookies.ts` 存在 + 4 处 wiring（experts/index.ts:29、skill-templates.ts:54、skill-generation.ts:66 import+143 registration）+ gen-skill-docs.ts:831（design-review auth 提示 `/setup-browser-cookies`）+ skill-check.ts:29 + AGENTS.md:27。删它须四处 wiring 同删否则 **tsc 编译失败** → build check 是必需 gate。
- `conductor.json`：**零代码引用**（grep 空），直接删。
- `scripts/skill-check.ts` 有**显式 expected-skill 列表**（29 setup-browser-cookies、32 gstack-upgrade）；删目录不删列表条目 → `skill:check` 失败，须同改。
- 无任何 test 引用这些删除项或 ethos 段（grep test/ 空）→ 删除安全。两个 vitest skill-gen 套件仍只覆盖 OPSX-core，不含 gstack。

### 关键行号（post-0a 快照，编辑前复核）
- gen-skill-docs.ts：`generateCompletenessSection` 171-197、`generateSearchBeforeBuildingSection` 310-327、`generatePreamble` 380-388（drop 384/386 两 call）、AskUserFormat「(see Completeness Principle)」交叉引用 163、design-review `/setup-browser-cookies` 831。
- ETHOS 文字引用：office-hours.tmpl 295、plan-ceo-review.tmpl 210、docs/ARCHITECTURE.md 219。
- 删除项引用：skill-check.ts 29/32、AGENTS.md 27/32、ARCHITECTURE.md 215。
- **browse/test/gstack-update-check.test.ts 出 0b 范围**：测的是 browse 的 update-check 模块（≠gstack-upgrade expert skill），browse 属 productization adapter 重写，0b 不碰。

### 0b 产物（已 validate --strict 通过）
- proposal.md / design.md（D1 ETHOS inline、D2 命名 reconciliation、D3 两 skill 两删除态、D4 须编译+skill-check 同步、D5 显式 lookup、D6 AGENTS/ARCHITECTURE 处置）/ specs（4：MODIFIED `preamble-migration`+`remove-gstack-upgrade-skill`，ADDED `remove-setup-browser-cookies-skill`+`remove-conductor-config`）/ tasks.md（5 组，§5 render+build+skill-check+grep+vitest+validate 收尾）。4/4 complete。
- **未删**：deploy 三件套（land-and-deploy/setup-deploy/canary）、plan 四件套（autoplan/plan-ceo/plan-eng/plan-design）——项目类型覆盖储备，确认保留。
- **LEAD 裁决（2026-07-06）**：两处偏差均采纳 planner 语义正确解——①按 inline 模型删两 ethos 子 generator + ETHOS.md + 3 处引用，`{{PREAMBLE}}` 机制保留；②确系口误，删 `generateCompletenessSection`+`generateSearchBeforeBuildingSection`，保留 `generateCompletionStatus`/`generateAskUserFormat`/`generatePreambleBash`/`generateRepoModeSection`。0b 产物按现状定稿，无需修改。
