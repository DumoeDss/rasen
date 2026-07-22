# archive-ui Specification

## Purpose
TBD - created by archiving change ui-space-redesign-archive-page. Update Purpose after archive.
## Requirements
### Requirement: Archive is an independent route page listing the space's archived Tasks

The platform SHALL render an Archive page at the space-scoped routes `/p/<projectId>/archive` and `/s/<storeId>/archive`, reached from the shared navigation's Archive entry, replacing the placeholder that previously occupied those routes. The page SHALL derive its planning space from the URL (the same opaque-token space the rest of the shell uses) and read all data scoped to that space. It SHALL list the space's archived changes grouped into Tasks — archived changes sharing a portfolio container collapse into one archived Task, a change in no container is its own single-item Task — in reverse-chronological order, most recently archived first. Each archived Task SHALL show its name and the archive date of its changes, and SHALL link to that Task's detail page. When the space has no archived changes, the page SHALL show an explicit empty state rather than a blank page or a spinner.

#### Scenario: Archived Tasks listed most-recent-first

- **WHEN** the Archive page loads for a space with several archived changes bearing different archive dates
- **THEN** the page lists them grouped into Tasks in reverse-chronological order, the most recently archived Task first

#### Scenario: Archived changes grouped into Tasks by portfolio

- **WHEN** the space has archived changes that share a portfolio container and others that belong to no container
- **THEN** the container's archived children appear under one archived Task and each container-less change appears as its own single-item archived Task

#### Scenario: An archived Task links to its detail page

- **WHEN** the user activates an archived Task's row
- **THEN** the app navigates to that Task's detail route within the current space, built from the opaque space token and the Task id verbatim

#### Scenario: Empty archive shows an explicit state

- **WHEN** the Archive page loads for a space that has no archived changes
- **THEN** the page shows a labeled empty state, not a blank page

#### Scenario: Archive data is read within the page's space

- **WHEN** the Archive page loads for a store space `S`
- **THEN** the archive read it issues carries the `store:S` space selector, so the page shows only that space's archived changes

### Requirement: The Archive page filters by name and, in a store space, by member

The Archive page SHALL offer a search control that filters the listed archived Tasks by name, matching against the fetched listing without a further server round-trip. In a store space it SHALL additionally offer the member-chip filter used on the board, narrowing the list to Tasks attributed to the selected member; the "All" selection SHALL show every archived Task. Member attribution SHALL reuse the board's session-provenance model, and because archived Tasks rarely retain a live session, an archived Task with no attributable session SHALL appear only under "All" — the same documented ceiling the board's member filter carries. In a project space no member filter SHALL be shown.

#### Scenario: Search narrows the list by name

- **WHEN** the user types a query into the Archive search control
- **THEN** only archived Tasks whose name matches the query remain visible, filtered from the already-fetched list

#### Scenario: Member chips appear only in a store space

- **WHEN** the Archive page renders for a project space
- **THEN** no member-chip filter is shown; and when it renders for a store space, the member chips for that store's members are shown

#### Scenario: Member filter narrows by session provenance with an All fallback

- **WHEN** the user selects a member chip in a store space
- **THEN** only archived Tasks attributed to that member by session provenance remain, and an archived Task with no attributable session remains visible only under the "All" selection

### Requirement: The board's Done column is bounded and overflows into the Archive page

The board's Done column SHALL show only a bounded number of the most recent done Tasks rather than the space's entire done history. When more done Tasks exist than the column shows, the column SHALL display a footer linking to the Archive page for the current space, so the full history is one click away. The bound SHALL affect only the Done column's rendering; the other lifecycle columns and the Task-grouping and column-derivation logic SHALL be unchanged.

#### Scenario: Done column truncates and offers a link to the archive

- **WHEN** the board has more done Tasks than the Done column's bound
- **THEN** the Done column shows only the most recent Tasks up to that bound and displays a footer that links to the Archive page for the current space

#### Scenario: Small Done column shows no overflow footer

- **WHEN** the board has fewer done Tasks than the Done column's bound
- **THEN** the Done column shows all of them and no overflow footer is displayed

#### Scenario: Truncation does not affect other columns

- **WHEN** the Done column is truncated
- **THEN** the Planning, Ready, and In Progress columns still show all of their Tasks

