# management-ui-shell Specification

## Purpose
Make the management UI shell space-aware: the URL is the source of truth for the selected planning space, launch URLs bootstrap to canonical space routes, a switcher spans both namespaces, the header's running-run summary scopes to the current space, and a shared client seam threads the space selector onto every API call.
## Requirements
### Requirement: The URL is the source of truth for the selected planning space

The management UI SHALL carry the selected planning space in the URL path — `/p/<projectId>/…`
for a project space and `/s/<storeId>/…` for a Store space — and SHALL derive the active space from
the current route, not from any in-memory store. A refresh, a deep link, or a second browser tab
SHALL each resolve their own space from their own URL independently, with no shared mutable space
state between them. Project Board and Task Detail SHALL live only under project prefixes; Issue
Board/Detail, Store Operations, and Unlinked Changes SHALL live only under Store prefixes; common
Config, Archive, and Pipelines views SHALL remain addressable in either namespace.

#### Scenario: Deep link resolves its own space

- **WHEN** the user opens `/p/<projectId>/board` or `/p/<projectId>/task/<change>` directly
- **THEN** the project Board or Task Detail renders scoped to that project without depending on any
  prior selection

#### Scenario: Store deep link resolves its own space

- **WHEN** the user opens `/s/<storeId>/issues/<issueId>`, `/operations`, or
  `/unlinked-changes` directly
- **THEN** the requested Store surface renders for that Store without a project-space mirror

#### Scenario: Two tabs hold independent spaces

- **WHEN** one tab is on `/p/<a>/board` and another on `/s/<b>/issues`
- **THEN** each tab's data is scoped to its own space and neither tab's navigation changes the other

#### Scenario: Refresh preserves the space

- **WHEN** the user reloads while on a space-prefixed route
- **THEN** the same space and surface render from the unchanged URL

### Requirement: The launch URL's space query bootstraps to a canonical space route

On load the shell SHALL read the `space` query parameter emitted by `rasen ui`
(`?space=project:<id>` or `?space=store:<id>`), translate a project to
`/p/<id>/board` and a Store to `/s/<id>/issues`, and navigate there by replacing history so the
launch query does not remain in the address bar or become a back-button entry. The id portion after
the namespace prefix SHALL be used verbatim as an opaque token — the shell SHALL NOT normalize,
re-case, or path-canonicalize it — so it round-trips unchanged into the route and back into every
API call. When the URL carries no `space` query, the shell SHALL use the server's launch project
when available, otherwise the first listed space and that space type's canonical home. When no
space is resolvable at all, it SHALL render an explicit empty state directing the user to run
`rasen ui` inside a Rasen project.

#### Scenario: Launch query becomes a clean space route

- **WHEN** the browser opens the token-free `…/?space=project:<id>` URL printed by `rasen ui`
- **THEN** the server establishes the browser session, the app lands on `/p/<id>/board`, and removes the `?space=` query

#### Scenario: Expired daemon session renews automatically

- **WHEN** an open UI tab receives 401 because the daemon restarted and rotated its internal token
- **THEN** the client refreshes its HttpOnly browser session once and retries the original request
- **AND** it shows the re-launch notice only if the refreshed request is still unauthorized

#### Scenario: Store launch query resolves to a store route

- **WHEN** the launch URL carries `?space=store:<id>`
- **THEN** the app lands on `/s/<id>/issues` and never renders the superseded Store Task board

#### Scenario: Opaque id round-trips unchanged

- **WHEN** the launch query's id differs from a normalized form only by case, separators, or a
  colon inside the id
- **THEN** the id appears byte-for-byte identical after route escaping/decoding and in the selector
  sent to the API

#### Scenario: No space query falls back to the launch project

- **WHEN** the app loads at `/` with no `space` query and the health endpoint reports a launch
  project
- **THEN** the app redirects to that project's `/p/<id>/board`

#### Scenario: First listed Store uses its Issue home

- **WHEN** there is no launch project and the first listed space is a Store
- **THEN** the app redirects to that Store's `/s/<id>/issues`

#### Scenario: No resolvable space shows an explicit empty state

- **WHEN** the app loads with no space query, no launch project, and no registered spaces
- **THEN** the app shows a message telling the user to run `rasen ui` inside a Rasen project, not a
  blank page or indefinite spinner

### Requirement: The space switcher lists both namespaces and re-scopes by navigation

The shell SHALL present a space switcher fed by `GET /api/v1/spaces` that lists registered spaces
in two type-tagged groups — projects and Stores — with the current route's space selected. Selecting
a space SHALL navigate to a route valid for the destination namespace: Config, Archive, and
Pipelines SHALL be preserved across namespaces; Issues, Operations, and Unlinked Changes SHALL be
preserved only for Store-to-Store switches; every other switch SHALL fall back to the destination's
canonical home. Navigation SHALL be the switcher's only effect. The switcher SHALL NOT offer a
no-space option; an empty listing SHALL show an explicit registration hint.

#### Scenario: Both namespaces grouped and tagged

