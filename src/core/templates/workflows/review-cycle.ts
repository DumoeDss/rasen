/**
 * Review-Cycle Rasen Workflow Command (thin launcher)
 *
 * This skill is a LAUNCHER and COMPATIBILITY PROJECTION only. It owns NO
 * second mechanical state — no round counter, no phase sequencing, no
 * max-rounds enforcement, no author != verifier checking, no escalation
 * ladder. All mechanical progression is owned by the canonical ChangeRun
 * reconciler via the ReviewCycle BoundedLoop.
 *
 * The skill: selects the change, launches the canonical Run, composes
 * per-phase agent briefs from the canonical ChangeRunView, and delegates
 * each review pass to `rasen-review`.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK } from './_orchestration.js';

const REVIEW_CYCLE_INSTRUCTIONS = `Iterative review loop — launch the canonical ReviewCycle Run and drive it to clean via role-isolated review passes.

${STORE_SELECTION_GUIDANCE}

This workflow is a **thin launcher**. The ReviewCycle loop (round counting, phase sequencing, max-rounds enforcement, actor separation, escalation) is owned by the canonical ChangeRun reconciler. This skill does NOT duplicate that state.

## Bounded-loop strategy capability mode

Before following the launcher flow below, inspect the admitted Action input. When it contains a \`boundedLoopStrategy\` object whose \`contract\` is \`bounded-loop/strategy-invocation/1\`, this invocation is a bounded recovery-strategy selection, not a request to launch a ReviewCycle.

The versioned invocation is exactly:

\`\`\`json
{
  "contract": "bounded-loop/strategy-invocation/1",
  "loopPath": "<canonical loop path>",
  "attempt": 1,
  "trigger": "iteration-limit | action-limit | budget-limit | stalled | blocked | strategy-exhausted"
}
\`\`\`

Choose one materially different recovery tactic for the reported trigger. Use the canonical Run view and current review evidence to explain why it differs from exhausted work and which files, findings, tests, or review surfaces the next ordinary loop pass should change. Do NOT perform the fix in this strategy Action. Do NOT launch or resume another Run; that would recursively create a second mechanical owner.

For this Action, return only the strategy result, using this exact closed shape:

\`\`\`json
{
  "contract": "bounded-loop/strategy-result/1",
  "strategyKey": "<stable tactic key>",
  "rationale": "<why this is materially different and addresses the trigger>",
  "intendedChangeSurface": ["<specific file, finding, test, or subsystem>"],
  "evidence": []
}
\`\`\`

\`strategyKey\`, \`rationale\`, and every \`intendedChangeSurface\` entry are non-empty; \`evidence\` is an array. Stop after returning that object. The reconciler validates \`bounded-loop/strategy-result/1\`, accounts the attempt, and separately admits the ordinary recovery pass. If the Action input is not this versioned invocation, continue with the launcher flow below.

## When to Use

Use when: "review cycle", "keep reviewing until clean", "drive the findings to closure", "iterate on the review", "loop the review", "make sure the fixes actually got re-reviewed".

Use this AFTER implementation, against the live diff.

## 1. Select the change

If a change name is provided, use it. Otherwise infer from context, auto-select if only one active change exists, or run \`rasen list --json\` and prompt.

## 2. Launch or resume the canonical Run

Start the canonical ReviewCycle Run:

\`\`\`
rasen pipeline start <change-name> bug-fix --json
\`\`\`

If a Run already exists, reproduce its current quiescent preview:

\`\`\`
rasen pipeline resume-run <change-name> bug-fix --json
\`\`\`

\`start\`, \`resume-run\`, \`complete\`, and \`control\` stop at a prompt-free \`candidates[]\` preview whenever an agent phase is ready. They do not admit that phase. The Run\'s reconciler orders ReviewCycle phases (review, triage, fix, re-review), enforces the round cap, checks actor separation, and escalates when exhausted. You do NOT track rounds or phases yourself.

## 3. Read the canonical progress

Check the Run status to see the current round, phase, findings, and actors:

\`\`\`
rasen pipeline status <change-name> bug-fix --json
\`\`\`

The response includes a \`review-cycle\` section with: \`round\`, \`phase\`, \`outcome\`, \`findings\`, \`actors\`, \`waitReason\`, \`maxRounds\`. This is the ONE source of truth — read it, do not duplicate it.

## 4. Render and admit each phase

For each prompt-free candidate, compose the complete brief from these trusted source instructions, the frozen candidate descriptor, and canonical state:

- **review**: delegate to \`rasen-review\` against the current diff
- **triage**: classify findings by severity and disposition
- **fix**: route findings to a role-isolated fixer (NOT the reviewer)
- **re-review**: delegate to \`rasen-review\` with the fix delta, by an independent verifier (NOT the fixer)

Write every candidate and complete prompt exactly once to private ephemera using \`agent-turn-input-manifest/1\`, then run:

\`\`\`
rasen pipeline admit <change-name> --run <runId> --turn-input-file <private-manifest-path> --json
\`\`\`

Only \`admit\` creates and grants the Actions. Dispatch each returned Action with prompt bytes identical to the manifest bytes authenticated at admission. A stale, wrong, missing, duplicate, or extra candidate fails closed; obtain a fresh preview instead of repairing an old id. Never put prompt bodies in run-state, Records, logs, evidence, or telemetry. The reconciler enforces author != verifier; you do not check it yourself.

## 5. Complete each phase

Submit each phase result to the canonical Run:

\`\`\`
rasen pipeline complete <change-name> --run <runId> --from <receipt.json> --json
\`\`\`

The receipt body is \`{ "completion": <change-run-completion/1>, "uploads": [...] }\`; the \`actionId\` and \`runId\` live inside the completion, and \`--from -\` reads it from stdin. Include the result contract (\`review-cycle/review-result/1\`, \`triage-result/1\`, \`fix-result/1\`, \`verification-result/1\`), the actor identity, and the attestation evidence. The reconciler validates the result before committing — malformed results, same-actor verification, and open Blocker/Major findings are rejected before the Record mutates.

## 6. Drive to completion

The Run reaches one of:
- **completed** (clean): all findings resolved, ship-ready
- **escalated** (exhausted): maxRounds reached with open Blocker/Major findings

On escalation, surface the findings and cycle history to the human. Do NOT retry beyond the reconciler\'s cap.

${REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK}

## Cycle report

Track everything in \`review-cycle-report.md\` in the change's evidence directory (\`evidenceDir\` from \`rasen status --change <name> --json\`; sticky-legacy: a file that already lives in the legacy \`workDir\` or the change directory is used in place): each round, each finding, its triage bucket, who fixed it, who confirmed it (the non-author), and the final disposition. Also record the **test evidence** of the final clean round (and of every Tier C gate-run): the required verification scope, a rationale explaining why that scope covers the observed risk, the exact test/gate command(s), their result, and the content tree fingerprint (\`git rev-parse HEAD^{tree}\`) of the git state they ran against — the ship stage's evidence-based test gate reads both scope coverage and tree identity before deciding which checks remain.

## Output

Report the final state from the canonical \`ChangeRunView\`:

\`\`\`
## Review Cycle: <change-name>

Status: CLEAN (completed) | ESCALATED (maxRounds reached)

| Round | Phase | Findings | Actor | Evidence |
|-------|-------|----------|-------|----------|
| 1     | review | ...     | ...   | ...      |

Source: \`rasen pipeline status <change-name> bug-fix --json\`
\`\`\`

## Integration Notes

- This skill owns NO mechanical state. Round counting, phase sequencing, max-rounds enforcement, actor separation, and escalation are all owned by the canonical ChangeRun reconciler.
- Delegates every review pass to \`rasen-review\` — one review engine, no fork.
- Runs AFTER implementation, against the live diff.
- Complements (does not replace) the one-shot \`rasen-verify-enhanced\` gate and plan-time \`plan-*-review\`.
- Shares the orchestration playbook with \`rasen-auto\` — this loop is auto's \`review-loop\` stage.
- The cycle report lives in the evidence directory alongside \`review-report.md\` / \`ship-log.md\` and is consumable by \`rasen-retain\` (report mode) and \`rasen-archive-change\`.
- The canonical Run Record is the single source of truth for cycle state.`;

export function getReviewCycleSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-review-cycle',
    description:
      'Thin launcher for the canonical ReviewCycle Run. Launches the pipeline, composes per-phase agent briefs, delegates each review pass to rasen-review. The reconciler owns all mechanical state (rounds, phases, caps, actor separation, escalation).',
    instructions: REVIEW_CYCLE_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '2.0' },
  };
}
