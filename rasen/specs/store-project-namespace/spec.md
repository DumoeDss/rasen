# store-project-namespace Specification

## Purpose
TBD - created by archiving change store-project-namespace. Update Purpose after archive.
## Requirements
### Requirement: Registry entries carry a type and are unique per (type, id)

Each store-registry entry SHALL carry a `type` of `store` or `project`. An entry with no `type` SHALL be treated as `store`. Registry uniqueness SHALL be the `(type, id)` pair: a store and a project MAY share the same id (for example a store `elftia` and a project `elftia` coexist). The id grammar SHALL be identical in both namespaces (the existing kebab-case store-id rule). Registry reads and writes SHALL preserve absent-type-as-store: an existing registry file that predates the type field SHALL parse with every entry meaning a store, and re-serializing it SHALL NOT inject a `type` key onto an entry that did not have one.

#### Scenario: Store and project of the same id coexist

- **WHEN** a store `elftia` and a project `elftia` are both registered
- **THEN** both entries are retained as distinct `(type, id)` registrations
- **AND** neither registration is treated as a conflict with the other

#### Scenario: Legacy entry without type reads as a store

- **WHEN** the registry file contains an entry with no `type` field
- **THEN** it is treated as a `store`-typed entry
- **AND** re-writing the registry leaves that entry without an injected `type` key (byte-stable for pre-split files)

#### Scenario: A malformed registry entry is rejected, not coerced

- **WHEN** a registry entry declares a `type` value other than `store` or `project`, or its type disagrees with how it is keyed
- **THEN** registry parsing raises an `invalid_store_registry` diagnostic naming the registry file
- **AND** the ambiguous entry is never silently coerced to a namespace

### Requirement: Conflict detection is per (type, id) and (type, canonical path)

Registration conflict checks SHALL key on the pair, not the id alone. An id conflict SHALL fire only when an entry of the SAME type already holds that id; a store and a project sharing an id SHALL NOT conflict. A path conflict SHALL fire when the same canonical path is already registered under the same type. When a conflict is reported on the add-project path, the message SHALL name the taken id and its fix SHALL suggest choosing a different id with `--as <id>`, including a concrete example id.

#### Scenario: Same id, different type is not a conflict

- **WHEN** a store `elftia` is registered and a project `elftia` is then registered at a different path
- **THEN** the project registration succeeds without a conflict error

#### Scenario: Same id within one namespace conflicts with an --as hint

- **WHEN** a project `elftia` is already registered and another project registration resolves to the id `elftia` at a different checkout
- **THEN** the command fails naming `elftia` as already taken in the project namespace
- **AND** the fix suggests re-running with `--as <id>` and a concrete example (for example `--as elftia-client`)

### Requirement: --project selects the project namespace and is exclusive with --store

Every command that accepts `--store <id>` SHALL also accept `--project <id>`, selecting the entry of that id in the project namespace. `--store` and `--project` SHALL be mutually exclusive on a single invocation; passing both SHALL fail with a friendly error naming both flags, before any root resolution. A bare id (no flag, or an unprefixed reference) SHALL continue to mean the store namespace. A project-selected root SHALL resolve to a normal Rasen root with the same capabilities as a store-selected root — the type governs namespace and display only, never capability.

#### Scenario: --project resolves the project-namespace root

- **WHEN** a user runs a specs/changes command or a `pipeline` inspection command with `--project elftia`
- **THEN** the command resolves the project `elftia`'s Rasen root and behaves exactly as it would for a store root
- **AND** list/show/instructions/status/validate/archive/context operate identically

#### Scenario: Passing both --store and --project is rejected

- **WHEN** a command is invoked with both `--store x` and `--project y`
- **THEN** it fails before resolving any root with an error naming the two mutually exclusive flags
- **AND** no store or project root is selected

#### Scenario: Hints and banner for a project root use --project

- **WHEN** a command resolves a project-selected root and prints a verification banner or a pasteable follow-up hint
- **THEN** the banner identifies the project and the follow-up hint carries `--project <id>`, not `--store <id>`

### Requirement: Config references address the project namespace with a project: prefix

A `references:` entry of the form `project:<id>` SHALL address the project namespace; a bare `<id>` SHALL continue to address the store namespace. The id portion after the `project:` prefix SHALL be validated against the id grammar; an entry whose id portion is invalid SHALL drop with a warning, consistent with the existing resilient handling of the references list, rather than failing generation. A `project:`-prefixed reference SHALL render in the referenced-store index the same way a store reference does, distinguished by its type, with content never inlined.

#### Scenario: Prefixed reference resolves to the project namespace

- **WHEN** a root's config declares `references: [other-store, project:elftia]`
- **THEN** `other-store` is indexed from the store namespace and `elftia` from the project namespace
- **AND** each contributes an index of spec ids and summaries without inlining spec content

#### Scenario: Invalid prefixed id drops with a warning

- **WHEN** a references entry is `project:` followed by an id that fails the id grammar
- **THEN** the entry is dropped with a warning diagnostic and generation continues
- **AND** other valid references are unaffected

### Requirement: Fetch recipes round-trip into the correct namespace and stay shell-safe

For a project-typed referenced entry, the onboarding fetch recipe rendered into agent guidance SHALL name the project-namespace registration verb, so that a teammate following it verbatim ends with the entry in the project namespace and the `project:<id>` reference resolves. The recipe SHALL preserve the existing shell-safety gating: a clone command is emitted only for a remote that passes the shell-safe check, and any other remote SHALL fall back to the teammate-checkout wording. A rendered recipe SHALL never emit an unsafe remote or a namespace-ambiguous registration command.

#### Scenario: Project reference renders a project-namespace recipe

- **WHEN** the referenced-store index renders a fetch recipe for a project-typed, unresolved reference with a shell-safe remote
- **THEN** the recipe registers the checkout into the project namespace (so the `project:<id>` reference will resolve after the teammate runs it)

#### Scenario: Unsafe remote falls back to checkout wording

- **WHEN** a project-typed reference declares a remote that is not shell-safe
- **THEN** no clone command is emitted and the recipe falls back to the teammate-checkout wording for the project namespace
- **AND** the unsafe remote string is never rendered into an executable command

### Requirement: Pre-split project-as-store entries keep working without migration

Entries registered before the type split (bare-id store entries created by the original `store add-project`) SHALL keep working forever as store-typed entries. No migration command SHALL be required or provided to convert them. Selecting or referencing such an entry by its bare id SHALL continue to resolve exactly as before the split.

#### Scenario: A pre-split entry still resolves as a store

- **WHEN** an entry was registered by the original `store add-project` (no type field) and is selected with `--store <id>` or referenced by bare id
- **THEN** it resolves as a store-typed root exactly as it did before this change
- **AND** no migration step is needed to keep it working

