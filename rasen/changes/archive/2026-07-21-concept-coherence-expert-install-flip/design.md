## Context

This is 6b, the capstone of decision #5 and the single riskiest behavioral change of the concept-coherence portfolio. 6a (shipped, review-clean) unified the 21 experts into the workflow catalog as `kind: 'expert'` units with digests, extended the delete/refcount guard to `requires.skills`, but deliberately **preserved install behavior**: `getSkillTemplates` still force-installs every expert via a branch that ignores the workflow filter (`skill-generation.ts:142-151`). This change replaces that branch with profile-default ∪ dependency-closure semantics.

Landed 6a interfaces this change builds on (verified against the tree):
- `getBuiltInCatalogDefinitions()` = built-in workflows + `getBuiltInExpertDefinitions()` (`registry.ts:73`); the catalog's `definitions` therefore contain experts, distinguished by `kind === 'expert'`.
- Built-in workflow `requires.skills` edges already exist (`builtins.ts`): `verify-enhanced-command` → `[rasen-review, rasen-cso, rasen-qa, rasen-design-review, rasen-qa-only]`; `auto-command` → `[rasen-review]`; `review-cycle` → `[rasen-review]`. `goal-command` has no expert skills. **`benchmark` is referenced by no workflow's `requires.skills`** (only by the `full-feature` pipeline's stage `skill:` field), so closure alone never pulls it — it must come from a profile default.
- The delete guard's dual-form skill resolution (`workflow-library.ts:490-507`) maps both `rasen:review` (`template.name`) and `rasen-review` (`dirName`) via `portablePathCollisionKey`, scanning `requires.skills` across all sources. This change reuses that exact mapping for install-time closure.
- Three "behavior-preservation" filters 6a added are the flip sites, to be reversed: `skill-generation.ts` (expert branch), `profile-editor.ts:145` (picker `kind !== 'expert'` filter), and the five `source === 'built-in' && kind !== 'expert'` filters in `profile-sync-drift.ts` (`:122,146,166,209,222`).

Hard constraints:
- `test/locales/catalog.test.ts:46` pins `profile.prompt.workflows` **exactly 1:1** with `ALL_WORKFLOWS`. `ALL_WORKFLOWS = BUILT_IN_WORKFLOW_IDS` is the workflow-id space and is also the `BuiltInWorkflowId` type; experts are a disjoint id/skill space by construction. This change does NOT add experts to `ALL_WORKFLOWS`.
- Golden fixture `builtins-v1.json` and the expert template parity hashes must NOT move (this change edits resolution/wiring, not templates or the catalog projection). If either moves, an edit leaked where it should not.
- `resolveWorkflowSelection` (`selection.ts:15`) follows only `requires.workflows`. `resolveWorkflowSelection` is reused by profile normalization/export (`named-profiles.ts`), so widening it unconditionally would inject expert ids into serialized profile snapshots.

## Goals / Non-Goals

**Goals:**
- Replace unconditional expert install with **profile-default expert set ∪ closure of selected workflows' `requires.skills`**.
- Make experts genuinely profile-selectable: picker toggles, named-profile membership, drift/removal all honor an expert desired-set.
- **Strictly non-regressive migration**: every existing install keeps all 21 experts until the user explicitly re-selects experts through the flipped picker.
- Protect quality-floor / referenced experts from removal via the profile default and the 6a refcount guard.
- Land M2 (memoize `getBuiltInExpertDefinitions`) and T1 (de-dup expert-name Set) opportunistically.

**Non-Goals:**
- No change to `ALL_WORKFLOWS`, the workflow golden fixture, or expert template bodies/parity hashes.
- No expert `.rasenpkg` export (6a kept experts non-exportable; unchanged here).
- No new signing/trust machinery; no schema-slot changes.
- Not re-opening 6a's sidecar/digest model.

## Decisions

### D1. Storage model — experts are ids in the profile's workflow selection (unified, no new selection array)

