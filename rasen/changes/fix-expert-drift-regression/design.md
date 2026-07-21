## Context

Split-out from `fix-management-api-windows`, where `command-file-id.test.ts`'s drift assertion was diagnosed as NOT Windows-specific. Follow-up investigation settled the decisive question — **is this a test-contract change or a live product bug?** — by auditing every production caller of the drift API and reproducing the failure through the real code path.

### Caller audit (the decisive question)

Two production entry points reach the shared detector:

| Caller | Argument passed | Closure-resolved? | Correct? |
|---|---|---|---|
| `update.ts:218` `getToolsNeedingProfileSync(...)` | `desiredWorkflows` from `resolveDesiredWorkflowSelection(...)` (`update.ts:155`) | **Yes** (closure via `resolveWorkflowSelection(..., includeSkillDependencies:true)`, `profiles.ts:121`) | Correct |
| `profile-editor.ts:299` `hasProjectConfigDrift(projectDir, state.workflows, ...)` | `state.workflows` from `resolveCurrentProfileState` → `getProfileWorkflows` (`profile-editor.ts:57-61`) | **No** — `getProfileWorkflows` returns the base profile set; closure is a *separate* later step in `resolveDesiredWorkflowSelection` | **Buggy** |

So at least one real caller passes a raw (un-expanded) list, exactly as the failing test does. Verdict: **live product bug**, not a test-only contract change.

### Reproduction (production path, this machine)

A probe drove `resolveCurrentProfileState(getGlobalConfig()) → hasProjectConfigDrift(state.workflows, ...)` after a real `InitCommand` install:

- `custom` profile, pipeline workflows selected, experts unlisted → `state.workflows` = 20 ids; `resolveDesiredWorkflowSelection` = 24 ids; the 4-off delta is exactly `["cso","design-review","qa","qa-only","review"]`, which init installed on disk. `hasProjectConfigDrift(state.workflows)` = **true** (spurious); `hasProjectConfigDrift(closure ids)` = **false** (correct).
- `core` = 13 vs 13, no extras, drift **false**. `full` = 43 vs 43, drift **false**. Named profiles already carry their full expert set, so they never diverge — which is why the bug hid (defaults look fine; only `custom` selections bite).

### Why the two spec facts require the fix at the detector

Spec `profiles` states BOTH:
- a stored profile "SHALL NOT be auto-expanded with closure-pulled experts" (line ~273) — the stored/desired set is intentionally un-expanded;
- "Installed experts SHALL be governed by the resolved profile plus dependency closure" (line ~355) — disk presence IS closure-governed.

The detector sits between these two facts and must reconcile them by expanding the closure itself. It currently does not (`profile-sync-drift.ts:110` only does `toKnownWorkflows`, a catalog-membership filter, no closure), so the deselection loop (`:129-136`, and the command variants `:153-171`) flags closure-required experts as deselected.

## Goals / Non-Goals

**Goals:**
- Eliminate the false-positive drift for `custom` profiles, at the detector boundary, so all callers are correct regardless of whether they pre-resolve the closure.
- Re-green `command-file-id.test.ts` and add a regression test for the custom-profile no-drift case.

**Non-Goals:**
- Changing what config stores (stays un-expanded, per spec), install/removal semantics, or `rasen update`'s output.
- Touching the profile picker UI or the drift-warning copy.

## Decisions

### D1 — Fix at the detector (foolproof), not at the caller

**Chosen:** expand `desiredWorkflows` to its skill-dependency closure inside `hasToolProfileOrDeliveryDrift`, before building `desiredWorkflowSet` and running the deselection checks. Use the same primitive the install/removal seam uses — `resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true })` (`src/core/workflow-registry/selection.ts:35`) — so drift, install, and removal agree by construction.

- **Idempotence:** re-closing an already-closed set (update.ts's input) is a no-op (dependencies already present), so the correct caller is unaffected.
- **Alternative — fix only `profile-editor.ts:299`** (resolve closure like update.ts): rejected as primary. It leaves the API a footgun; the raw-list mistake has already occurred twice (profile editor + the test). Internal resolution is the durable fix. (If reviewers prefer minimal surface, the caller-fix is a viable fallback, but then the JSDoc MUST state the closure precondition and the test must resolve closure itself.)
- **Alternative — expand at removal/install only, leave detection raw:** rejected; detection is the surface that's wrong.

**Implementation checkpoints for apply:**
- Normalize the desired ids to workflow roots the way `resolveDesiredWorkflowSelection` does (`filterKnownWorkflowRoots` then `resolveWorkflowSelection`) — the desired list may carry `-command`-suffixed ids (`ship-command`, `auto-command`); ensure the closure primitive receives what it expects and that the resulting id set is compared against `definition.id` consistently in the deselection loops.
- Apply the closure expansion once, reused by both the skill deselection loop (`:129-136`) and the command deselection/legacy loops (`:153-171`). The forward-required checks (`:120-126`, `:143-151`) already iterate the desired set; expanding it there additionally requires the closure experts' skills to exist — which they do post-install — so they stay green.
- Guard against catalog edge cases (unknown ids already filtered by `toKnownWorkflows`).

### D2 — Add a small assertive contract note (JSDoc)

Document on `hasToolProfileOrDeliveryDrift` that `desiredWorkflows` is treated as a *selection to be closed over* (callers may pass either the raw or the closure-resolved set; the function resolves internally). This kills the ambiguity that produced the bug.

### D3 — Test changes

- `command-file-id.test.ts:159` becomes correct-by-construction (the raw list it passes is closure-expanded internally) — assertion unchanged, just re-greens.
- New regression: a `custom` profile with pipeline workflows and unlisted experts, installed, then `hasProjectConfigDrift(resolveCurrentProfileState(config).workflows, delivery)` === `false`. This asserts the production path (`profile-editor.ts:299`) specifically, which the existing test does not cover.

## Risks / Trade-offs

- **Closure expansion could mask a genuine deselection** → No: a closure-required expert cannot be validly deselected while its dependent workflow is selected; the removal seam (`update.ts` `removeUnselectedSkillDirs`) uses the very same closure, so drift agreeing with removal is the correct invariant. A truly orphaned expert (not in the profile AND not closure-required) still surfaces as drift.
- **Root vs `-command`-suffix id normalization** → the main implementation hazard; call out in tasks and verify the deselection loops compare like-for-like ids after expansion.
- **Performance** → `resolveWorkflowSelection` is already invoked per install/update; running it once per drift check is negligible.

## Open Questions

- Should `getInstalledWorkflowsForTool` / `hasProjectConfigDrift`'s trailing "installed not in desired" loop (`profile-sync-drift.ts:262-271`) also use the closure set? It compares installed workflows against `toKnownWorkflows(desiredWorkflows)`; for consistency it should use the same expanded set. Fold into the same fix and cover with the regression test.
