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

If a Run already exists, resume it:

\`\`\`
rasen pipeline resume-run <change-name> bug-fix --json
\`\`\`

The Run\'s reconciler admits each ReviewCycle phase (review, triage, fix, re-review) in the correct order, enforces the round cap, checks actor separation, and escalates when exhausted. You do NOT track rounds or phases yourself.

## 3. Read the canonical progress

Check the Run status to see the current round, phase, findings, and actors:

\`\`\`
rasen pipeline status <change-name> bug-fix --json
\`\`\`

The response includes a \`review-cycle\` section with: \`round\`, \`phase\`, \`outcome\`, \`findings\`, \`actors\`, \`waitReason\`, \`maxRounds\`. This is the ONE source of truth — read it, do not duplicate it.

## 4. Compose per-phase agent briefs

For each admitted phase action, compose a brief from the canonical state:

- **review**: delegate to \`rasen-review\` against the current diff
- **triage**: classify findings by severity and disposition
- **fix**: route findings to a role-isolated fixer (NOT the reviewer)
- **re-review**: delegate to \`rasen-review\` with the fix delta, by an independent verifier (NOT the fixer)

The reconciler enforces author != verifier; you do not check it yourself.

## 5. Complete each phase

Submit each phase result to the canonical Run:

\`\`\`
rasen pipeline complete <change-name> bug-fix --action-id <id> --json
\`\`\`

Include the result contract (\`review-cycle/review-result/1\`, \`triage-result/1\`, \`fix-result/1\`, \`verification-result/1\`), the actor identity, and the attestation evidence. The reconciler validates the result before committing — malformed results, same-actor verification, and open Blocker/Major findings are rejected before the Record mutates.

## 6. Drive to completion

The Run reaches one of:
- **completed** (clean): all findings resolved, ship-ready
- **escalated** (exhausted): maxRounds reached with open Blocker/Major findings

On escalation, surface the findings and cycle history to the human. Do NOT retry beyond the reconciler\'s cap.

${REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK}

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
