## 1. Baseline, contracts, and guards

- [x] 1.1 Record the complete production inventory of flat Store planning writers and readers (`specsDir`/`changesDir`/`inRepoArchiveDir` against a Store root, `adoptions.yaml` access, v1 membership record access) and classify every hit as migration-source reader, migration Module owner, legacy frozen adapter, later-slice owner, fixture, or defect.
- [x] 1.2 Capture current flat-Store adopt, eject, archive relocate, membership migration, and doctor behavior in focused compatibility tests before any writer moves, in `test/core/store/migration-ops-flat-baseline.test.ts`.
- [x] 1.3 Extend the bounded source guard so a new join of `rasen/specs`, `rasen/changes`, or `rasen/changes/archive` against a Store root fails outside the frozen legacy adapter and the migration Module's source-side reader. **Rewritten in review round 1 (finding H2):** the first census matched four literal argument spellings and saw 7 of the 23 flat-helper calls in `src/`, so a call spelled any other way could not fail it. It is now inverted per `test/helpers/source-guards.ts` — every call is enumerated whatever its argument is named, and the whole per-file map is compared. **Round 2 (finding R2-3)** added the optional call (`changesDir?.(x)`, 39 `?.(` sites in `src/`) and recorded the residual holes honestly as three shapes — import alias, const rebinding, computed property — all needing symbol resolution, none present against a flat-path helper today.
- [x] 1.4 Define the `StoreLayoutMigrationModule` Interface (`inventory`, `plan`, `apply`, `status`, `recover`), its input/result types, and its stable error-code union behind one public entry point in `src/core/store/layout-migration/`.
- [x] 1.5 Define the item state taxonomy (`resolved`, the six `unresolved:*` states, the six `blocked:*` states) as a closed discriminated union with a human reason and a repair hint per state.
- [x] 1.6 Add read-only local-substitutable adapters for filesystem/canonicalization, Git ref enumeration, blob reads, worktree list, status and HEAD OID, Store/project registries, association reads, machine-root coordination storage, clock, and entropy, each with a deterministic test implementation.

## 2. Per-ref inventory

- [x] 2.1 Implement the ref survey: enumerate local refs and linked worktrees, read `.rasen-store/store.yaml` at each ref as a blob, and classify each ref as `layout-v2`, `flat`, `no-store-metadata`, or `unreadable` without checking anything out.
- [x] 2.2 Report remote-tracking refs in the survey and exclude them from migration candidacy with an explicit reason.
- [x] 2.3 Implement the working-tree inventory for the checked-out ref: flat specs, active Changes, Archive entries, Store-level design docs, `store.yaml`, v1 membership records, and the legacy adoption manifest.
- [x] 2.4 Make inventory total rather than fail-fast: an unreadable item is recorded with its reason and never aborts the scan.
- [x] 2.5 Compute and freeze the inventory fingerprint over the ref survey, every enumerated path, and the digest of every file read.
- [x] 2.6 Prove inventory performs zero writes: no staging directory, registry entry, lock file, or metadata mutation on any path, including the unreadable and mixed-layout cases.
- [x] 2.7 Add `test/core/store/layout-migration-inventory.test.ts` covering multi-ref surveys, a Store with no flat content, a mixed-layout ref, unreadable blobs, and the zero-write assertion.

## 3. Ownership evidence and provenance

- [x] 3.1 Implement the `E1` recorded-identity reader for Change `.openspec.yaml` identity blocks and Archive v2 `archive.json` project fields.
- [x] 3.2 Implement the `E2` store-records reader over `adoptions.yaml` entries and v1 membership record `adoption` name lists, preserving the source file and entry for the receipt.
- [x] 3.3 Implement the `E3` association reader, admitting a record only when the named project is a member of this Store.
- [x] 3.4 Implement the precedence reducer: `E1` binds and is never overridden, a lower-priority disagreement with `E1` is recorded as superseded evidence, and `E2`/`E3` disagreement yields `unresolved:evidence-conflict`.
- [x] 3.5 Reject every non-evidence heuristic explicitly — change-name prefix, Git branch name, directory adjacency, sibling ordering, and single-similar-member — with assertions rather than only documentation.
- [x] 3.6 Map evidence naming a non-member project to `unresolved:non-member-owner`, and evidence naming a project id that fails the v2 portable-id contract to `unresolved:unrecordable-identity`, never sanitizing the id.
- [x] 3.7 Build the spec provenance graph from active-Change and Archive delta-spec directories, propagating an unresolved contributor as `unknown` rather than dropping it.
- [x] 3.8 Classify each capability from its contributor set into assigned, `unresolved:unknown-owner`, or `unresolved:shared-spec`.
- [x] 3.9 Add `test/core/store/layout-migration-provenance.test.ts` covering each evidence class, precedence, superseded evidence, all rejection heuristics, and the multi-contributor and unknown-contributor spec cases.

