# profiles Specification

## Purpose
Define installation profiles (with a delivery dimension independent of profile), including reusable machine-global named snapshots, selectable from the top-level profile command and applied through the update command.
## Requirements
### Requirement: Profile definitions
The system SHALL support built-in `full` and `core` profiles, the current `custom` workflow selection, and reusable user-named profile snapshots. Each profile SHALL resolve to a workflow set AND an expert set; experts are catalog units selectable within a profile like workflows.

#### Scenario: Full profile contents
- **WHEN** profile is set to `full`
- **THEN** the profile SHALL include every workflow in `ALL_WORKFLOWS`
- **AND** the profile SHALL include every built-in expert

#### Scenario: Core profile contents
- **WHEN** profile is set to `core`
- **THEN** the profile SHALL include workflows: `propose`, `explore`, `apply`, `sync`, `archive`, `auto-command`, `help`
- **AND** the profile SHALL include the quality-floor experts: `review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`

#### Scenario: Custom profile contents
- **WHEN** profile is set to `custom`
- **THEN** the profile SHALL include only the workflows and experts specified in the global config `workflows` array
- **AND** experts required by a selected workflow's dependency closure SHALL additionally be installed even when the array omits them

### Requirement: Drift detection evaluates the desired selection as its dependency closure

Profile drift detection SHALL evaluate the desired workflow selection as its full dependency closure — the selection plus every expert required by a selected workflow's skill-dependency closure — before deciding whether an installed artifact is unexpected. Because a stored profile is intentionally not closure-expanded (a stored profile is not auto-expanded with closure-pulled experts) while installed experts are governed by the resolved profile plus dependency closure, the detector SHALL reconcile the two by closing the desired selection itself, using the same closure resolution as the install and removal seams. Consequently a closure-required expert that is present on disk SHALL NOT be reported as drift, and drift detection SHALL give the same result whether its caller passes the raw selection or an already-closure-resolved selection.

#### Scenario: Closure-required expert on disk is not drift for a custom profile

- **WHEN** a custom profile selects pipeline workflows without explicitly listing the experts those workflows require, the project is installed to match, and drift is evaluated against the stored (un-expanded) selection
- **THEN** the installed closure-required experts (e.g. the quality experts pulled in by the selected workflows) SHALL NOT be reported as drift, and no sync/drift warning SHALL be raised

#### Scenario: Detection is independent of whether the caller pre-resolved the closure

- **WHEN** drift is evaluated for the same project once with the raw stored selection and once with the closure-resolved selection
- **THEN** both evaluations SHALL return the same result

#### Scenario: A genuinely orphaned expert is still drift

- **WHEN** a built-in expert is installed on disk that is neither in the resolved profile's expert set nor required by any selected workflow's dependency closure
- **THEN** drift detection SHALL still report it, so real deselections continue to trigger sync

### Requirement: Delivery setting is retired
The `delivery` setting is retired. Skills are the single delivery format; there is no command delivery surface and no delivery choice to configure. Any `delivery` value stored in a prior config — a current value (`both`, `skills`) or a legacy value (`commands`, `commands-first`, `skills-first`) — SHALL be read without error, SHALL trigger a one-time notice explaining that commands have been consolidated into skills and the setting has been retired, and SHALL be removed from the config file on the next write. An old delivery value SHALL never cause a command to fail.

#### Scenario: Stored delivery value is read without error and retired
- **WHEN** the global config contains a `delivery` key with any value (`both`, `skills`, `commands`, `commands-first`, or `skills-first`) and any command reads the config
- **THEN** the command SHALL succeed
- **AND** a one-time notice SHALL state that commands have been consolidated into skills and the delivery setting has been retired
- **AND** the `delivery` key SHALL be removed from the config file

#### Scenario: Notice appears only once
- **WHEN** a stored `delivery` key is retired and the config is rewritten without it
- **THEN** subsequent runs SHALL read the config with no `delivery` key and print no further notice

#### Scenario: Config without a delivery key needs no rewrite
- **WHEN** the global config has no `delivery` key
- **THEN** the system SHALL NOT print the retirement notice
- **AND** SHALL NOT rewrite the config file for that reason

