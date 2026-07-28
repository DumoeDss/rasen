## MODIFIED Requirements

### Requirement: Workflow listing endpoint mirrors the CLI listing

The management server SHALL serve `GET /api/v1/workflows` returning the user-wide workflow catalog from a fresh read at request time: valid workflows each carrying `id`, `source` (built-in or user), `sourcePath`, `digest`, `kind` (task, driver, expert, or internal), `skillName`, and an `unused` marker; invalid user entries with their diagnostics; and catalog-level diagnostics. The `unused` marker SHALL be computed exactly as `rasen workflow list` computes it — a user workflow with no detected machine-level consumer — so the page and the CLI never disagree. The endpoint SHALL answer under the management security posture (loopback bind, bearer token, 405 for non-GET methods other than the admitted mutation POST).

#### Scenario: Listing includes every catalog unit with its kind

- **WHEN** a client sends an authorized `GET /api/v1/workflows`
- **THEN** the response includes built-in and user workflows alike, each annotated with its kind, source, digest, and skill name, without hiding internal workflows

#### Scenario: Unused marker matches the CLI

- **WHEN** a user workflow has no global selection, profile, dependency, or pipeline consumer
- **THEN** its listing entry carries `unused: true`, and `rasen workflow list --unused` names the same workflow

#### Scenario: Invalid user entries are reported, not dropped

- **WHEN** the user library contains a workflow directory that fails validation
- **THEN** the listing reports it in an `invalid` collection with its diagnostics rather than omitting it silently

#### Scenario: Fresh read per request

- **WHEN** a workflow is imported or deleted between two listing requests
- **THEN** the second response reflects the new library state without a server restart

### Requirement: Workflow detail endpoint mirrors the CLI show

The management server SHALL serve `GET /api/v1/workflows/<id>` — exactly one path segment deep — returning the full definition (identity, kind, source, manifest version, digest, skill, `requires` and `recommends` slots, file inventory) together with the workflow's known usage referrers, matching the content of `rasen workflow show <id> --json`. An id not present in the catalog SHALL yield 404 with a structured error envelope.

#### Scenario: Detail returns definition and usage

- **WHEN** a client requests an installed workflow's detail with a valid token
- **THEN** the response carries the definition's dependency slots and file inventory, and each known usage referrer with its consumer kind

#### Scenario: Unknown id yields 404

- **WHEN** a client requests `GET /api/v1/workflows/<id>` for an id in neither the valid nor invalid catalog
- **THEN** the response is 404 with an error envelope, and nothing is created or modified
