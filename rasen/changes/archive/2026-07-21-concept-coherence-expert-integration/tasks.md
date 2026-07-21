## 1. Kind and expert definition shape

- [x] 1.1 Add `'expert'` to `WorkflowKind` in `src/core/workflow-registry/types.ts`
- [x] 1.2 Ensure the `WorkflowDefinition` shape carries the expert sidecar alias (reuse/thread `sidecarSourceId`); keep `files: []` for built-in experts

## 2. Expert digest

- [x] 2.1 Add an expert digest preimage `{ format:'rasen-expert-digest', version:1, id, dirName, template, sidecars:[{path,sha256}] }`, hashing the sidecar tree resolved from `sidecarSourceId ?? id`
- [x] 2.2 Add a golden expert-digest test (deterministic; alias-sharing experts get distinct digests)

## 3. Emit experts as catalog units

- [x] 3.1 Update `src/core/workflow-registry/experts.ts` to emit `WorkflowDefinition`s (`source:'built-in'`, `kind:'expert'`, no command, digest, sidecarSourceId, empty files)
- [x] 3.2 Compose experts into `loadWorkflowCatalog` (built-in workflows + built-in experts + user workflows)
- [x] 3.3 Keep `getExpertSkillDefinitions`/`getExpertSkillNames` as catalog-backed filters to minimize caller churn

## 4. Migrate callers

- [x] 4.1 `registry.ts` collision map — read experts from the catalog (already tags kind workflow|expert)
- [x] 4.2 `execution-validation.ts` — expert skill sets from the catalog's kind:'expert' subset
- [x] 4.3 `transaction.ts` — installable-set assertions treat experts as catalog members
- [x] 4.4 `skill-generation.ts` — source experts from the catalog; KEEP the always-install branch (behavior preserved this round)
- [x] 4.5 Confirm sidecarSourceId still drives `copySkillSidecars` (qa-only → qa)

## 5. List and delete guard

- [x] 5.1 Add the `expert` group to `workflow list` (visible by default; internal still hidden without `--all`); add `kind` to expert list/JSON entries
- [x] 5.2 Extend `createWorkflowUsageContext` (`src/core/workflow-library.ts`) to scan installed workflows' `requires.skills` as referrers; keep built-in non-deletable

## 6. Golden fixture (intended churn)

- [x] 6.1 Regenerate `test/fixtures/workflow-registry/builtins-v1.json` to include the 21 expert rows (`commandId: null`, `kind: 'expert'`) in catalog order
- [x] 6.2 Update `test/core/workflow-registry/builtins.test.ts` and `test/core/templates/workflow-author-review.test.ts` for the unified catalog
- [x] 6.3 Confirm NO `skill-templates-parity.test.ts` hash moves (this change edits wiring, not template bodies) — if one moves, the edit leaked into a template

## 7. Tests

- [x] 7.1 Catalog contains 21 experts with kind expert, digest, preserved alias
- [x] 7.2 List shows expert group by default; JSON includes experts with kind
- [x] 7.3 Delete guard: expert referenced by requires.skills refused; built-in expert never deleted
- [x] 7.4 Install behavior unchanged: init/update still install all experts (regression guard for the preserved branch)
- [x] 7.5 Run `pnpm test` in the worktree and confirm green (isolate Windows CLI-spawn flake per project convention)

## 8. Validate

- [x] 8.1 Run `rasen validate concept-coherence-expert-integration --strict` and resolve findings
