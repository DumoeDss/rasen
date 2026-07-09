# store-add-project Specification

## Purpose
Govern the `store add-project <project-path> --to <store-id>` command: registering an in-repo project as a store and adding it to a target store's referenced-store list, non-destructively and idempotently, so the target store's instructions can index the project's specs without inlining them.
## Requirements
### Requirement: Add a project to a store's referenced-store list

Rasen SHALL provide a `store add-project <project-path> --to <store-id>` command that lets a store share-read an in-repo project's specs. Running it SHALL, in one invocation, register the project at `<project-path>` in the PROJECT namespace on this machine (if it is not already registered) and add that project's id as a `project:<id>` entry to the target store's referenced-store list, so the target store's instruction output carries an index of the project's specs. The `<project-path>` SHALL be resolved cross-platform (relative paths resolved against the current directory using path resolution, never string concatenation).

#### Scenario: In-repo project is added to an existing store

- **WHEN** a user runs `store add-project ./my-project --to team-store` where `./my-project` is a healthy in-repo Rasen project and `team-store` is a registered store
- **THEN** the project is registered in the project namespace on this machine
- **AND** the project is appended to `team-store`'s `rasen/config.yaml` `references:` list as a `project:<id>` entry
- **AND** the command reports the project id, the target store, and that the project remains usable in-repo

#### Scenario: Target store's instructions index the project's specs

- **WHEN** the target store is selected (`--store team-store`) for instruction assembly after the project has been added
- **THEN** the referenced-store index in the store's instructions lists the added project's specs (each spec id with its first Purpose line and a project-namespace fetch recipe)
- **AND** the project's spec content is never inlined into the store's instructions

#### Scenario: A project name that collides with a store name is not a conflict

- **WHEN** a store named `elftia` is already registered and `store add-project` resolves the project id to `elftia`
- **THEN** the project is registered as project `elftia` alongside store `elftia` without a conflict error
- **AND** the reference added to the target store is `project:elftia`

### Requirement: The command is non-destructive to the in-repo project

Adding a project to a store SHALL NOT rewrite, move, or delete any existing file in the project repo. The only file the command MAY create inside the project repo is the store identity metadata at `.rasen-store/store.yaml`. The project's `rasen/specs/`, `rasen/changes/`, and existing `rasen/config.yaml` SHALL be left exactly as they were, and the project SHALL continue to resolve as its own local (nearest) Rasen root and run every command unchanged.

#### Scenario: Only store metadata is written into the project

- **WHEN** `store add-project` registers a not-yet-registered in-repo project as a store
- **THEN** the only new path inside the project repo is `.rasen-store/store.yaml`
- **AND** no file under the project's `rasen/` directory is created, modified, or deleted

#### Scenario: In-repo workflow keeps working after the project is added

- **WHEN** the user runs normal commands (for example `status`, `list`, `new change`) from inside the project after it has been added to a store
- **THEN** the project resolves as its own nearest Rasen root exactly as before
- **AND** the referenced-store wiring on the target store does not change how the project resolves its own root

#### Scenario: The reference is written into the store's repo, not the project's

- **WHEN** the command appends the project's id to the referenced-store list
- **THEN** the edit is made to the target store's `rasen/config.yaml`
- **AND** the project's own `rasen/config.yaml` is not modified

### Requirement: Adding a project is idempotent and preserves other config

Re-running `store add-project` for a project that is already registered and already referenced by the target store SHALL succeed as a no-op that changes no files. Appending the project's id to the target store's referenced-store list SHALL de-duplicate on the store id and SHALL preserve every other field already present in the target store's config.

#### Scenario: Re-running changes nothing

- **WHEN** `store add-project ./my-project --to team-store` runs a second time with no intervening changes
- **THEN** the project is reported as already registered
- **AND** the target store's `references:` list is unchanged (no duplicate id is added)
- **AND** the command exits successfully

#### Scenario: Other config fields survive the append

- **WHEN** the target store's `rasen/config.yaml` already contains other fields (for example `store`, `quality-rules`, or an existing `references:` entry) and a new project id is appended
- **THEN** the new project id is added to the `references:` list
- **AND** all pre-existing fields and reference entries remain present and unchanged

### Requirement: The project's store id is resolved predictably

When registering the project, its id SHALL be resolved in this order: the project's existing `.rasen-store/store.yaml` id if it is already registered; otherwise an explicit id provided on the command (`--as <id>`); otherwise the kebab-cased basename of the project directory. The resolved id SHALL satisfy the id grammar and SHALL be registered in the project namespace. An id that collides with a STORE of the same name SHALL NOT be a conflict; an id that collides with another PROJECT checkout of the same name SHALL be rejected with a message naming the taken id and a fix suggesting `--as <id>` with a concrete example.

#### Scenario: Existing store metadata id wins

- **WHEN** the project already carries `.rasen-store/store.yaml` with id `proj-specs`
- **THEN** `proj-specs` is the id registered in the project namespace and referenced from the target store, regardless of the folder name

#### Scenario: Folder name is used when no id is given

- **WHEN** the project is not yet registered and no explicit `--as` id is passed
- **THEN** the kebab-cased project folder basename is used as the id (resolved cross-platform from the directory path)

#### Scenario: Project-namespace collision suggests --as

- **WHEN** the resolved id already names a different project checkout in the project namespace
- **THEN** the command fails naming the taken id and its fix suggests `--as <id>` with a concrete example (for example `--as elftia-client`)

### Requirement: The command surfaces store-metadata commit guidance

When the command creates `.rasen-store/store.yaml` inside the project repo, its human-mode output SHALL surface guidance on whether to commit or gitignore that metadata — noting that committing it lets teammates resolve the project store on their own checkouts — without editing the project's `.gitignore` or committing anything on the user's behalf.

#### Scenario: Metadata guidance is shown, not enforced

- **WHEN** the command creates `.rasen-store/store.yaml` for a newly registered project
- **THEN** the output notes that committing the metadata enables teammate resolution and that gitignoring keeps it machine-local
- **AND** the command does not modify `.gitignore` and does not create any commit

### Requirement: The target store must exist and self-reference is detected by canonical path

The `--to <store-id>` target SHALL name a store already registered on this machine; when it is not registered, the command SHALL fail with a diagnostic whose fix names creating the store first (for example `rasen store setup <store-id>`). The command SHALL reject an attempt to add a project to itself, determined by CANONICAL PATH — when the project's canonical root directory is the same directory as the target store's canonical root — with a friendly diagnostic, before writing any reference. A project and a store that merely share an id but resolve to DIFFERENT directories SHALL NOT be treated as a self-reference.

#### Scenario: Unknown target store is rejected with a setup hint

- **WHEN** `--to <store-id>` names a store that is not registered
- **THEN** the command fails with an error explaining the store is not registered
- **AND** the fix directs the user to create it first (for example `rasen store setup <store-id>`) then rerun

#### Scenario: Same directory is rejected as a self-reference

- **WHEN** the project's canonical root directory is the same directory as the target store's canonical root
- **THEN** the command fails with a friendly diagnostic that a root cannot reference itself
- **AND** no change is made to the target store's config

#### Scenario: Same id, different directory is allowed

- **WHEN** the project and the target store share an id but resolve to different canonical directories
- **THEN** the command does NOT report a self-reference
- **AND** the project is added to the target store as a `project:<id>` reference