## 4. Mapping file and operator declarations

- [x] 4.1 Define the strict mapping-file schema: per-item project assignments, shared-spec `owner`/`split` resolutions, `designDocs` reclassification, `defaultTargetLine`, per-item target-line overrides, and a `targetLines:` section with `storeRef` and per-project `codeRef`.
- [x] 4.2 Require the mapping file to resolve inside the Store worktree so it can be committed, reject an absolute path outside it, and record its digest in the plan.
- [x] 4.3 Reject a mapping entry that contradicts `E1` with `mapping-contradicts-recorded-identity`, and reject a mapping entry naming an unknown item, a non-member project, or an invalid id.
- [x] 4.4 Validate every declared target-line catalog through the Foundation contract, and mark a declaration that disagrees with an existing catalog `blocked:target-line-catalog-conflict`.
- [x] 4.5 Record every operator declaration as an assertion in the plan and receipt, labelled distinctly from derived evidence.
- [x] 4.6 Add `test/core/store/layout-migration-mapping.test.ts` covering schema rejection, out-of-Store paths, `E1` contradiction, unknown items, split and owner resolutions, and target-line declarations.

## 5. Plan construction, gates, and immutability

- [x] 5.1 Compute each resolved item's destination through the Foundation layout contract, with containment and case-folded uniqueness checks over the whole destination set.
- [x] 5.2 Enforce no-clobber: any existing destination yields `blocked:destination-exists` with both paths.
- [x] 5.3 Detect `blocked:mixed-layout` (a `layoutVersion: 2` ref still holding flat planning content without a matching completed receipt) and `blocked:store-identity-missing`, each with its repair command.
- [x] 5.4 Detect `blocked:dirty-source` from tracked modifications and staged changes on plan sources; report untracked files inside moved trees and require `--include-untracked` to proceed.
- [x] 5.5 Mint one instance seed per relocated Change with a declared target line, derive and verify `PlanningScopeId` and `ChangeInstanceId`, verify rather than re-mint an existing v2 identity, and record the alias-to-instance mapping.
- [x] 5.6 Mark every item needing a target line but lacking a declaration `unresolved:missing-target-line`, including Archive entries and identity minting.
- [x] 5.7 Serialize the plan canonically, derive `planId` from its digest, and mint a `MigrationPlanToken` carrying plan id, store UID, ref, HEAD OID, and inventory fingerprint.
- [x] 5.8 Implement the apply gate: refuse unless every item is `resolved` and no item is `blocked`, with no `--force` and no subset option, listing each blocker with its reason and the mapping key that would resolve it.
- [x] 5.9 Add `test/core/store/layout-migration-plan-gates.test.ts` covering every unresolved and blocked state, destination uniqueness on a case-insensitive filesystem, identity minting and verification, and plan determinism for equal inputs.

## 6. Staging, publication, retirement, and recovery

- [x] 6.1 Stage the complete destination tree under `<StoreRoot>/.rasen/migration/staging/<planId>/` by copying, never moving, so flat sources stay intact and readable throughout.
- [x] 6.2 Verify staging by per-file digest, strict UTF-8 decode with BOM/replacement-character rejection, Foundation schema validation of every produced catalog and metadata file, identity re-derivation, and destination containment.
- [x] 6.3 Write the recovery manifest to the machine root keyed by store UID and ref before the first destructive step, and update its phase at every transition.
- [x] 6.4 Implement revalidation at `apply`: Store metadata text and layout version, ref name and HEAD OID, every source digest, every destination's non-existence, the mapping digest, and every catalog upgrade's source text; abort with `migration_plan_stale` on any mismatch.
- [x] 6.5 Publish by ordered same-volume rename (project catalogs, target-line catalogs, project partitions, receipt) and write `layoutVersion: 2` last as the single linearization point.
- [x] 6.6 Implement `--retire-flat` as a separate idempotent step that refuses unless a completed publication receipt exists for this ref, and remove the legacy adoption manifest in the same step.
- [x] 6.7 Implement `status`, `--resume`, and `--rollback`: resume continues from the recorded phase, rollback removes only manifest-recorded created paths and restores the previous `store.yaml` bytes, and rollback after retirement refuses and names Git as the recovery path.
- [x] 6.8 Take the Store-scoped owner-aware lock keyed by store UID and ref for the whole apply, and revalidate HEAD and metadata under it.
- [x] 6.9 Add `test/core/store/layout-migration-apply-recovery.test.ts` with injected failures at copy, verify, each rename, the layout flip, and retirement, asserting a fully readable pre-publication state or one complete published state, never a partial tree.

