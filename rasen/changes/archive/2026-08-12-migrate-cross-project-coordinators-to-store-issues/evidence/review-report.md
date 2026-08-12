# Pre-Landing Review — `migrate-cross-project-coordinators-to-store-issues`

**Mode:** independent dispatched review; report only
**Base:** `origin/dev/0.1.7` at `efcf875da808cfcfa078c401ff2821d0c84dcb1f`
**Head:** `efcf875da808cfcfa078c401ff2821d0c84dcb1f`
**Branch:** `feat/store-owned-coordinator-migration-0.1.7`
**Diff fact:** HEAD equals the base; the reviewed implementation is the complete live working-tree delta, including the listed untracked source, test, fixture, and Change files.

## Scope Check

**Scope Check: CLEAN (with findings below)**
**Intent:** Add an explicit mapping-v2 compatibility bridge that migrates selected flat cross-project coordinators into standard Store Issues while preserving v1 behavior, safe publication/recovery, project identity, and narrow archive diagnostics.
**Delivered:** The diff implements that bridge across mapping, immutable plans, pure Issue compilation, reference verification, Issue-lock batching, staging/publication/recovery, receipts, archive diagnostics, CLI/docs, CI, and a real scene-bridge fixture. No unrelated product feature or public legacy-import API was found. The untracked `.rasen/` directory is machine/workflow state rather than a claimed product deliverable.

## Standards

### Coverage diagram

```text
mapping v1/v2
  -> evidence reducer (E1-E4; projectId authority)
  -> immutable plan v1/v2 + sourceChange compilation
  -> pure Issue compiler
  -> explicit generated-file inventory
  -> Issue batch lock -> Store/ref run lock
  -> stage -> schema/digest verification
  -> prepared rename -> digest -> completed mark
  -> receipt -> layout flip -> final manifest
  -> resume / rollback / retirement
  -> ordinary Issue read/state/plan and archive compatibility

Tests inspected:
  mapping -------- layout-migration-mapping.test.ts
  plan/gates ----- layout-migration-plan-gates.test.ts
  provenance ----- layout-migration-provenance.test.ts
  compiler ------- store-issue-migration-compiler.test.ts
  identity/receipt layout-migration-catalog-receipt.test.ts
  locks/recovery - store-issue-locks.test.ts,
                   layout-migration-apply-recovery.test.ts
  paths/encoding - layout-migration-windows-paths.test.ts,
                   source-byte-hygiene.test.ts
  CLI/archive ---- store-migrate-layout-cli.test.ts,
                   archive-legacy-coordinator.test.ts
  real journey --- layout-migration-scene-bridge-e2e.test.ts

Uncovered edges that produced findings:
  existing pre-change recovery manifest -> new strict reader       [STD-001]
  per-call custom coordination root -> migration Issue batch       [STD-002]
  unreadable exact active Change -> receipt compatibility lookup   [STD-003]
```

### STD-001 — Major — The unchanged manifest version rejects every pre-change in-flight recovery manifest

**Where:** `src/core/store/layout-migration/apply.ts:63-69`, `src/core/store/layout-migration/apply.ts:123-141`, `src/core/store/layout-migration/apply.ts:155-166`
**Classification:** ASK
**Failure scenario:** A user upgrades while a 0.1.7 layout migration is in `publishing` or `failed`. The existing version-1 manifest has `planId`, paths, preimages, and `createdPaths`, but no `runId` or `operations` because those fields did not exist at the base. The new `readRecoveryManifest` still dispatches on `version: 1` but requires `runId`, so `--resume` and `--rollback` both fail with `migration_run_missing`. The explicit legacy rollback branch at `apply.ts:1143-1149` is unreachable for that actual old manifest. The Store remains in its interrupted mixed state even though the previous release's recovery evidence is intact.
**Basis:** Standards data/recovery safety; change task 6.2 says to “preserve and strictly parse the recorded recovery manifest”; synchronized upstream archive-recovery behavior requires old durable evidence to remain recoverable rather than becoming unreadable after an upgrade.
**Recommended direction:** Either advance the prepared-operation manifest to a distinct schema version and strictly dispatch v1 (no `runId`/`operations`) versus v2, or add an explicit strict legacy-v1 schema and safe legacy recovery path. Add a fixture containing the exact base manifest shape and exercise status, resume, and rollback after process restart.

