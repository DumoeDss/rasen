# Delta: profiles

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
- **THEN** Unix-like systems SHALL inspect `LC_ALL`, `LC_MESSAGES`, then `LANG` in that order
- **AND** an inspected value that resolves to a supported locale SHALL determine the language
- **AND** an inspected value naming the portable locale (`C` or `POSIX`, with or without an encoding suffix) SHALL resolve to English
- **AND** an inspected value naming a well-formed but unsupported language SHALL fall back to English
- **AND** an inspected value carrying no language information (for example `UTF-8` or a malformed value) SHALL NOT determine the language, and resolution SHALL continue with the remaining variables
- **AND** on macOS, when no locale environment variable determines the language, the system SHALL consult the operating system's configured locale before falling back to the runtime-reported system locale
- **AND** Windows SHALL use the system locale reported by the runtime rather than Unix shell locale variables
- **AND** `zh-CN`, `zh_CN.UTF-8`, `zh-SG`, `zh-Hans`, and bare `zh` SHALL resolve to `zh-cn`
- **AND** `zh-TW`, `zh-HK`, `zh-MO`, and `zh-Hant` SHALL remain unsupported and fall back to English
- **AND** all other unsupported locales SHALL fall back to English
- **AND** a valid `RASEN_LANG=en|ja|zh-cn` SHALL temporarily override the persisted setting
- **AND** an invalid `RASEN_LANG` SHALL be ignored so persisted or automatic resolution can continue

#### Scenario: macOS language detection without locale environment variables
- **WHEN** `language` is `auto` on macOS in a process that received no locale environment variables (for example a GUI-launched application)
- **AND** the operating system's configured locale is Japanese
- **THEN** the CLI SHALL resolve to Japanese
- **WHEN** the operating system's configured locale cannot be read
- **THEN** resolution SHALL fall back to the runtime-reported system locale and then English, without emitting diagnostics

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
