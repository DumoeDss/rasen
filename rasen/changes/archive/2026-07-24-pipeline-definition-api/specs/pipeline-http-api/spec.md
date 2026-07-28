## ADDED Requirements

### Requirement: Pipeline detail endpoint returns both the resolved view and a round-trippable definition

The server SHALL serve `GET /api/v1/pipelines/<name>` (exactly one percent-decoded path segment, validated by the same identifier grammar pipeline names accept) returning, for a pipeline available to the addressed space (`?space=` accepted exactly like the collection endpoint): `pipeline` — the resolved view in the collection's per-pipeline shape; `definition` — the pipeline's declared form as accepted by the pipeline loader, normalized (loader defaults applied, legacy gate spellings surfaced as booleans), carrying every field the loader accepts so that saving the definition back yields a semantically identical pipeline; and `editable` — `false` for built-in (package-provenance) pipelines and `true` otherwise. Built-in pipelines SHALL be returned read-only rather than refused. An unknown name SHALL answer 404 `not_found`; an option-shaped or grammar-violating name SHALL answer 400 before any lookup. The endpoint SHALL require the session token and serve errors in the unified envelope.

#### Scenario: Detail carries both views

- **WHEN** a client sends an authorized `GET /api/v1/pipelines/<name>` for a user pipeline
- **THEN** the response carries the resolved view, the declared definition, and `editable: true`

#### Scenario: Built-in is readable but not editable

- **WHEN** a client requests the detail of a built-in pipeline
- **THEN** the response is 200 with the definition included and `editable: false`

#### Scenario: Definition round-trips through save

- **WHEN** a client saves a detail response's `definition` unchanged under a new user pipeline name and then requests that pipeline's detail
- **THEN** the returned definition is semantically identical to the one saved (same stages, fields, and values after loader normalization)

#### Scenario: Unknown and malformed names

- **WHEN** a client requests `GET /api/v1/pipelines/<unknown-name>` or a name that violates the pipeline identifier grammar
- **THEN** the unknown name answers 404 `not_found` and the malformed name answers 400, both in the unified envelope

### Requirement: Draft validation endpoint dry-runs a definition without writing or spawning

The server SHALL serve `POST /api/v1/pipeline-validation` accepting `{ definition, space? }` and validating the body-carried draft in-process through the same rule chain the pipeline loader and execution preflight enforce — schema shape, duplicate stage ids, dangling `requires` references, dependency cycles (reporting the cycle path), parallel-group mutual independence, decompose-stage constraints, the origin-scoped quality floor, and skill known/enabled checks against the installed skill inventory. The response SHALL be 200 with `{ valid, issues }` for BOTH valid and invalid drafts — invalidity is data, not a transport error — where each issue carries a severity (`error` or `warning`), a locator path into the definition (such as `/stages/2/skill`), and a message; a draft failing any error-severity rule reports `valid: false`. The endpoint SHALL report ALL discoverable issues rather than stopping at the first, SHALL write no file and spawn no subprocess, and SHALL NOT occupy the mutation bridge's concurrency slot. 400 SHALL be answered only when the body is not an object carrying a `definition`. The path is its own top-level path so that a pipeline named `validation` is never shadowed.

#### Scenario: Invalid draft reports all issues at 200

- **WHEN** a client posts a draft with a dependency cycle and a stage referencing an unknown skill
- **THEN** the response is 200 with `valid: false` and at least two error issues — one naming the cycle path and one locating the unknown skill by its stage's definition path

#### Scenario: Valid draft

- **WHEN** a client posts a draft that passes every rule
- **THEN** the response is 200 with `valid: true` and no error-severity issues

#### Scenario: Validation is side-effect free and slot-free

- **WHEN** a validation request runs while a pipeline mutation subprocess is in flight
- **THEN** the validation answers normally (no 409), no file is written, and no subprocess is spawned

#### Scenario: Non-definition body rejected

- **WHEN** a client posts a body with no `definition` member
- **THEN** the response is 400 in the unified envelope

### Requirement: Pipeline catalog endpoint reports the assembly vocabulary

The server SHALL serve `GET /api/v1/pipeline-catalog` returning, in-process and without addressing a space: the installed skill inventory (each with id, description, and whether it is enabled in the active selection), the role vocabulary, the runtime vocabulary, the stage-kind and loop-kind vocabularies, the verify-policy vocabulary, the conventional condition labels (as suggestions — the condition field remains freeform), the default gate value, and the handoff threshold constraints (accepted fraction range and the absolute-form floor). Every enumerated vocabulary SHALL be sourced from the same definitions the pipeline loader enforces, never restated. The path is its own top-level path so that a pipeline named `catalog` is never shadowed by it, and it SHALL require the session token like every management path. POST, PUT, and DELETE on the path SHALL be rejected with 405.

