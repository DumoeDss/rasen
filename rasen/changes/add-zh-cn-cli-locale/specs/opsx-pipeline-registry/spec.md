## ADDED Requirements

### Requirement: Pipeline human presentation is localized

Rasen SHALL render its own `rasen pipeline` command help, headings, labels, summaries, empty states, prompts, confirmations, warnings, validation summaries, and error framing in the resolved English, Japanese, or Simplified Chinese CLI locale. This requirement SHALL apply to `list`, `show`, `agents`, `classify`, `resume`, `init`, `validate`, `import`, `export`, and `delete`.

#### Scenario: Every pipeline subcommand uses the resolved locale

- **WHEN** a user runs any pipeline subcommand without `--json` under a supported CLI locale
- **THEN** all Rasen-owned human-facing text for that command SHALL use the resolved locale
- **AND** command names, flag names, pipeline and stage IDs, role/runtime/source enum values, paths, filenames, and user-authored values SHALL remain unchanged

#### Scenario: Japanese runtime output is localized as well as help

- **WHEN** the resolved CLI locale is Japanese and a pipeline command emits human output, a prompt, a warning, or an error summary
- **THEN** the runtime presentation SHALL be Japanese rather than limiting localization to command help

#### Scenario: Simplified Chinese pipeline help is complete

- **WHEN** the resolved CLI locale is `zh-cn` and the user requests help for `rasen pipeline` or any of its ten subcommands
- **THEN** help titles, command descriptions, and flag descriptions SHALL be displayed in Simplified Chinese
- **AND** the command and flag structure and ordering SHALL remain identical to English

#### Scenario: Pipeline failure detail remains diagnosable

- **WHEN** a pipeline operation fails with a core validation or parser diagnostic that has no translated detail
- **THEN** Rasen-owned error framing SHALL use the resolved locale
- **AND** the original diagnostic code and raw detail SHALL remain available without translation or omission

### Requirement: Pipeline presentation preserves content ownership

Package-owned built-in pipeline descriptions SHALL be localized in human views by stable built-in identity and package provenance. Project and user pipeline names and descriptions SHALL be presented verbatim, including when a project or user pipeline overrides the ID of a built-in pipeline.

#### Scenario: Built-in description is localized for humans

- **WHEN** `pipeline list` or `pipeline show` renders a package-layer built-in pipeline under Japanese or Simplified Chinese
- **THEN** the human-readable description SHALL use the resolved locale's catalog entry for that built-in ID

#### Scenario: Same-name override remains user-authored

- **WHEN** a project or user pipeline has the same ID as a package built-in and wins registry resolution
- **THEN** its name and description SHALL be displayed verbatim rather than replaced by the built-in translation
- **AND** no presentation-only provenance metadata SHALL become an enumerable JSON field

### Requirement: Pipeline machine contracts are locale-neutral

Pipeline JSON payloads, registry values, raw descriptions, raw diagnostics, and classifier semantics SHALL remain identical across English, Japanese, and Simplified Chinese. Human localization SHALL NOT change machine-readable behavior.

#### Scenario: Pipeline JSON is stable across locales

- **WHEN** equivalent `list`, `show`, `agents`, `classify`, `resume`, `init`, `validate`, `import`, `export`, or `delete` operations emit JSON under different supported locales
- **THEN** field names, IDs, enum values, codes, paths, digests, raw package descriptions, raw diagnostic detail, and user-authored content SHALL be identical across locales

#### Scenario: Classification semantics are stable across locales

- **WHEN** the same task text is passed to `pipeline classify` under English, Japanese, and Simplified Chinese
- **THEN** keyword matching, `suggested`, `matched`, and `basis` values SHALL be identical
- **AND** only human-facing labels and explanatory Rasen-owned text MAY differ by locale

#### Scenario: Built-in JSON description remains raw

- **WHEN** a package-layer built-in pipeline is shown with `--json` under Japanese or Simplified Chinese
- **THEN** its description SHALL remain the raw package-authored value used by the existing JSON contract
- **AND** localized human presentation metadata SHALL NOT alter the serialized shape
