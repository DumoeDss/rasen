# Planning Context — goal-gate-hardening

## 用户意图(逐字)
> small-feature 可以worktree开个新分支做1和2

指前一轮 Codex goal 实现对比分析中列出的借鉴项 1 和 2:

1. **Completion audit 措辞移植进 gate prompt**(纯提示改动)— 把 Codex `ext/goal/templates/goals/continuation.md` 的 Completion audit 纪律移植进 rasen goal-loop 的判定环节:
   - "treat completion as unproven and verify it against the actual current state"
   - 从 goal/rubric 派生具体需求,逐条找权威证据(文件/命令输出/测试结果/运行时行为)
   - "Treat uncertain or indirect evidence as not achieved"
   - "The audit must prove completion, not merely fail to find obvious remaining work"
   - "Do not rely on intent, partial progress, memory as proof"
   - 防缩水条款:"do not redefine success around a smaller or easier task"(保真度,防止把成功重定义为更小任务)
   落点:evaluate gate 的 fresh reviewer 判定 prompt(LEAD 编排指令里的 evaluate gate 条款),以及 measure 变体中 implementer 的非正式自检措辞。

2. **卡死检测 / blocked 门槛**(防过早放弃 + 防无限烧轮)— Codex 的 "blocked 三回合门槛":同一阻塞条件连续 ≥3 轮才允许判 blocked。rasen 现状:已有 `loopStallLimit`(默认 2,连续无进展轮 → Step H.5 策略审查),但缺"implementer 声称被阻塞/放弃"的门槛——implementer 第一轮就可以报 blocked。新增:implementer 报告阻塞时,LEAD 不立即采信;同一阻塞条件须连续 N 轮(默认 3)重现才升级,期间每轮要求换角度再试;恢复后计数重置。

## 已知代码落点(LEAD 已调研)
- `src/core/templates/workflows/goal-command.ts` — /rasen-goal 入口 LEAD 编排指令(含 "fresh reviewer each round"、gate 语义)
- `src/core/templates/workflows/goal-plan.ts` / `goal-iterate.ts` / `goal-report.ts` — 各 stage skill 模板
- `src/core/templates/workflows/_orchestration.ts` — 共享编排 playbook(Step L goal-loop 条款、loopStallLimit 语义)
- `pipelines/goal-loop-{measure,evaluate,research}/pipeline.yaml` — 三条内置 goal pipeline
- 模板改动流程:build → update、parity 哈希(见既往 change 的模板纪律);.claude/skills 与 dist 由模板生成,不直接改
- specs 位于 rasen/specs/(goal-loop 相关能力 spec 需查名后打 delta)

## 约束/决策
- 走 small-feature pipeline;这是提示/模板层改动为主,可能含少量 schema/config(若 blocked 门槛需要 loopConfig 字段如 blockedThreshold)
- 版本号不动(用户明令版本归用户管)
- 不改 review-cycle loop 语义,只动 goal-loop 家族
- Codex 原文措辞可意译为英文模板文案,不逐字抄(license 层面也更稳妥)

## 规划产出 durable findings (planner-1, 2026-07-24)
- **blockedThreshold 落点**:goal `loop` schema 在 `src/core/pipeline-registry/types.ts` 的 `StageLoopSchema` goal 分支(`loopStallLimit` 旁,~L257,default 3);注入 `loopConfig` 在 `src/core/pipeline-registry/run-state.ts`(~L169-194);`loopProgress` 加 `blockedStreak`。三者与 loopStallLimit/maxRounds 完全并行铺。
- **三计数器正交**:maxRounds(总预算 5)/ loopStallLimit(无分数进展 2)/ blockedThreshold(同一 blocker 复现 3)——独立 tally,Step H counter table 加 `blocked streak` 行。blocked 默认 3 > stall 2 是有意的(自报墙比静默不进展更该给重试)。
- **completion-audit 只进 evaluate 支**:measure 门是确定性命令,阈值比较已即"证明完成";audit 措辞进 Step L evaluate 分支 + goal-command evaluate 终止不变式 + Tier-C reset-pass。implementer 侧(goal-iterate/goal-plan)只拿 anti-scope-shrink 那半,不拿 audit 那半(implementer 从不自证 rubric)。
- **pipeline show label 不动**:goal-loop meta label `loop=goal[{gate}](max,stall)` 在三 locale json(en/ja/zh-cn L112)+ pipeline.test.ts;blockedThreshold 是编排提示消费字段非渲染字段,刻意不进 label,避免 locale churn + goal-loop-validation label 场景返工。
- **parity 纪律**:模板改 body → `pnpm build` → 跑 skill-templates-parity.test 取新 SHA,手贴进 `EXPECTED_FUNCTION_HASHES` + `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` 两图(rasen-goal-plan/-iterate/-goal,report 若未改则不动)。本 worktree `.claude/skills/` 只有 rasen-npm-pack,goal 技能非本仓 committed 产物 → 无独立 skills 输出目录需重生成,parity 两图即全部交付面。
- **CLI**:worktree 无 dist,`node bin/rasen.js` 报 ERR_MODULE_NOT_FOUND;scaffolding/validation 用全局 rasen 0.1.5 即可(已用其 validate 通过)。实现阶段跑 schema/测试前须先 `pnpm build`。
