# Planning Context — remove-gstack-parallel-lifecycle

> LEAD 种子（2026-07-07）。planner 先读本文档，再只补缺口。本 change 是两步计划的第一步；
> 第二步 `fuse-methodology-into-opsx`（融合审计+实施）依赖本 change 完成后再 propose。

## 用户意图（逐字要点）

> 首先移除gstack的那一套平行生成周期。然后当时把grill都融合进了gstck，看有没有能融合进openspec的，
> 以及看gstack有没有能融合进openspec的。我们的主轴始终是openspec，尤其是workflow。

即：gstack 收编为纯专家层（被 OPSX workflow/流水线消费），凡与 OPSX 生命周期平行/重复的自有生命周期技能一律移除；
有价值的逻辑融合进 openspec workflow 而不是保留平行入口。
**注意**：phase0 时"plan 四件套保留作 elfspec 储备"的旧决策已被用户本指令显式推翻。

## LEAD 侦察结论（已核实，2026-07-07）

### 移除候选（9 个专家）与其依赖状况

| 技能 | 状况 | 处理 |
|---|---|---|
| `autoplan` | 纯平行规划流水线（对标 OPSX propose+review-loop） | 直接删 |
| `plan-ceo-review` | 同上 | 直接删 |
| `plan-eng-review` | 同上 | 直接删 |
| `plan-design-review` | 同上 | 直接删 |
| `land-and-deploy` | 部署生命周期；opsx:ship 注释称已融合其概念 | 直接删（确认 opsx:ship 无残留委托后） |
| `setup-deploy` | 部署生命周期 | 直接删 |
| `canary` | 部署生命周期 | 直接删 |
| `ship` | ⚠️ **opsx:ship 委托它**（`src/core/templates/workflows/ship.ts:54` "Invoke the /ship expert skill"，:72 有 fallback 段） | **先吸收后删**：把 opsx:ship 改为自包含（吸收 /ship 专家的测试/推送/PR 核心逻辑进 workflow 模板），再删专家 |
| `retro` | ⚠️ **opsx:retro 委托它**（`workflows/retro.ts:62` "Invoke the /retro expert skill"，:66 global 模式同样委托） | **先吸收后删**：opsx:retro 自包含（含 change-scoped/general/global 三模式的分析逻辑），再删专家 |

### 待 LEAD/用户在 propose gate 裁决的开放项

- `document-release`（更新文档以匹配发布）：release 生命周期边缘件，navigator 列为 related。
  planner 给出建议（删 or 留作专家待 change 2 融合审计），gate 时定。

### 明确不动的（专家层保留，被 OPSX 消费或属方法论/工具）

review、cso、qa、qa-only、benchmark、design-review（verify/review-cycle 消费）；investigate、careful、
office-hours（opsx 包装消费）；domain-modeling、codebase-design、tdd、prototype（change 2 融合对象，本 change 不碰）；
guard、freeze、unfreeze、codex、design-consultation、domain 类；navigator（**更新**其目录——删掉被移除技能的路由段，不删 navigator 本身）；
browse（独立子项目，历来不碰）；docs 目录。

### 依赖注意

- navigator tmpl 列出全部移除候选（`skills/gstack/navigator/SKILL.md.tmpl` ~57-71 的 related/deploy/plan 段）——须同步清理。
- `verify-enhanced` workflow 与 full-feature 流水线引用的是 review/cso/qa/benchmark/design-review，与本次移除无交集（planner 复核一遍 `src/core/pipeline-registry/` 内建流水线定义确认无引用）。

## 移除链机制（照抄 phase0b 的成熟做法——权威档案必读）

