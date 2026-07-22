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

The Spaces page SHALL provide a create-space flow: choose project or store, pick a target directory through the local-path browsing endpoint (starting at home, with a path input accepting an explicit absolute path, and git repositories visibly marked), optionally supply a store id, and submit to the space-creation endpoint. On success the UI SHALL navigate directly into the new space's board. On failure the CLI's own error message SHALL be shown verbatim. The browser SHALL never receive filesystem access itself — every directory fact on screen comes from the local-path browsing endpoint, and the creation is performed entirely by the server-spawned CLI.

#### Scenario: Create and land in the new space

- **WHEN** the user picks a directory, chooses project, and submits
- **THEN** on success the UI routes to the new project's board without returning to a terminal

#### Scenario: Git repositories are marked in the picker

- **WHEN** the picker lists a directory containing git repositories
- **THEN** repository entries are visibly distinguished, since a space is almost always initialised into a repo

#### Scenario: CLI failure is shown verbatim

- **WHEN** the creation subprocess fails (e.g. the CLI refuses the target)
- **THEN** the flow surfaces the CLI's own error message and the user can correct the input
