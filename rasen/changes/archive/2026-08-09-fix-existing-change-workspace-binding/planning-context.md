# Planning Context

## User intent

Fix the deterministic Store v2 failure where `workspace plan --existing-change` followed by `workspace apply` leaves the workspace pair only `prepared`, without a `workspacePairId`, so finalization/archive rejects it with `workspace_pair_unavailable`.

The requested implementation direction is to reuse the canonical `completeChangeBinding()` function after both worktrees and their markers have been written whenever the plan already carries `changeInstanceId`. Do not duplicate workspace-pair derivation inside apply.

The requested regression coverage includes:

- Existing-change apply returns `bindingState: bound` with a valid, re-verifiable `workspacePairId`.
- `workspace show` reports the pair as bound and archive dry-run no longer reports `workspace_pair_unavailable`.
- Retrying apply remains idempotent.
- A missing execution worktree leaves the binding prepared rather than fabricating a pair.
- Worktree identity or target-line drift rejects binding.
- Cleanup still removes the completed pair.

There is also a smaller dry-run contract concern: under Store v2, passing `--yes` can still leave a merge-confirmation blocker in the displayed plan even though confirmation is consumed by `--apply-plan ... --yes`. Address it only if it is part of the same bounded code path and can be covered without broadening this fix.

## Repository and delivery constraints

- Worktree: `E:\wt\rasen-pair`
- Branch: `fix/existing-change-workspace-binding`
- Base: `origin/dev/0.1.7` at `d2cafbf28cfd62b3eddd8145f89ee9aea78847bb`
- Preserve cross-platform path behavior and the UTF-8 rules from the user-provided global `AGENTS.md`.
- The final delivery requested by the user is a commit, pushed branch, and GitHub pull request targeting `dev/0.1.7`.

## Durable findings so far

- The clean short-path worktree is necessary on Windows because the repository contains archived paths deep enough to exceed the legacy path limit beneath the normal `.claude/worktrees/` location.
- Rasen resolved this run as standalone project work and reports the change root, evidence directory, handoff directory, and execution-side ephemera directory explicitly; workers must use those paths rather than assume cwd-relative output.
- Existing-change planning already verifies committed v2 Change identity and freezes `changeInstanceId`; the defect is that workspace apply records that identity but does not invoke binding completion, so its final index entry lacks `workspacePairId`.
- `completeChangeBinding()` is the canonical completion authority: it surveys live worktree identities, checks the planning marker's Store/project/target-line facts, and derives a pair only when an execution identity is actually available.
- Store v2 finalization independently calls `verifyWorkspacePairId()` against the Change and both recorded worktree identities; the merge-confirmation display concern lives in a separate archive/finalization inspection path.
