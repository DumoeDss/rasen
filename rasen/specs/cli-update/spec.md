# Update Command Specification

## Purpose

As a developer using Rasen, I want to update the Rasen instructions in my project when new versions are released, so that I can benefit from improvements to AI agent instructions.
## Requirements
### Requirement: Update Behavior
The update command SHALL update Rasen instruction files to the latest templates in a team-friendly manner.

#### Scenario: Running update command
- **WHEN** a user runs `rasen update`
- **THEN** regenerate skill files for each tool being updated, using the latest templates
- **AND** remove any previously installed rasen command files for each tool (commands have been consolidated into skills)

### Requirement: File Handling
The update command SHALL handle file updates in a predictable and safe manner.

#### Scenario: Updating files
- **WHEN** updating files
- **THEN** completely replace each skill file's content with the latest template
- **AND** remove any pre-existing rasen command file rather than regenerating it

### Requirement: Tool-Agnostic Updates
The update command SHALL refresh Rasen-managed files in a predictable manner while respecting each team's chosen tooling.

#### Scenario: Updating files
- **WHEN** updating files
- **THEN** only operate on tools that already have at least one Rasen-generated file; update never onboards a new tool
- **AND** regenerate each existing AI tool's skill files in full from the current template on every update, rather than preserving any prior file content
- **AND** generate skill files only; command files are never generated and any existing rasen command file is removed

### Requirement: Core Files Always Updated
The update command SHALL always update the core Rasen files and display an ASCII-safe success message.

#### Scenario: Successful update
- **WHEN** the update completes successfully
- **THEN** regenerate skill files for each tool that was updated

### Requirement: Archive Command Argument Support
The archive slash command template SHALL support optional change ID arguments for tools that support `$ARGUMENTS` placeholder.

#### Scenario: Archive command with change ID argument
- **WHEN** a user invokes `/rasen-archive-change <change-id>` with a change ID
- **THEN** the template SHALL instruct the AI to validate the provided change ID against `rasen list`
- **AND** use the provided change ID for archiving if valid
- **AND** fail fast if the provided change ID doesn't match an archivable change

#### Scenario: Archive command without argument (backward compatibility)
- **WHEN** a user invokes `/rasen-archive-change` without providing a change ID
- **THEN** the template SHALL instruct the AI to identify the change ID from context or by running `rasen list`
- **AND** proceed with the existing behavior (maintaining backward compatibility)

#### Scenario: OpenCode archive template generation
- **WHEN** generating the OpenCode archive slash command file
- **THEN** include the `$ARGUMENTS` placeholder in the frontmatter
- **AND** wrap it in a clear structure like `<ChangeId>\n  $ARGUMENTS\n</ChangeId>` to indicate the expected argument
- **AND** include validation steps in the template body to check if the change ID is valid

### Requirement: Update respects global profile config
The update command SHALL read global config and apply profile settings to the project.

#### Scenario: Update adds missing workflows from config
- **WHEN** user runs `rasen update`
- **AND** global config specifies workflows not currently installed in the project
- **THEN** the system SHALL generate skill files for missing workflows
- **THEN** the system SHALL display: "Added: <workflow-names>"

#### Scenario: Update refreshes existing workflows
- **WHEN** user runs `rasen update`
- **AND** workflows are already installed in the project
- **THEN** the system SHALL refresh those workflow files with latest templates
- **THEN** the system SHALL display: "Updated: <workflow-names>"

#### Scenario: Update with no changes needed
- **WHEN** user runs `rasen update`
- **AND** installed workflows match global config
- **AND** all templates are current
- **AND** no leftover rasen command files remain
- **THEN** the system SHALL display: "Already up to date."

#### Scenario: Profile or delivery drift with current templates
- **WHEN** user runs `rasen update`
- **AND** workflow templates are current for the installed skills
- **AND** project files do not match the current profile selection
- **THEN** the system SHALL treat this as an update-required state (not "Already up to date.")
- **THEN** the system SHALL add/remove files to match the current profile selection

