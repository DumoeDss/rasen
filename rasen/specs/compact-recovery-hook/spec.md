# compact-recovery-hook Specification

## Purpose
Provides a `hooks/compact-recovery.sh` script that prints post-compaction recovery guidance for SessionStart context injection — directing the agent to `openspec pipeline resume`, the `sessionHandoff` pointer, and handoff documents instead of the compaction summary — and has `openspec init` print copy-paste configuration instructions for wiring it as a Claude Code `SessionStart` hook (matcher `compact`) without auto-modifying settings.

## Requirements
### Requirement: Compact recovery guidance script
The system SHALL provide `hooks/compact-recovery.sh` which, when run, prints recovery guidance to stdout suitable for SessionStart context injection: a compaction just occurred; run `openspec pipeline resume <change>` to surface `sessionHandoff` and per-stage handoff documents; recover from the handoff distillate first; do not trust details from the compaction summary.

#### Scenario: Script prints recovery guidance
- **WHEN** `hooks/compact-recovery.sh` is executed
- **THEN** it SHALL print guidance naming `openspec pipeline resume`, the `sessionHandoff` pointer, and the preference for handoff documents over the compaction summary
- **AND** it SHALL exit with code 0

### Requirement: Init instructions for compact recovery hook
`openspec init` SHALL print instructions for configuring the compact recovery hook as a Claude Code `SessionStart` hook with the `compact` matcher, alongside the existing safety-hook guidance.

#### Scenario: Init displays hook configuration guidance
- **WHEN** `openspec init` completes
- **THEN** the output SHALL include a copy-paste ready `SessionStart` configuration snippet (matcher `compact`) referencing `hooks/compact-recovery.sh`

#### Scenario: Init does not auto-modify settings
- **WHEN** `openspec init` runs
- **THEN** the system SHALL NOT automatically modify `.claude/settings.json`
- **AND** SHALL only display instructions for the user to configure manually
