## MODIFIED Requirements

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
- **WHEN** the user's resolved CLI locale is Japanese or Simplified Chinese
- **THEN** delivery choices, built-in workflow names and descriptions, picker prompts, and picker instructions SHALL be displayed in the resolved locale
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
- **AND** the persisted workflow definition, package content, JSON output, and generated skill or command content SHALL remain unmodified

#### Scenario: Workflow picker fits the opening terminal height
- **WHEN** the workflow and expert picker opens through `rasen profile new`, `rasen profile`, or `rasen config profile` with a known terminal height
- **THEN** the choice viewport SHALL reserve rows for the question, spacer, active description, and instructions
- **AND** a 12-row terminal SHALL display at most 7 choice rows
- **AND** a 24-row terminal SHALL display at most 19 choice rows
- **AND** a terminal tall enough for the full choice list SHALL display no more rows than the number of choices
- **AND** a valid terminal too short for the reserved rows SHALL still display at least one choice row
- **AND** every workflow, expert, and group separator outside the current viewport SHALL remain reachable through keyboard navigation
- **WHEN** terminal height is unavailable or invalid
- **THEN** the choice viewport SHALL use a safe seven-row fallback capped by the number of choices
- **AND** the open prompt SHALL retain its opening height snapshot while a newly opened prompt captures the current terminal height

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
