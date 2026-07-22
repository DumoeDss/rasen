# project-registry Specification

## Purpose
Define the machine-wide project identity and home directory system: how a project acquires a stable `projectId`, how that identity is recorded in a machine-wide registry, and how each project's externalized machine home directory is resolved, shared across clones/worktrees, self-healed, and garbage-collected.

## Requirements
### Requirement: Stable project identity

Every Rasen project SHALL have a stable `projectId` recorded in its `rasen/config.yaml` (or `config.yml`). The identity SHALL survive repo moves and renames, and re-running `rasen init` on a project that already has a `projectId` SHALL preserve it. For projects initialized before this capability existed, the first command that actually requires the machine home SHALL mint a `projectId` and add it to the config file; commands that do not require the machine home SHALL NOT write into the repository.

#### Scenario: Init mints a projectId once

- **WHEN** `rasen init` runs in a project whose config has no `projectId`
- **THEN** a new unique `projectId` is written to the project config
- **AND** a subsequent `rasen init` leaves that `projectId` unchanged

#### Scenario: Legacy project acquires identity lazily

- **WHEN** a command that needs the machine home runs in a project whose config predates `projectId`
- **THEN** a `projectId` is added to the existing config file without discarding the file's other content and comments

#### Scenario: Read-only commands never dirty the repo

- **WHEN** a command that does not need the machine home (e.g. `rasen list`) runs in a project without a `projectId`
- **THEN** no file inside the repository is created or modified

### Requirement: Machine-wide project registry

The system SHALL maintain a machine-wide registry at `<global data dir>/projects/registry.json` mapping each project's canonical absolute path to its `projectId`, display `name`, planning `mode` (`in-repo` or `store`), home directory name, and `lastSeen` timestamp. Registry updates SHALL be atomic and serialized under a lock so that concurrent Rasen processes cannot corrupt or lose entries. A malformed registry SHALL produce a clear diagnostic naming the file, and SHALL never crash commands that do not need the registry.

#### Scenario: Concurrent registration is safe

- **WHEN** two Rasen processes register projects at the same time
- **THEN** both entries are present in the registry afterwards and the file remains valid JSON

#### Scenario: Windows paths are canonicalized

- **WHEN** a project at `E:\Work\My-App` is registered and later commands run from `e:\work\my-app` on a case-insensitive filesystem
- **THEN** both resolve to one registry entry (paths are canonicalized before use as keys, using platform path handling rather than hardcoded separators)

### Requirement: Per-project machine home

Each registered project SHALL have a home directory `<global data dir>/projects/<name>-<shortHash>/`, where `<name>` derives from the project directory name and `<shortHash>` from the `projectId`, so home names are human-readable and collision-free. The home's internal layout SHALL reserve `changes/<change-name>/work/` for process ephemera and `archive/` for externally archived changes, exposed to other subsystems through a single exported resolver API (`resolveProjectHome`) that returns absolute paths. The resolver SHALL offer a non-mutating probe mode that reports the home without creating identity or directories.

#### Scenario: Resolver yields stable absolute paths

- **WHEN** `resolveProjectHome` is called for a registered project
- **THEN** it returns the absolute home directory plus derived `work` and `archive` locations built with platform path joining

#### Scenario: Probe mode does not create state

- **WHEN** the resolver is called in probe (non-ensuring) mode for a project with no identity
- **THEN** it reports that no home exists and creates neither config changes, registry entries, nor directories

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

### Requirement: Doctor surfaces pending legacy ephemera with the migration hint

`rasen doctor`'s machine-home section SHALL report, for a registered project, whether legacy in-repo ephemera eligible for migration exist and suggest `rasen work migrate`, in both human and `--json` output. The count SHALL be split into tracked and untracked (using the same read-only git classification `rasen work migrate` uses) so the suggested command's likely effect is honest — a project whose pending ephemera are mostly tracked would move 0 files on a default run, and the hint SHALL say so rather than imply otherwise. When the split itself cannot be determined (non-git root, or the git query fails), the hint SHALL report the total count with the split marked unavailable rather than guessing. The detection SHALL remain read-only and SHALL NEVER resolve or mint the machine home — doctor never moves files and never mints identity.

#### Scenario: Doctor hints at migratable ephemera with the tracked/untracked split

- **WHEN** `rasen doctor` runs in a registered project whose change directories contain a mix of tracked and untracked legacy ephemera
- **THEN** the machine-home section SHALL show both counts (e.g. "N untracked (+M tracked, needs --include-tracked)") and suggest `rasen work migrate`
- **AND** no file SHALL be moved by doctor

#### Scenario: Clean project shows no hint

- **WHEN** `rasen doctor` runs in a project with no legacy ephemera
- **THEN** the machine-home section SHALL omit the migration hint

### Requirement: Doctor reports machine-root relocation state

`rasen doctor`'s machine-home section SHALL surface the relocation lifecycle without acting on it: after a successful adoption, when an old-scheme machine-data directory still exists on disk, it SHALL note the path and that the contents were copied to the new root and are safe to delete after verifying; when adoption is pending or previously failed (the resolved default root lacks content, an old-scheme directory exists, and no environment override is set), it SHALL warn loudly with the manual remedy. Doctor SHALL remain read-only — startup owns the adoption re-attempts.

#### Scenario: Lingering old directory noted after adoption

- **WHEN** `rasen doctor` runs after a successful relocation and the old-scheme directory still exists
- **THEN** the machine-home section SHALL name the old path and state it is safe to delete after verification
- **AND** doctor SHALL NOT delete or modify it

#### Scenario: Failed relocation warned loudly

- **WHEN** `rasen doctor` runs while the default root lacks machine data, an old-scheme directory exists, and no env override is set
- **THEN** the machine-home section SHALL warn that relocation has not completed and show the manual remedy

#### Scenario: Clean state shows no relocation output

- **WHEN** no old-scheme directory exists
- **THEN** the machine-home section SHALL contain no relocation-related lines
