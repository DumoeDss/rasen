## MODIFIED Requirements

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
