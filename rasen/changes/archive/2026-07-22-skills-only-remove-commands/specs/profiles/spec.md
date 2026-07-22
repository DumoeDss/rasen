## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Delivery is independent of profile
**Reason**: The delivery dimension is retired. Skills are always and only installed; there is no `both`/`skills` choice and no separate "how workflows are installed" axis.
**Migration**: Replaced by the "Delivery setting is retired" requirement. Any stored delivery value is read without error, noticed once, and removed.

### Requirement: Legacy delivery values migrate gracefully
**Reason**: Superseded by full retirement. Legacy values are no longer mapped to a consolidated live value; the entire setting (legacy and current values alike) is retired.
**Migration**: Replaced by the "Delivery setting is retired" requirement — any stored value (including the former "current" values `both`/`skills`) is read, noticed once, and stripped from the config.

## MODIFIED Requirements

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
