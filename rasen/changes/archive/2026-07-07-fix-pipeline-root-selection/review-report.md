# Review Report — fix-pipeline-root-selection

- **Reviewer:** independent verifier (gstack-review), not the implementer
- **Date:** 2026-07-07
- **Branch:** dev-harness (Windows)
- **Scope reviewed:** uncommitted working-tree diff — `src/cli/index.ts`, `src/commands/pipeline.ts`, `src/core/completions/command-registry.ts`, `src/core/templates/workflows/_orchestration.ts`, `src/core/templates/workflows/store-selection.ts`, `test/commands/pipeline.test.ts`, `test/core/completions/command-registry.test.ts`, `test/core/templates/skill-templates-parity.test.ts`, new `test/commands/pipeline-store-root-selection.test.ts`, plus the `openspec/changes/fix-pipeline-root-selection/` artifacts.

## Verdict

**APPROVE (round 1 re-review, 2026-07-07).** M1 and m1 are both verified resolved against the actual working tree; no new contradictions introduced; gates green. 0 open findings. See "Re-review (round 1) — reviewer" at the bottom for the delta verification. The original round-0 verdict and findings are retained below for the record.

---

**Round 0 verdict: APPROVE WITH CONCERNS.** The code migration is correct, complete, and well-tested — all five `pipeline` subcommands now resolve through `resolveRootForCommand` with the exact null-handling contract `validate` uses, `resume` reads run-state from the resolved root, and the store/subdirectory regression tests genuinely exercise the fix with effective XDG isolation. Gates are green (build, change-scoped tests, validate, config-not-polluted). One **Major** teaching gap remains: the agent-facing store guidance still tells the LEAD that pipeline commands do not accept `--store`, which leaves the store/portfolio `pipeline resume` scenario — the change's headline motivation — unreachable through the taught `/opsx:auto` workflow even though the CLI now supports it. This does not block merge of the code, but should be resolved (or explicitly deferred with rationale) before the change is considered to have met its stated goal.

## Gate Results

| Gate | Result | Notes |
|------|--------|-------|
| `pnpm build` | PASS | Skill docs regenerated + TypeScript compiled, "Build completed successfully". |
| `pnpm test` (change files) | PASS | The 4 touched test files run green in isolation: 41/41 passed (`pipeline.test.ts` 27, `pipeline-store-root-selection.test.ts` 3, `command-registry.test.ts`, `skill-templates-parity.test.ts`). |
| `pnpm test` (full suite) | FLAKY (unrelated) | 10 failures / 2065 passed. All failures are Windows environment flakiness in files this change does not touch: `spec.test.ts` ("Test timed out in 10000ms", subprocess startup under parallel load) and `artifact-workflow.test.ts` (`EBUSY: resource busy or locked, rmdir ...openspec-artifact-workflow-*`). Not logic regressions. |
| `openspec validate fix-pipeline-root-selection --json` | PASS | 1 item, 1 passed, 0 failed. |
| `openspec config list` (pollution guard, task 6.2) | PASS | Real global config intact — normal profile/telemetry, no ghost stores registered. |

## Findings

### Major

**M1 — Store guidance and orchestration teaching contradict the new `--store` capability, leaving the store/portfolio `pipeline resume` path unreachable through the taught workflow.**
`src/core/templates/workflows/store-selection.ts:7` (STORE_SELECTION_GUIDANCE) still reads *"...`doctor`, and the top-level `context`). **Other commands do not take the flag** ..."*. The five `pipeline` subcommands are "other commands", so the guidance now asserts they reject `--store` — but this very change made them `--store`-aware. Meanwhile `src/core/templates/workflows/auto.ts:85-89` teaches the LEAD to run `openspec pipeline resume <change> --json` with **no** `--store`, and `src/core/templates/workflows/_orchestration.ts:104` asserts that `openspec pipeline resume` is *"resolved to the same root"* as the change's `changeRoot`. That parity only holds if `--store <id>` is threaded onto `pipeline resume` (or resume is run from inside the store cwd). The new store test proves the intended usage is exactly `pipeline resume <change> --store <id>` from an **unrelated** cwd (`test/commands/pipeline-store-root-selection.test.ts:83-98`) — the portfolio-orchestration scenario the proposal names as the core break. As taught, in that scenario the LEAD omits `--store`, resume resolves to the nearest cwd root instead of the store, and the "breaks /opsx:auto resume ... in every store scenario" failure the change exists to fix re-manifests at the teaching layer. The CLI capability is correct; the agent instructions that would make an agent use it are missing and, worse, actively deny it.

*Suggested fix:* teach the pipeline inspection group as `--store`-capable — either add a dedicated sentence to STORE_SELECTION_GUIDANCE carving out `pipeline list/show/agents/classify/resume` as also accepting `--store` (distinct from the lifecycle enumeration), and/or update the orchestration Resume step (`auto.ts:85-89`) to show `openspec pipeline resume <change> --store <id> --json` when the run is store-scoped. Then update the `command-registry.test.ts` lifecycle/pipeline split and the parity golden-master hashes accordingly. (Note: the `command-registry.test.ts` comment already frames the pipeline group as "deliberately not part of the lifecycle guidance enumeration" — so this was a conscious choice; if it is intended to stay deferred, record that decision and the store-resume limitation in the proposal/changelog rather than leaving the guidance factually wrong.)