1. `openspec/changes/archive/2026-07-06-phase0-grill-integration/planning-context.md` 的"0b/0c 调研纪要"——
   注册链、计数、skill-check 语义全部在册，**不要重新调研这些机制**：
   - 每技能 4 处 wiring：expert `.ts`（`src/core/templates/experts/<name>.ts`）→ `experts/index.ts` export →
     `skill-templates.ts` re-export → `skill-generation.ts` import + `getSkillTemplates()` 条目；再加 `AGENTS.md` 目录表行。
   - 计数断言在 `test/core/shared/skill-generation.test.ts`（4 处 toHaveLength/计数——0c 后基线 46=17wf+29exp，
     本次删 9 个 expert 需重算；`profiles.test.ts:23` 数 workflow 17 不变，除非 opsx:ship/retro 模板改动影响 parity 哈希）。
   - `scripts/skill-check.ts` 的 `SKILL_FILES` 是 browse 命令校验的 curated 子集——删的技能若在列须同删（phase0b 有先例）。
   - `skills/gstack/<name>/` 源目录整删；改 `.tmpl` 后 `bun run gen:skill-docs` 重渲染 + `bun run skill:check`（bun 1.2.2 可用）。
   - 删 expert `.ts` 不同步删 4 处 wiring → **tsc 编译失败**，build 是必需门禁。
2. `skill-templates-parity.test.ts`：opsx:ship / opsx:retro workflow 模板被吸收改造 → EXPECTED hash 必然变，
   用测试自身 recipe 对着新 build 的 dist 重算（fix-pipeline-root-selection 两轮都这么做过，实现者知道流程）。
3. 安装侧：`openspec update --force` 重生成已安装 skills；被删技能的已安装目录如何清理，参考 phase0b 对
   update 卸载行为的处理（planner 核实 update 是否自动移除孤儿 skill 目录，不会则在 tasks 里加手动清理/提示）。

## 吸收（ship/retro → opsx 模板）的原则

- 主轴是 openspec workflow：吸收进 `src/core/templates/workflows/ship.ts` / `retro.ts` 的 instructions 字符串，
  不是复制 800 行 tmpl——提炼专家的**执行契约**（步骤、门禁、产物、失败路径），文风与现有 opsx 模板一致。
- opsx:ship 已有 ship-log.md/PR-from-proposal 逻辑，吸收的是 /ship 专家里 opsx 模板目前以"Invoke /ship"带过的细节
  （测试引导、push/PR 机制、fallback 已在模板里——对照后把仍缺的补进来）。
- gstack /ship /retro 里的 MIT/品牌清洗 phase0a 已做过，吸收内容是干净的。
- STORE_SELECTION_GUIDANCE 注入保持不变（两模板已有）。

## 验证标准

- `pnpm build` + `pnpm test` 全绿（Windows 偶发 spec.test.ts 超时/artifact-workflow EBUSY 为已知环境抖动，
  隔离重跑该文件绿即视为通过并记录）；跑完顺手 `openspec config list` 核对真实全局配置未被污染。
- `bun run gen:skill-docs` + `bun run skill:check` FRESH。
- `openspec update --force` 后安装侧无被删技能残留、opsx:ship/opsx:retro 生成物自包含（不再出现 "Invoke the /ship expert skill" 类委托字样）。
- grep 全仓（src/、skills/、docs/、AGENTS.md）无对被删 9 技能的悬挂引用（archive/ 历史档案除外——vocabulary-sweep 有 fork 级豁免惯例）。
- `openspec validate remove-gstack-parallel-lifecycle --strict` 通过。

## 已定决策

- plan 四件套"保留作储备"的 phase0 决策已被用户推翻——删。
- 别给 `skills/gstack/**/SKILL.md` 手改生成物——改 .tmpl 后重渲染（死胡同档案惯例）。
- 写新文档注意 `test/vocabulary-sweep.test.ts` 禁词。

## planner 调研纪要（propose 完成，2026-07-07）

> APPEND：propose gate 前实地核查，4/4 artifacts 已 validate --strict 通过。核实行号为 dev-harness 当前快照。

