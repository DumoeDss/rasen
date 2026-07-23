## 1. Extract the shared config-resolution seam

- [x] 1.1 Create `src/core/config-api/config-context.ts` and MOVE `resolveConfigContext`, `contextResolveOptions`, `pipelineResolutionBundle`, and the `ConfigContext` type out of `src/core/config-api/router.ts` (delete the router-private definitions; export from the new module)
- [x] 1.2 Update `src/core/config-api/router.ts` to import the seam from the new module; verify with grep that exactly one definition of `resolveConfigContext` exists in `src/`

## 2. Move wire types to management-api

- [x] 2.1 Move `WireEffectiveValue`, `WirePipelineStage`, `WirePipeline`, `PipelineMutationRequest` from `src/core/config-api/wire-types.ts` into `src/core/management-api/wire-types.ts` (no re-export shim)
- [x] 2.2 Update all importers (`config-api/router.ts` until its pipelines block is deleted, `management-api/pipeline-submit.ts`, and any others found by grep) to the new location; confirm `packages/ui/src/api/types.ts` mirror needs no edit (shapes unchanged)

## 3. Move the pipelines endpoints into the management route group

- [x] 3.1 Create `src/core/management-api/pipelines.ts` with the moved `handleListPipelines` (consuming the extracted seam) and the POST mutation dispatch; the management router constructs `createPipelineSubmitter`
- [x] 3.2 Add `/api/v1/pipelines` to `MANAGEMENT_PATHS` and add `matchPipelineIdPath` (one segment deep, mirroring `matchWorkflowIdPath`) to `isManagementPath` in `src/core/management-api/router.ts`; wire GET/POST dispatch, 405 for PUT/DELETE, and 404 `not_found` for the reserved one-segment detail path
- [x] 3.3 Delete the `/api/v1/pipelines` block and the `pipeline-submit` cross-boundary import from `src/core/config-api/router.ts` in the same commit

## 4. Unify the error envelope

- [x] 4.1 Extend the management router's `sendError` (src/core/management-api/router.ts) with an optional `fix` parameter, additive-only (omitted when not supplied); align config-api's `ErrorBody` type to the management envelope type (single source)
- [x] 4.2 Ensure the moved pipelines handlers pass through space-resolution `fix` hints unchanged

## 5. Retire the test-only config-api server

- [x] 5.1 Delete `src/core/config-api/server.ts`; re-target `test/core/config-api/server.test.ts` and `test/core/config-api/router.test.ts` to start the composed management server with the same fixtures
- [x] 5.2 Remove any lingering references to `startConfigApiServer` (grep-verified)

## 6. Tests

- [x] 6.1 Move pipelines route tests from `test/core/config-api/` to `test/core/management-api/`, updating server setup to the management server
- [x] 6.2 Add a composition test proving the management server answers `GET/POST /api/v1/pipelines`: full method matrix (GET, POST, PUT, DELETE, unauthorized, trailing slash) asserting status + error code parity with the previous contract, `fix` present on a space-resolution error and absent where no hint exists, and the one-segment detail path answering management-group 404 while `/api/v1/pipelines/x/y` falls through
- [x] 6.3 Run the full suite on Windows (this machine); apply the known EBUSY-flake isolation discipline before attributing failures; verify no `packages/ui` test or type check regresses

## 7. Spec and docs hygiene

- [x] 7.1 Verify `rasen/specs/config-http-api/spec.md` carries no stale claim that config-api serves the pipelines endpoints (grep; expected clean — only config override keys mention pipelines)
- [x] 7.2 Run `rasen validate unify-pipeline-http-api --strict` and fix any findings
