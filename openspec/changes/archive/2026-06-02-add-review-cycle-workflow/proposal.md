## Why

OpenSpec has strong one-shot review pieces but no iterative review loop. Plan review (`enhance: plan-*-review`) fires once per artifact during planning, the always-installed `openspec-gstack-review` expert skill runs a single pre-landing pass on the diff, and the fusion `verify-enhanced`/`ship` commands each do one verification gate. None of them close the loop: after a reviewer files findings, nothing drives `review → triage → fix → re-review → {pass | loop | escalate}` until the change is actually clean. Today that loop happens informally in chat, with no invariant that a fix was confirmed by someone other than its author and no rule that unresolved findings escalate to a human instead of silently passing.

## What Changes

Add a new **runtime workflow** `review-cycle` (`/opsx:review-cycle`, skill `openspec-review-cycle`) — a first-class, iterative post-implementation loop that owns triage, the author-vs-verifier invariant, termination, and escalation, while delegating each review pass to the existing `openspec-gstack-review` engine.

- **Iterative loop**: review the diff, triage findings, fix, then re-review only the delta. Repeat until clean or the round cap is hit.
- **Author ≠ verifier invariant**: a finding is resolved only when a reviewer who did NOT author the fix confirms it against the original finding. For trivial inline fixes, an independent gate-run plus diff-read is the equivalent non-author check and MUST be recorded.
- **Fix-size triage**: trivial (orchestrator fixes inline) / non-trivial (the implementing agent fixes) / design-level (a separate fix agent).
- **Tool-agnostic with optional Claude acceleration**: on Claude Code with agent-teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) the lead MAY resume the original reviewer via `SendMessage` to re-review only the delta; otherwise it MUST fall back to a fresh delta review with findings passed through a shared file — equivalent outcome, just costlier.
- **Termination + escalation**: a max-rounds cap (default 3). On hitting the cap with unresolved Blocker/Major findings, STOP and escalate to the human — never silently pass.
- **Profile placement**: ships in the expanded/opt-in set (`ALL_WORKFLOWS`), NOT `core`.

This is a command/skill-axis workflow, NOT a schema artifact: the loop is iterative and runs at runtime against the diff, repeating N times. The `spec-driven` artifact graph models a DAG of files created once, not a loop, so `review-cycle` lives on the command/skill axis (`src/core/templates/workflows/*.ts` → `skill-templates.ts` → `skill-generation.ts` → `profiles.ts` → per-tool adapters). The core `spec-driven` schema is NOT modified.

## Capabilities

### New Capabilities
- `review-cycle-workflow`: the `/opsx:review-cycle` iterative review loop — SkillTemplate + CommandTemplate, the loop/triage/invariant/termination behavior, and the Claude-resume vs tool-agnostic-fallback re-review paths.

### Modified Capabilities
- `command-generation`: the workflow registry (`getSkillTemplates()` / `getCommandTemplates()` in `skill-generation.ts`, plus `ALL_WORKFLOWS` in `profiles.ts`) gains one new `review-cycle` entry.

## Impact

- **New file**: `src/core/templates/workflows/review-cycle.ts` — exports `getReviewCycleSkillTemplate(): SkillTemplate` and `getOpsxReviewCycleCommandTemplate(): CommandTemplate`.
- **Edit `src/core/templates/skill-templates.ts`**: re-export both functions from `./workflows/review-cycle.js`.
- **Edit `src/core/shared/skill-generation.ts`**: import the two functions; add `{ template: getReviewCycleSkillTemplate(), dirName: 'openspec-review-cycle', workflowId: 'review-cycle' }` to `getSkillTemplates()` workflowSkills; add `{ template: getOpsxReviewCycleCommandTemplate(), id: 'review-cycle' }` to `getCommandTemplates()`.
- **Edit `src/core/profiles.ts`**: add `'review-cycle'` to `ALL_WORKFLOWS` (NOT `CORE_WORKFLOWS`).
- **Tests**: add `test/commands/review-cycle.test.ts`; add assertions in the skill-generation/profile tests. Coverage: generation includes review-cycle for Claude; absent under the `core` profile; instruction text contains the author≠verifier rule, the max-rounds/escalation rule, and BOTH the Claude-resume path and the tool-agnostic fallback.
- **Docs** (on implementation): `docs/commands.md`, `docs/workflows.md`, and their `docs/zh/` mirrors.
- **Reuse, no fork**: `review-cycle` delegates each pass to the existing `openspec-gstack-review` skill (`skills/gstack/review/SKILL.md`) as the review engine; it does not duplicate review logic.
- **No change** to `schemas/spec-driven/**` or the artifact-graph code.
- **Backward compatible**: a new opt-in workflow; existing workflows and the `core` profile are unaffected.
