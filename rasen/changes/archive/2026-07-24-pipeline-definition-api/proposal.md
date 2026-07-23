## Why

Child 1 (unify-pipeline-http-api) established the management-side home for the pipelines HTTP surface, but the surface is inventory-and-mutation only: a client can list pipelines and import/init/export/delete them, yet cannot read a single pipeline's editable definition, dry-run-validate a draft, save a definition it assembled, or discover the vocabulary (skills, roles, enums) needed to assemble one. The pipeline canvas (children 3-4) needs exactly these four contracts before any UI work can start.

## What Changes

- `GET /api/v1/pipelines/<name>`: pipeline detail — the resolved view (existing `WirePipeline` shape) PLUS a round-trippable declared definition (`WirePipelineDefinition`, JSON⇄YAML equivalence committed) and an `editable` flag (false for built-ins, which remain readable as save-as templates). Fills the one-segment path child 1 already reserved (currently 404).
- `POST /api/v1/pipeline-validation`: in-process dry-run of a body-carried draft definition — runs the full chain (Zod schema → structural checks including duplicate ids, dangling requires, cycle detection, parallel-group independence, decompose constraints, quality floor → execution preflight skill known/enabled checks) and returns 200 with a structured issue list for both valid and invalid drafts; never writes a file, never spawns a subprocess. Own path so a pipeline named `validation` can't be shadowed.
- `POST /api/v1/pipelines` gains a fifth operation `op: 'save'` — creates or (with `force`) overwrites a USER pipeline from a posted definition, via a new `rasen pipeline save <name> --from <file>` CLI subcommand, a new `save-pipeline` whitelist row, and a server-owned temp-file handoff (the one sanctioned exception to "the server writes no library file": it writes only a scratch temp file). Saving over a built-in name is refused.
- `GET /api/v1/pipeline-catalog`: assembly vocabulary — installed skills (with enabled state), role/runtime/verify-policy/loop-kind/stage-kind enums, gate default, handoff threshold constraints, and conventional condition labels. Own path so a pipeline literally named `catalog` is never shadowed.
- Origin stamp decision (settled here): the `origin` marker widens from `'composed'` to `'composed' | 'ui'`; UI-assembled pipelines are saved with `origin: 'ui'` and are subject to the same machine-enforced quality floor as LEAD-composed ones (at least one reviewer-role stage and one review-cycle loop). The validation endpoint reports floor violations as ordinary issues so the editor can guide the user before save.
- New wire types (`WirePipelineDefinition`, `PipelineDetailResponse`, `PipelineValidationRequest/Response`, `PipelineCatalogResponse`, save request) land in `src/core/management-api/wire-types.ts`. This change adds NO UI client code, so the `packages/ui` mirror is intentionally untouched — the mirror is updated by the child that first consumes each shape (children 3-4), per the established mirror discipline.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-http-api`: adds the detail, draft-validation, and catalog endpoints; the mutation-bridge requirement's operation set grows from four to five (`save`), with the temp-file scratch-write carve-out and the built-in refusal; commits the definition round-trip (save-then-get semantic identity).
- `management-http-api`: the reserved one-segment pipeline path now serves the detail contract; `/api/v1/pipeline-validation` and `/api/v1/pipeline-catalog` become management paths (validation admits POST; catalog is GET-only).
- `opsx-pipeline-registry`: the `origin` field admits `'ui'` alongside `'composed'` (pipeline file shape); the quality floor applies to any origin-stamped pipeline (`composed` or `ui`), with origin-free pipelines still entirely unaffected; the `rasen pipeline` CLI surface gains the `save <name> --from <file>` subcommand. (`autopilot-composed-pipelines` needs no delta: its floor requirement describes LEAD composition, which is unchanged.)

## Impact

- Code: `src/core/management-api/pipelines.ts` (three new handlers + save op in POST dispatch), `src/core/management-api/router.ts` (two new paths in `MANAGEMENT_PATHS`, detail branch swap), `src/core/management-api/wire-types.ts`, `src/core/management-api/pipeline-submit.ts` (save op + temp-file handoff), `src/core/management-api/whitelist.ts` (+1 row), `src/core/pipeline-registry/types.ts` (origin enum widening), `src/core/pipeline-registry/pipeline.ts` (floor scope + issue-collecting validation entry), `src/core/pipeline-library.ts` + `src/commands/pipeline-library.ts` (save subcommand, JSON definition input, YAML emission).
- Tests: management-api route tests (all four contracts incl. method matrix and shadowing guards), round-trip property test (definition ⇄ YAML), save temp-file lifecycle on Windows (lock-tolerant deletion), floor scope tests.
- UI: none in this change (mirror + client consumption deferred to children 3-4, stated explicitly).
- Dependencies: none new. Requires child 1's moved home (already in tree).
