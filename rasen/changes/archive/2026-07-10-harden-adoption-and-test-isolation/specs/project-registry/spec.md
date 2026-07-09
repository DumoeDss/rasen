## MODIFIED Requirements

### Requirement: Clones fork, worktrees share, moves rebind

When a project path is registered whose `projectId` is already registered at another path, the system SHALL distinguish three cases: (1) the old path no longer exists — the entry is rebound to the new path keeping the same home (a moved repo keeps its state); (2) the new path is a git worktree of the same repository — the new path shares the existing home (worktrees share ephemera); (3) otherwise — the new path is an independent clone and receives a distinct home named with the first free integer suffix (`<name>-<shortHash>-2`, `-3`, …). When the relationship cannot be determined, the system SHALL prefer forking over sharing.

When a NEW home directory is created (cases with no existing home to reuse), its human-readable `<name>` prefix SHALL derive from the MAIN repository — the parent directory of `git rev-parse --git-common-dir` — rather than from the registering path's basename, so that a worktree (e.g. `.claude/worktrees/<branch>`) registering before the main repo does not name the shared home after the worktree. When the registering path is not inside a git working tree, or the main-repo directory cannot be resolved, the `<name>` prefix SHALL fall back to the registering path's basename. The `<shortHash>` (derived from `projectId`) is unchanged, so identity and collision-freedom are unaffected; only the readable prefix is corrected.

#### Scenario: Moved repo keeps its home

- **WHEN** a project directory is moved and a Rasen command runs from the new location
- **THEN** the registry entry is rebound to the new path and the project keeps its existing home directory

#### Scenario: Second clone gets a suffixed home

- **WHEN** a second clone of a project (same `projectId`, both paths exist, not worktrees of one repo) is registered
- **THEN** it receives its own home directory with an integer suffix while the first clone's home is untouched

#### Scenario: Worktrees resolve to one home

- **WHEN** a git worktree of an already-registered project is registered
- **THEN** both paths map to the same home directory

#### Scenario: Worktree-first registration names the home after the main repo

- **WHEN** a git worktree (e.g. `.claude/worktrees/feature`) is the FIRST path to register a project whose main repository directory is `my-app`
- **THEN** the newly created shared home's readable prefix SHALL derive from `my-app` (the main repo), not from the worktree directory name
- **AND** the `<shortHash>` SHALL still derive from the `projectId`

### Requirement: Registry self-healing

On CLI runs that resolve a project root carrying a `projectId`, the system SHALL keep the registry consistent with reality — refreshing the entry when the path binding, name, or mode changed, and periodically updating `lastSeen` — without user action. Self-healing SHALL be best-effort: registry problems SHALL never fail or visibly slow the user's command. Self-healing SHALL NEVER rename, re-derive, or re-create an existing home directory: a registry entry's `home` is fixed once assigned, and refreshing an entry (including a path-exact update or a worktree share) SHALL reuse the existing `home` unchanged.

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