#### Scenario: Update summary output
- **WHEN** update completes with changes
- **THEN** the system SHALL display a summary:
  - "Added: propose, explore" (new workflows installed)
  - "Updated: apply, archive" (existing workflows refreshed)
  - "Removed: 4 command files" (leftover rasen command files cleaned up)
- **THEN** the system SHALL list affected tools: "Tools: Claude Code, Cursor"

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

#### Scenario: Commands-only installation

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

### Requirement: One-time migration for existing users
The update command SHALL detect existing users (no `profile` in global config + existing workflows) and migrate them to `custom` profile before applying updates.

#### Scenario: First update after upgrade (existing user)
- **WHEN** user runs `rasen update`
- **AND** global config does not contain a `profile` field
- **AND** project has existing workflow files installed
- **THEN** the system SHALL scan installed workflows across all tool directories in the project
- **THEN** the system SHALL only match workflow names present in `ALL_WORKFLOWS` constant (ignoring user-created custom skills)
- **THEN** the system SHALL take the union of detected workflow names across all tools
- **THEN** the system SHALL write to global config: `profile: "custom"`, `workflows: [<detected>]` (no `delivery` key — the setting is retired)
- **THEN** the system SHALL display: "Migrated: custom profile with <count> workflows (<workflow-names>)"
- **THEN** the system SHALL display: "New in this version: the rasen-propose skill (combines new + ff). Try 'rasen config profile core' for the streamlined 4-workflow experience."
- **THEN** the system SHALL proceed with normal update logic (using the migrated config)
- **THEN** the result SHALL be template refresh only (no workflows added or removed)

#### Scenario: Migration with partial workflows (user manually removed some)
- **WHEN** user runs `rasen update`
- **AND** global config does not contain a `profile` field
- **AND** project has fewer than the original 10 workflows installed
- **THEN** the system SHALL migrate with only the workflows that are actually present
- **THEN** the migrated `workflows` array SHALL reflect the user's current state, not the original set

#### Scenario: Migration with multiple tools having different workflow sets
- **WHEN** user runs `rasen update`
- **AND** project has multiple tools configured (e.g., Claude Code, Cursor)
- **AND** different tools have different workflows installed
- **THEN** the system SHALL take the union of all detected workflows across all tools
- **THEN** the migrated `workflows` array SHALL include any workflow that exists in at least one tool

#### Scenario: No migration needed (profile already set)
- **WHEN** user runs `rasen update`
- **AND** global config already contains a `profile` field
- **THEN** the system SHALL NOT perform migration
- **THEN** the system SHALL proceed with normal update logic using existing config

#### Scenario: No migration needed (no existing workflows)
- **WHEN** user runs `rasen update`
- **AND** global config does not contain a `profile` field
- **AND** project has no existing workflow files
- **THEN** the system SHALL NOT perform migration
- **THEN** the system SHALL use `core` profile defaults

#### Scenario: Migration is idempotent
- **WHEN** user runs `rasen update` multiple times
- **THEN** migration SHALL only occur on the first run (when `profile` field is absent)
- **THEN** subsequent runs SHALL use the existing global config without re-scanning

#### Scenario: Non-interactive migration
- **WHEN** user runs `rasen update` non-interactively (e.g., in CI)
- **AND** migration is triggered
- **THEN** the system SHALL perform migration without prompting
- **THEN** the system SHALL display the migration summary to stdout

### Requirement: Update detects new tool directories
The update command SHALL notify the user if new **adapted** AI tool directories are detected that aren't currently configured. It SHALL NOT nudge the user to add an unadapted tool, since the installer will refuse it.

