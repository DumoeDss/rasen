## Why

Creating an Issue currently forces a person to invent a lowercase kebab-case identifier because one value serves simultaneously as user input, machine identity, selector, and directory name. That storage constraint leaks into every creation surface and makes a routine action fail for reasons unrelated to the work being described.

## What Changes

- Allocate every new Issue an immutable UID and a collision-resistant human reference in the Store Issue module; creation requires only a title.
- Separate authoritative identity from presentation and storage: UID identifies the Issue, a short Issue key is used in conversation and default UI/CLI output, optional aliases support search and compatibility, and an internal storage key alone locates files.
- Add one selector-resolution seam that accepts an Issue UID, generated Issue key, or compatible legacy identifier and either resolves exactly one Issue or reports an explicit not-found/ambiguous result.
- Store new Issues and new versioned Issue-owned resources by UID, and carry UID references in their canonical records.
- Keep existing version-1 Issue directories, records, plans, acceptance content, URLs, and CLI selectors readable and operable without an eager destructive migration; expose a deterministic compatibility identity and retain the old identifier as an alias.
- Change CLI and HTTP creation contracts so an Issue identifier is optional compatibility input rather than a required machine identity, and remove the Issue ID field from the normal UI create flow.
- Canonicalize Issue detail links to UID while displaying the generated short key and preserving old deep links through selector resolution.
- **BREAKING**: a supplied legacy `issueId` during creation no longer chooses the authoritative identity or storage directory; callers must use the returned UID/key for subsequent durable references.

## Capabilities

### New Capabilities

- `system-assigned-issue-identity`: System allocation, versioned identity projection, selector resolution, and legacy compatibility for Store Issues.

### Modified Capabilities

- `store-issue-resources`: Issue creation and Issue-owned resource records use system-assigned identity rather than an operator-authored identifier.
- `store-planning-layout-v2`: New Issue content is addressed by immutable UID while legacy layout remains readable.
- `management-http-api`: Issue creation accepts title-only input and Issue endpoints resolve UID, key, or legacy selector through one contract.
- `issue-board-ui`: The Issue board creates from a title, displays the generated key, and links by UID.
- `unlinked-changes-ui`: Single-Change Issue creation stops requiring an authored ID and consumes the allocated identity returned by creation.
- `management-ui-shell`: Store Issue deep links use the immutable Issue UID as their canonical route identity while compatible old links continue to resolve.

## Impact

- Core Store Issue schemas, serializers, locking, path addressing, aggregate query collection, selector resolution, and legacy readers.
- Execution Plan and acceptance record identity fields plus their versioned canonical digests.
- `rasen store issue` CLI syntax/output/completions/localization and every Issue selector call site.
- Management API request/response wire types, routing handlers, and parity tests.
- Web UI API mirrors, Issue Board/Detail/Unlinked flows, routes, labels, and tests.
- Existing Store fixtures and compatibility coverage across Windows, macOS, and Linux; no external dependency is required beyond Node's cryptographic UUID support.