### Minor

**m1 — The `_orchestration.ts` `changeRoot` teaching (the primary orchestration fix, tasks 3.1/3.2) has no test coverage.**
The parity golden master (`skill-templates-parity.test.ts`) pins the lifecycle skills and opsx command templates but **not** the `/opsx:auto` / orchestration template, and no test anywhere greps for `changeRoot` (`grep -rn changeRoot test/` → none). Consistent with this, every pinned hash changed in the diff is explained solely by `STORE_SELECTION_GUIDANCE` (interpolated into all of them); the `_orchestration.ts` edit is reflected in **no** pinned hash. A regression that dropped or corrupted the `changeRoot` blackboard guidance would pass all tests.
*Suggested fix:* add an assertion that the generated `opsx:auto` skill content contains the `changeRoot` teaching (or pin the auto command template in the parity hash map).

### Trivial / Acceptable (no action required)

**t1 — `command-registry.test.ts` invariant split does not weaken drift detection.** The assertion was split into an exact-match on the lifecycle set and an exact-match on the pipeline set (`pipeline agents/classify/list/resume/show`), with the guidance-containment loop now scoped to lifecycle only. Both sets are still asserted exactly, so a newly added `--store` command on either surface still fails the test — drift detection is preserved. The only relaxation (guidance no longer required to name pipeline commands) is intentional and is the subject of M1, not an independent weakening.

## Verification notes (confirmed correct)

- **Resolver migration, all five entry points.** `list`/`show`/`agents`/`classify`/`resume` each do `const root = await this.resolveRoot(options); if (!root) return;` then use `root.path`. `resolveRoot` calls `resolveRootForCommand(options, { json: options.json })` — byte-identical contract to `validate.ts:86` (`if (!root) return;`). No residual `process.cwd()` or `resolveProjectRoot` remains in `pipeline.ts` (grep clean). (Design decisions + tasks 2.2–2.8.)
- **`resume`** derives `changeDir = path.join(root.changesDir, changeName)` and calls `validateChangeExists(change, root.path, root.changesDir)` — the `changesDir` override reaches `readRunState`/`readPortfolioState`, and the store test asserts `hasRunState:true` with correct `next`/`remaining` from an unrelated cwd. (Task 2.7.)
- **`agents`** writes the override under the resolved root: `writeProjectPipelineOverride(projectRoot=root.path, ...)` via `getProjectPipelinesDir(root.path)` (`pipeline.ts:230,522-527`); the store test confirms the override lands under the store root and `validate --pipelines --store` sees it. (Task 2.5 / 5.4.)
- **Test isolation is effective.** `pipeline-store-root-selection.test.ts` routes `XDG_DATA_HOME`/`XDG_CONFIG_HOME` to a per-test temp dir, uses `getGlobalDataDir({ env })` + `registerStore({ globalDataDir })`, and `runCLI` forwards env via `{ ...process.env, ...options.env }` so the child CLI honors the redirected data dir; tests also assert no `openspec/` is scaffolded in the cwd. The `config list` gate confirms the real `%APPDATA%\openspec` registry was untouched. (Design "Test isolation" risk; task 6.2.)
- **Parity hashes recomputed with the test's own recipe, delta scoped.** The parity test recomputes `hash(stableStringify(fn()))` / `hash(generateSkillContent(...))` live and compares — a green test is proof the pinned values match current output. The only src template sources changed are `store-selection.ts` and `_orchestration.ts`; all non-feedback hashes changing (feedback unchanged, consistent with it carrying no store guidance) is fully explained by `STORE_SELECTION_GUIDANCE` interpolation. No unexplained hash drift. (Lead concern 4a — resolved; the `_orchestration` half of that delta having no pinned coverage is finding m1.)
- **`store-selection.ts` `context` disambiguation** correctly distinguishes top-level `openspec context` (takes `--store`) from `openspec agent context` (does not). (Task 4.1.)

## Summary

- Findings: **1 Major, 1 Minor, 1 Trivial (acceptable)**, 0 Blockers.
- Gates: build PASS, change-scoped tests PASS (41/41), validate PASS, config-pollution guard PASS; full-suite has 10 unrelated Windows-flaky failures in untouched files.
- The code change is sound and mergeable; M1 (agent-teaching gap that leaves the headline store-resume scenario unreachable through the workflow) should be fixed or explicitly deferred-with-rationale before the change is deemed to meet its stated goal.

## Review fixes (round 1) — implementer

Both routed findings fixed; scope limited to M1 + m1, no other refactors.