#### Scenario: New adapted tool directory detected
- **WHEN** user runs `rasen update`
- **AND** a new adapted tool directory is detected (e.g., `.codex/` exists but Codex is not configured)
- **THEN** the system SHALL display: "Detected new tool: Codex. Run 'rasen init' to add it."
- **THEN** the system SHALL NOT automatically add the new tool
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: New unadapted tool directory is not nudged
- **WHEN** user runs `rasen update`
- **AND** a new tool directory for an unadapted tool is detected (e.g., `.windsurf/` exists but Windsurf is not configured)
- **THEN** the system SHALL NOT display a "Detected new tool" message for that tool
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: Multiple new adapted tool directories detected
- **WHEN** user runs `rasen update`
- **AND** multiple new adapted tool directories are detected
- **THEN** the system SHALL display one consolidated message listing the detected adapted tools, for example: "Detected new tools: Claude Code, Codex. Run 'rasen init' to add them."
- **THEN** the system SHALL NOT automatically add any new tools
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: No new adapted tool directories
- **WHEN** user runs `rasen update`
- **AND** no new adapted tool directories are detected
- **THEN** the system SHALL NOT display any tool detection message

### Requirement: Update requires an OpenSpec project
The update command SHALL only run inside an initialized rasen project.

#### Scenario: Update outside a project
- **WHEN** user runs `rasen update`
- **AND** no `rasen/` directory exists in the current working directory
- **AND** no legacy `openspec/` directory exists either
- **THEN** the system SHALL display: "No rasen project found. Run 'rasen init' to set up."
- **THEN** the system SHALL exit with code 1

#### Scenario: Update in a legacy-only project
- **WHEN** user runs `rasen update`
- **AND** no `rasen/` directory exists but a legacy `openspec/` directory does
- **THEN** the system SHALL point the user to `rasen migrate` (copy-only) or `rasen init`
- **THEN** the system SHALL exit with code 1 without modifying anything

### Requirement: Update refreshes only rasen-namespace artifacts

The update command SHALL refresh command files under rasen-namespace paths (e.g., `.claude/commands/rasen/`, `rasen-<id>.md` variants) and skill directories under `rasen-*` names. Legacy-namespace files (`opsx` command paths, `openspec-*` skill directories) SHALL NOT be refreshed, rewritten, or deleted by update; when detected, update SHALL print a one-time notice that they may belong to upstream OpenSpec or an older rasen install.

#### Scenario: Rasen artifacts refreshed

- **WHEN** `rasen update` runs in a project with `.claude/commands/rasen/` command files and `rasen-*` skill directories
- **THEN** those files are refreshed from the current templates

#### Scenario: Legacy artifacts left untouched

- **WHEN** `rasen update` runs in a project that also contains `.claude/commands/opsx/` files or `openspec-*` skill directories
- **THEN** those files and directories are not modified or deleted
- **AND** the output includes a notice explaining they may belong to upstream OpenSpec and how to remove them manually if they came from an older rasen install

### Requirement: Extra workflows synchronized to active profile
The update command SHALL remove workflow files that are no longer selected in the current profile.

#### Scenario: Deselected workflows from previous profile
- **WHEN** user runs `rasen update`
- **AND** project has workflows not in current profile (e.g., user switched from custom to core or deselected workflows via `rasen config profile`)
- **THEN** the system SHALL delete the skill workflow files for deselected workflows
- **THEN** the system SHALL keep only workflows currently selected in profile

#### Scenario: Delivery change with extra workflows
- **WHEN** user runs `rasen update`
- **AND** project has extra workflows not in current profile
- **THEN** the system SHALL delete files for those extra workflows as part of the same deselection cleanup (the retired `delivery` axis no longer distinguishes which files this affects — skills are the only delivery surface)

### Requirement: Update installs and prunes experts by profile
The update command SHALL bring a project's installed experts into line with the resolved profile plus dependency closure: it SHALL install experts named by the profile or required by a selected workflow, and it SHALL remove an installed built-in expert only when that expert is neither in the resolved profile's expert set nor required by any selected workflow.

#### Scenario: Missing profile expert is installed
- **WHEN** user runs `rasen update`
- **AND** the resolved profile names an expert that is not installed in the project
- **THEN** the system SHALL install that expert's skill files

#### Scenario: Unreferenced deselected expert is removed
- **WHEN** user runs `rasen update`
- **AND** an installed built-in expert is neither in the resolved profile's expert set nor required by any selected workflow
- **AND** the install has explicit expert selection
- **THEN** the system SHALL remove that expert's skill directory

