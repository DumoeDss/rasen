## MODIFIED Requirements

### Requirement: The URL is the source of truth for the selected planning space

The management UI SHALL carry the selected planning space in the URL path — `/p/<projectId>/…`
for a project space and `/s/<storeUid>/…` for a Store space — and SHALL derive the active space from
the current route, not from any in-memory store. A refresh, a deep link, or a second browser tab
SHALL each resolve their own space from their own URL independently, with no shared mutable space
state between them. Project Board and Task Detail SHALL live only under project prefixes; Issue
Board/Detail, Store Operations, and Unlinked Changes SHALL live only under Store prefixes; common
Config, Archive, and Pipelines views SHALL remain addressable in either namespace. New Store routes
SHALL use the permanent Store uid returned by the spaces catalog, and canonical Issue Detail routes
SHALL use the permanent Issue UID returned by the Issue catalog. A compatible Store alias or Issue
key/slug/legacy-id deep link SHALL remain accepted when it resolves exactly one resource, but the
shell SHALL never guess among several matches.

#### Scenario: Deep link resolves its own space

- **WHEN** the user opens `/p/<projectId>/board` or `/p/<projectId>/task/<change>` directly
- **THEN** the project Board or Task Detail renders scoped to that project without depending on any prior selection

#### Scenario: Store deep link resolves its own space

- **WHEN** the user opens `/s/<storeUid>/issues/<issueUid>` directly
- **THEN** the requested Issue Detail renders for those exact authoritative identities
- **AND** no project-space mirror or filesystem locator is used

#### Scenario: Unique legacy Store alias deep link remains compatible

- **WHEN** the user opens `/s/<alias>/issues` and exactly one listed Store carries that alias
- **THEN** that Store's Issue Board renders
- **AND** subsequent generated navigation for it uses `/s/<uid>/…`

#### Scenario: Compatible Issue selector canonicalizes after resolution

- **WHEN** the user opens an Issue detail link with a generated key, unique slug, or legacy identifier
- **THEN** the matching Issue renders when exactly one UID resolves
- **AND** subsequent generated navigation uses `/s/<storeUid>/issues/<issueUid>`

#### Scenario: Ambiguous legacy alias deep link is not guessed

- **WHEN** a Store alias or Issue convenience selector in a deep link matches more than one resource
- **THEN** the shell does not select a candidate and presents the unresolved or ambiguous state

#### Scenario: Two tabs hold independent spaces

- **WHEN** one tab is on `/p/<a>/board` and another on `/s/<b>/issues`
- **THEN** each tab's data is scoped to its own space and neither tab's navigation changes the other

#### Scenario: Refresh preserves the space

- **WHEN** the user reloads while on a canonical space-prefixed Issue route
- **THEN** the same Store, Issue UID, and surface render from the unchanged URL
