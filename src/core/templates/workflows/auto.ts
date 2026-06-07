/**
 * Auto OPSX Workflow Command
 *
 * Autopilot mode — the LEAD classifies the task, selects a pipeline, and drives
 * it end-to-end by orchestrating role-isolated subagents (see the shared
 * orchestration playbook). Pipelines are sourced from the data-driven pipeline
 * registry via the `openspec pipeline` CLI (classify / show / resume); the DAG
 * is not hard-coded here, and the orchestration playbook is registry-agnostic.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { ORCHESTRATION_PLAYBOOK } from './_orchestration.js';

const AUTO_INSTRUCTIONS = `Autopilot — drive the full OPSX workflow end-to-end.

You are the **LEAD**. You select a pipeline (default \`small-feature\`) and drive it by orchestrating role-isolated subagents (you do not do the stage work yourself). You pause at gates and the user can switch to manual at any time.

## When to Use

Use when: "auto", "autopilot", "end to end", "do it all", "one shot".

## 1. Select the pipeline (explicit wins; default = small-feature)

**Input**: \`/opsx:auto [--pipeline <name>] [--review-plan] <task description>\`.

Choose the pipeline in this order:
1. **Explicit** — if the invocation has \`--pipeline <name>\`, OR its first token is a known pipeline name from \`openspec pipeline list --json\` (e.g. \`/opsx:auto full-feature 重构鉴权子系统\`), use THAT pipeline. Strip the selector token; the rest is the task description.
2. **Default** — otherwise use **\`small-feature\`** (the default pipeline). Do NOT auto-escalate to full-feature/bug-fix.

You MAY run \`openspec pipeline classify "<task>" --json\` for a suggestion, or pick any pipeline from \`openspec pipeline list\` (including project/user-defined ones) — but an explicit selection always wins, and absent one the default is \`small-feature\`. DISPLAY the chosen pipeline and let the user change it before proceeding.

Built-in pipelines (see \`openspec pipeline list --json\`):
- **full-feature** — office-hours -> propose -> apply -> parallel expert reviews -> review-loop -> ship -> archive -> retro
- **small-feature** — propose -> apply -> verify -> review-loop -> ship -> archive  _(default)_
- **bug-fix** — propose -> apply -> adaptive verify -> ship -> archive

## 2. Fetch the selected pipeline's stage DAG

Load the chosen pipeline's stages from the registry — do NOT hard-code them:

\`\`\`bash
openspec pipeline show <name> --json   # -> { name, description, buildOrder, stages }
\`\`\`

Execute stages in \`buildOrder\`. Each stage carries the metadata the LEAD interprets via the playbook in section 3: **id**, **kind** (\`standard\` | \`decompose\`), **skill** (the OPSX skill the worker invokes; absent for a decompose stage), **childPipeline** (decompose only — the pipeline each child change runs), **role** (worker isolation), **requires** (DAG edges), **gate** (human pause after), **loop** (bounded review->fix), **parallelGroup** (concurrent fan-out — e.g. a \`verify\` stage's experts), **condition** (run only if met; mutually exclusive conditions like ui / non-ui pick exactly one), **leadReview** (LEAD checks the output for drift — section 4), **verifyPolicy** (section 5).

**Decompose is the conditional FIRST step.** If \`buildOrder[0]\` is a stage with **kind: decompose** (e.g. the \`auto-decompose\` pipeline), evaluate run-or-skip from the task BEFORE any other stage — **skip** it and the remaining stages run on one change exactly as today; **take** it and fan the task out into multiple child changes. This is LEAD-audited and proceeds automatically (no human gate); see the playbook's **Step G — Portfolio orchestration**. Pipelines without a decompose first stage are unaffected.

## 3. Execute the pipeline as the LEAD

${ORCHESTRATION_PLAYBOOK}

## 4. Propose direction-review gate (optional)

When the \`propose\` stage has **leadReview** enabled (via the \`--review-plan\` argument or the stage flag): after the propose worker returns and BEFORE \`apply\`, you (the LEAD) review proposal.md / design.md / specs / tasks.md against the user's ORIGINAL intent for direction drift. You hold the original intent and did NOT author the proposal, so this is a legitimate non-author check.
- Aligned -> continue to apply.
- Drifted -> bounce back to a fresh planner worker with the drift notes, or surface it to the user at the gate.
- **Tier C exception:** under the single-context fallback the LEAD itself authored the proposal, so leadReview would be a self-review. There, do NOT count it as a non-author check — degrade it to an explicit human-confirmation gate before apply, and record it as a fallback in run-state.
When leadReview is not enabled, proceed from propose to the next stage without the extra review.

## 5. Adaptive Bug-Fix verify

For a \`verify\` stage with **verifyPolicy=adaptive**:
- Run the unit-test gate first.
- **Simple** fix (single file / non-core path / tests sufficient) AND tests green -> verify passes; skip the review loop.
- **Complex** fix (multiple files / core paths / insufficient coverage) -> spawn a dedicated test/verification worker for deeper checking AND enter the review-cycle loop.
Compute the simple/complex determination from the diff and record it in run-state.

## Resume

On invocation for an existing change, determine the next incomplete stage from the change's run-state AND artifacts via \`openspec pipeline resume <change> --json\`, then resume from there rather than restarting. The run-state per-stage status is AUTHORITATIVE; artifact presence is a heuristic to seed or cross-check it, and run-state wins on any conflict. Artifact signals: office-hours-design.md -> office-hours done; proposal.md -> propose done; tasks.md all checked -> apply done; review-report.md (or any expert \`*-report.md\` — the verify worker saves these per the playbook's Step B) -> verify done; review-cycle-report.md -> review-loop done; ship-log.md -> ship done; change moved to archive -> archive done; retro.md -> retro done. If neither run-state nor any artifact exists yet, start from the pipeline's first stage.

A fresh session has no live workers, so \`SendMessage\` cannot reach a worker from a prior session. When you must re-engage a role on resume (e.g. the reviewer for a re-review, or an interrupted stage), **warm-seed** a fresh same-role worker from its predecessor's recorded transcript — see the playbook's **Step F.1**. \`openspec pipeline resume\` reports the per-stage \`workers\` pointers (agentId / transcript) available to seed from; fall back to cold reconstruction from the change directory when a transcript is gone.

**Portfolio resume.** If the change is a decomposed parent (it has a \`portfolio-run.json\`), \`openspec pipeline resume <parent> --json\` returns \`isPortfolio: true\` with the child list, each child's status, and the **runnable frontier**. Resume the portfolio — continue incomplete children in dependency order and do NOT re-run completed ones — rather than re-running decompose. The portfolio record is authoritative; each child's own \`auto-run.json\` resumes that child's inner pipeline.

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

- Always pause at gate stages — never skip human confirmation.
- If any stage fails, stop and report the failure — do not continue.
- The user can interrupt at any time and switch to manual.
- Save run-state so the pipeline can be resumed from where it left off.
- Do not run \`ship\` if verification has unresolved Blocker/Major findings — escalate first.
- Enforce author != verifier across stages (reviewer != implementer; design-level fixer != author; re-reviewer != fixer).
- Decompose is LEAD-audited, not a human gate — proceed automatically once the plan is safe; escalate only when no safe plan exists. The user can still interrupt.
- NEVER parallelize children you cannot prove are independent: parallel requires no dependency edge AND no overlapping touched capabilities/specs/files AND Tier A. When uncertain, run serial. Never parallelize under Tier B/C.
- A dependent child waits for every prerequisite to be implemented + review-clean before it starts; a shared working tree is sufficient (no forced ship/archive of the prerequisite unless the dependency is on landed/merged artifacts).
- Save portfolio run-state (\`portfolio-run.json\`) so a decomposed run is observable and resumable; on a child's failure, stop its dependent chain, keep independent done children, and escalate with the open frontier.`;

export function getAutoCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-opsx-auto',
    description: 'Autopilot mode — the LEAD classifies the task, selects a pipeline, and drives it end-to-end by orchestrating role-isolated subagents with gates, the review-cycle loop, and human escalation.',
    instructions: AUTO_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxAutoCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Auto',
    description: 'Autopilot mode — LEAD orchestrates role-isolated subagents to drive the full OPSX workflow end-to-end',
    category: 'Workflow',
    tags: ['workflow', 'autopilot', 'dispatch', 'orchestration'],
    content: AUTO_INSTRUCTIONS,
  };
}
