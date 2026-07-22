# management-ui-shell Specification

## Purpose
TBD - created by archiving change ui-space-redesign-shell. Update Purpose after archive.
## Requirements
### Requirement: The URL is the source of truth for the selected planning space

The management UI SHALL carry the selected planning space in the URL path — `/p/<projectId>/…` for a project space and `/s/<storeId>/…` for a store space — and SHALL derive the active space from the current route, not from any in-memory store. A refresh, a deep link, or a second browser tab SHALL each resolve their own space from their own URL independently, with no shared mutable space state between them. Every space-scoped view (board, config, archive, task detail) SHALL live under a space-prefixed route so it always renders for a resolved space.

#### Scenario: Deep link resolves its own space

- **WHEN** the user opens `/p/<projectId>/board` directly
- **THEN** the board renders scoped to that project without depending on any prior selection

#### Scenario: Two tabs hold independent spaces

- **WHEN** one tab is on `/p/<a>/board` and another on `/s/<b>/board`
- **THEN** each tab's data is scoped to its own space and neither tab's navigation changes the other

#### Scenario: Refresh preserves the space

- **WHEN** the user reloads while on a space-prefixed route
- **THEN** the same space renders, resolved from the unchanged URL

### Requirement: The launch URL's space query bootstraps to a canonical space route

On load the shell SHALL read the `space` query parameter emitted by `rasen ui` (`?space=project:<id>` or `?space=store:<id>`), translate it to the canonical space route (`/p/<id>/board` or `/s/<id>/board`), and navigate there by replacing history so the launch query does not remain in the address bar or become a back-button entry. The id portion after the namespace prefix SHALL be used verbatim as an opaque token — the shell SHALL NOT normalize, re-case, or path-canonicalize it — so it round-trips unchanged into the route and back into every API call. When the URL carries no `space` query, the shell SHALL resolve a default space (the server's launch project when the health endpoint reports one, otherwise the first space returned by the spaces listing) and redirect to it; when no space is resolvable at all, it SHALL render an explicit empty state directing the user to run `rasen ui` inside a Rasen project, never a blank page or spinner.

#### Scenario: Launch query becomes a clean space route

- **WHEN** the browser opens `…/?space=project:<id>#token=<t>` as printed by `rasen ui`
- **THEN** the app authenticates with the token and lands on `/p/<id>/board`, and the `?space=` query no longer appears in the address bar

#### Scenario: Store launch query resolves to a store route

- **WHEN** the launch URL carries `?space=store:<id>`
- **THEN** the app lands on `/s/<id>/board`

#### Scenario: Opaque id round-trips unchanged

- **WHEN** the launch query's id differs from a normalized form only by case or separators
- **THEN** the id appears byte-for-byte identical in the route and in the space selector sent to the API, with no client-side canonicalization

#### Scenario: No space query falls back to the launch project

- **WHEN** the app loads at `/` with no `space` query and the health endpoint reports a launch project
- **THEN** the app redirects to that project's `/p/<id>/board`

#### Scenario: No resolvable space shows an explicit empty state

- **WHEN** the app loads with no space query, no launch project, and no registered spaces
- **THEN** the app shows a message telling the user to run `rasen ui` inside a Rasen project, not a blank page

### Requirement: The space switcher lists both namespaces and re-scopes by navigation

The shell SHALL present a space switcher fed by `GET /api/v1/spaces` that lists registered spaces in two type-tagged groups — projects and stores — with the space of the current route shown as selected. Selecting a space SHALL re-scope the app by navigating to that space's route for the current section (board, config, or archive), and navigation SHALL be the switcher's only effect — it SHALL NOT write any workspace or configuration state. The switcher SHALL NOT offer a "no space" / global-only option; when the spaces listing is empty it SHALL show an explicit hint rather than an empty control.

#### Scenario: Both namespaces grouped and tagged

- **WHEN** the machine has registered projects and stores and the user opens the switcher
- **THEN** projects and stores appear in separate, type-tagged groups with the current route's space selected

#### Scenario: Selecting a space re-scopes the current section

- **WHEN** the user is on `/p/<a>/config` and selects store `<b>` in the switcher
- **THEN** the app navigates to `/s/<b>/config` and the config view re-scopes to that store

#### Scenario: Switching writes only the URL

- **WHEN** the user selects a different space
- **THEN** the only effect is client-side navigation; no configuration or workspace write is issued

#### Scenario: No spaces shows a hint, not an empty dropdown

- **WHEN** the spaces listing is empty
- **THEN** the switcher shows a hint to register a space via `rasen ui` instead of an empty selectable control

### Requirement: A header running-run summary scopes to the current space and links to task detail

The shell's header SHALL show a running-run summary for the current space: a `⦿ N running` control, hidden when the space has no live runs, fed by `GET /api/v1/sessions` filtered to the current space's selector and to live run states. Opening it SHALL list each live run's task, its stage, and its elapsed duration, and each entry that is associated with a change SHALL link to that change's task detail route within the current space. The summary SHALL re-poll only while at least one run is live and SHALL reset when the current space changes. This running-run summary SHALL be the shell's only session surface — there SHALL be no top-level Sessions navigation entry or page.

#### Scenario: Running count reflects the current space only

- **WHEN** the current space has two live runs and another space has one
- **THEN** the header shows `⦿ 2 running`, counting only the current space's live runs

#### Scenario: Summary hidden when nothing is live

- **WHEN** the current space has no live runs
- **THEN** the `⦿ N running` control is not shown

#### Scenario: Entry links to task detail

- **WHEN** a live run associated with change `<c>` is listed and the user activates its entry
- **THEN** the app navigates to that change's task detail route within the current space

#### Scenario: Space switch resets the summary

- **WHEN** the user switches to a different space
- **THEN** the running-run summary re-fetches for the new space and stops reflecting the previous space

#### Scenario: No top-level Sessions surface

- **WHEN** the user inspects the shell's navigation
- **THEN** no top-level Sessions entry or page is offered; live runs are reachable only through the header running-run summary

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