### STD-002 — Major — Recovery can acquire Issue locks in a different machine coordination root from the run it loaded

**Where:** `src/core/store/layout-migration/module.ts:372-385`, `src/core/store/layout-migration/module.ts:395-408`, `src/core/store/layout-migration/module.ts:224-226`; API surface at `src/core/store/layout-migration/types.ts:16-22`, `src/core/store/layout-migration/types.ts:34-36`
**Classification:** ASK
**Failure scenario:** An API caller invokes `recover({ globalDataDir: customRoot, ... })`. The manifest and immutable plan are correctly read from `customRoot`, but `withPublicationLocks` builds the Issue batch with `productionStoreIssueDependencies.coordination(this.globalDataDir)`. If the module was constructed without the same constructor option, this uses the default machine root. An ordinary `StoreIssues.setState` using `customRoot` can therefore mutate the generated Issue while resume or rollback believes it owns the same semantic key in a different lock directory. The publication run lock does not protect ordinary Issue writes, so planned digest/rollback assumptions can race.
**Basis:** Standards race/concurrency safety; design decisions 3 and 5 require “the same effective machine coordination root”; `store-issue-resources` requires apply, resume, and rollback to construct the existing keys in that same root; task 5.7 forbids a second effective mutex truth.
**Recommended direction:** Resolve one effective coordination root at the public call boundary and pass it into `withPublicationLocks`; use that same value for plan/manifest storage and Issue batch acquisition. Add a test where the module has no constructor root but `recover` receives a custom per-call root, then contend with an ordinary Issue write using that root.

### STD-003 — Minor — An unreadable real Change is silently treated as absent and can be shadowed by a historical conversion

**Where:** `src/core/archive.ts:283-288`, consumed at `src/core/archive.ts:304-321`
**Classification:** ASK
**Failure scenario:** The exact active Change directory exists, but `lstat` fails with `EACCES`, transient I/O failure, or another non-`ENOENT` error. `exactActiveChangeExists` catches every error and returns `false`; archive then queries receipts and may return `legacy_coordinator_became_issue`. Historical evidence has now shadowed a real current Change, contrary to the stated precedence, and the operator receives a false compatibility diagnosis instead of the underlying unreadable-source error.
**Basis:** Standards conditional-side-effect/error-handling review; `cli-archive` requires exact real active Changes to win and invalid/unreadable evidence to retain ordinary unreadable ordering; task 8.3 fixes real-Change precedence.
**Recommended direction:** Return `false` only for `ENOENT` (and the deliberately non-directory/non-real cases); propagate or convert other `lstat` failures into the existing archive unreadable diagnostic. Add a deterministic dependency/fault test for a non-ENOENT exact-source lookup failure with a matching receipt present.

### Verified standards evidence

- `src/core/store/layout-migration/evidence.ts:160-165` correctly uses `record.projectId` as membership/evidence authority; `record.id` remains human display text. The regression set includes `Elftia · 前端` in `test/core/store/layout-migration-catalog-receipt.test.ts:181-207` and a full migration with a display name at `:210-241`.
- Generated Issue files are authored only from the frozen explicit inventory and checked for containment, exact inventory, digests, strict UTF-8, Issue schema, and plan digest (`apply.ts:514-547`, `:678-742`).
- Issue lock batches deduplicate canonical bytes, sort with `Buffer.compare`, acquire before the run lock, and reverse-release (`issues/locks.ts:272-309`; `layout-migration/module.ts:176-239`).
- Publication records prepared intent before rename and completion after digest verification (`apply.ts:929-1036`), with the layout flip last (`:1040-1075`).
- Receipt state remains historical; the end-to-end test mutates receipt state and proves `issue.yaml` remains authoritative (`layout-migration-scene-bridge-e2e.test.ts:449-472`).
- `git diff --check origin/dev/0.1.7` completed cleanly.

