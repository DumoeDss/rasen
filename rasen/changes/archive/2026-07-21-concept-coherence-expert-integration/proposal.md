## Why

Rasen keeps two parallel skill catalogs: built-in workflows (`builtins.ts`, registry units with id/kind/digest/requires) and the 21 experts (`experts.ts`, a simpler `{ id, dirName, template, sidecarSourceId? }` table with no digest, outside the catalog). Experts are installed unconditionally — `skill-generation.ts:140` adds every expert "regardless of workflowFilter" — the cheap stand-in the whole portfolio has been replacing. Now that the dependency graph exists (child 4) and `kind` exists (child 2), experts can become first-class registry units: `kind: 'expert'`, real digests, collision/list/delete parity, and — ultimately — installation driven by profile defaults + dependency closure instead of an always-install axiom.

This is the capstone of decision #5. Because it spans a mechanical catalog unification and the single riskiest behavioral change in the portfolio (flipping always-install to profile+closure), it is split: **this change delivers the behavior-preserving unification (6a)**; the **install-semantics flip is recommended as the final sibling (6b)**, with its design fully settled here so its planner has a complete spec. Splitting lets the unification land verifiably behavior-neutral, and isolates the install flip for focused review.

## What Changes

### 1. Experts become registry units with `kind: 'expert'`

Add `'expert'` to `WorkflowKind` (child 2 left the union open). Migrate the 21 experts into the unified catalog: `loadWorkflowCatalog` composes built-in workflows + built-in experts + user workflows. Each expert becomes a `WorkflowDefinition` with `source: 'built-in'`, `kind: 'expert'`, `command: undefined`, and its `sidecarSourceId` preserved (the `qa-only` → `qa` alias must survive).

### 2. Experts get digests (they have none today)

Define an expert digest preimage covering the template plus the sidecar directory tree (each sidecar file's path + sha256), so drift-healing can detect changed expert content. This is a new preimage distinct from `digestBuiltIn` (which covers skill+command) and `computeWorkflowDigest` (which covers inline `files[]`).

### 3. Sidecar model: hybrid (directory-copy + digest coverage), experts non-exportable this round

Keep the existing directory-copy materialization (`copySkillSidecars` reading `skills/experts/<sidecarSourceId ?? id>/`) rather than inlining sidecars into `files[]` — inlining would bloat packages and complicate the `qa-only`→`qa` alias. Built-in experts carry an empty `files[]` (their content is directory-backed) but a digest computed over template + sidecar tree. Experts are declared **non-exportable** via `.rasenpkg` this round (so the empty `files[]` never needs package serialization); community-authored experts are a future concern. See design.md D1 for the full tradeoff.

### 4. List shows an expert group (visible by default)

`workflow list` gains an `expert` group, shown by default (experts are user-facing review/analysis tools, unlike `internal` sub-units). `--json` continues to expose everything with `kind`.

### 5. Collapse the two catalogs; migrate every caller

`getExpertSkillDefinitions` callers migrate to the unified catalog: `registry.ts` collision map (already `kind: 'workflow'|'expert'`), `execution-validation.ts` (expert skill sets), `transaction.ts` (installable-set assertions), and `skill-generation.ts`. `sidecarSourceId` survives on the expert definitions. **Install behavior is preserved in 6a**: generation still force-installs all experts (sourced from the catalog's `kind: 'expert'` subset) — the always-install branch stays until 6b flips it.

### 6. Delete guard protects depended-upon skills

Extend child 4's referrer scan (`createWorkflowUsageContext`) to also scan installed workflows' `requires.skills`, so an expert referenced by a workflow's `requires.skills` (e.g. `rasen-review` via `review-cycle`) or by a pipeline stage `skill:` refuses deletion. Built-in experts are non-deletable regardless (same as built-in workflows).

### 7. Golden fixture churns (intended — unlike prior siblings)

The built-in catalog projection gains 21 expert rows (`commandId: null`, `kind: 'expert'`), so `test/fixtures/workflow-registry/builtins-v1.json` and its test are regenerated to include them. This is intended, spec'd churn — the first sibling where the golden fixture legitimately moves. The expert template parity hashes (`skill-templates-parity.test.ts`) do NOT move (this change edits registry wiring, not template bodies).

## Capabilities

### Modified Capabilities

- `workflow-library`: experts are first-class catalog units with `kind: 'expert'`, digests, and list/collision/delete parity; the delete guard protects skills referenced by `requires.skills`.

## Impact

- `src/core/workflow-registry/types.ts` — `'expert'` in `WorkflowKind`; expert-carrying definition fields (sidecarSourceId)
- `src/core/workflow-registry/experts.ts` — emit `WorkflowDefinition`s with kind/digest/sidecarSourceId
- `src/core/workflow-registry/builtins.ts` / `catalog.ts` / `index.ts` — unify the catalog composition; new expert digest preimage
- `src/core/shared/skill-generation.ts` — source experts from the catalog (install behavior unchanged in 6a)
- `src/core/pipeline-registry/execution-validation.ts`, `src/core/workflow-package/transaction.ts`, `src/core/workflow-registry/registry.ts` — migrate expert callers
- `src/core/workflow-library.ts` — extend the referrer scan to `requires.skills`
- `src/commands/workflow-library.ts` — expert list group
- Tests: regenerate `builtins-v1.json` (+21 rows); `builtins.test.ts`, `workflow-author-review.test.ts`; new expert-digest + delete-guard-over-requires.skills coverage
- Constraints: no version bump; install behavior preserved (flip is 6b); expert template parity hashes unchanged; dependency identifiers from 5a/5b are concurrent — re-verify.
