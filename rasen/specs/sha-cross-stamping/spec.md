# sha-cross-stamping Specification

## Purpose
Define the delivery-chain journal recorded across ship and archive: a change's ship log ends up holding both ends of the chain (the delivered ship commit and the archive/bookkeeping commit that follows it), archive commit messages carry a short-SHA reference back to the ship they close out, and a store-rooted change's PR body embeds its review material with dual-repo (code + store) SHA traceability so a reviewer sees intent and contract delta without leaving the PR.
## Requirements
### Requirement: The ship log records a two-ended delivery chain

A change's ship log SHALL record the ship end (delivered commit, tree fingerprint, and PR when applicable) and a finalized archive end (archive outcome/path, timestamp, transaction identity, and the ship commit copied from the log's own facts). The archive engine SHALL write the archive end in the staged evidence tree before hashing and SHALL leave the ship-side section byte-identical.

The ship log SHALL NOT contain the commit SHA of the commit that contains that same finalized log. Instead, the archive/spec-sync commit message SHALL reference the recorded ship short SHA, and Git history SHALL provide the stable archive-side commit identity. When no ship log exists, the engine SHALL create a minimal archive-only log and SHALL not invent ship facts. No workflow SHALL append to the log after its evidence digest is recorded.

#### Scenario: Archive finalizes the chain record before hashing

- **WHEN** a change is archived after a recorded ship
- **THEN** its staged ship log SHALL gain an archive section carrying outcome/path, timestamp, transaction identity, and the recorded ship commit
- **AND** the ship-side section SHALL be byte-identical
- **AND** `archive.json` SHALL hash that final content

#### Scenario: Chain survives legacy evidence resolution

- **WHEN** a ship log is discovered through a supported sticky-legacy location
- **THEN** its facts SHALL be incorporated into the staged canonical archive evidence
- **AND** the finalized archive SHALL contain a stable hashed chain record

#### Scenario: Never-shipped change still gets an archive record

- **WHEN** a change with no ship log is archived
- **THEN** the engine SHALL create a minimal ship log containing only archive facts
- **AND** SHALL omit ship commit, PR, and other undemonstrated delivery facts

#### Scenario: Archive commit is not appended into hashed evidence

- **WHEN** post-bookkeeping commit guidance is followed
- **THEN** the commit message SHALL provide the reverse ship reference
- **AND** no follow-up append SHALL add that commit's SHA to `ship-log.md`
- **AND** the recorded ship-log digest SHALL remain valid

### Requirement: The archive commit message references the ship commit

The archive/spec-sync commit SHALL reference the delivered ship commit in its message (short SHA, e.g. `chore(rasen): archive <name> (specs synced; ship <short-sha>)`), sourced from the ship log's recorded `Commit:` fact; when the log records no ship commit the reference SHALL be omitted, never invented. Bulk archive SHALL use the same per-change form. Synced spec files themselves SHALL NOT be stamped with delivery metadata.

#### Scenario: Archive commit is traceable to its ship

- **WHEN** the archive workflow directs the post-bookkeeping commit for a shipped change
- **THEN** the commit-message guidance SHALL include the ship short SHA from the recorded facts

#### Scenario: Spec content stays free of delivery metadata

- **WHEN** delta specs are synced into main specs during archive
- **THEN** the synced spec files SHALL contain no ship/archive SHA stamps

### Requirement: Store-mode ship embeds review material in the PR body with dual-repo stamps

When the resolved planning root is a registered store (`root.store_id` is present in the status payload — the actual store-selection signal; a compatibility bridge in the CLI always reports `planningHome.kind` as `repo` regardless of store selection, so templates MUST NOT key on that field), ship's PR body SHALL additionally embed the change's review material — the proposal's Why/What sections and the change's delta spec content, read from the CLI-resolved change root — inside collapsed sections, together with traceability stamps: the change's store path and the store repository's HEAD SHA at ship time. A dirty store working tree SHALL be stamped as such beside the SHA; a store not under git SHALL be stamped as unstampable. The ship log SHALL record the same store identity and SHA, so the chain covers code commit, store commit, and archive commit. Repo-mode PR bodies are unchanged apart from reading the proposal via the CLI-resolved change root.

#### Scenario: Store-mode PR carries proposal and delta specs

- **WHEN** ship creates a PR for a change whose planning root is a store
- **THEN** the PR body SHALL embed the proposal Why/What and the delta spec content in collapsed sections
- **AND** SHALL stamp the store path and the store repo HEAD SHA

#### Scenario: Dirty store tree is stamped honestly

- **WHEN** the store working tree has uncommitted content at ship time
- **THEN** the stamp SHALL carry the SHA plus an explicit dirty-tree note, never a clean-looking SHA alone

#### Scenario: Repo-mode PR body unchanged

- **WHEN** ship creates a PR for a repo-rooted change
- **THEN** the PR body SHALL be generated as before, with the proposal read from the CLI-resolved change root