**Standards count: 3 findings — 0 Blocker, 2 Major, 1 Minor, 0 Trivial. Worst: Major.**

## Spec

### SPEC-001 — Major — Task 6.2's preserved recorded-manifest requirement is incomplete

**Where:** `src/core/store/layout-migration/apply.ts:123-166`
**Classification:** ASK
**Failure scenario:** The strict reader labels the new shape as manifest version 1 while rejecting the exact version-1 shape emitted by the base implementation. A process-restart recovery started before this change cannot be resumed or rolled back after installing it.
**Requirement basis:** `tasks.md` 6.2: “Preserve and strictly parse the recorded recovery manifest during process-restart resume”; `store-layout-v2-migration` requirement “Migration stages, publishes atomically, retires separately, and recovers”; proposal line 11 includes recovery/rollback in the compatibility bridge.
**Recommended direction:** Version-dispatch old and new recovery contracts and add an exact old-shape restart vector. This is the same underlying defect as STD-001, retained here because the required report keeps Standards and Spec axes independent.

### SPEC-002 — Major — The “same effective machine coordination root” requirement is not met on per-call recovery

**Where:** `src/core/store/layout-migration/module.ts:224-226`, `src/core/store/layout-migration/module.ts:372-408`
**Classification:** ASK
**Failure scenario:** Recovery state is loaded from `input.globalDataDir`, while generated-Issue locks are acquired from `this.globalDataDir`; when those differ, migration and normal Issue commands can use different lock files for the same `(storeUid, issueId)`.
**Requirement basis:** `store-issue-resources` requirement “Issue writes serialize on a Store-level issue lock,” especially the same-effective-root clause; design decision 5 lines 197-203; tasks 5.5, 5.7, and 6.2-6.3.
**Recommended direction:** Thread the effective per-call root through the whole publication-lock wrapper and cover custom-root apply/resume/rollback contention.

### SPEC-003 — Minor — Real-Change precedence is not fail-closed for lookup errors

**Where:** `src/core/archive.ts:283-288`
**Classification:** ASK
**Failure scenario:** A real exact Change exists but cannot be stat'ed. Catch-all absence allows a matching historical receipt to win, so the compatibility seam claims the alias became an Issue instead of preserving current Change/unreadable precedence.
**Requirement basis:** `cli-archive` “Change Selection” requires a real exact active Change to win; tasks 8.2-8.3 require the query only at the direct source-not-found seam and preserve unreadable evidence ordering.
**Recommended direction:** Distinguish not-found/non-directory from operational read errors and test the latter with matching history.

### Spec conformance observed

- Mapping v1 and v2 are separately parsed, and plan v2 is selected only for explicit Store-Issue materialization.
- Active conversions are forced open; archived terminal conversions require a reason.
- `sourceChange` is migration-only and compiles to canonical `changeInstanceId` before serialization.
- The compiler emits only standard `issue.yaml` and optional `plans/0001.yaml`; the public `StoreIssues` interface is compile-time pinned unchanged.
- Archive compatibility is diagnostic-only, does not forward finalization options, excludes archived-source conversions, and leaves canonical Issue state authoritative.
- The scene-bridge fixture covers active and archived coordinators, no-plan behavior, a second ref, no-clobber, interruption/resume/rollback, retirement retry, Git restoration, and member-repository immutability.
- The synchronized project-identity fix is preserved: `projectId`, not the display `id`, keys migration evidence.

