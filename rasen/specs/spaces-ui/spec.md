# spaces-ui Specification

## Purpose
Define the web UI's Spaces page and the header space switcher's cap-and-escape behavior: a single place to browse, search, pin, and create every addressable planning space, replacing an unbounded header switcher as the machine's space count grows.

## Requirements

### Requirement: A Spaces page lists, searches, and pins every addressable space

The web UI SHALL provide a `/spaces` route — space-agnostic, carrying no space prefix — that lists every addressable planning space from the spaces listing endpoint: projects and stores type-tagged, with each store's member projects visible on its row. A project row whose listing entry reports a live worktree count greater than one SHALL display that count as a worktree badge, so a multi-worktree project is recognizable as one space with several working areas rather than several spaces. The page SHALL offer client-side search filtering entries by id, name, or root path (case-insensitive, no server round-trip), and pinning: pinned spaces sort before unpinned ones, and pins persist in the `ui.pinnedSpaces` global configuration key (an array of `<type>:<id>` space selectors) written through the existing config write path, so pins survive a browser change and remain visible to the CLI. Selecting a space navigates to that space's route exactly like the header switcher does. A pinned selector that matches no listed space SHALL be retained in configuration but not rendered.

#### Scenario: Search narrows the listing client-side

- **WHEN** the user types a fragment matching one project's name on a machine with 40 spaces
- **THEN** the listing narrows to matching entries without any additional network request

#### Scenario: Pin persists and reorders

- **WHEN** the user pins a store and reloads the UI in a different browser
- **THEN** `ui.pinnedSpaces` contains that store's selector, and the store sorts ahead of unpinned spaces on the page

#### Scenario: Any space reachable in two interactions

- **WHEN** a machine has 40 spaces and the user opens `/spaces`
- **THEN** any space is reachable by search-and-click or by a pin, in two interactions

#### Scenario: Dead pin does not break the page

- **WHEN** `ui.pinnedSpaces` contains a selector matching no listed space
- **THEN** the page renders normally without that entry and the pin value is not modified

#### Scenario: Worktree badge on a multi-worktree project

- **WHEN** the listing reports a project entry with `worktreeCount: 3`
- **THEN** that project's single row shows a badge indicating 3 worktrees
- **AND** a project entry without a worktree count shows no badge

### Requirement: The header switcher is capped with an escape to the Spaces page

The header space switcher SHALL keep its fast-path form but render at most 8 space entries — pinned spaces first, then most-recently-visited — plus a trailing "All spaces…" item that navigates to `/spaces` instead of switching space. The currently active space SHALL always appear even when outside the cap. Recency SHALL be tracked client-side from space-route visits; it never writes configuration.

#### Scenario: Switcher stays small at scale

- **WHEN** the machine has 40 spaces and 2 are pinned
- **THEN** the switcher shows the pinned 2, recent spaces up to the cap of 8, and "All spaces…" — never all 40

#### Scenario: All spaces item routes to the page

- **WHEN** the user selects "All spaces…"
- **THEN** the UI navigates to `/spaces` and the current space is unchanged

#### Scenario: Active space always present

- **WHEN** the current space is neither pinned nor recent
- **THEN** it still appears (selected) in the switcher

### Requirement: A space can be created from the UI and entered on success

The Spaces page SHALL provide explicit flows for creating a project, creating a new Store, and registering an existing Store. Each flow SHALL acquire its server-local directory through the shared chooser-style path control, starting from home in its fallback browser, accepting an explicit absolute path, and visibly marking git repositories. Project creation SHALL select its target root. New-Store creation SHALL label the selection as a parent directory, require a Store id, and state that the Store will be initialized at the child named by that id. Existing-Store registration SHALL label the selection as an existing Store root and SHALL be a distinct user choice, never an inferred result of Create Store.

On success the UI SHALL navigate directly into the new space's board. On failure the CLI's own error message SHALL be shown verbatim. Every directory fact and native choice SHALL refer to the management server's filesystem, and creation/registration SHALL be performed entirely by the server-spawned CLI.

#### Scenario: Create a project and enter it

- **WHEN** the user selects a project directory and activates Create Project
- **THEN** on success the UI routes to the new project's board without returning to a terminal

#### Scenario: Create a Store from parent plus id

- **WHEN** the user chooses Create new Store, selects a parent directory, enters `team-store`, and submits
- **THEN** the request explicitly creates a Store whose root is the `team-store` child of that parent and the UI routes to its board

#### Scenario: Register an existing Store explicitly

- **WHEN** the user chooses Register existing Store, selects its existing root, and submits
- **THEN** the request explicitly registers that root and never offers to initialize it as a side effect

#### Scenario: Dirty path is resolved by the primary action

- **WHEN** the user browses one directory, types a different absolute directory, and immediately activates the flow's primary action
- **THEN** the typed visible directory is resolved and used, or its error is shown; the older browsed directory is not submitted

#### Scenario: Git repositories are marked in the fallback picker

- **WHEN** the picker lists a directory containing git repositories
- **THEN** repository entries are visibly distinguished, since a space is usually initialized into or registered from a repository

#### Scenario: Native chooser unavailability preserves the flow

- **WHEN** native directory choice is unavailable or cancelled
- **THEN** the user can complete the same Project or Store action through the server-local fallback browser or an explicit absolute path

#### Scenario: CLI failure is shown verbatim

- **WHEN** the creation or registration subprocess fails
- **THEN** the flow surfaces the CLI's own error message and the user can correct the action, id, or path

### Requirement: A created space appears consistently across the SPA immediately

A successful create or register response SHALL publish its returned space entry to the shared space catalog before navigation and SHALL then revalidate that catalog from the spaces endpoint. The All Spaces page and header switcher SHALL consume that shared catalog, so both can show the new entry without a full reload. A spaces request started before publication SHALL NOT overwrite the published entry when it completes late; a failed revalidation SHALL leave the successful response entry visible until a later refresh reconciles it.

Publication SHALL preserve distinct rows that share a project selector, such as worktrees, while the header switcher may continue to present a single selector option according to its existing cap and ordering rules.

#### Scenario: New Store is immediately available in the switcher

- **WHEN** Store creation succeeds and the SPA routes to the Store board
- **THEN** the header switcher already contains and selects that Store without requiring a reload or a later visit to All Spaces

#### Scenario: All Spaces and switcher receive the same entry

- **WHEN** a create response publishes a new project or Store while the Spaces page is mounted
- **THEN** the new row appears on All Spaces and the corresponding switcher option is derived from the same shared catalog

#### Scenario: Stale fetch cannot erase a published creation

- **WHEN** a spaces-list request started before creation completes after the successful response has been published
- **THEN** its older result does not remove the new entry, and the post-create revalidation remains authoritative

#### Scenario: Revalidation failure retains successful result

- **WHEN** publication succeeds but the immediate background list refresh fails
- **THEN** the response entry remains available in both consumers and a later refresh can reconcile it

#### Scenario: Shared-selector worktrees remain distinct on All Spaces

- **WHEN** the shared catalog contains multiple project rows with the same selector but different roots
- **THEN** All Spaces retains each row while the header switcher continues its selector-level presentation
