# Planning Context — fuse-methodology-into-opsx

> LEAD 种子（2026-07-07）。两步计划的第二步；前置 change `remove-gstack-parallel-lifecycle`
> 已 shipped + 归档（commit 8d6ae87 / 6aea2f3），expert 名册现为 20。

## 用户意图（逐字要点）

> 然后当时把grill都融合进了gstck，看有没有能融合进openspec的，以及看gstack有没有能融合进openspec的。
> 我们的主轴始终是openspec，尤其是workflow。

即：**融合审计 + 实施**。两个方向：
1. **grill 四件**（domain-modeling / codebase-design / tdd / prototype，phase0c 引入）——目前只有注册接线，
   零 OPSX 消费方（pipeline registry、workflow 模板均无引用，2026-07-07 LEAD grep 核实）。产物（ADR/CONTEXT.md）
   不落 change 目录，活在平行世界。
2. **其余 gstack 专家**——审计还有什么该融进 openspec workflow（教学引用、阶段接线、产物路径收编），
   而不是仅作为可直调技能存在。

## 背景：当前 20 个专家的融合状态（LEAD 早前分析）

- **已接线**（verify/review-cycle/opsx 包装消费，不需要动）：review、cso、qa、qa-only、benchmark、design-review、
  investigate（有吸收史）、office-hours（opsx 包装）。
- **未接线**（本 change 主对象）：domain-modeling、codebase-design、tdd、prototype。
- **其他待审计**：careful、codex、design-consultation、guard、freeze、unfreeze、navigator（路由器，特殊）、browse（独立子项目，不碰）。

## LEAD 预设的融合方向（planner 审计后可修正，但方向偏差要给理由）

1. **propose 阶段**：设计密集型 change → planner 指引咨询 codebase-design（接口设计、design-it-twice）与
   domain-modeling（领域建模）；产物收编——ADR/领域决策并入 change 目录的 design.md（Decisions 节）或
   `openspec/changes/<n>/` 下的附属文档，不再写 gstack 自有路径。
2. **apply 阶段**：模板提及 tdd 纪律作为实现选项（测试先行的可检验判据）。
3. **explore / office-hours**：提及 prototype（动手探路）作为技术探索手段。
4. **审计题**：careful（谨慎实施纪律）是否该被 apply 引用；guard/freeze/unfreeze（范围锁）是否该被
   review-cycle/apply 引用；design-consultation 与 design-review 的分工是否需要 opsx 侧说明；
   codex（外部第二意见）已被 review 双轴吸收过一部分——还有没有 opsx 侧接点。
   审计结论允许"不融合"（保持纯专家层），但要写明理由。
5. **navigator**：融合后更新路由描述，确保仍与现实一致。

## 附带清理（上一 change 归档时 archiver 上报的尾巴）

7 个主 spec 的**示例文本**仍引用已删技能（多为 `enhance: "plan-ceo-review"` 示例和
"inspect skills/gstack/<removed>/SKILL.md.tmpl" 场景）：ship-portability、dead-stub-removal、
preamble-migration、skill-name-prefix、schema-enhance-field、instruction-loader、artifact-graph。
不违反 validate --strict（结构校验不查跨文件存在性），但属陈旧示例——本 change 出 MODIFIED delta
把示例换成仍存在的技能（如 benchmark/review）。

## 机制注意（沿用既有档案，不要重新调研）

- gstack 层改动 = 改 `.tmpl` → `bun run gen:skill-docs` → `bun run skill:check`；opsx workflow 层 =
  `src/core/templates/workflows/*.ts`。两条管线的边界与 parity 测试白名单见
  `openspec/changes/archive/2026-07-07-remove-gstack-parallel-lifecycle/planning-context.md`
  （parity 白名单只含 11 个 base workflow——改 opsx:propose/apply/explore 是否命中白名单，**planner 必须实地核对**
  EXPECTED_FUNCTION_HASHES，命中则按测试自身 recipe 重算）。
- 专家 tmpl 若改 frontmatter/allowed-tools，重渲染后安装侧要 `openspec update --force`。
- 产物路径收编若涉及"从 `openspec status --json` 的 `changeRoot` 取绝对路径"，沿用
  fix-pipeline-root-selection 建立的教学惯例。
