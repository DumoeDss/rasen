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

You are the **LEAD**. You classify the task, select a pipeline, and drive it by orchestrating role-isolated subagents (you do not do the stage work yourself). You pause at gates and the user can switch to manual at any time.

## When to Use

Use when: "auto", "autopilot", "end to end", "do it all", "one shot".

## 1. Select the pipeline (explicit selection wins; else classify)

**Input**: \`/opsx:auto [--pipeline <name>] [--review-plan] <task description>\`.

Choose the pipeline in this order:
1. **Explicit** — if the invocation has \`--pipeline <name>\`, OR its first token is a known pipeline name from \`openspec pipeline list --json\` (e.g. \`/opsx:auto small-feature 给设置页加一个导出按钮\`), use THAT pipeline and SKIP classification. Strip the selector token; the rest is the task description.
2. **Else classify** the task and DISPLAY the suggestion:
   \`\`\`bash
   openspec pipeline classify "<task description>" --json   # -> { suggested, matched, available }
   \`\`\`

In both cases, DISPLAY the chosen pipeline and let the user change it before proceeding.

Built-in pipelines (see \`openspec pipeline list --json\`):
- **full-feature** — office-hours -> propose -> apply -> parallel expert reviews -> review-loop -> ship -> archive -> retro
- **small-feature** — propose -> apply -> verify -> review-loop -> ship -> archive
- **bug-fix** — propose -> apply -> adaptive verify -> ship -> archive

You MAY pick any pipeline from \`available\`, including project/user-defined ones. Classification is advisory; an explicit \`--pipeline\` / leading-name selection always wins.

## 2. Fetch the selected pipeline's stage DAG

Load the chosen pipeline's stages from the registry — do NOT hard-code them:

\`\`\`bash
openspec pipeline show <name> --json   # -> { name, description, buildOrder, stages }
\`\`\`

Execute stages in \`buildOrder\`. Each stage carries the metadata the LEAD interprets via the playbook in section 3: **id**, **skill** (the OPSX skill the worker invokes), **role** (worker isolation), **requires** (DAG edges), **gate** (human pause after), **loop** (bounded review->fix), **parallelGroup** (concurrent fan-out — e.g. a \`verify\` stage's experts), **condition** (run only if met; mutually exclusive conditions like ui / non-ui pick exactly one), **leadReview** (LEAD checks the output for drift — section 4), **verifyPolicy** (section 5).

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

On invocation for an existing change, determine the next incomplete stage from the change's run-state AND artifacts via \`openspec pipeline resume <change> --json\`, then resume from there rather than restarting. The run-state per-stage status is AUTHORITATIVE; artifact presence is a heuristic to seed or cross-check it, and run-state wins on any conflict. Artifact signals: office-hours-design.md -> office-hours done; proposal.md -> propose done; tasks.md all checked -> apply done; review-report.md -> verify done; review-cycle-report.md -> review-loop done; ship-log.md -> ship done; change moved to archive -> archive done; retro.md -> retro done. If neither run-state nor any artifact exists yet, start from the pipeline's first stage.

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

## Guardrails

- Always pause at gate stages — never skip human confirmation.
- If any stage fails, stop and report the failure — do not continue.
- The user can interrupt at any time and switch to manual.
- Save run-state so the pipeline can be resumed from where it left off.
- Do not run \`ship\` if verification has unresolved Blocker/Major findings — escalate first.
- Enforce author != verifier across stages (reviewer != implementer; design-level fixer != author; re-reviewer != fixer).`;

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