**Spec count: 3 findings — 0 Blocker, 2 Major, 1 Minor, 0 Trivial. Worst: Major.**

## Commands and evidence inspected

- Full live scope: `git status --short`, `git diff origin/dev/0.1.7`, diff stats/numstats, untracked-file inventory, and persisted full `apply.ts` diff.
- Base/head: `git rev-parse HEAD`; `git rev-parse origin/dev/0.1.7`.
- Whitespace: `git diff --check origin/dev/0.1.7` (clean).
- Base compatibility: `git show origin/dev/0.1.7:src/core/store/layout-migration/apply.ts` (confirmed the pre-change version-1 manifest has no `runId` or `operations`).
- Change artifacts: proposal, design, all three delta specs, and all 60 task clauses.
- Production areas: mapping/types/plan/plan-input/compiler/reference verification/locks/module/apply/recovery/receipt/archive/evidence/query/write guard/diagnostics/dependencies/flat-source/CLI/CI.
- Test areas: mapping, plan gates, provenance, catalog/receipt/project display identity, compiler, lock batching, apply/recovery fault matrix, Windows/POSIX paths, archive compatibility, CLI, source-byte hygiene, and scene-bridge end-to-end fixture.
- Focused Vitest, `pnpm lint`, and `pnpm build` were requested but the execution calls required approval and were not run in this review session. Therefore this report does not claim those gates passed; the findings above are source/spec verified and do not depend on test execution.

## Adversarial pass

The adversarial pass tested three claims rather than trusting checked tasks: (1) durable evidence survives upgrading from the base implementation, (2) “one mutex truth” still holds under the public custom coordination-root API, and (3) historical receipt evidence can never shadow current source truth. Each produced one verified finding above. No additional issue survived verification in generated-file containment, receipt/live-state authority, project display identity, lock byte ordering, or after-rename digest reconciliation.

## Final summary

The core migration architecture is coherent and the explicit `projectId` authority merge is preserved, but the change should not land without deciding the two Major recovery/concurrency defects. The archive lookup error collapse is a smaller but concrete precedence gap.

**FINAL VERDICT: FINDINGS**
**Standards: 3 — Blocker 0 | Major 2 | Minor 1 | Trivial 0**
**Spec: 3 — Blocker 0 | Major 2 | Minor 1 | Trivial 0**

## Review-cycle round 1 independent re-review

**Re-review scope:** Source/spec verification of the round-1 fixes for the three original underlying findings. The captured-delta path was outside this session's allowed filesystem roots, so its requested SHA-256 could not be independently recomputed here; conclusions below come from direct inspection of the corresponding live source and regression tests. Per the dispatched split, this re-review does not claim test, build, or lint execution results.

### STD/SPEC-001 — OPEN — Legacy-v1 dispatch is strict, but resume still fails after any recorded destination was already published

The schema collision itself is corrected: `apply.ts:63-111` defines distinct explicit legacy-v1 and prepared-v2 unions; `apply.ts:152-190` dispatches solely on the literal `version`, uses strict schemas, and fails unknown or cross-version fields closed. New runs emit only prepared v2 (`module.ts:268-301`), and the v2 publication path still requires run identity, prepared-operation ownership, and digest checks (`apply.ts:969-1070`). Status and legacy rollback can now parse the exact old shape, and rollback remains confined to manifest paths that the reader first proves are inside the Store (`apply.ts:205-214`, `:1155-1188`).

However, exact legacy resume is not generally restored. The v1-to-v2 upgrade preserves the legacy fields but initializes `operations: []` (`module.ts:503-515`). Revalidation permits an already-existing destination when it appears in legacy `createdPaths` (`apply.ts:315-324`, `:365-372`), but `publishPlan` then encounters that same destination and rejects it whenever no prepared operation exists (`apply.ts:969-983`). Therefore an actual base-version run interrupted after one successful rename—precisely when old `createdPaths` is non-empty—loads successfully but cannot resume. The new resume test does not distinguish this case: it explicitly expects `createdPaths: []` before resume (`layout-migration-apply-recovery.test.ts:1169-1199`). The rollback test covers non-empty legacy `createdPaths`, but only with `action: 'rollback'` (`:1201-1223`).

