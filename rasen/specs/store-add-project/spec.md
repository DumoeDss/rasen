# store-add-project Specification

## Purpose
Govern the `store add-project <project-path> --to <store-id>` command: registering an in-repo project as a store and adding it to a target store's referenced-store list, non-destructively and idempotently, so the target store's instructions can index the project's specs without inlining them.
## Requirements
### Requirement: Add a project to a store's referenced-store list

Rasen SHALL provide a `store add-project <project-path> --to <store-id>` command that lets a store share-read an in-repo project's specs. Running it SHALL, in one invocation, register the project at `<project-path>` in the PROJECT namespace on this machine (if it is not already registered), write the target store's membership record for that project, add that project's id as a `project:<id>` entry to the target store's referenced-store list so the target store's instruction output carries an index of the project's specs, and add a membership locator hint to the project's own configuration. Membership SHALL be established in the order and with the repair reporting defined by `store-project-membership`; the referenced-store entry SHALL remain a documentation index and SHALL NOT be treated as membership authority. The command SHALL NOT change which store the project plans in unless the user explicitly opts in, as governed by "Binding the project's planning Store is an explicit opt-in that never overwrites". The `<project-path>` SHALL be resolved cross-platform (relative paths resolved against the current directory using path resolution, never string concatenation).

#### Scenario: In-repo project is added to an existing store

- **WHEN** a user runs `store add-project ./my-project --to team-store` where `./my-project` is a healthy in-repo Rasen project and `team-store` is a registered store
- **THEN** the project is registered in the project namespace on this machine
- **AND** `team-store` gains a membership record for the project, keyed by the project's permanent identity
- **AND** the project is appended to `team-store`'s `rasen/config.yaml` `references:` list as a `project:<id>` entry
- **AND** the project's own config gains a membership locator hint naming `team-store`
- **AND** the command reports the project id, the target store, the files written in each repository, and that the project remains usable in-repo

#### Scenario: Target store's instructions index the project's specs

- **WHEN** the target store is selected (`--store team-store`) for instruction assembly after the project has been added
- **THEN** the referenced-store index in the store's instructions lists the added project's specs (each spec id with its first Purpose line and a project-namespace fetch recipe)
- **AND** the project's spec content is never inlined into the store's instructions

#### Scenario: A project name that collides with a store name is not a conflict

- **WHEN** a store named `elftia` is already registered and `store add-project` resolves the project id to `elftia`
- **THEN** the project is registered as project `elftia` alongside store `elftia` without a conflict error
- **AND** the reference added to the target store is `project:elftia`
- **AND** the membership record is keyed by the project's permanent identity, so a store and a project sharing a display name never share a record

### Requirement: The command is non-destructive to the in-repo project

Adding a project to a Store SHALL NOT rewrite, move, or delete any existing file in the project repo. The only file the command MAY create inside the project repo is the store identity metadata at `.rasen-store/store.yaml`, and the only existing file it MAY modify is `rasen/config.yaml`. Every write to that file SHALL be purely additive: the project's permanent identity when it does not yet have one (a membership record is keyed by project identity, so the identity has to exist before the record can), the membership locator hint, and — only when the user explicitly opted in and no different planning Store is already bound — the project's planning Store binding. The project's `rasen/specs/`, `rasen/changes/`, and every pre-existing field of its `rasen/config.yaml` SHALL be left exactly as they were, and the project SHALL continue to resolve as its own local (nearest) Rasen root and run every command unchanged.

#### Scenario: Only store metadata is written into the project

- **WHEN** `store add-project` registers a not-yet-registered in-repo project as a store, without the planning-binding opt-in
- **THEN** the only new path inside the project repo is `.rasen-store/store.yaml`
- **AND** the only changes to an existing file are additions to `rasen/config.yaml`: the project's permanent identity, minted only if it had none, and the appended membership locator hint
- **AND** every field the project's `rasen/config.yaml` already carried is present and unchanged
- **AND** no file under the project's `rasen/specs/` or `rasen/changes/` is created, modified, or deleted

#### Scenario: In-repo workflow keeps working after the project is added

- **WHEN** the user runs normal commands (for example `status`, `list`, `new change`) from inside the project after it has been added to a store
- **THEN** the project resolves as its own nearest Rasen root exactly as before
- **AND** the referenced-store wiring on the target store does not change how the project resolves its own root
- **AND** the membership hint does not change which store the project inherits configuration from

#### Scenario: The reference is written into the store's repo, not the project's

