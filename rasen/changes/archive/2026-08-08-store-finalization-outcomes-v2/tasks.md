## 1. Baseline, contracts, and guards

- [x] 1.1 Record the production inventory of every caller that archives, prepares spec actions, composes an archive entry name, or reads `archive.json` (`src/core/archive.ts`, `src/core/archive-engine.ts`, `src/core/archive-accounting.ts`, `src/core/specs-apply.ts`, `src/utils/item-discovery.ts`, `src/core/store/layout-migration/evidence.ts`, the four generated workflow templates, `src/core/management-api/archive.ts`) and classify each as this change's owner, an unchanged standalone/legacy consumer, or a `store-v2-compat-hardening` read-caller.
- [x] 1.2 Capture current standalone and legacy flat Store archive behavior in a baseline suite before any seam moves — entry name, `archive.json` v1 field set, spec-sync application, journal phase order — in `test/core/archive-standalone-baseline.test.ts`, so a regression in the untouched paths is attributable.
- [x] 1.3 Define the `ChangeFinalizationModule` Interface (`plan`, `apply`, `describe`), its input/result types, its outcome-discriminated `ImmutableFinalizationPlan` union, and its stable error-code union behind one public entry point in `src/core/store/finalization/`.
- [x] 1.4 Assert the plan union is structurally landed-only for spec actions: a type-level test proves the `superseded`, `cancelled`, and `abandoned` variants are not assignable to any shape carrying `specActions`, so skipping passive spec sync cannot be forgotten at a call site.
- [x] 1.5 Extend `PlanningScopeErrorCode` (or a Module-local union re-exported beside it) with the new codes — `finalization_outcome_required`, `finalization_outcome_invalid`, `finalization_already_complete`, `finalization_plan_stale`, `landed_commit_unresolved`, `landed_commit_unreachable`, `landed_proof_unavailable`, `landed_implementation_undeclared`, `successor_scope_unverified`, `successor_ambiguous`, `workspace_pair_unavailable`, `finalization_spec_skip_conflict` — each with a message, the disagreeing values, and a repair hint.
- [x] 1.6 Add read-only local-substitutable adapters for filesystem/canonicalization, Git (`rev-parse`, `show`, `for-each-ref`, `merge-base --is-ancestor`, `status --porcelain`), the machine-root coordination store, clock, and entropy, each with a deterministic in-memory test implementation using a fixed clock.
- [x] 1.7 Add a bounded source guard, in the shape children 2, 3, and 4 established, asserting the finalization Module's Git adapter contains no writing verb at all — no `merge`, `rebase`, `reset`, `checkout`, `switch`, `branch`, `worktree`, `add`, `commit`, `fetch`, `pull`, `push`, `clone`, or `tag` — in `test/core/store/finalization-git-verb-guard.test.ts`.
- [x] 1.8 Add a source guard asserting no finalization code path constructs an archive entry name by string concatenation; every Store v2 destination comes from the Foundation layout contract.

## 2. Scope seam: the finalize intent and the archive-entry address

- [x] 2.1 Add `finalize-change` to `PlanningIntent` and a `ChangeFinalizationScope` capability to `src/core/store-planning/types.ts`, carrying the verified Store, project, target line, planning-worktree authority, and the workspace pair when child 4's index supplies one.
- [x] 2.2 Implement the `finalize-change` resolution arm in `src/core/store-planning/internal/resolver.ts`: it requires an existing Change, a verifying v2 identity block, a resolved target line, and planning-worktree authority, failing with `project_scope_required`, `target_line_required`, or `planning_worktree_required` exactly as project mutation does.
- [x] 2.3 Add the `{ kind: 'archive-entry'; changeId; changeInstanceId; archiveDate }` typed address to `ProjectReadAddress` and route it to `resolveStorePlanningLayoutV2Path`'s existing `archive-entry` case, rejecting an unverified instance id before returning a path.
- [x] 2.4 Keep `archive-line` as the parent address and prove `archive-entry` always resolves inside the `archive-line` location it belongs to, on both path flavors.
- [x] 2.5 Make the standalone and legacy flat Store arms of `finalize-change` resolve their existing flat archive location unchanged, minting no v2 identity and computing no v2 address.
- [x] 2.6 Add `test/core/store-planning/finalize-scope.test.ts` covering the four scope kinds, the three authority refusals, the archive-entry address on `path.win32` and `path.posix`, and the refusal of a malformed instance id.

