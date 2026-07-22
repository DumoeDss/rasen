## Why

With the command delivery surface retired (child 1), skill bodies no longer have a live command copy — but they still carry hardcoded downstream steering (e.g. apply's "steer to `/rasen:verify` → `/rasen:ship`"). That steering is a second source of truth for the workflow chain and, worse, points at workflows a lean profile never installed (core has no verify/ship). The fix (Phase B of `rasen/office-hours/skills-only-delivery-runtime-next-steps.md`) is to make the CLI the single runtime source of "what comes next": a small static chain table, filtered by the actually-installed workflow set, surfaced through `rasen instructions`/`rasen status`. Skill bodies (Phase C, child 3) then just transcribe whatever the CLI emits.

## What Changes

- **New chain table module** (`src/core/workflow-chain.ts`): pure data mapping each canonical workflow id to its next step(s) with a trigger condition, covering the interactive main line `propose → (new/continue) → apply → verify → ship → archive` plus the `explore`, `office-hours`, and `sync` side branches. Ids are the real registry ids (`ship-command`, `office-hours-command`, `verify`, `auto-command`, …), so filtering against the installed set works.
- **`resolveNextSteps(workflowId, state, installedWorkflows)`**: pure resolver returning the canonical next step(s), filtered to the installed set, **skipping ahead along the main line to the nearest installed node** when a direct successor is not installed (core profile with no verify/ship → apply's all_done step resolves to `archive`).
- **`rasen instructions` (apply) and `rasen status` `--json`** gain a `nextWorkflows: [{ workflow, reason }]` array. (Named `nextWorkflows`, not the doc's `nextSteps`, because `ChangeStatus.nextSteps: string[]` — artifact-authoring guidance — already exists; see design D1.)
- **Human-readable stdout** gains a trailing `Next: <workflow> — <one line>` hint on the apply and status text surfaces, `-command` suffix stripped for display, store/project flag threaded per existing hint conventions.
- **Installed-set source is the profile/config selection** (`resolveDesiredWorkflowSelection`), never the workflow artifact ledger (ledger is user-authored-only and would report every built-in as uninstalled). This is a review Blocker if violated.
- **i18n**: nextWorkflows `reason` strings and the `Next:` hint sentence in `en`/`ja`/`zh-cn`.
- **Folded-in residual Phase-A spec cleanup** (spec-only, per LEAD direction — child 1's delivery-retirement deltas missed these): remove the now-false `Update respects delivery setting` requirement from `cli-update` and drop the retired `delivery` field from the `profiles` named-profile requirements. Broader incidental `delivery`-word residue is logged as a backlog rather than scrubbed here.

## Capabilities

### New Capabilities
- `workflow-next-steps`: the chain table, the `resolveNextSteps` skip-ahead resolver, the installed-set source rule, and the i18n contract for the emitted reasons.

### Modified Capabilities
- `cli-artifact-workflow`: `rasen status --json` and `rasen instructions <apply> --json` gain a `nextWorkflows` field; the text surfaces gain a `Next:` hint line.
- `cli-update`: residual Phase-A cleanup — the retired `Update respects delivery setting` requirement is REMOVED.
- `profiles`: residual Phase-A cleanup — the retired `delivery` field is removed from the named-profile management, storage/validation, and import/export requirements.

## Impact

- **New:** `src/core/workflow-chain.ts` (+ its unit tests).
- **Modified:** `src/commands/workflow/instructions.ts` (apply-instructions surface), `src/commands/workflow/status.ts`, and/or `src/core/artifact-graph/instruction-loader.ts` (`ApplyInstructions`/`ChangeStatus` shape). New reads of `getGlobalConfig()` + `loadWorkflowCatalog()` + `resolveDesiredWorkflowSelection(...)` on these surfaces to compute the installed set.
- **Locales:** `src/locales/en.json`, `ja.json`, `zh-cn.json`.
- **Tests:** new chain-module tests; instructions/status tests extended for `nextWorkflows` across the full / core-subset / single-workflow install matrix and blocked/all_done branches.
- **No version bump.** No change to pipeline registry, LEAD orchestration, or skill template bodies (Phase C).
