> **0.1.5 incremental amendment (2026-07-26).** The definition API, draft
> validation, save bridge, catalog, and Canvas consumers described by the
> original proposal below are already implemented in the `origin/dev/0.1.5`
> baseline. This amendment preserves that delivery history and scopes the
> remaining work to the Pipeline content-format v1 compatibility boundary.

## Why

Child 1 (unify-pipeline-http-api) established the management-side home for the pipelines HTTP surface, but the surface is inventory-and-mutation only: a client can list pipelines and import/init/export/delete them, yet cannot read a single pipeline's editable definition, dry-run-validate a draft, save a definition it assembled, or discover the vocabulary (skills, roles, enums) needed to assemble one. The pipeline canvas (children 3-4) needs exactly these four contracts before any UI work can start.

Those original API and Canvas contracts now exist, but their public
round-trippable definition is still unversioned. Because 0.1.5 is the first
release that exposes save/detail/export of Pipeline definitions, it needs a
content-version boundary now: otherwise a future Composite compiler would have
to infer which historical shape an unversioned definition meant.

## What Changes

### 0.1.5 incremental compatibility slice

- Add Pipeline content format `version: 1` to the normalized public definition.
  Historical YAML with no version remains readable and normalizes to v1.
- Make detail, save, show, and exported `.rasenpkg` Pipeline payloads preserve
  and expose the normalized v1 value; newly scaffolded and built-in Pipeline
  YAML declares v1 explicitly.
- Reject unknown future Pipeline content versions on every loader, validation,
  save, and export path with an actionable diagnostic that names the
  unsupported and supported versions. The `.rasenpkg` package format version
  remains a separate contract.
- Preserve v1's existing flat stage DAG and
  `stage.loop.kind: review-cycle|goal` as stable, readable inputs for a future
  compiler. Existing users do not need to rewrite their Pipeline YAML.
- Update Pipeline and Canvas documentation to state that loop declarations are
  still interpreted by the LEAD orchestration playbook and Canvas edits
  definitions; Canvas is not a programmatic Pipeline runner.
- Keep the Composite/ReviewCycle runner, durable execution journal, nested
  Composite Canvas, `rasen-auto`/`rasen-goal` runtime migration, and Issue-level
  orchestration out of 0.1.5.

### Delivered baseline (historical)

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

- `pipeline-http-api`: preserves the delivered detail, validation, catalog, and
  save contracts while making the normalized definition's v1 identity explicit
  and making draft validation fail closed on unknown future content versions.
- `opsx-pipeline-registry`: adds the Pipeline content-format v1 compatibility
  contract across load/show/scaffold/save/export while keeping the flat DAG and
  current loop declarations readable.
- `management-http-api` (historical baseline only): the previously delivered
  route and method contracts remain unchanged by the v1 amendment.

## Impact

- Code: `src/core/management-api/pipelines.ts` (three new handlers + save op in POST dispatch), `src/core/management-api/router.ts` (two new paths in `MANAGEMENT_PATHS`, detail branch swap), `src/core/management-api/wire-types.ts`, `src/core/management-api/pipeline-submit.ts` (save op + temp-file handoff), `src/core/management-api/whitelist.ts` (+1 row), `src/core/pipeline-registry/types.ts` (origin enum widening), `src/core/pipeline-registry/pipeline.ts` (floor scope + issue-collecting validation entry), `src/core/pipeline-library.ts` + `src/commands/pipeline-library.ts` (save subcommand, JSON definition input, YAML emission).
- Tests: management-api route tests (all four contracts incl. method matrix and shadowing guards), round-trip property test (definition ⇄ YAML), save temp-file lifecycle on Windows (lock-tolerant deletion), floor scope tests.
- UI: none in this change (mirror + client consumption deferred to children 3-4, stated explicitly).
- Dependencies: none new. Requires child 1's moved home (already in tree).

Incremental 0.1.5 impact: the Pipeline registry schema/normalizer, canonical
serialization used by scaffold/save/export, management and UI wire mirrors,
Pipeline/API/Canvas fixtures, built-in Pipeline YAML, and English/Chinese
Pipeline documentation. No new dependency and no execution-runtime change.
