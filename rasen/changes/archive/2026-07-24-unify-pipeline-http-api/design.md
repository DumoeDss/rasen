## Context

Production always runs ONE server: `startManagementServer` composes two route groups on the same `http.Server` (`src/core/management-api/server.ts:87-97`) — paths matching `isManagementPath` (`src/core/management-api/router.ts:235`) go to the management router; everything else falls through to the config router. `/api/v1/pipelines` is deliberately absent from `MANAGEMENT_PATHS` (`router.ts:74`), so today it is handled by the config router (`src/core/config-api/router.ts:842-876` dispatch, `handleListPipelines` at :448), which imports the management-side mutation bridge (`pipeline-submit.ts`) across the boundary — the dependency inversion this change removes. Both groups share the same context type, token check, body cap, and loopback bind, so the move is invisible on the wire.

Reference research (validated): `rasen/office-hours/pipeline-http-unification.md` §0-§2. Parent plan: `rasen/changes/pipeline-online-assembly/planning-context.md` (this is child 1 of 4; child 2 adds detail/validation/save/catalog endpoints into the home established here).

## Goals / Non-Goals

**Goals:**
- Management router owns `/api/v1/pipelines` (all methods); config router no longer mentions pipelines endpoints.
- One shared config-resolution seam consumed by both routers (moved, not copied).
- One error envelope `{ error: { code, message, fix? } }` produced by one helper family across both groups.
- Test-only `startConfigApiServer` retired.
- Child 2's four endpoints slot into `management-api/pipelines.ts` + the reserved id matcher without re-touching anything moved here.

**Non-Goals:**
- No new endpoints (detail/validation/save/catalog are child 2).
- Stage config override keys (`pipelines.<name>.gates.<stage>` etc.) stay config-api.
- No URL/port/token/response-shape changes; no UI edits; no TLS/auth hardening.

## Decisions

1. **Hard move, no alias, single change.** Dispatch order guarantees a leftover config-router pipelines block would be dead code, not a fallback — delete it in the same commit. Alternative (alias period) rejected: nothing on the wire changes, so there is nothing to alias.

2. **Path claim shape.** Add `/api/v1/pipelines` to `MANAGEMENT_PATHS` and a `matchPipelineIdPath` one-segment prefix matcher mirroring `matchWorkflowIdPath` (`router.ts:122`), included in `isManagementPath`. The matcher is added NOW (child 2 needs `GET /api/v1/pipelines/<name>`); until child 2 lands, a matched id path answers 404 `not_found` from the management group — acceptable because today the config router also has no such route (it 404s too); only the envelope source changes, which is the sanctioned change.

3. **New handler home `src/core/management-api/pipelines.ts`.** Receives the moved `handleListPipelines` and the POST dispatch; the management router constructs `createPipelineSubmitter` (already management-side) — the config→management import in `config-api/router.ts:45` disappears. Child 2 adds handlers to this file only.

4. **Resolution seam extraction: new `src/core/config-api/config-context.ts`.** Moves `resolveConfigContext` (`config-api/router.ts:212`), `contextResolveOptions` (:261), `pipelineResolutionBundle` (:401), and the `ConfigContext` type out of the router. Direction becomes management-api → config-api's exported seam, precedented by the existing `config-api/project-addressing.js` import. Alternative (promote into `effective-config.ts`) rejected: that module is config-value plumbing; the seam is space/context addressing and deserves its own name. Must be move-and-import — one definition, no copy (R2).

5. **Wire types move with no shim.** `WireEffectiveValue`, `WirePipelineStage`, `WirePipeline`, `PipelineMutationRequest` (config-api `wire-types.ts:78-123`) → management-api `wire-types.ts`. Sole importers today are the two routers and `pipeline-submit.ts`; update all in-change. The UI mirror (`packages/ui/src/api/types.ts`) is keyed by shape, not import path — zero UI edits.

6. **Envelope unification = one helper, management-side canonical.** Management's envelope type already declares `fix?` (`management-api/wire-types.ts:33`) but its `sendError` (`router.ts:250`) never emits it; config-api's `sendError` (`config-api/router.ts:76`) does. Give the management helper an optional `fix` parameter (or share one helper module) so the moved pipelines handlers keep emitting their space-resolution fix hints. Config-api's `ErrorBody` aligns to (or re-exports) the management type. Wire-visible delta is confined to `/api/v1/pipelines` edge responses now being answered by the management group's method/path handling — spec'd explicitly in the delta specs.

7. **Retire `src/core/config-api/server.ts`.** Referenced only by tests; it duplicates lifecycle code and misleads readers into thinking two servers exist. Delete it; `test/core/config-api/server.test.ts` and `router.test.ts` re-target the composed management server (start it with the same fixtures). Pipelines route tests move to `test/core/management-api/`.

## Risks / Trade-offs

- [R1 dispatch fall-through regression: management group's 401/405/404 vocabulary now answers `/api/v1/pipelines` edges] → composition test asserts status+code (and `fix` presence where promised) for the full method matrix on `/api/v1/pipelines`, not just happy paths.
- [R2 seam copied instead of moved, silent divergence later] → task explicitly deletes the router-private definitions; grep-guard task confirms single definition of `resolveConfigContext`.
- [Test-server retirement destabilizes config-api test suite (fixtures assumed the lean server)] → re-target incrementally; the composed server accepts the same context; Windows EBUSY flake discipline applies (known repo history).
- [Envelope helper merge accidentally changes non-pipeline management errors] → helper change is additive-only (`fix` optional, omitted everywhere it isn't supplied today); existing management route tests stay green unmodified.

## Migration Plan

Single change, no deploy phases. Rollback = revert commit (no data, no persisted format touched).

## Open Questions

(none — the six portfolio-level OQs were adjudicated in planning-context.md)