### 计数基线（种子里的 46=17wf+29exp 已过时）
- **当前 expert роster = 30**（`skill-generation.ts:184-215`），workflow = 18。删 9 → 21 exp。
- `test/core/shared/skill-generation.test.ts` **4 处断言**（唯一受影响测试计数）：L17 `48`(18wf+30exp)→39、L76 `34`(4wf+30exp)→25、L93 `30`(0wf+30exp)→21、L99 `31`(1wf+30exp)→22；顺带改行内 "30 expert" 注释。command 计数 18 不变（9 个是 expert 非 command）。

### ⚠️ parity 测试不受影响（推翻种子"移除链机制"point 2 的假设）
- `test/core/templates/skill-templates-parity.test.ts` 的 `EXPECTED_FUNCTION_HASHES`(L37-61)/`EXPECTED_GENERATED_SKILL_CONTENT_HASHES`(L63-75) 是**固定白名单**：只含 11 base workflow + 其 opsx command + feedback。**不含** getShipCommandSkillTemplate/getRetroCommandSkillTemplate、任何 OPSX-fusion workflow、任何 expert。→ 改 ship.ts/retro.ts + 删 9 expert **都不改任何 expected hash，无需重算 parity**。种子说"ship/retro 吸收→hash 必变"是错的。若 parity 变红=动错了模板集。
- `test/core/profiles.test.ts` 只数 workflow（ship-command/retro-command 是 workflow，保留）→ 不受影响。

### 各清理点确切落位
- **skill-check.ts `SKILL_FILES`(L19-37)**：含 9 候选中的 **8 个**（ship/retro/plan-ceo/plan-eng/plan-design/canary/land-and-deploy/setup-deploy）——autoplan **不在**；document-release 在（保留则不动）。删 8 条。
- **`skills/gstack/docs/AGENTS.md` 表**：只含 5 个（plan-ceo/plan-eng/plan-design/ship/retro）——autoplan/canary/land-and-deploy/setup-deploy 不在表；document-release 在。删 5 行。此 AGENTS.md 是静态 md 直接改（非生成）。
- **navigator tmpl(`skills/gstack/navigator/SKILL.md.tmpl`)**：删 standalone `/retro`(~58) + Deploy family 段(~60-64) + Plan family 段(~66-71)；**保留** main-flow item 7 `/opsx:retro`(~26) 与 `/document-release`(~57)。改 tmpl 后重渲染。
- **pipeline-registry**：grep 全目录对 9 候选**零引用**（已核实，种子 point 3 确认）。verify 系流水线只用 review/cso/qa/benchmark/design-review。

### update --force 孤儿清理答案（种子 point 4）
- **`openspec update --force` 不清理被删 expert 的已装目录**。`src/core/init.ts`：写循环(L582-604)只写当前 roster；`removeSkillDirs`(L830-849) 只遍历 `ALL_WORKFLOWS`×`WORKFLOW_TO_SKILL_DIR`——expert 非 workflow，永不被 prune。当前 `.claude/skills/openspec-gstack-{9个}` 全部实存。→ **tasks 已加手动删孤儿目录步骤**（6.4）。

### 吸收契约提炼（design D1）
- **opsx:ship**：替换 ship.ts:52-58"Invoke /ship"+fallback(72-76) 为自包含 merge-base→run-tests(fail-stop)→diff-review→fresh-verify-gate→push -u→gh pr create；**排除** gstack 店铺仪式（4位VERSION/CHANGELOG/TODOS/Greptile/eval tiers）。改 header 注释(4-5)。保留 ship-log/land-and-deploy/PR-from-proposal。
- **opsx:retro**：替换 retro.ts:62(general)/66(global) 委托为自包含 git 分析（commit/author/LOC/hotspot/streak + metrics + per-author leaderboard），写 OPSX 自有路径（retro-latest.md / retro-global-latest.md）；**排除** gstack `.context/retros/*.json` 持久化。change-scoped(2A) 不动。

