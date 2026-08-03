# runtime-edit-boundary-retirement Specification

## Purpose
Defines the permanent retirement of Rasen's public runtime edit-boundary
surface while preserving independent daemon and managed-execution controls.

## Requirements

### Requirement: The public runtime edit boundary is retired

Rasen SHALL provide no public or hidden `rasen agent edit-boundary` command,
completion, generated skill guidance, or runtime enforcement classification.
Fresh initialization and subsequent updates SHALL leave Claude and Codex
without a Rasen edit-boundary hook, and current documentation SHALL direct
scope-control needs to declared work scope and changed-file verification.

#### Scenario: Fresh setup has no edit-boundary surface

- **WHEN** a user initializes Rasen for Claude, Codex, or both and inspects CLI
  help, completions, generated skills, and project hook configuration
- **THEN** no `edit-boundary` command or Rasen edit-boundary hook SHALL be
  present
- **AND** the generated guidance SHALL make no freeze/unfreeze enforcement
  claim

#### Scenario: Update does not recreate a removed hook

- **WHEN** an initialized project runs update after its retired Rasen
  edit-boundary hook has been removed
- **THEN** update SHALL leave the hook absent
- **AND** a later no-op update SHALL also leave it absent

### Requirement: Generic managed-execution controls remain independent

Retiring the public edit boundary SHALL preserve daemon/ECP workspace access,
runtime sandbox selection, cross-run workspace reservations, and
isolated-worktree delivery controls under their existing contracts. These
controls SHALL remain generic managed-execution capabilities and SHALL NOT be
renamed or exposed as freeze/unfreeze compatibility commands.

#### Scenario: Daemon and ECP controls survive retirement

- **WHEN** the runtime edit-boundary CLI, state, and hooks are absent
- **THEN** managed actions SHALL continue to carry their existing workspace
  access and sandbox values
- **AND** workspace reservation and isolated-worktree behavior SHALL remain
  available without an edit-boundary dependency

#### Scenario: Managed containment is not presented as freeze

- **WHEN** a user inspects daemon, ECP, sandbox, or workspace documentation
- **THEN** those controls SHALL be described in their own execution-policy
  terms
- **AND** no compatibility alias SHALL present them as `freeze`, `unfreeze`, or
  `edit-boundary`
