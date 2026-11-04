## Context

The CLI already owns the complete, non-destructive `storeAddProject()` mutation. It registers the Project in the project namespace when necessary, appends the Store-side reference and membership authority record, appends the Project-side locator hint, and makes retries idempotent. Its `setPrimary` input is explicitly default-off. The Management API currently exposes three space lifecycle operations through `createSpaceCreator()`, which validates a discriminated request, admits one bounded CLI operation, spawns the running installation with an argv array and `shell: false`, passes CLI failures through, and re-reads `handleSpaces()` before returning.

The missing seam is transport, not a new membership model. A later UI change needs to name the current Project and a selected Store, establish their membership, refresh the catalog, and enter the Store-owned Issue Board. This change spans the root wire types, Management router, bounded operation table, bridge, UI type mirror, and client wrapper, but it must not create project-local Issues, bind the Project's planning Store, or perform adoption.

## Goals / Non-Goals

**Goals:**

- Add one explicit, retry-safe Management API operation for an existing Project to join an existing Store.
- Keep all filesystem mutation and membership semantics behind the existing CLI/core mutation.
- Resolve the Project and Store from server-owned catalog facts, then return a fresh catalog observation proving the relationship.
- Give the later UI change a small typed client call and stable error behavior.
- Preserve the existing cross-platform, bounded, bearer-secured space bridge.

**Non-Goals:**

- Building the Project Issues entry, picker, dialog, navigation, or any other UI screen.
- Moving planning artifacts, calling `store adopt`, or setting/rebinding the Project's planning Store.
- Adding a second membership record, cache, map, index, or Project-owned Issue store.
- Changing `store add-project` domain semantics, Store Issue authority, or canonical `/s/:storeId/issues` routing.
- Solving pre-existing catalog identity/route redesign beyond refusing ambiguous identifiers.

## Decisions

### D1. Extend the existing space lifecycle operation union

`POST /api/v1/spaces` gains the request member:

```ts
{ op: 'add-project-to-store'; projectId: string; storeId: string }
```

The success member is discriminated by `operation: 'store-add-project'`, returns HTTP 200, and carries the freshly read target `StoreSpaceEntry` in `space`. Existing create/register/setup success members and their HTTP 201 behavior remain unchanged. `CreateSpaceRequest`/`CreateSpaceResponse` may retain their established exported names for compatibility while becoming the complete space-mutation union. The UI client adds `addProjectToStore(projectId, storeId)` so a component does not need to know the HTTP discriminant, route, or CLI syntax.

This keeps one deep space-lifecycle interface over validation, catalog resolution, process control, error translation, and refresh. The alternative, `POST /api/v1/stores/projects`, was rejected: that path is the maintained Store-aggregate query surface, while joining changes the machine space catalog and two repositories before the Project is an aggregate member. A separate endpoint and runner would duplicate the bounded bridge and catalog refresh behavior. Adding a direct in-process handler around `storeAddProject()` was also rejected because Management API workspace mutations are required to flow through the CLI boundary.

### D2. Resolve both identifiers from a fresh catalog and accept no client path

Before spawning, the bridge calls the same `handleSpaces()` enumeration used by `GET /api/v1/spaces` and requires:

- exactly one top-level `ProjectSpaceEntry` whose `id` equals `projectId`, with a live root; and
- exactly one `StoreSpaceEntry` whose `id` equals `storeId`.

Zero matches return 404 `space_not_found`; a same-id entry of the wrong type does not satisfy the lookup; multiple matches return 409 `space_ambiguous`; malformed bodies or identifiers return 400 `invalid_input`. The operation accepts no root/path field. The server supplies the resolved Project root as one argv token, eliminating stale or forged client path selection. Store selection stays explicit and is passed to the existing CLI resolver; no launch-space, first-row, only-member, or previous-selection fallback exists.

After exit zero, the bridge parses the CLI JSON only for the target root and Project identity needed to correlate the result, re-runs `handleSpaces()`, matches the Store by canonical root (not by possibly duplicated display id), and verifies that its `members` contains the requested Project identity exactly once. It then returns that fresh Store entry. An absent or contradictory observation is `500 cli_protocol_error`. The catalog remains a read projection; the CLI's Store membership record remains authority.

Accepting `{ projectRoot, storeRoot }` was rejected because it makes callers reproduce registry resolution, leaks machine locators into UI intent, and permits identifier/path disagreement. Resolving from cached UI rows was rejected because membership may change between page load and mutation.

### D3. Reuse the bounded CLI subprocess module as the mutation seam

The operation receives one new bounded whitelist row, `add-project-to-store-space`. The admitted argv is exactly:

```text
store add-project <resolved-project-root> --to <storeId> --json
```

No option forwarding is exposed. In particular, the builder has no branch that can append `--set-primary`, `--as`, or `--dry-run`, and it cannot select `store adopt`. The child continues to use `process.execPath`, the server installation's `dist/cli/index.js`, fixed server cwd, discrete argv, `shell: false`, and `windowsHide: true`.

