## 1. Baseline and re-census

- [ ] 1.1 Re-run child 3's caller census verbatim and record the result in `evidence/read-caller-inventory.md`: `grep -rn "specsDir(\|changesDir(\|inRepoArchiveDir(" src/ --include=*.ts`, `grep -rn "adoptions\.yaml\|readAdoptionsManifest\|upsertAdoptionEntry" src/ --include=*.ts`, `grep -rn "readStoreProjectRecord\|writeStoreProjectRecord\|getStoreProjectRecordPath" src/ --include=*.ts`. Line numbers in `proposal.md` and `design.md` are as of proposal time and `src/` was being edited concurrently — trust the re-run, not the citation.
- [ ] 1.2 Classify every hit as dispatcher, frozen legacy adapter, migration-source reader, or defect, and reconcile against `store-layout-v2-migration/evidence/caller-inventory.md`. Any hit that document does not list is new since child 3 and needs its own classification with a recorded reason.
- [ ] 1.3 Capture the current (defective) behavior in a baseline suite before changing anything, in `test/core/store/store-v2-read-caller-baseline.test.ts`: against a Store declaring layout v2, `bootstrap` reports the project's healthy catalog as an unreadable record and drops a knowledge bundle declared in it; `rasen doctor` reports no layout findings for a Store with flat refs and mixed residue; a Store v2 project space with no target line returns an empty archive listing indistinguishable from a project with none.
- [ ] 1.4 Record which of child 5's Archive v2 record fields the consistency gate will read, by reading `src/core/archive-accounting-v2.ts` and `src/core/store/finalization/record.ts` as they stand, and note in the evidence file that the requirement names facts rather than field names so a shift in child 5 is a fixture change and not a spec change.
- [ ] 1.5 Assert this change adds no Git write verb and no planning mutator: no `worktree`, `merge`, `rebase`, `checkout`, `switch`, `branch`, `commit`, `add`, `fetch`, `push`, or `clone` appears in anything this change adds under `src/`, and no new function writes, moves, or deletes a planning file.

## 2. Migrate the remaining v1-parser read sites

- [ ] 2.1 Route `projectFirstBundleDeclarations` in `src/core/store/bootstrap.ts` through `readStoreMembership` from `src/core/store/membership-layout.ts`, so a v2 project catalog is parsed as a project catalog and its declared knowledge bundle is read rather than dropped.
- [ ] 2.2 Route `readUnreadableRecord` in `src/core/store/bootstrap.ts` through the same dispatcher, so a healthy v2 catalog is no longer reported as an unreadable record while a genuinely broken file of either schema still is.
- [ ] 2.3 Preserve the distinction `readUnreadableRecord`'s docblock exists for — "a file that exists but cannot be read" versus "no record at all" — across both layouts, and prove each of the four states (v1 healthy, v1 broken, v2 healthy, v2 broken) reports as itself.
- [ ] 2.4 Preserve the knowledge-bundle declaration's `source.declarationPath` as the path actually read, so a repair hint names the file the user must fix under either layout.
- [ ] 2.5 Verify the migrated sites still write nothing: snapshot the Store tree, the project tree, and the machine registries before and after a bootstrap read under each layout.
- [ ] 2.6 Invert the baseline: `test/core/store/store-v2-read-caller-baseline.test.ts`'s three defect assertions become the correct assertions, and each is confirmed to fail if the corresponding fix is reverted.
- [ ] 2.7 Grep the token across all of `test/`, not the file expected to own it: `readStoreProjectRecord`, `readUnreadableRecord`, and `knowledgeBundle` — the portfolio has three recorded instances of a sibling fixture pinning the same behavior at a different granularity and nobody looking.

## 3. The record-parser census

- [ ] 3.1 Add a fourth census to `test/core/store-planning/planning-path-source-guard.test.ts` bounding, per file and per count, every direct call of a single-layout Store record parser with a Store-root-shaped argument, using the same `JoinClassification` vocabulary the file already carries.
- [ ] 3.2 Enumerate each surviving site individually with its classification and a recorded reason: `membership-layout.ts` as the dispatcher, `membership.ts` and `migration-ops.ts` as frozen legacy adapters, `project-records.ts` as the schema's own reader.
- [ ] 3.3 Assert the census by equality, not by subset, so a removed or renamed site fails it rather than shrinking silently.
- [ ] 3.4 Prove the census discriminates: add a fixture call site with an unclassified single-layout read and confirm the census fails naming that file, then remove it. A gate that has not been shown to fail is not known to be a gate.
- [ ] 3.5 State in the test file, beside the new census, that it is extended by enumerating entries and never by a directory exemption, a path prefix, or an aggregate total, and why.
- [ ] 3.6 Run the census against the tree after task 2 and confirm it is green on its first run, so its first real failure is a regression rather than a known defect.

