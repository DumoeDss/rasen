## Context

Child 1 of the pipeline-online-assembly portfolio (in tree, review-clean) established the homes this change fills: `src/core/management-api/pipelines.ts` owns GET/POST `/api/v1/pipelines`; `matchPipelineIdPath` already claims the one-segment detail path (answering 404 `not_found`); wire types and the singly-sourced `ApiErrorBody` live in `src/core/management-api/wire-types.ts`; the shared resolution seam is `src/core/config-api/config-context.ts` (`resolveConfigContext`, `contextResolveOptions`, `contextStoreRef`, `contextProjectRef`, `firstQueryValue`, `pipelineResolutionBundle`, `ConfigContext`) — handlers import it, never re-derive.

Validation machinery already exists in-process: `parsePipeline` (`src/core/pipeline-registry/pipeline.ts:23`) runs Zod (`PipelineYamlSchema`) then the structural chain (duplicate ids :119, dangling requires :132, cycles with path reconstruction :150, parallel-group independence :200, decompose constraints :94, composed quality floor :65); `resolvePipelineExecutionSkillSets` + `validatePipelineSkills` (`execution-validation.ts:101`, `pipeline.ts:232`) cover skill known/enabled. The CLI library layer (`src/core/pipeline-library.ts`) has `scaffoldPipeline`/`importPipelinePackage`/`exportPipeline`/`deletePipeline` but no definition-from-JSON install path. The whitelist (`management-api/whitelist.ts:64-67`) has the four `*-pipeline` bounded-CLI rows.

Reference design (validated facts): `rasen/office-hours/pipeline-http-unification.md` §3. Parent plan: `rasen/changes/pipeline-online-assembly/planning-context.md` (all six OQs adjudicated).

## Goals / Non-Goals

**Goals:**
- Four wire contracts the canvas needs: detail (both views), draft validation (200-with-issues), save (bridge-preserving), catalog (vocabulary).
- JSON⇄YAML round-trip commitment: `save(definition)` then `GET detail` returns a semantically identical definition.
- Settle the origin stamp and quality-floor scope for UI-authored pipelines.

