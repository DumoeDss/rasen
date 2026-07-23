## ADDED Requirements

### Requirement: The pipeline paths serve inventory and mutation under the management security posture

`GET /api/v1/pipelines` and `POST /api/v1/pipelines` SHALL be served by the management route group with the same loopback bind, bearer-token requirement, trailing-slash tolerance, and fresh-read posture as the other management paths; their content contracts are defined by the pipeline-http-api capability. `/api/v1/pipelines/<name>` (exactly one path segment deep) SHALL also be a management path, reserved for the pipeline detail contract; until that contract is provided, a request to it SHALL receive the management group's not-found error rather than falling through to another route group. Deeper suffixes are not management paths and fall through to the rest of the server's routing. PUT and DELETE on the pipeline paths SHALL be rejected with 405 `method_not_allowed`.

#### Scenario: Pipeline paths require the session token

- **WHEN** a client sends any `/api/v1/pipelines` request without a valid bearer token
- **THEN** the response is 401 with the `unauthorized` error envelope, answered by the management route group

#### Scenario: Admitted POST routes to the pipeline bridge

- **WHEN** a client sends an authorized `POST /api/v1/pipelines`
- **THEN** the request is handled by the CLI-backed pipeline mutation bridge rather than rejected with 405

#### Scenario: Unadmitted methods on pipeline paths rejected

- **WHEN** a client sends PUT or DELETE to `/api/v1/pipelines`
- **THEN** the response is 405 `method_not_allowed` and no file is modified

#### Scenario: One-segment pipeline suffix is claimed, deeper suffixes fall through

- **WHEN** a client requests `/api/v1/pipelines/<name>` versus `/api/v1/pipelines/<name>/extra`
- **THEN** the one-segment form is answered by the management route group (not-found until the detail contract exists) and the deeper form falls through to the rest of the server's routing

### Requirement: Error envelope carries an optional fix hint

Every error response from the management server — from either route group — SHALL use the envelope `{ error: { code, message } }` optionally extended with a `fix` field carrying an actionable remediation hint. Endpoints whose error contracts promise a fix hint (such as the config endpoints' space-resolution errors and the pipeline endpoints inheriting them) SHALL keep emitting it after any change of which route group answers the path; endpoints that do not supply a hint SHALL omit the field rather than sending it empty.

#### Scenario: Fix hint preserved across route groups

- **WHEN** a request to `/api/v1/pipelines` fails space resolution with an error that previously carried a `fix` hint
- **THEN** the error response still carries the same envelope shape `{ error: { code, message, fix } }` with an actionable hint

#### Scenario: Fix field omitted when absent

- **WHEN** a management endpoint answers an error for which no remediation hint exists
- **THEN** the envelope contains `code` and `message` and no `fix` key
