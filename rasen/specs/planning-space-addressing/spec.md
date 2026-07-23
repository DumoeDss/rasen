# planning-space-addressing Specification

## Purpose
Define the planning-space addressing model — two explicitly-prefixed namespaces (project and store), a single working-directory derivation rule, read-only fallback to the launch project, and a space-agnostic daemon — so every API read resolves the same space the same way, including live worktree inventory.
## Requirements
### Requirement: Planning spaces span two explicitly-prefixed namespaces
The management platform SHALL address planning spaces through a single selector string with a mandatory namespace prefix: `project:<selector>` addresses the machine project registry (the selector portion accepted as a project id or an absolute root path, resolved exactly like the config API's existing project addressing), and `store:<id>` addresses a registered store by id in the store namespace. A `project:` selector carrying an absolute path that is not itself a registered root but is a linked git worktree of a registered project SHALL resolve to that project's identity (its registered `projectId` and name) with the requested worktree path as the answering root, so a worktree's branch-local planning state is addressable without the worktree becoming a separate space; this resolution SHALL remain read-only (no registration, identity minting, or directory creation). A selector without a recognized prefix SHALL be rejected with 400 `invalid_space` — never guessed into a namespace — because a project and a store may legitimately share an id. A selector whose namespace lookup finds nothing SHALL yield 404 `space_not_found` naming the namespace searched; a `store:` selector whose registration exists but fails read-only health inspection (missing or mismatched identity metadata, unhealthy planning root) SHALL yield 409 `space_unavailable` carrying the inspection reason.

#### Scenario: Project space addressed by id
- **WHEN** a management request carries `space=project:<projectId>` for a project present in the machine project registry
- **THEN** the request answers for that project's planning root

#### Scenario: Store space addressed by id
- **WHEN** a management request carries `space=store:<id>` for a healthy registered store
- **THEN** the request answers for that store's planning root

#### Scenario: Prefix is mandatory
- **WHEN** a request carries a space selector with no `project:` or `store:` prefix
- **THEN** the response is 400 with error code `invalid_space` and no namespace is guessed

#### Scenario: Same id in both namespaces is unambiguous
- **WHEN** a store and a project share the id `elftia` and a request carries `space=store:elftia`
- **THEN** the store's planning root is selected, never the project's

#### Scenario: Unknown space
- **WHEN** a request carries a selector matching nothing in its namespace
- **THEN** the response is 404 with error code `space_not_found` and a message naming the namespace searched

#### Scenario: Unhealthy store space
- **WHEN** a request addresses a registered store whose identity metadata is missing or whose planning root is unhealthy
- **THEN** the response is 409 with error code `space_unavailable` and the inspection reason

#### Scenario: Windows root-path selector resolves canonically
- **WHEN** a `project:` selector carries an absolute Windows root path differing from the registered key only by case or separator form
- **THEN** it resolves to the same registry entry via canonical path comparison

#### Scenario: Worktree root path resolves to the owning project's space
- **WHEN** a `project:` selector carries the absolute root path of a linked git worktree whose main checkout is a registered project
- **THEN** the request resolves to that project's identity and answers from the worktree's own planning root
- **AND** no registry entry, identity, or directory is created as a side effect

### Requirement: Space selection falls back to the launch project and stays read-only
Every space-parameterized management endpoint SHALL treat a missing or empty space selector as addressing the server's launch project (the root resolved from the daemon's own cwd at startup), so existing clients keep working unchanged. Server-side space resolution SHALL be non-mutating: answering a request never registers a project, mints identity, writes store metadata, or creates directories, in either namespace.

#### Scenario: Omitted selector keeps today's behavior
- **WHEN** a client sends `GET /api/v1/changes` with no space selector on a daemon launched inside a project
- **THEN** the response is identical to the pre-space behavior for that launch project

#### Scenario: Resolution has no side effects
- **WHEN** any management request addresses a space (explicitly or by fallback)
- **THEN** no registry file, project identity, store metadata, or directory is created or modified as a side effect of answering it

### Requirement: The daemon is space-agnostic; the launch project is only a default hint
The resident daemon SHALL serve any addressable planning space regardless of the directory it was started from. The launch project SHALL survive only as a default hint: reported by `/api/v1/health` and `/api/v1/status` as today, and used as the fallback when a request omits the space selector. No management data endpoint SHALL require the daemon to have been started inside the space it is asked about.

#### Scenario: Daemon serves a project it was not launched in
- **WHEN** the daemon was started in project A and a request selects registered project B
- **THEN** changes, runs, submission, and session launch all operate on B without restarting the daemon

#### Scenario: Health still reports the hint
- **WHEN** a client probes `/api/v1/health` or `/api/v1/status`
- **THEN** the response carries the launch project reference (or null) exactly as before

### Requirement: A working directory derives its planning space one way, everywhere
The platform SHALL derive the planning space of a directory by one shared rule: the nearest qualifying `rasen/` root wins; a root with planning shape is a project space (identified by its registered project id); a config-only root whose `store:` pointer names a registered store is that store's space; a malformed pointer or an unregistered store yields no space, degrading gracefully (no error, no space attribution). `rasen ui` URL emission and session space attribution SHALL both use this rule, so a session launched from a directory and a UI opened from that directory always agree on the space.

#### Scenario: Pointer repo derives its store's space
- **WHEN** the derivation runs in a repo whose `rasen/` holds only a config with `store: team-store` and `team-store` is registered
- **THEN** the derived space is `store:team-store` with the store's planning root

#### Scenario: Planning-shaped repo derives its own project space
- **WHEN** the derivation runs in a repo whose `rasen/` has specs or changes directories
- **THEN** the derived space is that repo's project space, even if a stray store pointer is also present

#### Scenario: Unresolvable pointer degrades to no space
- **WHEN** the derivation runs where the `store:` pointer is malformed or names an unregistered store
- **THEN** no space is derived and the caller proceeds without space attribution rather than failing

### Requirement: Space listing returns both namespaces with type tags, dead entries filtered, store members included
The management API SHALL provide `GET /api/v1/spaces` returning every addressable planning space: in-repo projects from the machine project registry as `{ type: "project", id, name, root }`, and registered stores as `{ type: "store", id, name, root, members }`. The listing SHALL present ONE project entry per project identity: legacy registry entries that are worktree duplicates of one project (same `projectId`, same shared home) SHALL collapse into a single entry presented at the main checkout's root when that can be determined live from git, without modifying the registry. A project entry SHALL carry a live worktree count (`worktreeCount`) when its root is a git repository with more than one worktree; the count is derived from git at read time and never persisted. Entries whose root no longer exists on disk SHALL be filtered out (read-only filtering; registry pruning remains `rasen doctor --gc`'s job). A registry entry for a repo whose planning is externalized to a store SHALL appear as that store's member — never as a top-level space — and a project-registry entry whose canonical root is a registered store's own root SHALL be presented as the store space only, not duplicated as a project. Each store's `members` SHALL list the member projects derived from the machine registry's pointer-repo entries, validated at read time against each member repo's own current `store:` declaration, with members whose root no longer exists filtered out.

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
- **THEN** `team-store`'s `members` includes M, and a repo whose pointer no longer names `team-store` is excluded at read time

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

