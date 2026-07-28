## MODIFIED Requirements

### Requirement: Update detects configured tools from skills or commands

The update command SHALL resolve the project's configured-tool set from the authoritative `tools:` manifest in `rasen/config.yaml`. When the manifest is present, it SHALL be the sole source of configured tools: a tool directory present on disk but absent from the manifest SHALL NOT be refreshed, installed into, or reported as configured. On-disk artifact detection (Ras Managed skill files under a tool's `skillsDir`, or leftover pre-retirement command files) SHALL be used ONLY for the one-time migration seed defined by the `project-install-manifest` capability, when the manifest is absent; once the manifest exists, on-disk detection SHALL NOT expand or reduce the configured-tool set.

The existing new-tool-detection advisory SHALL continue to surface tool directories present on disk but absent from the manifest, pointing the user at `rasen init` to add them. The existing cleanup of leftover Rasen command files SHALL continue to run for every configured tool.

#### Scenario: Manifest present and authoritative

- **WHEN** the user runs `rasen update` in a project whose `rasen/config.yaml` has `tools: [claude]`
- **AND** the project directory also contains a `.codex/skills/rasen-propose/SKILL.md` file the user never opted into
- **THEN** the system SHALL refresh only Claude Code's skills
- **AND** SHALL NOT install, refresh, or clean up files under `.codex/`
- **AND** SHALL display the new-tool-detection advisory for Codex pointing at `rasen init`

#### Scenario: Migration seeds manifest when absent

- **WHEN** the user runs `rasen update` in a project whose `rasen/config.yaml` has no `tools:` key
- **AND** the project has Rasen skill files in `.claude/skills/` and leftover command files under `.codex/`
- **THEN** the system SHALL seed the `tools:` key into `rasen/config.yaml` with the detected tool ids (union of skill-configured and command-configured tools)
- **AND** SHALL proceed to refresh both tools as configured
- **AND** a subsequent `rasen update` SHALL NOT re-seed (the manifest is now present)

#### Scenario: Commands-only legacy install recognized during migration

- **WHEN** the user runs `rasen update` in a project whose `rasen/config.yaml` has no `tools:` key
- **AND** a tool has leftover Rasen command files but no Rasen skill files
- **THEN** the migration seed SHALL include that tool in the `tools:` list
- **AND** update SHALL install the skill files for the resolved profile for that tool and remove the leftover command files

#### Scenario: Empty manifest reports no configured tools

- **WHEN** the user runs `rasen update` in a project whose `rasen/config.yaml` has `tools: []`
- **THEN** the system SHALL display "No configured tools found." with the hint to run `rasen init`
- **AND** SHALL NOT scan the project directory for tools to refresh

#### Scenario: Manifest tool files regenerated when missing on disk

- **WHEN** the user runs `rasen update` in a project whose `rasen/config.yaml` has `tools: [claude, codex]`
- **AND** the `.codex/skills/` directory has been deleted from disk
- **THEN** the system SHALL regenerate Codex's skill files (the manifest is authoritative, not the disk state)
- **AND** SHALL NOT silently drop Codex from the configured-tool set

## ADDED Requirements

### Requirement: Multi-project update offers other registered projects

After successfully updating the current project, `rasen update` SHALL consult the machine-wide project registry for other registered projects whose cached `installedVersion` is behind the current CLI version (or whose version is unknown), and offer to upgrade them in the same run. The offer SHALL respect explicit consent: no project SHALL be upgraded without a positive user action. Projects whose `rasen/config.yaml` carries `update.pin: true` SHALL be excluded from the offer and from `--all-projects`.

In an interactive terminal with at least one other non-pinned project behind, the command SHALL present a three-way prompt:
- **Update all** — every reachable, non-pinned project whose version is behind
- **Select** — a multi-select of the eligible behind projects
- **Skip** — exit after updating only the current project (the default)

In a non-interactive run (no TTY, piped stdin, or when `--only-this` is supplied), the command SHALL skip the offer entirely and report only the current project's update.

The `--all-projects` flag SHALL skip the prompt and update the current project plus every reachable, non-pinned project whose version is behind. The `--only-this` flag SHALL skip the prompt and the registry consultation entirely, behaving exactly as `rasen update` did before this capability.

