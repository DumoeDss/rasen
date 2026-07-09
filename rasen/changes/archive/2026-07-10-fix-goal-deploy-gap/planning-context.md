# Planning Context — fix-goal-deploy-gap

Seeded by the LEAD, 2026-07-10. Root cause already fully established by the LEAD's own investigation (2026-07-09) — the planner should VERIFY line numbers against the current tree, not re-derive the diagnosis.

## User intent (verbatim constraints)

- 修复 goal 模板 deploy 缺口：`rasen update`/`init` 不产出 `rasen-goal*` skill 目录与 `/rasen:goal` 命令 payload。
- Pipeline: small-feature，no gate（gates 记录为 auto-continue）。
- 并发注意：另一 session 正在处理品牌独立化（可能触碰 docs/、specs/、发布文件）。本 change 的表面 = `src/core/profiles.ts`、`src/core/profile-sync-drift.ts`、`src/core/init.ts`、`src/core/shared/tool-detection.ts` + 相关测试——与品牌 session 表面正交，但共享工作树纪律照旧（显式 pathspec commit）。

## Established root cause (verified 2026-07-09, LEAD read the code directly)

goal-loop 落地时只注册了模板生成器与 parity 哈希，漏注册 profile 体系三处注册表：

1. **`ALL_WORKFLOWS`** (`src/core/profiles.ts:19-39`) 缺 `goal-plan` / `goal-iterate` / `goal-report` / `goal-command` 四个 ID。
2. **`WORKFLOW_TO_SKILL_DIR`** 两份拷贝均缺 goal 映射：
   - `src/core/profile-sync-drift.ts:19-41`（typed `Record<WorkflowId, string>`，导出，migration.ts/update.ts 消费）
   - `src/core/init.ts:77-97`（`Record<string, string>` 本地拷贝）
   映射应为：`goal-plan`→`rasen-goal-plan`、`goal-iterate`→`rasen-goal-iterate`、`goal-report`→`rasen-goal-report`、`goal-command`→`rasen-goal`（注意最后一个目录名无 `-command` 后缀，与 skill-generation.ts:183 一致）。
3. **`COMMAND_IDS`** (`src/core/shared/tool-detection.ts:33-55`) 缺 `goal-command`。

传播链：`update.ts:110-113` full profile → `getProfileWorkflows('full')` = `ALL_WORKFLOWS` → 作为 workflowFilter 传 `getSkillTemplates`/`getCommandContents`（`update.ts:191-192`；filter 逻辑 `skill-generation.ts:209-214`）→ goal 系被静默滤掉。expert skills 无条件安装（绕过 filter）→ 唯 goal 缺席。`init.ts:633,816` 同样受影响。

连带影响（修复后自动恢复）：custom profile 选择器（`src/commands/config.ts:590-597` 枚举 ALL_WORKFLOWS）将开始提供 goal 选项；profile-sync-drift 检测将覆盖 goal 目录；`removeUnselectedSkillDirs`（update.ts:451-475）在非 full profile 下将正确清理 goal 目录。

旁证一致性：parity 测试已完整 pin goal 模板（`test/core/templates/skill-templates-parity.test.ts:116-120,163-166,211-214`）；`validate.ts:45` 不带 filter 调 getSkillTemplates（认识 goal）——修复后注册表间矛盾消除。

## LEAD decisions (do not re-litigate)

- **goal 不进 `CORE_WORKFLOWS`**：goal 属 opt-in 高级功能，core profile 保持精简（`auto-command` 已在 core）。已向用户呈报此建议，用户未反对，按此执行。
- **修复=补齐注册表，不重构**：init.ts 与 profile-sync-drift.ts 的 WORKFLOW_TO_SKILL_DIR 双拷贝是既有结构性重复——本 change 只补条目，不做去重重构（那是独立 refactor，超出本 change 范围；design.md 可记一行 follow-up）。
- **纯 src/core 改动，无模板文件编辑** → 无 parity 哈希扰动预期。若 vitest parity diff 出现哈希移动，说明出了错，先调查再贴。
- 测试影响面预判：profile 相关测试可能断言 ALL_WORKFLOWS 长度/成员、update/init e2e 可能断言产出目录数——需同步更新并为 goal 部署行为补断言（update 后 rasen-goal* 四目录存在 + goal command payload 产出）。

## Constraints (from repo conventions)

- CLI 不在 PATH：`node dist/cli/index.js <args>`；改 src 后须 `pnpm build` 再验部署行为（update 读 dist）。
- 共享工作树有其他 session 在途改动（`src/core/templates/workflows/archive-change.ts`、`ship.ts` 的 sha-cross-stamping 草稿 + 品牌化 session 可能的新改动）——绝不 stage/commit 非本 change 文件；ship 一律显式 pathspec + `git show --stat` 复核。
- 子 change ship 用 local 模式（只 commit 不 push）——repo 有 26 个未推送提交，交付决策在用户手里。
- Windows CLI-spawning 测试 EBUSY flake 为已知非回归。
- 绝对化规则措辞规范：NEVER/ALWAYS/MANDATORY 必须带作用域从句。

## Planner findings (2026-07-10, artifacts complete)

- **行号已随工作树漂移，结构诊断全部核实**：`ALL_WORKFLOWS` src/core/profiles.ts:19-39（现缺 goal，18 项）；`WORKFLOW_TO_SKILL_DIR` profile-sync-drift.ts:19-41 + init.ts:77-97 双拷贝均缺；`COMMAND_IDS` tool-detection.ts:33-55 缺 goal-command。目录名 verbatim 取自 skill-generation.ts:180-183（**注意路径**：文件在 `src/core/shared/skill-generation.ts`，非 planning-context 所写的 `src/core/skill-generation.ts`）：`rasen-goal-plan`/`-iterate`/`-report`，命令目录 `rasen-goal`（无 -command 后缀）。
- **测试改动面已定位到具体断言**：`test/core/profiles.test.ts:23-24` 长度 18→22 且改 it 描述；`:28-39` expected 数组追加 4 个 goal ID。`test/core/shared/tool-detection.test.ts` 无 COMMAND_IDS 长度断言（只有 SKILL_NAMES 的），加 `toContain('goal-command')` 即可。`test/core/profile-sync-drift.test.ts` 迭代 WORKFLOW_TO_SKILL_DIR。update/init 部署断言进 `test/core/update.test.ts`/`init.test.ts`。
- **SKILL_NAMES 明确排除**：`tool-detection.ts:14-26` 的 SKILL_NAMES 是 11 项 legacy base 集，已漏掉全部 fusion/review-cycle/handoff 命令——非全集追踪表，goal 不进它，与诊断只点名 COMMAND_IDS 一致。
- **spec 落点**：改动 `opsx-goal-command` 能力，用 **ADDED**（新增"Goal Workflows Deploy Under the Full Profile"需求）而非 MODIFY——既有"Templates export and register"scenario 描述生成管线注册，本身没错，不该改；缺口是它从未覆盖 profile-system 注册。
- validate fix-goal-deploy-gap 通过；isComplete=true。
