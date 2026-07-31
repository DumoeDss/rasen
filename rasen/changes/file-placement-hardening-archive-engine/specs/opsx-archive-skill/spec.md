## MODIFIED Requirements

### Requirement: Archive Process

The single archive skill and bulk archive skill SHALL use `rasen archive` as the only bookkeeping engine. They may perform their semantic gates, spec-conflict assessment, and handoff/probe judgment, but they SHALL pass that intent to the engine and SHALL NOT create the archive directory, move the change, delete active handoff or ephemera, capture quality independently, or hand-write accounting.

#### Scenario: Successful archive

- **WHEN** a single archive skill archives a change
- **THEN** it SHALL inspect the engine's complete plan, invoke engine apply, and report the returned archive path and disposition
- **AND** `.openspec.yaml`, finalized evidence, and `archive.json` SHALL come from the same engine transaction

#### Scenario: Archive already exists

- **WHEN** the engine plan reports an unrelated target at the final archive path
- **THEN** the skill SHALL surface that blocker
- **AND** SHALL NOT rename, merge, overwrite, or delete either directory

#### Scenario: Bulk archive uses one engine per selected change

- **WHEN** bulk archive processes multiple confirmed changes
- **THEN** it SHALL invoke the same archive engine separately for each change in resolved spec-conflict order
- **AND** SHALL derive success, failure, and recovery status from each engine result
- **AND** one change's failure SHALL NOT cause a direct-move fallback for that or another change

### Requirement: Archive closes the delivery chain

Before invoking archive apply, the archive skill SHALL ensure the ship-side evidence facts are final. The archive engine SHALL add the archive section inside the staged ship log before evidence hashing, copying any ship commit from the log's recorded facts and recording timestamp, outcome/path, and transaction identity. The skill SHALL leave the ship-side section untouched and SHALL perform no ship-log append after accounting.

Post-bookkeeping commit guidance SHALL include the recorded ship short SHA when present and omit it when absent. Git history and that commit message provide the stable archive-side link; the skill SHALL NOT append the containing archive commit SHA into already-hashed evidence. Bulk archive SHALL apply the same finalization and commit-message form per change.

#### Scenario: Chain record is finalized before hashing

- **WHEN** the generated single archive skill is inspected
- **THEN** engine invocation SHALL replace direct bookkeeping and post-bookkeeping ship-log append
- **AND** completion SHALL be reported only after the engine verifies the finalized ship-log hash

#### Scenario: Bulk archive finalizes each change independently

- **WHEN** the generated bulk archive skill archives multiple changes
- **THEN** each engine transaction SHALL finalize and hash that change's own ship log
- **AND** each post-bookkeeping commit-message form SHALL use that change's recorded ship commit

#### Scenario: No later append invalidates accounting

- **WHEN** archive apply returns success
- **THEN** the skill SHALL NOT append an archive commit or any other content to evidence
- **AND** every `archive.json` evidence digest SHALL remain valid at summary time

### Requirement: Bookkeeping step always moves in-repo

The archive skill's bookkeeping step SHALL invoke the authoritative engine with the status payload's planning-root archive directory. The engine SHALL stage, verify, and publish the archive there with date-prefix and collision rules, regardless of a legacy `archive.destination` value. The skill SHALL not use `legacyArchiveDir` as a target and SHALL not issue a direct move.

#### Scenario: Bookkeeping ignores legacy destination config

- **WHEN** the generated archive skill runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** it SHALL pass the planning-root archive target to the engine
- **AND** the engine SHALL publish an archive copy before source removal
- **AND** nothing SHALL be written to the machine-home archive

#### Scenario: Generated templates contain no direct archive move

- **WHEN** single and bulk generated templates are inspected
- **THEN** no step SHALL instruct `mkdir` plus `mv` or recursive source removal for archive bookkeeping
- **AND** the only mutation entry SHALL be the authoritative archive command

### Requirement: The archive skill performs handoff absorption before bookkeeping

