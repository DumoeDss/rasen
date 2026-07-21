## 1. Remove ff from the registry

- [x] 1.1 Remove `'ff'` from `BUILT_IN_WORKFLOW_IDS` in `src/core/workflow-registry/builtins.ts`
- [x] 1.2 Remove the `{ id: 'ff', dirName: 'rasen-ff-change', ... }` entry from `BUILT_IN_ADAPTERS`
- [x] 1.3 Remove the `getFfChangeSkillTemplate` and `getOpsxFfCommandTemplate` imports from `builtins.ts`
- [x] 1.4 Confirm `CORE_WORKFLOW_IDS` is unaffected (ff was never a member)

## 2. Delete the dead template module

- [x] 2.1 Delete `src/core/templates/workflows/ff-change.ts`
- [x] 2.2 Remove the ff re-export line from the barrel `src/core/templates/skill-templates.ts`
- [x] 2.3 Remove `'rasen-ff-change'` from `SKILL_NAMES` in `src/core/shared/tool-detection.ts`
- [x] 2.4 Grep the src tree to confirm no remaining imports of the deleted exports

## 3. Tolerate stale ids in stored profile selections

- [x] 3.1 Add a shared helper (e.g. `filterKnownWorkflowRoots(catalog, roots)`) returning known + unknown ids, mirroring the existing `catalog.has` filter in `src/core/shared/skill-generation.ts`
- [x] 3.2 Apply it at the stored-selection consumption site in `src/core/update.ts` (before `resolveWorkflowSelection`), warning on dropped ids
- [x] 3.3 Apply it at the stored-selection consumption sites in `src/core/init.ts` (both call sites), warning on dropped ids
- [x] 3.4 Leave `resolveWorkflowSelection` strict and named-profile `.yaml` validation strict (explicit authoring keeps immediate errors)

## 4. Drift-heal already-installed ff artifacts

- [x] 4.1 Add retired-identifier constants (e.g. `RETIRED_WORKFLOW_SKILL_DIRS = ['rasen-ff-change']`, `RETIRED_WORKFLOW_COMMAND_IDS = ['ff']`) in `src/core/legacy-cleanup.ts`
- [x] 4.2 Add an exact-name skill-dir prune function mirroring `pruneRetiredExpertSkillDirs` (idempotent, scoped, no-op when absent)
- [x] 4.3 Add a retired command-file prune that resolves paths via the tool command adapter for each retired command id
- [x] 4.4 Wire both prunes into `src/core/update.ts` alongside the existing expert-prune loop, before the up-to-date short-circuit, for every configured tool
- [x] 4.5 Wire the same prunes into `src/core/init.ts`

## 5. Templates, docs, and specs sweep

- [x] 5.1 Remove `/rasen:ff` references from the command-reference tables in `src/core/templates/workflows/onboard.ts` and `src/core/templates/workflows/help.ts`
- [x] 5.2 Sweep `docs/` (commands, workflows, opsx, getting-started, concepts, examples, faq, how-commands-work, reviewing-changes, opsx-workflow-guide, troubleshooting, migration-guide, supported-tools) to remove `ff`/`rasen-ff-change` references
- [x] 5.3 Sweep `docs/zh/` for the mirror references, keeping locale parity with `docs/`
- [x] 5.4 Reword `rasen/specs/propose-workflow/spec.md` requirement to drop the `ff` reference (per delta REMOVED + ADDED)
- [x] 5.5 Remove `/rasen:ff` from the command reference in `rasen/specs/opsx-onboard-skill/spec.md` (per delta MODIFIED)
- [x] 5.6 Leave `expert-dialogue-override` "fast-forward" references and CHANGELOG history untouched

## 6. Tests

- [x] 6.1 Remove the `ff` entry from `test/fixtures/workflow-registry/builtins-v1.json`
- [x] 6.2 Update `test/core/templates/skill-templates-parity.test.ts` (remove ff imports, digests, dir-map entry, and parity tuple)
- [x] 6.3 Update `test/core/shared/tool-detection.test.ts` and `test/core/shared/skill-generation.test.ts` to drop `rasen-ff-change` assertions
- [x] 6.4 Update `test/core/update.test.ts` and `test/core/init.test.ts` non-core skill-name lists as needed
- [x] 6.5 Add coverage: stored `custom` profile containing `'ff'` warns, drops the id, and the run succeeds (update + init)
- [x] 6.6 Add coverage: installed `rasen-ff-change` dir and `ff` command file are removed on update; prune is a no-op when absent
- [x] 6.7 Run `pnpm test` in the worktree and confirm green (isolate any Windows CLI-spawn flake per project convention)

## 7. Validate

- [x] 7.1 Run `rasen validate concept-coherence-remove-ff` and resolve any findings
