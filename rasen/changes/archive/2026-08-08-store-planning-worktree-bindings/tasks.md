## 1. Baseline, contracts, and adapters

- [x] 1.1 Record the production inventory of every caller that reads or asserts planning-worktree authority, target-line facts, or a planning/execution pair (`planningWorktreeVerified` in `src/core/store-planning/internal/resolver.ts`, the marker and association readers, `resolvedExecutionProjectRoot`, session context consumers) and classify each as this change's owner, an unchanged read consumer, or a later-slice owner.
- [x] 1.2 Capture current behavior in a baseline suite before anything moves: the marker-only planning-worktree acceptance, the `planning_worktree_required` refusal from an integration checkout, and the absence of any target-line writer, in `test/core/store/workspace-baseline.test.ts`. (Satisfied RETROSPECTIVELY — the production code had already moved when the suite was written, so it captures the behavior this change deliberately preserves rather than a snapshot that no longer exists: marker-only acceptance still authorizes with none of this change's machinery, the integration-checkout refusal still fires by name, and the third clause — "the absence of any target-line writer" — is asserted as the current truth, the writer set, because this change is what ended that absence.)
- [x] 1.3 Define the `StoreTargetLines` Interface (`list`, `show`, `add`, `setRef`, `resolve`), its input/result types, and its stable error-code union in `src/core/store/target-lines.ts`.
- [x] 1.4 Define the `StoreWorkspaceModule` Interface (`plan`, `apply`, `describe`, `planCleanup`, `applyCleanup`), its input/result types, its binding-state union (`unbound`, `prepared`, `bound`, `drifted`), and its stable error-code union behind one public entry point in `src/core/store/workspace/`.
- [x] 1.5 Add local-substitutable adapters for filesystem/canonicalization, Git, the machine-root coordination store, clock, and entropy, each with a deterministic in-memory test implementation using a fixed clock and a seeded entropy source.
- [x] 1.6 Restrict the Git adapter's write surface to `worktree add`, `worktree remove`, and `worktree prune`, and its read surface to `rev-parse`, ref enumeration, `worktree list --porcelain`, `status --porcelain`, `merge-base --is-ancestor`, and `ls-files --others`.
- [x] 1.7 Add a bounded source guard, in the shape child 2 and child 3 established, rejecting any other Git verb and any `--force` on `worktree remove` inside `src/core/store/workspace/`, in `test/core/store/workspace-git-verb-guard.test.ts`.
- [x] 1.8 Extend `PlanningScopeErrorCode` (or a Module-local union re-exported beside it) with the thirteen new codes, each with a message, the two disagreeing values, and a repair hint.

## 2. Target-line registry and ref resolution

- [x] 2.1 Implement `add`: validate the id through the Foundation portable contract, refuse an existing id, require a Store ref, and write `.rasen-store/target-lines/<id>.yaml` through the existing catalog serializer.
- [x] 2.2 Implement `setRef`: rewrite the Store ref or a per-project code ref in place, never rename or create an id, and refuse to remove a project locator that a bound Change still names.
- [x] 2.3 Implement `list` and `show` as read-only projections that report every catalog in the selected Store, including ones whose refs currently do not resolve.
- [x] 2.4 Implement `resolve`: turn a record into `{ targetLineId, storeRef, storeRefOid, codeRef, codeRefOid }` by resolving each ref in its own repository, failing with `target_line_ref_unresolved` naming the record field and repository when a ref is absent, ambiguous, or not a commit.
- [x] 2.5 Prove resolution never falls back: no `HEAD`, no current branch, no similarly named ref, and no branch-name parsing, asserted rather than only documented.
- [x] 2.6 Implement the `target_line_mismatch` gate: a command resolving a target line other than the one frozen in a Change's v2 identity fails, naming both lines.
- [x] 2.7 Take the scope lock for every catalog write, print a pathspec-scoped commit suggestion, and stage, commit, fetch, and push nothing.
- [x] 2.8 Add `test/core/store/target-lines.test.ts` covering add/set-ref/list/show/resolve, duplicate and invalid ids, locator moves that preserve identity, unresolvable and ambiguous refs, the branch-name-inference exclusions, and the mismatch gate.

## 3. Worktree identity and the binding reducer

- [x] 3.1 Derive `canonicalRepositoryIdentity` from the absolute canonicalized Git common directory and `canonicalWorktreeIdentity` from the absolute canonicalized worktree root, through the adapter, and feed both into the Foundation `deriveWorktreeInstanceId`.
- [x] 3.2 Fail closed when either identity input cannot be canonicalized; never degrade to the literal path string.
- [x] 3.3 Prove every linked worktree of one repository shares a repository identity and that each derives a distinct `WorktreeInstanceId`.
- [x] 3.4 Define the machine workspace index record (`<dataDir>/planning-workspaces/index/<planningScopeId>.json`) carrying scope, both worktree roots, both instance ids, both recorded refs and HEAD OIDs, the `changeId` alias, the optional `changeInstanceId` and `workspacePairId`, the plan id, and a phase field.
- [x] 3.5 Implement the binding reducer with the stated authority order: committed Change v2 identity outranks every local carrier for identity; markers are per-worktree locators; the index is never authority.
- [x] 3.6 Re-verify every index field before use — the roots are still worktrees of the recorded repositories, the instance ids re-derive, the scope matches the markers — and treat a failing re-verification as a conflict, not a repair.
- [x] 3.7 Repair a *missing* index entry idempotently from the markers and live Git, writing no fact that is not already true on disk, and assert repeated repair is byte-stable.
- [x] 3.8 Detect `workspace_binding_ambiguous`: two index entries claiming one execution worktree, or two planning worktrees claiming one Change instance; list every claimant and choose none.
- [x] 3.9 Record `projectId` as the portable execution-repository fact and the canonical repository identity for drift detection only; assert no `repo_...` identity is minted anywhere.
- [x] 3.10 Add `test/core/store/workspace-identity.test.ts` and `test/core/store/workspace-binding.test.ts` covering identity derivation, canonicalization failure, the authority order, index re-verification, idempotent repair, ambiguity, and every marker/metadata conflict.

## 4. Workspace plan construction and immutability

- [x] 4.1 Implement `plan` as read-only and total: it resolves the scope and the target line, surveys both repositories, and reports every unsatisfied precondition rather than stopping at the first.
- [x] 4.2 Build the closed action list (`reuse-planning-worktree`, `create-planning-worktree`, `reuse-execution-worktree`, `create-execution-worktree`, `write-planning-marker`, `write-execution-association`, `record-index-entry`), each carrying its absolute destination, the OID it is created from, and the digest of any file it writes.
- [x] 4.3 Freeze the Git OID preconditions into the plan: the target line's Store ref OID, its code ref OID, and the HEAD OID and checked-out ref of every reused worktree.
- [x] 4.4 Compute every destination through the layout and path contracts with containment checks against the recorded roots on the plan's declared path flavor, and refuse an existing destination with `workspace_destination_exists`.
- [x] 4.5 Refuse to reuse a worktree that is on a different ref with `workspace_ref_mismatch`, naming both refs and the `git switch` the user may run; never switch, check out, or reset it.
- [x] 4.6 Serialize the plan canonically, derive `planId` from its digest, and mint a `WorkspacePlanToken` carrying plan id, scope, target line, `changeId`, both ref OIDs, the reused HEAD OIDs, and the index fingerprint.
- [x] 4.7 Persist plans to `<dataDir>/planning-workspaces/plans/<planId>.json`; assert nothing is written inside either Git repository by `plan`.
- [x] 4.8 Support `intent: 'existing-change'`, which verifies an already-minted Change identity instead of reserving a new one and recomputes the pair id from the new worktree instance.
- [x] 4.9 Add `test/core/store/workspace-plan.test.ts` covering plan determinism for equal inputs, the full precondition report, destination containment on `path.win32` and `path.posix`, ref mismatch, destination collision, and the zero-write assertion.

## 5. Lock protocol

- [x] 5.1 Implement the four lock keys — scope `(storeUid, projectId, targetLineId)`, workspace `(workspacePairId)` or the prepared provisional key, change `(changeInstanceId)`, integration `(storeUid, targetLineId)` — as digests of their canonically serialized material.
- [x] 5.2 Store locks under `<dataDir>/planning-workspaces/locks/` using `acquireOwnerAwareFileLock`, so a dead holder is stolen only on an affirmative `ESRCH`.
- [x] 5.3 Enforce the fixed acquisition order scope → workspace → change → integration, and assert no code path reaches back for an earlier lock while holding a later one.
- [x] 5.4 Retry contention within a bounded deadline and then fail with `workspace_lock_unavailable`, naming the holder recorded in the lock file.
- [x] 5.5 Never retry a semantic conflict — a mismatched binding, a dirty tree, a moved ref — and assert the refusal is immediate.
- [x] 5.6 Surface a Git-level lock failure as itself; never remove a Git lock file and never add `--force` in response.
- [x] 5.7 Publish the change and integration lock helpers for the finalization owner without taking them in this change.
- [x] 5.8 Add `test/core/store/workspace-locks.test.ts` covering key derivation, ordering, bounded contention, dead-holder recovery, the no-retry rule, and concurrent scopes proceeding in parallel.

## 6. Apply: revalidation, creation, and binding writes

- [x] 6.1 Implement `apply` to consume only a token: it re-reads no working directory, no current branch, and none of the selectors that produced the plan.
- [x] 6.2 Take the scope and workspace locks, then revalidate under them: the target-line catalog text, both ref OIDs, every reused worktree's HEAD OID and checked-out ref, every destination's non-existence, the Store's declared layout version, and the index fingerprint; abort with `workspace_plan_stale` on any mismatch.
- [x] 6.3 Create new worktrees from the recorded OID rather than from the ref name, creating the planning branch when the plan says so, so a moved ref invalidates the plan instead of retargeting the worktree.
- [x] 6.4 Write the planning-worktree marker and the execution association with their planned digests, inside the two planned roots only, and assert no path outside those roots and the machine root is written.
- [x] 6.5 Record the index entry with its phase, and update the phase at every transition so an interrupted apply is resumable from the index rather than from a directory scan.
- [x] 6.6 Make apply idempotent for an already-satisfied action, so re-running a token after a partial failure completes rather than duplicating.
- [x] 6.7 Switch `planningWorktreeVerified` in `src/core/store-planning/internal/resolver.ts` onto the real verification: the marker must declare the resolved Store, project, and target line, the target line must resolve, and the worktree identity must re-derive.
- [x] 6.8 Prove a healthy hand-assembled pair still passes and is indexed on first use, and that an inconsistent one that previously passed now fails closed.
- [x] 6.9 Add `test/core/store/workspace-apply.test.ts` with injected failures after each action, asserting either a fully unprepared state or one complete prepared state, never a half-written marker or an orphaned worktree without an index entry.

## 7. Two-phase binding: prepared to bound

- [x] 7.1 Record a prepared workspace as `unbound`, carrying the scope, both worktree instances, the frozen OIDs, and the intended `changeId` alias, with no pair id.
- [x] 7.2 Complete the binding when a Change is created in the planning worktree: derive and verify the `WorkspacePairId` from the minted `ChangeInstanceId` and the two worktree instance ids, and write it into the index entry.
- [x] 7.3 Refuse a second Change creation in the same planning worktree with `workspace_already_bound`, without scanning the directory to decide which Change is current.
- [x] 7.4 Refuse to complete a binding whose Change metadata names a different Store, project, or target line than the prepared scope.
- [x] 7.5 Recompute the pair id when a worktree instance changes under `intent: 'existing-change'`, and prove the old and new pair ids differ.
- [x] 7.6 Expose `describe` returning the binding state and every verification finding, without writing anything.
- [x] 7.7 Add `test/core/store/workspace-pairing.test.ts` covering unbound → bound completion, the second-Change refusal, scope disagreement at completion, worktree replacement, and `describe` in each of the four binding states.

## 8. Session context v2

- [x] 8.1 Raise `RUNTIME_CONTEXT_VERSION` to 2 in `src/core/session-runtime-context.ts` and extend the Store planning arm and the project execution arm with `worktree: { root, worktreeInstanceId, headOid, ref }`.
- [x] 8.2 Add `changeInstanceId` and `workspacePairId` to the context, present only when the pair is bound and absent — never null or guessed — otherwise.
- [x] 8.3 Freeze the pair at session start from the resolved workspace, and keep the context machine-local and removed at session end, preserving every existing guarantee of the capability.
- [x] 8.4 Make commands inside a session use the frozen pair and fail closed when the live worktree disagrees — removed, moved, or on another ref — naming both, without re-deriving from the working directory.
- [x] 8.5 Refuse a mutation that needs the pair when the session records none, rather than falling back to the working directory.
- [x] 8.6 Confirm a version-1 context file reports the existing plain unsupported-version diagnostic rather than parsing partially.
- [x] 8.7 Extend `test/core/session-runtime-context.test.ts` and `test/core/session-runtime-context-e2e.test.ts` for the v2 shape, the frozen-pair precedence, live disagreement, absent-pair refusal, and the version-1 report.

## 9. Context projection

- [x] 9.1 Add a `workspace` object to `rasen context --json` carrying both worktree roots, instance ids, checked-out refs and HEAD OIDs, the Store/project/target-line/Change-instance facts, the pair id, the binding state, and the verification findings.
- [x] 9.2 Print the same facts in the human form of `rasen context`, and assert human/JSON content parity.
- [x] 9.3 Report absent facts as absent, and state explicitly when a scope has no prepared workspace.
- [x] 9.4 Assert the projection is inert: serializing or replaying it grants no mutation authority, and reading it writes nothing under either repository or the machine root.
- [x] 9.5 Distinguish the Store planning worktree from the execution checkout in the payload even when only one of them is available.
- [x] 9.6 Extend `test/commands/context.test.ts` for the workspace projection across the four binding states, the aggregate scope (which has none), and the inertness assertion.

## 10. Safe cleanup

- [x] 10.1 Implement `planCleanup` producing an ordered removal plan that lists every precondition as satisfied or unsatisfied with its values, and writes nothing.
- [x] 10.2 Assert preconditions 1-3: the root is one the pair recorded, it re-derives the recorded worktree instance id, it is a linked worktree and never a main checkout, and its checked-out ref is the recorded one.
- [x] 10.3 Assert preconditions 4-5: no tracked modifications and no staged changes; untracked files are listed in the plan and require `--include-untracked` to proceed.
- [x] 10.4 Assert precondition 6 with `merge-base --is-ancestor`: every commit on the branch is reachable from the recorded integration ref (planning side) or target code ref (execution side); never merge or rebase to satisfy it.
- [x] 10.5 Assert preconditions 7-8: no live session context references the worktree, and no scope or workspace lock is held by another process.
- [x] 10.6 Refuse with `workspace_cleanup_unsafe` listing every failed precondition, with no `--force` and no partial-removal option.
- [x] 10.7 Remove with `git worktree remove` without `--force`, then `git worktree prune`, recording the phase in the index entry before each step so an interrupted cleanup resumes from the phase and never concludes "already gone" from an absent directory alone.
- [x] 10.8 Prove cleanup never deletes a branch or any ref, never touches the Store integration checkout or the code repository's main checkout, never removes a path outside the two recorded roots, and never removes the Change directory, the project partition, the Archive, another pair's markers, or another pair's index entry.
- [x] 10.9 Remove this pair's index entry last, after both worktrees are gone.
- [x] 10.10 Add `test/core/store/workspace-cleanup.test.ts` covering each precondition's refusal, the untracked-file path, interrupted removal and resume, the never-deletes assertions by snapshot, and unbound-pair cleanup.

## 11. CLI surface

- [x] 11.1 Register `rasen store workspace plan|apply|show|cleanup` with `--store`, `--project`, `--target-line`, `--change`, `--planning-worktree`, `--execution-worktree`, `--include-untracked`, `--json`, and `--apply-plan <planId>`. (The group is a `store` subcommand, not a top-level one: `workspace` is a RETIRED top-level name that `test/commands/legacy-groups-removed.test.ts` keeps dead, the top level already carries `work`, `workset`, and `workflow`, and a pair is Store content because a standalone project has none.)
- [x] 11.2 Register `rasen store target-line add|set-ref|list|show` with `--store-ref`, `--project`, `--code-ref`, and `--json`.
- [x] 11.3 State in both command groups' first description sentence that a workspace is the bound planning/execution worktree pair and is unrelated to `rasen workset`.
- [x] 11.4 Render the plan preview as the full action and precondition table, identical in content between human and JSON output.
- [x] 11.5 Print pathspec-scoped commit suggestions for the target-line catalog write, and stage, commit, fetch, and push nothing from any command in this change.
- [x] 11.6 Update `src/core/completions/command-registry.ts`, the completion and help snapshots, and all three locale trees (`src/locales/{en,ja,zh-cn}.json`).
- [x] 11.7 Add `test/commands/workspace-cli.test.ts` and `test/commands/store-target-line-cli.test.ts` covering flag parsing, plan-then-apply through a stored plan id, dry preview zero writes, JSON/human parity, refusal output, and the commit suggestions.

## 12. Integration, cross-platform, and gates

- [x] 12.1 Add `test/commands/store-v2-workspace-journey.test.ts`: one migrated Store with two target lines and two projects, driven through target-line creation, workspace plan/apply, Change creation, context inspection, and cleanup.
- [x] 12.2 Prove two concurrent lines do not see each other's unmerged planning writes and do not serialize against each other, which is slice 4's completion criterion in the accepted design.
- [x] 12.3 Prove a branch rename leaves the same `ChangeInstanceId` resolvable through metadata and the index, and that no code path parses a branch name for project or line.
- [x] 12.4 Prove a project mutation from the Store integration checkout still fails with `planning_worktree_required` and leaves the integration checkout unchanged.
- [x] 12.5 Add `test/core/store/workspace-windows-paths.test.ts` covering `path.win32` and `path.posix` construction, mixed-case drive letters, short-name and junction aliases, separator forms, UTF-8 Chinese worktree names, and long paths.
- [x] 12.6 Rebase `test/commands/store-v2-planning-scope-journey.test.ts` onto a prepared workspace where the fixture's hand-written marker is now indexed on first use, keeping every assertion the case already carries.
- [x] 12.7 Prove this change does not unlock finalization: archiving a Change in a prepared, bound Store v2 workspace still reports `store_v2_finalization_unavailable` by name.
- [x] 12.8 Run the affected store, store-planning, session, context, and CLI suites and attribute any baseline failure without weakening a fail-closed gate.
- [x] 12.9 Run focused tests, TypeScript typecheck, lint, build, `rasen validate store-planning-worktree-bindings --strict`, and `git diff --check`; strictly decode every changed text file as UTF-8 and audit BOM, replacement characters, mojibake, and unrelated worktree changes.
