# workflow-http-api Specification

## Purpose
Provide a loopback-bound, bearer-secured HTTP surface over the user-wide workflow library — listing, detail, validation, and CLI-backed mutation (import, init, export, delete) — served under the management-http-api security posture and mirroring the `rasen workflow` CLI commands exactly, so the page and the CLI never disagree.

## Requirements

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

### Requirement: Workflow validation endpoint is read-only

The management server SHALL serve `GET /api/v1/workflow-validation?target=<value>` where the target is either an installed workflow id or an absolute path to a draft directory or workflow package, returning the same validation verdict and diagnostics as `rasen workflow validate` for that target. A target that is neither a catalog id nor an absolute path SHALL be rejected with 400 — the endpoint never probes relative filesystem locations. Validation SHALL create, write, and install nothing.

#### Scenario: Draft directory validated by absolute path

- **WHEN** a client requests validation of an absolute path such as `E:\drafts\my-workflow` (Windows drive-letter form) or `/home/user/drafts/my-workflow` that contains a workflow draft
- **THEN** the response reports the draft's validity and diagnostics without installing it

#### Scenario: Relative target rejected

- **WHEN** the target value is a relative path that matches no installed workflow id
- **THEN** the response is 400 and no filesystem probe occurs for it

#### Scenario: Read-only guarantee

- **WHEN** the endpoint serves any request
- **THEN** no library entry, file, or registry state is created or modified

### Requirement: Workflow mutations run through a whitelisted CLI bridge

`POST /api/v1/workflows` SHALL accept exactly four operations, discriminated by an `op` field — `import` (a source path), `init` (a new id and an output path), `export` (an id, a destination path, and an optional overwrite flag), and `delete` (an id and an optional force flag) — and SHALL perform each exclusively by spawning the existing CLI as a subprocess under the shared admission whitelist's bounded-CLI tier; the server itself writes no library or workspace file. The bridge SHALL run at most one workflow subprocess at a time (a concurrent request receives 409), SHALL bound the subprocess with a timeout and reliable termination, and on CLI failure SHALL return 422 carrying the CLI's own error message verbatim. An unknown `op` SHALL be rejected with 400 and spawn nothing. Delete confirmation is the client's responsibility: the bridge always runs the CLI's non-interactive confirmed form, and the UI is required to confirm before submitting.

#### Scenario: Import installs via the CLI

- **WHEN** a client submits `{ op: 'import', path: <absolute path to a directory or package> }`
- **THEN** the workflow is installed by a spawned CLI subprocess, and the response reports the imported and reused ids from the CLI's own output

#### Scenario: Concurrent mutation refused

- **WHEN** a second mutation arrives while a workflow subprocess is in flight
- **THEN** the response is 409 busy and no second subprocess is spawned

#### Scenario: CLI refusal surfaces verbatim

- **WHEN** the CLI refuses an operation (for example a delete guarded by referrers, or an export whose destination exists without the overwrite flag)
- **THEN** the response is 422 and its message is the CLI's own error message, naming what the CLI named

#### Scenario: Unknown operation spawns nothing

- **WHEN** a client submits an `op` outside the four admitted operations
- **THEN** the response is 400 and no subprocess is spawned

### Requirement: Mutation inputs are guarded before reaching the subprocess

Every client-supplied filesystem path on a workflow mutation (`import` source, `init` output, `export` destination) SHALL be required to be an absolute path — relative paths are rejected with 400 before any subprocess is spawned — and every workflow id SHALL be required to match the identifier form the workflow manifest schema itself accepts, rejecting any value that could be parsed as a command-line option. Each input SHALL be passed to the subprocess as a single argument token, never through a shell.

#### Scenario: Relative mutation path rejected

- **WHEN** a client submits `{ op: 'import', path: '../somewhere' }` or any non-absolute path on any operation
- **THEN** the response is 400 invalid input and no subprocess is spawned

#### Scenario: Option-shaped id rejected

- **WHEN** a client submits an id beginning with `-` on any operation
- **THEN** the response is 400 and no subprocess is spawned

#### Scenario: Windows and POSIX absolute forms both accepted

- **WHEN** a client submits an absolute path in the platform's native form (such as `E:\packages\wf.rasenpkg` on Windows)
- **THEN** the path is accepted by the guard and delivered to the CLI unchanged as one argument

### Requirement: Built-in workflows cannot be deleted through the bridge

A delete operation targeting a built-in workflow SHALL be refused — the CLI refuses built-in deletion regardless of any flag, and the bridge passes that refusal through as 422 with the CLI's message. The force flag SHALL bypass only the referrer guard on user workflows, mirroring `rasen workflow delete --force`, and a forced delete's response SHALL report the dangling referrers the CLI reports.

#### Scenario: Built-in delete refused

- **WHEN** a client submits `{ op: 'delete', id: <a built-in workflow id>, force: true }`
- **THEN** the response is 422 carrying the CLI's built-in-deletion refusal, and the workflow remains installed

#### Scenario: Forced delete reports dangling referrers

- **WHEN** a client force-deletes a still-referenced user workflow
- **THEN** the deletion succeeds and the response names every referrer the CLI warned about