- **WHEN** the machine has registered projects and Stores and the user opens the switcher
- **THEN** projects and Stores appear in separate type-tagged groups with the current route's space
  selected

#### Scenario: Selecting a space re-scopes the current section

- **WHEN** the user is on `/p/<a>/config` and selects Store `<b>`
- **THEN** the app navigates to `/s/<b>/config`

#### Scenario: A Store-only section survives Store to Store

- **WHEN** the user is on `/s/<a>/operations` and selects Store `<b>`
- **THEN** the app navigates to `/s/<b>/operations`

#### Scenario: A Store-only section falls back for a project

- **WHEN** the user is on `/s/<a>/issues`, `/operations`, or `/unlinked-changes` and selects project
  `<b>`
- **THEN** the app navigates to `/p/<b>/board` and never constructs a dead project mirror

#### Scenario: Project Board switches to the Store Issue home

- **WHEN** the user is on `/p/<a>/board` and selects Store `<b>`
- **THEN** the app navigates to `/s/<b>/issues`

#### Scenario: Switching writes only the URL

- **WHEN** the user selects a different space
- **THEN** the only effect is client-side navigation; no configuration, workspace, Issue, Change,
  Run, or Session write is issued

#### Scenario: No spaces shows a hint, not an empty dropdown

- **WHEN** the spaces listing is empty
- **THEN** the switcher shows a hint to register a space via `rasen ui` instead of an empty control

### Requirement: Space-scoped API calls thread the current route's selector through the shared client seam

Every space-scoped management read and write the UI issues (active changes, run state, session listing, session launch) SHALL carry the current route's space selector, built as `<type>:<id>` from the route and passed through the UI package's single API client seam. Omitting the selector SHALL remain valid and SHALL preserve the server's launch-project fallback, so a call made before a space is resolved behaves exactly as it did before this capability. The selector SHALL be URL-encoded once at the client seam and SHALL NOT be re-derived from anything other than the route.

#### Scenario: Board reads scope to the route's space

- **WHEN** the board loads on `/p/<id>/board`
- **THEN** its changes and runs requests carry `space=project:<id>` and report that project's data

#### Scenario: Session launch targets the current space

- **WHEN** a session is launched from a view scoped to store `<id>`
- **THEN** the launch request carries the `store:<id>` selector so the run starts in that space

#### Scenario: Selector-less call keeps the fallback

- **WHEN** a call is issued with no selector (e.g. before a space is resolved)
- **THEN** the server answers for its launch project exactly as before, with no error introduced by this capability

### Requirement: Audit is reachable as an installation-wide shell route

The management UI shell SHALL expose an Audit navigation entry at the global `/audit` route from every authenticated view. Audit SHALL be installation-wide rather than project/store-scoped, while the shell's recent-space fallback SHALL keep Board, Archive, Config, and Pipelines reachable when the user is on Audit. Navigating to Audit SHALL NOT change the selected/recent planning space or write any workspace state.

#### Scenario: Audit is reachable without a resolved space
- **WHEN** an authenticated user has no current space route
- **THEN** the shell still displays an Audit navigation entry that opens `/audit`

#### Scenario: Audit is active from a space
- **WHEN** the user follows Audit from `/p/<id>/board` or `/s/<id>/config`
- **THEN** `/audit` becomes active and the prior space remains available through the shell's recent-space navigation

#### Scenario: Audit navigation is read-only to workspace selection
- **WHEN** the user enters or leaves `/audit`
- **THEN** navigation changes only the URL/view and issues no workspace/configuration write

### Requirement: Store-scoped calls address their Store by stable identity through the same client seam

Every Store-scoped call the operations UI makes SHALL address its Store by the Store's stable
identity, and SHALL go through the same client seam every other call uses, so authentication, error
reporting, and base-address resolution behave identically. A Store SHALL NOT be addressed by a
filesystem path, a display name, or a position in a list.

#### Scenario: A Store is addressed by identity

- **WHEN** the UI issues any Store-scoped call
- **THEN** the Store is identified by its stable identity
- **AND** no filesystem path, display name, or list position is used to address it

#### Scenario: Store-scoped calls share the common client behavior

- **WHEN** a Store-scoped call fails authentication or cannot reach the server
- **THEN** it reports the failure the same way every other call in the shell does

### Requirement: Execution access follows the scope that owns its truth

The shell SHALL route Store-level execution work through Store Operations and project-level
Change/Run work through project Task Detail. It SHALL offer no independent header Session summary
and no Store Task Detail route, so execution is not presented through competing scope or
attribution models.

#### Scenario: Store execution is reached through Operations

- **WHEN** a viewer is in a Store space
- **THEN** navigation offers Store Operations as the Store's Session/Run surface

#### Scenario: Project execution remains in Task Detail

- **WHEN** a viewer follows a Change/Task from a project Board
- **THEN** project Task Detail remains available with its Run detail and controls

#### Scenario: No duplicate header execution surface remains

- **WHEN** a viewer inspects the authenticated shell in any space
- **THEN** no independently polling running-Session menu appears in the header