## 3. Outcome resolution and its guards

- [x] 3.1 Implement `resolveFinalizationOutcome`: build the request from `--outcome`, `--by`, and `--reason`, and validate it through child 1's `validateFinalizationOutcome` with the current and successor scope records. Add no second outcome parser.
- [x] 3.2 Refuse a Store v2 finalization with no `--outcome` (`finalization_outcome_required`), listing all four outcomes and stating which needs a reason and which needs a successor.
- [x] 3.3 Refuse `--by` on a non-`superseded` outcome, `--reason` on `landed`, and a missing or whitespace-only reason on any non-landed outcome, each before any filesystem or Git access.
- [x] 3.4 Leave standalone and legacy flat Store archiving free of the outcome axis entirely: no flag is required, no outcome is recorded, and the v1 record is unchanged.
- [x] 3.5 Implement `finalization_already_complete` from the published entry plus the transaction journal, never from a directory scan, and make it idempotent rather than an error when the recorded transaction id and plan hash match.
- [x] 3.6 Read `implementation` only from the Change's committed `.openspec.yaml`; add no `--implementation` flag and assert its absence from the command surface so a planning-only claim cannot be made at archive time.
- [x] 3.7 Refuse `--skip-specs` together with `--outcome landed` when the Change has delta specs, with `finalization_spec_skip_conflict` explaining that a landed record asserts applied spec sync; allow it when there are no deltas.
- [x] 3.8 Add `test/core/store/finalization-outcome.test.ts` covering all four outcomes, every contradictory-flag refusal, the missing-outcome refusal, the standalone/legacy bypass, idempotent re-finalization, and the skip-specs conflict.

## 4. Landed reachability proof and planning-only intent

- [x] 4.1 Implement code-commit resolution in fixed priority — `--commit`, the ship log's recorded commit, the execution worktree `HEAD` — recording which source supplied it in the plan.
- [x] 4.2 Verify the resolved commit is a commit object in the execution repository (`rev-parse --verify <oid>^{commit}`), refusing with `landed_commit_unresolved` and naming the repository when it is not.
- [x] 4.3 Resolve the target line's `projects[projectId].codeRef` to a commit OID, reusing child 4's `target_line_ref_unresolved` contract and its fallback (design §11) when that Module is unavailable; never fall back to `HEAD`, the current branch, or a similarly named ref.
- [x] 4.4 Prove reachability with `merge-base --is-ancestor <commit> <codeRef>`, refusing with `landed_commit_unreachable` naming both OIDs and the ref, and with `landed_proof_unavailable` when Git cannot confirm either way.
- [x] 4.5 Freeze the code ref's OID at proof time in the plan and in the evidence inventory, and state in both the plan and the diagnostic that the proof is against the local ref and that nothing is fetched.
- [x] 4.6 Build `codeMerge` for a code-backed landed record from `projectId` as the portable repository fact (child 4 decision 3), the execution `WorktreeInstanceId`, the target ref, the commit, and `reachable: true`; never construct one for a non-landed outcome.
- [x] 4.7 Implement the `implementation: none` path: `codeMerge: null`, no commit resolution attempted, and a `landed_implementation_undeclared` refusal for a Change with no declaration and no reachable commit that names both repairs.
- [x] 4.8 Add `test/core/store/finalization-reachability.test.ts` covering each commit source, an unresolvable code ref, an unknown commit, an unreachable commit, an indeterminate Git result, a ref that moved between plan and apply, and both planning-only cases.

