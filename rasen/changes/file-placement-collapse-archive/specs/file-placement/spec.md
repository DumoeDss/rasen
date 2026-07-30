# file-placement Specification Delta

## ADDED Requirements

### Requirement: Archive dispositions classify every change-produced file

At archive time, every file a change has produced SHALL be classified into exactly one of four dispositions, determined by the file's class (per the seven-class model) and never by free-form judgment:

- **归档 (archive)**: 固定规划文件 (proposal.md, design.md, tasks.md, specs/, planning-context.md), evidence, and unabsorbed handoff — these travel with the change directory into the archive. No action is needed beyond the directory move that already carries them.
- **清理 (clean)**: ephemera (run-state, raw logs, caches, regenerable intermediates) — deleted by whitelist with accounting. The ephemera cleaner requirement below defines the exact discipline.
- **静置 (leave)**: probes — not moved, not copied, not deleted. The archive SHALL only record the probe's execution-root-relative path and the code commit.
- **out-of-scope**: design-docs (root-level, outlives any single change) and coordination (CLI lifecycle) — the disposition logic SHALL NOT scan these. A future GC SHALL NOT be invited to classify them by appearing in the disposition table.

The classification order (use-and-lifecycle first) governs which disposition a borderline file receives.

#### Scenario: Evidence and planning files travel with the archive

- **WHEN** a change with `proposal.md`, `design.md`, `tasks.md`, `specs/`, and `evidence/review-report.md` is archived
- **THEN** all of these SHALL move with the change directory into the archive
- **AND** no disposition action beyond the directory move SHALL be required

#### Scenario: Probes are left in place and recorded

- **WHEN** a change with probe code at an execution-root path is archived
- **THEN** the probe directory SHALL NOT be moved, copied, or deleted
- **AND** the archive SHALL record the probe's execution-root-relative path and code commit in `archive.json`

#### Scenario: design-docs are not scanned

- **WHEN** the disposition logic runs at archive time
- **THEN** it SHALL NOT scan or classify `<planningRoot>/rasen/design-docs/`
- **AND** it SHALL NOT scan or classify machine-root coordination state

### Requirement: Ephemera cleaner uses a whitelist by filename, never discretionary deletion

The ephemera cleaner SHALL delete only files whose names match a known whitelist of regenerable ephemera. It SHALL preserve every unknown entry byte-for-byte and report its exact path. It SHALL never recursively delete the ephemera directory or any part of the machine root.

The whitelist SHALL cover:
- **Run-state and control state**: `auto-run.json`, `portfolio-run.json`, `goal-run.json`, change-level `.signal`, `.lock`, `.heartbeat`, and `expert-selection-explicit.json`.
- **Regenerable raw material**: `*.log`, `raw-*.json`, `benchmark-*.json` at the ephemera directory's top level.

The cleaner SHALL preserve and report:
- Unknown filenames not in the whitelist.
- Future-version state files (recognized patterns with unrecognized version markers).
- Malformed entries (files that look like state but fail to parse).
- Nested directory entries (any directory inside the ephemera area).

The cleaner SHALL abort cleaning for a change when it discovers a source manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `build.rs`, `rust-toolchain.toml`) or a source-tree structure inside the ephemera directory — that is the signal probes were misclassified, and the matter SHALL be handed to the user with the discovered paths reported.

Every file deleted by the cleaner SHALL be listed in `archive.json`'s `ephemeraDiscarded` array. Every file preserved and reported SHALL appear in the archive output (human mode) or the JSON result's `ephemeraPreserved` array (JSON mode) so a human can judge them.

#### Scenario: Known run-state is deleted and accounted

- **WHEN** the ephemera directory for a change contains `auto-run.json` and `portfolio-run.json`
- **THEN** both files SHALL be deleted
- **AND** both filenames SHALL appear in `archive.json`'s `ephemeraDiscarded` array

#### Scenario: Unknown file is preserved and reported

- **WHEN** the ephemera directory contains a file named `custom-experiment.json` (not in the whitelist)
- **THEN** the file SHALL be left in place byte-for-byte
- **AND** its exact path SHALL be reported in the archive output

#### Scenario: Source manifest discovery aborts cleaning

- **WHEN** the ephemera directory contains `package.json` or `Cargo.toml`
- **THEN** the cleaner SHALL abort cleaning for that change
- **AND** SHALL report the discovered manifest path
- **AND** no ephemera file SHALL be deleted for that change

#### Scenario: Nested directory is preserved

