# opsx-archive-skill Specification Delta

## ADDED Requirements

### Requirement: The archive skill performs handoff absorption before bookkeeping

Before the bookkeeping step moves the change directory to the archive, the archive skill SHALL guide the agent through the handoff absorption judgment (defined by the `file-placement` capability): for each file under `<changeRoot>/handoff/`, the agent SHALL determine whether its dead-ends and eliminated hypotheses are already absorbed by `design.md` or the change's evidence. Absorbed handoff documents SHALL be deleted; unabsorbed documents SHALL be moved to `<changeRoot>/evidence/handoff/`. The default SHALL be preservation when the agent cannot confidently determine absorption. The judgment results SHALL be recorded for inclusion in `archive.json`'s `handoffAbsorbed` array.

#### Scenario: Absorbed handoff documents are deleted

- **WHEN** the archive skill processes a handoff document whose dead-ends are already covered by `design.md`
- **THEN** the skill SHALL direct the agent to delete the document
- **AND** the deletion SHALL be recorded for `handoffAbsorbed`

#### Scenario: Unabsorbed handoff documents move to evidence

- **WHEN** the archive skill processes a handoff document whose content is not absorbed by `design.md` or evidence
- **THEN** the skill SHALL direct the agent to move it to `<changeRoot>/evidence/handoff/`
- **AND** the move SHALL be recorded for `handoffAbsorbed` with a `preserved` outcome

#### Scenario: Empty or absent handoff directory skips the judgment

- **WHEN** the change has no `handoff/` directory or the directory is empty
- **THEN** the absorption step SHALL be a no-op
- **AND** `handoffAbsorbed` SHALL be empty

### Requirement: The archive skill reports the ephemera cleaner outcome

The archive skill's bookkeeping step SHALL note that the CLI's ephemera cleaner (when not suppressed by `--keep-ephemera`) runs before the directory move, and SHALL include the cleaner's outcome in the archive summary: the count of files deleted, the count of files preserved-and-reported, and any source-manifest discovery that blocked cleaning for a change. The skill itself SHALL NOT execute file deletion — the cleaner is deterministic CLI logic.

#### Scenario: Cleaner outcome appears in the summary

- **WHEN** the archive skill completes after the CLI cleaner has run
- **THEN** the summary SHALL report how many ephemera files were deleted and how many were preserved
- **AND** SHALL report any source-manifest discovery

### Requirement: The archive skill ensures archive.json is written

After the bookkeeping step's directory move, the archive skill SHALL ensure `archive.json` is written to the archived directory by the CLI, carrying the fields defined by the `file-placement` capability. The skill SHALL NOT hand-write `archive.json` — the CLI writes it. The skill SHALL include `archive.json`'s key fields (codeCommit, planningBranch, probes, handoffAbsorbed, ephemeraDiscarded) in the completion summary.

#### Scenario: archive.json is mentioned in the completion summary

- **WHEN** the archive skill reports completion
- **THEN** the summary SHALL note that `archive.json` was written
- **AND** SHALL report the `codeCommit` and `planningBranch` values

### Requirement: The archive skill probes are recorded as 静置

The archive skill SHALL record probe directories left in the execution root (静置 disposition) for inclusion in `archive.json`'s `probes` array, with their execution-root-relative paths and the code commit they were tested against. The skill SHALL NOT move, copy, or delete probe directories.

#### Scenario: Probes are recorded, not moved

- **WHEN** the archived change has probe code at an execution-root path
- **THEN** the skill SHALL ensure the path and code commit appear in `archive.json`'s `probes` array
- **AND** SHALL NOT move or delete the probe directory
