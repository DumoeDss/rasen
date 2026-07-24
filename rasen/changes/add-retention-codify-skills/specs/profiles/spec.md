## MODIFIED Requirements

### Requirement: Profile definitions

The system SHALL support built-in `full` and `core` profiles, the current `custom` selection, and reusable user-named profile snapshots. Each profile SHALL resolve to a workflow set, an expert set, and exactly one retention mode: `off`, `report`, or `codify`. Current and named profile definitions containing the retention dimension SHALL use profile-definition version 2. Experts remain catalog units selectable within a profile like workflows; learned skills SHALL NOT be profile IDs or selectable profile members.

#### Scenario: Full profile contents
- **WHEN** profile is set to `full`
- **THEN** the profile SHALL include every selectable workflow in `ALL_WORKFLOWS`
- **AND** the profile SHALL include every built-in expert
- **AND** the profile retention mode SHALL be `report`

#### Scenario: Core profile contents
- **WHEN** profile is set to `core`
- **THEN** the profile SHALL include workflows: `propose`, `explore`, `apply`, `sync`, `archive`, `auto-command`, `help`
- **AND** the profile SHALL include the quality-floor experts: `review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`
- **AND** the profile retention mode SHALL be `off`

#### Scenario: Custom profile contents
- **WHEN** profile is set to `custom`
- **THEN** the profile SHALL include only the workflows and experts specified in the global config `workflows` array
- **AND** experts required by a selected workflow's dependency closure SHALL additionally be installed even when the array omits them
- **AND** the profile SHALL use the single persisted `retention` value

#### Scenario: Built-in classification includes retention
- **WHEN** the current selection is classified as `full`, `core`, or `custom`
- **THEN** it SHALL match a built-in profile only when both the workflow and expert selection and the retention mode equal that built-in profile's version 2 definition
- **AND** a selection with built-in workflow membership but a different retention mode SHALL be classified as `custom`

#### Scenario: Learned skills and the retention runner are not profile choices
- **WHEN** project or global learned skills exist or the internal `retain-command` runner is installed by dependency closure
- **THEN** learned-skill identities and `retain-command` SHALL NOT be offered as independent workflow or expert choices
- **AND** the retention radio SHALL remain the only profile control for `off`, `report`, or `codify`

### Requirement: Profile configuration via interactive picker

The system SHALL provide an interactive picker for configuring profiles. Workflow and expert membership SHALL use toggles, while retention SHALL use one radio choice whose values are `off`, `report`, and `codify`; report and codify SHALL never be independently toggleable or simultaneously selected.

#### Scenario: Interactive profile configuration
- **WHEN** user runs `rasen profile`
- **THEN** the system SHALL display an interactive picker with:
  - Workflow toggles for all available workflows
  - Expert toggles for all available built-in experts
  - One retention radio choice for `off`, `report`, or `codify`
- **THEN** the system SHALL pre-select current config values
- **THEN** on confirmation, the system SHALL update global config with exactly one retention value
- **THEN** the system SHALL classify the selection as `full` or `core` only when the complete version 2 definition matches that built-in, and as `custom` otherwise
- **THEN** the system SHALL NOT modify any project files
- **THEN** the system SHALL display: "Config updated. Run `rasen update` in your projects to apply."

#### Scenario: Retention picker is mutually exclusive
- **WHEN** the current, new, or named-profile update picker displays retention choices
- **THEN** `off`, `report`, and `codify` SHALL be rendered as one radio selection
- **AND** selecting one value SHALL deselect the other two
- **AND** no confirmed profile SHALL contain both report and codify

#### Scenario: New and updated named profiles use the radio choice
- **WHEN** user runs `rasen profile new [name]` or `rasen profile update [name]` in an interactive terminal
- **THEN** the same single retention radio choice SHALL be shown with the source definition's current value pre-selected
- **AND** the confirmed named profile SHALL persist exactly one retention value

#### Scenario: Toggle all workflows from the keyboard
- **WHEN** the workflow picker is active and at least one workflow is not selected
- **AND** the user presses `A`
- **THEN** the system SHALL select all workflows
- **WHEN** all workflows are selected and the user presses `A` again
- **THEN** the system SHALL clear all workflow selections
- **AND** the picker instructions SHALL advertise the `A` shortcut
- **AND** the retention radio selection SHALL remain unchanged

#### Scenario: Localized workflow picker
- **WHEN** the user's resolved CLI locale is Japanese or Simplified Chinese
- **THEN** built-in workflow names and descriptions, picker prompts, picker instructions, and retention labels SHALL be displayed in the resolved locale
- **AND** every workflow in `ALL_WORKFLOWS` SHALL have a specific name and description rather than a workflow-ID fallback
- **AND** each workflow row SHALL show its stable public workflow id before the localized name
- **AND** the separator between id and localized name SHALL be aligned using the longest public workflow id
- **AND** internal `-command` suffixes SHALL be removed from the displayed id while the stored workflow value remains unchanged
- **AND** user-workflow source labels and dependency messages SHALL be displayed in the resolved locale
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
- **AND** the persisted workflow definition, package content, JSON output, and generated skill content SHALL remain unmodified

