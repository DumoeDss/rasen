## Why

The `ff` ("fast-forward") built-in workflow is a functional duplicate of `propose`. Both generate every change artifact in one shot; `ff` is the upstream OpenSpec heritage form (PR #448), while `propose` is the rasen-native entry point that fully covers the same behavior (and adds onboarding narration and office-hours input consumption). Keeping both dilutes the concept model the `concept-coherence` portfolio is establishing: two names for one internal-loop operation, one of which is not in the CORE profile and exists only for legacy parity.

Removing `ff` is the smallest, lowest-risk, dependency-free step in the portfolio (it must land first because sibling `concept-coherence-kind-taxonomy` also edits `builtins.ts`). This change deletes the workflow, tolerates machines and configs that still reference the retired id, cleans up already-installed artifacts, and sweeps the documentation — without touching any version string and remaining independently shippable and reviewable.

## What Changes

### 1. Remove the built-in `ff` workflow

- Drop `'ff'` from `BUILT_IN_WORKFLOW_IDS` and the `ff` adapter entry from `BUILT_IN_ADAPTERS` in `src/core/workflow-registry/builtins.ts`, along with the two now-unused template imports (`getFfChangeSkillTemplate`, `getOpsxFfCommandTemplate`).
- `ff` is not in `CORE_WORKFLOW_IDS`, so the core profile is unaffected.
- No deprecation stub is left behind: `propose` fully covers the capability.

### 2. Delete the now-unused template module and its re-export

- Delete `src/core/templates/workflows/ff-change.ts` (its only exports are the two ff templates).
- Remove the re-export line for those two functions from the barrel `src/core/templates/skill-templates.ts`.
- Remove `'rasen-ff-change'` from the `SKILL_NAMES` list in `src/core/shared/tool-detection.ts`.

### 3. Tolerate stale `ff` ids in stored profile selections (warn, not error)

Stored global-config `custom` profiles may still list `'ff'`. Today `resolveWorkflowSelection` throws `WorkflowSelectionError('unknown_workflow')`, and `rasen update` / `rasen init` call it directly on the stored selection — so after removal those commands would abort for such users. Change the stored-selection consumption paths (`src/core/update.ts`, `src/core/init.ts`) to drop unknown ids with a warning before resolving, mirroring the pre-existing tolerant convention in `src/core/shared/skill-generation.ts` (`roots.filter((w) => catalog.has(w))`). Explicitly authored artifacts that already validate strictly (named-profile `.yaml` files via `named-profiles.ts`) keep their strict, immediate-feedback behavior.

### 4. Drift-heal already-installed `ff` artifacts on init/update

The registry-derived `removeUnselectedSkillDirs` / `removeUnselectedCommandFiles` can only clean up ids that are still in the registry; once `ff` leaves, they never touch its installed `rasen-ff-change/` skill dir or `ff` command file. Follow the retired-artifact prune prior art (`pruneRetiredExpertSkillDirs` in `src/core/legacy-cleanup.ts`, wired into `update.ts` before the up-to-date short-circuit) by adding an exact-name prune for the retired `rasen-ff-change` skill directory and the retired `ff` command file, scoped so it can only touch those retired names, idempotent, and run on both `rasen init` and `rasen update`.

### 5. Documentation, help, and spec sweep

- Remove/adjust `ff` references in the onboard and help skill templates (`onboard.ts`, `help.ts` command-reference tables).
- Sweep `docs/` and `docs/zh/` (commands, workflows, opsx, getting-started, concepts, examples, faq, how-commands-work, reviewing-changes, opsx-workflow-guide, troubleshooting, migration-guide, supported-tools) to remove `ff`/`rasen-ff-change` mentions, keeping the two locales in parity.
- Update the two active specs that mandate `ff` as a capability: `propose-workflow` (reword the "combines new and ff" requirement to describe propose's own behavior) and `opsx-onboard-skill` (drop `/rasen:ff` from the command reference). The `expert-dialogue-override` "fast-forward" references are a different concept (dialogue escape hatch) and are left untouched.
- CHANGELOG history entries mentioning `ff` are historical record and are left as-is.

## Capabilities

### Modified Capabilities

- `workflow-library`: The built-in workflow set no longer includes `ff`; stored selections tolerate the retired id.
- `legacy-cleanup`: Retired built-in workflow artifacts (`rasen-ff-change` skill dir, `ff` command file) are pruned on init/update.
- `cli-update`: Stored profile selections containing a retired workflow id are tolerated (warn, not error) and the retired install is healed.
- `cli-init`: Stored profile selections containing a retired workflow id are tolerated (warn, not error).
- `propose-workflow`: The requirement describing propose no longer references `ff`.
- `opsx-onboard-skill`: The onboarding command reference no longer lists `/rasen:ff`.

## Impact

- `src/core/workflow-registry/builtins.ts` — remove id + adapter + imports
- `src/core/templates/workflows/ff-change.ts` — delete file
- `src/core/templates/skill-templates.ts` — remove re-export
- `src/core/shared/tool-detection.ts` — remove `rasen-ff-change` from `SKILL_NAMES`
- `src/core/legacy-cleanup.ts` + `src/core/update.ts` + `src/core/init.ts` — retired-artifact prune + stale-id tolerance
- `src/core/templates/workflows/onboard.ts`, `src/core/templates/workflows/help.ts` — command-reference tables
- `docs/**`, `docs/zh/**` — reference sweep (locale parity)
- `rasen/specs/propose-workflow/spec.md`, `rasen/specs/opsx-onboard-skill/spec.md` — spec updates
- Tests: `test/fixtures/workflow-registry/builtins-v1.json`, `test/core/workflow-registry/builtins.test.ts`, `test/core/templates/skill-templates-parity.test.ts`, `test/core/shared/tool-detection.test.ts`, `test/core/shared/skill-generation.test.ts`, `test/core/update.test.ts`, `test/core/init.test.ts`, plus new coverage for the retired-artifact prune and stale-id tolerance
- Constraint: no version strings touched; change is independently shippable and reviewable.
