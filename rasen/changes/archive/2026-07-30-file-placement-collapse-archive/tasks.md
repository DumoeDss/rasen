# tasks — file-placement-collapse-archive

## 1. Ephemera cleaner (destructive — dry-run and tests first)

- [ ] 1.1 Implement the ephemera whitelist constant and the cleaner function in a new `src/core/ephemera-cleaner.ts` module. The function takes an ephemera directory path and returns `{ discarded: string[], preserved: string[], aborted: boolean, abortReason?: string }` WITHOUT deleting anything (pure classification pass).
- [ ] 1.2 Add the delete pass: a separate function that takes the classification result and the ephemera directory and performs the whitelisted deletions. This is the ONLY destructive operation. It SHALL NOT delete preserved files or recurse into directories.
- [ ] 1.3 Add the source-manifest detection: if `package.json`, `Cargo.toml`, `pyproject.toml`, `build.rs`, or `rust-toolchain.toml` is found at the ephemera directory top level, the classification returns `aborted: true` with the manifest path — no deletion happens for that change.
- [ ] 1.4 Write unit tests for the cleaner covering: all whitelist filenames deleted; unknown filenames preserved with exact paths; nested directories preserved; source-manifest discovery aborts; empty/nonexistent ephemera directory is a no-op. Assert the actual file-list state on disk after the delete pass, not just return values.
- [ ] 1.5 Add the dry-run output path: when called in dry-run mode, the classification result is printed without the delete pass running. Verify the dry-run leaves the ephemera directory byte-identical (use a content hash before and after).

## 2. archive.json generation

- [ ] 2.1 Implement `src/core/archive-accounting.ts`: a pure function that resolves all `archive.json` fields from the execution root (codeCommit via `git rev-parse HEAD`), planning root (planningBranch via `git rev-parse --abbrev-ref HEAD`, planningTreeState via `git status --porcelain`), evidence directory (sha256 per file), and the cleaner/handoff results. For non-git roots, record `planningBranch: null` and `planningTreeState: "clean"`.
- [ ] 2.2 Add the `archive.json` writer to `src/core/archive.ts`: after the change directory moves to the archive, write `archive.json` inside the archived directory. The writer SHALL NOT record the planning-root commit hash.
- [ ] 2.3 Write tests verifying: `archive.json` contains `codeCommit` and NOT a planning-root commit field; evidence files have correct sha256 hashes; `missing` lists absent ship-log and verification-report when they are absent; store-selected runs record the code project's HEAD, not the store's.

## 3. CLI archive integration (--keep-ephemera, --dry-run, cleaner wiring)

- [ ] 3.1 Wire the ephemera cleaner into `rasen archive`: call the classification pass before the directory move; if not `--keep-ephemera`, run the delete pass; pass `ephemeraDiscarded` to the accounting writer.
- [ ] 3.2 Add `--keep-ephemera` flag to the `rasen archive` command surface and the `ArchiveOptions` interface. When set, skip the delete pass entirely.
- [ ] 3.3 Add `--dry-run` flag: report spec sync plan, pending-delete list, handoff status, planned archive name, and blocking conditions — execute nothing. Verify no file is moved, deleted, or written.
- [ ] 3.4 Integration test: `rasen archive <change> --dry-run` on a fixture change with ephemera and delta specs — assert nothing changed on disk; assert the output lists the correct pending deletes and spec syncs.
- [ ] 3.5 Integration test: `rasen archive <change> --keep-ephemera` — assert ephemera files survive and `archive.json` has empty `ephemeraDiscarded`.
- [ ] 3.6 Integration test: full archive (no flags) — assert ephemera cleaned, `archive.json` written with all fields, change directory moved.

## 4. Archive skill template updates

- [ ] 4.1 Update `src/core/templates/workflows/archive-change.ts` to add the handoff absorption judgment step before bookkeeping: guide the agent to read each handoff document, determine absorption, delete absorbed files, move unabsorbed to `<changeRoot>/evidence/handoff/`.
- [ ] 4.2 Update the skill's bookkeeping section to note the CLI ephemera cleaner runs before the move (unless `--keep-ephemera`), and to ensure `archive.json` is written by the CLI after the move.
- [ ] 4.3 Update the skill's completion summary to report cleaner outcome, `handoffAbsorbed` results, probes recorded (静置), and `archive.json` key fields.
- [ ] 4.4 Verify the generated skill template carries no direct machine-root writes (per the `file-placement` invariant child A established).

## 5. Inverted migrator (LAST — depends on child A's terminal state being stable)

- [ ] 5.1 Rewrite `src/core/work-migration.ts` scan logic to scan machine-home work directories (via `resolveChangeWorkDir`) instead of in-repo change directories. Classify each file by type: report → evidence, handoff → handoff dir, run-state → ephemera (or discard for archived changes).
- [ ] 5.2 Add machine-root historical probe directory reclassification: scan `machineHome/probe/` (and similar known locations) one-by-one per the classification order. Report each directory's classification.
- [ ] 5.3 Add `machineHome/design-docs/` → `<planningRoot>/rasen/design-docs/` migration.
- [ ] 5.4 Implement the never-overwrite conflict rule: when a destination exists, keep both copies and report the conflict. Do not skip silently.
- [ ] 5.5 Update `src/commands/work.ts` to reflect the new routing and destinations. Keep `--dry-run`, `--json`, `--yes`, `--include-tracked` contract.
- [ ] 5.6 Update the `change-work-dir` sticky-legacy lifecycle to reflect the inverted direction (terminal location is authoritative after migration).
- [ ] 5.7 Write migrator tests: old workDir reports move to evidence; handoff moves to handoff dir; run-state moves to ephemera; archived run-state is discarded + listed; probe dirs are reclassified one-by-one; design-docs move to planning root; conflicts keep both copies; dry-run moves nothing; re-run is a no-op.
- [ ] 5.8 Run the full test suite to verify no regression from the migrator rewrite.

## 6. Validation and archive dry-run rehearsal

- [ ] 6.1 Run `rasen validate file-placement-collapse-archive --json` and fix any delta-spec issues.
- [ ] 6.2 Run `rasen archive file-placement-collapse-archive --dry-run --json` to rehearse the spec merge (validate blind-spot mitigation). Verify the 5 spec deltas merge cleanly into main specs.
- [ ] 6.3 Verify no TBD placeholder is introduced: `grep -rl "TBD - created by archiving" rasen/specs/` (should stay empty — all deltas MODIFY existing capabilities, no NEW capability is minted).
