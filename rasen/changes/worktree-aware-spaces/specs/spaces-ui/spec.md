# spaces-ui Delta

## MODIFIED Requirements

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