**Non-Goals:**
- No UI code, no `packages/ui` mirror edits (children 3-4 update the mirror when they first consume each shape — stated call, per mirror discipline).
- No changes to what child 1 moved (paths matcher, list handler, existing four ops' semantics).
- No remote-deployment hardening.

## Decisions

1. **`WirePipelineDefinition` = the JSON projection of `PipelineYaml` (schema-derived, not hand-picked).** The definition type is derived from `z.infer<typeof PipelineYamlSchema>` — the loader's own accepted shape — so no YAML-accepted field can be silently dropped (risk R4 of the reference doc). Serialization normalizes exactly as the loader does: defaults applied (`kind: 'standard'`, `gate: false`, `requires: []`), legacy `gate: 'vet'` already coerced to `true`. Round-trip invariant: parse(emitYaml(def)) deep-equals def after schema normalization; enforced by a property-style test over all built-in pipelines plus adversarial fixtures.

2. **Detail endpoint returns BOTH views.** `PipelineDetailResponse { pipeline: WirePipeline; definition: WirePipelineDefinition; editable: boolean }` — the resolved view for preview, the declared view for editing, one request. `editable = provenance !== 'built-in'`; built-ins ARE returned (read-only templates for save-as, per OQ-4's adjudication). Handler: swap the `matchPipelineIdPath` 404 branch in the router for a call into `pipelines.ts`; name percent-decoded and validated by the same identifier grammar the mutation ops use; 404 `not_found` for unknown; `?space=` handled via `resolveConfigContext` exactly like the collection.

3. **Draft validation is a POST with a body-carried draft, collecting issues instead of throwing.** `POST /api/v1/pipeline-validation`, body `{ definition, space? }`. The existing chain throws on FIRST failure; the endpoint wants ALL issues. Add an issue-collecting entry point in the pipeline-registry core (e.g. `validatePipelineDraft(definition, skillSets): PipelineValidationIssue[]`) that runs: Zod safeParse (each Zod issue → one issue with its path), then each structural check in try/catch order (duplicate ids, requires refs, cycles, parallel groups, decompose, quality floor), then skill known/enabled via the injected sets from `resolvePipelineExecutionSkillSets`. Issue shape `{ severity: 'error' | 'warning', path: string, message: string }` with `path` a JSON-pointer-ish locator (`/stages/2/skill`); structural errors that lack a field locus use `/stages` or `/`. `unknown-profile-workflows` notices surface as warnings. 200 for valid AND invalid drafts (invalidity is data); 400 only when the body is not an object with a `definition` member. No file writes, no subprocess, no cap-1 bridge slot consumed. Alternative (op:'validate' on the mutation POST) rejected per OQ-2: validation is not a mutation and must not occupy the bridge slot.

4. **Save preserves the bridge invariant via CLI + temp file (OQ-3 as adjudicated).**
   - New CLI: `rasen pipeline save <name> --from <absolute-file> [--force] [--json]` — reads the file as JSON (definition) or YAML, validates through the full parse chain plus skill checks, refuses built-in names, installs into the USER pipelines layer (same root logic as import), `--force` to overwrite an existing user pipeline. Emits YAML canonically from the parsed definition.
   - New whitelist row `save-pipeline` (bounded-CLI tier).
   - Bridge: `op: 'save'` case in `pipeline-submit.ts` writes the posted definition to a server-owned scratch file in `os.tmpdir()` (random name, `fs.writeFileSync` then closed before spawn), passes its absolute path to the CLI, deletes it in `finally` with failure-tolerant deletion (leak-then-log, never fail the response — Windows EBUSY/antivirus history). This is the sole, scratch-only exception to "the server writes no library or workspace file".
   - Statuses: 201 created / 200 overwrote / 422 CLI error verbatim (including built-in refusal) / 409 while another pipeline subprocess is in flight (same cap-1 slot) / 400 malformed body before any spawn.

5. **Catalog is its own path, in-process, space-independent.** `GET /api/v1/pipeline-catalog` returns `{ roles, skills, runtimes, stageKinds, loopKinds, verifyPolicies, conditionLabels, gate: { default }, handoff: { fractionRange, remainingTokensGt } }`. Enums are sourced from the Zod schemas by name (`StageRoleSchema.options`, `AgentRuntimeSchema.options`, `VerifyPolicySchema.options`, `StageKindSchema.options`, loop-kind options) — never retyped literals, per the repo rule "use existing constants". Skills come from `resolvePipelineExecutionSkillSets` (id + description from the workflow catalog definitions) with an `enabled` boolean per skill so the palette can grey out disabled ones. `conditionLabels` is the conventional freeform set (`always`, `security-relevant`, `performance-sensitive`, `ui`, `non-ui`) offered as suggestions — the schema keeps `condition` freeform. Own path (not `/api/v1/pipelines/catalog`) so a pipeline legitimately named `catalog` is never shadowed — same reasoning as the workflows `validate` comment (management router.ts:112-121).

6. **Origin stamp: `origin` widens to `z.enum(['composed','ui'])`; the quality floor applies to BOTH.** Rationale: the floor's principle is "no machine-assisted assembly path produces an inspection-free pipeline" — the canvas is exactly such a path, and exempting it would make the UI the loophole around the autonomy-ladder rung-2 guarantee. The asymmetry with hand-written YAML is intentional and preserved: a user who wants an uninspected pipeline can still author YAML by hand (no origin field), which stays entirely unaffected. Enforcement is layered so the floor is a guide, not an ambush: the validation endpoint reports a floor violation on an `origin: 'ui'` draft as an ordinary error issue (editor shows it live), and save then hard-fails it via the parse chain only if the client skipped validation. `validateComposedPolicyFloor` becomes origin-presence-scoped (`if (!pipeline.origin) return`) with messages naming the actual origin value. The UI client (child 4) stamps `origin: 'ui'` on pipelines it assembles; the save CLI preserves whatever origin the definition carries and stamps nothing itself (hand-run `pipeline save` on an origin-free file stays origin-free).

7. **Wire types core-side only in this change.** All new shapes land in `management-api/wire-types.ts`. The `packages/ui/src/api/types.ts` mirror is intentionally NOT touched: mirror discipline says the mirror is updated by the change that first consumes a shape, and no UI code consumes these until children 3-4. Explicitly noted so reviewers don't flag the "missing" mirror.

## Risks / Trade-offs

- [R4 round-trip fidelity: definition type drifts from the loader's accepted schema] → definition type is `z.infer` of the loader schema itself, plus a round-trip test over every built-in pipeline and fixtures exercising optional fields (agents, handoff, reuse, loop variants, decompose).
- [Temp-file lifecycle on Windows: EBUSY/antivirus locks on delete] → file closed before spawn; deletion failure-tolerant (log-and-leak in tmpdir), never fails the response; test asserts response success even when deletion is forced to fail.
- [Issue-collecting validator diverges from the throwing parse chain] → the collector CALLS the same exported check functions (checks refactored to be individually invokable), not reimplementations; a test asserts parse-chain-rejects ⇔ collector-reports-at-least-one-error over shared fixtures.
- [Floor on `origin: 'ui'` frustrates users assembling trivial pipelines] → violation surfaces live in the editor via the validation endpoint before save; hand-authored YAML escape hatch documented in the requirement.
- [Route shadowing: a pipeline named `catalog` or `validation`] → both new GET paths are top-level (`pipeline-catalog`, `pipeline-validation`), never under `/api/v1/pipelines/`; a test registers a pipeline named `catalog` and asserts the detail endpoint serves it while the catalog endpoint still serves vocabulary.
- [Save bridging a large definition through argv] → definition travels via temp file, never argv; only name/flags/path are arguments, keeping the whitelist's single-token argument rule.

## Migration Plan

Additive endpoints + one additive op + one additive enum value; no persisted format changes (existing YAML without `origin` or with `origin: composed` parses byte-identically). Rollback = revert commit.

## Open Questions

(none — OQ-2/3/4/5 adjudicated in planning-context.md; origin/floor settled in Decision 6)
