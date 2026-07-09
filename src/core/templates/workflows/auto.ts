/**
 * Auto Rasen Workflow Command
 *
 * Autopilot mode — the LEAD classifies the task, selects a pipeline, and drives
 * it end-to-end by orchestrating role-isolated subagents (see the shared
 * orchestration playbook). Pipelines are sourced from the data-driven pipeline
 * registry via the `rasen pipeline` CLI (classify / show / resume); the DAG
 * is not hard-coded here, and the orchestration playbook is registry-agnostic.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { ORCHESTRATION_PLAYBOOK } from './_orchestration.js';

const AUTO_INSTRUCTIONS = `Autopilot — drive the full Rasen workflow end-to-end.

${STORE_SELECTION_GUIDANCE}

You are the **LEAD**. You select a pipeline (default \`small-feature\`) and drive it by orchestrating role-isolated subagents (you do not do the stage work yourself). You pause at gates and the user can switch to manual at any time.

## When to Use

Use when: "auto", "autopilot", "end to end", "do it all", "one shot".

## 0. Pre-flight context probe (once, non-blocking)

Before anything else run \`rasen agent context --latest --json\` — it measures YOUR (the LEAD session's) context occupancy from the transcript's recorded API usage. At or above the session handoff threshold (default 0.5; see the playbook's Step H), offer the user a three-way choice: (a) automatic relay now — write the session handoff document and launch a successor session per the playbook's Step H.7; (b) continue this session (auto-compact remains the backstop); (c) handle it manually via /rasen:handoff. Proceed on the user's say-so; below the threshold, proceed silently. Declining leaves behavior exactly as before. Never re-probe on a running loop and never inject a token countdown into the conversation; this is a single entry check, not a meter.

## 1. Select the pipeline (explicit wins; default = small-feature)

**Input**: \`/rasen:auto [--pipeline <name>] [--review-plan] [--planner claude|codex] [--implementer claude|codex] [--reviewer claude|codex] [--fixer claude|codex] [--shipper claude|codex] <task description>\`.

Choose the pipeline in this order:
1. **Explicit** — if the invocation has \`--pipeline <name>\`, OR its first token is a known pipeline name from \`rasen pipeline list --json\` (e.g. \`/rasen:auto full-feature 重构鉴权子系统\`), use THAT pipeline. Strip the selector token; the rest is the task description.
2. **Default** — otherwise use **\`small-feature\`** (the default pipeline). Do NOT auto-escalate to full-feature/bug-fix.

You MAY run \`rasen pipeline classify "<task>" --json\` for a suggestion, or pick any pipeline from \`rasen pipeline list\` (including project/user-defined ones) — but an explicit selection always wins, and absent one the default is \`small-feature\`. DISPLAY the chosen pipeline and let the user change it before proceeding.

Built-in pipelines (see \`rasen pipeline list --json\`):
- **full-feature** — office-hours -> propose -> apply -> parallel expert reviews -> review-loop -> ship -> archive -> retro
- **small-feature** — propose -> apply -> verify -> review-loop -> ship -> archive  _(default)_
- **bug-fix** — propose -> apply -> adaptive verify -> ship -> archive

## 2. Fetch the selected pipeline's stage DAG

Load the chosen pipeline's stages from the registry — do NOT hard-code them:

\`\`\`bash
rasen pipeline show <name> --json   # -> { name, description, buildOrder, stages }
\`\`\`

Execute stages in \`buildOrder\`. Each stage carries the metadata the LEAD interprets via the playbook in section 3: **id**, **kind** (\`standard\` | \`decompose\`), **skill** (the Rasen skill the worker invokes; absent for a decompose stage), **childPipeline** (decompose only — the pipeline each child change runs), **role** (worker isolation), **requires** (DAG edges), **gate** (human pause after), **loop** (bounded review->fix), **parallelGroup** (concurrent fan-out — e.g. a \`verify\` stage's experts), **condition** (run only if met; mutually exclusive conditions like ui / non-ui pick exactly one), **leadReview** (LEAD checks the output for drift — section 4), **verifyPolicy** (section 5).

**Decompose is the conditional FIRST step.** If \`buildOrder[0]\` is a stage with **kind: decompose** (e.g. the \`auto-decompose\` pipeline), evaluate run-or-skip from the task BEFORE any other stage — **skip** it and the remaining stages run on one change exactly as today; **take** it and fan the task out into multiple child changes. This is LEAD-audited and proceeds automatically (no human gate); see the playbook's **Step G — Portfolio orchestration**. Pipelines without a decompose first stage are unaffected.

Before running stages, display the effective runtime table and let the user change it:

\`\`\`
planner=claude|codex  implementer=claude|codex  reviewer=claude|codex  fixer=claude|codex  shipper=claude|codex
\`\`\`

The user may freely mix runtimes. Example: Codex planner + Codex reviewer + Claude implementer/fixer. Pipeline stages may also set \`runtime\`, \`sessionReuse\`, \`sandbox\`, \`model\`, and \`effort\`; invocation role flags override those defaults for this run.

## 3. Execute the pipeline as the LEAD

${ORCHESTRATION_PLAYBOOK}

## 4. Propose direction-review gate (optional)

When the \`propose\` stage has **leadReview** enabled (via the \`--review-plan\` argument or the stage flag): after the propose worker returns and BEFORE \`apply\`, you (the LEAD) review proposal.md / design.md / specs / tasks.md against the user's ORIGINAL intent for direction drift. You hold the original intent and did NOT author the proposal, so this is a legitimate non-author check.
- Aligned -> continue to apply.
- Drifted -> bounce back to a fresh planner worker with the drift notes, or surface it to the user at the gate.
- **Tier C exception:** under the single-context fallback the LEAD itself authored the proposal, so leadReview would be a self-review. There, do NOT count it as a non-author check — degrade it to an explicit human-confirmation gate before apply, and record it as a fallback in run-state.
When leadReview is not enabled, proceed from propose to the next stage without the extra review.

## 5. verify stage — verifyPolicy semantics

A \`verify\` stage carries a **verifyPolicy** of \`adaptive\` (default), \`standard\`, or \`light\`. Every value has defined behavior — none is dead config:

**\`adaptive\` (default) — scale the verification passes to the diff size:**
- Run the unit-test gate first. Record the gate's command, result, and the content tree fingerprint (\`git rev-parse HEAD^{tree}\`) of the git state it ran against in run-state — the ship stage's evidence-based test gate consumes this to decide whether tests must be re-run.
- **Simple** fix (single file / non-core path / tests sufficient) AND tests green -> verify passes; skip the review loop.
- **Complex** fix (multiple files / core paths / insufficient coverage) -> spawn a dedicated test/verification worker for deeper checking AND enter the review-cycle loop.
- Compute the simple/complex determination from the diff and record it in run-state.

**\`standard\` — a single verify pass, no review-cycle loop.** Run the verify worker once over the diff, record its verdict + the test-gate evidence (command/result/tree fingerprint) as under \`adaptive\`, and proceed on a clean verdict; do NOT enter the bounded review->fix loop. Open Blocker/Major findings still block \`ship\` (escalate per Step H) — "no loop" narrows the passes, it does not waive the finding-gate.

**\`light\` — skip verification when the diff is trivial** (e.g. docs-only or tests-only, no product-source change). Record the skip and its basis (the trivial-diff determination) in run-state. If the diff is NOT trivial, do not honor \`light\` — fall back to \`standard\` and note the fallback, so a mis-tagged non-trivial change is never shipped unverified.

## Resume

On invocation for an existing change, determine the next incomplete stage from the change's run-state AND artifacts via \`rasen pipeline resume <change> --json\`, then resume from there rather than restarting. If the run is store-scoped (the change lives in a \`--store\`-selected Rasen root), thread the SAME \`--store <id>\` onto resume — \`rasen pipeline resume <change> --store <id> --json\` — so it resolves the store root and reads run-state from the store's change directory; omitting it would resolve the cwd root and report \`hasRunState:false\` for a change that is actually mid-run. The run-state per-stage status is AUTHORITATIVE; artifact presence is a heuristic to seed or cross-check it, and run-state wins on any conflict. Artifact signals: office-hours-design.md -> office-hours done; proposal.md -> propose done; tasks.md all checked -> apply done; review-report.md (or any expert \`*-report.md\` — the verify worker saves these per the playbook's Step B) -> verify done; review-cycle-report.md -> review-loop done; ship-log.md -> ship done; change moved to archive -> archive done; retro.md -> retro done. If neither run-state nor any artifact exists yet, start from the pipeline's first stage.

A fresh session has no live workers, so \`SendMessage\` cannot reach a worker from a prior session. When you must re-engage a role on resume (e.g. the reviewer for a re-review, or an interrupted stage), **warm-seed** a fresh same-role worker from its predecessor's recorded transcript — see the playbook's **Step F.1**. \`rasen pipeline resume\` reports the per-stage \`workers\` pointers (agentId / transcript) available to seed from; fall back to cold reconstruction from the change directory when a transcript is gone.

**Portfolio resume.** If the change is a decomposed parent (it has a \`portfolio-run.json\`), \`rasen pipeline resume <parent> --json\` returns \`isPortfolio: true\` with the child list, each child's status, and the **runnable frontier** (thread \`--store <id>\` here too for a store-scoped run, same as above). Resume the portfolio — continue incomplete children in dependency order and do NOT re-run completed ones — rather than re-running decompose. The portfolio record is authoritative; each child's own \`auto-run.json\` resumes that child's inner pipeline. It also returns the run-level \`planner\` pointer (the persistent planner that spans all children's proposes — playbook Step B.1): warm-seed the next planner from it plus \`planning-context.md\` instead of starting propose research from zero.

## Output Format

\`\`\`
## Auto: <change-name>

Classification: Full Feature | Small Feature | Bug Fix      Tier: A | B | C

### Progress
- [x] propose      — planner worker; 7 tasks generated
- [ ] apply        — implementer worker; in progress
- [ ] verify       — reviewer worker(s)
- [ ] review-loop
- [ ] ship

### Workers / experts
- review (always), cso (security), benchmark (perf), qa (UI) / qa-only (non-UI)
\`\`\`

When decompose is taken, report **portfolio progress** instead — the children, their dependency order, what runs in parallel, and the runnable frontier:

\`\`\`
## Auto: <parent> (decomposed into 3 children)      Tier: A

### Portfolio
- [x] <parent>-api      small-feature   (done)
- [ ] <parent>-ui       full-feature    (running; depends on -api)
- [ ] <parent>-docs     small-feature   (parallel with -ui; independent)

Frontier: <parent>-ui, <parent>-docs
\`\`\`

## Guardrails

- Always pause at gate stages — never skip human confirmation (for a decomposed portfolio's child-pipeline gates, this resolves per the playbook's Step G child-gate semantics: parent directive > child gate).
- If a stage is stuck (relay caps, stalled handoffs, exhausted review rounds), run the playbook's Step H escalation ladder — LEAD strategy review first, then park the stage as \`escalated\` and continue unblocked work; surface parked items at the next gate or the run-end report. Hard-stop only on failures the ladder cannot express (e.g. corrupted state).
- The user can interrupt at any time and switch to manual.
- Save run-state so the pipeline can be resumed from where it left off.
- Do not run \`ship\` if verification has unresolved Blocker/Major findings — escalate first.
- Enforce author != verifier across stages (reviewer != implementer; design-level fixer != author; re-reviewer != fixer).
- Decompose is LEAD-audited, not a human gate — proceed automatically once the plan is safe; escalate only when no safe plan exists. The user can still interrupt.
- NEVER parallelize children you cannot prove are independent: parallel requires no dependency edge AND no overlapping touched capabilities/specs/files AND Tier A. When uncertain, run serial. Never parallelize under Tier B/C.
- A dependent child waits for every prerequisite to be implemented + review-clean before it starts; a shared working tree is sufficient (no forced ship/archive of the prerequisite unless the dependency is on landed/merged artifacts).
- Decomposed children ship in **local** delivery mode (commit only — no per-child push or PR). The portfolio delivers ONCE: after ALL children complete, resolve the delivery mode at the parent level and push / create the PR there. On partial failure, completed children's commits stay local — never push a half-delivered portfolio.
- Save portfolio run-state (\`portfolio-run.json\`) so a decomposed run is observable and resumable; on a child's failure, stop its dependent chain, keep independent done children, and escalate with the open frontier.`;

export function getAutoCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-auto',
    description: 'Autopilot mode — the LEAD classifies the task, selects a pipeline, and drives it end-to-end by orchestrating role-isolated subagents with gates, the review-cycle loop, and human escalation.',
    instructions: AUTO_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}

export function getOpsxAutoCommandTemplate(): CommandTemplate {
  return {
    name: 'Rasen: Auto',
    description: 'Autopilot mode — LEAD orchestrates role-isolated subagents to drive the full Rasen workflow end-to-end',
    category: 'Workflow',
    tags: ['workflow', 'autopilot', 'dispatch', 'orchestration'],
    content: AUTO_INSTRUCTIONS,
  };
}
