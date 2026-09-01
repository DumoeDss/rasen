## ADDED Requirements

### Requirement: Store Issue mutation paths create by title and resolve selectors consistently

The Store Issue creation path SHALL require a title and SHALL NOT require a client-authored Issue
identifier. Its success response SHALL return the system-assigned structured identity. Other Issue
mutation and detail paths SHALL accept an Issue UID, generated key, unique slug, or compatible
legacy identifier through the same selector-resolution contract. Request shape, not-found,
ambiguity, and identity conflicts SHALL use explicit HTTP status and error-envelope codes.

#### Scenario: HTTP creation accepts title only

- **WHEN** an authenticated same-origin client posts a valid title with no `issueId`
- **THEN** the server creates the Issue and returns its UID and generated key
- **AND** the client is not asked to resubmit with a path-safe identifier

#### Scenario: Compatibility input cannot choose machine identity

- **WHEN** a compatible client posts a legacy `issueId` beside the title
- **THEN** the server may retain it only as a non-authoritative legacy alias
- **AND** the returned UID, key, lock, and storage location are system-assigned

#### Scenario: Ambiguous selector is a conflict

- **WHEN** an Issue mutation selector matches more than one authoritative UID
- **THEN** the API returns a conflict error with the Issue ambiguity code
- **AND** it performs no mutation

#### Scenario: CLI and HTTP return the same identity facts

- **WHEN** the same Issue is read through the command line and management API
- **THEN** both report the same UID, key, slug, aliases, and legacy status
- **AND** neither exposes its internal storage key as identity

#### Scenario: Indeterminate creation returns structured no-retry recovery

- **WHEN** Issue publication fails and the server cannot prove whether the assigned record committed
- **THEN** flat HTTP, compatibility HTTP, and CLI JSON return the publication-indeterminate code with the intended UID/key and `retrySafe: false`
- **AND** their public message and warning fields contain no filesystem path or raw filesystem error text

#### Scenario: Execution Plan responses use verified public Issue identity

- **WHEN** a flat or path-scoped Execution Plan read has no verified public identity for its Issue owner
- **THEN** the server either keeps the selector read fail-closed or returns a defensive projection with unavailable `issueId` and problem `itemId` values
- **AND** neither response serializes the internal storage locator, physical path, or a fabricated stable identity

#### Scenario: Option-shaped compatibility alias remains data

- **WHEN** a compatibility client supplies an alias such as `-alias` or `--store`
- **THEN** the deprecated path-scoped CLI bridge places it after the argv option terminator and creation treats it as alias data
- **AND** the canonical flat handler applies the same alias contract rather than interpreting it as an option