#### Scenario: Persisted CLI language
- **WHEN** the user sets global config `language` to `en`, `ja`, or `zh-cn`
- **THEN** the selection SHALL be persisted exactly in the machine-global JSON config
- **AND** interactive prompts, profile and config output, CLI help, and shell-completion descriptions and management messages SHALL use that language
- **WHEN** `language` is `auto`
- **THEN** Unix-like systems SHALL inspect `LC_ALL`, `LC_MESSAGES`, then `LANG`, falling back to the system locale
- **AND** Windows SHALL use the system locale reported by the runtime rather than Unix shell locale variables
- **AND** `zh-CN`, `zh_CN.UTF-8`, `zh-SG`, `zh-Hans`, and bare `zh` SHALL resolve to `zh-cn`
- **AND** `zh-TW`, `zh-HK`, `zh-MO`, and `zh-Hant` SHALL remain unsupported and fall back to English
- **AND** all other unsupported locales SHALL fall back to English
- **AND** a valid `RASEN_LANG=en|ja|zh-cn` SHALL temporarily override the persisted setting
- **AND** an invalid `RASEN_LANG` SHALL be ignored so persisted or automatic resolution can continue

#### Scenario: JSON locale catalogs
- **WHEN** maintainers add or update translated CLI text
- **THEN** English, Japanese, and Simplified Chinese translations SHALL be stored in `src/locales/en.json`, `src/locales/ja.json`, and `src/locales/zh-cn.json`
- **AND** all three catalogs SHALL expose the same keys and interpolation placeholders
- **AND** every workflow in `ALL_WORKFLOWS` SHALL have a non-empty name and description in all three catalogs
- **AND** every built-in expert and every Rasen-owned command and option description SHALL have a non-empty entry in all three catalogs
- **AND** the build SHALL copy all three catalogs to `dist/locales/` for inclusion in the published package

#### Scenario: Core preset shortcut
- **WHEN** user runs `rasen profile use core`
- **THEN** the system SHALL set profile to `core`
- **THEN** the system SHALL set workflows to the current `CORE_WORKFLOWS`
- **THEN** the system SHALL set retention to `off`
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

Current profile settings SHALL be stored in the existing global config file under the resolved machine home alongside telemetry and feature flags. The version 2 current profile state SHALL include exactly one `retention` value in addition to workflow and expert selection.

#### Scenario: Config schema
- **WHEN** reading version 2 profile configuration
- **THEN** the config SHALL contain `profile` (full|core|custom), `retention` (off|report|codify), `language` (auto|en|ja|zh-cn), and optionally `workflows` (array of workflow names)
- **AND** persisted language values SHALL accept only the exact canonical enum values and SHALL NOT normalize aliases such as `zh-CN` or `zh_CN`
- **AND** persisted retention values SHALL accept only the exact canonical enum values

#### Scenario: Schema evolution
- **WHEN** loading config without a profile field
- **THEN** the system SHALL use the default (profile=core, retention=off)
- **AND** existing config fields (telemetry, featureFlags) SHALL be preserved

#### Scenario: Config list displays profile settings
- **WHEN** user runs `rasen config list`
- **THEN** the system SHALL display profile, workflows, and retention settings
- **AND** SHALL indicate which values are defaults vs explicitly set

#### Scenario: Current v1 selection containing retro migrates to report
- **WHEN** current profile settings have no `retention` field and their resolved v1 workflow selection contains `retro-command`
- **THEN** the effective version 2 selection SHALL remove `retro-command` from workflows and set retention to `report`
- **AND** the next successful profile write SHALL persist the normalized selection

#### Scenario: Current v1 selection without retro migrates to off
- **WHEN** current profile settings have no `retention` field and their resolved v1 workflow selection does not contain `retro-command`
- **THEN** the effective version 2 selection SHALL keep the remaining workflow and expert selection and set retention to `off`
- **AND** the next successful profile write SHALL persist the normalized selection

#### Scenario: Global config path is cross-platform
- **WHEN** current profile settings are read or written on POSIX or Windows
- **THEN** the global config location SHALL be obtained from the machine-home resolver and joined with platform-native path handling
- **AND** no Unix home syntax or hardcoded path separator SHALL be required on Windows

### Requirement: Named profile management

The system SHALL expose reusable profile snapshots through the top-level `rasen profile` command group. A version 2 profile snapshot captures the workflow and expert selection plus exactly one retention mode; the retired `delivery` setting is not part of a profile.