For each targeted project, update SHALL:
- skip and summarize projects whose directory no longer exists on disk (dangling entries are reported separately by `rasen doctor`)
- skip and summarize projects whose `rasen/config.yaml` is missing or unreadable for that run
- skip and summarize projects whose `update.pin` is `true`
- skip and summarize projects whose version is already current
- record a per-project success or failure line in the summary

A per-project failure SHALL NOT abort the batch; the remaining candidates SHALL continue to be processed. The summary SHALL list every skipped project with its reason so the user can act on them.

#### Scenario: Interactive prompt after current project updated

- **WHEN** the user runs `rasen update` interactively and the current project's tools are refreshed
- **AND** the registry holds two other non-pinned projects behind the current CLI version
- **THEN** the system SHALL display the list of behind projects with their cached version and last-updated timestamp
- **AND** SHALL prompt with three choices: update all, select, skip (default: skip)
- **AND** SHALL only upgrade a project after the user explicitly chooses one of the non-skip options

#### Scenario: --all-projects in a scripting context

- **WHEN** the user runs `rasen update --all-projects` non-interactively
- **THEN** the system SHALL update the current project and every reachable, non-pinned project whose version is behind
- **AND** SHALL NOT prompt
- **AND** SHALL print a summary listing each project's outcome

#### Scenario: --only-this skips registry consultation

- **WHEN** the user runs `rasen update --only-this`
- **THEN** the system SHALL update only the current project
- **AND** SHALL NOT read or write the registry for multi-project purposes
- **AND** SHALL NOT display any multi-project offer

#### Scenario: Missing project directory skipped

- **WHEN** the multi-project update targets a registered project whose path no longer exists on disk
- **THEN** the system SHALL skip that project
- **AND** the summary SHALL list it as "skipped: directory missing"
- **AND** the run SHALL continue with the remaining candidates

#### Scenario: Pinned project skipped by --all-projects

- **WHEN** `rasen update --all-projects` targets a project whose `rasen/config.yaml` has `update.pin: true`
- **THEN** the system SHALL skip that project
- **AND** the summary SHALL list it as "skipped: pinned"

#### Scenario: No prompt when nothing is behind

- **WHEN** the user runs `rasen update` and every other registered project is already at the current version
- **THEN** the system SHALL NOT display a multi-project offer
- **AND** SHALL display at most a one-line note that all registered projects are current

#### Scenario: Failed per-project update does not abort the batch

- **WHEN** updating one of the targeted projects throws an error
- **THEN** the system SHALL record that project as failed in the summary
- **AND** SHALL continue updating the remaining candidates

#### Scenario: Version-unknown entries surfaced

- **WHEN** the registry holds an entry without a cached `installedVersion` (written by an older binary)
- **THEN** the multi-project enumeration SHALL treat that entry's version as unknown
- **AND** the entry SHALL be eligible for the prompt (the user can choose whether to update it)
- **AND** the prompt SHALL display "version unknown" for that entry

### Requirement: Update records installed version in the registry

After a successful `rasen update` that refreshed the current project's tools, the command SHALL refresh the project's registry entry's `installedVersion` (set to the current CLI version) and `lastUpdated` (set to the current time), alongside the cached `tools` mirror of the manifest. This write SHALL be best-effort: a registry write failure SHALL NOT abort the command, since the skill files are already refreshed on disk and the self-heal touch will converge the cache on the next command that resolves the project's home.

#### Scenario: Successful update writes the version

- **WHEN** `rasen update` completes successfully at CLI version `0.1.7`
- **THEN** the current project's registry entry SHALL carry `installedVersion: "0.1.7"` and a fresh `lastUpdated` timestamp

#### Scenario: Registry write failure tolerated

- **WHEN** `rasen update` completes successfully but the registry write fails (e.g. the registry file is locked for an extended period)
- **THEN** the command SHALL emit a best-effort warning at most
- **AND** SHALL exit successfully because the skill files on disk are already refreshed
- **AND** the next registry self-heal touch SHALL converge the cache from the on-disk `generatedBy` frontmatter