- **WHEN** the ephemera directory contains a subdirectory `research/data/`
- **THEN** the subdirectory and all its contents SHALL be left in place
- **AND** its path SHALL be reported in the archive output

### Requirement: Handoff absorption is the sole discretionary point at archive

At archive time, the handoff directory's contents SHALL receive an absorption judgment: a handoff document whose dead-ends and eliminated hypotheses are already absorbed by `design.md` or evidence SHALL be deleted; one whose content is not absorbed SHALL be moved to `<changeRoot>/evidence/handoff/` so it travels with the archive.

The default SHALL be to preserve (never default-delete). "Eliminated hypotheses" are a change's most expensive information; their value begins after archive — they prevent later readers from re-walking the same dead-end. The judgment SHALL be recorded in `archive.json`'s `handoffAbsorbed` array, listing each handoff file and whether it was absorbed (deleted) or preserved (moved to evidence/handoff/).

This is the model's single discretionary point at archive. It requires semantic judgment (reading the handoff document and comparing its content against design.md and evidence) and is therefore guided by the archive skill, not executed by deterministic CLI logic. When the absorption judgment is not performed (e.g., the CLI archives without the skill), the handoff directory SHALL travel with the change directory into the archive unchanged — the safe default is preservation.

#### Scenario: Absorbed handoff is deleted and recorded

- **WHEN** a handoff document's dead-ends and eliminated hypotheses are already covered by `design.md` or evidence
- **THEN** the handoff document SHALL be deleted before the change directory moves to archive
- **AND** its filename SHALL appear in `handoffAbsorbed` with an `absorbed` outcome

#### Scenario: Unabsorbed handoff moves to evidence

- **WHEN** a handoff document contains knowledge not yet absorbed by `design.md` or evidence
- **THEN** it SHALL be moved to `<changeRoot>/evidence/handoff/`
- **AND** it SHALL travel with the archive when the change directory moves
- **AND** its filename SHALL appear in `handoffAbsorbed` with a `preserved` outcome

#### Scenario: No absorption judgment preserves everything

- **WHEN** the CLI archives a change without the skill having performed the absorption judgment
- **THEN** the `handoff/` directory SHALL travel with the change directory unchanged
- **AND** `handoffAbsorbed` SHALL be empty or absent

### Requirement: archive.json records disposition accounting without the planning-root commit hash

The archive SHALL write an `archive.json` file inside the archived change directory recording the disposition outcome. The file SHALL contain:

- `change`: the semantic change name.
- `archivedAt`: ISO-8601 timestamp.
- `codeCommit`: the execution root's HEAD commit SHA at archive time (cross-repo, closable). For a store-selected run this is the code project's commit, distinct from the planning (store) commit.
- `planningBranch`: the planning root's current git branch name.
- `planningTreeState`: `clean` or `dirty` — whether the planning root's working tree had uncommitted changes at archive time.
- `evidence`: array of `{ path, sha256 }` for each evidence file under `evidence/`.
- `probes`: array of `{ path, codeCommit }` for each probe directory left in place (静置), with execution-root-relative path and the code commit it was tested against.
- `handoffAbsorbed`: array of `{ file, outcome }` recording the absorption judgment for each handoff file.
- `ephemeraDiscarded`: array of filenames deleted by the cleaner.
- `missing`: array naming items that were expected but absent (e.g., no ship log, no verification report).

The file SHALL NOT record the planning-root commit hash. `archive.json` is itself inside that commit, so the hash is an unclosable self-reference: amending the commit orphans the recorded hash. The binding identifiers are `codeCommit` (cross-repo, closable) and evidence content hashes (content-addressed, closable). The planning side records branch and clean/dirty state only — these survive an amend without orphaning.

This file coexists with `.openspec.yaml` (quality capture — a separate concern).

#### Scenario: archive.json carries codeCommit and branch, not planning commit

- **WHEN** `archive.json` is written during archive
- **THEN** it SHALL carry `codeCommit` (the execution root commit), `planningBranch`, and `planningTreeState`
- **AND** it SHALL NOT carry any field whose value is the planning-root commit SHA

#### Scenario: Evidence content hashes are recorded

- **WHEN** the archive writes `archive.json` and the change has evidence files
- **THEN** each evidence file SHALL appear in the `evidence` array with its SHA-256 content hash

#### Scenario: Missing items are listed honestly

- **WHEN** a change is archived without a ship log or verification report
- **THEN** `archive.json`'s `missing` array SHALL list those absent items
