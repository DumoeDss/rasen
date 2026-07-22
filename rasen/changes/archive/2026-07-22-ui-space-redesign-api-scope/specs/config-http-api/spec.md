## MODIFIED Requirements

### Requirement: Localhost config API endpoints
The CLI SHALL embed a localhost HTTP JSON API, versioned under `/api/v1/`, exposing the unified configuration layer: a health probe, a list endpoint returning every registered configuration key with its definition metadata, effective value, source (`default` | `global` | `project` | `env-override`), and raw per-scope values; a single-key get; scope-explicit set and unset that return the re-resolved entry; and a registered-projects listing. The projects listing SHALL omit registry entries whose root directory no longer exists on disk (deleted clones, leaked temporary directories), so a switcher UI never offers a dead project; the filtering is read-only and never modifies the registry (pruning remains `rasen doctor --gc`'s job). All responses SHALL be JSON, and all endpoint data SHALL come from the unified config layer's in-process modules (effective-config resolution, the config-key registry, and the scope write paths) with no configuration logic reimplemented in HTTP handlers.

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
- **AND** projects returns the machine project registry's live entries as `{ projectId, name, root }` references

#### Scenario: Dead project roots are hidden without registry writes
- **WHEN** a registered project's root directory has been deleted from disk
- **THEN** `GET /api/v1/projects` omits that entry
- **AND** the registry file is left byte-for-byte unchanged by the request
