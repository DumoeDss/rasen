## ADDED Requirements

### Requirement: Init configures the selected Codex runtime

When Codex is explicitly included in the validated tool selection, `rasen init` SHALL reconcile the project-local Codex wait policy as part of configuring that tool. Tool selections that exclude Codex SHALL leave `.codex/config.toml` untouched.

#### Scenario: Fresh init selects Codex

- **WHEN** the user runs `rasen init` and selects Codex
- **THEN** the system SHALL generate the selected Codex skills
- **AND** the system SHALL reconcile the Rasen-managed policy in the project-local `.codex/config.toml`

#### Scenario: Explicit Codex setup at an externalized planning root

- **WHEN** the user explicitly configures Codex at the exact repository root of an externalized planning project
- **THEN** the system SHALL reconcile `.codex/config.toml` relative to that repository root
- **AND** the external planning store SHALL NOT receive the Codex project config

#### Scenario: Init excludes Codex

- **WHEN** the validated tool selection does not include Codex
- **THEN** the system SHALL leave any project-local `.codex/config.toml` unchanged
- **AND** the presence of a `.codex/` directory alone SHALL NOT authorize reconciliation

#### Scenario: Codex config cannot be reconciled

- **WHEN** Codex is selected but its project config is unreadable, structurally ambiguous, or cannot be written safely
- **THEN** init SHALL identify Codex configuration as failed and display the path and actionable reason
- **AND** init SHALL NOT report Codex as fully configured
- **AND** independently selected tools SHALL continue through the existing per-tool setup flow

### Requirement: Init reports Codex config activation

`rasen init` SHALL report when it creates or changes the managed Codex policy and SHALL explain that a fresh Codex session is required.

#### Scenario: Init writes Codex config

- **WHEN** init creates or updates `.codex/config.toml`
- **THEN** the success summary SHALL identify that Codex configuration changed
- **AND** the system SHALL instruct the user to restart Codex for the policy to take effect
- **AND** the Codex config file SHALL NOT be counted as a generated skill

#### Scenario: Init finds current Codex config

- **WHEN** init finds all managed Codex values already current
- **THEN** the system SHALL avoid rewriting the file
- **AND** the system SHALL NOT display a config-specific restart instruction
