# profiles Specification

## Purpose
Define installation profiles (with a delivery dimension independent of profile), including reusable machine-global named snapshots, selectable from the top-level profile command and applied through the update command.

## Requirements
### Requirement: Profile definitions
The system SHALL support built-in `full` and `core` profiles, the current `custom` workflow selection, and reusable user-named profile snapshots.

#### Scenario: Full profile contents
- **WHEN** profile is set to `full`
- **THEN** the profile SHALL include every workflow in `ALL_WORKFLOWS`

#### Scenario: Core profile contents
- **WHEN** profile is set to `core`
- **THEN** the profile SHALL include workflows: `propose`, `explore`, `apply`, `sync`, `archive`, `auto-command`, `help`

#### Scenario: Custom profile contents
- **WHEN** profile is set to `custom`
- **THEN** the profile SHALL include only the workflows specified in global config `workflows` array

### Requirement: Delivery is independent of profile
The delivery setting SHALL control HOW workflows are installed, separate from WHICH workflows are installed. Skills are the always-installed foundation (orchestration workflows invoke worker skills at runtime); commands are an optional addition.

#### Scenario: Delivery options
- **WHEN** configuring delivery
- **THEN** the system SHALL support two options: `both` (skills and commands), `skills` (skill files only)

#### Scenario: Both delivery
- **WHEN** delivery is set to `both`
- **THEN** the system SHALL install both skill files and command files for each workflow

#### Scenario: Skills-only delivery
- **WHEN** delivery is set to `skills`
- **THEN** the system SHALL install only skill files for each workflow
- **THEN** the system SHALL NOT install command files

#### Scenario: Skills are always installed
- **WHEN** workflows are installed under any delivery setting
- **THEN** skill files for the selected workflows SHALL be installed
- **AND** no delivery setting SHALL cause an installed skill directory to be removed

#### Scenario: Core profile with custom delivery
- **WHEN** profile is set to `core`
- **AND** delivery is set to `skills`
- **THEN** the system SHALL install core workflows as skills only (no commands)

#### Scenario: Delivery defaults
- **WHEN** delivery is not set in global config
- **THEN** the system SHALL default to `both`

### Requirement: Legacy delivery values migrate gracefully
Configurations written before the delivery consolidation may contain the retired values `commands`, `commands-first`, or `skills-first`. The system SHALL keep working with such a config: the value is silently mapped to its consolidated equivalent, a one-time notice explains the consolidation, and the config file is updated to the new value. An old delivery value SHALL never cause a command to fail.

#### Scenario: skills-first maps to skills
- **WHEN** the global config contains `delivery: "skills-first"` and any command reads the config
- **THEN** the effective delivery SHALL be `skills`
- **AND** a notice SHALL state that `skills-first` has been consolidated into `skills`

#### Scenario: commands maps to both
- **WHEN** the global config contains `delivery: "commands"` and any command reads the config
- **THEN** the effective delivery SHALL be `both`
- **AND** a notice SHALL state that `commands` has been consolidated into `both` (skills are always installed)

#### Scenario: commands-first maps to both
- **WHEN** the global config contains `delivery: "commands-first"` and any command reads the config
- **THEN** the effective delivery SHALL be `both`
- **AND** a notice SHALL state that `commands-first` has been consolidated into `both` (skills are always installed)

#### Scenario: Notice appears only once
- **WHEN** a legacy delivery value is mapped
- **THEN** the config file SHALL be rewritten with the consolidated value
- **AND** subsequent runs SHALL read the consolidated value and print no further notice

#### Scenario: Unrecognized delivery value falls back to default
- **WHEN** the global config contains a delivery value that is neither a current value (`both`, `skills`) nor a retired value (`commands`, `commands-first`, `skills-first`)
- **THEN** the system SHALL behave as if delivery were the default (`both`)
- **AND** SHALL NOT rewrite the config file for the unrecognized value
- **AND** SHALL NOT fail

### Requirement: Profile configuration via interactive picker
The system SHALL provide an interactive picker for configuring profiles.

#### Scenario: Interactive profile configuration
- **WHEN** user runs `rasen profile`
- **THEN** the system SHALL display an interactive picker with:
  - Delivery selection: `both`, `skills`
  - Workflow toggles for all available workflows