### Requirement: Profile configuration via interactive picker
The system SHALL provide an interactive picker for configuring profiles.

#### Scenario: Interactive profile configuration
- **WHEN** user runs `rasen profile`
- **THEN** the system SHALL display an interactive picker with:
  - Workflow toggles for all available workflows
- **THEN** the system SHALL pre-select current config values
- **THEN** on confirmation, the system SHALL update global config
- **THEN** the system SHALL set profile to `custom` if selected workflows differ from core defaults
- **THEN** the system SHALL set profile to `core` if selected workflows match core defaults exactly (propose, explore, apply, archive)
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
- **WHEN** the user's resolved CLI locale is Japanese or Simplified Chinese
- **THEN** built-in workflow names and descriptions, picker prompts, and picker instructions SHALL be displayed in the resolved locale
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
Current profile settings SHALL be stored in the existing global config file under the resolved machine home alongside telemetry and feature flags.

#### Scenario: Config schema
- **WHEN** reading profile configuration
- **THEN** the config SHALL contain `profile` (full|core|custom), `language` (auto|en|ja|zh-cn), and optionally `workflows` (array of workflow names)
- **AND** persisted language values SHALL accept only the exact canonical enum values and SHALL NOT normalize aliases such as `zh-CN` or `zh_CN`

#### Scenario: Schema evolution
- **WHEN** loading config without a profile field
- **THEN** the system SHALL use the default (profile=core)
- **AND** existing config fields (telemetry, featureFlags) SHALL be preserved

#### Scenario: Config list displays profile settings
- **WHEN** user runs `rasen config list`
- **THEN** the system SHALL display profile and workflows settings
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
- **WHEN** user updates the profile or workflow selection via `rasen profile`
- **THEN** the global config SHALL be updated immediately
- **AND** project files SHALL remain unchanged until `rasen update` is run for that project

### Requirement: Named profile management

The system SHALL expose reusable profile snapshots through the top-level `rasen profile` command group. A profile snapshot captures the workflow (and expert) selection only; the retired `delivery` setting is not part of a profile.

#### Scenario: Create a named profile
- **WHEN** user runs `rasen profile new [name]` in an interactive terminal
- **THEN** the system SHALL validate or prompt for a portable profile name
- **AND** SHALL prompt for workflows using current settings as defaults
- **AND** SHALL save the definition under the machine-global `profiles` directory
- **AND** SHALL apply the new definition to current global config after confirmation

#### Scenario: Retry an unavailable prompted profile name
- **WHEN** user runs `rasen profile new` without a name
- **AND** enters an invalid, reserved, or existing profile name
- **THEN** the name prompt SHALL display the reason and remain open for another value
- **AND** cancelling the open prompt SHALL report that the profile command was cancelled

#### Scenario: Reject an unavailable explicit profile name
- **WHEN** user runs `rasen profile new <name>` with an invalid, reserved, or existing name
- **THEN** the command SHALL fail before prompting for workflows
- **AND** SHALL display the reason

#### Scenario: Use a named profile
- **WHEN** user runs `rasen profile use <name>`
- **THEN** the system SHALL copy that definition's workflows into current global config
- **AND** SHALL classify the current selection as `full`, `core`, or `custom`
- **AND** SHALL instruct the user to run `rasen update` in projects

#### Scenario: Select a profile interactively
- **WHEN** user runs `rasen profile use` without a name in a TTY
- **THEN** the system SHALL offer built-in and valid saved profiles
- **WHEN** the same command runs outside a TTY
- **THEN** the command SHALL fail and require an explicit name

#### Scenario: List profiles for humans or automation
- **WHEN** user runs `rasen profile list`
- **THEN** the system SHALL list built-in and saved profiles with workflow count
- **WHEN** user adds `--json`
- **THEN** the system SHALL emit structured JSON including whether each profile matches current settings

#### Scenario: Delete a saved profile
- **WHEN** user runs `rasen profile delete [name]`
- **THEN** the system SHALL require confirmation unless `--yes` is provided
- **AND** SHALL never delete built-in profiles
- **AND** SHALL leave current global settings unchanged

