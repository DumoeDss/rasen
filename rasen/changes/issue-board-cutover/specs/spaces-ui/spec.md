# spaces-ui Delta — issue-board-cutover

## MODIFIED Requirements

### Requirement: A space can be created from the UI and entered on success

The Spaces page SHALL provide explicit flows for creating a project, creating a new Store, and
registering an existing Store. Each flow SHALL acquire its server-local directory through the
shared chooser-style path control, starting from home in its fallback browser, accepting an
explicit absolute path, and visibly marking Git repositories. Project creation SHALL select its
target root. New-Store creation SHALL label the selection as a parent directory, require a Store
id, and state that the Store will be initialized at the child named by that id. Existing-Store
registration SHALL label the selection as an existing Store root and SHALL be a distinct user
choice, never an inferred result of Create Store.

On success the UI SHALL navigate a project to its project Board and a Store to its Issue Board. On
failure the CLI's own error message SHALL be shown verbatim. Every directory fact and native choice
SHALL refer to the management server's filesystem, and creation/registration SHALL be performed
entirely by the server-spawned CLI.

#### Scenario: Create a project and enter its Board

- **WHEN** the user selects a project directory and activates Create Project
- **THEN** on success the UI routes to `/p/<projectId>/board` without returning to a terminal

#### Scenario: Create a Store and enter its Issue Board

- **WHEN** the user chooses Create new Store, selects a parent directory, enters `team-store`, and
  submits
- **THEN** the request creates the `team-store` child of that parent and the UI routes to
  `/s/team-store/issues`

#### Scenario: Register an existing Store and enter its Issue Board

- **WHEN** the user chooses Register existing Store and selects its existing root
- **THEN** the request registers that root, never initializes it as a side effect, and routes to the
  registered Store's Issue Board

#### Scenario: Dirty path is resolved by the primary action

- **WHEN** the user browses one directory, types a different absolute directory, and immediately
  activates the flow's primary action
- **THEN** the typed visible directory is resolved and used, or its error is shown; the older
  browsed directory is not submitted

#### Scenario: Git repositories are marked in the fallback picker

- **WHEN** the picker lists a directory containing Git repositories
- **THEN** repository entries are visibly distinguished

#### Scenario: Native chooser unavailability preserves the flow

- **WHEN** native directory choice is unavailable or cancelled
- **THEN** the user can complete the same Project or Store action through the server-local fallback
  browser or an explicit absolute path

#### Scenario: CLI failure is shown verbatim

- **WHEN** the creation or registration subprocess fails
- **THEN** the flow surfaces the CLI's own error message and the user can correct the action, id, or
  path

### Requirement: A created space appears consistently across the SPA immediately

A successful create or register response SHALL publish its returned space entry to the shared
space catalog before navigation and SHALL then revalidate that catalog from the spaces endpoint.
The All Spaces page and header switcher SHALL consume that shared catalog, so both can show the new
entry without a full reload. A spaces request started before publication SHALL NOT overwrite the
published entry when it completes late; a failed revalidation SHALL leave the successful response
entry visible until a later refresh reconciles it.

Publication SHALL preserve distinct rows that share a project selector, such as worktrees, while
the header switcher may continue to present a single selector option according to its existing cap
and ordering rules. Navigation after publication SHALL use the new space's canonical home: project
Board for a project and Issue Board for a Store.

#### Scenario: New Store is immediately available on its Issue route

- **WHEN** Store creation succeeds and the SPA routes to `/s/<storeId>/issues`
- **THEN** the header switcher already contains and selects that Store without requiring a reload
  or a visit to All Spaces

#### Scenario: All Spaces and switcher receive the same entry

- **WHEN** a create response publishes a new project or Store while the Spaces page is mounted
- **THEN** the new row appears on All Spaces and the corresponding switcher option is derived from
  the same shared catalog

#### Scenario: Stale fetch cannot erase a published creation

- **WHEN** a spaces-list request started before creation completes after the successful response
  has been published
- **THEN** its older result does not remove the new entry and the post-create revalidation remains
  authoritative

#### Scenario: Revalidation failure retains successful result

- **WHEN** publication succeeds but the immediate background list refresh fails
- **THEN** the response entry remains available in both consumers and a later refresh can reconcile
  it

#### Scenario: Shared-selector worktrees remain distinct on All Spaces

- **WHEN** the shared catalog contains multiple project rows with the same selector but different
  roots
- **THEN** All Spaces retains each row while the header switcher continues its selector-level
  presentation
