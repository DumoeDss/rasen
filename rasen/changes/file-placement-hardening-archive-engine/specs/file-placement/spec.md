## ADDED Requirements

### Requirement: Archive publication is recoverable and source-last

Archive publication SHALL preserve the active change and its execution-root ephemera until a verified archive payload and a durable recovery record exist. A successful archive SHALL contain final disposition accounting; an interrupted archive SHALL leave either the active state unchanged or a journal that identifies the exact transaction phase, surviving source and destination paths, and safe resume action. Publication SHALL never overwrite an existing archive.

The archive payload SHALL be staged and verified before it becomes the final date-prefixed archive. Cross-device fallback, when required by a supported publication primitive, SHALL run only for the explicit cross-device condition, create destinations without clobbering, verify the complete copy, and remove the source last. Permission and I/O errors SHALL remain failures and SHALL NOT trigger fallback.

#### Scenario: Failure before publication preserves active state

- **WHEN** staging, evidence hashing, Git inspection, or accounting fails before the archive is published
- **THEN** the active change and every ephemera entry SHALL remain available
- **AND** no final archive SHALL be reported as complete

#### Scenario: Failure after publication is journaled

- **WHEN** a failure occurs after a staged archive is published but before final cleanup completes
- **THEN** the active source SHALL remain available
- **AND** the published archive SHALL contain a recovery record identifying the transaction and incomplete phase
- **AND** a retry SHALL resume only when the recorded plan identity matches

#### Scenario: Concurrent target is never overwritten

- **WHEN** an archive target appears after planning or an unrelated target already occupies the date-prefixed path
- **THEN** archive apply SHALL preserve the active change and existing target byte-for-byte
- **AND** SHALL report a target conflict rather than merging with or replacing the target

#### Scenario: Permission failure does not use cross-device fallback

- **WHEN** archive publication fails with `EPERM`, `EACCES`, or `EIO`
- **THEN** the operation SHALL fail with the original error
- **AND** no cross-device copy fallback SHALL run
- **AND** the active source SHALL remain available

#### Scenario: Native paths preserve transaction identity

- **WHEN** equivalent archives are planned on Windows, macOS, and Linux
- **THEN** staging, containment, target identity, and journal paths SHALL use platform-native path semantics
- **AND** a transaction SHALL resolve the same semantic archive without depending on one platform's separator or case rules

## MODIFIED Requirements

### Requirement: Archive dispositions classify every change-produced file

At archive time, every file a change has produced SHALL be classified into exactly one of four dispositions, determined by the file's class (per the seven-class model) and never by free-form judgment:

- **归档 (archive)**: 固定规划文件 (proposal.md, design.md, tasks.md, specs/, planning-context.md), evidence, and unabsorbed handoff — these travel in the verified archive payload.
- **清理 (clean)**: ephemera (run-state, raw logs, caches, regenerable intermediates) — deleted only from the complete cleaner plan with actual outcomes recorded.
- **静置 (leave)**: probes — not moved, copied, or deleted; the archive records each contained execution-root-relative path and its verified code commit.
- **out-of-scope**: design-docs (root-level, outlives any single change) and coordination (CLI lifecycle) — archive disposition logic does not scan them.

One archive engine SHALL own the complete classification and apply it for direct CLI, single-change skill, bulk skill, and in-ship archive entry points. Each entry point SHALL produce the same disposition and accounting for the same plan. The classification order (use-and-lifecycle first) governs borderline files.

#### Scenario: Evidence and planning files travel with the archive

- **WHEN** a change with `proposal.md`, `design.md`, `tasks.md`, `specs/`, and `evidence/review-report.md` is archived
- **THEN** all of these SHALL appear in the verified archive payload
- **AND** their source SHALL remain available until publication and accounting are durable

#### Scenario: Probes are left in place and recorded

- **WHEN** a change with probe code at an execution-root path is archived
- **THEN** the probe directory SHALL NOT be moved, copied, or deleted
- **AND** the archive SHALL record the contained execution-root-relative path and a commit verified in that execution repository

#### Scenario: design-docs are not scanned

- **WHEN** the disposition logic runs at archive time
- **THEN** it SHALL NOT scan or classify `<planningRoot>/rasen/design-docs/`
- **AND** it SHALL NOT scan or classify machine-root coordination state

#### Scenario: Every entry point has the same disposition

- **WHEN** equivalent changes are archived through direct CLI, single archive, bulk archive, and in-ship workflows
- **THEN** every path SHALL receive the same archive, clean, leave, or out-of-scope disposition
- **AND** each successful archive SHALL contain the same form of accounting

### Requirement: Handoff absorption is the sole discretionary point at archive

At archive time, handoff contents SHALL receive an absorption judgment: a handoff document whose dead-ends and eliminated hypotheses are already absorbed by `design.md` or evidence has outcome `absorbed`; one whose content is not absorbed has outcome `preserved` and lands under the archive's `evidence/handoff/`.