- **WHEN** the command appends the project's id to the referenced-store list
- **THEN** the edit is made to the target store's `rasen/config.yaml`
- **AND** the project's own `rasen/config.yaml` never receives a referenced-store entry — only its own membership locator hint and the permanent identity that hint's record is keyed by

### Requirement: Adding a project is idempotent and preserves other config

Re-running `store add-project` for a project that is already registered, already recorded as a member, already referenced by the target store, and already carrying the locator hint SHALL succeed as a no-op that changes no files. Appending the project's id to the target store's referenced-store list SHALL de-duplicate on the store id, appending the project's membership hint SHALL de-duplicate on the store's permanent identity, and both SHALL preserve every other field already present in the affected config.

#### Scenario: Re-running changes nothing

- **WHEN** `store add-project ./my-project --to team-store` runs a second time with no intervening changes
- **THEN** the project is reported as already registered and already a member
- **AND** the target store's `references:` list is unchanged (no duplicate id is added) and its membership record is unchanged
- **AND** the project's membership hints are unchanged (no duplicate entry is added)
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

### Requirement: Each repository receives only its own half of the membership

Adding a project to a Store SHALL write the Store's authority record into the Store's repository and the project's locator hint into the project's repository, and nothing else in either. The Store's referenced-project entry SHALL continue to be written into the Store's own config, never the project's. The project-side write SHALL be limited to appending the membership hint, the project's permanent identity when it has none yet, and the planning Store binding when and only when the user explicitly opted in; the project's specs, changes, and every other configuration field SHALL be left exactly as they were. The two repositories SHALL be written in the order defined by `store-project-membership`, and the command SHALL report the files written in each, naming the planning binding separately from the membership whenever it was written.

#### Scenario: The authority record goes to the Store and the hint to the project

- **WHEN** `store add-project ./my-project --to team-store` completes
- **THEN** the Store's repository gains the membership record for that project and the referenced-project entry in the Store's own config
- **AND** the project's repository gains the membership hint in its `rasen/config.yaml`, and the permanent identity that record is keyed by if it had none
- **AND** nothing else in the project's repository changes

#### Scenario: No other project file is touched

- **WHEN** the command writes the project's membership hint
- **THEN** nothing under the project's `rasen/specs/` or `rasen/changes/` changes
- **AND** every configuration field the project already had is still present and unchanged

#### Scenario: Each repository gets its own commit suggestion

- **WHEN** the command completes
- **THEN** it prints one suggested, path-scoped commit command for the Store repository and one for the project repository
- **AND** neither has been executed

### Requirement: Binding the project's planning Store is an explicit opt-in that never overwrites

Adding a project to a Store SHALL NOT change which Store the project plans in unless the user explicitly asks for it with a dedicated opt-in option. The opt-in SHALL default to off and SHALL NOT be inferred from any other flag, from the project's current state, or from the Store being the project's only membership. When the opt-in is given and the project has no planning Store, the command SHALL record the target Store as the project's planning Store. When the opt-in is given and the project already plans in a DIFFERENT Store, the command SHALL refuse to change it, naming the Store currently bound, the Store requested, and the command that rebinds it deliberately. When the project already plans in the target Store, the opt-in SHALL be a no-op that succeeds. A refusal SHALL leave the project's planning Store exactly as it was, while the membership record and locator this command establishes SHALL still stand.

#### Scenario: Planning binding is untouched by default

- **WHEN** `store add-project ./my-project --to team-store` runs without the opt-in
- **THEN** the project's membership record and locator hint are written
- **AND** the project's planning Store is exactly what it was before, whether that was another Store or none at all

#### Scenario: Opt-in binds a project that had no planning Store

- **WHEN** the user passes the opt-in for a project that declares no planning Store
- **THEN** the target Store is recorded as the project's planning Store
- **AND** the output states that the planning binding was changed and distinguishes it from the membership that was added

#### Scenario: Opt-in refuses to overwrite a different planning Store

- **WHEN** the user passes the opt-in for a project that already plans in a different Store
- **THEN** the command refuses to change the planning Store, naming the currently bound Store, the requested Store, and the command that rebinds it deliberately
- **AND** the project's planning Store is unchanged
- **AND** the membership record and locator hint this command established are still in place

#### Scenario: Opt-in is a no-op when already bound

- **WHEN** the user passes the opt-in for a project that already plans in the target Store
- **THEN** the command succeeds, reports the binding as already in place, and rewrites nothing

#### Scenario: The opt-in is never inferred

- **WHEN** the command runs with any combination of its other options and the opt-in absent
- **THEN** no planning Store is written under any circumstance

