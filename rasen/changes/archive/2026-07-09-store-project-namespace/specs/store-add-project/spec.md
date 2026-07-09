## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: The target store must already exist and cannot reference itself

**Reason**: The id-based self-reference model is superseded by a canonical-path model. With the store/project type split, a project and a store may legitimately share an id at different directories, so `resolvedProjectId === targetStore.id` is no longer a valid self-reference test.

**Migration**: Replaced by "The target store must exist and self-reference is detected by canonical path" (ADDED below), which keeps the unknown-target behavior and detects a true self-reference by same-directory comparison.

## ADDED Requirements

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