## 7. Catalog upgrade and migration receipt

- [x] 7.1 Implement the v1 membership record to v2 project catalog upgrade, carrying `projectId`, `id`, `remote`, `knowledgeBundle`, and `roles`, and blocking with `blocked:unrecordable-catalog-field` when a value fails the stricter v2 validators. **Corrected in review round 2 (finding R2-4):** `id` was one of those validators and should never have been. It is the project's human display name in the v1 record, in `StoreMembershipRecord` and in `MembershipMutationInput.projectDisplayId`, but the v2 catalog ran it through `parseChangeId` — the only place in the tree that function was applied to something that is not a change, capability or node id — so a Store whose record held `Elftia` or `my app` could not be migrated at all until someone hand-edited the YAML. `projectId` is the identity and is validated as one; `id` now accepts exactly what the v1 record accepts, and the blocked-field repairs name the remedy rather than the objecting validator.
- [x] 7.2 Derive `planningBinding` only from adoption evidence or a proven pointer-without-local-planning binding, canonicalize `boundAt` from `adoptedAt`, and never bind on membership alone.
- [x] 7.3 Make every membership reader dispatch on the Store's declared layout version rather than sniffing file content, and report a v1 record inside a v2 Store as a diagnostic rather than a tolerated variant. **Completed in review round 1 (finding H1):** four readers were still on the v1 parser when this was first ticked — `listStoreMembers`, `resolveProjectMembership`, and `bootstrap.ts`'s `projectFirstBundleDeclarations` and `readUnreadableRecord`. The guard for this task tested the DISPATCHER, never its consumers, and no fixture in `test/` declared `layoutVersion: 2` for either membership reader.
- [x] 7.4 Define and serialize the committed migration receipt at `.rasen-store/migration/receipts/<planId>.json` with deterministic field order, UTF-8 without BOM, and a trailing newline.
- [x] 7.5 Populate the receipt with per-item source/destination/owner/evidence, minted identity and old-alias mappings, dropped adoption lists, the legacy manifest content, relocated legacy Archive entries marked `recordSchema: legacy`, shared-spec resolutions with contributors, retained design docs, superseded-evidence findings, and phase timestamps.
- [x] 7.6 Add `test/core/store/layout-migration-catalog-receipt.test.ts` covering the upgrade table, binding derivation, layout dispatch, receipt round-trip determinism, and receipt completeness against a fixture Store.

## 8. Adopt and eject on project partitions

- [x] 8.1 Refuse adopt into a non-v2 Store with `legacy_flat_store_requires_migration` naming `store migrate-layout`, and refuse a mixed-layout Store outright.
- [x] 8.2 Route adopt destinations through the Foundation layout to `rasen/projects/<projectId>/{specs,design-docs,changes}` and require the adopted project id to satisfy the v2 portable-id contract.
- [x] 8.3 Scope the adopt collision precheck to the target project's partition, case-insensitively, and prove two projects may adopt the same Change and spec aliases.
- [x] 8.4 Require `--target-line <id>` naming an existing catalog for `--archive move` in a v2 Store, and land entries under `changes/archive/<targetLineId>/` without renaming them.
- [x] 8.5 Write the project catalog with `planningBinding: bound` before any source deletion, and make the bound catalog the resume marker for an interrupted adopt.
- [x] 8.6 Route eject to read the project partition as the ownership record, reject `--all` in a v2 Store with an explanation, and report `eject_partition_missing` when there is no partition.
- [x] 8.7 Flatten Archive line subdirectories into the repository's single archive directory with a no-clobber check that refuses on a cross-line name collision, listing both source paths.
- [x] 8.8 Set the catalog to `unbound` while preserving roles on eject, remove the partition, and keep the existing copy → verify → delete, zero-git-write, preview, and per-repository commit-suggestion behavior on both commands.
- [x] 8.9 Add `test/core/store/migration-ops-v2-partitions.test.ts` covering adopt destinations, per-partition collisions, archive target-line requirement, interrupted-adopt resume, eject restore, archive flattening collision, and unbinding.

