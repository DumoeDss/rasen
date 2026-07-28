## Why

Rasen's built-in workflows have real dependencies — `review-cycle` delegates every pass to the `rasen-review` engine, `auto` drives the `small-feature`/`full-feature`/`bug-fix`/`auto-decompose` pipelines, `goal` drives the three `goal-loop-*` pipelines, `verify-enhanced` invokes five expert reviewers. But `WorkflowDefinition.requires` ships empty for every built-in, so those edges live implicitly in pipeline YAML `skill:` fields and in skill-body prose. The consequence is the "experts are always installed, no questions asked" axiom (`skill-generation.ts:140`): a cheap stand-in for a dependency graph that does not exist.

Portfolio decision #3 replaces that axiom with an explicit graph. This change does the foundational half: audit the edges, widen the `requires` slot to carry all four edge kinds, populate the built-ins, and validate the new slots — while leaving expert installation behavior untouched (the quality-floor flip is child 6). Reading the current code shows two enablers already exist — the `requires.workflows` transitive closure (`selection.ts`) and the delete refcount guard (`deleteWorkflow`/`scanWorkflowUsage`) — so this change is smaller than its framing: slot extension, audited data, presence-validation, and a `--force` escape hatch on delete.

## What Changes

### 1. Widen `requires` to four slots

Extend `WorkflowDependencySet` from `{ workflows, skills }` to `{ workflows, skills, pipelines, schemas }` on `WorkflowDefinition`, in the `workflow.yaml` manifest schema, and in the validator. `schemas` is existence-only this round (a reserved slot so a later change can express the implicit pipeline→schema edge without a package-format break). All slots stay outside both digest preimages, so there is no digest, golden-fixture, or parity-SHA churn.

### 2. Populate the built-in dependency edges (from the audit)

Add a per-adapter `requires` to the built-in table, populated from the audited edge inventory (see design.md):
- `review-cycle` requires skill `rasen-review`.
- `verify-enhanced-command` requires skills `rasen-review`, `rasen-cso`, `rasen-qa`, `rasen-design-review`, `rasen-qa-only`.
- `auto-command` requires skill `rasen-review` and pipelines `small-feature`, `full-feature`, `bug-fix`, `auto-decompose`.
- `goal-command` requires pipelines `goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`.
- All other built-ins keep empty `requires`. `requires.workflows` stays empty (propose→apply→ship sequencing is pipeline-expressed, not a workflow-to-workflow hard edge).

### 3. Validate the new slots; keep the existing closure

- `requires.workflows`: unchanged — `resolveWorkflowSelection` already resolves it transitively and co-installs, composing with profiles/`workflowFilter`.
- `requires.skills` / `requires.pipelines` / `requires.schemas`: validate presence (skill in the installed/expert set; pipeline resolvable via `listPipelines`; schema resolvable via `listSchemas`). No co-install of pipelines/schemas this round — they are data, and pipeline packaging is child 5. A built-in-edge unit test asserts every populated built-in `requires` entry resolves, so the audit cannot silently rot.

### 4. `workflow delete --force`

The delete refcount guard already refuses to delete a workflow that is still referenced (by another workflow's `requires.workflows`, a pipeline stage `skill:`, a profile/global selection, or the ledger) and names the referrers. Add a `--force` flag that bypasses only that referrer guard — the built-in-delete prohibition stays hard — printing a loud warning naming every now-dangling referrer, still requiring `-y/--yes` in non-interactive mode, and surfacing the forced referrers in `--json`.

### 5. Document the quality-floor completion (design direction, no behavior change)

Experts remain always-installed this round. design.md records how child 6 uses the dependency data landed here to replace unconditional expert installation with "install the depended-upon union + default profile, protected by the refcount guard." No expert installation code changes in this change.

## Capabilities

### Modified Capabilities

- `workflow-library`: `requires` carries four slots; built-in dependency edges are populated; the new slots are presence-validated; `workflow delete` gains a `--force` override for its refcount guard.

## Impact

- `src/core/workflow-registry/types.ts` — widen `WorkflowDependencySet`
- `src/core/workflow-registry/builtins.ts` — per-adapter `requires` + populated edges (outside digest)
- `src/core/workflow-registry/manifest.ts` — `pipelines`/`schemas` in `requires` schema
- `src/core/workflow-registry/validator.ts` — portability + existence validation for the new slots
- `src/core/workflow-registry/selection.ts` — presence-validation of new slots (workflows closure unchanged)
- `src/commands/workflow-library.ts` — `--force` on `delete` (guard/scan already exist in `src/core/workflow-library.ts`)
- `src/commands/workflow-messages.ts` + `src/locales/en.json` + `src/locales/ja.json` — forced-delete warning strings (lockstep)
- `src/core/completions/command-registry.ts` + locale flag-description keys — the new `--force` flag (completion snapshot fires otherwise)
- Tests: `validator.test.ts` + `workflow-package/codec.test.ts` (requires shape gains two slots), new built-in-edge resolution test, delete `--force` coverage, manifest new-slot validation coverage
- Constraints: no version bump; `requires` stays out of digests (zero fixture/parity churn — verified by the kind sibling); locale catalogs and the completion registry must stay in lockstep.
