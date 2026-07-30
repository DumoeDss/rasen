## ADDED Requirements

### Requirement: Catalog-backed CLI presentation

Rasen SHALL source package-owned root, command, option, and generated help copy from the resolved CLI locale catalog and SHALL use the same resolved presentation for Commander help and shell completion descriptions.

#### Scenario: Supported locale renders complete help

- **WHEN** a user requests root or nested command help with the resolved locale set to English, Japanese, or Simplified Chinese
- **THEN** every visible package-owned heading, command description, and option description SHALL render in that locale
- **AND** the visible command, alias, option, positional, and accepted-value structure SHALL remain identical across locales

#### Scenario: Completion descriptions use the same presentation

- **WHEN** a user generates a Fish, Zsh, Bash, or PowerShell completion script in a supported locale
- **THEN** every description supported by that shell SHALL come from the same resolved presentation used by Commander help
- **AND** completion generation SHALL NOT substitute a different source-language description for the same command or option

#### Scenario: Machine contracts remain locale-neutral

- **WHEN** CLI presentation is resolved in any supported locale
- **THEN** command names, aliases, option names, accepted enum values, identifiers, paths, JSON fields, and executable shell snippets SHALL remain unchanged

### Requirement: Complete and safe locale coverage

The English CLI presentation catalog SHALL provide a non-empty baseline for every visible root, command, option, and generated-help slot. Every shipped non-English locale SHALL define the same slots with the same placeholder sets, and runtime resolution SHALL use English when a selected-locale slot is unavailable.

#### Scenario: New visible surface requires locale coverage

- **WHEN** a visible command, alias-bearing canonical command, root option, or command option is added to the CLI structure
- **THEN** catalog validation SHALL require a non-empty description in English, Japanese, and Simplified Chinese before the change is considered complete

#### Scenario: Selected locale entry is unavailable at runtime

- **WHEN** a selected-locale presentation slot cannot be resolved but its English baseline exists
- **THEN** Rasen SHALL render the English baseline for that slot
- **AND** SHALL preserve all surrounding command and option structure

#### Scenario: English baseline is invalid

- **WHEN** a visible presentation slot has no non-empty English baseline
- **THEN** Rasen SHALL fail before returning a resolved presentation or emitting partial help or completion output
- **AND** the failure SHALL identify the affected semantic command or option location

### Requirement: Validated dynamic help values

Rasen SHALL interpolate package-owned runtime facts into localized CLI presentation templates after locale selection, while preserving inserted machine values exactly.

#### Scenario: Available tool identifiers are localized around stable values

- **WHEN** the `init --tools` description is rendered in a supported locale
- **THEN** the surrounding explanatory copy SHALL use that locale
- **AND** every available tool identifier SHALL be inserted unchanged

#### Scenario: Package constants appear in localized descriptions

- **WHEN** a help template includes a package-owned value such as the default schema or default workspace directory name
- **THEN** Rasen SHALL render the localized template with the current value
- **AND** SHALL NOT infer the template by matching or parsing English prose

#### Scenario: Template inputs are inconsistent

- **WHEN** a localized template changes the English placeholder set or a required runtime value is unavailable
- **THEN** Rasen SHALL fail before rendering help or writing a completion script
- **AND** the failure SHALL identify the affected template location and placeholder

### Requirement: Canonical alias presentation

A command alias SHALL reuse the canonical command's resolved description and option presentation while retaining its stable machine-facing alias token.

#### Scenario: Alias appears in help and completion

- **WHEN** a canonical command has a visible alias such as `ls`
- **THEN** help and completion output SHALL expose the alias according to the canonical command structure
- **AND** the alias SHALL use the canonical command's localized description in every supported locale

#### Scenario: Behavioral compatibility command is not a simple alias

- **WHEN** a hidden compatibility command has different options or behavior from the canonical command
- **THEN** Rasen SHALL preserve it as an independent command surface rather than presenting it as a structural alias

### Requirement: Isolated localized program instances

Rasen's program-construction interface SHALL return a fresh Commander program whose CLI presentation is fully resolved for the requested locale before use.

#### Scenario: Programs use independent locales

- **WHEN** one process constructs a Japanese program and then constructs an English program
- **THEN** each instance SHALL render help exclusively from its own resolved locale
- **AND** constructing or using either instance SHALL NOT change the other's descriptions

#### Scenario: CLI runtime resolves locale after machine-data adoption

- **WHEN** the CLI entry point starts
- **THEN** it SHALL complete legacy machine-data adoption before reading locale-dependent global configuration
- **AND** SHALL resolve the locale once before constructing and parsing the program

### Requirement: Presentation and command structure remain coherent

Rasen SHALL validate the complete visible Commander surface against the resolved root-inclusive CLI presentation before applying descriptions.

#### Scenario: Commander and presentation agree

- **WHEN** program construction completes with matching root, command, alias, option, and positional structure
- **THEN** Rasen SHALL apply the resolved presentation once and return the completed program

#### Scenario: Visible structure drifts

- **WHEN** a visible Commander command, alias, option, or positional does not match the CLI presentation structure
- **THEN** Rasen SHALL fail before applying a partial presentation
- **AND** the failure SHALL identify the mismatched semantic command location
