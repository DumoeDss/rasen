## 1. Complete Existing-Change Apply Binding

- [x] 1.1 Update the locked `StoreWorkspace.apply()` orchestration so that, after `applyWorkspacePlan()` has written both binding documents, a plan carrying `changeInstanceId` invokes the canonical `completeChangeBinding()` with the plan's frozen scope, Change, planning-root, path-flavor, and coordination facts.
- [x] 1.2 Project the canonical completion result into the returned `PreparedChangeWorkspace`, keeping the default new-Change path unchanged and ensuring result, index phase, `changeInstanceId`, and `workspacePairId` agree.
- [x] 1.3 Revalidate a reused worktree's frozen `worktreeInstanceId` alongside its ref and HEAD before apply writes, using existing stale/conflict diagnostics and preserving target-line and marker disagreement as fail-closed outcomes.
- [x] 1.4 Preserve canonical incomplete behavior so an unavailable execution worktree identity records `prepared` without a pair identity, with no apply-local pair derivation or locator fallback.

## 2. Focused Binding Regressions

- [x] 2.1 Extend the workspace apply tests with an already-created Change plan and assert first apply returns `bound`, records the verified Change instance and pair identities, and produces a `WorkspacePairId` that re-verifies from both recorded worktree identities.
- [x] 2.2 Cover re-applying the same existing-change plan: assert the pair identity and Change instance remain unchanged, no extra worktrees or bindings are created, and the default new-Change apply still returns `prepared`.
- [x] 2.3 Add or extend negative cases proving an unavailable execution identity remains `prepared`, while reused-worktree identity drift and Change target-line or marker disagreement refuse completion without rewriting carriers.

## 3. Store v2 CLI Lifecycle Regression

- [x] 3.1 Add a real-CLI Store v2 journey for `workspace plan --existing-change` followed by `workspace apply`; assert the apply JSON and `workspace show` JSON both report `bound` with the same re-verifiable pair identity.
- [x] 3.2 In that journey, run archive dry-run with an explicit outcome and assert its blockers do not include `workspace_pair_unavailable`; do not change or assert the separate merge-confirmation display contract.
- [x] 3.3 Make the completed pair clean and reachable, then plan and apply workspace cleanup; assert both pair worktrees and only that pair's index entry are removed while the Change, branches, main checkouts, and unrelated state remain unchanged.
- [x] 3.4 Build every path assertion with `node:path` helpers and run the targeted workspace/CLI regressions on Windows, retaining the existing CI coverage for macOS and Linux path semantics.

## 4. Verification

- [x] 4.1 Run the focused workspace apply, pairing, CLI, and Store v2 journey test files and resolve every failure at the narrowest owning layer.
- [x] 4.2 Run `pnpm run build` and `pnpm run lint` once after the focused tests pass.
- [x] 4.3 Run the full `pnpm test` suite once after integration and confirm no Store v2 finalization or cleanup regression remains.
