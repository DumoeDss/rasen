# Planning Context: unify-expert-template-pipeline

> LEAD 播种（Step B.1）。planner 先读本文件，再补充缺失研究——不要从零开始。

## 用户意图（原话，已拍板，勿重新论证方向）

> 把 19 个专家的源迁进 TS 模板管线——每个 .tmpl 转成 src/core/templates/experts/<name>.ts 里的模板字符串，生成器的共享块（preamble、SPEC_REVIEW_LOOP 等）转成 TS 共享常量（STORE_SELECTION_GUIDANCE 已经证明这个模式可行），然后删掉整个 bun/gen-skill-docs/skill-check 工具链，新鲜度门禁统一到 parity 哈希。可以顺带把 openspec-gstack-* 前缀里的 gstack 品牌一并去掉。专家仍是独立技能（worker 隔离不受影响），但源码、构建、测试、命名全部归一到 openspec 体系。

规模判断（前一 LEAD 向用户论证过）：中等规模，收益=单一源/单一门禁/品牌统一，代价=一次性迁移 19 件 + 引用面广。

## LEAD 已知事实（本 session 及交接文档确认）

- **现状**：19 个专家源在 `skills/gstack/<name>/SKILL.md.tmpl`，生成物 `SKILL.md` 同目录（头部标 AUTO-GENERATED）。`pnpm build`（build.js）会先跑 "Generating skill docs from templates..." 生成这 19 件（名单见 build 输出：gstack 根 + benchmark/browse/careful/codebase-design/codex/cso/design-consultation/design-review/freeze/guard/investigate/navigator/office-hours/prototype/qa/qa-only/review/tdd/unfreeze）。
- **工具链**：gen-skill-docs / skill-check 相关（含 bun 依赖，用户明确要求整体删除）；仓库有 `gen-skill-docs-path-migration`、`skill-template-generator`、`skill-name-prefix`、`legacy-cleanup`、`skill-sidecar-install` 等主 spec，改动大概率要对其中多个出 delta。
- **TS 管线先例**：`src/core/templates/workflows/*.ts` + 共享常量（`store-selection.ts` 的 STORE_SELECTION_GUIDANCE、`_orchestration.ts` 的 ORCHESTRATION_PLAYBOOK）就是目标形态。`src/core/templates/experts/` 目录已存在（index.ts、prototype.ts 等 getter 接线），专家 getter 目前如何桥接 .tmpl 需要 planner 摸清。
- **parity 门禁**：`test/core/templates/skill-templates-parity.test.ts` 的 EXPECTED_FUNCTION_HASHES / EXPECTED_GENERATED_SKILL_CONTENT_HASHES（golden-master）。迁移后 19 个专家应纳入该门禁（或按该文件既有模式扩展）。哈希重算流程：跑 parity 测试→从失败输出抄新值。
- **改名**：去掉 openspec-gstack-* 的 gstack 品牌。引用面：`_orchestration.ts`（Step E 委派 `openspec-gstack-review`）、`review-cycle.ts`（多处 + 测试断言 `toContain('openspec-gstack-review')`）、verify-enhanced、navigator、AGENTS.md、profiles/计数测试、主 specs（review-cycle-workflow、opsx-orchestration 等 spec 文本里也引用该名）。planner 需给出新命名方案（如 openspec-review）并盘点全部引用点。
- **安装侧孤儿**：`openspec update --force` 不清理被改名/删除技能的旧安装目录（上一 change 实测）——19 个改名会产生 19 个孤儿，必须走 legacy-cleanup 机制（repo 已有该 spec/机制，planner 确认接入方式）。`.claude/skills` 安装侧 gitignored。
- **测试面**：profiles.test（18 workflows 计数断言那类）、skill-generation.test、名册计数 19（上一 change 刚从 20→19 改过 4 处断言）、review-cycle.test 的名字断言。

## 编排约束（影响 tasks 排布）

- 工作区有 `ship-delivery-modes`（另一 session 接管）未提交改动，触及 `src/core/templates/workflows/{ship,auto,_orchestration,review-cycle}.ts`——与本 change 的改名触点重叠。**apply 不得在其 commit 落地前开始**；tasks.md 无需为此写条目，但 delta/实现不要假设这些文件的当前未提交内容不存在（改名基于 ship-delivery-modes 落地后的内容做）。
- 平台坑（写进 tasks 或让 implementer 知晓）：改文件用 Edit/Write 工具（PowerShell Set-Content 写坏 UTF-8 中文）；openspec 原生命令在 PowerShell 退出码 255 但输出正常——看输出；Windows 全量测试偶发 temp-dir 抖动，未触碰文件隔离重跑绿即过。

## 对 propose 的期望

- proposal.md（Why/What Changes/Impact）+ design.md（关键决策：新命名方案、experts 目录组织、共享块常量清单、parity 纳入方式、legacy 清理策略、删除工具链清单）+ tasks.md（可并行分组，注意 19 件迁移的机械性——适合模式化批量）+ 各受影响主 spec 的 delta。
- MODIFIED delta 必须携带该需求全部场景（本仓库铁律，上上个 change 的 reviewer 教训）。
- 若某主 spec（如 gen-skill-docs-path-migration）在迁移后整体失效，考虑 REMOVED 全部需求 vs 归档处理——参考 fuse-methodology-into-opsx 对零需求 spec 的手工处理先例，在 proposal NOTE 里预告归档注意事项。

