## 1. Chain table module (B1)

- [x] 1.1 Create `src/core/workflow-chain.ts`: export `WORKFLOW_CHAIN` (each canonical id → ordered `{ when, to, reasonKey }[]`) and a `MAIN_LINE` order array `['propose','apply','verify','ship-command','archive']`. Use the real `BUILT_IN_WORKFLOW_IDS` values (`ship-command`, `office-hours-command`, `verify`, `auto-command`), not `ship`/`verify-change`.
- [x] 1.2 Encode conditions: `apply` → `{ when:'blocked', to:'continue' }`, `{ when:'all_done', to:'verify' }`; `propose` → `{ when:'artifacts-complete', to:'apply' }`; entry variants `new`/`continue` → `apply`; side branches `explore`→`propose`, `office-hours-command`→`propose`, `sync` standalone.
- [x] 1.3 Implement `resolveNextSteps(workflowId, state, installedWorkflows): { workflow, reason }[]`: match `when === state` targets; for each not in `installedWorkflows`, walk `MAIN_LINE` forward to the nearest installed node and substitute (reason notes the skip); drop when nothing downstream is installed; dedupe, preserve order.
- [x] 1.4 Unit test: every chain node id ∈ `BUILT_IN_WORKFLOW_IDS` (typo guard); `resolveNextSteps('apply','all_done', coreSet)` → `[archive]`; `('apply','all_done', fullSet)` → `[verify]`; `('apply','blocked',...)` → continuation; empty-tail → `[]`.

## 2. Installed-set helper (B2 — the review-Blocker constraint)

- [x] 2.1 Add a helper (e.g. `resolveInstalledWorkflowIds()`) that wraps `getGlobalConfig()` + `loadWorkflowCatalog()` + `resolveDesiredWorkflowSelection(catalog, profile, globalConfig.workflows, expertSelectionExplicit).ids`, mirroring `update.ts:140-181`. Return the resolved id array (workflow + expert ids; chain only matches workflow ids, so experts are inert).
- [x] 2.2 Test (regression guard): a `core` profile installed set includes `apply`/`archive`, excludes `verify`/`ship-command`; assert the source is the profile/config resolver and NOT `workflow-artifact-ledger` (ledger is `source==='user'`-only).

## 3. Apply-instructions surface (B2/B3)

- [x] 3.1 In `generateApplyInstructions` (`src/commands/workflow/instructions.ts`), compute `nextWorkflows = resolveNextSteps('apply', state, resolveInstalledWorkflowIds())` and add it to the returned `ApplyInstructions` (extend the type in `shared.ts`). Field name is `nextWorkflows` (NOT `nextSteps` — that string array is reserved on status).
- [x] 3.2 `--json`: `nextWorkflows` rides the existing `JSON.stringify({ ...instructions, root })`. Map `state`: `blocked`→continuation, `all_done`→forward chain, `ready`→`[]`.
- [x] 3.3 `printApplyInstructionsText`: append a trailing `Next: <workflow> — <reason>` line when `nextWorkflows` is non-empty; strip `-command` suffix for display; thread the active `--store`/`--project` flag onto any printed command. (No command is embedded in the hint text — see workflow-chain.ts's `formatNextWorkflowHint` doc comment — so the store/project-flag clause is vacuously satisfied; the workflow id itself already has `-command` stripped.)

## 4. Status surface (B2/B3)

- [x] 4.1 In `formatChangeStatus` (`src/core/artifact-graph/instruction-loader.ts`) or the status command, add `nextWorkflows = resolveNextSteps('propose', isComplete ? 'artifacts-complete' : 'artifacts-pending', installed)` to `ChangeStatus`. Leave the existing `nextSteps: string[]` untouched.
- [x] 4.2 `--json`: include `nextWorkflows`. `printStatusText`: append the `Next:` hint (same display rules as 3.3) when non-empty.

## 5. i18n (B4)

- [x] 5.1 Add the next-step `reason` strings and the `Next:` hint sentence to `src/locales/en.json`, `ja.json`, `zh-cn.json` under a shared key namespace with matching placeholders. Cover reasons for: continue-to-authoring, ready-to-apply, forward-to-verify, skip-ahead-to-archive (intervening not installed).

## 6. Tests (B5)

- [x] 6.1 Chain-module matrix (from task 1.4) — full install, core subset (no verify/ship), single-workflow install; blocked/ready/all_done and artifacts-pending/complete branches. (`test/core/workflow-chain.test.ts`, 16 tests, plus `resolveInstalledWorkflowIds` regression guard.)
- [x] 6.2 Extend the instructions/status command tests (`test/commands/artifact-workflow.test.ts`): assert `nextWorkflows` in `--json` for apply (all_done→core→archive; full→verify; blocked→continue) and status (complete→apply); assert the `Next:` hint text and `-command` stripping. (New `nextWorkflows` describe block, 8 tests.)
- [x] 6.3 Locale-parity test stays green (all three catalogs key-parallel). (`test/locales/catalog.test.ts` — 11/11 passing.)

## 7. Residual Phase-A spec cleanup (folded in per LEAD; spec-only)

- [x] 7.1 (Spec already written) Confirm the `cli-update` delta removes the retired `Update respects delivery setting` requirement and the `profiles` delta drops `delivery` from the named-profile management / storage / import-export requirements. No code change needed beyond what child 1 already shipped; if `named-profiles.ts` still emits a `delivery` field on export, drop it so the export matches the amended spec (delivery tolerated-but-ignored on read only). Verified: `named-profiles.ts`/`workflow-package/schema.ts` keep `delivery: z.unknown().optional()` for read-tolerance only; `codec.ts:138` types the write path as `Omit<PackagedProfile, 'delivery'>`, so it is never re-emitted. No code change needed.

## 8. Validate

- [x] 8.1 `node bin/rasen.js validate skills-only-cli-next-steps --strict` clean.
- [x] 8.2 Acceptance: `rasen instructions apply --json` carries `nextWorkflows`; under core profile a completed apply resolves to `archive`, never to an uninstalled `verify`/`ship`; `pnpm test` green (Windows EBUSY flake isolated-rerun per convention). Full suite: 3710 passed / 29 skipped / 3 failed — all 3 failures pre-exist on the tree at child 1's ship point (807e5431), confirmed via `git stash -u` + rerun before any Phase-B change existed: `test/commands/artifact-workflow.test.ts > creates skills for Codex tool` (stale command-file assertion, retired by child 1), `test/core/workflow-generation-integration.test.ts` (same cause), and the known `source-specs-normalization` archive-ui TBD placeholder (implementer-1's handoff already flagged this one). No regression introduced by this change.