#### Scenario: Referenced expert is never removed
- **WHEN** user runs `rasen update`
- **AND** an installed expert is required by a selected workflow's `requires.skills`
- **THEN** the system SHALL retain that expert even when the active profile does not name it

### Requirement: One-time non-regressive expert migration
When an install predates expert selection, the update command SHALL preserve every installed built-in expert and SHALL explain, once, that experts are now selectable. It SHALL NOT remove any expert until the user has explicitly re-selected experts.

#### Scenario: Legacy install keeps all experts with a one-time notice
- **WHEN** user runs `rasen update` on a project whose config has no explicit expert selection
- **THEN** every built-in expert SHALL remain installed regardless of the active profile
- **AND** the system SHALL display a one-time notice that experts are now selectable via `rasen profile`
- **AND** no expert skill directory SHALL be removed by that run

#### Scenario: Notice does not repeat after explicit selection
- **WHEN** the user has re-selected experts through the profile picker
- **AND** user runs `rasen update`
- **THEN** the profile-default plus closure expert set SHALL govern
- **AND** the one-time experts-now-selectable notice SHALL NOT be shown again

### Requirement: Update tolerates retired workflow ids in stored profile config

When `rasen update` reads a stored `custom` profile selection from global config that lists a workflow id no longer present in the catalog (such as a retired `ff`), the command SHALL drop the unknown id with a warning and continue, rather than aborting. The remaining known workflows SHALL be updated normally.

#### Scenario: Update with a stale retired id in custom profile

- **WHEN** user runs `rasen update`
- **AND** the global config `custom` profile selection still lists a retired id such as `ff`
- **THEN** the system SHALL drop the unknown id and emit a warning naming it
- **AND** the system SHALL update the remaining selected workflows without error

#### Scenario: Retired ff install healed on update

- **WHEN** user runs `rasen update`
- **AND** a configured tool still has an installed `rasen-ff-change` skill directory or `ff` command file from a prior install
- **THEN** the retired skill directory and command file SHALL be removed
- **AND** this SHALL occur even when no other update is required

### Requirement: Refreshed skill files are re-stamped with the generating CLI version

Every skill file regenerated by `rasen update` SHALL record the CLI version that generated it, matching the same stamp `rasen init` writes, so version-mismatch detection reflects the state of skills as of the most recent `init` or `update`, whichever ran last.

#### Scenario: Update re-stamps refreshed skills

- **WHEN** `rasen update` regenerates a skill file
- **THEN** the regenerated file SHALL record the CLI's current version (read from the package's own version, never a hand-set or user-editable value)

#### Scenario: Skipped tools keep their prior stamp

- **WHEN** `rasen update` determines a tool is already up to date and skips regenerating its files
- **THEN** that tool's skill files SHALL retain whatever stamp they already carried, unchanged

### Requirement: Newly-available built-in workflows are surfaced, not silently dropped

When `rasen update` resolves the desired workflow set from a frozen selection — a `custom` profile or a project-scope workflow override, whose stored list is a snapshot of the catalog as it was when the user last chose — and the current catalog contains a built-in workflow that was added after that selection was saved and is therefore not in the resolved set, the command SHALL surface that workflow to the user and point them to `rasen profile` to add it. The command SHALL NOT modify the stored selection to absorb the workflow; the selection remains exactly what the user chose. A `full` or `core` profile, which resolves against the live catalog and already includes every built-in workflow, SHALL NOT produce this note.

The command SHALL distinguish a genuinely new workflow from one the user deliberately deselected, so a deliberate omission is not re-surfaced on every update: only a built-in workflow that was not known when the selection was last saved SHALL be surfaced. On a stored selection that predates this behavior, the first `update` SHALL record the currently-known built-in workflows without surfacing any note, so no pre-existing omission is surprised onto the user; only a workflow added after that point SHALL be surfaced thereafter.

#### Scenario: New built-in workflow surfaced for a custom profile
- **WHEN** the global profile is `custom`, the stored selection was saved when the catalog did not contain a built-in workflow such as `audit`, and the current catalog contains it
- **THEN** `rasen update` SHALL display a note that the new built-in workflow is available and SHALL direct the user to `rasen profile` to add it
- **AND** the stored `custom` selection SHALL remain unchanged
- **AND** the new workflow's skill directory SHALL NOT be installed until the user selects it

