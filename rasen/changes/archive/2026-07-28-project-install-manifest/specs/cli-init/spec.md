## ADDED Requirements

### Requirement: Init persists tool selection

On every `rasen init` run that reaches tool setup, the command SHALL persist the user's selected tool IDs into `rasen/config.yaml`'s `tools:` key, replacing any prior value. A re-init that selects a different set SHALL overwrite the prior `tools:` value rather than union with it. The persisted value SHALL be the exact list of tool IDs the user confirmed (interactive selection or the `--tools` flag's resolved list), written through the comment-preserving single-key writer so every other line in the config file is untouched. The write SHALL be best-effort: a failure to write the `tools:` key SHALL emit a warning and SHALL NOT abort the command, since the skill files have already been written.

#### Scenario: Fresh init records selected tools

- **WHEN** the user runs `rasen init` interactively and selects Claude Code and Codex
- **THEN** `rasen/config.yaml` SHALL contain a `tools:` key listing both tool ids after the run completes
- **AND** a subsequent `rasen update` SHALL treat exactly those tools as configured

#### Scenario: Re-init with a different selection overwrites

- **WHEN** `rasen/config.yaml` already contains `tools: [claude]`
- **AND** the user runs `rasen init` again and selects Claude Code and Codex
- **THEN** the `tools:` key SHALL be overwritten to the new list
- **AND** the prior value SHALL NOT be unioned into the new value

#### Scenario: --tools flag value persisted

- **WHEN** the user runs `rasen init --tools claude`
- **THEN** `rasen/config.yaml` SHALL contain `tools: [claude]` after the run completes
- **AND** the persisted value SHALL match the `--tools` argument's resolved list exactly

#### Scenario: Init --tools none records empty selection

- **WHEN** the user runs `rasen init --tools none`
- **THEN** `rasen/config.yaml` SHALL contain `tools: []`
- **AND** a subsequent `rasen update` SHALL report that no tools are configured and point the user at `rasen init`

#### Scenario: Config write failure does not abort init

- **WHEN** `rasen init` completes skill generation but the comment-preserving write of the `tools:` key fails (e.g. the config file is read-only)
- **THEN** the command SHALL emit a warning naming the config path
- **AND** SHALL exit successfully because the skill files are already in place
- **AND** the next `rasen update` SHALL seed the `tools:` key through the migration path
