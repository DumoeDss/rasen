# sha-cross-stamping Specification (delta)

## ADDED Requirements

### Requirement: The ship log records a two-ended delivery chain

A change's ship log (in the work directory per the `change-work-dir` capability) SHALL record both ends of the delivery chain: the ship end (the delivered commit, tree fingerprint, and PR when applicable — as ship already records) and an archive end appended by the archive workflow after bookkeeping — the archive/spec-sync commit SHA, the outcome (archived location, pruned state, or archived-in-ship), a timestamp, and the ship commit SHA it corresponds to, copied from the log's own recorded facts rather than re-derived. The append SHALL never rewrite the ship-side section. When no ship log exists (never-shipped or legacy change), the archive workflow SHALL create one containing only the archive section. When the archive commit is created after the append, its SHA SHALL be journaled in a follow-up append immediately after committing.

#### Scenario: Archive appends the chain record

- **WHEN** a change is archived after a recorded ship
- **THEN** its ship log SHALL gain an archive section carrying the archive commit SHA, the outcome, and the ship commit SHA from the log's recorded facts
- **AND** the ship-side section SHALL be byte-identical to before the append

#### Scenario: Chain survives every destination

- **WHEN** a change archives to the external home or is pruned
- **THEN** the ship log (work directory) SHALL still hold the complete chain record afterward

#### Scenario: Never-shipped change still gets an archive record

- **WHEN** a change with no ship log is archived
- **THEN** the archive workflow SHALL create the ship log with the archive section and omit ship-side references rather than inventing them

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