**M1 (Major) — resolved.** Taught the pipeline group as `--store`-capable at the agent layer:
- `src/core/templates/workflows/store-selection.ts`: `STORE_SELECTION_GUIDANCE` now adds a dedicated sentence carving out the `openspec pipeline` inspection group (`pipeline list/show/agents/classify/resume`) as also accepting `--store <id>`, with an explicit instruction to thread `--store` onto `pipeline resume <change>` in a store-scoped run. The contradicting "Other commands do not take the flag" is rewritten to "Commands outside those two groups do not take the flag" (the `agent context` disambiguation is retained), so it no longer wrongly denies the pipeline group.
- `src/core/templates/workflows/auto.ts`: the Resume step now shows `openspec pipeline resume <change> --store <id> --json` for store-scoped runs (explaining that omitting it resolves the cwd root and reports `hasRunState:false`), and the Portfolio-resume step notes the same `--store` threading.
- `test/core/completions/command-registry.test.ts`: the guidance-containment loop is widened from lifecycle-only to every `--store` command (lifecycle + pipeline), since the guidance now names both surfaces; the two exact-set assertions (lifecycle 9, pipeline 5) are unchanged, so drift detection is preserved.
- `test/core/templates/skill-templates-parity.test.ts`: `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` recomputed (the `STORE_SELECTION_GUIDANCE` edit re-interpolates into every workflow/command template; `getFeedbackSkillTemplate` unchanged as before). Hashes regenerated with the test's own `stableStringify`/`generateSkillContent` recipe against the freshly built dist.
- Installed skills regenerated via `openspec update --force`; verified `/opsx:auto` now teaches `pipeline resume <change> --store <id> --json` and the guidance no longer denies pipeline `--store`.

**m1 (Minor) — resolved.** Added a `skill-templates-parity.test.ts` assertion that pins the generated `openspec-opsx-auto` skill content: it must contain `changeRoot`, the exact correction phrase `` `changeRoot` field (NOT `changeDir`) `` (tasks 3.1/3.2), and the store-scoped resume line `openspec pipeline resume <change> --store <id> --json` (guards the M1(b) fix). Previously the auto/orchestration template was pinned by no hash, so a regression to the `changeRoot` teaching would have passed silently.

**Verification:** `pnpm build` clean; `test/core/templates/skill-templates-parity.test.ts` + `test/core/completions/command-registry.test.ts` green (12/12); eslint clean on changed source. No commit/push; no `auto-run.json` written.

## Re-review (round 1) — reviewer

Independent verification of the fix delta only (not a full re-review), against the actual working tree.

**M1 (Major) — CONFIRMED RESOLVED.** The rewritten `STORE_SELECTION_GUIDANCE` (`store-selection.ts:7`) now (a) enumerates the `openspec pipeline` inspection group (`pipeline list/show/agents/classify/resume`) as `--store`-capable, (b) carries an explicit MUST to thread `--store` onto `pipeline resume <change>` in store-scoped runs, and (c) rewrites the contradiction to "Commands outside those two groups do not take the flag" — which is now factually correct, since the pipeline group is one of the two named groups. The agent-context disambiguation is retained. `auto.ts` Resume and Portfolio-resume steps both now show `openspec pipeline resume <change> --store <id> --json` with the cwd-vs-store rationale. I grepped for every other place that enumerates `--store`-capable commands or the "do not take the flag" phrasing (`grep -rn` over `src/`): the only hit is `store-selection.ts` itself — no second enumeration remains to contradict it. The `command-registry.test.ts` guidance-containment loop was widened back to iterate **all** `--store` commands (lifecycle + pipeline), so the guidance is now machine-enforced to name every pipeline subcommand; the two exact-set assertions (lifecycle 9, pipeline 5) are unchanged, so drift detection on both surfaces is preserved. Result: the store/portfolio `pipeline resume` scenario is now reachable through the taught workflow.

**m1 (Minor) — CONFIRMED RESOLVED.** The new `skill-templates-parity.test.ts` assertion is a real pin, not a tautology: it generates the `openspec-opsx-auto` skill and asserts the content contains `changeRoot`, the exact phrase `` `changeRoot` field (NOT `changeDir`) ``, and `openspec pipeline resume <change> --store <id> --json`. A regression that reverted the orchestration teaching to `changeDir` or dropped the store-scoped resume line would fail this assertion. The test is green, which also proves those strings are actually present in the generated output (not just asserted in isolation).

**Gates (round 1):**
- `pnpm build` — PASS (clean, dist regenerated).
- `skill-templates-parity.test.ts` + `command-registry.test.ts` — PASS, 12/12. Because the parity test recomputes hashes live (`stableStringify`/`generateSkillContent`) against the freshly-built dist and compares, a green run is proof the updated `EXPECTED_FUNCTION_HASHES` / `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` were legitimately recomputed from real template output — not hand-edited.

**Verdict: APPROVE — 0 open findings.** Both round-0 findings resolved; the fix delta is scoped to M1 + m1 with no collateral changes and no new contradictions. Cleared to ship.
