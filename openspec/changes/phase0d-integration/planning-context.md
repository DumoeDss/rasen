# Planning Context — phase0d-integration（父级规划容器）

> LEAD 播种（2026-07-06）。持久 planner 续接 phase0 portfolio（你已持有 0a/0b/0c 的全部调研纪要，见 openspec/changes/archive/2026-07-06-phase0-grill-integration/planning-context.md——先把它读回来，那是你自己写的）。

## 用户意图

Phase 0（0a 清洗 `0deed40` / 0b 瘦身 `c41716f` / 0c grill 新增 `b041df0`）已全部落地归档。用户批准继续 0d：**grill 合并/吸收类工作 + phase0 过程中发现的三项遗留**。同样规则：不停下来问、每子 change 结束 git commit（不 push）。

## 权威输入

1. 0a/0b/0c 的 planning-context（归档目录内，你自己的调研纪要——行号需按 HEAD=3bd250a 重落位）
2. 清算调研文档 §3 吸收矩阵：`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia\elftia\docs\dev\73_openspec_workflow_integration\skills-audit-gstack-grill.md`
3. grill 源（MIT）：`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\skills\skills\`
   - engineering/diagnosing-bugs/（SKILL.md + hitl-loop.template.sh）
   - engineering/code-review/（双轴：Standards+Fowler 12 味 / Spec 忠实实现；并行子 agent 互不污染）
   - productivity/grilling/（一次一问、每问附推荐答案、能查代码就查）
   - engineering/ask-matt/（路由器模式：主流程 + on-ramp + 词汇层 + standalone 地图）
4. 本仓写作规范（0c 产物）：`docs/skill-authoring.md`——**0d 所有 skill 编辑必须遵守它**（leading words、可检验完成判据、no-op 逐句删）

## 三个子 change 边界

### phase0d-absorb（方法论吸收 + 两项小遗留）
- **d1 investigate 吸收 diagnosing-bugs**：合并**进既有 investigate skill，不改名不动注册/计数**（wiring 稳定压倒一切）。取 diagnosing-bugs 的「先造能变红的紧反馈回路，否则不许提假设」纪律 + 最小复现 + HITL 循环模板（hitl-loop.template.sh 作 sidecar 带入）；保留 investigate 的四阶段门禁（无根因不修）。两者重叠段去重，冲突时取更严格者。
- **d2 review 吸收双轴结构**：review 是 P0 工作马——**外科增量编辑，不重构现有结构**。吸收：Standards 轴（仓库规范 + Fowler 12 味 baseline，grill 原文该段可整段搬）与 Spec 轴（对照 proposal/tasks 忠实实现）作为并行 worker 指令、末尾并列呈现互不重排。与 review 现有 checklist 体系（review/*.md sidecar）协调，勿重复。
- **d3 office-hours 吸收 grilling 纪律**：访谈段落改为「一次只问一个问题、每问附推荐答案、提问前能查代码就查」；0a 清洗后的中性分层鼓励文案不受影响。
- **d6 allowed-tools 收紧**（0c review M1/M2）：逐 skill 对照 body 实际动作——codebase-design（advisory 词汇 skill，疑似只需读）、domain-modeling（写 ADR/CONTEXT.md 需 Write/Edit，Bash 疑似不需）。以 body 动作为准裁定，改 tmpl frontmatter。
- **d7 顶层 ./browse/SKILL.md ethos 残留**（0b review M1）：清 Boil-the-Lake / Search-Before-Building 手写段 + ETHOS.md 安装路径引用（该文件属独立 browse 包非 skills/gstack/browse，git tracked）。
- MIT 归属：吸收进 tmpl 的 grill 内容在改动段落附近加 adapted-from 注记（同 0c 惯例）。

### phase0d-router（新增路由器 skill）
- **d4 仿 ask-matt 模式新建本仓 skill 地图路由器**：把 OPSX 工作流命令（/opsx:*) + 29 个 gstack 专家画成「主流程 + on-ramp + 词汇层（domain-modeling/codebase-design）+ standalone」导航地图，供用户与 opsx-auto LEAD 选路。skill 名由 planner 提案（候选：navigator / guide——避免与任何现有名撞）；完整注册链 + 计数 +1（29→30 expert / 46→47 total，四处断言）；AGENTS.md +1 行；MIT 归属（adapted from ask-matt 模式）。
- 内容必须反映 0d-absorb 之后的 skill 集（依赖边的由来）。

### phase0d-sidecar-install（安装可移植性修复，纯 TS 代码）
- **d5 修 init.ts:553 只 copy SKILL.md 的先存缺陷**：expert skill 安装时 sidecar 参考文件不落地（0c 的 8 个 + review/qa 既有 sidecar + d1 新带入的 hitl 模板同病）。方案由 planner 调研定：copy 整个 skill 目录（需排除 browse 的 src/bin/dist 等非文档资产——注意 browse 目录很重）vs 白名单扩展名（*.md + *.sh?）vs manifest 声明。update.ts 同步；补测试断言 sidecar 落地；验证 `openspec update` 实跑。
- 行为变化写清楚（升级用户的既有安装会多出文件——预期内）。

## 已定决策
- investigate 不改名（wiring/计数稳定）
- review 只做外科增量，不重构
- 全部 skill 编辑遵守 docs/skill-authoring.md
- ship=每子 change git commit（不 push），排除无关 untracked（docs/upstream-v1.5-stores-and-resolution.md）
- 验证门与 phase0 相同：gen:skill-docs / tsc（涉 .ts 时）/ skill:check FRESH / vitest 哨兵（router 子涉计数）/ validate --strict；sidecar-install 子加实跑 openspec update 验证

## planner 调研纪要（0d-absorb）

> APPEND 于 2026-07-06（HEAD=3bd250a，0d-absorb propose 完成）。本子 change 内容级、无 .ts、无计数变化。

### grill 源（都 MIT clean，可整段搬）
- `diagnosing-bugs/SKILL.md`（134 行）+ `scripts/hitl-loop.template.sh`（1205B，step/capture 两 helper 的 HITL bash）。核心=Phase 1「先造 red-capable 紧反馈回路，否则不许提假设」+ 10 级构造梯 + minimise + 3-5 ranked falsifiable + 「无 correct seam 本身即 finding」。**要 genericize**：Phase 5 尾 `/improve-codebase-architecture` handoff（本仓无此 skill）。
- `code-review/SKILL.md`（89 行）：双轴（Standards=仓库规范+Fowler 12 味 baseline / Spec=忠实实现 originating spec），并行 sub-agent 互不污染，末尾并列不 rerank。**要 genericize**：`/setup-matt-pocock-skills` + `docs/agents/issue-tracker.md`（Matt 个人 issue-tracker 管道）——本仓 Spec 轴天然映射到 OpenSpec change 的 proposal.md/tasks.md，直接删这套管道。Fowler 12 味整段（Mysterious Name…Refused Bequest）是纯新内容，checklist.md 现无。
- `grilling/SKILL.md`（12 行）：一次一问+等回应、每问附推荐答案、能查代码就查。

### 各 skill 现状与落点（HEAD 3bd250a）
- **investigate tmpl 197 行**：Iron Law + Phase1 Root Cause + Scope Lock(freeze) + Phase2 Pattern + Phase3 Hypothesis(3-strike) + Phase4 Impl + Phase5 Verify。d1=在假设前插「反馈回路」phase + minimise + instrument；重叠(假设/回归)取更严格者；名/注册/计数不动。sidecar 落 `investigate/scripts/`（现无 scripts 目录）。
- **review tmpl 259 行**（已从旧 753 瘦身）：Step1 branch/1.5 scope/**Step2 读 `.claude/skills/review/checklist.md`**/2.5 Greptile/Step3 diff/**Step4 Two-pass review**（读 checklist 跑 CRITICAL+INFORMATIONAL 两 pass）/4.5 design/4.75 test-cov/Step5 Fix-First/5.5 TODOS/5.6 doc。d2 外科：Step4 加 Standards/Spec 双轴 orchestration（可并行 Agent worker）；**Fowler baseline 放 checklist.md**（Step2 已读它，避免 tmpl 重复）；**checklist.md 现无 Fowler**（grep 证实，纯新增）。review 在 SKILL_FILES→skill:check 会校验。
- **office-hours tmpl**：Phase 2A/2B 访谈已有「STOP after each question. Wait」（一次一问✓），但缺「每问附推荐答案」+「能查代码就查」——d3 补这两条为「Interview discipline」note。0a 中性化鼓励文案不动。
- **d6 tool 收紧（body 实证）**：codebase-design body 纯 advisory（读代码+推理接口；DESIGN-IT-TWICE spawn sub-agent 不受 allowed-tools 管；无 write/bash）→ `Read,Grep,Glob,AskUserQuestion`（去 Write/Edit/Bash）。domain-modeling body 写 CONTEXT.md/ADR（Write/Edit）+ 交叉引用代码（Read/Grep/Glob）+ 无 bash → 去 Bash。

### ⚠️ d7 关键发现（与 LEAD「手写段」框架略有出入）
- 顶层 `browse/SKILL.md` 的 ethos **不在其 .tmpl**（.tmpl 只有 `{{PREAMBLE}}` 等占位符、干净、与 `skills/gstack/browse/SKILL.md.tmpl` 字节相同 mod 行尾）。它是**独立 browse 包 vendored 的陈旧生成物**：主 `gen-skill-docs` 只扫 `SKILLS_DIR=skills/gstack`（顶层 ./browse 在循环外），所以 `skills/gstack/browse/SKILL.md` 已是**干净**生成物（ethos 计数 0），而顶层 `browse/SKILL.md` 停留在 0b 删 preamble 前、仍带 LAKE_INTRO/Boil-the-Lake/Search-Before-Building(含 eureka.jsonl 写 + ETHOS.md 引 + garryslist)。→ d7=直接删顶层 `.md` 里那几段（不改 .tmpl，它已干净），改后应等于 `skills/gstack/browse/SKILL.md`。**顶层 browse 不在 freshness 循环**（所以它悄悄 stale 没被抓）——re-wire/de-vendor 属 browse 产品化，非本次。

### 0d-absorb 产物（已 validate --strict 通过）
- proposal / design（D1 investigate 9 段合并骨架、D2 review 双轴+Spec 轴映射 OpenSpec change、D3 office-hours discipline note、D4 d6 body 实证、D5 d7 stale-vendored 机制、D6 MIT）/ specs（5 ADDED：investigate-diagnosing-absorption / review-two-axis-absorption / office-hours-grilling-absorption / methodology-skill-tool-scoping / browse-skill-ethos-cleanup）/ tasks（6 组 d1/d2/d3/d6/d7 + §6 render+skill:check+spot-check+vitest+validate）。4/4 complete。无 .ts 无计数→无 build gate、vitest 两套件应原样绿。
- **router 子（下个）注意**：内容须反映 0d-absorb 后的 skill 集（investigate 已并入 diagnosing 纪律、review 已双轴）；计数 +1（29→30 exp/46→47 total，四处断言在 skill-generation.test.ts）。
- **sidecar-install 子注意**：d1 新带入的 `investigate/scripts/hitl-loop.template.sh` + review/*.md + 0c 八个 sidecar 都靠 d5 修 init.ts:553 才能落地。