## Planner 追加记录区

（planner 每轮 propose 后把新发现的持久性结论 APPEND 到这里）

### Round 1 (propose 完成，validate --strict 通过) — 2026-07-07

**命名方案（已定）**
- dirName: `openspec-gstack-<name>` → `openspec-<name>`（无 workflow 冲突：openspec-review vs openspec-review-cycle 等均不撞）。
- `SkillTemplate.name`: `gstack:<name>` → `openspec:<name>`。**两个标识都是 load-bearing**：`gstack:<name>` 被 `pipelines/*.yaml`（`skill: gstack:review|cso`）+ pipeline-registry 校验引用；`openspec-gstack-review` 被 `_orchestration.ts`/`review-cycle.ts`/review-cycle.test/sidecar-install.test 引用。
- 源目录 `skills/gstack/` → `skills/experts/`，改后只放 sidecar（删所有 SKILL.md + SKILL.md.tmpl）；无 sidecar 的专家目录整删。

**关键发现（影响 spec 处理，非 chatter）**
- **allowed-tools 从未进安装侧**：expert getter 剥掉整段 frontmatter，`generateSkillContent` 也不 emit allowed-tools（src 全仓 grep 无 `allowed-tools`/`allowedTools`）。故 `methodology-skill-tool-scoping` 的唯一 requirement 只约束了被删的 `.tmpl` 源 + 无人安装的 build product → 判为 **REMOVED**（不是 modified）。若要真正给安装侧专家做工具域收窄，是独立新特性（扩 SkillTemplate/generateSkillContent emit allowedTools）。
- **`description: '|'` 痼疾**：除 navigator 外每个 getter 都写死 `description: '|'`，装出来的 frontmatter description 实为空 YAML block scalar。属既存 bug，本 change 按「行为不变」原样保留，未修。
- **两个 code-derived 共享块**：`COMMAND_REFERENCE`/`SNAPSHOT_FLAGS` 由 gen-skill-docs 从 `browse/src/{commands,snapshot}` 动态生成。决策 D3：**冻结为 `_shared.ts` 静态常量**（不把 bun 版 browse/src 拉进主 tsc build）；可选后续加一致性测试。
- 根 `skills/gstack/SKILL.md.tmpl` 无 getter → dead，随工具链删。
- **实际使用的共享块只有 14 个**（PREAMBLE/BROWSE_SETUP/SNAPSHOT_FLAGS/COMMAND_REFERENCE/BASE_BRANCH_DETECT/PLAN_FILE_REVIEW_REPORT/QA_METHODOLOGY/DESIGN_METHODOLOGY/DESIGN_REVIEW_LITE/TEST_BOOTSTRAP/TEST_COVERAGE_AUDIT_REVIEW/ADVERSARIAL_STEP/DESIGN_SKETCH/SPEC_REVIEW_LOOP）。RESOLVERS 里 REVIEW_DASHBOARD/TEST_FAILURE_TRIAGE/TEST_COVERAGE_AUDIT_SHIP/BENEFITS_FROM/DEPLOY_BOOTSTRAP 是死代码，不迁。

**delta scoping 决策**
- 15 个 delta：1 NEW（`expert-template-inlining`）+ 11 MODIFIED + 3 REMOVED（`gen-skill-docs-path-migration`、`skill-template-generator`、`methodology-skill-tool-scoping` 全部 requirement 删空 → 需 archive 手删空文件，仿 fuse-methodology 先例）。
- **不做 delta 的**：`opsx-orchestration`（只说 "existing OPSX skill"，不钉名）、`profiles`（计数在 test 不在 spec）、以及一批「removal 类」老 spec（dead-stub-removal / eureka-telemetry-removal / remove-gstack-features / preamble-migration / branding-migration / remove-gstack-upgrade-skill / remove-parallel-lifecycle-skills / remove-setup-browser-cookies-skill / browse-skill-ethos-cleanup）——它们只把 `gen-skill-docs.ts`/`.tmpl` 当历史删除现场引用，内容保证在迁移后的 TS 里仍成立，无 requirement 变假，故只在 proposal NOTE 里声明「引用变历史、prose 更新 defer 给 housekeeping」。
- 孤儿清理走 legacy-cleanup **ADDED** 一条：init/update 删精确匹配退役前缀 `openspec-gstack-*` 的安装目录（scoped，不误伤 openspec-*）。
- 内容不漂验证（D7）：experts 之前未入 golden-master，先抓 pre-migration baseline，inline 后逐一比对相等，再冻结哈希——哈希是「已验证相等」的派生物，不是未检新基线。
- Purpose-line：delta 不带 Purpose，已在 proposal 加 archive NOTE 要求 apply/archive 手改 7 个 modified spec 的 Purpose 行（去 gstack、说 inline TS）。
