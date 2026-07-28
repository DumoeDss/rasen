## ADDED Requirements

### Requirement: Registry entry caches installed tools and version

Each registry entry SHALL carry optional `tools`, `installedVersion`, and `lastUpdated` cache fields, mirroring the project's `rasen/config.yaml` `tools:` manifest and the Rasen version stamped into generated skill `generatedBy` frontmatter. The fields SHALL be optional in the entry schema so that an older registry, or an entry written by an older binary, continues to load without error; an absent field SHALL be treated as "unknown" by readers, never as an error.

The cache fields SHALL be refreshed by:
- `rasen init`, after a successful run that wrote tools and stamped a version
- `rasen update`, after a successful run that refreshed tools and re-stamped the version
- the registry self-heal touch, which SHALL read the `generatedBy` frontmatter of one surviving skill file as ground truth for `installedVersion` when refreshing the entry, and SHALL mirror the project's `tools:` manifest when readable

The cache fields SHALL never be the source of truth for the configured-tool set when `rasen/config.yaml` is readable: the project config is authoritative, and the registry cache exists only so multi-project scans can avoid opening every project's config. Readers SHALL prefer the project config when both are available and disagree, and SHALL treat the disagreement as a drift signal surfaced by `rasen doctor` rather than silently picking one.

The registry's existing best-effort contract SHALL be preserved: a failed cache refresh SHALL never fail or visibly slow a user command, and a malformed or partially-written cache field SHALL be reparable by the next successful update or self-heal. Registration's existing invariants (a `home` is never renamed once assigned; path-exact / worktree-share / moved-repo / clone-fork dispositions are unchanged) SHALL remain intact when the new cache fields are added.

#### Scenario: New fields tolerated by older binary

- **WHEN** an older binary that does not know the `tools`, `installedVersion`, or `lastUpdated` fields reads a registry file containing them
- **THEN** the registry SHALL still parse under that binary's schema (the fields are optional in the entry object, not unknown top-level keys)

#### Scenario: Absent fields tolerated by newer binary

- **WHEN** a newer binary reads a registry entry written by an older binary that lacks the new fields
- **THEN** the entry SHALL load with the fields treated as absent
- **AND** multi-project update SHALL treat the project's version as "unknown"

#### Scenario: Self-heal refreshes version from skill frontmatter

- **WHEN** the registry self-heal touch runs for a registered project that has at least one surviving skill file with a `generatedBy` field
- **AND** the cached `installedVersion` is absent or older than the self-heal staleness threshold
- **THEN** the touch SHALL refresh `installedVersion` from that field
- **AND** the user's command SHALL not be visibly slowed by the refresh

#### Scenario: Self-heal mirrors manifest when readable

- **WHEN** the registry self-heal touch runs for a registered project whose `rasen/config.yaml` carries a readable `tools:` key
- **THEN** the touch SHALL mirror that list into the entry's cached `tools` field
- **AND** a reader comparing the cache to the project config SHALL see them agree

#### Scenario: Registration preserves home-naming invariants with cache fields

- **WHEN** `registerProject` runs with the new optional cache fields supplied
- **THEN** the entry's `home` SHALL still be derived exactly as before (never renamed once assigned)
- **AND** the path-exact / worktree-share / moved-repo / clone-fork dispositions SHALL be unchanged
- **AND** cache fields supplied to the call SHALL be written on a fresh entry and preserved (not reset to undefined) on subsequent registrations when not supplied

#### Scenario: Cache-vs-config drift surfaced by doctor

- **WHEN** a project's `rasen/config.yaml` lists `tools: [claude]` and its registry entry caches `tools: [claude, codex]`
- **THEN** `rasen doctor` SHALL report the drift as an advisory
- **AND** SHALL NOT silently rewrite either side
- **AND** SHALL suggest re-running `rasen init` or `rasen update` in that project to resync the cache