Expert ids live in the same `config.workflows` / named-profile `workflows` array as workflow ids (M1's observation: `validateProfileMembership` via `catalog.has` already accepts them). Rationale: the catalog is unified, so a single selection list is the least surprising representation and needs no parallel config dimension threaded through init/update/drift/named-profiles. Alternative rejected — a separate `config.experts: string[]` field — doubles the migration surface and the drift/removal bookkeeping for no expressive gain.

**Consequence for locale:** the picker draws expert metadata from a NEW `profile.prompt.experts` table (keyed by expert id), guarded 1:1 by a new catalog-test assertion mirroring the workflow guard. `ALL_WORKFLOWS` and `profile.prompt.workflows` stay workflow-only, so `catalog.test.ts:46` is untouched. Experts remain a disjoint id space (durable-finding #4 "five same-name-different-things" is preserved).

### D2. Profile expert defaults

`getProfileWorkflows(profile, customWorkflows, options)` returns workflow ids AND profile-default expert ids:

| profile | workflow ids | expert ids (when selection is explicit) |
|---|---|---|
| `full` | `ALL_WORKFLOWS` | all 21 (`ALL_EXPERTS`) |
| `core` | `CORE_WORKFLOWS` | quality floor: `review, cso, qa, qa-only, benchmark, design-review` |
| `custom` | `config.workflows` (verbatim) | the expert ids present in `config.workflows` |

Two new constants in `profiles.ts` derived from `getExpertSkillDefinitions()`: `ALL_EXPERTS` (all 21 ids) and `QUALITY_FLOOR_EXPERTS` (the six). `QUALITY_FLOOR_EXPERTS` is asserted a subset of `ALL_EXPERTS` by a test. The floor is exactly the six review/analysis experts the built-in pipelines dispatch (`full-feature` fans out to all six; `benchmark` is floor-only-by-profile since no `requires.skills` names it).

### D3. Install set = profile default ∪ dependency closure (the flip)

Add an **opt-in** closure to `resolveWorkflowSelection`: a second signature/option `resolveWorkflowSelection(catalog, roots, { includeSkillDependencies: true })` that, after resolving the `requires.workflows` closure, walks each selected definition's `requires.skills`, maps each (dual-form, via `portablePathCollisionKey`) to a catalog unit id, and includes those units. Opt-in so profile normalization/export keep workflow-only semantics (D1 consequence: snapshots stay lean); only the install/remove/drift desired-set computation passes the flag.

`getSkillTemplates`'s expert branch (`skill-generation.ts:142`) changes from "all `kind === 'expert'`" to: the experts present in the resolved (closure-included) selection. Because the desired-set is computed once with `includeSkillDependencies` and threaded to install AND removal (init.ts / update.ts already pass one `desiredWorkflows` string[] to both), install and removal never disagree.

Concretely the single desired-set resolver (used by init `:131` and update `:131`) becomes:
```
base   = getProfileWorkflows(profile, config.workflows, { expertSelectionExplicit })
known  = filterKnownWorkflowRoots(catalog, base).known
desired = resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(id)
```
`desired` now contains workflow ids + profile-default expert ids + closure-pulled expert ids. `getSkillTemplates(desired)` installs exactly that set; `removeUnselectedSkillDirs(skillsDir, desired)` (extended per D5) removes only built-in units — workflow OR expert — absent from it.

### D4. Non-regressive migration — the `expertSelectionExplicit` marker

The crux. Before this change every install has all 21 experts on disk (always-installed). The flip must not silently delete any on the next `update`.

Add a machine-managed boolean `expertSelectionExplicit?: boolean` to `GlobalConfig` (absent = legacy, like `telemetry.noticeSeen`). It gates ONLY the expert dimension:

- **`expertSelectionExplicit !== true` (legacy or never-customized):** the resolved expert set is `ALL_EXPERTS ∪ closure`, **profile-independent**. So an existing `full`, `core`, or `custom` install resolves to all 21 experts → `removeUnselected*` removes none → strictly non-regressive.
- **`expertSelectionExplicit === true`:** D2's profile defaults ∪ closure govern.

The marker flips to `true` only when the user **explicitly writes expert-aware profile settings post-flip**: `applyProfileState` (interactive picker), `profile use`, `profile new`/`import`, and fresh `init`. At that moment the picker's expert checkboxes (D6) are authoritative and narrowing takes effect. `update` never sets the marker — it only reads config and applies it — so a project that is merely re-`update`d keeps all experts forever, which is correct.

A one-time notice fires the first time an install resolves under the legacy branch during `update` (guarded so it prints once per project session, mirroring the delivery-consolidation notice), explaining experts are now selectable via `rasen profile`.

**Review-round Blocker fix — the marker alone is not enough to gate PRUNING.** `expertSelectionExplicit` lives in `GlobalConfig`, a single machine-wide file shared by every project. All four write paths above can flip it from an action against a completely different project than the one about to `update` — most sharply, a plain fresh `init` on an unrelated new project B, which touches no picker and makes no expert-aware choice at all. A reviewed reproduction confirmed this: project A (an existing `core` install, marker absent, all 21 experts on disk) loses 15 experts on its very next `update`, solely because someone ran `rasen init` in an unrelated project B in between. This violates the non-regression goal above ("every existing install keeps all 21 experts until *the user* explicitly re-selects experts") for any multi-project machine.

Fix: expert-dir **pruning** (not the marker) is additionally gated by a per-project acknowledgment file, machine-local to that project's own home directory (`resolveProjectHome`'s `homeDir`; see `expert-selection-state.ts`). The effective flag `update` resolves with is `expertSelectionExplicit = globalMarkerExplicit && projectAcknowledged`, not the global marker alone:
- A project without its own acknowledgment file always resolves the legacy (`ALL_EXPERTS`, profile-independent) branch on `update`, regardless of the global marker's state — it can never lose an installed expert as a side effect of another project's action.
- The *first* `update` on a project after the global marker is observed `true` for that project stays on the legacy branch for that one run (printing the existing migration notice) and writes that project's own acknowledgment file — so the *next* `update` on that same project is the one that applies profile-default narrowing. This mirrors the migration notice's existing "surface it before it takes effect" shape rather than adding new machinery.
- Fresh (non-extend) `init` writes its own project's acknowledgment immediately after establishing its machine home: a brand-new project has nothing pre-existing to lose, so there is no reason to make it wait a run.
- Extend-mode `init` never prunes (it only adds skill templates, never removes them), so it needs no gate — this per-project gate is scoped to `update`'s `removeUnselectedSkillDirs`/`removeUnselectedCommandFiles` seam, the only place a built-in expert is ever deleted.

Matrix row 15 (below) is the permanent regression test for the reproduced cross-project sequence.

Why a marker over alternatives:
- **Heuristic sentinel ("no expert id in `config.workflows`")** is ambiguous: a post-flip `profile use core` writes `CORE_WORKFLOWS + QUALITY_FLOOR_EXPERTS` (has expert ids) but a post-flip user who deselects every expert writes zero — indistinguishable from legacy. An explicit marker has no such blind spot.
- **Rewriting `core`→`custom` on config read** (to bake in experts) is more invasive (mutates the profile label on a plain read, complicates the `persistMigrations: false` locale-probe path) for no benefit over gating just the expert dimension.
- **Disk-scan adoption in `update`** measures installed experts per-project and writes global config — wrong grain (global write from a per-project command; ambiguous when projects differ).

Honest limitation (documented, not a bug): a legacy `core`/`custom` install keeps all 21 experts until the user opens the picker once; only then does it become lean. This is the deliberate safe direction — never silently delete — and reconciles the settled 6b sketch ("full unchanged; core/custom governed by profile+closure") with the lead's stricter "existing installs keep all 21 experts" by deferring governance to the first explicit re-selection.

### D5. Removal seam extends to experts

`removeUnselectedSkillDirs` (`update.ts:450`) currently iterates `getBuiltInWorkflowDefinitions()` — workflow-only — so it never touches expert dirs today. Extend it to iterate `getBuiltInCatalogDefinitions()` (workflows + experts) and remove any built-in unit whose id is not in `desiredWorkflows`. Because `desiredWorkflows` (D3) already includes every profile-default and closure-required expert, and under the legacy marker includes all 21, a required/legacy expert is never removed. Experts have no command, so `removeUnselectedCommandFiles` needs no expert branch (its `definition.command` check already skips them), but it should iterate the catalog for symmetry without behavioral change. The 6a refcount guard remains the backstop for `workflow delete`.

### D6. Picker exposes experts; named-profile validation admits them (M1 resolved)

- `profile-editor.ts` `workflowChoices`: drop the `kind !== 'expert'` filter (`:145`); render workflows and experts as two labeled groups (workflows first, then experts), experts drawing name/description from `messages.experts[id]`. `checked` from `currentState.workflows.includes(id)`; a closure-required expert (e.g. `review` while `auto-command` is checked) is rendered `disabled` with a "required by" note, reusing the existing `requiredBy` mechanism extended to `requires.skills`.
- `deriveProfileFromWorkflowSelection`: compares the selected set against `full` (`ALL_WORKFLOWS + ALL_EXPERTS`) and `core` (`CORE + QUALITY_FLOOR_EXPERTS`); anything else is `custom`.
- `applyProfileState`: persists the selection AND sets `expertSelectionExplicit = true`.
- **M1**: `validateProfileMembership` (`named-profiles.ts:47`) already accepts expert ids via `catalog.has`; this change makes that intentional and adds an explicit test that an expert id is a valid profile member and that an unknown id still fails. `normalizeProfileDefinition` uses workflow-only `resolveWorkflowSelection` (no `includeSkillDependencies`) so a saved snapshot lists exactly what the user chose (experts included if chosen), not the auto-pulled closure.

### D7. Drift desired-set includes experts

`profile-sync-drift.ts`: the five `kind !== 'expert'` filters gate "which built-in units count as installable/deselectable." Under the flip, experts ARE installable/deselectable, so those filters become `source === 'built-in'` (drop the `kind !== 'expert'` clause). Drift is then computed against the same closure-included `desiredWorkflows` the install path uses, so an expert present on disk but absent from the desired set reads as drift (to be removed), and a desired expert missing on disk reads as drift (to be installed) — symmetric with workflows. The desired-set passed to drift must be the D3 closure-included set (callers already pass `desiredWorkflows`).

### D8. M2 + T1

- **M2**: memoize `getBuiltInExpertDefinitions()` — it re-hashes 21 sidecar trees on every `loadWorkflowCatalog`. Cache the computed `WorkflowDefinition[]` in a module-level `let` (the sidecar tree is packaged, immutable at runtime; same lifetime assumption as the static template getters). Keep `getExpertSkillDefinitions`/`getExpertSkillNames` as the pure static derivations 6a intentionally left un-memoized (they avoid hashing).
- **T1**: `resolvePipelineExecutionSkillSets` builds the expert-name Set with a redundant insert; collapse to a single pass. Harmless today, free to simplify while in the file.

## Install-set matrix (the enumerated contract — every scenario, before/after)

Legend: WF = resolved workflow set; `+all21` = all 21 experts; `+floor` = the six quality-floor experts; `+closure` = experts pulled by selected workflows' `requires.skills`. Closure(X) = ∅ unless X selects `auto-command`/`review-cycle` (⇒`review`) or `verify-enhanced-command` (⇒`review,cso,qa,qa-only,design-review`).

| # | Scenario | marker | Before (6a) install-set | After (6b) install-set | Regression? |
|---|---|---|---|---|---|
| 1 | Existing `full` install, `update` | absent | WF(full)+all21 | WF(full)+all21 (legacy ⇒ all21) | none |
| 2 | Existing `core` install, `update` | absent | WF(core)+all21 | WF(core)+all21 (legacy ⇒ all21) | none — **key non-regression** |
| 3 | Existing `custom` (no expert ids), `update` | absent | WF(custom)+all21 | WF(custom)+all21 (legacy ⇒ all21) | none — **key non-regression** |
| 4 | Fresh `init`, default `full` | set by init | — | WF(full)+all21 | n/a |
| 5 | Fresh `init` / `profile use core` | set | — | WF(core)+floor+closure(core)=WF(core)+floor | n/a (lean by design) |
| 6 | Post-flip picker: `core`, user unchecks `benchmark` | set | — | WF(core)+{review,cso,qa,qa-only,design-review}; benchmark removed | intended |
| 7 | Post-flip picker: `custom`=`[auto-command]`, no experts checked | set | — | `[auto-command]`+closure=`{review}` | intended — closure floor |
| 8 | Post-flip picker: `custom`=`[auto-command]`, user unchecks `review` | set | — | still `{review}` (closure re-adds; picker renders it disabled/required) | intended — closure wins |
| 9 | Post-flip picker: `full`, user unchecks `tdd` (non-floor, unreferenced) | set | — | WF(full)+all21−{tdd}; tdd removed | intended |
| 10 | `update` after #9 in another project | set | — | same as #9 (marker persists globally) | intended |
| 11 | `verify-enhanced-command` selected, lean profile | set | — | closure pulls `review,cso,qa,qa-only,design-review` | intended |
| 12 | `workflow delete rasen-review` while `review-cycle` selected | any | refused (6a guard) | refused (6a guard, unchanged) | none |
| 13 | Named profile file listing `qa-only` explicitly | set | validate accepts (M1 lazy) | validate accepts (M1 explicit) + installs `qa-only` (+`qa` sidecar source materialized) | intended |
| 14 | Legacy install, first `update` | absent→still absent | all21 | all21 + one-time "experts now selectable" notice | none |
| 15 | Project A legacy (no ack), project B fresh `init` flips the global marker, then A's first `update` | global: absent→true; A's own ack: absent | — | A's first post-flip `update`: still all21 (A's own ack absent overrides the global marker) + notice; A's own ack now written; A's *second* `update`: narrows per A's profile | none on the run that would have been silent (review-round Blocker fix) |