- **THEN** the system SHALL pre-select current config values
- **THEN** on confirmation, the system SHALL update global config
- **THEN** the system SHALL set profile to `custom` if selected workflows differ from core defaults
- **THEN** the system SHALL set profile to `core` if selected workflows match core defaults exactly (propose, explore, apply, archive), regardless of delivery setting
- **THEN** the system SHALL NOT modify any project files
- **THEN** the system SHALL display: "Config updated. Run `rasen update` in your projects to apply."

#### Scenario: Toggle all workflows from the keyboard
- **WHEN** the workflow picker is active and at least one workflow is not selected
- **AND** the user presses `A`
- **THEN** the system SHALL select all workflows
- **WHEN** all workflows are selected and the user presses `A` again
- **THEN** the system SHALL clear all workflow selections
- **AND** the picker instructions SHALL advertise the `A` shortcut

#### Scenario: Localized workflow picker
- **WHEN** the user's resolved CLI locale is Japanese
- **THEN** delivery choices, built-in workflow names and descriptions, picker prompts, and picker instructions SHALL be displayed in Japanese
- **AND** every workflow in `ALL_WORKFLOWS` SHALL have a specific name and description rather than a workflow-ID fallback
- **AND** each workflow row SHALL show its stable public workflow id before the localized name
- **AND** the separator between id and localized name SHALL be aligned using the longest public workflow id
- **AND** internal `-command` suffixes SHALL be removed from the displayed id while the stored workflow value remains unchanged
- **AND** user-workflow source labels and dependency messages SHALL be displayed in Japanese
- **AND** the localized user-workflow source label SHALL remain visible when the resolved width can contain the complete label
- **AND** user-authored workflow names and descriptions SHALL remain in their original language
- **WHEN** the resolved locale is English or unsupported
- **THEN** Rasen-owned picker elements SHALL be displayed in English
- **AND** user-authored workflow names and descriptions SHALL remain in their original language
- **AND** every other interactive profile prompt, result, and command description SHALL use the same resolved locale

#### Scenario: Long workflow descriptions are bounded in the picker
- **WHEN** the picker opens and an active built-in or user-authored workflow description would occupy more than two lines at the resolved output-terminal width
- **THEN** the picker SHALL render at most two visual lines for the description at that width snapshot
- **AND** the second line SHALL end with ASCII `...` when at least three display columns are available and content is omitted
- **AND** a narrower terminal SHALL use as many `.` characters as can fit
- **AND** wrapping and truncation SHALL use terminal display columns rather than UTF-16 code units or UTF-8 bytes
- **AND** fullwidth CJK characters, emoji sequences, and combining sequences SHALL NOT be split in the middle of a grapheme cluster
- **AND** the persisted workflow definition, package content, JSON output, and generated skill or command content SHALL remain unmodified

#### Scenario: Persisted CLI language
- **WHEN** the user sets global config `language` to `en` or `ja`
- **THEN** the selection SHALL be persisted in the machine-global JSON config
- **AND** interactive prompts, profile and config output, CLI help, and shell-completion descriptions and management messages SHALL use that language
- **WHEN** `language` is `auto`
- **THEN** Unix-like systems SHALL inspect `LC_ALL`, `LC_MESSAGES`, then `LANG`, falling back to the system locale
- **AND** Windows SHALL use the system locale reported by the runtime
- **AND** unsupported locales SHALL fall back to English
- **AND** a valid `RASEN_LANG=en|ja` SHALL temporarily override the persisted setting

#### Scenario: JSON locale catalogs
- **WHEN** maintainers add or update translated CLI text
- **THEN** English and Japanese translations SHALL be stored in `src/locales/en.json` and `src/locales/ja.json`
- **AND** both catalogs SHALL expose the same keys and interpolation placeholders
- **AND** every workflow in `ALL_WORKFLOWS` SHALL have a non-empty name and description in both catalogs
- **AND** the build SHALL copy both catalogs to `dist/locales/` for inclusion in the published package

#### Scenario: Core preset shortcut
- **WHEN** user runs `rasen profile use core`
- **THEN** the system SHALL set profile to `core`
- **THEN** the system SHALL set workflows to the current `CORE_WORKFLOWS`
- **THEN** the system SHALL NOT change the delivery setting (preserves user preference)
- **THEN** the system SHALL NOT modify any project files
- **THEN** the system SHALL display: "Config updated. Run `rasen update` in your projects to apply."
- **THEN** the new profile takes effect on the next `rasen init` or `rasen update` run

