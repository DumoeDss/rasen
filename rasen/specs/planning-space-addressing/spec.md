# planning-space-addressing Specification

## Purpose
Define the planning-space addressing model — two explicitly-prefixed namespaces (project and store), a single working-directory derivation rule, read-only fallback to the launch project, and a space-agnostic daemon — so every API read resolves the same space the same way, including live worktree inventory.
## Requirements
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

### Requirement: The daemon is space-agnostic; the launch project is only a default hint
The resident daemon SHALL serve any addressable planning space regardless of the directory it was started from. The launch project SHALL survive only as a default hint: reported by `/api/v1/health` and `/api/v1/status` as today, and used as the fallback when a request omits the space selector. No management data endpoint SHALL require the daemon to have been started inside the space it is asked about.

#### Scenario: Daemon serves a project it was not launched in
- **WHEN** the daemon was started in project A and a request selects registered project B
- **THEN** changes, runs, submission, and session launch all operate on B without restarting the daemon

#### Scenario: Health still reports the hint
- **WHEN** a client probes `/api/v1/health` or `/api/v1/status`
- **THEN** the response carries the launch project reference (or null) exactly as before

### Requirement: A working directory derives its planning space one way, everywhere

The platform SHALL derive a directory's planning scope through the shared Store-planning resolver. A qualifying local planning tree owned by an unbound project yields that standalone project scope, including configuration-only Store inheritance. A checkout with verified Store-owned planning yields its Store project scope, not the Store aggregate. A Store planning checkout yields the project scope recorded by its Change/worktree facts when complete and otherwise yields only a Store aggregate scope. Malformed, unavailable, split-truth, or conflicting facts SHALL produce the corresponding planning diagnostic rather than a guessed attribution. `rasen ui` URL emission and session space attribution SHALL consume the same result, so a session launched from a directory and a UI opened from it agree on planning ownership.

#### Scenario: Bound project checkout derives its Store project scope

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

#### Scenario: Unresolvable or conflicting facts do not guess

- **WHEN** derivation encounters an unavailable Store, malformed declaration, split planning truth, or conflicting binding facts
- **THEN** it SHALL return the stable diagnostic for that state
- **AND** UI and session callers SHALL NOT attribute the directory to another available root

### Requirement: Space listing returns both namespaces with type tags, dead entries filtered, store members included
The management API SHALL provide `GET /api/v1/spaces` returning every addressable planning space: in-repo projects from the machine project registry as `{ type: "project", id, name, root }`, and registered stores as `{ type: "store", id, name, root, members }`. The listing SHALL present ONE project entry per project identity: legacy registry entries that are worktree duplicates of one project (same `projectId`, same shared home) SHALL collapse into a single entry presented at the main checkout's root when that can be determined live from git, without modifying the registry. A project entry SHALL carry a live worktree count (`worktreeCount`) when its root is a git repository with more than one worktree; the count is derived from git at read time and never persisted. Entries whose root no longer exists on disk SHALL be filtered out (read-only filtering; registry pruning remains `rasen doctor --gc`'s job). A registry entry for a repo whose planning is externalized to a store SHALL appear as that store's member — never as a top-level space — and a project-registry entry whose canonical root is a registered store's own root SHALL be presented as the store space only, not duplicated as a project. Each store's `members` SHALL be the union of two sources, presented once per project identity: the store's own membership records (see `store-project-membership`), and the machine registry's pointer-repo entries validated at read time against each member repo's own current `store:` declaration. Members whose root no longer exists SHALL be filtered out, and a member recorded by the store but with no live checkout on this machine SHALL be listed without a root rather than omitted. Answering the request SHALL write nothing.

#### Scenario: Both namespaces listed with type tags
- **WHEN** the machine has registered in-repo projects and registered stores
- **THEN** `GET /api/v1/spaces` lists each live project with `type: "project"` and each live store with `type: "store"` in one response

