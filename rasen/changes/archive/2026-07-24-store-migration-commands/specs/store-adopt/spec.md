## ADDED Requirements

### Requirement: Adopt migrates an in-repo project into a store in one command
`rasen store adopt [path] --to <store-id>` SHALL move the project's planning content (specs and changes) into the target store, convert the repo to a config-only pointer (`store: <id>` in the planning config), register the project in the project namespace and the store's references, and refresh the machine registry so the project's mode is `store` immediately.

#### Scenario: Successful adopt from the repo root
- **WHEN** the user runs `rasen store adopt . --to team-store` in an in-repo project with specs and changes
- **THEN** the specs and changes appear under the store's planning root, the repo's planning directory contains only the pointer config, and `rasen status` addressed at the project resolves to the store

#### Scenario: Registry mode flips without waiting for self-heal
- **WHEN** adopt completes
- **THEN** the machine project registry entry for the repo shows mode `store` on the very next command, not after a later self-heal touch

#### Scenario: Adopt on Windows and POSIX paths
- **WHEN** the repo and the store live on different drives or filesystems
- **THEN** the migration completes by copying then deleting (never a cross-device rename), and all recorded paths are portable across platforms

### Requirement: Adopt fails closed before moving anything
Adopt SHALL validate the whole operation before any file moves: the target store must be registered and healthy, the source must have planning shape, the source must not already declare a store pointer, and no spec or change name may collide with content already in the store. Name comparison SHALL be case-insensitive on all platforms. On any precheck failure the command reports every problem found and changes nothing.

#### Scenario: Name collision aborts with a full list
- **WHEN** the store already contains a spec or change whose name (case-insensitively) matches one being adopted
- **THEN** adopt exits with an error listing every colliding name and no files have moved

#### Scenario: Already-pointed repo is rejected
- **WHEN** the repo's config already declares a `store:` pointer
- **THEN** adopt reports the existing pointer and suggests `store eject` or doctor instead of proceeding

### Requirement: Adopt records reversible ownership in the store
Adopt SHALL record a manifest entry in the store (keyed by project identity) listing the adopted spec names, change names, source repo path, and timestamp, so that the migration can be inspected and reversed later.

#### Scenario: Manifest written before source deletion
- **WHEN** adopt is interrupted after copying but before source cleanup finishes
- **THEN** the manifest entry already exists, and rerunning adopt detects the partial state and resumes to completion instead of duplicating or failing opaquely

### Requirement: Archive handling is an explicit choice on adopt
Adopt SHALL accept `--archive move|leave|external` (default `move`): `move` migrates the existing archive into the store with everything else; `leave` keeps it in the source repo; `external` relocates it to the machine home and sets the project's archive destination to external.

#### Scenario: Default moves the archive
- **WHEN** the user runs adopt without `--archive`
- **THEN** the repo's archived changes appear under the store's archive location

#### Scenario: External archive on adopt
- **WHEN** the user passes `--archive external`
- **THEN** archived changes land in the machine home's archive area and the project config records the external destination

### Requirement: Adopt is git-safe and previewable
Adopt SHALL never stage, commit, or otherwise write to any git index. It SHALL support `--dry-run` (print the full move plan, including any uncommitted files inside moved paths, and change nothing) and `--json`. On completion it SHALL print suggested, pathspec-scoped commit commands for each affected repository.

#### Scenario: Dry run shows the plan including uncommitted work
- **WHEN** the user runs adopt with `--dry-run` while some change files are uncommitted
- **THEN** the output lists every path that would move, flags the uncommitted ones, and no file or config is modified

#### Scenario: Completion prints per-repo commit suggestions
- **WHEN** adopt completes successfully
- **THEN** the output includes one suggested git commit command for the source repo (removals plus pointer config) and one for the store repo (additions), and neither has been executed