## 4. One layout diagnosis behind both doctors

- [ ] 4.1 Factor the layout-diagnosis composition currently inline in `doctorStores` (`src/core/store/operations.ts`) into one exported entry point that takes a resolved Store and returns its findings, and call it from both `doctorStores` and `src/commands/doctor.ts`.
- [ ] 4.2 Replace the `.catch(() => [])` at both call sites with an explicit `undiagnosed` finding carrying the reason, so a Store whose layout cannot be diagnosed is never reported as healthy.
- [ ] 4.3 Emit the layout section from `rasen doctor` only when a Store was actually resolved, so a standalone project's report is unchanged.
- [ ] 4.4 Report identical codes, messages, and repairs from both commands in both human and `--json` form, built from one structure so the two cannot diverge.
- [ ] 4.5 Correct the now-false comment at `src/commands/doctor.ts:613-615` ("Surfaced here so top-level doctor aggregates the same checks `store doctor` reports") to describe what is actually aggregated after this change.
- [ ] 4.6 Keep `diagnoseMigrationDrift` reporting alongside, not instead of, the layout findings — it detects a different condition (pointer/manifest drift) and removing it would narrow doctor.
- [ ] 4.7 Prove the shared diagnosis writes nothing on any path, including against a partially migrated Store with a recorded recovery manifest.
- [ ] 4.8 Add the Store v2 cases `test/commands/doctor.test.ts` has none of: flat refs, mixed residue, an unfinished migration, an orphaned partition, a legacy membership record inside a v2 Store, a relocated legacy Archive record, and an undiagnosable Store — each asserted in both human and `--json` output.
- [ ] 4.9 Add a parity test asserting that for the same Store, `rasen doctor --json` and `rasen store doctor --json` carry the same layout finding set, and that adding a finding to one surfaces it on both.

## 5. Target-line and partition consistency checks

- [ ] 5.1 Implement the walk beside `src/core/store/layout-migration/diagnostics.ts`'s existing read-only findings: for each active Change and Archive entry under a project partition, read its committed identity and compare the recorded project and target line against the partition and target-line directory holding it.
- [ ] 5.2 Report a recorded-vs-holding target-line disagreement naming both values and choosing neither.
- [ ] 5.3 Report a recorded-vs-holding project disagreement naming both values and choosing neither.
- [ ] 5.4 Report an entry naming a target line for which the Store has no catalog, and a target-line catalog whose declared `storeRef` does not resolve.
- [ ] 5.5 Report an Archive record whose schema cannot be determined from the Store's declared layout and the entry's recorded scope as an ambiguity, never by sniffing the file's contents — the discipline child 3 established for `projects/<id>.yaml` and child 5 for `archive.json`.
- [ ] 5.6 Prove the never-repair rule with a byte assertion: after a full diagnosis over a Store containing a mis-partitioned entry, a non-landed Archive merged in by hand, and an entry naming an undeclared line, every canonical spec under every project partition is byte-identical and no entry has moved.
- [ ] 5.7 Prove no fact is synthesized: no outcome, target line, project owner, or workspace pair is written or inferred for an entry whose evidence does not already carry it.
- [ ] 5.8 Bound the walk's cost: read once per Store ref, not once per entry, and assert the diagnosis completes on a Store with three projects and two lines without re-reading a ref.
- [ ] 5.9 Add `test/core/store/store-v2-consistency-gates.test.ts` covering each finding, the both-values-named assertion, the byte-identical assertion, the ambiguity report, and — for each finding — a negative fixture confirming the check fails when the inconsistency is present and passes when it is not.
- [ ] 5.10 Build the Archive fixtures through the finalization CLI rather than by hand-writing records, so a shift in child 5's record shape moves the fixtures with it.

## 6. Narrowed reads report their narrowing