**Required direction:** During legacy resume, reconcile each recorded created destination against freshly staged/planned bytes and construct digest-backed v2 completed operations (failing closed on mismatch), or retain a separately strict legacy continuation path that safely recognizes exactly the old manifest's recorded outputs. Add a restart resume vector with at least one non-empty `createdPaths` entry; it must fail against the current fixer delta and complete without clobbering foreign bytes after the correction.

### STD/SPEC-002 — CONFIRMED RESOLVED

`recover` resolves one effective root once (`module.ts:372-381`) and passes it to plan loading (`:390`), Issue-batch acquisition (`:400-404`, `:465-471`), manifest writes during rollback/retirement (`:409-415`, `:442-452`), and resume publication (`:475-525`). `withPublicationLocks` now accepts that root and acquires the complete Issue batch from it before entering the Store/ref migration-run lock (`module.ts:177-240`). The custom-root test is discriminating: a restarted module has no constructor root, an ordinary Issue lock is held specifically in the per-call root, and recovery is required to reject while that lock is held before succeeding after release (`layout-migration-apply-recovery.test.ts:1131-1167`). Against the original wrong-root code, the first recovery would bypass the held lock and publish, so the rejection assertion would fail.

No new coordination-root propagation or lock-order regression was found in the reviewed recovery paths.

### STD/SPEC-003 — CONFIRMED RESOLVED

The exact-source lookup now maps only the existing missing-path predicate to absence and rethrows every other `lstat` failure (`archive.ts:283-294`). A directory symlink and a non-directory remain deliberately non-real because the positive result still requires `isDirectory() && !isSymbolicLink()` (`:289-290`). The receipt query remains after that exact-source check (`:297-327`), while apply-plan and abort-plan token routes still return before root resolution or compatibility lookup (`archive.ts:659-668`). The injected `EACCES` regression test supplies a typed `lstat`, confirms the exact path was reached, requires the identical operational error object to propagate, and verifies Store bytes remain unchanged (`archive-legacy-coordinator.test.ts:224-268`). Existing adjacent coverage retains real-Change and token-conflict precedence (`:270-293`). The narrow dependency uses the same `typeof fs.lstat` type as the imported promise API and retains `fs.lstat` as the default (`archive.ts:650-657`); no archive dependency API/type regression is evident from source inspection.

### Newly introduced regressions

No separate new finding survived review. The unsafe case above is the still-open legacy-resume portion of original STD/SPEC-001, not a new underlying defect. Strict union dispatch, v2 ownership/digest/no-clobber checks, legacy field preservation, effective-root threading, lock order, and archive dependency routing otherwise remain intact.

ROUND 1 RE-REVIEW VERDICT: FINDINGS — Blocker:0 Major:1 Minor:0 Trivial:0

## Review-cycle round 2 independent re-review

**Re-review scope:** Source/spec/test-quality verification of only the round-2 legacy-v1 continuation fix for the remaining STD/SPEC-001 Major. The optional captured diff is outside this session's allowed filesystem roots, so conclusions come from direct inspection of the live `apply.ts`, `module.ts`, and recovery tests. Per the dispatched split, no test, build, or lint result is claimed here.

### STD/SPEC-001 — OPEN — Reconciliation recognizes legacy outputs, but durably writes an ownership state that its own restart verifier rejects

