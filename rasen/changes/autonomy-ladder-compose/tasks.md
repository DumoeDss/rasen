## 1. Pipeline schema: `origin` field and composed quality floor

- [x] 1.1 In `src/core/pipeline-registry/types.ts`, add an optional `origin` field to `PipelineYamlSchema` (single literal value `composed`) with a `.describe` documenting the marker; export the field on the `PipelineYaml` type
- [x] 1.2 In `src/core/pipeline-registry/pipeline.ts`, add `validateComposedPolicyFloor(pipeline)` alongside the existing structural validators and call it from `parsePipeline`: when `origin === 'composed'`, require at least one stage with `role: 'reviewer'` and at least one stage with `loop.kind === 'review-cycle'`, else throw `PipelineValidationError` naming the missing floor stage
- [x] 1.3 Add tests in the pipeline-registry test suite: `origin: composed` with both floor stages parses; missing reviewer-role stage fails; missing review-cycle loop fails; a pipeline WITHOUT `origin` and without floor stages still parses (bug-fix built-in shape unaffected); invalid `origin` value rejected by Zod
- [x] 1.4 In `src/commands/pipeline.ts` `show()`, include `origin` in the JSON result (present only when declared) and a provenance line in human output; extend the `show` test in `test/commands/pipeline.test.ts` with a composed project pipeline fixture

## 2. Selection policy axis: `compose` value and `--auto-compose` flag

- [x] 2.1 In `src/core/project-config.ts`, widen the `selection` Zod enum and `AutopilotSelectionPolicy` type to `'classify' | 'manual' | 'compose'`, update the warn-and-drop parse branch and its warning text to name all three values
- [x] 2.2 Extend `resolveAutopilotSelectionPolicy` to take both flags (compose ahead of select): `--auto-compose` -> `compose` (source `flag`), else `--auto-select` -> `classify` (source `flag`), else config, else `manual`/`default`; keep the single-resolver contract and update its doc comment
- [x] 2.3 In `test/core/project-config.test.ts`, add cases: `selection: compose` parses; both-flags precedence (`compose` wins); compose flag alone; config `compose` without flags; unrecognized value still warns and drops with siblings intact

## 3. Auto template: compose branch, composition flow, guardrails

- [x] 3.1 In `src/core/templates/workflows/auto.ts` step 0.6, add the third policy value and flag to the resolution text (`--auto-compose` -> `compose`, ahead of `--auto-select`; config `classify|manual|compose`), and add `[--auto-compose]` to the Input line in section 1
- [x] 3.2 In section 1's policy sub-list, add the `compose` bullet (no restructure): classify-first (keyword-basis adopted exactly as the `classify` bullet); on `default` basis judge fit — prefer any registered pipeline that fits; only on no-fit compose: draw stages from the registered stage vocabulary (`rasen pipeline show` on built-ins), name `composed-<slug>` collision-checked against `rasen pipeline list --json` (numeric suffix, never overwrite), stamp `origin: composed`, include the floor stages (role `reviewer` + `loop.kind: review-cycle`), write to the project pipelines directory, then gate on `rasen validate <name> --type pipeline --json`; one bounded fix attempt, else fall back to `small-feature`, display the cause, and remove the invalid directory; display the composition (name, stages with floor called out, validate verdict) at the existing user-changeable display point
- [x] 3.3 Add Guardrails entries: composition only under the `compose` policy on a `default`-basis no-fit; never execute an unregistered in-memory DAG — every executed pipeline must resolve via `rasen pipeline show <name>`; composed YAML always stamped `origin: composed` and always contains the verification + review-loop floor; never overwrite an existing pipeline name; explicit selection keeps `--auto-compose` inert
- [x] 3.4 In `test/commands/auto.test.ts`, assert the skill text contains `--auto-compose`, `origin: composed`, the `composed-` naming rule, the `rasen validate` gate, the floor rule, and the no-unregistered-DAG guardrail

## 4. Template regeneration and parity

- [x] 4.1 Run `node build.js` and regenerate templates via the build → update flow (in the isolated worktree, the parity test substitutes for the update half, per child 1's procedure)
- [x] 4.2 Update the pinned auto-template hash in `test/core/templates/skill-templates-parity.test.ts` (run the test, paste the Received value verbatim)

## 5. Validation

- [x] 5.1 Run `npx vitest run test/core/pipeline-registry test/commands/pipeline.test.ts test/commands/auto.test.ts test/core/project-config.test.ts test/core/templates/skill-templates-parity.test.ts` and confirm green
- [x] 5.2 Run `node bin/rasen.js validate autonomy-ladder-compose --strict` and confirm valid; smoke-check the floor: write a scratch project pipeline with `origin: composed` missing the review-cycle stage and confirm `rasen validate <name> --type pipeline` fails with the floor error, then with both floor stages confirm it passes and `pipeline show --json` surfaces `origin` (remove the scratch pipeline afterwards)