#### Scenario: Create a named profile
- **WHEN** user runs `rasen profile new [name]` in an interactive terminal
- **THEN** the system SHALL validate or prompt for a portable profile name
- **AND** SHALL prompt for workflows and retention using current settings as defaults
- **AND** SHALL present retention as one radio choice
- **AND** SHALL save the version 2 definition under the machine-global `profiles` directory
- **AND** SHALL apply the new definition, including retention, to current global config after confirmation

#### Scenario: Retry an unavailable prompted profile name
- **WHEN** user runs `rasen profile new` without a name
- **AND** enters an invalid, reserved, or existing profile name
- **THEN** the name prompt SHALL display the reason and remain open for another value
- **AND** cancelling the open prompt SHALL report that the profile command was cancelled

#### Scenario: Reject an unavailable explicit profile name
- **WHEN** user runs `rasen profile new <name>` with an invalid, reserved, or existing name
- **THEN** the command SHALL fail before prompting for workflows or retention
- **AND** SHALL display the reason

#### Scenario: Update a named profile
- **WHEN** user runs `rasen profile update [name]` in an interactive terminal
- **THEN** the system SHALL seed workflow, expert, and retention controls from the saved definition
- **AND** confirmation SHALL replace that saved definition with a normalized version 2 snapshot
- **AND** current global settings SHALL remain unchanged

#### Scenario: Use a named profile
- **WHEN** user runs `rasen profile use <name>`
- **THEN** the system SHALL copy that definition's workflows and retention into current global config
- **AND** SHALL classify the current selection as `full`, `core`, or `custom` using the complete version 2 definition
- **AND** SHALL instruct the user to run `rasen update` in projects

#### Scenario: Select a profile interactively
- **WHEN** user runs `rasen profile use` without a name in a TTY
- **THEN** the system SHALL offer built-in and valid saved profiles
- **WHEN** the same command runs outside a TTY
- **THEN** the command SHALL fail and require an explicit name

#### Scenario: List profiles for humans or automation
- **WHEN** user runs `rasen profile list`
- **THEN** the system SHALL list built-in and saved profiles with workflow count and retention mode
- **WHEN** user adds `--json`
- **THEN** the system SHALL emit structured JSON including each profile's retention mode and whether the complete definition matches current settings

#### Scenario: Delete a saved profile
- **WHEN** user runs `rasen profile delete [name]`
- **THEN** the system SHALL require confirmation unless `--yes` is provided
- **AND** SHALL never delete built-in profiles
- **AND** SHALL leave current global settings unchanged

#### Scenario: Named profile directory is cross-platform
- **WHEN** named profiles are listed, created, updated, or deleted on POSIX or Windows
- **THEN** their machine-global directory and filenames SHALL be resolved with platform path operations
- **AND** Windows separators and case-insensitive path collisions SHALL be handled without creating two files for one portable profile name

### Requirement: Named profile storage and validation

User-named profiles SHALL be stored as versioned YAML definitions under the platform-resolved equivalent of `<global-config-dir>/profiles/<name>.yaml`. A version 2 definition SHALL contain only `version`, `workflows`, and `retention`; `workflows` MAY name workflow IDs and expert IDs, while `retention` SHALL be `off`, `report`, or `codify`. Version 1 definitions SHALL be accepted for migration. A retired `delivery` field present in a legacy definition file SHALL be tolerated and ignored during v1 migration rather than rejected.

#### Scenario: Validate names and version 2 content before saving
- **WHEN** a profile is created, updated, or imported as version 2
- **THEN** its name SHALL be a lowercase portable slug of at most 64 characters
- **AND** `full`, `core`, and `custom` SHALL be reserved
- **AND** every workflow entry SHALL be a unique current catalog ID — a workflow ID or an expert ID
- **AND** retention SHALL be exactly `off`, `report`, or `codify`
- **AND** unsupported versions, unknown IDs, duplicate IDs, invalid retention, and unknown fields SHALL fail without modifying an existing definition

#### Scenario: Version 1 profile containing retro migrates to report
- **WHEN** a valid version 1 named, imported, current-export, or packaged profile contains `retro-command` in `workflows`
- **THEN** normalization SHALL remove `retro-command`, set `version` to 2, and set `retention` to `report`
- **AND** every other valid workflow and expert ID SHALL be preserved

#### Scenario: Version 1 profile without retro migrates to off
- **WHEN** a valid version 1 named, imported, current-export, or packaged profile does not contain `retro-command` in `workflows`
- **THEN** normalization SHALL set `version` to 2 and `retention` to `off`
- **AND** every valid workflow and expert ID SHALL be preserved

