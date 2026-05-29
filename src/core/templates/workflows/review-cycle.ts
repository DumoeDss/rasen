/**
 * Review-Cycle OPSX Workflow Command
 *
 * Iterative post-implementation review loop:
 * review -> triage -> fix -> re-review(delta) -> {pass | loop | escalate}.
 * Delegates each review pass to the always-installed `openspec-gstack-review`
 * expert skill (the review engine); this workflow owns only the loop, fix-size
 * triage, the author-vs-verifier invariant, deterministic termination, and
 * human escalation. Tool-agnostic, with an optional Claude Code agent-teams
 * acceleration (resume the original reviewer via SendMessage) and a mandatory
 * fresh-delta-review fallback everywhere else.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const REVIEW_CYCLE_INSTRUCTIONS = `Iterative review loop — drive a change to actually-clean: review the diff, triage findings, fix, re-review only the delta, and repeat until clean or escalate to a human.

This workflow does NOT reimplement the reviewer. Each review pass delegates to the always-installed \`openspec-gstack-review\` expert skill (invoke it as \`/review\`). This workflow owns the loop, fix-size triage, the author-vs-verifier invariant, termination, and escalation.

## When to Use

Use when: "review cycle", "keep reviewing until clean", "drive the findings to closure", "iterate on the review", "loop the review", "make sure the fixes actually got re-reviewed".

Use this AFTER implementation, against the live diff. For a single one-shot verification gate, use \`/opsx:verify-enhanced\` instead; this command is the loop that wraps a reviewer and keeps going.

## The Loop

\`\`\`
review -> triage -> fix -> re-review(delta) -> { pass | loop | escalate }
\`\`\`

Run rounds until a review pass returns no unresolved Blocker or Major findings, OR the max-rounds cap is reached. Default cap: 3 rounds. On hitting the cap with unresolved Blocker/Major findings, STOP and escalate to the human — never silently pass.

Track everything in a cycle report at \`openspec/changes/<name>/review-cycle-report.md\`: each round, each finding, its triage bucket, who fixed it, who confirmed it (the non-author), and the final disposition.

### 1. Select the Change

If a change name is provided, use it. Otherwise:
- Infer from conversation context
- Auto-select if only one active change exists
- If ambiguous, run \`openspec list --json\` and prompt for selection

Initialize round counter \`r = 1\` and read the configured/argument max-rounds (default 3).

### 2. Review Pass (delegate to the review engine)

Invoke the existing review engine — the \`openspec-gstack-review\` skill (\`/review\`) — against the current diff. Do NOT inline or duplicate its heuristics (SQL safety, trust-boundary, conditional side effects, etc.); it is the single source of review judgment.

Collect its findings and record them in the cycle report with their severity (Blocker / Major / Minor / Trivial). If the pass returns no Blocker or Major findings, go to step 6 (Terminate clean).

### 3. Triage Each Finding by Fix Size

Before any fix, bucket each open finding by the size of the fix it requires, and route it to the right actor:

| Bucket | Fix routed to | Examples |
|--------|---------------|----------|
| **trivial** | the orchestrator, inline | a typo, an obvious missing null guard, a one-line rename the orchestrator can see end-to-end |
| **non-trivial** | the implementing agent that wrote the affected code | logic bug, missing branch, incomplete error handling — the implementer holds the most context |
| **design-level** | a SEPARATE fix agent (not the original author) | the change touches the design / contract; it must not be quietly patched in place by the author |

Record each finding's bucket in the report. Routing-by-size keeps trivial fixes cheap and forces design-level findings through a fresh pair of hands.

### 4. Apply Fixes

Apply the fix via the actor chosen in triage:
- **trivial** — the orchestrator edits inline.
- **non-trivial** — hand the finding (with the original finding text and the affected files) to the implementing agent and have it fix.
- **design-level** — hand it to a separate fix agent; do NOT let the original author redesign in place.

Capture the exact fix diff (per finding) so the re-review can target only the delta.

### 5. Re-Review the Delta (Author != Verifier)

**Invariant: a finding is resolved ONLY when a reviewer who did NOT author the fix confirms the fix against the ORIGINAL finding text.** Self-certification by the fixer is rejected — the author re-reads their own intent, not the original objection. If the only confirmation available is from the agent that authored the fix, the finding stays OPEN and you MUST obtain an independent confirmation before resolving it.

Re-review ONLY the delta produced by the fixes (not the whole diff again). Two equivalent paths:

**A. Claude Code acceleration (optional, only when available).**
When running on Claude Code with agent-teams enabled (\`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\`) AND the original reviewer agent can be resumed, the lead MAY resume that original reviewer via \`SendMessage\`, asking it to re-review only the fix delta against its prior findings. Only the lead may originate \`SendMessage\`. This is a cheap optimization (the reviewer keeps its warm context).

**B. Tool-agnostic fallback (mandatory baseline).**
When agent-teams is unavailable or disabled, OR the tool is not Claude Code, OR the original reviewer cannot be resumed, fall back to a FRESH delta review: run \`/review\` (the \`openspec-gstack-review\` engine) as a fresh, non-author reviewer over just the delta. Pass the prior findings and the fix diff to that fresh reviewer through a SHARED FILE (e.g. \`openspec/changes/<name>/review-cycle-report.md\` or a round-scoped findings file) so it confirms against the original objection. The outcome is equivalent to the resume path — just costlier, because a cold reviewer re-reads context.

In BOTH paths the confirming reviewer MUST NOT be the agent that authored the fix.

**Trivial-fix equivalent check.** For a trivial fix the orchestrator applied inline, the equivalent non-author check is an independent gate-run (tests / lint / build) PLUS a diff-read of the exact change against the original finding. This gate-run + diff-read MUST be recorded in the cycle report as the non-author confirmation for that finding.

Mark a finding **resolved** only after its non-author confirmation passes. Record, per finding, which non-author check confirmed it (resumed reviewer / fresh reviewer / gate-run+diff-read).

### 6. Loop or Terminate

- **All Blocker/Major findings resolved (non-author confirmed)** -> go to step 6a (Terminate clean).
- **Resolvable findings remain AND \`r < max-rounds\`** -> increment \`r\`, return to step 2 and re-review the new delta. Continue the loop.
- **\`r\` has reached \`max-rounds\` AND any Blocker/Major finding is still unresolved** -> go to step 6b (Escalate).

#### 6a. Terminate Clean

Only when NO Blocker or Major finding remains unresolved. Report a clean pass and record the round history plus, for every previously-open finding, which non-author check confirmed it. Minor/Trivial leftovers MAY be logged as accepted-known. Never report clean while a Blocker or Major finding is open.

#### 6b. Escalate to the Human

When the round cap is reached with one or more unresolved Blocker/Major findings: STOP. Do NOT report the change as clean or passed under any condition. Escalate to the human, surfacing:
- the open Blocker/Major findings (with original finding text and current state),
- the round history (what was tried each round, who fixed, who re-reviewed),
- a recommendation for the next step.

A finding is closed only via resolution-with-non-author-confirmation OR explicit human escalation — never by silently passing.

## Termination Invariants (non-negotiable)

- Max rounds cap (default 3). The loop is bounded; no unbounded recursion / thrash.
- Never report clean while any Blocker or Major finding is unresolved.
- Author != verifier: the fixer cannot self-certify; an independent (non-author) confirmation is required for every resolution, including the trivial-fix gate-run + diff-read equivalent.
- On the cap with open Blocker/Major findings: escalate to the human; the failure mode is loud and human-owned.

## Output

\`\`\`
## Review Cycle: <change-name>

Rounds: <r>/<max-rounds>   Status: CLEAN | ESCALATED

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|-------|----------------------|--------|----------|---------------------------|----------|
| 1     | 1/2/1/0              | ...    | ...      | resumed reviewer / fresh / gate+diff | 3/4 |
| 2     | 0/1/0/0              | ...    | ...      | ...                       | 1/1      |

### Open (if ESCALATED)
- <Blocker/Major finding text> — round history, current state

### Report
- review-cycle-report.md
\`\`\`

## Integration Notes

- Delegates every review pass to \`openspec-gstack-review\` (\`/review\`) — one review engine, no fork.
- Runs AFTER implementation, against the live diff; complements (does not replace) the one-shot \`/opsx:verify-enhanced\` gate and plan-time \`plan-*-review\`.
- The cycle report (\`review-cycle-report.md\`) lives in the change directory alongside \`review-report.md\` / \`ship-log.md\` and is consumable by \`/opsx:retro\` and \`/opsx:archive\`.
- The Claude \`SendMessage\` resume path is strictly an optimization over the mandatory tool-agnostic fresh-review fallback; the workflow is fully usable on Codex and any other tool.`;

export function getReviewCycleSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-review-cycle',
    description:
      'Iterative review loop — review, triage, fix, re-review the delta, repeat until clean or escalate. Delegates each pass to the openspec-gstack-review engine; enforces author != verifier and a max-rounds cap.',
    instructions: REVIEW_CYCLE_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxReviewCycleCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Review Cycle',
    description:
      'Iterative review loop — review, triage, fix, re-review the delta, repeat until clean or escalate to a human',
    category: 'Workflow',
    tags: ['workflow', 'review', 'verification', 'iterative'],
    content: REVIEW_CYCLE_INSTRUCTIONS,
  };
}
