## 1. Widen the requires slot

- [x] 1.1 Extend `WorkflowDependencySet` to `{ workflows, skills, pipelines, schemas }` in `src/core/workflow-registry/types.ts`
- [x] 1.2 Add `pipelines` and `schemas` (`PortableStringArraySchema`, default `[]`) to `WorkflowManifestSchema.requires` in `src/core/workflow-registry/manifest.ts`
- [x] 1.3 Confirm neither `digestBuiltIn` (builtins.ts) nor `computeWorkflowDigest` (digest.ts) references `requires` — no digest churn expected

## 2. Populate built-in dependency edges (from design.md audit)

- [x] 2.1 Add an optional `requires` to `BuiltInWorkflowAdapter` and thread it into `getBuiltInWorkflowDefinitions` (default all-empty)
- [x] 2.2 `review-cycle`: requires.skills = [rasen-review]
- [x] 2.3 `verify-enhanced-command`: requires.skills = [rasen-review, rasen-cso, rasen-qa, rasen-design-review, rasen-qa-only]
- [x] 2.4 `auto-command`: requires.skills = [rasen-review]; requires.pipelines = [small-feature, full-feature, bug-fix, auto-decompose]
- [x] 2.5 `goal-command`: requires.pipelines = [goal-loop-measure, goal-loop-evaluate, goal-loop-research]
- [x] 2.6 All other built-ins keep empty requires (including empty requires.workflows and requires.schemas)

## 3. Validate the new slots

- [x] 3.1 Extend the user-workflow validator (`validator.ts`) with portability + presence diagnostics for `requires.pipelines` (resolve via `listPipelines`/`resolvePipelinePath`) and `requires.schemas` (resolve via `listSchemas`)
- [x] 3.2 Add presence-validation for `requires.skills` against the installed/expert skill set
- [x] 3.3 Keep the existing `requires.workflows` transitive closure in `resolveWorkflowSelection` unchanged; do NOT add skills/pipelines/schemas to the selection set
- [x] 3.4 Add a unit test asserting every built-in `requires.skills`/`requires.pipelines` entry resolves to a real skill/pipeline (guards the audit against rot)

## 4. workflow delete --force

- [x] 4.1 Add a `--force` flag to `workflow delete` in `src/commands/workflow-library.ts`
- [x] 4.2 Thread `force` into `deleteWorkflow` (`src/core/workflow-library.ts`): when set, skip the `workflow_in_use` throw but still refuse built-in deletion
- [x] 4.3 Emit a warning naming every dangling referrer on forced delete; surface `forcedReferrers` in `--json`
- [x] 4.4 Keep `-y/--yes` confirmation required in non-interactive mode
- [x] 4.5 Add the forced-delete warning string to `workflow-messages.ts` + `en.json` + `ja.json` (lockstep)
- [x] 4.6 Register the `--force` flag in `src/core/completions/command-registry.ts` + its locale flag-description keys (completion snapshot test fires otherwise)

## 5. Tests

- [x] 5.1 Update `test/core/workflow-registry/validator.test.ts` and `test/core/workflow-package/codec.test.ts` expected definitions to include the two new empty requires slots
- [x] 5.2 Confirm `test/fixtures/workflow-registry/builtins-v1.json` and `skill-templates-parity.test.ts` require NO change (requires excluded from digests/projection); run to verify
- [x] 5.3 Coverage: built-in requires match the audit; every entry resolves
- [x] 5.4 Coverage: manifest declaring `requires.pipelines`/`requires.schemas` — valid resolves, missing referent fails
- [x] 5.5 Coverage: `delete` refused when referenced; `--force --yes` deletes + warns + reports referrers; `--force` never deletes a built-in
- [x] 5.6 Run `pnpm test` in the worktree and confirm green (isolate Windows CLI-spawn flake per project convention)

## 6. Validate

- [x] 6.1 Run `rasen validate concept-coherence-dependency-graph --strict` and resolve findings
