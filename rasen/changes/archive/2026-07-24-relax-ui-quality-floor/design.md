## Context

`PipelineYamlSchema` accepts `origin: composed | ui`, and both parsing (`parsePipeline`) and issue-collecting draft validation (`validatePipelineDraft`) call the same `validateComposedPolicyFloor` helper. That helper currently returns only when `origin` is absent, so `ui` is treated as a policy selector even though Canvas always stamps it as provenance. As a result, otherwise valid Canvas drafts fail before save unless they contain both a reviewer-role stage and a review-cycle loop.

The stricter floor remains appropriate for `origin: composed`: those definitions are assembled by unattended autopilot logic, and the auto workflow explicitly promises that every composition includes independent inspection. Canvas is an interactive authoring surface and must also support intentionally lightweight pipelines. Existing schema, graph, decompose, and skill checks remain authoritative for both sources.

## Goals / Non-Goals

**Goals:**

- Make `origin: ui` provenance-only and allow UI-authored pipelines without either quality-floor stage.
- Preserve the mandatory reviewer plus review-cycle floor for `origin: composed`.
- Keep parse-time and draft-validation behavior aligned through the shared validation helper.
- Lock the source distinction with focused core and management-API tests.

**Non-Goals:**

- Add a persisted quality-policy field, Canvas toggle, automatic stage insertion, or warning.
- Change the `origin` enum, remove the Canvas origin stamp, or alter save round-tripping.
- Relax duplicate-id, dependency, cycle, parallel-group, decompose, schema, or skill known/enabled checks.
- Change built-in pipeline or autopilot composition behavior.

## Decisions

### 1. Narrow the existing floor guard to the explicit `composed` value

`validateComposedPolicyFloor` will return unless `pipeline.origin === 'composed'`. The helper already centralizes enforcement for both the throwing parse chain and the issue collector, so this one predicate change keeps every entry point consistent. Its comments and the `origin` schema description will be updated to say that `ui` records Canvas provenance while only `composed` activates the hard floor.

Alternative considered: remove the floor from all origin-stamped definitions. Rejected because it would weaken the established unattended-composition guarantee.

Alternative considered: add `qualityPolicy: strict | standard | none`. Rejected because the reported bug does not require a new persisted contract or UI control, and introducing one would expand migration and compatibility surface.

### 2. Preserve `origin: ui` throughout the Canvas and save paths

Canvas will continue stamping definitions with `origin: ui`, and the save path will continue preserving that value. The fix changes only what the validator infers from the marker; it does not erase useful provenance or special-case the client.

Alternative considered: stop stamping Canvas definitions. Rejected because it would discard provenance and make the saved format misrepresent its source merely to bypass a validator rule.

### 3. Test the policy matrix at the shared core seam and the HTTP boundary

Core tests will prove:

- floor-free `origin: composed` definitions fail in both parse and issue-collector paths;
- floor-free `origin: ui` definitions pass both paths;
- origin-free definitions remain unchanged;
- composed definitions still fail independently for a missing reviewer and a missing review-cycle loop;
- unsupported origin values remain schema errors.

The management API test will post a floor-free `origin: ui` draft and expect `valid: true`, plus retain or add a composed counterexample that returns an error issue. Existing structural and skill-validation tests provide the regression guard for unrelated rules; no Canvas component change is needed because it already submits the stamped definition to this endpoint.

Alternative considered: test only the Canvas mock client. Rejected because mocked UI responses cannot prove the server-side rule that caused the bug.

## Risks / Trade-offs

- [A UI-authored pipeline can intentionally omit independent review] → This is the desired behavior for an interactive authoring surface; provenance remains visible, and users can still add reviewer and review-cycle stages.
- [A broad predicate change could accidentally exempt composed pipelines] → Keep explicit composed failure cases in both throwing and issue-collecting validation tests.
- [Parse and HTTP validation could drift] → Continue routing both through the same helper and test both boundaries.
- [Documentation may continue implying every origin activates the floor] → Update the schema description and all three affected capability specs with the same provenance-versus-policy distinction.

## Migration Plan

No file or schema migration is required. Existing `origin: ui` pipelines that already include the floor remain valid; previously rejected floor-free UI drafts become valid. `origin: composed` and origin-free definitions retain their existing outcomes. Rollback is the predicate and accompanying contract/test reversal.

## Open Questions

None.