### Requirement: Named profile storage and validation

User-named profiles SHALL be stored as versioned YAML definitions under `<global-config-dir>/profiles/<name>.yaml` and SHALL contain only `version` and `workflows`. The `workflows` list MAY name workflow ids and expert ids. A retired `delivery` field present in a legacy definition file SHALL be tolerated and ignored on read rather than rejected, so existing saved profiles keep loading.

#### Scenario: Validate names and content before saving
- **WHEN** a profile is created or imported
- **THEN** its name SHALL be a lowercase portable slug of at most 64 characters
- **AND** `full`, `core`, and `custom` SHALL be reserved
- **AND** every entry SHALL be a unique current catalog id — a workflow id or an expert id
- **AND** unsupported versions, unknown ids, duplicate ids, and unknown fields SHALL fail without modifying an existing definition

#### Scenario: Legacy delivery field is tolerated on read
- **WHEN** a saved profile definition from before the delivery retirement still contains a `delivery` field
- **THEN** the definition SHALL load successfully
- **AND** the `delivery` field SHALL be ignored

#### Scenario: Saved profile is a snapshot
- **WHEN** user applies a named profile and later edits current settings with `rasen profile`
- **THEN** the saved definition SHALL remain unchanged

#### Scenario: A saved snapshot lists exactly the chosen ids
- **WHEN** a profile snapshot is normalized and saved
- **THEN** it SHALL list exactly the workflow and expert ids the user selected
- **AND** it SHALL NOT be auto-expanded with closure-pulled experts

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
- **THEN** the current workflows SHALL be exported

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

### Requirement: Expert selection in the profile picker

The interactive profile picker SHALL present built-in experts as selectable toggles, in a group distinct from the workflow toggles, so a user can add or remove experts as part of a profile. An expert required by an already-selected workflow's dependency closure SHALL be shown as required and SHALL NOT be uncheckable.

#### Scenario: Experts are toggleable in the picker
- **WHEN** the profile picker is displayed
- **THEN** the built-in experts SHALL appear as toggle choices alongside the workflow toggles
- **THEN** each expert SHALL be pre-selected when it is part of the current selection
- **THEN** on confirmation, the selected experts SHALL be persisted in the global config selection

#### Scenario: Required expert cannot be unchecked
- **WHEN** a selected workflow requires an expert via its `requires.skills`
- **THEN** that expert SHALL be shown as required by that workflow
- **AND** the user SHALL NOT be able to remove it while the requiring workflow remains selected

#### Scenario: Localized expert picker metadata
- **WHEN** the picker renders experts
- **THEN** each built-in expert SHALL have a specific localized name and description rather than an id fallback in English, Japanese, and Simplified Chinese
- **AND** the expert metadata catalog SHALL define an entry for every built-in expert in all three supported locales

### Requirement: Expert installation is profile-governed and non-regressive

Installed experts SHALL be governed by the resolved profile plus dependency closure, but existing installs SHALL NOT lose experts when this behavior is introduced. The system SHALL treat an install as having explicit expert selection only after the user re-selects experts through the profile picker or applies a profile; until then, all built-in experts SHALL continue to be installed regardless of profile.

#### Scenario: Existing install keeps all experts
- **WHEN** a project created before expert selection existed is updated
- **AND** the user has not re-selected experts
- **THEN** every built-in expert SHALL remain installed, independent of the active profile
- **AND** no expert skill directory SHALL be removed

#### Scenario: Explicit re-selection makes the profile govern
- **WHEN** the user opens the profile picker and confirms an expert selection
- **THEN** the install SHALL be marked as having explicit expert selection
- **AND** subsequent updates SHALL install the profile-default plus closure expert set and prune unreferenced deselected experts

#### Scenario: Fresh install is profile-scoped from the start
- **WHEN** a new project is initialized
- **THEN** its expert set SHALL be the active profile's default plus dependency closure
- **AND** a `core` install SHALL therefore receive only the quality-floor experts plus any closure-required experts