- 全量测试的 Windows temp-dir 抖动（超时/EBUSY/EPERM，文件随机）：未触碰文件隔离重跑绿即过，记录之。
- 跑完全量测试后 `openspec config list` 核对真实全局配置未被污染。

## 验证标准

- 融合审计矩阵落在 design.md：每个未接线/待审计专家 → 融合动作或"保持纯专家层"的理由。
- 实施后：OPSX workflow 模板引用的技能全部真实存在；grill 四件的产物指引指向 change 目录；
  `bun run skill:check` FRESH；`pnpm build && pnpm test` 绿；validate --strict 过；
  7 个主 spec 的陈旧示例 delta 完成。
- 不新增平行入口；不复活已删技能。

## 已定决策

- 主轴 = openspec workflow；gstack 收编为被消费的专家层。
- browse 子项目不碰（产品化专项）。
- 别手改生成的 SKILL.md；别把 validate 改弱来"消除"什么。

## planner 调研纪要（propose 完成，2026-07-07）

> APPEND：4/4 artifacts 已 validate --strict 通过（5 delta spec：1 新 methodology-expert-fusion + 4 MODIFIED 示例）。行号为当前快照。

### parity 白名单核对（种子要求实地核对——命中）
- propose/apply/explore **全部命中** parity 白名单：`test/core/templates/skill-templates-parity.test.ts` `EXPECTED_FUNCTION_HASHES` 含 getExploreSkillTemplate/getApplyChangeSkillTemplate/getOpsxProposeSkillTemplate + 三个 command 版（getOpsxExplore/Apply/ProposeCommandTemplate）；`EXPECTED_GENERATED_SKILL_CONTENT_HASHES` 含 openspec-explore/openspec-apply-change/openspec-propose。→ **改这三模板要重算 9 个 hash**（6 function + 3 content），用测试自身 recipe 对新 build dist 重算。这与 change 1 相反（那次改 ship/retro workflow 不在白名单）。
- 每个模板文件同时导出 skill + command 两个近乎重复的模板——融合文字要**两处都加**。

### ⚠️ 关键实地发现：schema.yaml enhance 是 LIVE bug（非仅示例）
- `schemas/spec-driven/schema.yaml` 三个 artifact 的 `enhance` 指向已删 plan-review 技能：proposal:28 `plan-ceo-review`、specs:83 `plan-design-review`、design:112 `plan-eng-review`。→ `openspec instructions` **当前就在叫用户调用已删技能**。这是 change 1 遗漏的真 bug（change 1 dangling grep 范围 src/skills/docs，漏了 scripts/ 和 schemas/）。
- **无任何 test 断言 enhance 值**（grep test/ 空）→ retarget 安全。
- 处理（design D3，gate 主决策）：proposal/specs **删 enhance**（无幸存的 proposal/spec 审查者），design.enhance→**codebase-design**（融合落点）。备选：三者都 retarget 到幸存技能（proposal→office-hours、specs→review、design→codebase-design）。

### 其他 LIVE 悬挂引用（change 1 漏、本 change 一并清）
- `scripts/gen-skill-docs.ts` `generatePlanFileReviewReport`（L1064，占位 `{{PLAN_FILE_REVIEW_REPORT}}` 注册 L1976）被**幸存的 codex** 技能消费（`codex/SKILL.md.tmpl:132`）——L1081-1087 列 plan-ceo/eng/design JSONL 字段（死）。删这三条 bullet，留 codex-review。
- `{{TEST_COVERAGE_AUDIT_PLAN}}`（gen-skill-docs L1293 注释）**零幸存消费者**（grep skills/ 空，唯一消费者 plan-eng-review 已删）→ 死代码，删 mode+注释。
- `skills/gstack/docs/ARCHITECTURE.md:203` BASE_BRANCH_DETECT 例子 `(ship, review, qa, plan-ceo-review)` → `(review, qa)`。