#### Scenario: Legacy delivery field is tolerated on read
- **WHEN** a saved version 1 profile definition still contains a `delivery` field
- **THEN** the definition SHALL load successfully
- **AND** the `delivery` field SHALL be ignored and omitted from normalized version 2 output

#### Scenario: Saved profile is a snapshot
- **WHEN** user applies a named profile and later edits current settings with `rasen profile`
- **THEN** the saved definition SHALL remain unchanged

#### Scenario: A saved snapshot lists exactly the chosen IDs
- **WHEN** a version 2 profile snapshot is normalized and saved
- **THEN** it SHALL list exactly the workflow and expert IDs the user selected
- **AND** it SHALL NOT be auto-expanded with closure-pulled experts
- **AND** it SHALL persist exactly one retention value

#### Scenario: Profile definition paths are portable
- **WHEN** a named profile is read or written on POSIX or Windows
- **THEN** the definition path SHALL be assembled from the resolved global config directory with platform-native path joining
- **AND** validation SHALL apply the portable profile name independently of the host path separator

### Requirement: Profile import and export

The system SHALL exchange complete version 2 profile definitions as YAML, JSON, or self-contained profile packages without embedding the local profile name in the definition. Workflow and expert selection plus exactly one retention mode SHALL survive every supported import/export/package round trip.

#### Scenario: Import a profile
- **WHEN** user runs `rasen profile import <path>` for a `.yaml`, `.yml`, `.json`, or `.rasenpkg` file
- **THEN** the name SHALL be derived from the file basename unless an explicit supported package-import name override is supplied
- **AND** the complete definition, including retention or its v1 migration, SHALL be validated before writing normalized version 2 YAML
- **AND** an existing name SHALL only be replaced with `--force`
- **AND** current global settings SHALL remain unchanged

#### Scenario: Export current settings
- **WHEN** user runs `rasen profile export <path>`
- **THEN** the current workflows, experts, and retention mode SHALL be exported as a version 2 profile definition

#### Scenario: Export a selected profile
- **WHEN** user runs `rasen profile export <path> --profile <name>`
- **THEN** that built-in or saved profile's workflows, experts, and retention mode SHALL be exported
- **AND** `.json` destinations SHALL use JSON while YAML destinations use YAML
- **AND** a self-contained package destination SHALL include the same version 2 profile definition

#### Scenario: Profile package round-trips retention
- **WHEN** a version 2 profile is exported as a self-contained package and imported on another machine
- **THEN** the imported normalized profile SHALL have the same single retention mode and selected IDs as the exported profile
- **AND** package workflow dependency processing SHALL NOT add, remove, or reinterpret the retention value

#### Scenario: Protect an existing export
- **WHEN** the destination exists in a TTY and `--force` is absent
- **THEN** the system SHALL ask before overwriting
- **WHEN** the destination exists outside a TTY and `--force` is absent
- **THEN** the system SHALL fail without changing the destination

#### Scenario: Import and export paths are cross-platform
- **WHEN** a profile is imported or exported through a relative or absolute path on POSIX or Windows
- **THEN** the source, destination, basename, extension, and overwrite target SHALL be resolved with platform-native path handling
- **AND** Windows drive-letter paths and separators SHALL round-trip without being interpreted as profile-name characters

### Requirement: Profile defaults

The system SHALL use `core` with retention `off` as the default profile for new users, while preserving existing users' workflow and expert selections through migration. The built-in `full` profile SHALL default to retention `report`; selecting either built-in SHALL apply its complete version 2 definition.

#### Scenario: No global config exists (new user)
- **WHEN** global config file does not exist
- **AND** no existing workflows are installed in the project
- **THEN** the system SHALL behave as if profile is `core`
- **AND** retention SHALL be `off`

#### Scenario: Global config exists but profile field absent (new user)
- **WHEN** global config file exists but does not contain a `profile` field
- **AND** no existing workflows are installed in the project
- **THEN** the system SHALL behave as if profile is `core`
- **AND** retention SHALL be `off`

#### Scenario: Profile field absent with existing workflows (existing user migration)
- **WHEN** global config does not contain a `profile` field
- **AND** the `update` command detects existing workflow files in the project
- **THEN** the system SHALL perform one-time migration (see `specs/cli-update/spec.md` for details)
- **THEN** the system SHALL set profile to `custom` with the detected workflows except that `retro-command` SHALL be removed
- **THEN** retention SHALL be `report` when `retro-command` was detected and `off` otherwise
- **THEN** the system SHALL NOT add or remove any other workflow files during migration

#### Scenario: Built-in defaults select one retention mode
- **WHEN** user applies `full` or `core`
- **THEN** `full` SHALL resolve to `report` and `core` SHALL resolve to `off`
- **AND** neither built-in SHALL activate both report and codify
