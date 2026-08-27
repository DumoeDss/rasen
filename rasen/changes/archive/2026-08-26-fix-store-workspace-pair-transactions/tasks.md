# Tasks: fix-store-workspace-pair-transactions

Run discipline for every task below: real-git suites carry explicit per-test timeouts (the 30s
default passes solo and fails in a parallel full run, then reads as a broken assertion). Never pipe
a test run through `tail`/`head` — the pipe masks a red exit code and destroys the failure list;
long runs go through background execution with bounded foreground polling. The live stores
(`elftia-store`, `E:/rasen-pairs/`, the machine index under `C:/Users/Sayo/.rasen/`) are read-only
evidence: no test, fixture, or dogfood step may mutate them or run a non-dry-run rasen command
against them.

## 1. Baseline: pin both defects with failing tests before any fix

- [x] 1.1 Build the disposable real-git pair fixture as a shared helper for this suite (temp dirs; real `git init` + commits for a v2 store with one project partition and a target line whose `storeRef` is a local branch, plus a project repo; own machine data dir and registry via env redirection per the established cli-dogfood recipe; explicit per-test timeouts; teardown tolerant of Windows EBUSY). New suite file: `test/core/store/workspace-repreparation.test.ts`.
- [x] 1.2 Baseline test A (wedge, vanished-worktree shape): prepare and complete a pair so the index entry holds non-empty worktree identities; `git worktree remove` + prune the planning side; re-plan (must be applicable, create at the recorded root); apply. Assert the CURRENT defect precisely: apply throws `workspace_plan_stale` with the "identity of the created planning worktree" message, expected = recorded id, actual = `(unknown)`. Mark with the defect-pin convention so the assertion is INVERTED by task 2.x (the test must be red against fixed code until then, proving it lands on the defect).
- [x] 1.3 Baseline test B (wedge, fresh-destination shape): prepare and keep a live pair; plan with an explicit new `--planning-worktree`; assert the plan is (defectively) applicable today and apply refuses with the same created-side identity staleness. This pin is inverted by 2.x/3.x into: plan itself refuses `workspace_already_bound` naming the recorded pair and the cleanup repair.
- [x] 1.4 Baseline test C (self-race visibility): plan; advance the store branch by one commit; apply. Assert the refusal is `workspace_plan_stale` naming BOTH the frozen and the live OID (this behavior is designed and survives the change — the pin guards the refusal's content, and the re-plan + apply convergence that defect 2 currently breaks when an entry survives).
- [x] 1.5 Run the new suite solo AND alongside the heavyweight store neighbors (full `test/core/store/` pass) to prove the timeouts hold in parallel; record the failing-as-expected output for 1.2-1.4 in `evidence/` (full enumerated failure list, no truncated tails).

## 2. Fix: apply-side create revalidation (design D1)

- [x] 2.1 In `revalidateWorkspacePlan` (`src/core/store/workspace/apply.ts:154-181`): for a create-disposition side, make destination absence satisfy revalidation (skip the identity comparison entirely when `live.exists === false`); scope the recorded-identity comparison to the resume case — destination exists on the planned ref AND the index entry's recorded side-root is the planned root via `samePath(existing.<side>.root, side.root, plan.pathFlavor)`.
- [x] 2.2 Invert baseline test A into the fixed contract: apply succeeds, the worktree is created from the frozen OID, and the index entry is re-recorded with the new non-empty identity (spec scenario "An absent created destination revalidates as satisfied"). Assert the new pair identity differs from the old one after Change binding completes (spec: re-preparation changes the pair identity). **Correction applied during implementation:** the last clause cannot hold in THIS shape and was moved. `worktreeInstanceId` is a pure function of the canonical repository directory and the canonical worktree root (`workspace/identity.ts` -> `deriveWorktreeInstanceId`), and `workspacePairId` is a function of that pair plus the Change instance, so re-creating at the SAME recorded root re-derives the SAME ids — asserting a difference there would assert something the identity model cannot produce. The main spec's scenario says "prepared again with NEW worktrees", so the difference is asserted in task 3.2's fresh-destination flow, where that condition actually holds; this task asserts SAMENESS at the same root, with the reason stated in the test.
- [x] 2.3 Add the resume-integrity guard (spec scenario "A resumed created destination must be the same incarnation"): create-destination exists on the planned ref, recorded identity for the SAME root mutated to a mismatching value → apply still refuses stale naming both identities; with the MATCHING recorded identity → apply proceeds idempotently. Prove the guard bites: flip the comparison in a scratch mutation and confirm the test goes red, with a unique landing-site assertion (print the asserted line/message; no literal-replace ambiguity).

## 3. Fix: plan-side recorded-pair reconciliation (design D2)

- [x] 3.1 In `buildWorkspacePlan` (`src/core/store/workspace/plan.ts`): when the own-Change index entry exists, emit per-side reconciliation preconditions — satisfied `<side>-recorded-pair-recreated` when the recorded root's worktree is gone and the plan creates there; unsatisfied (code `workspace_already_bound`, naming the recorded pair and `rasen store workspace cleanup --change <id>` as repair) when the recorded worktree is still live at a root other than the planned one. No new error code; all root comparisons through `samePath` with the plan's flavor.
- [x] 3.2 Invert baseline test B: the fresh-destination plan now reports the unsatisfied precondition and carries no token; after `workspace cleanup --change`, re-planning the same fresh destination is applicable and apply succeeds end-to-end.
- [x] 3.3 Cover the vanished-recorded-root preview (spec scenario "A vanished recorded pair is re-created visibly at its recorded root"): the plan is applicable and the satisfied precondition names the recorded root and states the re-creation; include a Windows case-aliased spelling of the recorded root resolving as the same root (no false block).

## 4. Fix: frozen-tip disclosure and compound prepare (design D3, D4)

- [x] 4.1 Emit the `<side>-created-from` satisfied precondition for every create-disposition side, naming the locator ref and frozen OID (`src/core/store/workspace/plan.ts`); assert it appears in the plan preview output for a created planning side and a created execution side, and does NOT appear for reuse sides.
- [x] 4.2 Add `prepare()` to `StoreWorkspace` (`src/core/store/workspace/module.ts`): acquire the same scope + workspace locks `apply()` takes, then plan, persist the plan, and apply the fresh token inside the single lock hold; return the plan and the prepared result. A plan with blockers releases the locks and returns the preview without applying (no token exists to apply).
- [x] 4.3 Expose `rasen store workspace plan --apply` in `src/commands/workspace.ts` routing to `prepare()`; preview rendering identical to `plan`, followed by the apply result; refusals surface unchanged. Update the command's help/hint text that currently prints the two-step follow-up.
- [x] 4.4 Tests for the compound (extend baseline test C): `plan --apply` succeeds in one invocation against a line that advanced just before the invocation; a ref advanced by a competing process between the compound's internal plan and apply (simulate via a dependency-seam hook that commits mid-window) still refuses `workspace_plan_stale`; repeating the compound after the movement stops converges. Lock behavior: a held scope lock makes the compound fail with `workspace_lock_unavailable` naming the holder, not deadlock.

## 4b. Fix: the surviving pair branch (design D6, added during implementation)

Found after 2.1 landed: neither `git worktree remove` nor `workspace cleanup` deletes a branch, so
every re-preparation meets its own pair branch and `git worktree add -b` fails on it. Without this
group, tasks 2.2 and 3.2 ("apply succeeds") are unreachable even with D1 and D2 in place.

- [x] 4b.1 In `planSide`/`planCreatedSide` (`src/core/store/workspace/plan.ts`): resolve the pair branch per create-disposition side and report it — satisfied `<side>-branch-available` (absent; mint from the line's frozen tip), satisfied `<side>-branch-reattached` (exists and checked out nowhere; `createsBranch: false` and `fromOid` = the branch's OWN tip), unsatisfied `workspace_ref_mismatch` naming the holding worktree (checked out elsewhere) or the match count (ambiguous). No new error code.
- [x] 4b.2 In `revalidateWorkspacePlan` (`src/core/store/workspace/apply.ts`): for a create side with `createsBranch === false`, revalidate the branch tip against the frozen OID and refuse `workspace_plan_stale` naming both — checked BEFORE the absence short-circuit, since the reattach case is precisely a create at an absent destination.
- [x] 4b.3 In the adapter (`src/core/store/workspace/dependencies.ts`): `addWorktree` gains optional `createBranch`, defaulting true so every existing caller is unchanged; false runs `git worktree add <destination> <branch>`. Still `worktree add`, so the closed Git verb set and its source guard are untouched — re-run `workspace-git-verb-guard.test.ts` to prove it.
- [x] 4b.4 Tests: reattachment preserves commits the pair branch carries and does not rewind it to the line; a worktree already holding the pair branch blocks the plan and keeps its HEAD; a reattached branch that moves between planning and applying refuses stale naming both commits.
- [x] 4b.5 Carry D6 into the delta spec (planning reports its branch finding for every created side; applying revalidates a reattached tip) with the matching scenarios, and into `design.md` as a full decision with its rejected alternatives.

## 5. Verification

- [x] 5.1 Full workspace + store suite pass: `pnpm exec vitest run test/core/store/` (background + bounded polling; enumerate every failure by name — no extrapolating flakes from a truncated tail; Windows EBUSY/rmdir residue is retried per the known flake pattern, logic failures are not).
- [x] 5.2 Cross-check unchanged guards still bite post-fix: reused-side HEAD/ref staleness, moved-ref staleness (baseline C), occupied-destination refusal, marker/association conflict refusals — run their existing suites (`workspace-apply.test.ts`, `workspace-plan.test.ts`, `workspace-binding.test.ts`, `workspace-pairing.test.ts`, `workspace-cleanup.test.ts`) and confirm no assertion was weakened by the D1/D2 edits.
- [x] 5.3 `pnpm build` clean; `pnpm exec tsc --noEmit` (or repo typecheck script) clean; lint clean on touched files.
- [x] 5.4 Real-CLI dogfood on a purpose-built temp store (never the live ones): script the full field sequence — prepare, complete, delete planning worktree, re-prepare via `plan --apply` on a branch that another commit advanced mid-sequence — through the packed CLI with env-redirected machine home; capture receipts in `evidence/`.
- [x] 5.5 Run `rasen validate fix-store-workspace-pair-transactions` and fix any artifact findings.

## 6. Delivery

- [x] 6.1 Re-verify the tree touches only owned paths (`src/core/store/workspace/plan.ts`, `apply.ts`, `module.ts`, `src/commands/workspace.ts`, new/updated tests, change artifacts) — explicitly diff-check that `src/core/store-planning/internal/resolver.ts` and `src/core/store/identity.ts` are untouched (sibling A ownership), and preserve unrelated uncommitted work in the tree.
- [x] 6.2 Update the architecture-index skill if any command surface or module responsibility described there changed (the `plan --apply` verb belongs in the workspace command's quick-locate row).
- [x] 6.3 Hand back: summarize the two defect fixes, the compound verb, and the operator follow-up (rebuild dist + reinstall dogfood CLI; the next elftia retention runs waiver-free through the official flow as the acceptance pilot — owner action against live stores, not part of this change's execution).
