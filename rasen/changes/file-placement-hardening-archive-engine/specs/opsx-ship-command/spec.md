## MODIFIED Requirements

### Requirement: Ship Log

`ship-log.md` SHALL be written to the change's evidence directory (`<changeRoot>/evidence/`, the `evidenceDir` reported by the CLI per the `file-placement` capability), with the sticky-legacy fallback for a log that already exists in the legacy work directory or change directory. Ship's pre-flight evidence reads SHALL check evidence first, then the legacy work directory, then the change directory.

When archive timing is `in-ship`, ship SHALL finalize every delivery/deployment fact that will belong in the log before invoking the archive engine. The engine SHALL finalize the archive section in its stage, and no ship step SHALL mutate that evidence after the engine hashes it.

#### Scenario: Ship log written after delivery in any mode

- **WHEN** the ship phase completes delivery (PR created, branch pushed, or local commit recorded)
- **THEN** the system SHALL write `ship-log.md` to the evidence directory or resolved legacy location
- **AND** the log SHALL include delivery mode, branch, commit, tree fingerprint, timestamp, verification scope/rationale/results, PR URL in `pr` mode, and the deferral note in `local` mode

#### Scenario: Ship log updated after deployment

- **WHEN** the optional land-and-deploy phase completes before archive
- **THEN** the system SHALL update the same resolved ship log with deployment status and production verification results
- **AND** under `in-ship` timing this update SHALL precede archive engine invocation

#### Scenario: Evidence read from the work directory

- **WHEN** ship's pre-flight checks look for verification or test-skip evidence
- **THEN** they SHALL check the evidence directory first, then the legacy work directory, then the change directory

#### Scenario: In-ship evidence is immutable after archive

- **WHEN** the in-ship archive engine reports success
- **THEN** ship SHALL perform no later ship-log append or deployment-status rewrite
- **AND** the ship-log digest recorded in `archive.json` SHALL remain valid

### Requirement: Ship honors the archive timing axis

The ship workflow SHALL resolve `archive.timing` from status JSON. Under `in-ship`, ship SHALL keep the change active while it commits/tests/delivers, resolves any PR URL, completes or declines optional deployment, and writes final ship-side evidence. It SHALL then invoke the authoritative archive engine, inspect the complete plan, and commit/push the resulting archive bookkeeping as required by delivery mode. It SHALL NOT sync and move the change independently.

Under `on-merge`, ship SHALL NOT invoke archive during PR review. Its guidance SHALL leave PR-delivered changes active until merge confirmation and direct `push`/`local` deliveries to archive after delivery.

#### Scenario: In-ship delivery uses the archive engine after evidence finalization

- **WHEN** generated ship runs with timing `in-ship`
- **THEN** it SHALL finalize delivery facts and `ship-log.md` while the change is active
- **AND** SHALL invoke the same archive engine used by direct and skill archive
- **AND** SHALL use the engine's spec sync, staging, disposition, accounting, and publication result

#### Scenario: In-ship PR may require a follow-up archive push

- **WHEN** `pr` delivery must create the PR before its URL can be finalized in evidence
- **THEN** ship SHALL push/create the PR, finalize the ship log, run/archive-commit through the engine, and push the non-force follow-up commit
- **AND** SHALL report both the recorded ship commit and archive bookkeeping commit through stable Git history

#### Scenario: On-merge pr delivery leaves the change active

- **WHEN** ship completes a `pr` delivery with timing `on-merge`
- **THEN** its guidance SHALL state the change remains active during PR review and archive follows merge confirmation
- **AND** SHALL NOT sync specs, stage an archive, or remove the active change

#### Scenario: On-merge local or push delivery chains to archive

- **WHEN** ship completes a `push` or `local` delivery with timing `on-merge`
- **THEN** its guidance SHALL direct running the authoritative archive flow immediately

#### Scenario: Clean tree skips only the code commit

- **WHEN** the working tree is clean before the code commit
- **THEN** ship MAY skip that code commit
- **AND** under `in-ship` timing it SHALL still run and commit archive bookkeeping after final evidence

### Requirement: Ship stamps the delivery chain and embeds store review material

Ship SHALL source its PR-body proposal read from the CLI-resolved change root and, in store mode, embed proposal/delta review material with honest store stamps as defined by `sha-cross-stamping`. Under `in-ship`, ship SHALL record the delivered commit and tree in the ship-side log, then let the archive engine finalize the archive outcome before hashing. The stable archive-side link SHALL be the subsequent archive commit message/Git history; ship SHALL NOT insert the containing archive commit SHA into hashed evidence.

#### Scenario: Proposal read is store-safe

- **WHEN** the generated ship workflow builds a PR body
- **THEN** it SHALL read the proposal from status JSON's `changeRoot`, not a repo-relative literal path

#### Scenario: Store-mode ship log carries the store stamp

- **WHEN** ship delivers a store-rooted change in `pr` mode
- **THEN** the ship log SHALL record the store identity and honest store repo state in addition to code commit/tree
- **AND** the PR body SHALL carry review material with the same stamps

#### Scenario: In-ship ship finalizes a non-self-referential chain

- **WHEN** ship runs under `in-ship` timing
- **THEN** the finalized ship log SHALL contain delivery facts and the engine-written archive outcome
- **AND** SHALL omit a self-referential archive commit field
- **AND** the archive commit guidance SHALL reference the recorded ship commit
