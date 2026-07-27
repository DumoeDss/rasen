> **Task ledger boundary (2026-07-26).** Sections 1-6 are the original
> `pipeline-definition-api` delivery history already present in the
> `origin/dev/0.1.5` baseline. They are closed here so apply does not reimplement
> shipped APIs; later portfolio decisions superseded some details. Sections
> 7-11 are the only unchecked work for this incremental 0.1.5 run.

## 1. Registry core: origin widening + issue-collecting validation

- [x] 1.1 Widen `origin` in `src/core/pipeline-registry/types.ts` from `z.literal('composed')` to `z.enum(['composed', 'ui'])`; update the field description
- [x] 1.2 Rescope `validateComposedPolicyFloor` in `src/core/pipeline-registry/pipeline.ts` to any origin-stamped pipeline (`if (!pipeline.origin) return`), messages naming the actual origin value; keep origin-free pipelines untouched (historical plan; later Canvas policy superseded the UI-floor portion)
- [x] 1.3 Refactor the structural checks (duplicate ids, requires refs, cycles, parallel groups, decompose, floor) to be individually invokable, and add an issue-collecting `validatePipelineDraft(definition, skillSets)` returning `{ severity, path, message }[]` (Zod issues → definition-path locators; skill known/enabled via injected sets; unknown-profile notices as warnings); `parsePipeline` keeps its throwing behavior by calling the same functions
- [x] 1.4 Test: parse-chain-rejects ⇔ collector-reports-an-error over shared fixtures; floor scope tests for `composed`, `ui`, and origin-free (historical plan; later Canvas policy superseded the UI-floor expectation)

## 2. CLI: `rasen pipeline save`

- [x] 2.1 Add `savePipeline` to `src/core/pipeline-library.ts`: read `--from` file as JSON or YAML, validate via full chain + skill checks, refuse built-in names always and existing user pipelines without force, emit canonical YAML into the user layer, preserve `origin` verbatim
- [x] 2.2 Wire `save <name> --from <file> [--force] [--json]` into `src/commands/pipeline-library.ts` / `commands/pipeline.ts` with the shared root-selection layer and localized messages
- [x] 2.3 Round-trip test: save → show/export semantic identity over definitions exercising agents, handoff, reuse, loop variants, parallelGroup, decompose; JSON and YAML inputs; Windows paths via path.join

## 3. Wire types (core only)