The default SHALL be preservation. The skill SHALL record judgment as versioned, change-bound intent without deleting or moving the active handoff. The archive engine SHALL validate the complete handoff inventory, allowed outcomes, and contained relative paths before applying those decisions only to the staged payload. If no judgment is supplied, the handoff directory SHALL travel unchanged and `handoffAbsorbed` SHALL record that no judgment was made. A malformed, future-version, incomplete, escaping, or unreadable sidecar SHALL block archive rather than be treated as absent.

#### Scenario: Absorbed handoff is omitted from the staged archive and recorded

- **WHEN** a handoff document's dead-ends and eliminated hypotheses are already covered by `design.md` or evidence
- **THEN** the validated staged payload SHALL omit the handoff document
- **AND** its active source SHALL remain until archive completion
- **AND** its path SHALL appear in `handoffAbsorbed` with an `absorbed` outcome

#### Scenario: Unabsorbed handoff moves within the staged payload

- **WHEN** a handoff document contains knowledge not yet absorbed by `design.md` or evidence
- **THEN** the staged payload SHALL place it under `evidence/handoff/`
- **AND** its active source SHALL remain until archive completion
- **AND** its path SHALL appear in `handoffAbsorbed` with a `preserved` outcome

#### Scenario: No absorption judgment preserves everything

- **WHEN** the CLI archives a change with no sidecar
- **THEN** only sidecar `ENOENT` SHALL select the no-judgment state
- **AND** the complete `handoff/` directory SHALL travel unchanged
- **AND** `handoffAbsorbed` SHALL distinguish no judgment from a completed empty judgment

#### Scenario: Invalid handoff intent blocks archive

- **WHEN** the sidecar is malformed, names another change, omits an inventoried handoff, uses an unknown outcome, or contains an absolute or escaping path
- **THEN** the archive plan SHALL report a blocker
- **AND** no handoff, ephemera, active change, or archive target SHALL be mutated

### Requirement: archive.json records disposition accounting without the planning-root commit hash

Every successful archive SHALL contain an `archive.json` file recording:

- `change`: the semantic change name.
- `archivedAt`: ISO-8601 timestamp.
- `codeCommit`: the execution root's confirmed HEAD commit SHA, or `null` only for a confirmed non-Git execution root.
- `planningBranch`: the planning root's current branch, or `null` for a confirmed non-Git or detached planning root.
- `planningTreeState`: `clean` or `dirty`.
- `evidence`: stable relative paths and SHA-256 hashes for every file recursively contained by the finalized `evidence/` tree.
- `probes`: validated execution-root-relative paths and commits that exist as commit objects in the execution repository.
- `handoffAbsorbed`: the validated handoff judgment outcome, with a distinct no-judgment state.
- `ephemeraDiscarded`: only the cleaner candidates actually disposed during this transaction.
- `missing`: expected but absent evidence items.

The finalized evidence tree SHALL include staged handoff preservation, the archive section of `ship-log.md`, and quality-report capture before hashing. No successful workflow SHALL mutate a hashed evidence file afterward. `archive.json` SHALL NOT record the planning-root commit hash because that would be an unclosable self-reference. Confirmed non-Git states may use their defined null/clean representation; Git ambiguity, command failure, permission/I/O failure, evidence read failure, or hash drift SHALL block or leave the transaction journaled rather than silently producing null, clean, or an incomplete inventory.

#### Scenario: archive.json carries codeCommit and branch, not planning commit

- **WHEN** `archive.json` is finalized during archive
- **THEN** it SHALL carry the confirmed execution `codeCommit`, `planningBranch`, and `planningTreeState`
- **AND** it SHALL NOT carry any field whose value is the planning-root commit SHA

#### Scenario: Final recursive evidence hashes are recorded

- **WHEN** the finalized archive contains top-level and nested evidence files
- **THEN** every file SHALL appear in the `evidence` array with a stable relative path and SHA-256 hash
- **AND** re-hashing the successful archive SHALL reproduce every recorded digest

#### Scenario: Missing items are listed honestly

- **WHEN** a change is archived without a ship log or verification report
- **THEN** `archive.json`'s `missing` array SHALL list those absent items

#### Scenario: Git or evidence uncertainty fails closed

- **WHEN** a Git query or relevant evidence read fails for a reason other than a confirmed non-Git root or `ENOENT` evidence directory
- **THEN** archive SHALL report the exact failed operation and path
- **AND** SHALL NOT finalize `archive.json` with guessed values or a partial evidence inventory

#### Scenario: Later workflow steps do not invalidate evidence

- **WHEN** a successful archive has recorded the ship-log hash in `archive.json`
- **THEN** single, bulk, and in-ship workflows SHALL perform no later append or rewrite of that ship log
- **AND** the recorded hash SHALL remain valid after the workflow reports completion