The round-2 bridge correctly narrows legacy pathname evidence before granting ownership. `reconcileLegacyCreatedPaths` requires each recorded path to equal exactly one freshly staged destination, rejects duplicates/unplanned paths, requires staged and destination kinds to agree and both to exist, and compares `digestTree` digests before constructing a full v2 operation (`apply.ts:405-479`). Foreign bytes fail before the manifest upgrade and are neither deleted nor overwritten (`:458-466`; `layout-migration-apply-recovery.test.ts:1228-1247`). Exact string matching is conservative on Windows but valid base-recorded native paths remain stable: both the old `createdPaths` value and the new staged entry's `destination` derive from the immutable stored plan, rather than being independently reconstructed aliases.

Receipt comparison also uses the right planned state. Staging initially builds the receipt with its staged phase (`apply.ts:722-741`); reconciliation applies the normal `published` phase using the legacy run's `startedAt` (`:444-456`), which is the same timestamp publication uses (`:1029-1044`). `withMigrationReceiptPhase` is idempotent, so publication cannot double-stamp or bless a different receipt state. The resulting digest therefore represents the exact receipt bytes an interrupted base run would have renamed.

However, the durable v2 upgrade is not restart-safe. Reconciliation creates every adopted operation as `status: 'completed'` while leaving both copies present: the destination already exists and its freshly regenerated staged entry still exists (`apply.ts:431-477`). `resumeLocked` then writes that v2 manifest durably before calling `publishPlan` (`module.ts:505-543`). If the process stops after this manifest write and before `publishPlan` consumes that entry, the next restart calls `verifyRecoveryOperationOwnership` first (`module.ts:481-483`). That verifier explicitly requires a completed operation to have a present destination and an absent staged copy; both-present is rejected as `migration_recovery_ambiguous` (`apply.ts:522-544`). Thus the newly persisted ownership evidence violates the invariant required by the existing v2 recovery protocol at the exact durability boundary the fix introduces.

The same-process happy path masks this: `publishPlan` accepts the existing destination, records completion again, and eventually removes the entire staging root (`apply.ts:1046-1078`, `:1182`). The positive round-2 test only observes the final published manifest (`layout-migration-apply-recovery.test.ts:1201-1226`), so it cannot distinguish this crash window. The negative test meaningfully distinguishes pre-upgrade digest mismatch and verifies foreign-byte/non-upgrade outcomes, but there is no discriminating fault between the upgraded-manifest write and continued publication, nor an assertion that the just-written upgraded manifest immediately passes `verifyRecoveryOperationOwnership`.

**Required direction:** Before durably recording reconciled operations as completed, establish the protocol's required single-copy state, or extend publication/restart semantics so this explicitly durable reconciliation state is valid and safely consumable. Preserve a planned digest comparison before removing or otherwise changing staged evidence. Add a fault boundary immediately after the upgraded v2 manifest write; a fresh process must resume successfully, and both the durable operation and filesystem state at that boundary must satisfy `verifyRecoveryOperationOwnership`. Keep the existing foreign-byte case and add legacy-specific missing, unplanned/duplicate, wrong-kind, and receipt-state vectors with durable-manifest and non-mutation assertions.

### Newly introduced regressions

No separate additional finding survived source review. The invalid durable completed-operation state is the still-open recovery-integrity portion of original STD/SPEC-001. Existing v2 ownership/digest checks and rollback logic were not weakened in their established paths.

ROUND 2 RE-REVIEW VERDICT: FINDINGS — Blocker:0 Major:1 Minor:0 Trivial:0

## Review-cycle round 3 independent re-review

**Re-review scope:** Final bounded source/spec/test-quality audit of the round-3 fix for remaining STD/SPEC-001. The optional captured diff is outside this session's allowed filesystem roots, so this conclusion comes from direct inspection of the live `apply.ts`, `dependencies.ts`, `module.ts`, and recovery tests. Per the dispatched split, this report does not claim targeted/full recovery, type, build, lint, or LEAD gate results.

### Final disposition of original underlying findings

#### STD/SPEC-001 — CONFIRMED RESOLVED

