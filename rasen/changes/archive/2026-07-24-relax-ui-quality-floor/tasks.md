## 1. Core Quality-Floor Scope

- [x] 1.1 Narrow `validateComposedPolicyFloor` so only `origin: composed` activates the reviewer plus review-cycle requirement, while leaving every other structural check in the parse and draft-validation chains unchanged.
- [x] 1.2 Update the `origin` schema description and nearby validation comments to distinguish provenance (`ui`) from the composed-only hard quality policy.
- [x] 1.3 Revise core pipeline-registry tests into an explicit matrix proving floor-free `composed` definitions fail, floor-free `ui` and origin-free definitions pass, composed missing-reviewer and missing-loop failures remain distinct, and unsupported origin values still fail schema validation.

## 2. Draft Validation Boundary

- [x] 2.1 Add management-API regression coverage showing `POST /api/v1/pipeline-validation` returns `valid: true` for an otherwise valid floor-free `origin: ui` draft and `valid: false` for the equivalent floor-free `origin: composed` draft.
- [x] 2.2 Confirm existing Canvas tests still prove validation/save requests retain `origin: ui`; do not change Canvas behavior unless a failing regression demonstrates a separate defect.
- [x] 2.3 Update the `pipelines-ui` validation-and-save requirement so floor-free `origin: ui` drafts are not blocked for those omissions alone while all ordinary error-severity issues still block saving.

## 3. Verification

- [x] 3.1 Run strict change validation for `relax-ui-quality-floor` and resolve any proposal/design/spec/task coherence errors.
- [x] 3.2 Run the focused pipeline-registry and management-API pipeline-validation test files, then run the Canvas draft/page tests that cover origin stamping.
- [x] 3.3 Run the repository typecheck and the broader pipeline-related test suite, recording any pre-existing or unrelated failures separately.