- [ ] 6.1 Change `handleArchive` in `src/core/management-api/archive.ts` so a Store v2 project scope with no resolved target line reports that the target-line dimension was not addressed, instead of degrading `archiveDir` to `null` and returning an empty list.
- [ ] 6.2 Apply the same treatment in `src/core/management-api/task-detail.ts`, which reads the same archive union through the same helper.
- [ ] 6.3 Carry the narrowing through the wire type and mirror it by hand into `packages/ui/src/api/types.ts` in the same task — the mirror has no build-time import path and drifts silently.
- [ ] 6.4 Render the narrowing in the UI as a stated condition rather than an empty state, and assert the rendered text rather than only the field.
- [ ] 6.5 Do not enumerate target lines here: assert that this change adds no cross-line rollup and that the grouped answer stays `store-scoped-issues-management`'s `StoreQueryModule.listChanges`.
- [ ] 6.6 Prove a standalone and a legacy flat Store archive listing are byte-identical to their pre-change output.
- [ ] 6.7 Extend `test/core/management-api/` coverage for the narrowed and un-narrowed cases and for the standalone/legacy non-regression.

## 7. The action-context planning grant

- [ ] 7.1 Change `buildActionContext` in `src/core/change-status-policy.ts` so the planning write grant derives from the session's resolved planning scope rather than from `planningDirectoriesOf(session.planning.root)`, which for a `type: 'store'` ref joins the two paths layout v2 forbids and omits the project partition.
- [ ] 7.2 Leave `buildResolvedPlanningActionContext` alone: it already receives `[root.specsDir, root.changesDir]` from the scope projection at `src/commands/workflow/shared.ts:93` and is already correct. Assert the two paths now agree for the same scope.
- [ ] 7.3 Keep the standalone and legacy flat grants byte-identical, and assert it — `planningDirectoriesOf` is correct for both and must stay their implementation.
- [ ] 7.4 Assert the grant may only ever narrow: the `withoutHomeDirectory` and `minimizeRoots` filters keep their existing semantics, and no path is added to a grant that the scope does not own.
- [ ] 7.5 Update the `EXPECTED_DIRECT_JOINS` entry for `src/core/change-status-policy.ts` in `planning-path-source-guard.test.ts` if the join count changes, by editing the count with a recorded reason — never by removing the file from the census.
- [ ] 7.6 Add a test asserting a Store v2 session's action context grants the project partition and grants neither root-level Store planning path, and confirm it fails if task 7.1 is reverted.

## 8. Documentation reconciliation

- [ ] 8.1 Correct `docs/stores-beta/user-guide.md`: the example output at line 78 and the architecture diagram at lines 161-166 show the flat Store tree the CLI no longer writes.
- [ ] 8.2 Correct `docs/zh/stores-beta/user-guide.md` at lines 64 and 130-135 in the same edit, so the two languages cannot state different layouts.
- [ ] 8.3 Condition the Store-mode `planningWriteRoots` example in `docs/cli.md:2207` on the layout it describes, and give the archive-destination steps at `docs/cli.md:1713-1714` and `docs/commands.md:520` their standalone condition plus a pointer to the Store v2 address.
- [ ] 8.4 Apply the same conditioning to `docs/zh/cli.md:612-613` and the corresponding `docs/zh/commands.md` lines.
- [ ] 8.5 Mark the superseded sections of `docs/zh/file-placement-and-planning-roots.md` — the "Store 路径" tree at lines 449-472, the Store-mode summary at 145-149, the shared-design-docs claim at 168, and the `--store`/`--project` exclusivity at 476 — as superseded, naming `docs/zh/store-project-partitions-and-planning-worktrees.md` as the replacing document. Do not delete the document: its ephemera, probe, and machine-root sections remain in force.
- [ ] 8.6 Leave `docs/concepts.md`, `docs/glossary.md`, `docs/team-workflow.md`, and their zh twins untouched. They describe the in-project layout the accepted design explicitly preserves; editing them would document Store mode as the default, which it is not. Record this decision in the change's evidence so a reviewer does not read the omission as an oversight.
- [ ] 8.7 Verify no locale string needs reconciliation by re-running `grep -n "rasen/changes\|rasen/specs\|rasen/design-docs" src/locales/*.json` and recording the empty result.
- [ ] 8.8 Re-grep `docs/` for any Store-mode planning path, archive address, or selector rule the reconciliation missed, and record the sweep in the evidence file rather than asserting completeness from memory.

## 9. The acceptance matrix

