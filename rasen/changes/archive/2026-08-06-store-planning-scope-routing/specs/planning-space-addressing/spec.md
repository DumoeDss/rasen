## MODIFIED Requirements

### Requirement: Planning spaces span two explicitly-prefixed namespaces

The management platform SHALL address planning spaces through a selector string with a mandatory namespace prefix: `project:<selector>` addresses a project's effective planning scope, while `store:<id>` addresses a registered Store aggregate scope. A project selector SHALL first resolve the machine project registry exactly as the config API's existing project addressing does, including canonical absolute-root and linked-worktree resolution, and SHALL then follow the project's verified planning binding: an unbound project answers from its local planning tree and a Store-bound project answers from its project partition in the bound Store. A Store selector SHALL NOT imply any one project's Changes or specs. An endpoint that requires project content and receives only a Store aggregate scope SHALL return 400 `project_scope_required`. A selector without a recognized prefix SHALL be rejected with 400 `invalid_space`; a lookup that finds nothing SHALL yield 404 `space_not_found` naming the namespace; a registration or binding that cannot form a healthy scope SHALL yield 409 `space_unavailable` carrying the reason. Resolution SHALL remain read-only.

#### Scenario: Project space addressed by id

- **WHEN** a management request carries `space=project:<projectId>` for an unbound project present in the machine project registry
- **THEN** the request SHALL answer from that project's local planning scope

#### Scenario: Bound project space follows its Store partition

- **WHEN** a management request carries `space=project:<projectId>` and that project's verified planning binding names a Store v2 project partition
- **THEN** the request SHALL answer from that project partition
- **AND** it SHALL NOT read the execution checkout's local planning directory or the Store's flat root

#### Scenario: Store space addressed by id

- **WHEN** a management request carries `space=store:<id>` for a healthy registered Store
- **THEN** the request SHALL resolve that Store's aggregate planning scope
- **AND** an endpoint requiring one project's Changes or specs SHALL respond with `project_scope_required` rather than selecting a project implicitly

#### Scenario: Prefix is mandatory

- **WHEN** a request carries a space selector with no `project:` or `store:` prefix
- **THEN** the response SHALL be 400 with error code `invalid_space`
- **AND** no namespace SHALL be guessed

#### Scenario: Same id in both namespaces is unambiguous

- **WHEN** a Store and a project share the id `elftia` and a request carries `space=store:elftia`
- **THEN** the Store aggregate SHALL be selected, never the project's effective planning scope

#### Scenario: Unknown space

- **WHEN** a request carries a selector matching nothing in its namespace
- **THEN** the response SHALL be 404 with error code `space_not_found`
- **AND** the message SHALL name the namespace searched

#### Scenario: Unhealthy store space

- **WHEN** a registered Store or project binding cannot produce one healthy planning scope because identity metadata is missing, the Store root is unhealthy, or scope facts conflict
- **THEN** the response SHALL be 409 with error code `space_unavailable`
- **AND** it SHALL carry the stable underlying planning diagnostic

#### Scenario: Windows root-path selector resolves canonically

- **WHEN** a `project:` selector carries an absolute Windows root path differing from the registered key only by case or separator form
- **THEN** it SHALL resolve to the same project registry entry and effective planning scope via canonical path comparison

#### Scenario: Worktree root path resolves to the owning project's space

- **WHEN** a `project:` selector carries the absolute root of a linked Git worktree whose main checkout is a registered project
- **THEN** the request SHALL resolve that project's identity and effective planning binding while retaining the requested worktree as execution context
- **AND** no registry entry, identity, binding, or directory SHALL be created as a side effect

### Requirement: A working directory derives its planning space one way, everywhere

The platform SHALL derive a directory's planning scope through the shared Store-planning resolver. A qualifying local planning tree owned by an unbound project yields that standalone project scope, including configuration-only Store inheritance. A checkout with verified Store-owned planning yields its Store project scope, not the Store aggregate. A Store planning checkout yields the project scope recorded by its Change/worktree facts when complete and otherwise yields only a Store aggregate scope. Malformed, unavailable, split-truth, or conflicting facts SHALL produce the corresponding planning diagnostic rather than a guessed attribution. `rasen ui` URL emission and session space attribution SHALL consume the same result, so a session launched from a directory and a UI opened from it agree on planning ownership.

#### Scenario: Pointer repo derives its store's space

- **WHEN** derivation runs in project P's checkout and its verified planning binding names Store S
- **THEN** the derived planning scope SHALL identify Store S and project P
- **AND** it SHALL not collapse to `store:S` aggregate scope

#### Scenario: Planning-shaped repo derives its own project space

- **WHEN** derivation runs in an unbound project whose local planning tree declares a Store only for configuration inheritance
- **THEN** the derived planning scope SHALL remain that standalone project scope
- **AND** the Store SHALL appear only as inherited configuration context

#### Scenario: Store planning worktree uses recorded scope

- **WHEN** derivation runs in a Store planning worktree carrying complete verified project and target-line facts
- **THEN** it SHALL derive that Store project scope without parsing the branch name or neighboring directory

#### Scenario: Store checkout without project facts is aggregate only

- **WHEN** derivation runs in a healthy Store checkout with no complete project scope facts
- **THEN** it SHALL derive the Store aggregate scope
- **AND** project operations SHALL still require an explicit or recorded project

#### Scenario: Unresolvable pointer degrades to no space

- **WHEN** derivation encounters an unavailable Store, malformed declaration, split planning truth, or conflicting binding facts
- **THEN** it SHALL return the stable diagnostic for that state
- **AND** UI and session callers SHALL NOT attribute the directory to another available root

### Requirement: Space selection falls back to the launch project and stays read-only

When a space-parameterized management endpoint receives no selector, the daemon SHALL use its launch project as an identity and execution-context hint, then resolve that project's current effective planning scope through the same read-only resolver. The fallback SHALL NOT assume the launch checkout is the planning root. If the project is now Store-bound, the request SHALL use its Store project partition; if the binding is unavailable or inconsistent, the endpoint SHALL return the corresponding planning error rather than reading stale local content.

#### Scenario: Omitted selector keeps today's behavior

- **WHEN** the daemon launched in an unbound standalone project and a request omits `space`
- **THEN** the request SHALL answer from that project's local planning scope as before

#### Scenario: Bound launch project follows Store planning

- **WHEN** the daemon launched in a project whose verified planning truth is now Store-backed and a request omits `space`
- **THEN** the request SHALL answer from that project's Store partition
- **AND** the launch checkout SHALL remain only the execution-context hint

#### Scenario: Resolution has no side effects

- **WHEN** any management request addresses a space explicitly or through launch-project fallback
- **THEN** no registry file, project identity, Store metadata, planning binding, or directory SHALL be created or modified as a side effect
