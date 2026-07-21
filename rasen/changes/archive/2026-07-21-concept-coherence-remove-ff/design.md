## Context

`ff` is a built-in workflow registered through `BUILT_IN_ADAPTERS` (`src/core/workflow-registry/builtins.ts:102`), backed by a dedicated template module (`src/core/templates/workflows/ff-change.ts`) whose only two exports are its skill and command templates. It is the fast-forward "generate all artifacts at once" flow inherited from upstream OpenSpec (PR #448); rasen's own `propose` workflow performs the same operation and is the canonical entry point. `ff` is deliberately outside `CORE_WORKFLOW_IDS`.

Removing a registered workflow is not just a registry edit: the id has three kinds of live footprint that must be reconciled — (1) stored selections in global config that reference it, (2) already-installed skill dirs and command files on user machines, and (3) documentation/spec text. This design fixes the two non-obvious runtime touchpoints (tolerance and drift-healing) and follows established prior art for both.

## Goals / Non-Goals

**Goals**
- Delete `ff` from the registry and remove its now-dead template module cleanly.
- Ensure `rasen update` / `rasen init` do not crash for users whose stored `custom` profile still lists `'ff'`.
- Ensure already-installed `rasen-ff-change` skill dirs and `ff` command files are removed on the next init/update.
- Keep docs (en + zh) and mandating specs coherent.

**Non-Goals**
- No `-command` suffix rename (out of scope for the whole portfolio).
- No deprecation stub or alias from `ff` → `propose` (propose fully covers it; a not-in-CORE legacy id does not warrant a shim).
- No change to named-profile `.yaml` validation strictness (explicit authoring keeps immediate-error feedback).
- No version-string changes.

## Decisions

### D1. Delete the template module rather than orphan it

`src/core/templates/workflows/ff-change.ts` exports only `getFfChangeSkillTemplate` and `getOpsxFfCommandTemplate`; nothing else imports it once the registry adapter and the barrel re-export are removed. Deleting the file (plus the one re-export line in `skill-templates.ts`) is cleaner than leaving dead code. This also removes the upstream-cherry-pick surface for the ff template — accepted, since the template was fully rewritten during rasen branding and would conflict regardless.

### D2. Stale-id tolerance = pre-filter with a warning at the stored-selection consumption sites

`resolveWorkflowSelection` throws `WorkflowSelectionError('unknown_workflow')` on any unknown id (`src/core/workflow-registry/selection.ts:25`). Two call sites feed it a *stored* (not freshly authored) selection derived from global config: `update.ts:118` and `init.ts:186` (and `:643`). After `ff` is removed, a user whose global config has `profile: custom` with `'ff'` still listed would see `rasen update`/`rasen init` abort.

The fix mirrors the tolerant convention that already exists at `src/core/shared/skill-generation.ts:128,160` — `roots.filter((w) => catalog.has(w))` — but adds a one-line warning naming the dropped id(s) so the drift is visible. This keeps `resolveWorkflowSelection` itself strict (a good invariant for internal callers) and localizes tolerance to the stored-config boundary where unknown ids are expected drift, not programmer error.

**Why not loosen `resolveWorkflowSelection`?** Other callers (e.g. named-profile validation) rely on its throw for immediate feedback on authored input. Tolerance belongs at the boundary that reads persisted, possibly-outdated config, not in the shared resolver.

**Naming:** introduce a small shared helper (e.g. `filterKnownWorkflowRoots(catalog, roots): { known, unknown }`) so the two call sites and their warning message stay consistent, rather than duplicating the `.filter(catalog.has)` idiom a third and fourth time.

### D3. Drift-healing = exact-name retired-artifact prune, following `pruneRetiredExpertSkillDirs`

The registry-derived cleanups (`removeUnselectedSkillDirs` at `update.ts:426`, `removeUnselectedCommandFiles` at `update.ts:489`) iterate `getBuiltInWorkflowDefinitions()`. Once `ff` is gone from that list they can never see it, so they cannot remove an already-installed `rasen-ff-change/` dir or `ff` command file. This is exactly the gap the expert-rebrand prune solved: `pruneRetiredExpertSkillDirs` (`legacy-cleanup.ts:31`) removes dirs by a hardcoded retired identifier, wired into `update.ts:172-176` *before* the up-to-date short-circuit so it heals even when nothing else needs updating.

Follow that pattern:
- Add a retired-workflow skill-dir prune in `legacy-cleanup.ts` keyed on the exact name `rasen-ff-change` (exact-match set, not a prefix, to stay maximally narrow). Idempotent; no-op when absent.
- Add a retired-workflow command-file prune. Command file paths are adapter-specific, so this prune resolves candidate paths via the tool's command adapter (the same `getCommandFilePathCandidates` / adapter mechanism `removeCommandFiles` uses) for the retired command id `ff`. It lives alongside the skill-dir prune loop in `update.ts` (which already has the configured-tool + adapter context) and is also invoked from `init.ts`.
- Both prunes run for every configured tool before the short-circuit, matching the expert-prune wiring, so a machine that only runs `rasen update` with nothing else stale still gets healed.

**Why exact-name, not a generalized retired-list yet?** Keep this change minimal and reviewable. A single retired dir/command is enough surface; a general "retired workflow registry" is a larger design that later portfolio siblings (which also retire ids) may motivate, but this change should not over-build it. Expose the retired identifiers as named constants (e.g. `RETIRED_WORKFLOW_SKILL_DIRS`, `RETIRED_WORKFLOW_COMMAND_IDS`) so a future sibling can append.

### D4. Spec deltas honor the REMOVED/rename guard

- `propose-workflow` currently has `### Requirement: Propose workflow combines new and ff`. Because propose's behavior is unchanged but the *requirement text and header reference to `ff` must go*, this is a rename: emit a `## REMOVED Requirements` section for the old header plus an `## ADDED Requirements` section for the reworded requirement (e.g. "Propose workflow creates the change and all artifacts") describing the same behavior without the `ff` reference. Do not silently edit the header in place — the validator's rename guard requires the explicit REMOVED.
- `opsx-onboard-skill` keeps its "command reference" requirement header; only the scenario bullet listing `/rasen:ff` changes. That is a `## MODIFIED Requirements` entry carrying the full updated requirement text (header retained).
- `legacy-cleanup`, `cli-update`, `cli-init`, `workflow-library` gain `## ADDED Requirements` for the new tolerance/prune behavior.

### D5. Test surface

The registry has a golden fixture: `test/fixtures/workflow-registry/builtins-v1.json` is asserted `toEqual getBuiltInWorkflowDefinitions()`, and `skill-templates-parity.test.ts` pins per-template SHA digests. These are intentional change-detectors — update the fixture (remove the `ff` entry) and the parity test (remove the ff imports, digests, dir-map entry, and parity tuple). Add positive coverage for D2 (stored `'ff'` warns and is dropped, run still succeeds) and D3 (installed `rasen-ff-change` dir + `ff` command file removed on update; no-op when absent).

## Risks / Trade-offs

- **Upstream cherry-pick friction** for anything touching the ff template — accepted per portfolio decision; the template was already fully rebranded and would conflict anyway.
- **A stored `custom` profile that listed *only* `ff`** would resolve to an empty selection after filtering. This is already the semantics for an empty custom profile and is acceptable; the warning makes it visible. (CORE/full profiles are unaffected since they are derived from the live id list.)
- **Two prune mechanisms now coexist** (registry-derived deselection prune + hardcoded retired prune). This mirrors the existing expert-rebrand precedent and is the intended pattern for deleted-vs-deselected ids; documented in code comments so the distinction is not re-litigated.

## Migration Plan

No user action required. On the next `rasen update` (or `rasen init`), stale `ff` in global config is dropped with a warning, and any installed `rasen-ff-change` skill dir / `ff` command file is removed. No config rewrite is forced; the warning simply surfaces the drift.

## Open Questions

None — all decisions are settled by the portfolio planning context and existing prior art.