## 9. No-dual-write guards and CLI surface

- [x] 9.1 Implement `assertStoreLayoutForWrite(storeRoot, intent)` and call it from adopt, eject, archive relocation, and membership record writes before any write. **Amended in review round 1 (finding M6):** membership record writes now meet the guard through a third write shape, `metadata` — a membership file lives at the same path in both layouts and only its schema follows the declared layout, so neither the flat nor the partition refusal applies to it, but the mixed-state refusal does, and branching on `.declared` alone never consulted `.mixed`. The migration Module is deliberately NOT a caller: it is the one writer that legitimately spans both layouts, so the partition refusal would reject the flat-to-v2 publication outright and the mixed refusal would reject `--resume`, which is the documented recovery for exactly the mixed state. Its equivalent gates are `blocked:mixed-layout` at plan time, `revalidatePlan` at apply time, and the Store-scoped owner-aware lock.
- [x] 9.2 Require `--target-line <id>` and a bound project for `archive relocate --to store` in a v2 Store, land entries in that project's target-line Archive directory, and fail closed without a target line.
- [x] 9.3 Register `rasen store migrate-layout <store-id>` with `--mapping`, `--default-target-line`, `--include-untracked`, `--dry-run`, `--json`, `--apply`, `--status`, `--resume`, `--rollback`, and `--retire-flat`, and update option types, completion, and help snapshots.
- [x] 9.4 Render the preview as the full item table with states, reasons, destinations, other flat refs, retained design docs, and untracked-file warnings, identical in content between human and JSON output.
- [x] 9.5 Print pathspec-scoped commit suggestions for the publication commit and the separate retirement commit, and stage, commit, fetch, pull, and push nothing.
- [x] 9.6 Add `test/commands/store-migrate-layout-cli.test.ts` covering flag parsing, dry-run zero writes, JSON/human parity, the apply gate refusal output, and the two commit suggestions.

## 10. Migration diagnostics

- [x] 10.1 Add the flat-ref, mixed-residue, and incomplete-run diagnostics with the refs, paths, and repair commands they name.
- [x] 10.2 Add the unresolved-ownership and unresolved-shared-spec diagnostics by re-running inventory and provenance in a strictly read-only mode.
- [x] 10.3 Add the partition-orphan, legacy-membership-record, legacy-archive-record, and unclassified-design-doc diagnostics.
- [x] 10.4 Report every new code from both `rasen doctor` and `rasen store doctor` with identical codes and repair commands in human and JSON output, and prove diagnosis modifies no file under either repository or the machine data directory. **Completed in review round 1 (finding M4):** `rasen doctor` reported none of the nine codes when this was first ticked, and the delivered delta had been narrowed to `rasen store doctor` rather than the gap being recorded. Both doctors now call the one `diagnoseLayoutMigration`, the delta text is back to what D13 promises, and the `.catch(() => [])` that reported an undiagnosable Store as healthy is gone from both. **Round 2 (finding R2-1) closed the second invocation form:** the round-1 fix worked for `rasen doctor --store <id>` but not for `rasen doctor` run ambient inside a migrated Store, which refused with `project_scope_required` before doctor's own aggregate branch was reached — because the `store-read` intent was requested only when `--store` was passed, and a layout v2 Store resolves as a store aggregate. Doctor reads and never authors, so it now asks for `store-read` whenever no `--project` is given. The round-1 parity test ran ambient but against a legacy flat fixture, which resolves as `legacy-store` and never meets the refusal.
- [x] 10.5 Add `test/core/store/layout-migration-doctor.test.ts` and extend `test/commands/store-migration-cli.test.ts` for the new diagnostic surface.

## 10b. Legacy flat Store write refusal, deferred here from `store-planning-scope-routing`

