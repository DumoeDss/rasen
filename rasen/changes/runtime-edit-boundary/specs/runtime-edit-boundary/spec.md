## ADDED Requirements

### Requirement: Agents control one checkout-scoped edit boundary

Rasen SHALL provide `rasen agent edit-boundary set <directory>`, `status`, and
`clear`. The commands SHALL work when `rasen-freeze`, `rasen-guard`, and
`rasen-unfreeze` are absent, SHALL persist state outside skill directories,
and SHALL report the canonical execution root, boundary, active state, detected
host and source, and enforcement level in human and JSON output.

#### Scenario: Missing-skill installation can set and inspect a boundary

- **WHEN** a project contains no installed directory for any retired boundary skill and an agent runs `set` followed by `status`
- **THEN** both commands SHALL use the base runtime successfully
- **AND** `status` SHALL report the same canonical boundary and enforcement level

#### Scenario: Clear is idempotent

- **WHEN** an agent clears an active boundary and clears it again
- **THEN** both invocations SHALL succeed
- **AND** the second result SHALL report that no boundary is active

### Requirement: Boundary paths are canonical and containment-safe

`set` SHALL accept an existing directory inside the current canonical
execution root. Hook evaluation SHALL compare canonical paths using
platform-aware path containment rather than string prefixes, including a
not-yet-created target whose nearest existing ancestor can be resolved.

#### Scenario: Prefix sibling is outside

- **WHEN** the boundary is `<root>/src` and a covered write targets `<root>/src-old/file.ts`
- **THEN** the target SHALL be outside the boundary

#### Scenario: Windows and symlink paths cannot bypass containment

- **WHEN** a Windows path differs only by drive-letter case or separators, or a symlink inside the boundary resolves outside it
- **THEN** evaluation SHALL follow native filesystem identity and platform case rules
- **AND** SHALL deny any target whose resolved location is outside

### Requirement: Enforcement results are honest and hook-compatible

The capability SHALL emit exactly `hard`, `soft`, or `unsupported`. `hard`
SHALL mean the detected host is configured to reject covered structured write
tools outside the boundary; it SHALL state that shell, MCP, and external writes
are not a security boundary. `soft` SHALL require agent cooperation.
`unsupported` SHALL leave edits unrestricted and `set` SHALL not create active
state.

#### Scenario: Hard host denies a covered write

- **WHEN** a registered hard host invokes the Rasen check hook for a covered write outside an active boundary
- **THEN** the hook SHALL emit that host's valid deny response
- **AND** a covered write inside the boundary SHALL continue

#### Scenario: Unsupported host fails safely

- **WHEN** host detection or an explicit selector resolves to an unsupported host and `set` is invoked
- **THEN** Rasen SHALL return an actionable unsupported result without active state
- **AND** no output SHALL claim that edits are restricted

### Requirement: Init and update reconcile base-runtime hooks

Init and update SHALL reconcile one exact Rasen-owned project hook entry for
each configured host that has an edit-boundary adapter, independent of selected
skills. Reconciliation SHALL be idempotent, preserve unrelated configuration,
and warn without overwriting an invalid configuration file.

#### Scenario: Update without boundary skills installs runtime integration

- **WHEN** update runs for a project whose profile excludes all three retired skills
- **THEN** the applicable host hook SHALL still invoke `rasen agent edit-boundary check`
- **AND** no hook command SHALL reference a skill directory

#### Scenario: Unsupported configured tool gets no false hook

- **WHEN** init configures a tool whose runtime adapter reports `unsupported`
- **THEN** Rasen SHALL not install an enforcement hook for that tool
- **AND** boundary status for that host SHALL remain `unsupported`