## 5. Successor resolution across Store refs

- [x] 5.1 Implement the per-ref successor search: enumerate the Store's target-line catalogs, take each line's `storeRef`, and read candidate `.openspec.yaml` files as Git blobs under every project partition's active Changes and Archive entries. Check nothing out.
- [x] 5.2 Re-derive each candidate's `ChangeInstanceId` from its v2 identity block and keep only exact matches for `--by`; never match on a Change alias, a directory name, or a branch name.
- [x] 5.3 Require exactly one match: zero is `successor_scope_unverified`, more than one is `successor_ambiguous` listing every claimant and choosing none.
- [x] 5.4 Report a ref that cannot be read as an unsearched ref with its reason, and refuse rather than concluding "not found" when any candidate ref was unsearched.
- [x] 5.5 Add `--by-target-line <id>` as a search filter that narrows the ref set, and prove it can never substitute for identity verification.
- [x] 5.6 Pass the resolved successor scope to child 1's `validateFinalizationOutcome` so the same-Store/same-project rule and the cross-target-line allowance are enforced by the canonical validator, and assert a cross-project successor is refused.
- [x] 5.7 Add `test/core/store/finalization-successor.test.ts` covering a successor on another target line, a successor already archived, a cross-project successor, zero matches, two matches, an unreadable ref, and the `--by-target-line` filter.

## 6. Landed-only spec synchronization

- [x] 6.1 Route landed spec preparation through the scope seam's `specs` location for the project partition, reusing `findSpecUpdates` and `buildUpdatedSpec` unchanged.
- [x] 6.2 Feed the engine `plan.outcome === 'landed' ? plan.specActions : []` at exactly one call site, and assert by test that no other site can supply spec actions.
- [x] 6.3 Derive `specSync.actions` from the same `PreparedArchiveSpecAction` values the engine applies, mapping create/update/delete to their before/after digests per design §7, and validate `capabilityId` through `parseChangeId`.
- [x] 6.4 Block a `create` action whose target precondition is not `absent`, and an `update` or `delete` whose precondition is `absent`, rather than coercing either into a shape that validates.
- [x] 6.5 Emit `specSync: { applied: true, actions: [] }` for a landed Change with no deltas, matching child 1's no-op landed scenario.
- [x] 6.6 Emit `specSync: { applied: false, actions: [] }` for every passive outcome, and prove the passive plan variant has no field that could populate an action.
- [x] 6.7 Add the byte-identity gate: finalize a Change carrying real ADDED/MODIFIED/REMOVED deltas as `abandoned` and as `superseded`, and assert every file under the project partition's `specs/` is byte-identical before and after, including mtime-independent content hashing rather than a "no diff reported" assertion.
- [x] 6.8 Add `test/core/store/finalization-spec-sync.test.ts` covering the digest mapping table, the precondition blocks, the landed no-op, both passive byte-identity fixtures, and a landed delete that removes a capability directory.

## 7. Archive v2 destination and record production

- [x] 7.1 Compute the destination through the `archive-entry` address from the Change's **frozen** target line and verified instance id, and prove a same-day retry with a different instance id yields a different address by construction.
- [x] 7.2 Implement the `target_line_mismatch` gate before any destination computation, canonical-spec read, or engine call, naming the frozen line and the resolved line.
- [x] 7.3 Obtain the verified `ChangeInstanceId` by re-deriving it from the Change's metadata seed and planning scope, and the verified `WorkspacePairId` from child 4's binding; refuse with `workspace_pair_unavailable` rather than minting either.
- [x] 7.4 Assemble the Archive v2 record — schema version, implementation intent, Store/project/target-line/alias/instance/pair identities, outcome data, planning worktree/ref/OID facts, code merge or null, spec sync, evidence, missing, timestamp — and validate it with `validateArchiveV2` at plan time, before anything is written.
- [x] 7.5 Map the engine's recursive evidence inventory to Archive v2's portable relative paths and lowercase digests, and its missing-evidence names, satisfying child 1's uniqueness and traversal rules on both path flavors.
- [x] 7.6 Serialize with `serializeArchiveV2` so the record self-verifies by re-parse before it is written, and prove a deliberately inconsistent draft (a passive record with an action, a landed record with `reachable` unproven) fails serialization and produces no file.
- [x] 7.7 Add `test/core/store/finalization-record.test.ts` covering the address construction, the mismatch gate, both identity refusals, the evidence mapping, the four record shapes, and the serializer refusals.

