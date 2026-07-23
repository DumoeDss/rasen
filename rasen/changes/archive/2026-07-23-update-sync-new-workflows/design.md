## Context

`rasen update` installs the workflows resolved by `resolveProjectWorkflowSelection` (`src/core/profiles.ts`). That resolver branches:

- **`full` / `core` profile** → `getProfileWorkflows` returns the *live* `ALL_WORKFLOWS` / `CORE_WORKFLOWS`. A built-in workflow added in a later release is picked up automatically on the next `update`. No defect here.
- **`custom` profile** → `getProfileWorkflows('custom', config.workflows)` returns the stored `config.workflows` array *verbatim* (plus expert closure). The array is a frozen snapshot written when the user last chose; a workflow added to the catalog afterward is never in it.
- **project `override`** → same freeze: the project's own `workflows` list resolves verbatim plus closure.

So for `custom` and `override` selections, a newly-added built-in workflow (the reported `audit` / `rasen-audit`) never enters `desiredWorkflows`, `getSkillTemplates(desiredWorkflows)` never emits it, and its skill directory is never written. This is consistent with the deliberate "keep custom profiles user-owned; do not mutate them" invariant (`update.ts` `displayOldCoreCustomProfileNote`, and the `profiles` spec "Custom profile contents": only what's in the array). The defect is not the freeze — it is that the freeze is **silent**: neither `update` nor the profile editor tells the user a new workflow exists.

**On the "editor shows `audit` checked" hypothesis (recon suspect 2):** the picker's checked state is `currentState.workflows.includes(id) || requiredBy.has(id)` (`profile-editor.ts:253`). `currentState` comes from `getProfileWorkflows`, which for a `custom` selection does not contain `audit`; `audit` (`builtins.ts:129`, no `requires`) is required by nothing. So the picker renders `audit` **unchecked** — the display is already faithful to the stored selection. The reported "everything checked, 38 custom" perception is explained by (i) the picker paginates (~7 rows; `DEFAULT_WORKFLOW_PICKER_PAGE_SIZE`), so the new `audit` row at the tail is off-screen, and (ii) on a legacy install where `expertSelectionExplicit` is not yet set, `getProfileWorkflows` force-checks `ALL_EXPERTS`, so most *visible* rows are checked. Two facts prove `audit` was not pre-checked: the user had to deselect-all + select-all to add it (a pre-checked row would be added by merely confirming), and if `currentState` contained `audit` the *same* resolver would have made `update` install it — contradicting the missing skill. The fix therefore affirms faithfulness with a regression test rather than changing the checked logic.

## Goals / Non-Goals

**Goals:**
- Make the upgrade path honest: after a release adds a built-in workflow, a `custom`/`override` user learns it exists on the next `update` and can add it.
- Keep the profile editor's checked state faithful to the stored selection, and make new/unselected built-in workflows discoverable there without scrolling.
- Reuse the single `resolveProjectWorkflowSelection` seam; do not add a parallel resolver or bypass install/removal/drift.

**Non-Goals:**
- Auto-adding new built-ins to a `custom` selection or a project override (violates the user-owned contract; `full`/`core` already auto-sync).
- Changing how `full`/`core` resolve.
- Any version bump or migration of the `workflows` array shape.

## Decisions

### D1 — Surface, do not auto-sync, for frozen selections
`rasen update` resolves `desiredWorkflows` as today, then computes the built-in *workflow* ids (catalog `kind !== 'expert'`, `source === 'built-in'`) that are absent from the resolved set and prints a note directing the user to `rasen profile`. The stored `config.workflows` / override list is never rewritten by `update`. Rationale: preserves the user-owned-custom invariant while closing the silent-drop gap. `full`/`core` selections already contain every built-in, so the note is naturally empty for them.

### D2 — Distinguish "new" from "deliberately deselected" via a known-workflows baseline (recommended)
A `custom` user who intentionally dropped a workflow must not be nagged every `update`. To tell a genuinely new workflow from a deliberate omission, persist the set of built-in workflow ids known when the selection was last saved: add `knownBuiltInWorkflows?: string[]` to global config, written by the same paths that persist a selection (`applyProfileState`, `init`, existing-user migration). On `update`, `newBuiltIns = catalogBuiltInWorkflowIds − knownBuiltInWorkflows`; surface `newBuiltIns − desiredSet`. Legacy configs without the field are seeded to the current catalog ids on first `update` (no flag, no notice), mirroring the non-regressive `expertSelectionExplicit` / project-ack pattern — nothing is surfaced until the *next* genuine addition. Project overrides, which have no per-selection save event, fall back to a lighter rule: surface catalog built-ins absent from the override only when they are not on disk for any configured tool (an override is authored deliberately, so treat its omissions conservatively — see OQ1).

**Alternative considered:** skip the baseline and unconditionally list every built-in absent from a `custom`/`override` selection. Simpler (no config field) but nags deliberate subsets on every `update`. Rejected as the default; offered as OQ1 in case the LEAD prefers minimal surface area.

### D3 — Profile editor discoverability line
Before rendering the checkbox, `runInteractiveProfileEditor` prints a one-line summary of built-in workflows available but not in the current selection (derived from `currentState.workflows` vs. the catalog, same primitives the picker already loads). In the editor the user is actively managing selection, so listing all unselected built-ins is expected context, not a nag — no baseline needed here. This directly answers the reported pain (the user could not tell from the picker what was missing).

### D4 — Affirm faithful checked state with a regression scenario
No change to the `checked` computation. Add a `profiles` spec scenario and a unit test asserting that a built-in workflow absent from the stored selection and required by nothing renders **unchecked** in the picker choices, locking the faithfulness the code already provides against future regression.

### D5 — Localization and cross-platform discipline
The new `update` note and editor line go through the existing message tables (`profile-messages.ts` / update diagnostics), localized like their neighbors; Rasen-owned text follows the resolved locale, user-authored workflow names stay untranslated. All path handling stays on `path.join`.

## Risks / Trade-offs

- [Baseline seeding hides the very first new workflow for legacy configs] → Acceptable and intentional: matches the codebase's established non-regressive migration stance (never surprise on the first post-upgrade run). The workflow is still installable via the editor's discoverability line (D3), which needs no baseline.
- [Note fatigue if surfacing is too eager] → D2's baseline + `full`/`core` exemption keep the `update` note quiet unless a genuinely new, unselected built-in exists.
- [New config field must round-trip safely] → `knownBuiltInWorkflows` is optional and additive; readers tolerate its absence (seed-on-read), so old and new binaries interoperate without rewriting unrelated config.
- [Override path lacks a save event for the baseline] → handled conservatively in D2/OQ1 rather than by inventing a per-project baseline store.

## Migration Plan

Additive, no data migration. Existing configs gain `knownBuiltInWorkflows` on the first selection save or first `update` (seeded silently). Rollback: removing the field and the note leaves resolution unchanged (`getProfileWorkflows` is untouched). No spec for `full`/`core` behavior changes.

## Open Questions

- **OQ1 (LEAD to adjudicate):** Recommended is the baseline-tracked `update` note (D2). If the LEAD prefers zero new config surface, fall back to unconditionally listing built-ins absent from a `custom`/override selection on `update`, accepting mild repetition for deliberate subsets. Which ships?
- **OQ2:** Should the `update` note additionally fire for `full`/`core` in the (impossible-by-construction today) case of a catalog built-in outside `ALL_WORKFLOWS`? Proposed: no — keep the note scoped to frozen selections; a built-in missing from `ALL_WORKFLOWS` is a catalog bug surfaced elsewhere.