Rows 1-3 and 14 are the migration guarantee; rows 5-11 are the flipped semantics; row 12 is the 6a guard interplay; row 13 is the `qa-only`→`qa` alias under selection; row 15 is the review-round cross-project fix (permanent regression test in `expert-install-flip.test.ts`).

## Risks / Trade-offs

- **Silent expert deletion on migration** → Mitigated by D4's marker: legacy configs resolve to all 21 regardless of profile; only an explicit post-flip re-selection narrows. Rows 1-3 are the direct tests.
- **Silent expert deletion across UNRELATED projects on the same machine** (review-round Blocker) → the marker alone is machine-wide and can flip from an action against a different project entirely. Mitigated by gating `update`'s pruning on a per-project acknowledgment file in addition to the marker (D4's "Review-round Blocker fix" subsection); row 15 is the direct test.
- **Pipeline preflight silently permitting a not-installed expert** (review-round Major) → `resolvePipelineExecutionSkillSets` (`execution-validation.ts`) previously unioned every expert name into `enabledSkillNames` unconditionally, so a pipeline stage naming a lean-profile-excluded expert passed preflight and only failed later, at dispatch, with a raw error instead of the clean `pipeline_skill_disabled` message. Fixed by reusing `resolveDesiredWorkflowSelection` (the same resolver `init`/`update` use) so `enabledSkillNames` reflects the actually-resolved install set for the expert dimension too; legacy machines (marker absent) still see every expert enabled, matching install behavior.
- **Preflight false-positive during the Blocker fix's one-run delay window** (review-round 2 Major) → the first Major fix read the raw global `expertSelectionExplicit` marker, not the per-project acknowledgment gate the Blocker fix added to `update.ts`. Reproduced consequence: project A (legacy, an expert genuinely on disk, no acknowledgment of its own) gets a false `pipeline_skill_disabled` at preflight the moment an unrelated project B's fresh `init` flips the global marker — even though A's own `update` would still keep that expert. Fixed by threading `projectRoot` into `resolvePipelineExecutionSkillSets`/`validatePipelineForExecution` (both now `async`) and gating exactly like `update.ts`: effective explicit = `globalMarkerExplicit && hasExpertSelectionAck(homeDir for projectRoot)`. Falls back to the raw global marker when `projectRoot` is omitted or unresolvable (matching `update.ts`'s own best-effort fallback).
- **Closure omits `benchmark`** (no `requires.skills` names it) → Mitigated by making `benchmark` a profile default in the quality floor, not a closure dependency. Test row 5 asserts `core` installs benchmark.
- **Widening `resolveWorkflowSelection` leaks experts into serialized snapshots** → Mitigated by making the `requires.skills` closure opt-in; normalization/export omit the flag (D6).
- **Locale 1:1 drift** → the new `profile.prompt.experts` table gets its own catalog-test guard; `ALL_WORKFLOWS`/`profile.prompt.workflows` are untouched, so `catalog.test.ts:46` cannot break.
- **Picker "required by" for `requires.skills`** must map skill-name→id (dual form) or a required expert renders enabled and can be unchecked → reuse `portablePathCollisionKey` mapping; test row 8.
- **Golden fixture / parity-hash movement** would signal a leak into templates or catalog projection → assert they are byte-identical after this change (no regeneration).
- **stale-id at resolution** (retired `ff` in stored config) — resolution already pre-filters via `filterKnownWorkflowRoots` at init/update boundaries; the expert closure runs on already-known roots, so no new stale-id path opens.
- **Test isolation** (durable finding): tests calling resolution must set `RASEN_HOME` (not delete it) to avoid reading the real `~/.rasen`.

## Migration Plan

1. Land D2/D3/D4 resolution + the marker; `full` installs are byte-identical (row 1), so the default population is unaffected on day one.
2. `update` on legacy `core`/`custom` installs keeps all 21 and prints the one-time notice (rows 2-3, 14).
3. A user opting into lean experts runs `rasen profile`, toggles experts, saves (marker set), and `update` prunes unreferenced deselected experts (rows 6-9).
4. Rollback: reverting the change restores unconditional install; because no config was destructively rewritten (only the additive `expertSelectionExplicit` marker was set, harmlessly ignored by old code), a downgrade re-installs all experts with no data loss.

## Open Questions

None blocking. The reconciliation between the settled 6b sketch and the lead's stricter "keep all 21" directive is resolved conservatively in D4 (defer governance to first explicit re-selection). If the team later wants existing `core` installs to go lean automatically, that is a follow-up that flips the marker default — deliberately out of scope here to hold the non-regression line.