Before engine invocation, the archive skill SHALL read each handoff document and judge whether its dead-ends and eliminated hypotheses are absorbed by `design.md` or evidence. It SHALL encode a complete, versioned, change-bound decision sidecar using only `absorbed` or `preserved`, defaulting uncertain cases to `preserved`. The skill SHALL NOT apply those decisions to active files; the engine validates and applies them in the stage.

#### Scenario: Absorbed handoff is expressed as intent

- **WHEN** a handoff document's knowledge is already covered by design or evidence
- **THEN** the skill SHALL record an `absorbed` decision for its contained relative path
- **AND** SHALL leave the active document unchanged until engine success

#### Scenario: Unabsorbed handoff is expressed as preservation intent

- **WHEN** a handoff document contains unabsorbed knowledge
- **THEN** the skill SHALL record a `preserved` decision for placement under staged `evidence/handoff/`
- **AND** SHALL leave the active document unchanged until engine success

#### Scenario: Empty handoff inventory is explicit

- **WHEN** the handoff directory is absent or empty and the skill supplies a judgment
- **THEN** the sidecar SHALL record a complete empty handoff decision set
- **AND** the engine SHALL distinguish it from no sidecar/no judgment

#### Scenario: Sidecar validation failure stops before mutation

- **WHEN** the engine rejects the sidecar schema, change binding, outcome, path containment, inventory completeness, or probe commit
- **THEN** the skill SHALL report the blocker and remediation
- **AND** SHALL NOT perform a direct handoff or archive fallback

### Requirement: The archive skill reports the ephemera cleaner outcome

The archive skill SHALL report the engine plan/result's cleaner completeness, effective `keepEphemera` semantics, source signals, typed blockers, exact deleted paths, and exact preserved paths. The skill SHALL NOT execute deletion and SHALL NOT describe an aborted or incomplete cleaner plan as an empty ephemera directory.

#### Scenario: Cleaner outcome appears in the summary

- **WHEN** archive completes after an applicable cleaner plan
- **THEN** the summary SHALL report exact deleted and preserved counts and paths
- **AND** SHALL report any source signal that caused complete preservation

#### Scenario: Incomplete cleaner plan is reported as blocked

- **WHEN** cleaner inspection is incomplete
- **THEN** the skill SHALL report the blocker operation, path, and code
- **AND** SHALL NOT claim archive completion

### Requirement: The archive skill ensures archive.json is written

The archive skill SHALL require the authoritative engine's success result to confirm that `archive.json` was atomically written and verified against the finalized evidence tree. The skill SHALL not hand-write or repair accounting and SHALL report a journaled incomplete transaction as recoverable, not successful.

#### Scenario: archive.json is mentioned in the completion summary

- **WHEN** the engine reports successful archive completion
- **THEN** the summary SHALL report `codeCommit`, `planningBranch`, disposition totals, and evidence verification
- **AND** SHALL confirm that no later evidence mutation occurred

#### Scenario: Journaled failure is not summarized as success

- **WHEN** the engine reports a staged or published incomplete transaction
- **THEN** the summary SHALL identify the active/archive paths, transaction id, and retry guidance
- **AND** SHALL NOT say that `archive.json` or archive completion succeeded

### Requirement: The archive skill probes are recorded as 静置

The archive skill SHALL record probe intent only as execution-root-relative paths and full code commit ids. The archive engine SHALL validate lexical and resolved containment, directory identity, commit syntax, and commit existence in the execution repository before recording probes in `archive.json`. Neither skill nor engine SHALL move, copy, or delete probes.

#### Scenario: Valid probes are recorded, not moved

- **WHEN** a probe path is contained by the execution root and its commit resolves in that repository
- **THEN** the engine SHALL record the path and commit in `archive.json`
- **AND** the probe directory SHALL remain byte-for-byte in place

#### Scenario: Escaping path or invalid commit blocks archive

- **WHEN** a probe path is absolute, escapes through `..` or symlink resolution, or its commit is malformed or absent
- **THEN** the engine SHALL report a sidecar blocker
- **AND** SHALL NOT publish the archive or mutate the probe
