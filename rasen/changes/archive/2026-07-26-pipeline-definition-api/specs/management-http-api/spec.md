## MODIFIED Requirements

### Requirement: The pipeline paths serve inventory and mutation under the management security posture

`GET /api/v1/pipelines`, `POST /api/v1/pipelines`, `GET /api/v1/pipelines/<name>` (exactly one path segment deep), `POST /api/v1/pipeline-validation`, and `GET /api/v1/pipeline-catalog` SHALL be served by the management route group with the same loopback bind, bearer-token requirement, trailing-slash tolerance, and fresh-read posture as the other management paths; their content contracts are defined by the pipeline-http-api capability. Deeper suffixes under `/api/v1/pipelines/<name>/` are not management paths and fall through to the rest of the server's routing. PUT and DELETE on all pipeline paths SHALL be rejected with 405 `method_not_allowed`, as SHALL POST to `/api/v1/pipelines/<name>` and `/api/v1/pipeline-catalog`, and GET to `/api/v1/pipeline-validation`.

#### Scenario: Pipeline paths require the session token

- **WHEN** a client sends any `/api/v1/pipelines`, `/api/v1/pipeline-validation`, or `/api/v1/pipeline-catalog` request without a valid bearer token
- **THEN** the response is 401 with the `unauthorized` error envelope, answered by the management route group

#### Scenario: Admitted POST routes to the pipeline bridge

- **WHEN** a client sends an authorized `POST /api/v1/pipelines`
- **THEN** the request is handled by the CLI-backed pipeline mutation bridge rather than rejected with 405

#### Scenario: Unadmitted methods on pipeline paths rejected

- **WHEN** a client sends PUT or DELETE to `/api/v1/pipelines`, POST to `/api/v1/pipeline-catalog`, or GET to `/api/v1/pipeline-validation`
- **THEN** the response is 405 `method_not_allowed` and no file is modified

#### Scenario: One-segment pipeline suffix serves the detail contract, deeper suffixes fall through

- **WHEN** a client requests `/api/v1/pipelines/<name>` versus `/api/v1/pipelines/<name>/extra`
- **THEN** the one-segment form is answered by the pipeline detail contract from the management route group and the deeper form falls through to the rest of the server's routing
