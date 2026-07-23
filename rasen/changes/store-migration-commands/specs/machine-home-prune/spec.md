## ADDED Requirements

### Requirement: Home prune reports orphaned machine state before touching it
`rasen home prune` SHALL identify two orphan classes in the machine data directory: registry entries whose project path no longer exists on disk, and home directories not referenced by any registry entry. The default invocation SHALL only report them (with per-directory sizes); deletion requires `--apply`.

#### Scenario: Default is a report
- **WHEN** the user runs `rasen home prune` with orphans present
- **THEN** both orphan classes are listed with paths and sizes and nothing is deleted

#### Scenario: Apply removes only what was reported
- **WHEN** the user runs `rasen home prune --apply`
- **THEN** the listed registry entries and unreferenced home directories are removed and everything else is untouched

### Requirement: Live projects are never pruned
A home directory referenced by any existing registry entry SHALL never be eligible for pruning, regardless of how old its last-seen timestamp is. Worktree-registered paths that pierce to an existing main checkout count as live.

#### Scenario: Stale but existing project survives
- **WHEN** a registered project has not been seen for months but its path still exists
- **THEN** prune does not list it

#### Scenario: Deleted project path is prunable
- **WHEN** a registry entry's project path no longer exists on disk
- **THEN** prune lists the entry and its home directory as orphaned

### Requirement: Prune output is scriptable
`rasen home prune` SHALL support `--json` in both report and apply modes, emitting the orphan lists and, on apply, what was actually removed.

#### Scenario: JSON report
- **WHEN** the user runs `rasen home prune --json`
- **THEN** the output is a JSON document with the two orphan classes as separate arrays