The legacy-v1 adoption transition is now self-consistent at its first durable v2 boundary. `reconcileLegacyCreatedPaths` grants ownership only after exact unique destination matching, same-kind presence, receipt normalization where applicable, and exact staged/destination digest equality (`apply.ts:410-466`). It then removes only the regenerated staged proof copy, leaves the destination untouched, and constructs a complete `completed` operation with the new run id, deterministic kind/operation id, exact staged/destination identities, `expectedAbsence: true`, and the proved digest (`:467-484`). Before any v2 write, `resumeLocked` runs the unchanged `verifyRecoveryOperationOwnership` over the proposed manifest and immutable plan (`module.ts:506-549`), so destination-present/staged-absent and all existing destination-recording/digest invariants hold before the ownership claim becomes durable.

The post-write crash vector is discriminating and reaches the exact boundary. The new checkpoint is after `writeManifest(latest)` and before `publishPlan`, outside the publication catch that would otherwise rewrite the manifest as failed (`module.ts:539-553`; `dependencies.ts:100-122`). The test interrupts there, reloads the durable v2 manifest, requires its adopted operation to be completed and digest-backed, requires destination present and staged absent, directly runs the production ownership verifier with the immutable plan, and then uses a second fresh Module instance to publish the remaining entries (`layout-migration-apply-recovery.test.ts:1203-1256`). Round-2 code would fail both the staged-absence/verifier assertions and the second restart, so this is not a success-only or vacuous vector.

Fresh v2 restarts remain safe for destination-owned `completed` and prepared-after-rename operations. Existing durable ownership is verified before staging (`module.ts:483-485`). Fresh staging is then matched by exact operation destination and staged identity; receipt bytes receive the same ordinary phase transform; the regenerated digest must equal the durable expected digest; and only regenerated staging is removed (`apply.ts:487-539`, called at `module.ts:525-531`). `publishPlan` uses the durable operation digest only when that staged path is intentionally absent, re-digests the existing destination, requires both actual and expected digests to agree, and never renames over or deletes that destination (`apply.ts:1085-1141`). Prepared operations whose rename already occurred therefore reconcile to completed without weakening the pre-existing v2 verifier or no-clobber path.

The fail-closed matrix is substantive. Missing, unplanned, duplicate, and wrong-kind legacy claims resolve to `migration_recovery_ambiguous`; an incompatible receipt resolves to `migration_recovery_digest_mismatch`. Every row byte-pins the still-v1 manifest and snapshots all non-staging Store bytes before and after (`layout-migration-apply-recovery.test.ts:1258-1327`). The retained foreign-byte vector separately pins the foreign destination bytes and confirms no v2 upgrade (`:1329-1348`). Source ordering additionally shows mismatch returns before any manifest write; only machine-local regenerated staging may have changed. No deletion, overwrite, or false ownership of foreign content occurs.

Receipt authorization matches existing publication semantics: staging creates the canonical staged receipt from the immutable plan (`apply.ts:722-744`), both legacy reconciliation and later v2 restaging apply idempotent `published` using the original manifest `startedAt` (`apply.ts:444-456`, `:515-527`), and normal publication uses that same `initial.startedAt` (`:1093-1110`). Because the exact transformed staged digest must equal the destination/durable operation digest, a wrong phase, timestamp, or other receipt byte cannot be adopted.

Exact pathname comparison remains intentionally conservative and safe on Windows. A valid base-recorded native path and the staged entry destination both come from the same stored immutable plan, so their representation remains equal across restart; aliases are refused rather than canonicalized into ownership. Operation identities and digests satisfy the strict manifest schema and unchanged ownership verifier. Rollback still removes only digest-proved v2 operation destinations (or exact contained legacy `createdPaths` before upgrade), and no v2 run-id, digest, rollback, or no-clobber invariant was weakened.

#### STD/SPEC-002 — CONFIRMED RESOLVED (unchanged in rounds 2-3)