#### Scenario: Vocabulary matches the loader

- **WHEN** a client requests the catalog and then posts a draft using only roles, runtimes, loop kinds, and verify policies the catalog listed
- **THEN** draft validation reports no vocabulary-related issues

#### Scenario: Disabled skill is listed but marked

- **WHEN** a skill is installed on the machine but not enabled in the active selection
- **THEN** the catalog lists it with its enabled flag false, and a draft referencing it validates with an error naming the disabled state

#### Scenario: A pipeline named catalog is not shadowed

- **WHEN** a user pipeline named `catalog` exists and a client requests `GET /api/v1/pipelines/catalog` and `GET /api/v1/pipeline-catalog`
- **THEN** the former returns that pipeline's detail and the latter returns the vocabulary

## MODIFIED Requirements

### Requirement: Pipeline mutations run through a whitelisted CLI bridge

`POST /api/v1/pipelines` SHALL accept exactly five operations discriminated by an `op` field — `import` (a source path with an optional overwrite flag), `init` (a new name and an output path), `export` (a name, a destination path, and an optional overwrite flag), `delete` (a name with an optional force flag), and `save` (a name, a definition object, and an optional force flag) — performing each exclusively by spawning the existing CLI as a subprocess under the shared admission whitelist's bounded-CLI tier; the server writes no library or workspace file itself, with one scratch-only exception: fulfilling `save`, the server MAY write the posted definition to a temporary file in the system temporary directory solely to hand it to the CLI, deleting it afterward (deletion failure is tolerated and logged, never failing the response). The bridge SHALL run at most one pipeline subprocess at a time (409 for a concurrent request), bound the subprocess with a timeout and reliable termination, return the CLI's own error message verbatim with 422 on failure, and reject an unknown `op` with 400 spawning nothing. Every client-supplied filesystem path SHALL be required absolute (400 otherwise, before any spawn), every pipeline name SHALL be validated against the identifier form pipeline names accept and rejected when option-shaped, and every input SHALL be passed as a single argument token, never through a shell; a `save` definition SHALL travel via the temporary file, never as an argument. Delete SHALL always run the CLI's non-interactive confirmed form (client-side confirmation), pass force only when flagged, and a delete targeting a built-in pipeline SHALL be refused with the CLI's refusal passed through. Save SHALL create a user pipeline (201) or, only with `force`, overwrite an existing user pipeline (200); saving over a built-in name SHALL be refused with the CLI's refusal passed through as 422 regardless of `force`. PUT and DELETE methods on the path SHALL be rejected with 405.

#### Scenario: Import installs via the CLI

- **WHEN** a client submits `{ op: 'import', path: <absolute path to a .rasenpkg> }`
- **THEN** the pipeline is installed by a spawned CLI subprocess and the response reports the CLI's own result

#### Scenario: Relative path or option-shaped name rejected before spawn

- **WHEN** a client submits a relative `path` on any operation, or a `name` beginning with `-`
- **THEN** the response is 400 and no subprocess is spawned

#### Scenario: Built-in delete refused

- **WHEN** a client submits `{ op: 'delete', name: <a built-in pipeline>, force: true }`
- **THEN** the response is 422 carrying the CLI's refusal and the pipeline remains available

#### Scenario: Concurrent mutation refused

- **WHEN** a second mutation arrives while a pipeline subprocess is in flight
- **THEN** the response is 409 busy and no second subprocess is spawned

#### Scenario: Windows and POSIX absolute forms both accepted

- **WHEN** a client submits an absolute path in the platform's native form (such as `E:\packages\pipe.rasenpkg` on Windows)
- **THEN** the guard accepts it and the CLI receives it unchanged as one argument

#### Scenario: Save creates via the CLI with a scratch handoff

- **WHEN** a client submits `{ op: 'save', name: <new name>, definition: <valid definition> }`
- **THEN** the pipeline is installed into the user layer by a spawned CLI subprocess, the response is 201, and no file other than a temporary scratch file is written by the server itself

#### Scenario: Save refuses overwrite without force and built-ins always

- **WHEN** a client saves over an existing user pipeline without `force`, or over a built-in name with `force: true`
- **THEN** the former answers 422 with the CLI's refusal and `force: true` retries succeed with 200; the latter answers 422 and the built-in remains unchanged

#### Scenario: Scratch file cleanup tolerates platform locks

- **WHEN** the temporary file's deletion fails after the CLI completes (such as a transient Windows file lock)
- **THEN** the save response still reports the CLI's result and the failure is logged, not surfaced as a request error