#### Scenario: Config profile run inside a project
- **WHEN** user runs `rasen profile` inside a Rasen project directory
- **THEN** after updating global config, the system SHALL prompt: "Apply to this project now? (y/n)"
- **WHEN** user confirms
- **THEN** the system SHALL run `rasen update` automatically
- **THEN** the system SHALL still display: "Run `rasen update` in your other projects to apply."

#### Scenario: Config profile - user declines apply
- **WHEN** user runs `rasen profile` inside a Rasen project directory
- **AND** user declines the "Apply to this project now?" prompt
- **THEN** the system SHALL display: "Config updated. Run `rasen update` in your projects to apply."
- **THEN** the system SHALL exit successfully without modifying project files

#### Scenario: Config profile non-interactive
- **WHEN** user runs `rasen profile` non-interactively (e.g., in CI, no TTY)
- **THEN** the system SHALL display an error directing the user to `rasen profile use <name>` or non-interactive config
- **THEN** the system SHALL exit with code 1

### Requirement: Profile settings stored in global config
Current profile and delivery settings SHALL be stored in the existing global config file under the resolved machine home alongside telemetry and feature flags.

#### Scenario: Config schema
- **WHEN** reading profile configuration
- **THEN** the config SHALL contain `profile` (full|core|custom), `delivery` (both|skills), `language` (auto|en|ja), and optionally `workflows` (array of workflow names)

#### Scenario: Schema evolution
- **WHEN** loading config without profile/delivery fields
- **THEN** the system SHALL use defaults (profile=core, delivery=both)
- **AND** existing config fields (telemetry, featureFlags) SHALL be preserved

#### Scenario: Config list displays profile settings
- **WHEN** user runs `rasen config list`
- **THEN** the system SHALL display profile, delivery, and workflows settings
- **AND** SHALL indicate which values are defaults vs explicitly set

### Requirement: Config is global, projects are explicit
Config changes SHALL NOT automatically propagate to projects.

#### Scenario: Config update does not modify projects
- **WHEN** user updates config via `rasen profile`
- **THEN** the system SHALL only update global config (`~/.config/rasen/config.json`)
- **THEN** the system SHALL NOT modify any project skill/command files
- **THEN** existing projects retain their current workflow files until user runs `rasen update`

### Requirement: Config changes applied via update command
The existing `rasen update` command SHALL apply the current global config to a project. See `specs/cli-update/spec.md` for detailed update behavior.

#### Scenario: Config changes require explicit project sync
- **WHEN** user updates profile or delivery via `rasen profile`
- **THEN** the global config SHALL be updated immediately
- **AND** project files SHALL remain unchanged until `rasen update` is run for that project

### Requirement: Named profile management

The system SHALL expose reusable profile snapshots through the top-level `rasen profile` command group.

#### Scenario: Create a named profile
- **WHEN** user runs `rasen profile new [name]` in an interactive terminal
- **THEN** the system SHALL validate or prompt for a portable profile name
- **AND** SHALL prompt for delivery and workflows using current settings as defaults
- **AND** SHALL save the definition under the machine-global `profiles` directory
- **AND** SHALL apply the new definition to current global config after confirmation

#### Scenario: Retry an unavailable prompted profile name
- **WHEN** user runs `rasen profile new` without a name
- **AND** enters an invalid, reserved, or existing profile name
- **THEN** the name prompt SHALL display the reason and remain open for another value
- **AND** cancelling the open prompt SHALL report that the profile command was cancelled

#### Scenario: Reject an unavailable explicit profile name
- **WHEN** user runs `rasen profile new <name>` with an invalid, reserved, or existing name
- **THEN** the command SHALL fail before prompting for delivery or workflows
- **AND** SHALL display the reason

#### Scenario: Use a named profile
- **WHEN** user runs `rasen profile use <name>`
- **THEN** the system SHALL copy that definition's delivery and workflows into current global config
- **AND** SHALL classify the current selection as `full`, `core`, or `custom`
- **AND** SHALL instruct the user to run `rasen update` in projects

