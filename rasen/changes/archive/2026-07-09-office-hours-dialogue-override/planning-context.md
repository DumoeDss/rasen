# Planning Context — office-hours-dialogue-override

Seeded by the LEAD from a completed diagnostic session (2026-07-09). The planner should treat this as established findings — verify line numbers against current source, but do NOT re-derive the diagnosis from scratch.

## User intent (verbatim summary)

用户在一次真实的 /opsx:office-hours 会话中遭遇严重体验问题：用户两次要求"先为我讲解讨论方案/回答我的问题"，skill 却机械地继续弹 AskUserQuestion 选项菜单，第三次抗议（"先回答我的问题，不要盲目问我问题！"）被误判为"不耐烦"，触发 escape hatch 直接跳到写设计文档。用户要求修复 office-hours 的问答模式，使其能正常对话。任务：实现 LEAD 分析得出的修复方案（下述 5 项），small-feature pipeline，无人工 gate。

## Diagnosis (established, high confidence)

Root cause: office-hours 是一台"只进不出的问答状态机"——用户的每条回复都被当作面试答案消费，"用户反过来提问"这一状态在指令集中不存在；唯一的压力释放阀（escape hatch）语义是"快进跳关"，与用户"多讨论"的诉求方向相反。

Symptom → source mapping (all in src/core/templates/, the SOURCE of truth; .claude/skills/* are generated artifacts):

1. 机械格式（背景重述 + Completeness N/10 + A/B/C 每轮重复）→ `src/core/templates/experts/_shared.ts` PREAMBLE "AskUserQuestion Format" 节（~lines 26-36）：规定每一次 AskUserQuestion 都必须走 Re-ground → Simplify → RECOMMENDATION+Completeness → 字母选项 四段式。PREAMBLE 被全部 19 个 expert skill 共享。
2. 用户提问被无视 → `src/core/templates/experts/office-hours.ts`：Phase 3 premises（~:330-338）与 Phase 4 alternatives（~:369-371，"Do NOT proceed without user approval"）都强制走 AskUserQuestion；指令集中没有任何"用户提问时退出问答流程、用散文回答"的规则，模型只能把回答压进下一次 AskUserQuestion 的 Re-ground 引言里并重复弹同一个菜单。
3. 抗议后直接写文档 → `office-hours.ts` escape hatch（Startup ~:220-225；Builder ~:261）："第二次 pushback → proceed immediately"。用户的"先回答我的问题"被模式匹配成第二次不耐烦 → 快进到 Phase 5 写文档，且违反了 Phase 4 自己的批准门（抗议被当成默认批准）。
4. 场景错配 → skill 只有 YC 面试官（Startup）和头脑风暴陪练（Builder）两种姿态，都是单向审问式；"用户带着具体设计来求同行对谈"的 Consultation 姿态不存在。

## Approved fix plan (5 items)

1. **`_shared.ts` PREAMBLE — 新增 "Dialogue Override" 节**（根治，惠及全部 19 个 expert skill）：
   - AskUserQuestion 是决策工具不是对话工具。每次调用前检查用户上一条消息：若包含提问/要求解释讨论/Other 自由文本非干净选项选择 → 暂停状态机，用正文散文完整回答（无选项、无 RECOMMENDATION、无 Completeness），持续讨论直到用户明确示意推进，然后回到原 phase 恢复，绝不跳关。
   - 同一轮禁止"回答问题 + 推进 phase"二合一。
   - "先回答我的问题 / 先讨论 / 连续追问" = 要更多对话，是 escape hatch 的反义词，永远不触发快进。
   - Re-ground 重述只在真正长间隔后做；连续对话中禁止重复模板开场白。
2. **`experts/office-hours.ts` — 收紧 escape hatch**（两处：Startup ~:220-225、Builder ~:261）：只允许明确跳过信号触发（"just do it" / "skip" / "别问了直接写"）；用户提问或要求解释一律走 Dialogue Override。并给 Phase 5 加硬门：写文档唯一前置 = 用户在 Phase 4 明确选定方案；抱怨、沉默、提问都不是批准。
3. **Interview discipline（~:61-69）加第四条**："Answer before you ask." 用户的问题是最高优先级输入，回答它优先于推进问题清单。
4. **新增 Consultation 姿态**：用户开场带具体设计 + "你觉得如何/有更好方案吗"时，跳过生成式提问，直接交付分析正文，同行对谈式讨论；仅在讨论收敛后询问"要我把讨论沉淀成设计文档吗？"。文档是讨论副产品，不是流程终点。
5. **Completeness X/10 限域**：只用于"实现捷径 vs 完整实现"类决策选项，讨论型分叉不贴分数（改在 PREAMBLE 的 AskUserQuestion Format 内）。

## Constraints & implementation notes

- 只改 TS 模板源码；`.claude/skills/*` 是生成物。改完需重新生成安装的 skills（调查生成命令：见 `src/core/shared/skill-generation.ts`、`src/core/templates/skill-templates.ts`；可能是 init/update/profile-sync 路径）。
- `test/core/templates/skill-templates-parity.test.ts` 是 golden-master parity 测试，PREAMBLE 变更会让它失败，必须同步更新（了解其更新机制——可能是快照重新生成）。
- PREAMBLE 变更影响所有 19 个 expert 模板的生成输出——parity/snapshot 影响面按此评估。
- 仓库正在 openspec→rasen 迁移中（产物根已是 rasen/），模板内文案用 rasen 品牌（现状已如此，如 /rasen:propose）。
- 工作树有大量与本 change 无关的未提交修改（迁移期）；实现与提交时务必 pathspec 限定本 change 触及的文件（见 shared-index 纪律）。
- 测试基线：全量 pnpm test ~2100+ 用例，Windows 上 CLI-spawning 测试偶发 EBUSY flake（非回归）；per-file 跑受影响测试即可。

## Scope guard

不要扩展到：office-hours 之外其它 skill 的对话行为专项重设计（Dialogue Override 进 PREAMBLE 自然惠及它们即可）、design-consultation 的改造、workflow 命令层（workflows/office-hours.ts）的六问流程重写。保持 small-feature 体量。

## Planner durable findings (appended 2026-07-09, propose stage complete)

- **Line numbers verified against current source** — PREAMBLE "AskUserQuestion Format" = `_shared.ts:26-36`; office-hours Interview discipline = `office-hours.ts:61-69`; Startup escape hatch = `:220-225`; Builder escape hatch = `:261`; Phase 4 "Do NOT proceed" = `:371`; Phase 5 = `:396`. All match the seed diagnosis.
- **Live workspace = `rasen/`, NOT `openspec/`** — `WORKSPACE_DIR_NAME='rasen'` (`src/core/config.ts`). The rasen CLI reads `rasen/specs/` (currently EMPTY, migration in progress) and `rasen/changes/`. `openspec/specs/*` (incl. `office-hours-grilling-absorption`, `preamble-migration`) is an upstream MIRROR the rasen CLI does NOT read — so spec deltas are ADDED (new capabilities), not MODIFIED. Two new capabilities created: `expert-dialogue-override` (cross-cutting PREAMBLE) + `office-hours-dialogue` (office-hours specifics).
- **PREAMBLE blast radius = 14 parity-pinned templates** — grep `PREAMBLE` in `experts/` hits 16 files (15 experts + `_shared.ts`). chrome-use embeds PREAMBLE but is NOT in the parity maps → 14 affected: benchmark, codebase-design, codex, cso, design-consultation, design-review, investigate, navigator, office-hours, prototype, qa, qa-only, review, tdd. careful/freeze/guard/unfreeze do NOT embed PREAMBLE (must stay unchanged — a hash diff there = bug).
- **Parity test has NO auto-updater** — `test/core/templates/skill-templates-parity.test.ts` hardcodes `EXPECTED_FUNCTION_HASHES` + `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`. On PREAMBLE change ~28 entries fail; implementer reads actual hashes from the assertion diff and pastes them in. No `-u`/snapshot mechanism.
- **Regeneration path** — installed `.claude/skills/*` are generated by `node dist/cli/index.js update` (`src/core/update.ts` → `getSkillTemplates`→`generateSkillContent`+`copySkillSidecars`). `update` reads compiled `dist/`, so `pnpm build` (`node build.js`) MUST run before `update` to pick up TS edits.
- **CLI**: `node dist/cli/index.js` (binary not on PATH). `validate office-hours-dialogue-override` → clean. Status 4/4 artifacts complete.
