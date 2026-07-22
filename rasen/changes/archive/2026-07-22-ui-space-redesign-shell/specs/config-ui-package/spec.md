## REMOVED Requirements

### Requirement: Platform shell scoped to routing, layout, and API client
**Reason**: The single-project shell (project switcher, launched-outside-a-project global-only state) is superseded by a space-aware shell that derives the active project or store space from the URL and always addresses a real space.
**Migration**: The shell now uses a dual-namespace space switcher and URL-derived space scoping; the project switcher and the "no project / global only" shell state are removed in favor of the space-scoped shell described by the new requirement.

## ADDED Requirements

### Requirement: Platform shell scoped to space-aware routing, layout, and API client
The app SHALL provide a platform shell — client-side routing, an application layout with navigation and a dual-namespace space switcher, and a typed API client mirroring the served APIs' wire shapes — whose navigation offers the platform's views within the selected planning space: the board (the space home), an archive view, and the configuration page. The shell SHALL derive the active planning space from the URL (per the management-ui-shell capability) rather than from an in-memory selection store. The space switcher SHALL list registered projects and stores as two type-tagged groups and SHALL always address a real space — the shell SHALL NOT offer a "no space" / global-only shell state. The shell SHALL NOT provide a top-level Sessions page; live runs surface only through the header's running-run summary. Future task and archive modules extend the shell.

#### Scenario: Navigation offers the platform views
- **WHEN** the user explores the app's navigation within a space
- **THEN** it offers the board, the archive view, and the configuration page for the current space, with the active view indicated
- **AND** no top-level Sessions page is offered

#### Scenario: Space switcher lists both namespaces
- **WHEN** the user opens the space switcher
- **THEN** it lists the machine's registered projects and stores from the spaces API as two type-tagged groups, with the current route's space selected
- **AND** selecting a space navigates to that space's route for the current section, re-scoping the view

#### Scenario: The shell always addresses a real space
- **WHEN** the shell resolves the active space
- **THEN** it addresses a concrete project or store from the URL, and offers no "no project / global only" shell state; when no space is registered it shows a hint to run `rasen ui` inside a Rasen project
