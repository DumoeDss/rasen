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

### Requirement: Clones fork, worktrees share, moves rebind

When a project path is registered whose `projectId` is already registered at another path, the system SHALL distinguish three cases: (1) the old path no longer exists — the entry is rebound to the new path keeping the same home (a moved repo keeps its state); (2) the new path is a git worktree of the same repository — the new path shares the existing home (worktrees share ephemera); (3) otherwise — the new path is an independent clone and receives a distinct home named with the first free integer suffix (`<name>-<shortHash>-2`, `-3`, …). When the relationship cannot be determined, the system SHALL prefer forking over sharing.

#### Scenario: Moved repo keeps its home

- **WHEN** a project directory is moved and a Rasen command runs from the new location
- **THEN** the registry entry is rebound to the new path and the project keeps its existing home directory

#### Scenario: Second clone gets a suffixed home

- **WHEN** a second clone of a project (same `projectId`, both paths exist, not worktrees of one repo) is registered
- **THEN** it receives its own home directory with an integer suffix while the first clone's home is untouched

#### Scenario: Worktrees resolve to one home

- **WHEN** a git worktree of an already-registered project is registered
- **THEN** both paths map to the same home directory

### Requirement: Registry self-healing

On CLI runs that resolve a project root carrying a `projectId`, the system SHALL keep the registry consistent with reality — refreshing the entry when the path binding, name, or mode changed, and periodically updating `lastSeen` — without user action. Self-healing SHALL be best-effort: registry problems SHALL never fail or visibly slow the user's command.

#### Scenario: Self-heal survives a broken registry

- **WHEN** the registry file is corrupt and the user runs an ordinary command
- **THEN** the command completes normally

#### Scenario: Unchanged state does not rewrite the registry

- **WHEN** a command runs in a project whose registry entry is current and recently seen
- **THEN** the registry file is not rewritten

### Requirement: Doctor reports and garbage-collects registry rot

`rasen doctor` SHALL report the current project's registry entry (or that it is unregistered) and list dangling entries — registered paths that no longer exist. Doctor SHALL remain read-only by default; `rasen doctor --gc` SHALL remove dangling entries and delete home directories that no remaining entry references. A home directory still referenced by any live entry SHALL never be deleted.

#### Scenario: Dangling entry reported

- **WHEN** a registered project's directory has been deleted and `rasen doctor` runs
- **THEN** the report lists the dangling path and suggests `rasen doctor --gc`

#### Scenario: GC removes only unreferenced homes

- **WHEN** `rasen doctor --gc` runs while a worktree entry still references the same home as a dangling entry
- **THEN** the dangling registry entry is removed but the shared home directory is kept

### Requirement: Doctor surfaces pending legacy ephemera with the migration hint

`rasen doctor`'s machine-home section SHALL report, for a registered project, whether legacy in-repo ephemera eligible for migration exist and suggest `rasen work migrate`, in both human and `--json` output. The count SHALL be split into tracked and untracked (using the same read-only git classification `rasen work migrate` uses) so the suggested command's likely effect is honest — a project whose pending ephemera are mostly tracked would move 0 files on a default run, and the hint SHALL say so rather than imply otherwise. When the split itself cannot be determined (non-git root, or the git query fails), the hint SHALL report the total count with the split marked unavailable rather than guessing. The detection SHALL remain read-only and SHALL NEVER resolve or mint the machine home — doctor never moves files and never mints identity.

#### Scenario: Doctor hints at migratable ephemera with the tracked/untracked split

- **WHEN** `rasen doctor` runs in a registered project whose change directories contain a mix of tracked and untracked legacy ephemera
- **THEN** the machine-home section SHALL show both counts (e.g. "N untracked (+M tracked, needs --include-tracked)") and suggest `rasen work migrate`
- **AND** no file SHALL be moved by doctor

#### Scenario: Clean project shows no hint

- **WHEN** `rasen doctor` runs in a project with no legacy ephemera
- **THEN** the machine-home section SHALL omit the migration hint
