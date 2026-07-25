## ADDED Requirements

### Requirement: Threshold scheme catalog exposes schemes, preset seeds, and binding rows

The bearer-secured management API SHALL serve `GET /api/v1/threshold-schemes` as an installation-wide endpoint. The response SHALL include every machine-level threshold scheme in deterministic name order, preserving valid definitions and per-file invalid errors; a read-only seed entry for every built-in model preset; and the ordered binding-row vocabulary consisting of the probe-capable runtime registry entries plus the separate `default` row. The endpoint SHALL take no planning-space selector because all three collections are machine-level.

Every preset seed SHALL carry its model match patterns, context-window size, a complete handoff/reuse scheme seed, and a per-family source identifying whether the value came from the preset suggestion or the built-in family default. Runtime rows and preset values SHALL be obtained from their core registries rather than repeated in management or UI allow-lists.

#### Scenario: Catalog returns valid and malformed scheme entries

- **WHEN** the machine library contains one valid scheme and one malformed YAML file
- **THEN** an authorized catalog request returns both entries in name order, with the valid definition and the malformed entry's error kept distinct

#### Scenario: Missing scheme directory is an empty catalog

- **WHEN** the scheme directory does not exist
- **THEN** the catalog returns an empty `schemes` collection while still returning preset seeds and binding rows

#### Scenario: Preset without suggestions receives complete default seeds

- **WHEN** a built-in model preset supplies a context window but no handoff or reuse suggestion
- **THEN** its catalog entry contains the built-in handoff and reuse defaults as a complete seed
- **AND** each value is labeled with source `default`, not `preset`

#### Scenario: Probe capability controls binding rows

- **WHEN** the runtime registry contains Claude and Codex as probe-capable and Zed as audit-only
- **THEN** binding rows contain `claude`, `codex`, and `default` in stable order
- **AND** do not contain `zed`

### Requirement: Threshold scheme mutations use the core validation and atomic storage contract

The management API SHALL accept authenticated `POST /api/v1/threshold-schemes` requests discriminated as create, update, or delete. Create and update SHALL accept a scheme name and complete definition; delete SHALL accept a name. Every mutation SHALL validate names and contents through the threshold-scheme core and perform writes through its atomic storage operations. Create SHALL refuse an existing filename with 409, update SHALL require an existing filename and answer 404 when absent, and delete SHALL answer 404 when absent. Invalid names or definitions SHALL answer 400 in the unified management error envelope.

No operation SHALL rename a scheme, mutate a model preset, rewrite a binding, or infer a planning space. A successful response SHALL return the stored normalized scheme or the deleted name. Scheme paths SHALL remain platform-safe because the handler passes only validated names to the existing core path functions.

#### Scenario: Create is visible to CLI and catalog

- **WHEN** an authorized client creates valid scheme `focused`
- **THEN** the API returns its normalized definition
- **AND** a subsequent catalog read and `rasen scheme show focused --json` observe the same stored scheme

#### Scenario: Create never silently overwrites

- **WHEN** a file named `focused.yaml` already exists, whether valid or malformed, and the client requests create
- **THEN** the API answers 409 and leaves the existing file unchanged

#### Scenario: Update can repair malformed contents

- **WHEN** `focused.yaml` exists but is malformed and the client submits an update with a valid complete definition
- **THEN** the API atomically replaces it and the next catalog read reports a valid scheme

#### Scenario: Delete is explicit and scoped to one validated name

- **WHEN** an authorized client deletes existing scheme `focused`
- **THEN** only the platform-resolved `focused.yaml` file under the machine schemes directory is removed and the response reports `deleted: "focused"`

#### Scenario: Invalid write preserves the previous scheme

- **WHEN** an update omits a required family, includes an invalid role, or uses an invalid threshold
- **THEN** the API answers 400 and the prior file remains readable

### Requirement: Threshold management wire mirrors stay synchronized

The root management wire module and the web UI API mirror SHALL define equivalent types for scheme catalog entries, complete preset seeds, binding rows, mutation requests, and mutation responses. The pipeline threshold metadata wire types SHALL likewise mirror the core binding scope/row/name and missing/invalid-scheme diagnostics. Type/fixture tests SHALL fail when a field is added to one side without updating the other.

#### Scenario: Representative catalog fixture satisfies both mirrors

- **WHEN** the test suite constructs a catalog containing a valid scheme, an invalid scheme, a preset seed, and a default binding row
- **THEN** that fixture satisfies both the root response type and the UI response type without coercing or dropping fields

#### Scenario: Runtime and binding metadata values round-trip unchanged

- **WHEN** a response contains a `codex` row or binding metadata `{ scope: "store", row: "codex", scheme: "tight" }`
- **THEN** both wire layers preserve those values exactly

### Requirement: Management security applies to every threshold scheme operation

Threshold scheme reads and writes SHALL use the management server's loopback-only, bearer-token-protected route group and unified error envelope. Unauthorized requests SHALL run no catalog or mutation handler logic, unsupported methods SHALL answer 405, and request-size limits SHALL apply before parsing a mutation body.

#### Scenario: Unauthorized scheme request is rejected before storage access

- **WHEN** a GET or POST request omits the session token or supplies an incorrect token
- **THEN** the server answers 401 and performs no scheme filesystem operation

#### Scenario: Unsupported method is rejected

- **WHEN** a client sends PUT or DELETE directly to `/api/v1/threshold-schemes`
- **THEN** the server answers 405 and performs no mutation
