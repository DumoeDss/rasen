## MODIFIED Requirements

### Requirement: Registry self-healing

On CLI runs that resolve a project root carrying a `projectId`, the system SHALL keep an existing registry binding consistent with reality — refreshing the entry when the path binding, name, or mode changed, and periodically updating `lastSeen` — without user action. Self-healing MAY refresh an exact registration, unify a verified linked worktree, or rebind a moved project whose prior registered path no longer exists. It SHALL NOT first-register a previously unknown identity or add a live non-worktree path that claims an identity already registered elsewhere; first registration remains owned by an explicit state-requiring operation. Self-healing SHALL target the project's canonical root: a run inside a linked worktree refreshes the MAIN checkout's entry (deriving the entry's name and mode from the main checkout, never from the worktree's directory basename or branch state), falling back to the worktree path only when the main checkout cannot be resolved. Self-healing SHALL be best-effort: registry problems SHALL never fail or visibly slow the user's command. Self-healing SHALL NEVER rename, re-derive, or re-create an existing home directory: a registry entry's `home` is fixed once assigned, and refreshing an entry (including a path-exact update or a worktree share) SHALL reuse the existing `home` unchanged.

#### Scenario: Self-heal survives a broken registry

- **WHEN** the registry file is corrupt and the user runs an ordinary command
- **THEN** the command completes normally

#### Scenario: Unchanged state does not rewrite the registry

- **WHEN** a command runs in a project whose registry entry is current and recently seen
- **THEN** the registry file is not rewritten

#### Scenario: Self-heal never renames an existing home

- **WHEN** self-healing refreshes an existing entry (e.g. a worktree whose basename differs from the shared home's prefix)
- **THEN** the entry's `home` directory name SHALL remain unchanged
- **AND** no home directory SHALL be renamed or re-created

#### Scenario: Self-heal from a worktree targets the main entry

- **WHEN** a command runs inside a linked worktree of a registered project whose main checkout still exists
- **THEN** self-healing refreshes the entry keyed at the main checkout
- **AND** no entry keyed at the worktree path is created or refreshed

#### Scenario: Read-only command does not enroll a copied root

- **GIVEN** a live project is registered and another live non-worktree directory contains a copied config with the same `projectId`
- **WHEN** a read-only root-resolving command such as `rasen validate` runs in the copied directory
- **THEN** the copied path SHALL NOT be added to the machine project registry
- **AND** the original project SHALL remain uniquely selectable by its project identity

#### Scenario: Moved project can still rebind

- **WHEN** the only registered path for the same `projectId` no longer exists and a command runs from the moved project root
- **THEN** self-healing MAY rebind the existing entry to the new canonical root while preserving its home
- **AND** it SHALL NOT mistake the move for a live copied-root claim

## ADDED Requirements

### Requirement: Project identity ambiguity diagnostics identify every claimant and repair

When a project identity resolves to more than one registered root, the command SHALL fail closed and list every conflicting canonical path in deterministic order with its live or missing state. It SHALL name `rasen home prune` as the repair when missing paths are present; when every claimant is live, it SHALL require explicit identity repair and SHALL NOT claim that prune will remove a live project or choose a root by recency.

#### Scenario: Missing copied root points to prune

- **WHEN** one claimant path exists and another claimant path has been deleted
- **THEN** the ambiguity diagnostic SHALL name both paths and mark the deleted path missing
- **AND** it SHALL direct the operator to preview `rasen home prune` and apply the prune before retrying

#### Scenario: Two live claimants choose neither

- **WHEN** two live non-worktree roots claim the same project identity
- **THEN** the diagnostic SHALL name both canonical paths and refuse to select either
- **AND** it SHALL direct the operator to repair the copied identity explicitly rather than promising that prune can resolve live entries

#### Scenario: Conflicting paths use platform-canonical identity

- **WHEN** conflicting roots are rendered on Windows, macOS, or Linux
- **THEN** their identity and ordering SHALL use the existing platform-aware canonical path rules
- **AND** case or separator aliases of one root SHALL NOT be reported as separate claimants
