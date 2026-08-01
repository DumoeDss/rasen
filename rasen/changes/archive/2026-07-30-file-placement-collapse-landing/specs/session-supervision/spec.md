## MODIFIED Requirements

### Requirement: Session listing is filterable by space and joins run state per session's own space
`GET /api/v1/sessions` SHALL accept an optional `space` selector; when present, only sessions whose recorded space is that space are returned (unattributed sessions appear only in the unfiltered listing). Each listed session's run-state join SHALL resolve against the session's own recorded space and execution context — the session's execution root's ephemera directory first, then that space's machine-home work directory, then its change directory (the `file-placement` capability's sticky-legacy chain) — not against the server's launch project, so a session launched in one space never reports another space's run files.

#### Scenario: Filtered listing returns only the space's sessions
- **WHEN** sessions exist in spaces A and B and a client sends `GET /api/v1/sessions?space=<selector for A>`
- **THEN** only the sessions recorded in space A are returned

#### Scenario: Unfiltered listing keeps today's behavior
- **WHEN** a client sends `GET /api/v1/sessions` with no space selector
- **THEN** every session the supervisor knows is returned, including unattributed ones

#### Scenario: Run-state join follows the session's space
- **WHEN** a session with a `changeName` was launched in a space other than the launch project
- **THEN** its `runState` is read from that session's own resolved locations (execution-root ephemera, that space's machine-home work directory, and change directory), not the launch project's