### document-release 建议（gate 裁决项）
- **建议：本 change 保留，交 change-2 融合审计**。它是 doc-sync 工具非平行生命周期（不对标任何 OPSX 阶段）；opsx:ship(ship.ts:126) 与 gstack ship tmpl(Step 8.5) 都消费它；用户主轴是"删平行生命周期"，document-release 是**融合**候选（进 opsx:ship 或 opsx:archive）=change-2 的活。若 gate 要现删：+1 组四点删除、SKILL_FILES 1 条、AGENTS 1 行、navigator 1 行、ship 2 处引用，计数变 30→20。

## LEAD gate 裁决 + planner 修订（2026-07-07）

> APPEND：propose gate 用户**推翻** planner 的 document-release 保留建议——一并删除。移除集 = **10 个专家**，expert 计数 **30→20**。修订后 4/4 artifacts 已 re-validate --strict 通过。

- **计数（自算，勿信口算）**：full roster 48→**38**(18wf+20exp)、four-filter 34→**24**、no-match 30→**20**、single-filter 31→**21**。skill-generation.test.ts 4 处 + 行内注释。
- **skill-check.ts `SKILL_FILES`**：删 **9** 条（原 8 + `document-release/SKILL.md` @L31）；autoplan 仍不在列。
- **AGENTS.md（skills/gstack/docs/）**：删 **6** 行（原 5 + `/document-release` @L24）。
- **navigator tmpl**：额外删 `/document-release` bullet(~L57)（连同 standalone /retro、Deploy family、Plan family）。
- **ship.ts:126**：原"Run /document-release…"post-ship 建议**改为内联** doc-sync 指令（"update project documentation to match what shipped"），使 opsx:ship 自包含、无悬挂引用（design D1 已并入）。gstack ship tmpl Step 8.5 的 /document-release auto-invoke 未被吸收（属排除的店铺仪式），随 ship 专家源目录整删消失。
- **删除组**：document-release 与其余 9 个走同一四点+源目录删除链（3.1-3.5 已含）。孤儿目录清理(6.4)、dangling grep(6.6) 均加 `/document-release`。
- design.md「Open Questions」已改为 RESOLVED（用户 gate 推翻保留，2026-07-07）；D2 标题「seven→eight direct-delete」；Context/Goals/Migration 全部 nine→ten。

## apply 期主 spec 审计补漏（2026-07-07）

> APPEND：implementer 主 spec 审计发现 `openspec/specs/opsx-auto-command/spec.md` 有 LIVE 需求硬点名已删的 /autoplan。补一份 MODIFIED delta（现 5 个 delta spec，仍 4/4，re-validate --strict 通过）。

- **stale 落位**（opsx-auto-command 主 spec）：`Full Feature Pipeline` 需求（purpose ~L40「…autoplan/expert reviews…」、stage-order scenario ~L45、expert-selection scenario ~L51「SHALL invoke /autoplan」）+ `Expert Selection` 需求的「Autoplan for full features」scenario ~L129「SHALL invoke /autoplan」+ `Pause Points` 需求 scenario ~L86 括注「(propose/office-hours/autoplan)」。
- **src 侧干净**：`src/core/templates/workflows/auto.ts` 走 pipeline-registry classify/resume，**零** /autoplan 硬编码——只有 spec 文字过时。
- **delta 处理**（`specs/opsx-auto-command/spec.md`，MODIFIED 3 需求，全块复制+改）：Full Feature Pipeline 改为 propose + parallel expert reviews + review-loop（经 registry，verify stage 用 review/cso/benchmark/qa/design-review）；Expert Selection 的 scenario 改名「Planning for full features」并 SHALL NOT invoke /autoplan；Pause Points 括注去掉 autoplan。**ship/retro/archive 作为 pipeline STAGE 名保留不动**（LEAD 明示）。
- **无新 task**：纯 spec-only delta，archive 阶段把 delta 同步进主 spec，无需改 src 或手改主 spec。task 6.6 dangling grep 范围是 src/skills/docs（不含 openspec/specs/），主 spec 的 /autoplan 由 archive-sync 消除，非本 change 的 grep 门禁对象。
- proposal.md Modified Capabilities + Impact 已加 opsx-auto-command 行。