## 8. Engine seams and the Archive v2 accounting writer

- [x] 8.1 Add the optional `finalization` block to `CreateArchivePlanInput` and `ArchivePlan`, carrying the outcome, the validated record, the destination override, the association targets, and the lock keys; absent for standalone and legacy plans.
- [x] 8.2 Add an explicit `finalPath` override to `resolveArchiveTransactionPaths`, keeping the `${date}-${change}` composition as the default and asserting the stage path stays a sibling of the final path so publication remains a same-volume rename.
- [x] 8.3 Dispatch the accounting adapters (`resolveArchiveAccounting`, `writeArchiveJson`, `verifyArchiveAccounting`) on the presence of the finalization block: v2 writes the validated record, v1 writes today's `ArchiveAccounting`. Never sniff the file to decide.
- [x] 8.4 Keep the v2 write atomic and verified by re-parse before active-source removal, mirroring the v1 writer's temp-file, fsync, rename, and verify sequence.
- [x] 8.5 Add the `association-finalized` journal phase between `accounting-finalized` and `source-removed`, and extend the resume table so an interrupted run continues from it.
- [x] 8.6 Prove the four seams are inert for standalone and legacy archives by re-running the §1.2 baseline suite unchanged.
- [x] 8.7 Extend `archiveDatePrefixedNameMatches` and `parseArchivedRef` to recognize the `--<instanceShort>` suffix without breaking the un-suffixed form, and update only the readers the finalization path itself depends on.
- [x] 8.8 Add `test/core/archive-engine-finalization-seams.test.ts` covering the destination override, both accounting writers, the new journal phase, the resume table, and the suffix-aware name matching.

## 9. Immutable plan, token, revalidation, and locks

- [x] 9.1 Serialize the finalization plan canonically with the existing canonical-JSON helper, embedding the engine plan, and derive `planId` from its digest so a change to either half invalidates the token.
- [x] 9.2 Mint `FinalizationPlanToken` carrying plan id, store UID, project id, target-line id, Change instance id, workspace pair id when present, planning HEAD OID, code ref OID, and the Change source fingerprint.
- [x] 9.3 Store plans in the machine data directory beside the existing archive plan store, never inside either Git repository, and reuse the existing `--save-plan` / `--apply-plan` persistence rather than adding a second store.
- [x] 9.4 Implement `apply` revalidation under the locks: planning worktree HEAD and checked-out ref, the code ref OID and a re-proof of reachability, the target-line catalog text, every spec target digest, the destination's non-existence, the Change source fingerprint, and the successor evidence digest. Abort with `finalization_plan_stale` on any mismatch and invalidate rather than repair.
- [x] 9.5 Acquire the scope and Change-instance locks in child 4's fixed order, with the fallback derivation of design §11 when that Module is unavailable, and prove two finalizations of one Change instance are mutually exclusive.
- [x] 9.6 Prove different projects and different target lines finalize concurrently without waiting on each other.
- [x] 9.7 Retry lock contention within a bounded deadline and never retry a semantic conflict; surface a Git-level lock failure as itself.
- [x] 9.8 Add `test/core/store/finalization-plan-token.test.ts` covering plan determinism for equal inputs, every revalidation mismatch, token/plan divergence, mutual exclusion, and the concurrency case.

