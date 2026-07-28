## ADDED Requirements

### Requirement: Project-local Codex wait policy

For a project that Rasen configures for Codex, the system SHALL maintain a project-local `.codex/config.toml` policy whose `[features.multi_agent_v2]` table sets `min_wait_timeout_ms`, `default_wait_timeout_ms`, and `max_wait_timeout_ms` to `3600000`.

#### Scenario: Missing project config

- **WHEN** Rasen reconciles the Codex policy for a project without `.codex/config.toml`
- **THEN** the system SHALL create the project-local file with all three managed values
- **AND** the system SHALL NOT modify the user's global Codex configuration

#### Scenario: Wait completes before one hour

- **WHEN** a Rasen dependency barrier is running under the managed policy
- **AND** the worker posts mailbox activity or the user steers the session before one hour
- **THEN** `wait_agent` SHALL be permitted to return immediately

#### Scenario: Short timeout compatibility

- **WHEN** a Rasen-configured Codex session requests a `wait_agent` timeout shorter than `3600000` milliseconds
- **THEN** Codex SHALL apply the managed one-hour minimum instead of accepting the shorter timeout

### Requirement: Narrow and lossless ownership

The system SHALL own only `min_wait_timeout_ms`, `default_wait_timeout_ms`, and `max_wait_timeout_ms` within `[features.multi_agent_v2]`. Reconciliation SHALL preserve every unrelated table, key, value, comment, ordering choice, and newline convention in the project config, including any user-authored `multi_agent_mode_hint_text`.

#### Scenario: Existing config has unrelated content

- **WHEN** `.codex/config.toml` contains unrelated user-authored settings and a missing or stale managed value
- **THEN** the system SHALL reconcile all three managed values
- **AND** every unrelated setting and comment SHALL remain unchanged

#### Scenario: Existing managed values conflict

- **WHEN** one or more managed fields contain user-authored values that differ from the Rasen policy
- **THEN** the system SHALL replace those managed values with the Rasen values
- **AND** the system SHALL leave all non-managed fields unchanged

#### Scenario: Existing custom multi-agent hint

- **WHEN** `.codex/config.toml` contains a user-authored `multi_agent_mode_hint_text`
- **THEN** reconciliation SHALL preserve that field byte-for-byte
- **AND** Rasen SHALL NOT add a `multi_agent_mode_hint_text` when the field is absent

#### Scenario: CRLF project config on Windows

- **WHEN** a project config uses CRLF line endings and its path is resolved from a Windows project root
- **THEN** the system SHALL reconcile the file at the platform-correct `.codex/config.toml` path
- **AND** the file SHALL retain CRLF line endings and its existing final-newline convention

### Requirement: Safe and idempotent reconciliation

The system SHALL validate both the source structure and the candidate TOML, write changes atomically, and leave an already-current file untouched.

#### Scenario: Policy is already current

- **WHEN** all three managed values already equal the Rasen policy
- **THEN** reconciliation SHALL report the policy as unchanged
- **AND** the system SHALL NOT rewrite the file

#### Scenario: Structurally ambiguous target

- **WHEN** the target table or managed fields are duplicated, collide with an incompatible scalar or inline table, or otherwise cannot be edited unambiguously
- **THEN** reconciliation SHALL fail with an actionable reason and the project config path
- **AND** the original file SHALL remain byte-for-byte unchanged

#### Scenario: Invalid or unreadable config

- **WHEN** `.codex/config.toml` cannot be read or parsed as supported TOML
- **THEN** reconciliation SHALL fail with an actionable reason and the project config path
- **AND** the system SHALL NOT replace the file

#### Scenario: Atomic replacement fails

- **WHEN** the candidate policy is valid but the atomic file replacement fails
- **THEN** reconciliation SHALL report the write failure
- **AND** the existing project config SHALL remain available for a later retry

### Requirement: Observable reconciliation status

The system SHALL distinguish a current policy from missing, drifted, and blocked policy states so callers can plan and report work accurately.

#### Scenario: Read-only drift inspection

- **WHEN** a caller inspects a missing or stale project policy
- **THEN** the system SHALL report that configuration work is required without modifying the file

#### Scenario: Reconciliation changes the policy

- **WHEN** reconciliation creates or updates `.codex/config.toml`
- **THEN** the system SHALL report whether the file was created or updated
- **AND** the caller SHALL be able to tell the user that a Codex restart is required
