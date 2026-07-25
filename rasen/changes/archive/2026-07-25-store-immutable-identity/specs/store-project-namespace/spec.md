## MODIFIED Requirements

### Requirement: Registry entries carry a type and are unique per (type, id)

Each store-registry entry SHALL carry a `type` of `store` or `project`. An entry with no `type` SHALL be treated as `store`. In the project namespace, registry uniqueness SHALL remain the `(type, id)` pair. In the store namespace, an entry SHALL be identified by the Store's permanent identity, with the display alias kept as a lookup index that MAY match more than one entry — so a store and a project MAY share the same id (for example a store `elftia` and a project `elftia` coexist), and two stores MAY also share a display alias, resolved by the arity rules in `store-identity`. The id grammar SHALL be identical in both namespaces (the existing kebab-case store-id rule). Registry reads and writes SHALL preserve absent-type-as-store: an existing registry file that predates the type field SHALL parse with every entry meaning a store, and re-serializing it SHALL NOT inject a `type` key onto an entry that did not have one. The form of an entry's key SHALL be determined by the registry file's own declared version rather than inferred from the key's text.

#### Scenario: Store and project of the same id coexist

- **WHEN** a store `elftia` and a project `elftia` are both registered
- **THEN** both entries are retained as distinct registrations
- **AND** neither registration is treated as a conflict with the other

#### Scenario: Legacy entry without type reads as a store

- **WHEN** the registry file contains an entry with no `type` field
- **THEN** it is treated as a `store`-typed entry
- **AND** re-writing the registry leaves that entry without an injected `type` key (byte-stable for pre-split files)

#### Scenario: A malformed registry entry is rejected, not coerced

- **WHEN** a registry entry declares a `type` value other than `store` or `project`, its type disagrees with how it is keyed, or its key does not match the grammar its registry version declares
- **THEN** registry parsing raises an `invalid_store_registry` diagnostic naming the registry file
- **AND** the ambiguous entry is never silently coerced to a namespace

### Requirement: Conflict detection is per (type, id) and (type, canonical path)

Registration conflict checks SHALL key on the pair, not the id alone. In the project namespace an id conflict SHALL fire when an entry of that namespace already holds that id; a store and a project sharing an id SHALL NOT conflict. In the store namespace an id conflict SHALL NOT fire on a repeated display alias, because a Store is identified by its permanent identity and a repeated alias is resolved by the arity rules in `store-identity`; registering a second Store under an already-used alias SHALL succeed and SHALL warn that the alias is now ambiguous. A path conflict SHALL fire when the same canonical path is already registered under the same type, on every platform, with paths compared canonically so drive-letter case and separator form do not create or hide a conflict. When a conflict is reported on the add-project path, the message SHALL name the taken id and its fix SHALL suggest choosing a different id with `--as <id>`, including a concrete example id.

#### Scenario: Same id, different type is not a conflict

- **WHEN** a store `elftia` is registered and a project `elftia` is then registered at a different path
- **THEN** the project registration succeeds without a conflict error

#### Scenario: Same id within one namespace conflicts with an --as hint

- **WHEN** a project `elftia` is already registered and another project registration resolves to the id `elftia` at a different checkout
- **THEN** the command fails naming `elftia` as already taken in the project namespace
- **AND** the fix suggests re-running with `--as <id>` and a concrete example (for example `--as elftia-client`)

#### Scenario: A repeated store alias registers with an ambiguity warning

- **WHEN** a second Store with a different permanent identity is registered at a different path under an alias an existing Store already uses
- **THEN** the registration succeeds and both entries are retained
- **AND** a warning states that the alias now matches more than one Store and that declarations should name the permanent identity
