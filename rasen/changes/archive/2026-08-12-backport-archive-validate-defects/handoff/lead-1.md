# Handoff: backport-archive-validate-defects — LEAD #1

## Original intent
User wanted to bring dev/0.1.7 content into dev/0.2.0 (initial ask: "merge 0.1.7 into 0.2.0"). Investigation revealed 0.1.7 and 0.2.0 are architecturally divergent (Store-v2 vs daemon/ECP); a full git merge/cherry-pick is not viable. User's final strategy: (1) cherry-pick the clean independent features into PR #151; (2) start change `backport-archive-validate-defects` to re-implement the six archive/validate defect fixes (B1-B6) on 0.2.0's own architecture; (3) Store-v2 + retention/OMP-rest as separate later changes.

## Position
Pipeline: manual (not rasen-auto driven). Stage: change `backport-archive-validate-defects` — planning artifacts complete (proposal/design/specs/tasks, 4/4), implementation (apply) NOT started.
Worktree: `.claude/worktrees/merge-017-into-020`, branch `fix/020-archive-validate-defects` (based on origin/dev/0.2.0 @ 75c3366a, clean — does NOT contain PR #151 content).

## Done / Remaining
Done:
- PR #148 merged into dev/0.1.7 (the 0.1.7 `archive-and-validate-defects` portfolio — the six fixes — merge commit efcf875d). CI green at 562f45bd after a flaky rerun.
- 0.1.7→0.2.0 full merge attempted: 27-file conflict, build ~17 tearing errors → aborted (Store-v2/dispatch divergence).
- cherry-pick of fix commits attempted: e82149fe (B2/B3) = validator 12-hunk conflict; archive-engine +765 lines divergent → not viable.
- PR #151 (clean independent features): build-stamp (ed373b74) + handoff (4dd163da) + OMP-recognize-host (ab041993), pushed to origin/DumoeDss, base dev/0.2.0, local build passes.
- change `backport-archive-validate-defects`: 4/4 artifacts done, apply-ready.

Remaining:
- Implement the change (B1/B2/B3/B4/B6 re-implemented on 0.2.0) via `rasen-apply-change`.
- PR #151: await CI + merge.
- retention + OMP-rest (probe/init/ui) adaptation: separate change (OMP depends on PR #151).
- Store-v2 architectural unification + its fixes (TOCTOU/workspace/registry): large separate change.

## Key decisions (and why)
- **0.1.7 and 0.2.0 are architecturally divergent parallel lines** (fork at e62b101f). 0.1.7 = Store-v2 (DISPATCH_ADAPTERS, ProjectSpace, target-line, finalize.ts, archive stored-plan, deliberately removed resolveExecutionRoot); 0.2.0 = daemon/ECP (sessionHost, reusable-sessions, reconciler, change-run, hardcoded dispatch). Mutually exclusive in router/runs/wire-types/archive/management-api. **Do NOT retry a full merge — it cannot be clean on either side.**
- **The six defect fixes are coupled to 0.1.7's architecture** (finalize.ts absent in 0.2.0; archive-engine/validator divergent; cherry-pick = 12+ hunk conflicts). **They must be re-implemented on 0.2.0**, using 0.1.7's fixes as a behavior reference only, not a copy target.
- **Only build-stamp/handoff/OMP-recognize cherry-pick cleanly** (PR #151). retention/OMP-probe touch divergent areas (agent-context/runtimes/store-selection) → re-implement, don't cherry-pick.
- **B1/B6 are Blockers** (pr+on-merge archive flow + ## Archive collision). Each needs a mutation-discriminating test (0.1.7 pattern verified: disable guard → observable flips).
- **Store-v2-coupled fixes (TOCTOU/workspace/registry) are done together with the Store-v2 port** (user decision), NOT in this change.

## Dead ends & gotchas
- Full merge (git merge origin/dev/0.1.7): aborted — all build errors were Store-v2/dispatch tearing, not fixable per-hunk without an architecture decision.
- cherry-pick e82149fe: validator.ts 12 hunks (0.2.0 also rewrote validator). retention (83d90747): touches store-selection (owner selectors + pipeline group divergent) + run-state. OMP-probe (c7f53de5): touches agent-context/runtimes (0.2.0 ECP).
- pashifika remote: write denied (https creds aren't pashifika's); push to origin (DumoeDss, gh auth) instead.
- 0.2.0 verified to have ZERO fix markers (no mergeConfirmed/reservedSection/unexpected_key/missingScenarios/resolveRegistrationRoot; finalize.ts absent).
- Both the PR #151 branch (chore/pick-017-archive-fixes) and this change's branch (fix/020-archive-validate-defects) live in the SAME worktree (merge-017-into-020); don't confuse them.

## Eliminated hypotheses
- "0.1.7 is mainly the six defect fixes" → NO: 0.1.7 carries a whole Store-v2/dispatch refactor (11 feat, 134 commits vs 0.1.6). The fixes are a small coupled part.
- "cherry-pick of fixes is cleaner than merge" → NO: fixes touch archive-engine/validator which 0.2.0 also rewrote → equally divergent.
- "all independent features cherry-pick cleanly" → NO: only those not touching agent-context/runtimes/archive-engine/validator/store-selection do.

## Working set
- Worktree: E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\merge-017-into-020
- Current branch: fix/020-archive-validate-defects (origin/dev/0.2.0 @ 75c3366a)
- Change dir: rasen/changes/backport-archive-validate-defects/ (proposal/design/specs/cli-archive+cli-validate/tasks done)
- PR #151 branch: chore/pick-017-archive-fixes (origin, base dev/0.2.0)
- Defect ground truth: E:\Downloads\2026-08-07-archive-and-validate-defects.md (B1-B6 detail)
- 0.1.7 fix reference commits: e82149fe (B2/B3), c09a1dcb (B1/B4/B6) — behavior reference only, NOT a copy target
- Implementation targets: src/core/archive-engine.ts (B1/B4/B6), src/core/validation/validator.ts (B2/B3), src/commands/archive.ts + validate.ts (wiring)

## Next action
Implement the change: `rasen-apply-change backport-archive-validate-defects` (or follow tasks.md manually). Start with B1 (Blocker): locate 0.2.0's archive apply path + timing gate (task 1.1), add the apply-time `mergeConfirmed` assertion. Use 0.1.7's e82149fe/c09a1dcb as a behavior reference but adapt to 0.2.0 structure (grep 0.2.0 for the equivalents of inspectArchiveApplyPlan/createArchivePlan/reportUnexpectedKeys — they may NOT exist by those names). Write a mutation test per Blocker (B1, B6).