### 融合矩阵头条决策（design.md 全表）
- **FUSE 4**：codebase-design→propose(+design.enhance)、domain-modeling→propose、tdd→apply、prototype→explore；产物收编 change 目录（design D2）。教学级条件引用，**不内联 body**。
- **LIGHT WIRE 1**：careful→apply guardrail 一行（破坏性操作）。
- **KEEP PURE 5**：guard/freeze/unfreeze（情境手动范围锁，非流水线阶段）、design-consultation（greenfield，navigator 已区分 vs design-review）、codex（外部二意见，已被 review-cycle 触及；只清死 plan-review 生成段）。
- **navigator 不改**（已映射 grill-4，融合后仍准确，因专家保持可直调）；**browse 不碰**。

### 7 个陈旧示例 spec 的分诊（design D5，偏离种子"全 7 修"——给理由）
- **4 个出 MODIFIED delta**（真实可修）：artifact-graph / schema-enhance-field / instruction-loader（plan-ceo-review 例→`review`）+ preamble-migration（ETHOS 清理文件列表删 plan-ceo-review 项，留 office-hours+ARCHITECTURE）。
- **3 个建议留作历史**（gate 裁决项 2）：ship-portability（整条需求就是关于已删 ship/document-release）、dead-stub-removal（死桩文件列表多为已删 tmpl）、skill-name-prefix（"28 技能"改名映射 + getGstackUpgradeSkillTemplate scenario 已不可解）。示例替换会歪曲已完成的一次性迁移；诚实做法是 REMOVED-requirement（archive 时从主 spec 删除，丢历史）——故建议不动。

### 无需改的 test 计数
- 融合不增删专家（grill-4 仍注册）→ skill-generation.test.ts 计数（20 exp）不变；profiles.test.ts（workflow 18）不变。唯一 test 改动 = parity 9 hash 重算。

## LEAD gate 裁决 + planner 修订（2026-07-07）

> APPEND：propose gate 两裁决。修订后 8 个 delta spec，re-validate --strict 通过。

1. **enhance**：采纳推荐——proposal/specs 删 enhance，design.enhance→codebase-design。artifacts 已是此primary，无需改。
2. **7 个陈旧 spec**：推翻 fix-4-keep-3，**全部 7 个都出 delta**。理由（用户）：openspec/specs/ 是系统当前真相，不得携带关于已删技能的需求（即便作历史）；历史记录活在 openspec/changes/archive/ 原始 change 目录。按**逐需求**判 REMOVED/MODIFIED（非逐文件）。

### 逐 spec REMOVED/MODIFIED breakdown（新增 3 个 delta）
- **ship-portability** → **全 REMOVED**（3 需求全是关于已删 ship/document-release 的 .tmpl；Reason+Migration 指向 /opsx:ship）。archive-sync 后该 capability 变空，预期从 specs/ 移除。
- **dead-stub-removal** → **1 MODIFIED + 1 REMOVED**：MODIFIED「no pending stubs in skill sources」（scenario 文件列表收窄到幸存的 codex tmpl；保留 design-review-lite diff-scope scenario）；REMOVED「Retro global-mode dead path」（retro 已删）。第 3 需求「no stubs in generator functions」约束 gen-skill-docs.ts 非删技能，**不入 delta**（未变）。
- **skill-name-prefix** → **3 MODIFIED**：删「28」计数（改「all gstack expert skill templates」）、删已删技能映射行、删「gstack-upgrade drops redundant prefix」scenario（getGstackUpgradeSkillTemplate 已不存在）；prefix/dirName/author 规则本身对现役 20 experts 仍真，保留 + 代表性幸存示例。
- 已有 4 个（artifact-graph/schema-enhance-field/instruction-loader/preamble-migration）不变。

### 修订面
- proposal.md：Modified Capabilities +dead-stub-removal/skill-name-prefix；新增 Removed Capabilities 节（ship-portability）；「What Changes」stale-example 行改为全 7 + 逐需求。
- design.md D5 重写（记录 gate 推翻 2026-07-07 + 逐 spec breakdown + archive-sync 预期）；Open Questions 两项均标 RESOLVED。
- tasks.md 第 8 组扩为全 7 + 8.5 archive-sync 校验（确认 REMOVED 生效、ship-portability 空 capability 被 sync 移除）。
- **REMOVED 需 Reason + Migration**（schema 要求），已写。archive 时 REMOVED 需求从主 spec 删除——这正是用户要的「specs/ 不留已删技能」。
