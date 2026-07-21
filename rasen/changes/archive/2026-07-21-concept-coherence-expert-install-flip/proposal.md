## Why

Since 6a unified the 21 built-in experts into the workflow catalog, they still install unconditionally: every project gets all 21 expert skills regardless of the selected profile (`skill-generation.ts` force-installs the whole `kind: 'expert'` subset). This is the last remnant of the retired "quality-floor is a hard-wired always-install" axiom that the concept-coherence portfolio replaced with an explicit dependency graph. Experts should be profile-governed like every other unit — selectable, closure-protected, and refcount-guarded — so a `core` install is genuinely lean and a `custom` install carries exactly what it declares plus what its workflows require. This is the single riskiest behavioral change of the portfolio, so it ships isolated with an exhaustive install-set matrix and a strictly non-regressive migration.

## What Changes

- **Experts become profile-selectable.** A profile's workflow selection may name expert ids; the interactive picker exposes experts as toggles alongside workflows; named-profile validation accepts expert ids as valid members.
- **Installation flips from "all experts, always" to "profile-default ∪ dependency closure."** The resolved install set is: the experts named by the resolved profile, PLUS the closure of every selected workflow's `requires.skills` (so `auto-command`/`review-cycle`/`verify-enhanced-command` still pull their review experts even when a lean profile omits them).
- **Built-in profile expert sets:** `full` = all built-in workflows + all 21 experts (existing default is unchanged). `core` = CORE workflows + the six quality-floor experts (`review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`). `custom` = exactly the ids in `config.workflows` plus dependency closure.
- **Update removes a deselected expert only when nothing references it.** The `removeUnselected*` seam extends to experts not in the resolved desired set; the delete/refcount guard (landed in 6a) keeps a referenced expert from being pruned.
- **BREAKING (install-set): a `core` or `custom` project no longer receives every expert.** Guarded by a strictly non-regressive one-time migration — see below.
- **Non-regressive migration.** Existing installs keep all 21 experts. A machine-managed `expertSelectionExplicit` marker distinguishes configs written before expert-selectability (adopt all experts, profile-independent) from configs a user has since re-selected through the flipped picker (profile-default ∪ closure governs). A one-time notice explains the shift.
- **M2 (perf):** `getBuiltInExpertDefinitions` memoizes so a catalog load no longer re-hashes 21 sidecar trees on every call.
- **T1 (cosmetic):** de-duplicate the expert-name Set build in `resolvePipelineExecutionSkillSets`.

## Capabilities

### New Capabilities
<!-- none — this change modifies existing contracts -->

### Modified Capabilities
- `workflow-library`: expert installation flips from unconditional to profile-default ∪ dependency-closure; the `requires.skills` closure becomes an install-time resolution step; the deselection/removal seam extends to experts, protected by the refcount guard.
- `profiles`: `full`/`core`/`custom` gain defined expert sets; the interactive picker and named-profile validation admit expert ids; a one-time non-regressive expert-selection migration preserves existing installs.
- `cli-update`: `update` removes a deselected expert only when unreferenced, and performs the one-time expert-selection migration with a single notice.

## Impact

- **Code:** `src/core/shared/skill-generation.ts` (flip the always-install branch), `src/core/workflow-registry/selection.ts` (opt-in `requires.skills` closure), `src/core/profiles.ts` (expert sets + marker-aware resolution), `src/core/global-config.ts` (`expertSelectionExplicit` marker), `src/commands/profile-editor.ts` (expose experts in the picker), `src/core/profile-sync-drift.ts` (desired-set includes experts), `src/core/update.ts` (`removeUnselected*` reaches experts; migration notice), `src/core/named-profiles.ts` (validation/normalization admit experts), `src/core/workflow-registry/experts.ts` (M2 memoization), `src/core/pipeline-registry/execution-validation.ts` (T1).
- **Locale:** a new expert picker-metadata table in `src/locales/en.json`/`ja.json`, guarded 1:1 by a catalog test (mirrors the existing `profile.prompt.workflows` guard); `ALL_WORKFLOWS` and its 1:1 workflow table are left unchanged (experts stay a disjoint id space).
- **Tests:** exhaustive install-set matrix (per profile × marker state × closure), migration non-regression, picker exposure, drift, delete-guard interplay; golden fixture and expert template parity hashes do NOT move (this change edits resolution/wiring, not templates or catalog projection).
- **Version:** none — `package.json` untouched; all behavior is version-independent.
