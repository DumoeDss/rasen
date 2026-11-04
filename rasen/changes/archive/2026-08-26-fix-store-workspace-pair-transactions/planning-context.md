# Planning context — fix-store-workspace-pair-transactions

Seeded by the LEAD before the first propose. Read this FIRST, then research only what is missing.

## User intent (verbatim direction)

Operator approved scope "A+B+G2" on 2026-08-26: fix the Store-v2 retention/archive gap in three
tranches. This change is **B** — the two workspace plan/apply transaction bugs. Sibling A
(`fix-store-retention-scope-resolution`, already proposed and in apply) fixes the scope-resolution
seam; G2 covers the remaining residue (root-selection demotion, L6 part 2, doctor/CI cross-line
audits, store-setup projectId minting, legacy-store migration rehearsal).

## What B must fix (evidence)

Both defects were observed by a real Codex session (`01a02fb2-31a8-7391-a6ed-e290f242569e`,
2026-08-24..26, elftia project) while trying to run official retention for two fully-merged Changes
in `elftia-store`. Its own words, reporting the transaction that creates a fresh verified checkout:

> 官方新建 verified checkout 的事务自身有 bug：计划阶段把本地脏 `main` 的旧 tip 固化进去，apply
> 又把尚未创建的新 worktree 误判为 identity 变化，连续两次在写入前拒绝。

So, two distinct bugs in ONE flow:
1. **Stale-tip freeze (plan side).** The plan freezes the ref/tip it read from a locally-dirty
   `main`, so the plan is born stale.
2. **New-worktree identity misjudge (apply side).** Apply treats a worktree that does not exist yet
   as an identity change and refuses with a stale-plan style refusal.

Net effect: two consecutive refusals BEFORE any write. Fail-closed did its job (nothing corrupted),
but the flow is unusable, so retention could not run at all.

## Code anchors (verify; line numbers are 2026-08-26 dev/0.2.0)

- `src/core/store/workspace/plan.ts` — `headOid` capture ~135, ~290, ~524/544, ~819-823 (recorded
  reuse heads); the plan's freeze points.
- `src/core/store/workspace/apply.ts` — staleness/identity comparison ~146-195; `workspace_plan_stale`
  is the refusal it raises; note the branch distinguishing a *created* side from a *reused* side —
  the created-side comparison against `existing?.<side>.worktreeInstanceId` is the prime suspect.
- `src/core/store/workspace/identity.ts`, `registry.ts`, `locks.ts` — identity derivation, pair index,
  store-ordered locks.
- `src/core/store/workspace/module.ts` — the plan/apply orchestration surface.
- Design of record: `docs/zh/store-project-partitions-and-planning-worktrees.md` §5.3 (frozen pair
  binding), §10 (plan records digests + OIDs, re-validated at apply; change → invalidate and re-plan),
  §6 (`planChangeWorkspace` / `applyWorkspacePlan` are the only seam).

## Constraints and decisions already made

- **Do not weaken fail-closed.** §10 says a plan whose preconditions moved must be invalidated and
  re-planned. The fix is that the plan must not freeze the WRONG thing (a dirty local tip) and apply
  must not compare a not-yet-created worktree against a recorded identity that cannot exist. Never
  "fix" this by skipping the staleness check.
- Sibling A owns the resolver/registry/gate seam. B must NOT edit
  `src/core/store-planning/internal/resolver.ts` or `src/core/store/identity.ts` — if B believes it
  needs a change there, say so in design.md and leave it to A/G2 instead of colliding.
- Windows is the primary host; path case, drive letters, junctions, and long paths all bite here.
- Real-git tests must carry explicit per-test timeouts (the 30s default passes solo, fails in a
  parallel full run, and then looks like a broken assertion). Never pipe a test run through
  tail/head — the pipe masks a red exit code and destroys the failure list.
- A guard test that passes against unmutated code proves nothing; each new guard must be shown to
  fail against the pre-fix behavior.

## Open questions for the planner to settle in design.md

- What SHOULD the plan freeze for a to-be-created worktree — the resolved target ref's committed tip
  (not the dirty working tree), and how does that interact with a reuse-disposition side?
- Should apply's created-side check assert absence (the worktree must NOT exist yet, and post-create
  identity must match what the plan derived) instead of comparing against a recorded identity?
- Is there a third latent defect in the same flow (the Codex session only got two refusals deep)?