The round-1 effective coordination-root propagation and Issue-batch-before-run-lock correction remains the final disposition. Round 3 did not alter that locking/root code; the reviewed resume changes continue inside the existing publication-lock boundary.

#### STD/SPEC-003 — CONFIRMED RESOLVED (unchanged in rounds 2-3)

The round-1 fail-closed exact active-Change lookup remains the final disposition. Round 3 did not alter archive lookup, receipt compatibility routing, or archive dependencies.

### New findings

None. No Blocker, Major, Minor, or Trivial regression survived the final source/spec/test-quality audit.

### Final review-cycle table

| Round | Fixer handoff | Historical open counts after non-author re-review | Independent non-author confirmation |
|---|---|---:|---|
| 1 | `handoff/review-cycle-round-1-fixer.md` | Blocker:0 Major:1 Minor:0 Trivial:0 | STD/SPEC-002 and 003 confirmed resolved; STD/SPEC-001 remained open because non-empty legacy `createdPaths` could not resume. |
| 2 | `handoff/review-cycle-round-2-fixer.md` | Blocker:0 Major:1 Minor:0 Trivial:0 | Legacy destinations were digest-reconciled, but the durable completed operation had both staged and destination copies and failed its own fresh-process verifier. |
| 3 | `handoff/review-cycle-round-3-fixer.md` | Blocker:0 Major:0 Minor:0 Trivial:0 | STD/SPEC-001 confirmed resolved at the post-upgrade crash boundary; all three original underlying findings are closed. |

ROUND 3 RE-REVIEW VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

### Post-cap strategy confirmation

**CONFIRMED.** The three test-only expectation corrections preserve the discrimination established by round 3 and do not mask a product failure. The bounded round-3 CLEAN source verdict remains valid.

- The positive assertion now names the actual canonical target-line catalog field. `StoreTargetLineCatalogV1` strictly consists of `version`, `id`, `storeRef`, and `projects` (`src/core/store/planning-catalogs.ts:48-53`); migration serializes that schema through `serializeStoreTargetLineCatalogV1` (`src/core/store/layout-migration/plan.ts:637-670`). Requiring the published target-line file to contain `id: line-0.2` therefore checks the canonical identity emitted at the adopted destination rather than accepting an obsolete field name. It remains coupled with complete-state, durable-v2, completed-operation, and second-fresh-process assertions (`layout-migration-apply-recovery.test.ts:1203-1256`), so it is not a weak success-only check.
- The unplanned row now preserves every genuine base-recorded `createdPaths` entry and appends exactly one foreign path; the duplicate row preserves the same genuine ledger and appends exactly one second occurrence of its first entry (`layout-migration-apply-recovery.test.ts:1280-1289`). Consequently revalidation can recognize all real already-published destinations, after which `reconcileLegacyCreatedPaths` reaches the intended exact-match/`seen` checks. The foreign path has zero staged-plan matches; the appended duplicate is rejected by `seen.has(created)` after its legitimate first occurrence. Both therefore discriminate the reconciliation branch as intended rather than being intercepted by the earlier unrecorded-destination stale-plan gate.
- The negative contract remains strong: each row requires the specific fail-closed diagnostic, byte-identical legacy-v1 manifest, successful strict reparse still reporting version 1, and an unchanged snapshot of every non-staging Store byte (`layout-migration-apply-recovery.test.ts:1306-1325`). Appending rather than replacing claims does not relax these outcomes. Any staged proof copies consumed while examining preceding legitimate entries are machine-local regenerated staging, intentionally excluded from the Store snapshot and regenerated on retry; no destination or foreign bytes gain ownership or are mutated.
- Inspection of the post-cap strategy delta identified only these test expectation/data-shape corrections. The production transition reviewed in round 3—legacy reconciliation, proposed-manifest verification, destination-owned staging consumption, and the post-write checkpoint—remains unchanged by this correction.

**Currently open findings:** Blocker:0 Major:0 Minor:0 Trivial:0.
