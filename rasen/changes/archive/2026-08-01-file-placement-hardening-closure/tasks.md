## 1. Establish closure ledgers

- [x] 1.1 Record the saved baseline, current head, and complete changed-path inventory, classifying every path by child change or closure responsibility.
- [x] 1.2 Build a contract-reconciliation ledger from all four implementation-child delta-spec sets, naming the destination main spec and authoritative-design section for every final contract.
- [x] 1.3 Mark overlapping `file-placement` and `work-migration` requirements in the ledger with their dependency-ordered semantic merge, so each guarantee is integrated exactly once.
- [x] 1.4 Build a traceability row for every saved PR audit Blocker, Major, and Minor, linking its owning child, clean review, focused proof, and remaining closure gate without rewriting historical records.

## 2. Reconcile normative main specifications

- [x] 2.1 Reconcile `rasen/specs/file-placement/spec.md` with the migration, archive, and root-routing child deltas, preserving their union and removing stale direct-move, pre-move-cleaning, external-sync, and post-hash self-reference contracts.
- [x] 2.2 Reconcile `rasen/specs/work-migration/spec.md` with fail-closed foundation planning, no-clobber behavior, explicit Store context, one-plan execution, and compatibility guarantees from both owning children.
- [x] 2.3 Reconcile `rasen/specs/session-supervision/spec.md` with the final Store-root and session execution-routing contract.
- [x] 2.4 Reconcile the main `cli-archive`, `opsx-archive-skill`, `opsx-ship-command`, `archive-quality-capture`, and `sha-cross-stamping` specifications with the final archive-engine deltas, and `opsx-pipeline-registry` with the discovered Windows-lock delta.
- [x] 2.5 Validate the reconciled main specification graph and attach ledger evidence that no child requirement was dropped, duplicated, or left contradictory.

## 3. Reconcile the authoritative Chinese design

- [x] 3.1 Update `docs/zh/file-placement-and-planning-roots.md` for the final migration safety, Store-root selection, one-plan session execution, compatibility, and manual-integrity-recovery contracts.
- [x] 3.2 Update the design's archive transaction, publication, accounting, consumer, fault-recovery, and SHA cross-stamping model to match the reviewed archive engine.
- [x] 3.3 Cross-check every normative design statement against the reconciled main specs and ledger, removing stale models without copying implementation detail or contradicting a child delta.

## 4. Sweep contract-bearing derived surfaces

- [x] 4.1 Create positive and negative contract-token catalogs, then inventory generated workflow text, skill templates, consumer adapters, CLI/help/completion/localization, schemas, and parity/golden tests.
- [x] 4.2 Inspect workflow and skill template sources plus their generated output for stale spec-sync, direct-move, cleaning-order, archive-commit, and recovery instructions; correct closure-owned mismatches and update narrow parity tests.
- [x] 4.3 Inspect executable archive consumer adapters and consumer templates for the reviewed engine invocation and handoff contract; correct closure-owned mismatches and update their focused regressions.
- [x] 4.4 Inspect command registration, help, completions, localized text, `schemas/spec-driven/schema.yaml`, and hash/golden expectations for all additive flags, JSON fields, root parameters, and archive instructions; correct closure-owned mismatches.
- [x] 4.5 Classify every remaining stale-token match as corrected, intentionally historical, or a product defect routed to its owning child, and record the associated parity/completion/schema test results.

## 5. Integrate focused acceptance evidence

- [x] 5.1 Run the explicit archive group serially: `archive.test`, engine, consumer integration, fault matrix, path semantics, accounting, ephemera, archive-engine consumer template, and skill-template parity tests.
- [x] 5.2 Run the explicit migration/root/session group serially: ephemera cleaner, work migration, work command, management/session APIs, session space, and command-registry completion tests.
- [x] 5.3 Record each focused command, exact file list, elapsed time, file/test counts, skips, exit status, and relevant native-host limitations in closure evidence.
- [x] 5.4 Update the audit traceability matrix with the focused regression or static proof that closes each behavioral finding and leave any unmet closure dependency visibly open.

## 6. Diagnose and close the repository-wide test gate

- [x] 6.1 Discover and save the exact repository test-file manifest, then run one single-worker monolithic `pnpm test` baseline with a 480-second outer orchestration bound and captured command, elapsed time, summary, and exit status.
- [x] 6.2 If the baseline has no summary, record it as unresolved and do not perform bespoke/manual process termination; any read-only process observation is diagnostic only, and process cleanliness remains `NOT EVALUATED` without spawn-time OS lineage capability.
- [x] 6.3 Assign the discovered manifest deterministically across a fixed set of sequential `VITEST_FILE_PARTITION=i/N` runs and prove exact union coverage with empty pairwise intersections before using them as a gate.
- [x] 6.4 Run every partition directly and sequentially with one worker and a 480-second outer bound, recording its manifest, summary, exit status, counts, and elapsed time; stop on timeout, missing summary, nonzero exit, or any observed/suspected survivor, without automatic cleanup.
- [x] 6.5 Correct only a diagnosed closure-owned Vitest configuration or narrow harness defect and add its regression; route any product-behavior defect to its owning child and keep closure blocked until the clean rerun.
- [x] 6.6 Publish a complete local test-result gate only from a successful bounded monolithic result or a fully reconciled partition aggregate, explicitly rejecting timeouts, missing summaries, nonzero exits, missing/duplicate files, and count mismatches; report process cleanliness as `NOT EVALUATED` locally and keep any observed/suspected survivor blocking for CI/orchestration follow-up.

## 7. Require native archive fault/recovery CI

- [x] 7.1 Add a dedicated Node.js-floor CI matrix over `ubuntu-latest`, `macos-latest`, and `windows-latest` that runs explicit archive engine, fault-matrix, accounting, ephemera, and cleaner tests against real temporary filesystems.
- [x] 7.2 Make the required aggregate test status depend on every general test-matrix leg and every dedicated native recovery leg, while retaining bounded per-OS Vitest workers.
- [x] 7.3 Validate workflow syntax, trigger behavior, matrix expansion, explicit file selection, and required-check dependencies with focused CI contract tests or static assertions.
- [x] 7.4 Record local Windows and `win32`/`posix` helper results only as local or deterministic semantic evidence, never as substituted native macOS/Linux results.
- [x] 7.5 Write the delivery handoff with the three native job names and evidence fields, leaving native acceptance pending until post-push remote URLs and successful results are attached by delivery.

## 8. Finish compatibility and release evidence

- [x] 8.1 Run build, lint, typecheck, strict Rasen validation, focused tests, and the completed repository-wide gate, recording exact commands and outcomes.
- [x] 8.2 Verify existing archive, work-migrate, and root/session CLI forms and help remain usable, with new flags and JSON fields additive rather than breaking.
- [x] 8.3 Confirm package version `0.1.6`, Node.js `>=20.19`, compatibility aliases, and generated/schema parity remain unchanged except for the reviewed additive contract.
- [x] 8.4 Audit the final diff against the saved baseline for intended ownership, whitespace errors, accidental files, and tracked `.rasen` ephemera; resolve or explicitly block every unexplained path.
- [x] 8.5 Publish closure release evidence and a delivery handoff that states the local gate, the pending native remote gate, and the prohibition on commit, push, PR delivery, or archive during closure apply.