## 10. Association completion and recovery

- [x] 10.1 Implement the `association-finalized` phase: update the machine workspace-index entry to its finalized terminal state with the outcome, the published entry address, and the archive timestamp.
- [x] 10.2 Update the execution-side `.rasen/planning-binding.json` so its Change is recorded as finalized, and prove a later mutation from that checkout does not resolve the archived Change as active.
- [x] 10.3 Leave the planning-worktree marker untouched, and assert cleanup remains child 4's plan/apply with its own preconditions.
- [x] 10.4 Repair a **missing** index entry from the markers and live Git before updating it, writing no fact not already true on disk, and prove the repair is idempotent.
- [x] 10.5 Fail closed on a **disagreeing** entry with `planning_execution_binding_mismatch`, leaving the transaction recoverable with the archive published and the journal naming the phase, and prove re-applying the same token completes after the binding is repaired.
- [x] 10.6 Make the phase a recorded no-op — declared in the plan in advance — for a scope with no workspace pair, covering standalone, legacy, and a Store v2 finalization with no index entry and no markers.
- [x] 10.7 Add `test/core/store/finalization-association.test.ts` with injected failures before, during, and after the phase, asserting the transaction never reports complete with a stale binding and never leaves a bound pair pointing at a moved Change directory.

## 11. Lifting `store_v2_finalization_unavailable`

- [x] 11.1 Remove `storeFinalizationDiagnostic()`'s `store-project` refusal in `src/core/archive.ts` and route that scope to the finalization Module; keep the `legacy-store` refusal exactly as `store-layout-v2-migration` restored it.
- [x] 11.2 Replace `storedPlanFinalizationDiagnostic()` with stored-plan **revalidation**: a stored Store v2 plan is applied through §9.4 rather than refused, and `planActivePathIsStorePartition` is deleted with its path-substring heuristic.
- [x] 11.3 Rewrite the four generated workflow gate paragraphs — `src/core/templates/workflows/{archive-change,bulk-archive-change,ship,sync-specs}.ts` — so `store-project` no longer refuses, stating instead what each surface must supply (an explicit outcome, a reason or successor, a landed proof), and leaving the `legacy-store` refusal in place.
- [x] 11.4 Update `test/core/templates/legacy-store-gate-guard.test.ts` so it asserts the new clause set and still fails if the `legacy-store` refusal is dropped — the guard that caught child 2's round-3 finding R3-1 must keep catching the same class of omission.
- [x] 11.5 Rewrite the three journeys that assert the deferral by name into journeys that finalize: `test/cli-e2e/store-lifecycle.test.ts` (machine A and machine B cases), `test/cli-e2e/capstone-journeys.test.ts` journey 3, `test/commands/store-v2-planning-scope-journey.test.ts`. Each must archive with an explicit outcome, assert the target-line-scoped entry address, and assert the Archive v2 record's outcome and spec-sync fields.
- [x] 11.6 Update the two comment-level and assertion-level references in `test/commands/store-root-selection.test.ts` and prove a repository-wide grep for `store_v2_finalization_unavailable` returns nothing outside archived evidence.

## 12. Surface adoption: direct, bulk, ship, API