- [ ] 9.1 Add `test/commands/store-v2-acceptance-matrix.test.ts` driving the real CLI, composing the fixture builders the four existing Store v2 journeys already use rather than re-deriving them.
- [ ] 9.2 Cover the project-partition axis the journeys do not: two projects in one Store each holding a Change with the **same** name, asserting distinct directories, distinct instance identities, and no collision — the accepted design's §15 first row.
- [ ] 9.3 Cover the target-line axis: one project holding a Change with the same name on two target lines, asserting Git-timeline isolation and distinct instance identities — §15's second row.
- [ ] 9.4 Cover the path-flavor axis at journey scope: address construction and containment across `path.win32` and `path.posix`, mixed-case drive letters, separator forms, UTF-8 Chinese content with ASCII identifiers, and long paths. No existing journey carries this axis; it currently lives only in unit fixtures.
- [ ] 9.5 Cover the layout-flavor axis end to end: standalone, legacy flat, and migrated v2 each running the same operation sequence, asserting each behaves as its own layout requires.
- [ ] 9.6 Consume, do not restate, child 5's finalization journey and child 6's cross-project journey: assert the outcome and cross-project axes exist and pass, and fail loudly if either journey is absent, rather than duplicating them.
- [ ] 9.7 Assert the §15 refusal rows: a `projectId` containing a path separator, `.`, `..`, a case collision, or a Windows reserved name is refused; a Store integration checkout refuses a project write; a bound project with a residual local planning tree is refused.
- [ ] 9.8 Keep the matrix bounded: one CLI invocation per cell, shared fixtures across cells, and a recorded wall-clock figure — a slow matrix is a skipped matrix.

## 10. Standalone and legacy non-regression

- [ ] 10.1 Add the standalone comparison: a full create / edit / validate / archive lifecycle in an unbound project, asserting every planning location written is the pre-v2 in-project location.
- [ ] 10.2 Assert no standalone step requires or accepts a project selector, a target line, or a finalization outcome, and that supplying one is refused rather than silently ignored.
- [ ] 10.3 Assert a standalone run creates no project partition, project catalog, target-line catalog, or layout-version declaration anywhere.
- [ ] 10.4 Assert a legacy flat Store's list, show, and export results are the pre-v2 results, and that its planning-write refusal names the migration as the repair rather than a project or target-line selector.
- [ ] 10.5 Compare against recorded pre-v2 output rather than against the current implementation's own behavior, so the comparison cannot pass by agreeing with a regression.
- [ ] 10.6 Confirm each non-regression assertion discriminates by breaking the standalone path locally and verifying the comparison fails.

## 11. Integration and gates

- [ ] 11.1 Run the full affected suite set: `test/commands/doctor.test.ts`, `test/commands/store*.test.ts`, `test/core/store/**`, `test/core/store-planning/**`, `test/core/management-api/**`, `test/cli-e2e/**`, and the new matrix.
- [ ] 11.2 Attribute every failure. The five `config.test.ts` / `config-editor.test.ts` failures are environmental (`%LOCALAPPDATA%\rasen` above `os.tmpdir()`), proven by controlled experiment, and are never "fixed" here. Any other failure is this change's until shown otherwise.
- [ ] 11.3 Re-run every census after the implementation and confirm each is green and each still discriminates.
- [ ] 11.4 Run `pnpm run build`, `pnpm exec tsc --noEmit`, `pnpm run lint`, and `git diff --check`. `tsc --noEmit` excludes `test/`, so sweep new test code by hand for unused locals and inverted assertions.
- [ ] 11.5 Strictly decode every changed text file as UTF-8 and audit for BOM, replacement characters, and mojibake — the zh docs edited in task 8 are the exposed surface.
- [ ] 11.6 Run `rasen validate store-v2-compat-hardening --strict`.
- [ ] 11.7 Before the archive step, run the pairwise requirement-title and scenario-set comparison against `rasen/specs/` **plus children 3, 4, 5, and 6's unshipped deltas**. Confirm the two `store-planning-scope-routing` MODIFIED titles and the one `store-project-membership` MODIFIED title still byte-match their post-sibling canonical titles and repeat every current scenario. A title flagged as missing may be a later sibling's addition rather than drift — grep the unshipped siblings before treating it as a defect.
- [ ] 11.8 Author a real `## Purpose` for `store-v2-consistency-gates` before archiving, and confirm `grep -rl "TBD - created by archiving" rasen/specs/` returns nothing afterwards.
- [ ] 11.9 Confirm this change added no Store v2 mutator: re-run task 1.5's assertion and confirm every surface added here reports and none repairs.
