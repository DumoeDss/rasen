## ADDED Requirements

### Requirement: An existing Project can join an existing Store through an explicit space operation

The management server SHALL accept `POST /api/v1/spaces` with `{ op: "add-project-to-store", projectId, storeId }` to establish the named Project's membership in the named Store. Both identifiers SHALL be explicit, SHALL resolve to exactly one live entry of the corresponding type in a fresh spaces catalog read, and SHALL never be inferred from the launch project, a previous selection, list order, or the Store having a single possible member.

The server SHALL fulfil the request exclusively by spawning its own installation's CLI as `store add-project <resolved-project-root> --to <storeId> --json`, with every value passed as one argv element and `shell: false`. It SHALL use the existing `store add-project` mutation as membership authority, SHALL omit `--set-primary`, and SHALL NOT invoke `store adopt`. A successful request SHALL respond 200 with `operation: "store-add-project"` and the target Store's entry from a fresh post-mutation spaces catalog read; that entry SHALL include the requested Project as a member. The Project's planning Store and all Issue records SHALL remain unchanged by this operation.

#### Scenario: Add the current Project to an empty Store

- **WHEN** a client names one registered Project and one registered Store that has no members
- **THEN** the server invokes `store add-project` for exactly that Project root and Store id
- **AND** the success response carries the freshly read Store entry with the Project in its `members` list
- **AND** the Project's planning Store is unchanged

#### Scenario: Retry an already-established membership

- **WHEN** the same Project-to-Store request is repeated after the first request succeeded
- **THEN** the request succeeds again without duplicate membership, reference, or locator data
- **AND** the fresh Store entry still contains the Project exactly once

#### Scenario: Multiple possible Stores never create an implicit choice

- **WHEN** the catalog contains multiple Stores or the Project already belongs to another Store
- **THEN** only the Store named by `storeId` receives the membership
- **AND** no Store is selected from catalog order or existing membership

#### Scenario: Windows Project root remains one argv value

- **WHEN** `projectId` resolves to an absolute Windows Project root containing spaces or shell metacharacters
- **THEN** that resolved root is passed unchanged as one `store add-project` argv element without shell interpretation

### Requirement: Project-to-Store membership is validated, bounded, and observable

The membership operation SHALL accept only its documented `op`, `projectId`, and `storeId` fields, with both identifiers present as non-empty, control-character-free, length-capped strings. Missing, unknown-type, cross-operation, unresolved, or ambiguous identifiers SHALL be rejected before spawning, and the server SHALL never accept a client-provided filesystem path for this operation. A CLI refusal SHALL return 422 with the CLI's own error message, exit code, and captured stderr under the existing error contract.

The membership operation SHALL be admitted by its own bounded-CLI whitelist row and SHALL share the space bridge's one-in-flight limit, hard timeout, termination escalation, fixed subprocess working directory, and slot-release-after-child-close discipline. After exit zero, the server SHALL re-read the spaces catalog and verify that the exact target Store contains the exact Project identity; a missing or contradictory postcondition SHALL return a protocol error rather than fabricated success.

#### Scenario: Invalid or unresolved identifiers spawn nothing

- **WHEN** a request omits an identifier, supplies a field from another operation, names a Project as the Store, names a Store as the Project, or names no live matching catalog entry
- **THEN** the server rejects the request with a client error before spawning
- **AND** no registry, Project, or Store file is modified

#### Scenario: CLI refusal remains actionable

- **WHEN** the resolved identities become unavailable or the existing `store add-project` mutation otherwise refuses after admission
- **THEN** the server returns 422 with the CLI's own diagnostic and exit metadata
- **AND** it does not replace the diagnostic with a generic membership error

#### Scenario: Successful exit without visible membership is a protocol error

- **WHEN** the CLI exits zero but the fresh catalog read does not show the requested Project under the exact target Store
- **THEN** the server returns a 500 protocol error rather than reporting success

#### Scenario: Membership and creation serialize through one bridge

- **WHEN** a Project-to-Store request overlaps any other in-flight `/api/v1/spaces` mutation
- **THEN** the later request receives 409 `busy` and spawns no second subprocess