Membership shares `createSpaceCreator()`'s per-server one-in-flight slot, 60-second hard timeout, SIGTERM-to-SIGKILL escalation, stdout/stderr capture, and release-on-child-close rule. This is deliberate serialization across all `/spaces` mutations because each changes the catalog the next operation resolves. The existing injected CLI entry and catalog reader are the two justified adapters at this seam: production uses the real CLI/live catalog; tests use a fake CLI/scripted catalog. No additional port or pass-through wrapper is introduced.

Creating a second membership-specific runner was rejected by the deletion test: deleting it would merely scatter the same process-control and error behavior into another module. Calling the core mutation in process was rejected because it would create two transport mutation paths with different admission and failure semantics.

### D4. Keep retry behavior and failures observable without inventing state

The existing CLI operation is the idempotency mechanism. The API does not persist a request key or derive an `alreadyMember` flag. Both an initial call and a replay return 200 only after the fresh Store entry shows one matching member; clients can safely retry after transport uncertainty and refresh their shared catalog with `space`.

The boundary uses a closed error mapping:

| Condition | HTTP / code | Observable contract |
|---|---|---|
| malformed body/identifier or cross-operation field | 400 `invalid_input` | rejected before spawn |
| Project or Store not in the fresh catalog | 404 `space_not_found` | names the unresolved typed identifier |
| identifier matches more than one live typed entry | 409 `space_ambiguous` | caller must make the catalog identity unambiguous |
| another `/spaces` mutation is in flight | 409 `busy` | no second child is spawned |
| CLI exits non-zero | 422 `cli_error` | CLI message, exit code, and stderr pass through |
| child exceeds the bound | 504 `cli_timeout` | termination escalation remains active |
| success cannot be correlated or observed in a fresh catalog | 500 `cli_protocol_error` | no fabricated success |

The response intentionally does not mirror the CLI's incidental write-path arrays or diagnostics. Those remain CLI concerns; the HTTP contract exposes the durable user outcome needed by its caller. Returning only an optimistic `{ok:true}` was rejected because it would force the UI to guess when to refresh and could hide a protocol mismatch.

### D5. Preserve one wire source and one deliberate UI mirror

Root wire types in `src/core/management-api/wire-types.ts` are the server source for the added request/response members. `packages/ui/src/api/types.ts` mirrors them field-for-field under the repository's existing hand-maintained boundary, and `packages/ui/src/api/client.ts` is the only fetch seam. The client wrapper constructs the discriminant and posts JSON; it does not accept a path, planning-binding option, or adoption option.

Compile-time mirror fixtures and client request tests pin both sides. No new shared package or generated schema is justified for one additive union member.

### D6. Test through the public bridge and transport boundaries

The main test surface is `createSpaceCreator()` with its existing fake CLI and injected catalog reader. Tests cover strict body validation, typed zero/one/many catalog resolution, exact argv (including absence of `--set-primary`/`adopt`), inert Windows/metacharacter paths, initial success, idempotent replay, post-read verification, CLI error passthrough, timeout, and shared cap-one concurrency. The scripted catalog returns a pre-mutation snapshot and a post-mutation snapshot so the re-read is observable rather than assumed.

A real-CLI integration test creates a temporary Project and Store, calls the bridge twice, and proves the Store catalog has one member while the Project's planning binding remains unchanged. Router tests cover token/method/trailing-slash admission and standard envelopes. UI client and wire-mirror tests cover the exact JSON request and response type. All filesystem fixtures and path assertions use `path.join()`/canonical comparison so the same contract runs on Windows, macOS, and Linux.

Testing only the core `storeAddProject()` mutation was rejected because it already has coverage and would not exercise the new identifier resolution, argv, process, or refresh seam. Component/UI behavior stays for the dependent change.

## Risks / Trade-offs

- [Catalog identifiers can be duplicated by pre-existing registry state] → Require exactly one typed live match and return 409 instead of choosing by order; correlate success by canonical target root.
- [The Project or Store can disappear between pre-read and CLI execution] → Let the CLI re-resolve/refuse and pass its diagnostic through as 422; never retry a mutation against a different candidate.
- [The CLI can exit zero while catalog observation lags or is inconsistent] → Perform a fresh read after child close and fail closed with `cli_protocol_error`; callers may retry safely because the domain mutation is idempotent.
- [One shared `/spaces` slot serializes unrelated creation and membership calls] → Keep the existing 60-second bound and immediate 409 response; serialization protects catalog-dependent selection and is acceptable for interactive local mutations.
- [The UI type mirror can drift from root wire types] → Extend the existing mirror fixture and client request test in the same change.

## Migration Plan

This is an additive wire operation and whitelist row with no persisted schema migration. Deploy root server and bundled UI types/client together. Existing clients continue using the original three request members unchanged. Rollback removes the request member, client wrapper, route handling, and whitelist row; memberships already established remain valid Store-owned records created by the existing CLI and require no rollback.

## Open Questions

None. The dependent UI change may choose presentation details, but it must consume this exact explicit-membership contract and preserve the Store-owned Issue route.
