# Planning Context

## User intent

The user reported that pipelines assembled in the Canvas are rejected unless
they explicitly contain both a `role: reviewer` stage and a
`loop.kind: review-cycle` stage. They asked to change the design so Canvas can
create legitimate lightweight, one-shot verification, research, and goal-loop
pipelines without being forced into a review/fix loop.

## Agreed direction

- Treat `origin` as provenance, not as an implicit safety-policy selector.
- Keep the hard quality floor for `origin: composed`, because unattended
  autopilot composition must not produce an inspection-free pipeline.
- Do not hard-fail `origin: ui` merely because it lacks a reviewer or
  review-cycle loop.
- Preserve validation of all schema, graph, decompose, and skill
  known/enabled rules.
- Prefer a targeted bug fix. Do not introduce a new persisted policy field or
  a Canvas policy toggle unless the existing contracts require one.
- Update product specs/design text and regression tests so the intended scope
  cannot drift back.

## Evidence already established

- `validateComposedPolicyFloor` currently runs for any truthy `origin`.
- The quality floor originated for `origin: composed` and was later widened to
  `origin: ui` under the rationale that Canvas was a machine-assisted assembly
  path.
- The shipped auto workflow explicitly supports `verifyPolicy: standard`
  without a review-cycle loop, and the built-in bug-fix pipeline may skip its
  deeper loop for simple fixes.
- Canvas stamps every validation/save draft with `origin: ui`.
- Canvas palette drops create stages with no `role` and no `loop`.

## Constraints

- Preserve unrelated dirty-worktree changes.
- Keep the diff minimal and use existing constants/schema values.
- Add regression coverage at the core validation seam and, where appropriate,
  the management API/Canvas seam.
- Run focused core and UI tests, then broader verification proportional to the
  change.

## Planner findings

- Both `parsePipeline` and `validatePipelineDraft` already call the same
  `validateComposedPolicyFloor` helper, so one explicit
  `origin !== 'composed'` guard keeps throwing and issue-collecting paths aligned.
- The server-boundary regression belongs in
  `test/core/management-api/pipelines-api.test.ts`; Canvas component tests mock
  validation results and therefore cannot prove the backend policy fix.
- No Canvas product-code change is required: it should continue stamping and
  saving `origin: ui` as provenance.
