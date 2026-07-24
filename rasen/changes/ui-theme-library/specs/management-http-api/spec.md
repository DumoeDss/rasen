## ADDED Requirements

### Requirement: Theme paths use the management server security posture

The management server SHALL expose `GET /api/v1/themes` and
`POST /api/v1/themes/import` on the loopback interface under the per-launch
bearer-token requirement, fresh-read posture, trailing-slash tolerance, and
standard error envelope used by other management paths. The catalog request
SHALL be read-only. Import SHALL accept only a bounded JSON theme document and
delegate validation and atomic installation to the theme library. Other methods
and deeper path suffixes SHALL not be admitted as theme operations.

#### Scenario: Theme requests require authentication

- **WHEN** a client requests either theme path without the valid launch token
- **THEN** the server returns 401 and performs no listing, validation, or write

#### Scenario: Catalog is fresh and read-only

- **WHEN** an authenticated client requests `GET /api/v1/themes` after a valid
  theme file has been installed
- **THEN** the response reflects the current validated library
- **AND** serving it creates or modifies no file

#### Scenario: Import body is bounded

- **WHEN** an authenticated import declares or exceeds the theme-document size
  limit
- **THEN** the server stops accepting it, returns 413 in the standard error
  envelope, and installs no theme

#### Scenario: Unsupported theme methods are rejected

- **WHEN** a client sends PUT or DELETE to a theme path, POST to the catalog
  path, GET to the import path, or addresses a deeper theme suffix
- **THEN** the request is rejected or falls through according to the management
  router's exact-depth contract without modifying the theme library

