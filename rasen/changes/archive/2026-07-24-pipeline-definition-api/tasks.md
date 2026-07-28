## 1. Registry core: origin widening + issue-collecting validation

- [x] 1.1 Widen `origin` in `src/core/pipeline-registry/types.ts` from `z.literal('composed')` to `z.enum(['composed', 'ui'])`; update the field description
- [x] 1.2 Rescope `validateComposedPolicyFloor` in `src/core/pipeline-registry/pipeline.ts` to any origin-stamped pipeline (`if (!pipeline.origin) return`), messages naming the actual origin value; keep origin-free pipelines untouched (existing tests stay green)
- [x] 1.3 Refactor the structural checks (duplicate ids, requires refs, cycles, parallel groups, decompose, floor) to be individually invokable, and add an issue-collecting `validatePipelineDraft(definition, skillSets)` returning `{ severity, path, message }[]` (Zod issues → definition-path locators; skill known/enabled via injected sets; unknown-profile notices as warnings); `parsePipeline` keeps its throwing behavior by calling the same functions
- [x] 1.4 Test: parse-chain-rejects ⇔ collector-reports-an-error over shared fixtures; floor scope tests for `composed`, `ui`, and origin-free

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

- [x] 6.1 Full suite on Windows (this machine) with the known EBUSY-flake isolation discipline; confirm zero `packages/ui` diffs in the change
- [x] 6.2 Run `rasen validate pipeline-definition-api --strict` and fix findings