#### Scenario: Dead roots are hidden in both namespaces
- **WHEN** a registered project's or store's root directory has been deleted from disk
- **THEN** it is absent from the spaces listing and the registry file is not modified

#### Scenario: Store root is not double-listed
- **WHEN** a store's own root is also present in the machine project registry
- **THEN** the spaces listing presents it once, as the store space

#### Scenario: Members reflect current pointers
- **WHEN** repo M's registry entry marks it as a pointer repo and M's config currently declares `store: team-store`
- **THEN** `team-store`'s `members` includes M, and a repo whose pointer no longer names `team-store` is excluded from the pointer-derived half at read time

#### Scenario: Pointer repos are members, not spaces
- **WHEN** a repo's planning is externalized to a store
- **THEN** that repo appears in the store's `members` and not as a top-level space

#### Scenario: Worktree duplicates collapse to one row
- **WHEN** a legacy registry holds entries for a main checkout and three of its live linked worktrees under one `projectId` and shared home
- **THEN** the spaces listing presents exactly one project entry for that identity, rooted at the main checkout
- **AND** the registry file is not modified

#### Scenario: Project entry reports its live worktree count
- **WHEN** a registered project's repository has a main checkout and two linked worktrees
- **THEN** the project's listing entry carries `worktreeCount: 3`, derived from git at read time

#### Scenario: Independent clones stay separate rows
- **WHEN** two independent clones of one project (same `projectId`, distinct homes) are both registered
- **THEN** the listing keeps them as two project entries — the collapse applies only to worktree duplicates sharing one home

#### Scenario: A recorded member appears without pointing at the store
- **WHEN** a store records project P as a knowledge member and P's own config declares a different store as its planning store
- **THEN** the store's `members` includes P
- **AND** P is still listed as its own top-level project space, because membership is not a planning binding

#### Scenario: A member with no local checkout is listed without a root
- **WHEN** a store records a project as a member and that project has no live checkout on this machine
- **THEN** the member is listed with its project identity and display name and no root
- **AND** the listing does not omit it and does not fabricate a path

### Requirement: Worktree inventory is derived live from git and never persisted

The management API SHALL provide `GET /api/v1/spaces/worktrees` answering for a space selector (resolved with the same rules and error contract as every other space-parameterized endpoint): the live worktree inventory of the resolved space root, derived from `git worktree list` at read time. Each inventory entry SHALL report the worktree's absolute root, its checked-out branch (or that it is detached), whether it is the main checkout, and the count of active changes in that worktree's own planning directory using the same active-change definition as the changes listing. A resolved root that is not a git repository SHALL yield an empty inventory, not an error. The inventory SHALL never be persisted: answering the request writes no registry, config, or directory state, and a worktree added or removed on disk is reflected on the next read without any repair step. The server MAY reuse a probe result across reads within a short process-local freshness window (in-memory only, dying with the process), provided a worktree addition or removal invalidates the reuse immediately — structural staleness is never acceptable, while branch or commit staleness within the window is.

#### Scenario: Inventory lists main and linked worktrees with per-worktree facts

- **WHEN** a client requests the worktree inventory for a project space whose repository has a main checkout on `main` and a linked worktree on branch `feat/x` containing two active changes
- **THEN** the response lists both worktrees with their roots and branches, marks the main checkout, and reports `2` active changes for the linked worktree

#### Scenario: Non-git space yields an empty inventory

- **WHEN** a client requests the worktree inventory for a space whose root is not a git repository
- **THEN** the response is a successful empty inventory

#### Scenario: Inventory is self-healing without persistence

- **WHEN** a worktree is removed on disk after a client fetched an inventory that included it
- **THEN** the next inventory read no longer lists it, and no registry or gc step was required

#### Scenario: Repeated reads within the freshness window reuse one probe

- **WHEN** multiple inventory reads for one space arrive within the server's short freshness window and no worktree was added or removed
- **THEN** they are answered from one underlying git probe, and a worktree added or removed during the window is still reflected on the very next read