- [x] 3.1 Add to `src/core/management-api/wire-types.ts`: `WirePipelineDefinition` (derived from the loader schema's inferred type), `PipelineDetailResponse`, `PipelineValidationRequest`/`PipelineValidationIssue`/`PipelineValidationResponse`, `PipelineCatalogResponse`, and the `save` member of the mutation request union — with a comment noting the `packages/ui` mirror is deliberately deferred to the first consuming change (children 3-4)

## 4. Endpoints

- [x] 4.1 Detail: implement `handlePipelineDetail` in `src/core/management-api/pipelines.ts` (grammar-validate + percent-decode name, `?space=` via `resolveConfigContext`, 404 unknown, both views + `editable`); swap the router's `matchPipelineIdPath` 404 branch for it
- [x] 4.2 Validation: add `/api/v1/pipeline-validation` to `MANAGEMENT_PATHS`, POST-only (405 GET/PUT/DELETE); handler parses body (400 when no `definition`), resolves skill sets once, returns 200 `{ valid, issues }`; no file writes, no spawn, no bridge slot
- [x] 4.3 Catalog: add `/api/v1/pipeline-catalog` to `MANAGEMENT_PATHS`, GET-only; vocabularies sourced from the Zod schema `.options` and skill sets from `resolvePipelineExecutionSkillSets` (id, description, enabled); include gate default, handoff constraints, condition label suggestions
- [x] 4.4 Save op: add `save-pipeline` whitelist row (`src/core/management-api/whitelist.ts`); extend `pipeline-submit.ts` with the `save` case — temp file in `os.tmpdir()` (random name, closed before spawn), CLI `pipeline save <name> --from <tmp> [--force] --json`, 201 create / 200 overwrite / 422 verbatim / 409 shared slot / 400 malformed before spawn; failure-tolerant deletion in `finally` (log-and-leak)

## 5. Route/security tests

- [x] 5.1 Method matrix for all three new paths (401 unauthorized, 405 wrong methods, trailing slash) on the composed management server
- [x] 5.2 Shadowing guard: user pipelines named `catalog` and `validation` — detail endpoint serves them; `/api/v1/pipeline-catalog` and `/api/v1/pipeline-validation` still serve their own contracts; `/api/v1/pipelines/<name>/extra` falls through
- [x] 5.3 Validation endpoint: multi-issue draft (cycle + unknown skill) reports all issues at 200; concurrent-with-mutation request answers without 409
- [x] 5.4 Save bridge: create 201 / no-force overwrite 422 then force 200 / built-in refusal 422 / definition never in argv / scratch-deletion failure still answers success (Windows lock simulation)
- [x] 5.5 Detail: built-in `editable: false` with definition present; save-then-detail round-trip semantic identity through the HTTP surface

## 6. Verification and hygiene

- [x] 6.1 Full suite on Windows (this machine) with the known EBUSY-flake isolation discipline; confirm zero `packages/ui` diffs in the original change
- [x] 6.2 Run `rasen validate pipeline-definition-api --strict` and fix findings for the original delivery

## 7. Incremental v1 schema boundary

- [x] 7.1 Add a named Pipeline definition content-version constant and make `PipelineYamlSchema` normalize an absent `version` to literal `1` while rejecting every explicit non-v1 value with an actionable `/version` diagnostic shared by throwing and issue-collecting validation
- [x] 7.2 Add registry tests for explicit v1, unversioned legacy YAML/JSON, unsupported numeric and malformed versions, and unchanged flat DAG plus `review-cycle`/`goal` loop normalization
- [x] 7.3 Stamp `version: 1` into every built-in `pipelines/*/pipeline.yaml` and the `rasen pipeline init` scaffold, retaining at least one unversioned fixture to exercise legacy compatibility

## 8. Incremental public round-trips

- [x] 8.1 Centralize normalized Pipeline YAML serialization and use it from save/scaffold/export so emitted content always carries v1 without dropping other normalized fields
- [x] 8.2 Normalize the `pipeline.yaml` entry during `.rasenpkg` export (preserving ancillary package files and the separate package `formatVersion`); test export/decode/import of an unversioned user source and fail-closed export of an unknown version
- [x] 8.3 Expose `version: 1` through detail/show and the core `WirePipelineDefinition`; update management API detail/validation fixtures and assert unknown versions produce a 200-invalid issue at `/version`
- [x] 8.4 Update the existing UI `WirePipelineDefinition` mirror, Canvas fixtures, and draft round-trip tests so v1 is required and preserved without changing Canvas execution behavior

## 9. Incremental compatibility documentation

- [x] 9.1 Document the Pipeline `version: 1` field, legacy normalization, unknown-version refusal, and save/detail/show/export behavior in the canonical English and Chinese CLI/Pipeline guides
- [x] 9.2 State in English and Chinese Pipeline/Canvas documentation that v1 flat DAG and current loop declarations remain readable/future-compiler inputs, loops are still LEAD-playbook owned, and Canvas is a definition editor rather than a programmatic runner

## 10. Incremental regression coverage

- [x] 10.1 Run focused registry, pipeline-library/package, management API, and UI Canvas tests; update fixtures without weakening existing structural, path-safety, or round-trip assertions
- [x] 10.2 Run TypeScript type checks/build plus the full Windows test suite using the repository's EBUSY-flake isolation discipline

## 11. Incremental artifact and diff verification

- [x] 11.1 Run `rasen validate pipeline-definition-api --strict --json` (or the supported strict JSON form) and fix all findings
- [x] 11.2 Run `git diff --check` and confirm the product diff contains no Composite/ReviewCycle runner, journal, nested Canvas, auto/goal runtime migration, or Issue orchestration work