#### Scenario: Select a profile interactively
- **WHEN** user runs `rasen profile use` without a name in a TTY
- **THEN** the system SHALL offer built-in and valid saved profiles
- **WHEN** the same command runs outside a TTY
- **THEN** the command SHALL fail and require an explicit name

#### Scenario: List profiles for humans or automation
- **WHEN** user runs `rasen profile list`
- **THEN** the system SHALL list built-in and saved profiles with delivery and workflow count
- **WHEN** user adds `--json`
- **THEN** the system SHALL emit structured JSON including whether each profile matches current settings

#### Scenario: Delete a saved profile
- **WHEN** user runs `rasen profile delete [name]`
- **THEN** the system SHALL require confirmation unless `--yes` is provided
- **AND** SHALL never delete built-in profiles
- **AND** SHALL leave current global settings unchanged

### Requirement: Named profile storage and validation

User-named profiles SHALL be stored as versioned YAML definitions under `<global-config-dir>/profiles/<name>.yaml` and SHALL contain only `version`, `delivery`, and `workflows`.

#### Scenario: Validate names and content before saving
- **WHEN** a profile is created or imported
- **THEN** its name SHALL be a lowercase portable slug of at most 64 characters
- **AND** `full`, `core`, and `custom` SHALL be reserved
- **AND** delivery SHALL be `both` or `skills`
- **AND** every workflow SHALL be a unique current `ALL_WORKFLOWS` ID
- **AND** unsupported versions, unknown workflows, duplicate workflows, and unknown fields SHALL fail without modifying an existing definition

#### Scenario: Saved profile is a snapshot
- **WHEN** user applies a named profile and later edits current settings with `rasen profile`
- **THEN** the saved definition SHALL remain unchanged

### Requirement: Profile import and export

The system SHALL exchange profile definitions as versioned YAML or JSON without embedding the local profile name.

#### Scenario: Import a profile
- **WHEN** user runs `rasen profile import <path>` for a `.yaml`, `.yml`, or `.json` file
- **THEN** the name SHALL be derived from the file basename
- **AND** the complete definition SHALL be validated before writing normalized YAML
- **AND** an existing name SHALL only be replaced with `--force`
- **AND** current global settings SHALL remain unchanged

#### Scenario: Export current settings
- **WHEN** user runs `rasen profile export <path>`
- **THEN** the current delivery and workflows SHALL be exported

#### Scenario: Export a selected profile
- **WHEN** user runs `rasen profile export <path> --profile <name>`
- **THEN** that built-in or saved profile SHALL be exported
- **AND** `.json` destinations SHALL use JSON while other destinations use YAML

#### Scenario: Protect an existing export
- **WHEN** the destination exists in a TTY and `--force` is absent
- **THEN** the system SHALL ask before overwriting
- **WHEN** the destination exists outside a TTY and `--force` is absent
- **THEN** the system SHALL fail without changing the destination

### Requirement: Config profile compatibility

The previous `rasen config profile [preset]` entry point SHALL remain compatible while `rasen profile` is the canonical command.

#### Scenario: Compatibility editor
- **WHEN** user runs `rasen config profile`
- **THEN** the system SHALL run the same current-profile editor as `rasen profile`

#### Scenario: Compatibility preset
- **WHEN** user runs `rasen config profile full` or `rasen config profile core`
- **THEN** the system SHALL behave like `rasen profile use full` or `rasen profile use core`

### Requirement: Profile defaults
The system SHALL use `core` as the default profile for new users, while preserving existing users' workflows via migration.

#### Scenario: No global config exists (new user)
- **WHEN** global config file does not exist
- **AND** no existing workflows are installed in the project
- **THEN** the system SHALL behave as if profile is `core`

#### Scenario: Global config exists but profile field absent (new user)
- **WHEN** global config file exists but does not contain a `profile` field
- **AND** no existing workflows are installed in the project
- **THEN** the system SHALL behave as if profile is `core`

#### Scenario: Profile field absent with existing workflows (existing user migration)
- **WHEN** global config does not contain a `profile` field
- **AND** the `update` command detects existing workflow files in the project
- **THEN** the system SHALL perform one-time migration (see `specs/cli-update/spec.md` for details)
- **THEN** the system SHALL set profile to `custom` with the detected workflows
- **THEN** the system SHALL NOT add or remove any workflow files during migration
