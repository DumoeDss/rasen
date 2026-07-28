# project-install-manifest Specification

## Purpose

Rasen remembers, per project, which tools the user chose to install and which Rasen version the project runs. The tool selection lives in the project's own `rasen/config.yaml` and is the authoritative answer to "which tools does this project use?" — every command that refreshes, validates, or reports tool configuration honors it, so a tool directory that appears for any reason other than the user's choice (a stray folder, a shared worktree, a prior experiment) is never silently installed into or refreshed. Projects that predate this behavior migrate losslessly from on-disk detection the first time the manifest is read. The installed version is cached per project in the machine-wide registry so `rasen update` can offer to bring other registered projects up to date, and a project can be pinned to its current version to opt out of that multi-project flow.

## Requirements
### Requirement: Tool-selection manifest is authoritative

The system SHALL maintain a per-project manifest of the tool IDs the user explicitly selected at `rasen init`, recorded in the project's `rasen/config.yaml` under a `tools:` key (a list of tool id strings, each matching the `value` field of an entry in the `AI_TOOLS` table). When the manifest is present, it SHALL be the authoritative source of the project's configured tools for every Rasen command that refreshes, validates, or reports tool configuration. On-disk artifact detection (the presence of Rasen skill files under a tool's `skillsDir`, or leftover pre-retirement command files) SHALL NOT be used to expand the configured-tool set silently; detection of an unselected tool directory SHALL only produce the existing advisory hint that points the user at `rasen init`.

The `tools:` key SHALL be optional in the project config schema so that a project that predates this capability, a config written by an older binary, or a config that omits the key for any reason continues to load and parse without error.

#### Scenario: Manifest drives configured-tool set

- **WHEN** `rasen/config.yaml` contains `tools: [claude]`
- **AND** the project directory also contains a `.codex/skills/rasen-propose/SKILL.md` file the user never opted into
- **THEN** commands that resolve configured tools SHALL treat only `claude` as configured
- **AND** SHALL NOT refresh, install into, or report Codex as a configured tool
- **AND** SHALL surface Codex only through the existing new-tool-detection advisory that points at `rasen init`

#### Scenario: Missing manifest tolerated

- **WHEN** `rasen/config.yaml` parses cleanly but has no `tools:` key
- **THEN** config loading SHALL NOT error
- **AND** the one-time migration defined below SHALL seed the manifest before configured-tool resolution proceeds

#### Scenario: Invalid manifest entries dropped with warning

- **WHEN** `rasen/config.yaml` carries `tools: [claude, not-a-real-tool]`
- **THEN** the resilient parser SHALL drop `not-a-real-tool` with a warning
- **AND** valid siblings SHALL survive (in this case, `claude`)
- **AND** commands SHALL proceed against the surviving list

#### Scenario: Empty manifest is valid

- **WHEN** `rasen/config.yaml` contains `tools: []` (an explicit empty list)
- **THEN** the project SHALL be treated as having zero configured tools
- **AND** `rasen update` SHALL report that no tools are configured and point at `rasen init`
- **AND** on-disk artifacts SHALL NOT expand the configured set

### Requirement: One-time migration from on-disk artifacts

When a Rasen command that resolves configured tools runs in a project whose `rasen/config.yaml` has no `tools:` key, the system SHALL seed the key once from the tools detected on disk, so that no existing install loses its tools as a side effect of upgrading. The seed SHALL take the union of (a) tools with at least one generated Rasen skill file under their `skillsDir`, and (b) tools with at least one leftover pre-retirement Rasen command file (the same union the existing `getConfiguredToolsForProfileSync` and `getCommandConfiguredTools` calls already compute). The seeded value SHALL be written into `rasen/config.yaml` using the same comment-preserving single-key writer used for other project-config keys, and the seed SHALL be logged to the user as an informational message naming the tool ids added.

After the seed, the manifest SHALL be authoritative for the remainder of that command's execution and for every subsequent run. The migration SHALL be idempotent: a re-run on a project that already has a `tools:` key SHALL NOT modify the key, regardless of what is on disk.

#### Scenario: Migration seeds manifest from existing install

- **WHEN** a project has Rasen skill files in `.claude/skills/` and `.codex/skills/` but no `tools:` key in `rasen/config.yaml`
- **AND** the user runs `rasen update` or `rasen init`
- **THEN** the system SHALL write `tools:` into `rasen/config.yaml` with the detected tool ids
- **AND** SHALL proceed with that set as the configured-tool set for this run

#### Scenario: Migration is idempotent

- **WHEN** `rasen/config.yaml` already contains `tools: [claude]`
- **AND** the user runs `rasen update` after manually adding a `.codex/skills/rasen-propose/SKILL.md` file
- **THEN** the system SHALL NOT modify the `tools:` key in the config
- **AND** SHALL treat only `claude` as configured
- **AND** SHALL surface Codex via the new-tool-detection advisory

#### Scenario: Migration never silently shrinks an existing manifest

- **WHEN** `rasen/config.yaml` contains `tools: [claude, codex]`
- **AND** `.codex/skills/` has been deleted from disk
- **THEN** `rasen update` SHALL still treat Codex as configured (the manifest is authoritative)
- **AND** SHALL regenerate Codex's skill files just as it would for any configured tool whose files are missing

#### Scenario: Migration fails open when config is unreadable

- **WHEN** `rasen/config.yaml` cannot be read or parsed
- **THEN** the command SHALL fall back to on-disk detection for the current run
- **AND** SHALL NOT abort solely because the manifest cannot be seeded
- **AND** SHALL emit a warning naming the config path

### Requirement: Installed version is tracked per project

The system SHALL record the Rasen version each registered project runs in the machine-wide project registry entry for that project, alongside the timestamp of the most recent refresh. The version SHALL be the CLI's own package version (the same value `rasen init` and `rasen update` stamp into generated skill `generatedBy` frontmatter), never a hand-set or user-editable value. The installed-version field SHALL be optional in the registry schema so that an older registry without it continues to load, and a registry entry lacking the field SHALL be treated as "version unknown" by multi-project update rather than failing.

The installed version SHALL be refreshed:
- by `rasen update` after a successful update of the project
- by the registry self-heal touch, reading the `generatedBy` frontmatter of one surviving skill file as ground truth when the cache is empty or older than the self-heal staleness threshold

#### Scenario: Update records the version

- **WHEN** `rasen update` successfully refreshes a project's tools to CLI version `0.1.7`
- **THEN** the project's registry entry SHALL carry that version in `installedVersion` and a fresh `lastUpdated` timestamp after the run completes

#### Scenario: Self-heal refreshes version from skill frontmatter

- **WHEN** a registered project's self-heal touch runs and the cached `installedVersion` is empty or stale
- **AND** the project has at least one surviving skill file with a `generatedBy` frontmatter field
- **THEN** the touch SHALL update `installedVersion` from that field without visibly slowing the user's command

#### Scenario: Older registry entries tolerated

- **WHEN** the registry contains an entry written by an older binary that lacks `installedVersion` and `lastUpdated`
- **THEN** the registry SHALL load without error
- **AND** multi-project update SHALL treat that project's version as unknown and surface it as "version unknown" rather than failing

### Requirement: Update pinning

A project SHALL be excludable from multi-project update prompts by setting `update.pin: true` in its `rasen/config.yaml`. A pinned project SHALL remain visible in the machine-wide registry so `rasen doctor` continues to report it, but SHALL NOT be offered by the multi-project update prompt and SHALL NOT be upgraded by `--all-projects`. Pinning SHALL affect only multi-project flows: running `rasen update` directly inside a pinned project SHALL update that project normally.

#### Scenario: Pinned project skipped by multi-project update

- **WHEN** project A's `rasen/config.yaml` has `update.pin: true`
- **AND** the user runs `rasen update --all-projects` from project B on the same machine
- **THEN** project A SHALL NOT be upgraded
- **AND** the summary SHALL list project A as "skipped: pinned"

#### Scenario: Direct update of a pinned project still works

- **WHEN** the user runs `rasen update` directly inside a project whose `rasen/config.yaml` has `update.pin: true`
- **THEN** the project SHALL be updated normally
- **AND** `update.pin` SHALL NOT change the behavior of a direct in-project update

