## 1. Wire Contract and Admission

- [x] 1.1 Extend the root `CreateSpaceRequest`/success response union with the explicit `add-project-to-store` Project and Store identifiers, preserving the existing creation members and documenting the 200 membership result.
- [x] 1.2 Mirror the new request/response member in `packages/ui/src/api/types.ts` and add `addProjectToStore(projectId, storeId)` to the single UI API client seam without accepting paths, primary-binding flags, or adoption options.
- [x] 1.3 Add `add-project-to-store-space` to the bounded CLI whitelist and update whitelist/count assertions and nearby contract comments so admission remains data-driven.

## 2. Membership Bridge

- [x] 2.1 Extend `createSpaceCreator()` validation and planning to accept only `op`, `projectId`, and `storeId`, perform a fresh typed catalog lookup, require exactly one live Project and Store, and map malformed, missing, unresolved, wrong-type, and ambiguous identifiers without spawning.
- [x] 2.2 Build and spawn exactly `store add-project <resolved-project-root> --to <storeId> --json` through the existing shell-free, fixed-cwd, cap-one, timeout/kill, and release-on-close machinery, with no code path for `--set-primary`, `--as`, `store adopt`, or direct filesystem mutation.
- [x] 2.3 Parse the successful CLI result only far enough to correlate the target root and Project identity, re-read the spaces catalog after child close, verify the exact Store contains the exact Project once, and return the fresh Store entry as the 200 `store-add-project` response; retain 422 CLI passthrough and 500 protocol failures.
- [x] 2.4 Keep `POST /api/v1/spaces` and its trailing-slash form admitted through the existing authenticated router branch for the new operation, while preserving body limits, standard envelopes, and 405 behavior for unsupported methods.

## 3. Verification

- [x] 3.1 Extend the fake CLI fixture and `create-space` unit tests for strict/cross-operation validation, zero/one/many typed lookup, exact argv and prohibited-option absence, metacharacter/Windows path tokenization, fresh pre/post catalog reads, initial and idempotent success, postcondition failure, CLI passthrough, timeout, and shared creation/membership concurrency.
- [x] 3.2 Add a real-CLI integration case with temporary Project and Store repositories proving first membership, retry without duplication, fresh catalog visibility, and an unchanged Project planning Store.
- [x] 3.3 Extend Management router, wire-mirror, and UI client tests for bearer/method/trailing-slash admission, error codes, exact JSON request, typed response, and compatibility of the original three space operations.
- [x] 3.4 Run focused Management API and UI API tests, root build/typecheck, strict change validation, and the Windows CI/path-sensitive coverage; fix any cross-platform path comparison or encoding regression before handoff.
