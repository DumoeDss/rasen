/**
 * Review-Cycle Rasen Workflow Command
 *
 * Iterative post-implementation review loop:
 * review -> triage -> fix -> re-review(delta) -> {pass | loop | escalate}.
 * It does NOT reimplement the reviewer (each pass delegates to the
 * `rasen-review` engine) and does NOT reimplement the orchestration
 * (it runs on the shared LEAD orchestration playbook). The multi-agent path is
 * PRIMARY — review, fix, and re-review run as distinct role-isolated workers,
 * with a Tier A `SendMessage` warm resume of the original reviewer — and
 * single-context is the explicit fallback (Tier C), not the baseline.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { ORCHESTRATION_PLAYBOOK } from './_orchestration.js';

const REVIEW_CYCLE_INSTRUCTIONS = `Iterative review loop — drive a change to actually-clean: review the diff, triage findings, fix, re-review only the delta, and repeat until clean or escalate to a human.

${STORE_SELECTION_GUIDANCE}

This workflow does NOT reimplement the reviewer — each review pass delegates to the always-installed \`rasen-review\` engine. It does NOT reimplement the orchestration — it runs on the shared LEAD orchestration playbook below. It owns: change selection, the loop bound, fix-size triage, the author != verifier invariant, and the cycle report.

**The multi-agent path is PRIMARY.** Review, fix, and re-review run as distinct role-isolated workers; on Claude Code with agent-teams (Tier A) the LEAD resumes the original reviewer via \`SendMessage\` to re-review only the delta — within the SAME session. Across a session boundary (\`SendMessage\` cannot reach a worker from a prior session) the LEAD instead warm-seeds a fresh reviewer from the original reviewer's recorded transcript (playbook Step F.1), so it still re-reviews only the delta with the prior findings in hand. Single-context execution is the explicit FALLBACK (Tier C), used only when the tool has no subagent capability — NOT the baseline.

## When to Use

Use when: "review cycle", "keep reviewing until clean", "drive the findings to closure", "iterate on the review", "loop the review", "make sure the fixes actually got re-reviewed".

Use this AFTER implementation, against the live diff. For a single one-shot verification gate, use \`rasen-verify-enhanced\` instead; this command is the loop that wraps a reviewer and keeps going.

## The Loop

\`\`\`
review -> triage -> fix -> re-review(delta) -> { pass | loop | escalate }
\`\`\`

Run rounds until a review pass returns no unresolved Blocker or Major findings, OR the max-rounds cap is reached. Default cap: 3. On hitting the cap with unresolved Blocker/Major findings, do NOT loop further and do NOT silently pass — run the playbook's **Step H.5/H.6 escalation ladder**: a LEAD strategy review where each retry changes a material variable (different fix approach or seeding, design-level rework via the planner, isolating the stubborn finding), recorded in \`strategyAttempts\`; when the strategy budget is exhausted, park the change as \`escalated\` with the full history and surface it at the next natural pause point for the human.

### Select the change

If a change name is provided, use it. Otherwise infer from context, auto-select if only one active change exists, or run \`rasen list --json\` and prompt. Initialize round counter \`r = 1\` and read the configured/argument max-rounds (default 3).

## Run the loop via the orchestration playbook

Execute **Step E (the review -> fix loop)** of the playbook below against the current diff. Tier detection (Step A), role-isolated dispatch (Step B), the author != verifier enforcement (Step C), and run-state (Step F) all apply — they are how this loop achieves a structurally independent re-review rather than a same-context promise.

${ORCHESTRATION_PLAYBOOK}

## Cycle report

Track everything in \`review-cycle-report.md\` in the change's work directory (resolve \`workDir\` from \`rasen status --change <name> --json\`; fall back to the change directory when it is absent or the file already lives there): each round, each finding, its triage bucket, who fixed it, who confirmed it (the non-author), and the final disposition. Also record the **test evidence** of the final clean round (and of every Tier C gate-run): the exact test/gate command(s), their result, and the content tree fingerprint (\`git rev-parse HEAD^{tree}\`) of the git state they ran against — the ship stage's evidence-based test gate reads this to decide whether tests must be re-run.

## Termination Invariants (non-negotiable)

- Max rounds cap (default 3). The loop is bounded; no unbounded recursion / thrash.
- Never report clean while any Blocker or Major finding is unresolved.
- Author != verifier: the fixer cannot self-certify; an independent (non-author) confirmation is required for every resolution. Under Tier C the equivalent is an independent gate-run (tests/lint/build) plus a diff-read, which MUST be recorded in the report.
- On the cap with open Blocker/Major findings: the LEAD-first escalation ladder (Step H.5/H.6) runs before any human is interrupted — strategy retries that each change a material variable, then a parked \`escalated\` state surfaced at the next natural pause. The failure mode stays loud and recorded; it is never a silent pass, and never a mid-run hard stop for a problem the LEAD can still re-strategize.

## Output

\`\`\`
## Review Cycle: <change-name>

Rounds: <r>/<max-rounds>   Tier: A | B | C   Status: CLEAN | ESCALATED

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|-------|----------------------|--------|----------|---------------------------|----------|
| 1     | 1/2/1/0              | ...    | ...      | resumed reviewer / fresh / gate+diff | 3/4 |

### Open (if ESCALATED)
- <Blocker/Major finding text> — round history, current state

### Report
- review-cycle-report.md
\`\`\`

## Integration Notes

- Delegates every review pass to \`rasen-review\` — one review engine, no fork.
- Runs AFTER implementation, against the live diff; complements (does not replace) the one-shot \`rasen-verify-enhanced\` gate and plan-time \`plan-*-review\`.
- Shares the orchestration playbook with \`rasen-auto\` — this loop is auto's \`review-loop\` stage.
- The cycle report lives in the work directory alongside \`review-report.md\` / \`ship-log.md\` and is consumable by \`rasen-retro\` and \`rasen-archive-change\`.`;

export function getReviewCycleSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-review-cycle',
    description:
      'Iterative review loop — review, triage, fix, re-review the delta, repeat until clean or escalate. Multi-agent path is primary (distinct reviewer/fixer workers, Tier A SendMessage warm resume); single-context is the fallback. Delegates each pass to rasen-review; enforces author != verifier and a max-rounds cap.',
    instructions: REVIEW_CYCLE_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