- [x] 12.1 Add `--outcome`, `--by`, `--reason`, `--commit`, and `--by-target-line` to the archive command surface, `src/core/completions/command-registry.ts`, and all three locale trees (`src/locales/{en,ja,zh-cn}.json`), with no English literal left in a diagnostic path.
- [x] 12.2 Report the finalization facts in `rasen archive --json`: outcome, Change instance, workspace pair, target line, published entry address, spec-sync applied flag and action count, and the reachability proof's commit and ref.
- [x] 12.3 Make `--dry-run` emit the same immutable finalization plan `apply` consumes, including every blocker and the record draft, and write nothing.
- [x] 12.4 Update the bulk archive workflow so every change in a batch carries its own explicit outcome, no outcome is inferred from a sibling, and a batch refuses as a whole when any member's outcome is missing.
- [x] 12.5 Update the ship workflow's in-ship archive to pass `--outcome landed` and to refuse when the delivered commit is not yet reachable from the target line's code ref, replacing the "we shipped, therefore archive" assumption.
- [x] 12.6 Add `POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize` to `src/core/management-api/router.ts` and its admission whitelist, mutating only by spawning the CLI, requiring the complete scope in the URL and the outcome in the body, and inferring no missing field from a query filter.
- [x] 12.7 Add the surface parity test: drive direct, bulk, ship, and API with identical inputs and assert the canonicalized finalization plan bytes are identical across all four, in `test/core/store/finalization-surface-parity.test.ts`.
- [x] 12.8 Add `test/commands/archive-outcome-cli.test.ts` covering flag parsing, the missing-outcome refusal, JSON/human parity, dry-run zero writes, and the stored-plan round trip.

## 13. Integration, cross-platform, and gates

- [x] 13.1 Add `test/commands/store-v2-finalization-journey.test.ts`: a migrated Store with two projects and two target lines, one Change landed with a real code commit, one abandoned, one superseded by a Change on the other line, and one planning-only landed — asserting the four entry addresses, the four records, and that only the landed ones changed canonical specs.
- [x] 13.2 Add `test/core/store/finalization-windows-paths.test.ts` covering `path.win32` and `path.posix` destination construction, mixed-case drive letters, case-folded destination collisions, UTF-8 Chinese Change aliases, and long paths.
- [x] 13.3 Add the recovery matrix: injected failures at spec write, publication, accounting, and association, each asserting either a fully unfinalized state or one complete finalized state, and that re-applying the same token completes rather than duplicating.
- [x] 13.4 Prove legacy Archive entries are untouched: a Store carrying entries relocated by `store-layout-v2-migration` finalizes a new Change without reading, rewriting, upgrading, or validating any legacy record, and no outcome, target line, or workspace pair is fabricated for one.
- [x] 13.5 Prove no Archive replays specs: reading, listing, and showing an Archive v2 entry — landed or passive — changes no canonical spec byte, and no code path applies a delta outside `ChangeFinalizationModule.apply`.
- [x] 13.6 Run the affected archive, store, routing, management, template, and CLI suites and attribute any baseline failure without weakening a fail-closed gate; enumerate every failure by file rather than extrapolating from a truncated tail.
- [x] 13.7 Run focused tests, TypeScript typecheck, lint, build, `rasen validate store-finalization-outcomes-v2 --strict`, and `git diff --check`; strictly decode every changed text file as UTF-8 and audit BOM, replacement characters, mojibake, and unrelated worktree changes.

## 14. Archive-ordering preconditions for this change's own delta

- [x] 14.1 **Before archiving this change**, confirm `store-layout-v2-migration` has already archived: this change's `store-planning-scope-routing` delta MODIFIES the requirement "Layout and planning binding states fail closed with a read-only legacy layout", which that child ADDs. Archiving out of order fails with `archive_spec_update_failed`.
- [x] 14.2 Run the pairwise title/scenario comparison between every MODIFIED block in `specs/` and the then-current `rasen/specs/<capability>/spec.md`, for all three MODIFIED capabilities, before the archive step — the portfolio's ship gotchas require this and the archive engine surfaces only one failing requirement per attempt.
- [x] 14.3 Author a real `## Purpose` for both new capabilities after archiving and confirm `grep -rl "TBD - created by archiving" rasen/specs/` returns nothing.
- [x] 14.4 Trim the archive engine's trailing blank line at EOF from every merged spec file, and confirm `git diff --check` is clean before committing.
- [x] 14.5 Note for `store-scoped-issues-management`: its `management-http-api` delta must copy the post-this-change scenario set of "Loopback and bearer security across the CLI-backed mutation surface", which this change amends to admit the finalize endpoint.