This slice owns the refusal because it ships the migration that makes the refusal survivable. `store-planning-scope-routing` implemented it, found it stranded every existing Store (no Store has `layoutVersion: 2` until this child runs) and darkened the only end-to-end gate proving the externalized-planning product works, and deferred it here rather than leave the product write-dead for the rest of the portfolio. Both halves must land together; the enforcement is already claimed by this child's proposal BREAKING bullet.

- [x] 10b.1 Refuse `new change` and `archive` against a legacy flat Store with `legacy_flat_store_requires_migration`, naming `rasen store migrate-layout` as the repair. Restore the `create-change` guard in `src/core/store-planning/internal/resolver.ts` and the legacy branch of `storeFinalizationDiagnostic()` in `src/core/archive.ts`, both removed there and marked with a comment pointing at this task.
- [x] 10b.2 Re-scope the routing child's contract text back once this refusal is live: the `design.md` goal line and D5 legacy row, D6's `ChangeCreationScope` sentence, the `store-planning-scope-routing` delta scenario "Legacy flat Store keeps writing its own flat layout", and the `store-config-inheritance` scenario "Legacy pointer checkout keeps its established behavior". **Also the four generated-skill gate paragraphs** — `src/core/templates/workflows/{archive-change,bulk-archive-change,ship,sync-specs}.ts` — which must regain their `legacy-store` refusal clause. They were missed when the refusal was removed (round-3 finding R3-1) precisely because no test reads them; add a template guard asserting the clause so the restore cannot be missed again.
- [x] 10b.3 Rewrite the five end-to-end journeys into "migrate, then run the lifecycle" rather than into refusal assertions, so the externalized-planning product keeps a live end-to-end gate: `test/cli-e2e/store-lifecycle.test.ts` (4 cases), `test/cli-e2e/capstone-journeys.test.ts` journey 3.
- [x] 10b.4 Update the six unit-level cases that create or archive in a legacy flat Store to migrate first or to assert the deliberate refusal with a citation: `test/commands/declared-store-fallback.test.ts` (2), `test/commands/store-references.test.ts` (2), `test/commands/store-add-project.test.ts` (1), `test/commands/legacy-groups-removed.test.ts` (1). Five more cases outside that list were found by measurement and handled the same way: `test/commands/store-root-selection.test.ts` (2), `test/commands/store-identity-cli.test.ts` (1), `test/commands/store.test.ts` (1), `test/commands/store-add-project.test.ts` (1 more).
- [x] 10b.5 Add a first-class BREAKING bullet to this child's `proposal.md` covering the user-visible loss of legacy flat Store `new`/`archive`, and prove what a migrated Store regains. **Amended during implementation:** measurement showed a migrated Store regains `new change` but NOT `archive` — `design.md` Non-Goals keeps `store_v2_finalization_unavailable` closed, so archiving stops reporting `legacy_flat_store_requires_migration` and starts reporting the finalization deferral instead. The BREAKING bullet and the `store-planning-scope-routing` delta scenario were corrected to say that, and both rewritten journeys assert the deferral code by name so the claim fails loudly when `store-finalization-outcomes-v2` lands.

## 11. Integration, cross-platform, and gates

- [x] 11.1 Add `test/commands/store-v2-migration-journey.test.ts`: a fixture Store with two member projects, shared and single-owner specs, active Changes, legacy Archive entries, and a second flat ref, driven end to end through inventory, mapping, plan, apply, retirement, and post-migration adopt/eject.
- [x] 11.2 Add `test/core/store/layout-migration-windows-paths.test.ts` covering `path.win32` and `path.posix` destination construction, mixed-case drive letters, case-folded destination collisions, Windows reserved device names, UTF-8 Chinese names, and long paths.
- [x] 11.3 Add no-dual-write regression tests proving a v2 Store never gains a flat planning path and a flat Store never gains a partition, across adopt, eject, relocate, membership writes, and migration.
- [x] 11.4 Run the affected store, membership, migration, archive, routing, and management suites and attribute any baseline failure without weakening a fail-closed gate.
- [x] 11.5 Re-run the caller inventory and source guard, resolving every remaining flat Store join or documenting it as legacy adapter, migration source reader, or later-slice owner with an explicit test.
- [x] 11.6 Run focused tests, TypeScript typecheck, lint, build, `rasen validate store-layout-v2-migration --strict`, and `git diff --check`; strictly decode every changed text file as UTF-8 and audit BOM, replacement characters, mojibake, and unrelated worktree changes.
