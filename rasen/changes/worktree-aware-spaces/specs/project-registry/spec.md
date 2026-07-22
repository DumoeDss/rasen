# project-registry Delta

## REMOVED Requirements

### Requirement: Clones fork, worktrees share, moves rebind

**Reason**: Superseded by "Clones fork, worktrees unify, moves rebind". The old rule shared the home directory across worktrees but still created a separate registry entry per worktree path, which made every worktree surface as its own planning space (one project produced 8 space rows). Worktrees now unify onto ONE entry keyed at the main checkout.

**Migration**: Existing per-worktree entries are collapsed by `rasen doctor --gc` (see "Doctor reports and garbage-collects registry rot") and pruned opportunistically on registration writes; the spaces listing hides them immediately without any registry write.

## ADDED Requirements

### Requirement: Clones fork, worktrees unify, moves rebind

Registration SHALL key a project's registry entry at its canonical root: for a path inside a git repository, the MAIN checkout's working-tree directory (the parent of `git rev-parse --git-common-dir`); for any other path, the path itself. Running Rasen in a linked worktree SHALL register or refresh the MAIN checkout's entry and SHALL NOT create a separate entry keyed at the worktree path. When the main checkout cannot be resolved or no longer exists on disk (deleted, bare repository, or git unavailable), the registering path itself SHALL be registered so work in a surviving worktree is never left without a home.

When a registered path with the same `projectId` exists elsewhere, the system SHALL still distinguish: (1) the old path no longer exists — the entry is rebound to the new canonical root keeping the same home (a moved repo keeps its state); (2) the new path is a git worktree of the same repository as a live same-id entry (reachable only through the fallback, e.g. the main checkout is gone) — the existing home is shared; (3) otherwise — an independent clone receives a distinct home named with the first free integer suffix. When the relationship cannot be determined, the system SHALL prefer forking over sharing. A newly created home's readable `<name>` prefix SHALL derive from the main repository directory when resolvable, else from the registering path's basename; the `<shortHash>` SHALL always derive from the `projectId`.

When a registration write places an entry, it SHALL prune other entries carrying the same `projectId` whose paths are live linked worktrees of the placed entry's repository (guaranteed duplicates sharing the same home), so active projects converge to one entry without waiting for garbage collection.

#### Scenario: Worktree registration refreshes the main entry

- **WHEN** a Rasen command registers from a linked worktree of a repository whose main checkout is at `E:\Work\my-app`
- **THEN** the registry entry is keyed at `E:\Work\my-app` with its display name derived from `my-app`
- **AND** no entry keyed at the worktree path is created

#### Scenario: Main checkout gone falls back to the worktree

- **WHEN** a Rasen command registers from a linked worktree whose main checkout directory has been deleted
- **THEN** the worktree path itself is registered so the work remains addressable

#### Scenario: Moved repo keeps its home

- **WHEN** a project directory is moved and a Rasen command runs from the new location
- **THEN** the registry entry is rebound to the new path and the project keeps its existing home directory

#### Scenario: Second clone gets a suffixed home

- **WHEN** a second clone of a project (same `projectId`, both paths exist, not worktrees of one repo) is registered
- **THEN** it receives its own home directory with an integer suffix while the first clone's home is untouched

#### Scenario: Registration prunes sibling duplicates

- **WHEN** a registration write places the main checkout's entry while a legacy entry keyed at one of its live linked worktrees (same `projectId`) still exists
- **THEN** the legacy worktree entry is removed in the same write and the shared home directory is untouched

## MODIFIED Requirements

### Requirement: Registry self-healing

On CLI runs that resolve a project root carrying a `projectId`, the system SHALL keep the registry consistent with reality — refreshing the entry when the path binding, name, or mode changed, and periodically updating `lastSeen` — without user action. Self-healing SHALL target the project's canonical root: a run inside a linked worktree refreshes the MAIN checkout's entry (deriving the entry's name and mode from the main checkout, never from the worktree's directory basename or branch state), falling back to the worktree path only when the main checkout cannot be resolved. Self-healing SHALL be best-effort: registry problems SHALL never fail or visibly slow the user's command. Self-healing SHALL NEVER rename, re-derive, or re-create an existing home directory: a registry entry's `home` is fixed once assigned, and refreshing an entry (including a path-exact update or a worktree share) SHALL reuse the existing `home` unchanged.

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

### Requirement: Doctor reports and garbage-collects registry rot

`rasen doctor` SHALL report the current project's registry entry (or that it is unregistered) and list dangling entries — registered paths that no longer exist. Doctor SHALL also report worktree-duplicate entries: entries whose path is a linked worktree of a repository whose main checkout is itself registered with the same `projectId`. Doctor SHALL remain read-only by default; `rasen doctor --gc` SHALL remove dangling entries, collapse worktree-duplicate entries onto the main checkout's entry (deleting the duplicate when the main checkout is registered, rebinding it to the main checkout when that root exists on disk but is not yet registered), and delete home directories that no remaining entry references. A home directory still referenced by any live entry SHALL never be deleted.

#### Scenario: Dangling entry reported

- **WHEN** a registered project's directory has been deleted and `rasen doctor` runs
- **THEN** the report lists the dangling path and suggests `rasen doctor --gc`

#### Scenario: GC removes only unreferenced homes

- **WHEN** `rasen doctor --gc` runs while a worktree entry still references the same home as a dangling entry
- **THEN** the dangling registry entry is removed but the shared home directory is kept

#### Scenario: Worktree-duplicate entries reported

- **WHEN** `rasen doctor` runs on a machine whose registry holds entries for both a main checkout and its linked worktrees under one `projectId`
- **THEN** the report lists the worktree-keyed entries as duplicates and suggests `rasen doctor --gc`
- **AND** no registry entry is modified

#### Scenario: GC collapses worktree duplicates

- **WHEN** `rasen doctor --gc` runs while entries exist for a registered main checkout and two of its live linked worktrees (same `projectId`, shared home)
- **THEN** the worktree-keyed entries are removed, the main checkout's entry remains, and the shared home directory is kept
