# management-http-api Delta

## MODIFIED Requirements

### Requirement: The spaces path serves listing and creation under the management security posture
`GET /api/v1/spaces` SHALL be served by the management server with the same loopback bind, bearer-token requirement, trailing-slash tolerance, and fresh-read posture as the other management paths; its listing content contract is defined by the planning-space-addressing capability and is unchanged by creation support. `GET /api/v1/spaces/worktrees` SHALL likewise be a GET-only management path under the same security posture, with its content contract defined by the planning-space-addressing capability's worktree-inventory requirement. `POST /api/v1/spaces` SHALL be admitted and served by the space-creation capability's CLI-backed bridge. PUT and DELETE on the path SHALL be rejected with 405. `GET /api/v1/local-paths` SHALL likewise be a GET-only management path under the same security posture, with its content contract defined by the local-path-browsing capability.

#### Scenario: Spaces requires the session token
- **WHEN** a client sends `GET /api/v1/spaces` or `POST /api/v1/spaces` without a valid bearer token
- **THEN** the response is 401 with the `unauthorized` error envelope

#### Scenario: Admitted POST routes to the creation bridge
- **WHEN** a client sends an authorized `POST /api/v1/spaces`
- **THEN** the request is handled by the CLI-backed space-creation bridge rather than rejected with 405

#### Scenario: Unadmitted methods still rejected
- **WHEN** a client sends PUT or DELETE to `/api/v1/spaces`, or POST to `/api/v1/local-paths`
- **THEN** the response is 405 `method_not_allowed` and no file is modified

#### Scenario: Listing behavior unchanged by creation support
- **WHEN** a client sends `GET /api/v1/spaces` after creation support ships
- **THEN** the response content matches the planning-space-addressing contract exactly as before, and answering it mutates nothing

#### Scenario: Worktree inventory is token-guarded and GET-only
- **WHEN** a client sends `GET /api/v1/spaces/worktrees` without a valid bearer token, or POSTs to that path with one
- **THEN** the unauthenticated GET yields 401 with the `unauthorized` envelope and the POST yields 405 `method_not_allowed`, with no file modified in either case
