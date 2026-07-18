# config-http-api Specification

## Purpose

This spec defines the localhost HTTP JSON API the CLI embeds to expose the unified configuration layer to a browser-based UI. It governs how configuration keys are listed, read, set, and unset over HTTP, how projects are addressed, and how the server is secured to loopback with a per-session token. All endpoint behavior draws from the in-process unified config layer with no configuration logic reimplemented in HTTP handlers.

## Requirements

### Requirement: Localhost config API endpoints
The CLI SHALL embed a localhost HTTP JSON API, versioned under `/api/v1/`, exposing the unified configuration layer: a health probe, a list endpoint returning every registered configuration key with its definition metadata, effective value, source (`default` | `global` | `project` | `env-override`), and raw per-scope values; a single-key get; scope-explicit set and unset that return the re-resolved entry; and a registered-projects listing. All responses SHALL be JSON, and all endpoint data SHALL come from the unified config layer's in-process modules (effective-config resolution, the config-key registry, and the scope write paths) with no configuration logic reimplemented in HTTP handlers.

#### Scenario: List returns effective entries with sources
- **WHEN** a client sends `GET /api/v1/config` with a valid token
- **THEN** the response contains one entry per non-wildcard registered key with its effective value, source annotation, and raw global/project scope values

#### Scenario: Get a single key
- **WHEN** a client sends `GET /api/v1/config/handoff.threshold`
- **THEN** the response contains that key's effective entry
- **AND** an unregistered key yields 404 with error code `unknown_key`

#### Scenario: Set re-resolves and returns the entry
- **WHEN** a client sends `PUT /api/v1/config/handoff.threshold` with body `{ "scope": "project", "value": 0.4 }` addressing a project
- **THEN** the project's `rasen/config.yaml` is updated through the comment-preserving write path
- **AND** the response contains the re-resolved entry showing value 0.4 with source `project`

#### Scenario: Unset reverts to the lower layer
- **WHEN** a client sends `DELETE /api/v1/config/handoff.threshold?scope=project` for a project where a global value is also set
- **THEN** the key is removed from the project config
- **AND** the returned entry shows the global value with source `global`

#### Scenario: Health and projects endpoints
- **WHEN** a client sends `GET /api/v1/health` or `GET /api/v1/projects`
- **THEN** health returns ok plus the CLI version and the launch project reference (or null)
- **AND** projects returns the machine project registry's entries as `{ projectId, name, root }` references

### Requirement: Scope-explicit, registry-validated writes
Every write (set or unset) SHALL require an explicit `scope` of `global` or `project`; a missing or invalid scope SHALL be rejected without any write. Writes in BOTH scopes SHALL validate the key path and value through the config-key registry (including the machine-managed not-settable keys) before touching any file, and global writes SHALL additionally pass global schema validation before saving. Errors SHALL use a uniform shape `{ error: { code, message, fix? } }`.

#### Scenario: Missing scope is rejected
- **WHEN** a PUT arrives without a `scope` field
- **THEN** the response is 400 with an error code identifying the missing scope
- **AND** no config file is modified

#### Scenario: Registry validation applies to global writes
- **WHEN** a PUT sets `repoMode` to an out-of-enum value with `scope: "global"`
- **THEN** the response is 400 with error code `invalid_value` and a message listing the allowed values
- **AND** the global config file is not modified

#### Scenario: Machine-managed keys are not settable
- **WHEN** a PUT targets `telemetry.anonymousId`
- **THEN** the response is 400 with error code `not_settable`
- **AND** the stored value is unchanged

#### Scenario: Global write touches only the target key
- **WHEN** a PUT sets one global key on a config file that omits other keys with built-in defaults
- **THEN** after the write, the file contains the new key value and the previously present content only
- **AND** keys never explicitly set remain absent from the file (their source annotation stays `default`)

#### Scenario: Invalid on-disk values are reported, not rewritten
- **WHEN** a hand-edited scope value fails registry validation (e.g. a global `handoff.threshold` of 5)
- **THEN** list/get responses carry a warning on that entry identifying the invalid on-disk value
- **AND** the API never rewrites or clamps the file content on read

### Requirement: Project addressing
Read and write endpoints SHALL accept an optional project selector (query `project` or body `project`) naming a registered project by project id or by absolute root path, resolved against the machine project registry. When the selector is omitted, the server's launch project (the Rasen root resolved at server startup, possibly none) SHALL apply. An unresolvable selector SHALL yield 404 with error code `project_not_found` and a fix hint; a project-scope write with no resolvable project SHALL be rejected rather than silently falling back to global scope.

#### Scenario: Address a project by id
- **WHEN** a GET or PUT carries `project=<projectId>` for a project present in the machine registry
- **THEN** project-layer values resolve from and writes land in that project's `rasen/config.yaml`

#### Scenario: Unknown project selector
- **WHEN** a request carries a `project` selector matching no registry entry by id or canonical root path
- **THEN** the response is 404 with error code `project_not_found` and guidance to open the project with the CLI once

#### Scenario: Project write without a project
- **WHEN** the server was launched outside any Rasen project and a PUT arrives with `scope: "project"` and no `project` selector
- **THEN** the response is an error explaining that a project must be selected
- **AND** no global write occurs

### Requirement: Loopback-only bind with per-session token guard
The API server SHALL bind exclusively to the loopback interface (127.0.0.1) on an ephemeral port by default. At startup the CLI SHALL mint a random per-session token; every `/api/` request SHALL present it as a bearer Authorization header or receive 401. The server SHALL emit no CORS headers, and mutating requests SHALL additionally require an `application/json` content type. The token SHALL be conveyed to the browser via the opened URL's fragment rather than logged query strings.

#### Scenario: Loopback bind
- **WHEN** the server starts
- **THEN** it listens on 127.0.0.1 only and is not reachable from other interfaces

#### Scenario: Missing or wrong token
- **WHEN** an `/api/` request arrives without the session token or with an incorrect one
- **THEN** the response is 401 with error code `unauthorized` and no handler logic runs

#### Scenario: Cross-origin form post is rejected
- **WHEN** a mutating request arrives without an `application/json` content type
- **THEN** the request is rejected before any write
