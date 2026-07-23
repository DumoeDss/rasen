## Why

The pipelines HTTP surface is split across two modules with an inverted dependency: `GET /api/v1/pipelines` lives in the config-api router (which imports the management-api mutation bridge across the boundary), while the whitelist, the bridge, and every sibling domain endpoint (workflows, spaces, sessions, runs) live management-side. The `pipeline-http-api` spec already declares the management security posture; the code lags it. Upcoming online-assembly endpoints (pipeline detail, draft validation, save, catalog) need a single management-side home before they land, and the daemon's remote-deployment direction needs one API surface with one error vocabulary.

## What Changes

- `/api/v1/pipelines` (GET + POST) moves from the config-api route group to the management route group: `MANAGEMENT_PATHS` claims the path, a `matchPipelineIdPath` prefix matcher reserves the upcoming detail path, and a new `management-api/pipelines.ts` handler owns the endpoints. The config router's pipelines block is deleted in the same change (no dead fallback).
- The space/config resolution seam (`resolveConfigContext`, `contextResolveOptions`, `pipelineResolutionBundle`, `ConfigContext`) is extracted from the config-api router into an importable config-api module — moved, not copied; both routers consume the single definition.
- Pipeline wire types (`WireEffectiveValue`, `WirePipelineStage`, `WirePipeline`, `PipelineMutationRequest`) move from config-api `wire-types.ts` into management-api `wire-types.ts` with no re-export shim (all importers updated in the same change).
- Error envelope unified: one shared envelope `{ error: { code, message, fix? } }` across both route groups; the management error helper gains the optional `fix` field so the moved pipelines endpoints keep their space-resolution fix hints. This is the ONE sanctioned wire-visible change — edge-case error vocabulary on `/api/v1/pipelines` (401/405/space errors) now comes from the management group and may carry `fix`.
- The test-only standalone `startConfigApiServer` (`src/core/config-api/server.ts`) is retired; its tests re-target the composed management server.
- Zero other wire-visible behavior change: paths, port, token, response shapes, and UI client calls (`packages/ui/src/api/client.ts`) are unchanged; the UI wire-type mirror needs no edits (shapes unchanged).
- Out of scope: the four new online-assembly endpoints (detail/validation/save/catalog — next change); stage config override keys (`pipelines.<name>.gates.<stage>` etc.) stay in config-http-api; remote-deployment TLS/auth hardening.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-http-api`: the surface is served by the management route group (dispatch ownership, not URL); error responses use the unified envelope with optional `fix`, and space-resolution errors keep their fix hints.
- `management-http-api`: `/api/v1/pipelines` and its one-segment suffixes become management paths; the management error envelope carries an optional `fix` field.

## Impact

- Code: `src/core/config-api/router.ts` (pipelines block + resolution seam removed), new `src/core/config-api/config-context.ts` (extracted seam), `src/core/management-api/{router,paths,pipelines,wire-types}.ts`, `src/core/config-api/wire-types.ts`, `src/core/config-api/server.ts` (deleted), `src/core/management-api/pipeline-submit.ts` (import updates only).
- Tests: pipelines route tests move `test/core/config-api/` → `test/core/management-api/`; a composition test proves the management server answers `GET/POST /api/v1/pipelines` identically; `test/core/config-api/server.test.ts` re-targets the composed server.
- UI: no changes (`packages/ui/src/api/client.ts` paths identical; `packages/ui/src/api/types.ts` mirror keyed by shape, shapes unchanged).
- Sets up change 2 (pipeline-definition-api): detail/validation/save/catalog endpoints slot into `management-api/pipelines.ts` + the reserved id matcher without re-touching what this change moves.