#### Scenario: Deliberately deselected workflow is not re-surfaced
- **WHEN** a `custom` selection omits a built-in workflow that was already known when the selection was saved
- **THEN** `rasen update` SHALL NOT surface that workflow as newly available

#### Scenario: Full profile picks up new built-ins without a note
- **WHEN** the profile is `full` and the catalog gains a new built-in workflow
- **THEN** `rasen update` SHALL install that workflow as part of the resolved set
- **AND** SHALL NOT display the newly-available note

#### Scenario: Pre-existing selection is not surprised on first update
- **WHEN** a stored `custom` selection predates this behavior and omits one or more built-in workflows the catalog already contains
- **THEN** the first `rasen update` after upgrade SHALL record the currently-known built-in workflows and SHALL NOT surface any of those omissions
- **AND** a built-in workflow added to the catalog after that point SHALL be surfaced on a later `update`

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

### Requirement: Update performs a store-identity migration pass

After completing the tool and version propagation and the multi-project update offer, `rasen update` SHALL perform a machine-wide store-identity migration pass that mints permanent identities for eligible registered Stores that lack one, backfills the uid into every affected project's `storeMemberships` hints, and re-keys the machine Store registry by permanent identity when every Store entry carries one.

The migration pass SHALL be best-effort: a failure at any stage SHALL emit a warning naming the problem and direct the user to `rasen store upgrade-identity --all --apply`, and SHALL NOT abort the update. A Store whose path is missing, whose metadata is unreadable, or that is locked SHALL be skipped with a reason; the batch SHALL continue with the remaining Stores.

The pass SHALL run once per top-level `rasen update` invocation. It SHALL NOT run when `--only-this` is supplied, consistent with the multi-project offer gate.

The migration SHALL respect rasen's git discipline: Store metadata and project configuration files SHALL be written to disk but never committed; the summary SHALL name the files to commit per repository.

#### Scenario: Update migrates identityless Stores

- **WHEN** a user runs `rasen update` and one or more registered Stores lack a permanent identity
- **AND** those Stores have reachable paths with readable metadata
- **THEN** the update command mints permanent identities for those Stores
- **AND** backfills the uid into every registered project whose `storeMemberships` names those Stores by alias
- **AND** reports the outcome in the update summary
- **AND** suggests the files to commit per repository

#### Scenario: Warning is silent after update

- **WHEN** `rasen update` has completed the store-identity migration
- **THEN** a subsequent command that parses a project configuration whose `storeMemberships` was backfilled SHALL NOT emit the `storeMembershipsWithoutIdentity` warning

#### Scenario: Unresolvable Store is reported, not fatal

- **WHEN** `rasen update` encounters a registered Store whose path does not exist
- **THEN** the Store is skipped with a reason in the migration summary
- **AND** the remaining Stores are still upgraded
- **AND** the machine registry re-key reports the unresolvable Store as blocking
- **AND** the update completes successfully

#### Scenario: `--only-this` skips the migration

- **WHEN** a user runs `rasen update --only-this`
- **THEN** the store-identity migration pass SHALL NOT run
- **AND** no Store metadata or project `storeMemberships` hints are modified by the migration

#### Scenario: All Stores already identified

- **WHEN** `rasen update` runs and every registered Store already carries a permanent identity
- **THEN** the migration pass reports that no migration was needed
- **AND** no Store metadata or project configuration is modified

#### Scenario: Migration failure does not abort update

- **WHEN** the store-identity migration throws an unrecoverable error
- **THEN** the update command emits a warning directing the user to `rasen store upgrade-identity --all --apply`
- **AND** the update command completes successfully (the skill files are already refreshed on disk)

#### Scenario: Suggested commits, never auto-commit

- **WHEN** the migration writes Store metadata and project configuration files
- **THEN** the update summary names each repository and the files to commit
- **AND** no `git add` or `git commit` is executed by the update command
